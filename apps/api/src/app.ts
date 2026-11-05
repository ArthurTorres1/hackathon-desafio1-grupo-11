import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from './db.js';
import { validateGeometry } from './services/geospatial.js';
import { assertNoSelfReview } from './services/self-review.js';
import { contextualHumanReview } from './services/review-readiness.js';
import { Decimal } from 'decimal.js';
import { Prisma } from '@prisma/client';
import { sha256Canonical, verifyEventChain } from './services/integrity.js';
import { assessConversion, checkBalance } from './services/rules.js';
import { allocateProvenance } from './services/provenance.js';
import QRCode from 'qrcode';
import { assessReadiness } from './services/review-readiness.js';
import { Type } from '@sinclair/typebox';
import { PlotCreateSchema, OriginLotCreateSchema, HarvestCreateSchema, ShipmentCreateSchema, ShipmentDispatchSchema, ShipmentReceiveSchema, TransformationCreateSchema, DecisionCreateSchema, PassportCreateSchema } from '@foresttrace/contracts';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessWhisp, createHttpWhispTransport } from './services/whisp.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
async function appendEvent(tx: Prisma.TransactionClient, input: { streamId: string; entityType: string; entityId: string; type: string; actorId: string; payload: unknown }) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.streamId}, 0))`;
  const head = await tx.streamHead.upsert({ where: { stream_id: input.streamId }, create: { stream_id: input.streamId }, update: {} });
  const timestamp = new Date(); const sequence = head.sequence + 1;
  const body = { event_id: randomUUID(), stream_id: input.streamId, sequence, entity: input.entityType, entity_id: input.entityId, type: input.type, actor_id: input.actorId, timestamp: timestamp.toISOString(), payload: input.payload, previous_hash: head.event_hash };
  const eventHash = sha256Canonical(body);
  await tx.custodyEvent.create({ data: { event_id: body.event_id, stream_id: body.stream_id, sequence, entity_type: body.entity, entity_id: body.entity_id, type: body.type, actor_id: body.actor_id, timestamp, payload: body.payload as object, previous_hash: body.previous_hash, event_hash: eventHash } });
  await tx.streamHead.update({ where: { stream_id: input.streamId }, data: { sequence, event_hash: eventHash } });
}
type AuthUser = { id: string; organization_id: string; roles: string[] };
declare module 'fastify' { interface FastifyRequest { authUser?: AuthUser; csrfToken?: string } }

function setError(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    request.log.error({ err: error, request_id: request.id }, 'request failed');
    const err = error as Error;
    void prisma.accessLog.create({ data: { action: 'REQUEST_ERROR', allowed: false, reason: status === 500 ? 'INTERNAL_ERROR' : err.message, request_id: request.id } }).catch(() => undefined);
    reply.code(status === 400 ? 422 : status >= 400 && status < 500 ? status : 500).send({ error: { code: status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR', message: status < 500 ? err.message : 'Erro interno.', request_id: request.id } });
  });
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true, genReqId: () => randomBytes(12).toString('hex') });
  setError(app);
  await app.register(cookie);
  const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(v => v.trim()).filter(Boolean);
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)), credentials: true });
  await app.register(swagger, { openapi: { info: { title: 'ForestTrace API', version: '1.0.0', description: 'Trilha demonstrativa de evidências; não certifica legalidade.' }, servers: [{ url: '/' }] } });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  app.get('/openapi.json', async () => app.swagger());

  app.get('/health', async () => ({ status: 'ok', service: 'foresttrace-api' }));
  app.get('/api/v1/auth/personas', async (_request, reply) => {
    if (process.env.DEMO_MODE !== 'true') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.', request_id: reply.request.id } });
    return { personas: await prisma.user.findMany({ select: { id: true, name: true, roles: true, organization: { select: { id: true, name: true, role: true, state: true } } }, orderBy: { name: 'asc' } }) };
  });
  app.post<{ Body: { user_id: string } }>('/api/v1/auth/session', { schema: { body: Type.Object({ user_id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    if (process.env.DEMO_MODE !== 'true') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.', request_id: request.id } });
    const user = await prisma.user.findUnique({ where: { id: request.body?.user_id }, include: { organization: true } });
    if (!user) return reply.code(404).send({ error: { code: 'PERSONA_NOT_FOUND', message: 'Perfil de demonstração não encontrado.', request_id: request.id } });
    const token = randomBytes(32).toString('base64url'); const csrf = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await prisma.session.create({ data: { token_hash: sha(token), csrf_hash: sha(csrf), user_id: user.id, expires_at: expires } });
    reply.setCookie('foresttrace_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires });
    reply.setCookie('foresttrace_csrf', csrf, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires });
    return { user: { id: user.id, name: user.name, roles: user.roles, organization: { id: user.organization.id, name: user.organization.name } }, csrf_token: csrf, expires_at: expires.toISOString() };
  });
  app.delete('/api/v1/auth/session', async (request, reply) => {
    const raw = request.cookies.foresttrace_session;
    if (raw) await prisma.session.deleteMany({ where: { token_hash: sha(raw) } });
    reply.clearCookie('foresttrace_session', { path: '/' }).clearCookie('foresttrace_csrf', { path: '/' });
    return { ok: true };
  });

  app.addHook('preHandler', async (request: FastifyRequest, reply) => {
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/api/v1/') || (path === '/api/v1/auth/personas' && request.method === 'GET') || (path === '/api/v1/auth/session' && request.method === 'POST')) return;
    const token = request.cookies.foresttrace_session;
    if (!token) { await logAccess(request, null, false, 'AUTH_REQUIRED'); return reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: 'Autenticação necessária.', request_id: request.id } }); }
    const session = await prisma.session.findUnique({ where: { token_hash: sha(token) }, include: { user: true } });
    if (!session || session.expires_at <= new Date()) { await logAccess(request, session?.user_id ?? null, false, 'SESSION_INVALID'); return reply.code(401).send({ error: { code: 'SESSION_INVALID', message: 'Sessão inválida ou expirada.', request_id: request.id } }); }
    let csrfHeader = '';
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) { await logAccess(request, session.user_id, false, 'ORIGIN_INVALID'); return reply.code(403).send({ error: { code: 'CSRF_INVALID', message: 'Origem não autorizada.', request_id: request.id } }); }
      const cookieToken = request.cookies.foresttrace_csrf ?? ''; csrfHeader = String(request.headers['x-csrf-token'] ?? '');
      if (!csrfHeader || !safeEqual(sha(cookieToken), session.csrf_hash) || !safeEqual(sha(csrfHeader), session.csrf_hash)) { await logAccess(request, session.user_id, false, 'CSRF_INVALID'); return reply.code(403).send({ error: { code: 'CSRF_INVALID', message: 'Token de segurança inválido.', request_id: request.id } }); }
    }
    request.authUser = { id: session.user.id, organization_id: session.user.organization_id, roles: session.user.roles };
    request.csrfToken = csrfHeader;
  });

  app.get('/api/v1/dashboard', async (request, reply) => {
    const current = request.authUser!;
    const session = await prisma.user.findUnique({ where: { id: current.id }, include: { organization: true } });
    if (!session) return reply.code(401).send({ error: { code: 'SESSION_INVALID', message: 'Sessão inválida ou expirada.', request_id: request.id } });
    const orgId = current.organization_id;
    const [lots, shipments, products, cases, passports, plots, transformations, checks, organizations] = await Promise.all([
      prisma.originLot.findMany({ where: { organization_id: orgId }, include: { plot: true }, orderBy: { created_at: 'desc' } }),
      prisma.shipment.findMany({ where: { OR: [{ sender_id: orgId }, { recipient_id: orgId }] }, include: { items: true }, orderBy: { created_at: 'desc' } }),
      prisma.productLot.findMany({ where: { organization_id: orgId }, orderBy: { created_at: 'desc' } }),
      prisma.auditCase.findMany({ where: { organization_id: orgId }, include: { decisions: true }, orderBy: { opened_at: 'desc' } }),
      prisma.passport.findMany({ where: { organization_id: orgId }, select: { id: true, product_lot_id: true, version: true, assessment_scope: true, created_at: true } }),
      prisma.plot.findMany({ where: { organization_id: orgId }, orderBy: { created_at: 'desc' } }),
      prisma.transformation.findMany({ where: { organization_id: orgId }, include: { inputs: true, outputs: true }, orderBy: { created_at: 'desc' } }),
      prisma.check.findMany({ where: { organization_id: orgId }, orderBy: { created_at: 'desc' } }),
      prisma.organization.findMany({ select: { id: true, name: true, role: true, state: true, municipality: true }, orderBy: { name: 'asc' } }),
    ]);
    return { user: { id: session.id, name: session.name, roles: session.roles, organization: { id: orgId, name: session.organization.name, state: session.organization.state } }, organizations, plots, origin_lots: lots, harvests: await prisma.harvest.findMany({ where: { organization_id: orgId }, orderBy: { created_at: 'desc' } }), shipments, transformations, product_lots: products, checks, audit_cases: cases, passports, metrics: { plot_count: plots.length, origin_lot_count: lots.length, shipment_count: shipments.length, transformation_count: transformations.length, open_alert_count: cases.filter(c => ['ABERTO', 'EM_ANALISE', 'MANTIDO_PENDENTE'].includes(c.status)).length }, limitations: ['Dados demonstrativos são sintéticos e permanecem MISSING_EVIDENCE.'] };
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/plots', { schema: { body: PlotCreateSchema } }, async (request, reply) => {
    const body = request.body; const actor = request.authUser!;
    const geo = body.geometry as { type?: string; coordinates?: unknown };
    if (!geo || typeof body.state !== 'string' || !Array.isArray(geo.coordinates)) {
      return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Informe parcela, UF, município, imóvel e polígono GeoJSON.', fields: ['geometry', 'state'], request_id: request.id } });
    }
    const validation = validateGeometry(geo);
    if (!validation.valid) return reply.code(422).send({ error: { code: 'INVALID_GEOJSON', message: validation.errors[0] ?? 'Geometria inválida.', fields: ['geometry'], request_id: request.id }, checks: [{ rule_id: 'R01', status: 'ALERTA', errors: validation.errors }] });
    const geom = geo; const serialized = JSON.stringify(geom); const hash = sha(serialized);
    const spatial = await prisma.$queryRaw<Array<{ valid: boolean; area: number }>>`SELECT ST_IsValid(g) AS valid, ST_Area(g::geography)/10000 AS area FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${serialized}),4326) AS g) q`;
    if (!spatial[0]?.valid) return reply.code(422).send({ error: { code: 'INVALID_GEOJSON', message: 'O polígono é topologicamente inválido.', fields: ['geometry'], request_id: request.id }, checks: [{ rule_id: 'R01', status: 'ALERTA' }] });
    const plot = await prisma.plot.create({ data: {
      organization_id: actor.organization_id, state: String(body.state).toUpperCase(), municipality: String(body.municipality ?? ''), declared_property: String(body.declared_property ?? ''),
      geometry: geom as object, geometry_hash: hash, geometry_version: Number(body.geometry_version ?? 1), geometry_date: body.geometry_date ? new Date(String(body.geometry_date)) : new Date(), area_ha: spatial[0]?.area ?? 0,
      data_provenance: body.data_provenance ?? { label: 'DECLARACAO_DO_USUARIO', source: 'operador autenticado' }, created_by_user_id: actor.id,
    } });
    return reply.code(201).send({ plot, checks: [{ rule_id: 'R01', status: 'PASSOU', message: 'Polígono aceito estruturalmente; topologia deve ser conferida.' }] });
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/origin-lots', { schema: { body: OriginLotCreateSchema } }, async (request, reply) => {
    const b = request.body; const actor = request.authUser!;
    const required = ['plot_id', 'code', 'species_common_name', 'species_scientific_name', 'authorized_volume_m3', 'valid_from', 'valid_until', 'right_of_use', 'permit_reference', 'permit_document_id'];
    const missing = required.filter(k => b[k] === undefined || b[k] === '');
    if (missing.length || !Number.isFinite(Number(b.authorized_volume_m3)) || Number(b.authorized_volume_m3) <= 0) return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Campos obrigatórios ausentes ou volume inválido.', fields: missing, request_id: request.id } });
    const plot = await prisma.plot.findFirst({ where: { id: String(b.plot_id), organization_id: actor.organization_id } });
    if (!plot) return reply.code(404).send({ error: { code: 'PLOT_NOT_FOUND', message: 'Parcela não encontrada nesta organização.', request_id: request.id } });
    try {
      const lot = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const created = await tx.originLot.create({ data: { organization_id: actor.organization_id, plot_id: plot.id, code: String(b.code), species_common: String(b.species_common_name), species_scientific: String(b.species_scientific_name), authorized_volume_m3: String(b.authorized_volume_m3), valid_from: new Date(String(b.valid_from)), valid_until: new Date(String(b.valid_until)), right_of_use: String(b.right_of_use), data_provenance: b.data_provenance ?? { label: 'SIMULADA', source: 'demo' }, assessment_scope: String(b.assessment_scope ?? 'DEMONSTRATIVO'), created_by_user_id: actor.id } });
        await tx.permit.create({ data: { origin_lot_id: created.id, reference: String(b.permit_reference), issuing_authority: 'DECLARADO_PELO_OPERADOR', official_system: 'NAO_VERIFICADO', document_id: String(b.permit_document_id), valid_from: new Date(String(b.valid_from)), valid_until: new Date(String(b.valid_until)), volume_m3: String(b.authorized_volume_m3), data_provenance: b.data_provenance ?? { label: 'SIMULADA', source: 'demo' } } });
        await tx.balance.create({ data: { lot_id: created.id, organization_id: actor.organization_id, available_m3: 0 } });
        await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: 'ORIGIN_LOT', entity_id: created.id, rule_id: 'R01', rule_version: '1', name: 'Geometria da parcela', description: 'Geometria associada ao lote de origem.', source: { type: 'USER_DECLARATION' }, modality: 'DEMONSTRATIVO', dimension: 'geospatial_check', status: 'PENDENTE', technical_severity: 'INFO', message: 'Cadastro não confirma propriedade ou autorização.', suggested_action: 'Conferir documentos e requisitos aplicáveis.', values: { plot_id: plot.id, geometry_hash: plot.geometry_hash }, assessment_scope: created.assessment_scope } });
        return created;
      });
      return reply.code(201).send({ origin_lot: lot, plot: { id: plot.id, geometry_hash: plot.geometry_hash }, balance: { available_m3: '0' } });
    } catch (e) { if ((e as { code?: string }).code === 'P2002') return reply.code(409).send({ error: { code: 'DUPLICATE_LOT_CODE', message: 'Código de lote já utilizado.', request_id: request.id } }); throw e; }
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/harvests', { schema: { body: HarvestCreateSchema } }, async (request, reply) => {
    const b = request.body; const actor = request.authUser!; let volume: Decimal;
    try { volume = new Decimal(String(b.volume_m3)); } catch { return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Volume decimal inválido.', request_id: request.id } }); }
    if (!b.origin_lot_id || !volume.isFinite() || volume.lte(0) || !b.start_date || !b.end_date) return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Informe lote, período e volume positivo.', request_id: request.id } });
    const requestPayload = JSON.stringify(b); const hash = sha(requestPayload);
    const lot = await prisma.originLot.findFirst({ where: { id: String(b.origin_lot_id), organization_id: actor.organization_id }, include: { permits: true } });
    if (!lot) return reply.code(404).send({ error: { code: 'LOT_NOT_FOUND', message: 'Lote não encontrado nesta organização.', request_id: request.id } });
    const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const current = await tx.originLot.findUniqueOrThrow({ where: { id: lot.id } });
      const remaining = new Decimal(current.authorized_volume_m3.toString()).minus(current.harvested_volume_m3.toString());
      if (volume.gt(remaining)) {
        const pending = await tx.pendingOperationRequest.create({ data: { organization_id: actor.organization_id, operation: 'HARVEST_OVER_AUTHORIZATION', payload: b as object, payload_hash: hash, created_by_user_id: actor.id } });
        const check = await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: 'ORIGIN_LOT', entity_id: lot.id, rule_id: 'R07', rule_version: '1', name: 'Corte acima do saldo autorizado', description: 'Tentativa preservada como declaração pendente.', source: { type: 'DECLARATION' }, modality: 'DEMONSTRATIVO', dimension: 'volume_check', status: 'ALERTA', technical_severity: 'HIGH', message: 'O volume excede o saldo autorizado remanescente.', suggested_action: 'Conferir autorização ou corrigir a declaração com evidência competente.', values: { requested_m3: volume.toFixed(), remaining_m3: remaining.toFixed() }, assessment_scope: lot.assessment_scope } });
        const auditCase = await tx.auditCase.create({ data: { organization_id: actor.organization_id, check_id: check.id, entity_type: 'ORIGIN_LOT', entity_id: lot.id, created_by_user_id: actor.id, rule_id: 'R07' } });
        await tx.pendingOperationRequest.update({ where: { id: pending.id }, data: { payload: { ...(b as object), audit_case_id: auditCase.id } } });
        return { pending, remaining: remaining.toFixed() };
      }
      const harvest = await tx.harvest.create({ data: { organization_id: actor.organization_id, origin_lot_id: lot.id, species: String(b.species_common_name ?? lot.species_common), volume_m3: volume.toFixed(), period_start: new Date(String(b.start_date)), period_end: new Date(String(b.end_date)), tag: String(b.tag ?? 'SIMULADA'), document_ids: Array.isArray(b.document_ids) ? b.document_ids.map(String) : [], created_by_user_id: actor.id } });
      await tx.originLot.update({ where: { id: lot.id }, data: { harvested_volume_m3: { increment: volume.toFixed() } } });
      await tx.balance.upsert({ where: { lot_id_organization_id: { lot_id: lot.id, organization_id: actor.organization_id } }, create: { lot_id: lot.id, organization_id: actor.organization_id, available_m3: volume.toFixed() }, update: { available_m3: { increment: volume.toFixed() } } });
      await tx.balanceMovement.create({ data: { lot_id: lot.id, organization_id: actor.organization_id, entity_type: 'HARVEST', entity_id: harvest.id, action: 'CREDIT', volume_m3: volume.toFixed() } });
      await appendEvent(tx, { streamId: lot.id, entityType: 'ORIGIN_LOT', entityId: lot.id, type: 'HARVEST_RECORDED', actorId: actor.id, payload: { harvest_id: harvest.id, volume_m3: volume.toFixed(), period_start: b.start_date, period_end: b.end_date } });
      return { harvest };
    }, { isolationLevel: 'Serializable' });
    if ('pending' in outcome) return reply.code(202).send({ status: 'PENDENTE_REVISAO', pending_operation: outcome.pending, check: 'R07', authorized_remaining_m3: outcome.remaining });
    return reply.code(201).send({ harvest: outcome.harvest, status: 'CONFIRMADO' });
  });

  app.post<{ Params: { id: string }; Body: { options?: Record<string, unknown> } }>('/api/v1/origin-lots/:id/geospatial-assessments', async (request, reply) => {
    const actor = request.authUser!;
    const lot = await prisma.originLot.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id }, include: { plot: true } });
    if (!lot) return reply.code(404).send({ error: { code: 'LOT_NOT_FOUND', message: 'Lote não encontrado neste escopo.', request_id: request.id } });
    const confirmed = process.env.WHISP_CONTRACT_CONFIRMED === 'true' && !!process.env.WHISP_SUBMIT_URL && !!process.env.WHISP_POLL_URL_TEMPLATE;
    const transport = confirmed ? createHttpWhispTransport({ submitUrl: process.env.WHISP_SUBMIT_URL!, pollUrl: id => process.env.WHISP_POLL_URL_TEMPLATE!.replace('{job_id}', encodeURIComponent(id)) }) : undefined;
    const simulatedFixture = { status: 'SIMULADA', signal: 'PENDENTE_DE_AVALIACAO', note: 'Fixture ilustrativa; não constitui consulta ambiental real.' };
    const assessment = await assessWhisp({ geometry: lot.plot.geometry, options: request.body.options, contractConfirmed: confirmed, apiKey: process.env.WHISP_API_KEY, transport, simulatedFixture, timeoutMs: 5000, maxPolls: 3, maxRetries: 1 });
    const sourceName = 'Whisp';
    const source = await prisma.source.findFirst({ where: { name: sourceName, integration_status: confirmed ? 'CONTRATO_CONFIRMADO' : 'SEM_INTEGRACAO_REAL' } }) ?? await prisma.source.create({ data: { name: sourceName, owner: confirmed ? 'Fornecedor configurado por operador' : 'Fornecedor/contrato pendente de confirmação', url: process.env.WHISP_INFO_URL ?? 'UNCONFIGURED', access_mode: 'API', requires_auth: true, spatial_coverage: 'Não confirmada', time_coverage: 'Não confirmada', update_frequency: 'Não confirmada', license: 'Não confirmada', fields_used: ['geometria'], integration_status: confirmed ? 'CONTRATO_CONFIRMADO' : 'SEM_INTEGRACAO_REAL', confidence: 'NAO_AVALIADA', limitations: 'A ausência de resposta não significa ausência de sinal; não determina legalidade.', checked_at: new Date() } });
    const payload = { geometry_hash: lot.plot.geometry_hash, options: request.body.options ?? {} } as Prisma.InputJsonObject;
    const result = await prisma.sourceQuery.create({ data: { organization_id: actor.organization_id, lot_id: lot.id, source_id: source.id, geometry_hash: lot.plot.geometry_hash, payload, result: assessment as object, payload_hash: sha256Canonical(payload), result_hash: sha256Canonical(assessment), status: assessment.result, http_status: null, provider_version: 'não informada', assessment_scope: lot.assessment_scope, data_provenance: assessment.provenance, failure_reason: assessment.reason ?? null, job_id: assessment.job_id ?? null } });
    await prisma.check.create({ data: { organization_id: actor.organization_id, entity_type: 'ORIGIN_LOT', entity_id: lot.id, rule_id: 'GEO_PROVIDER', rule_version: '1', name: 'Avaliação geoespacial', description: 'Consulta de provedor com trilha de fonte e payload.', source: { source_id: source.id, source_name: source.name }, modality: assessment.provenance, dimension: 'geospatial_check', status: 'NAO_AVALIADO', technical_severity: 'INFO', message: assessment.reason ?? 'Resultado preservado para revisão contextual; sem conclusão de legalidade.', suggested_action: 'Verificar contexto, período e evidências antes de decisão humana.', values: { source_query_id: result.id, result_hash: result.result_hash }, assessment_scope: lot.assessment_scope } });
    return reply.code(201).send({ source_query: result, assessment, check_status: 'NAO_AVALIADO' });
  });

  app.get<{ Params: { id: string } }>('/api/v1/origin-lots/:id/geospatial-assessments', async (request, reply) => {
    const lot = await prisma.originLot.findFirst({ where: { id: request.params.id, organization_id: request.authUser!.organization_id }, select: { id: true } });
    if (!lot) return reply.code(404).send({ error: { code: 'LOT_NOT_FOUND', message: 'Lote não encontrado neste escopo.', request_id: request.id } });
    const assessments = await prisma.sourceQuery.findMany({ where: { lot_id: lot.id, organization_id: request.authUser!.organization_id }, orderBy: { created_at: 'desc' } });
    const sourceIds = [...new Set(assessments.map(q => q.source_id))]; const sources = await prisma.source.findMany({ where: { id: { in: sourceIds } } });
    return { assessments, sources };
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/shipments', { schema: { body: ShipmentCreateSchema } }, async (request, reply) => {
    const actor = request.authUser!; const b = request.body;
    if (String(b.sender_organization_id) !== actor.organization_id || !Array.isArray(b.items) || !b.items.length) return reply.code(403).send({ error: { code: 'ORGANIZATION_SCOPE_DENIED', message: 'Remessa deve ser criada pelo remetente autenticado.', request_id: request.id } });
    try {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const items: Array<{ lot_id: string; volume_m3: string }> = [];
        for (const raw of b.items as Array<Record<string, unknown>>) {
          const vol = new Decimal(String(raw.volume_m3));
          if (!vol.isFinite() || vol.lte(0)) throw Object.assign(new Error('Volume inválido.'), { code: 'VOLUME_INVALID' });
          const balance = await tx.balance.findUnique({ where: { lot_id_organization_id: { lot_id: String(raw.lot_id), organization_id: actor.organization_id } } });
          if (!balance || new Decimal(balance.available_m3.toString()).lt(vol)) throw Object.assign(new Error('Saldo disponível insuficiente.'), { code: 'R08' });
          const upd = await tx.balance.updateMany({ where: { id: balance.id, available_m3: { gte: vol.toFixed() } }, data: { available_m3: { decrement: vol.toFixed() }, reserved_m3: { increment: vol.toFixed() } } });
          if (!upd.count) throw Object.assign(new Error('Saldo alterado por operação concorrente.'), { code: 'R08' });
          items.push({ lot_id: String(raw.lot_id), volume_m3: vol.toFixed() });
        }
        const shipment = await tx.shipment.create({ data: { sender_id: actor.organization_id, recipient_id: String(b.recipient_organization_id), carrier: String(b.transporter), origin_state: String(b.origin_state), destination_state: String(b.destination_state), route_states: Array.isArray(b.route_states) ? b.route_states.map(String) : [], official_system: String(b.official_system), document_ids: Array.isArray(b.document_ids) ? b.document_ids.map(String) : [], declared_at: new Date(), created_by_user_id: actor.id, items: { create: items } }, include: { items: true } });
        for (const item of items) await tx.balanceMovement.create({ data: { lot_id: item.lot_id, organization_id: actor.organization_id, entity_type: 'SHIPMENT', entity_id: shipment.id, action: 'RESERVE', volume_m3: item.volume_m3 } });
        await appendEvent(tx, { streamId: shipment.id, entityType: 'SHIPMENT', entityId: shipment.id, type: 'SHIPMENT_CREATED', actorId: actor.id, payload: { sender_id: shipment.sender_id, recipient_id: shipment.recipient_id, items } });
        return shipment;
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send({ shipment: result });
    } catch (error) { const e = error as Error & { code?: string }; return reply.code(e.code === 'R08' ? 409 : 422).send({ error: { code: e.code ?? 'VALIDATION_ERROR', message: e.message, request_id: request.id } }); }
  });

  app.post<{ Params: { id: string }; Body: { occurred_at: string } }>('/api/v1/shipments/:id/dispatch', { schema: { body: ShipmentDispatchSchema, params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const actor = request.authUser!;
    const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const shipment = await tx.shipment.findFirst({ where: { id: request.params.id, sender_id: actor.organization_id }, include: { items: true } });
      if (!shipment || shipment.status !== 'CREATED') return null;
      for (const item of shipment.items) {
        await tx.balance.update({ where: { lot_id_organization_id: { lot_id: item.lot_id, organization_id: actor.organization_id } }, data: { reserved_m3: { decrement: item.volume_m3 }, quarantined_m3: { increment: item.volume_m3 } } });
        await tx.balanceMovement.create({ data: { lot_id: item.lot_id, organization_id: actor.organization_id, entity_type: 'SHIPMENT', entity_id: shipment.id, action: 'DISPATCH', volume_m3: item.volume_m3 } });
      }
      const saved = await tx.shipment.update({ where: { id: shipment.id }, data: { status: 'DISPATCHED', dispatched_at: new Date(request.body.occurred_at), dispatched_by_user_id: actor.id } });
      await appendEvent(tx, { streamId: shipment.id, entityType: 'SHIPMENT', entityId: shipment.id, type: 'SHIPMENT_DISPATCHED', actorId: actor.id, payload: { occurred_at: request.body.occurred_at } });
      return saved;
    }, { isolationLevel: 'Serializable' });
    if (!outcome) return reply.code(409).send({ error: { code: 'SHIPMENT_STATE_CONFLICT', message: 'Remessa inexistente ou não pode ser expedida.', request_id: request.id } });
    return { shipment: outcome };
  });

  app.post<{ Params: { id: string }; Body: { occurred_at: string; items: Array<{ lot_id: string; volume_m3: string }> } }>('/api/v1/shipments/:id/receive', { schema: { body: ShipmentReceiveSchema, params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const actor = request.authUser!;
    const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const shipment = await tx.shipment.findFirst({ where: { id: request.params.id, recipient_id: actor.organization_id }, include: { items: true } });
      if (!shipment || shipment.status !== 'DISPATCHED') return null;
      const receivedByLot = new Map(request.body.items.map(i => [i.lot_id, new Decimal(i.volume_m3)])); const checks = [] as Array<{ lot_id: string; difference_m3: string; status: string }>;
      for (const item of shipment.items) {
        const received = receivedByLot.get(item.lot_id) ?? new Decimal(0); const dispatched = new Decimal(item.volume_m3.toString()); const diff = dispatched.minus(received).abs();
        const current = await tx.balance.findUnique({ where: { lot_id_organization_id: { lot_id: item.lot_id, organization_id: shipment.sender_id } } });
        if (current) await tx.balance.update({ where: { id: current.id }, data: { quarantined_m3: { decrement: item.volume_m3 } } });
        await tx.balance.upsert({ where: { lot_id_organization_id: { lot_id: item.lot_id, organization_id: shipment.recipient_id } }, create: { lot_id: item.lot_id, organization_id: shipment.recipient_id, available_m3: received.toFixed() }, update: { available_m3: { increment: received.toFixed() } } });
        await tx.shipmentItem.update({ where: { id: item.id }, data: { received_volume_m3: received.toFixed() } });
        checks.push({ lot_id: item.lot_id, difference_m3: diff.toFixed(), status: diff.isZero() ? 'PASSOU' : 'ALERTA' });
      }
      const saved = await tx.shipment.update({ where: { id: shipment.id }, data: { status: checks.every(c => c.status === 'PASSOU') ? 'RECEIVED' : 'RECEIVED_WITH_VARIANCE', received_at: new Date(request.body.occurred_at), received_by_user_id: actor.id } });
      await appendEvent(tx, { streamId: shipment.id, entityType: 'SHIPMENT', entityId: shipment.id, type: 'SHIPMENT_RECEIVED', actorId: actor.id, payload: { occurred_at: request.body.occurred_at, checks } });
      if (checks.some(c => c.status === 'ALERTA')) await tx.check.create({ data: { organization_id: shipment.recipient_id, entity_type: 'SHIPMENT', entity_id: shipment.id, rule_id: 'R09', rule_version: '1', name: 'Divergência de recebimento', description: 'Quantidade recebida difere da expedida; tolerância zero.', source: { type: 'SHIPMENT_DECLARATION' }, modality: 'DEMONSTRATIVO', dimension: 'chain_of_custody_check', status: 'ALERTA', technical_severity: 'MEDIUM', message: 'R09 detectou divergência entre expedição e recebimento.', suggested_action: 'Investigar e anexar evidência.', values: { checks }, assessment_scope: 'DEMONSTRATIVO' } });
      return { shipment: saved, checks };
    }, { isolationLevel: 'Serializable' });
    if (!outcome) return reply.code(409).send({ error: { code: 'SHIPMENT_STATE_CONFLICT', message: 'Remessa inexistente ou não pode ser recebida.', request_id: request.id } });
    return outcome;
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/transformations', { schema: { body: TransformationCreateSchema } }, async (request, reply) => {
    const actor = request.authUser!; const b = request.body;
    if (String(b.operator_organization_id) !== actor.organization_id || !Array.isArray(b.inputs) || !Array.isArray(b.outputs) || !b.inputs.length || !b.outputs.length) return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Informe organização, entradas e saídas da transformação.', request_id: request.id } });
    try {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const inputs = b.inputs as Array<{ lot_id: string; volume_m3: string }>;
        const outputs = b.outputs as Array<{ client_ref: string; product: string; volume_m3: string; allocations: Array<{ origin_lot_id: string | null; volume_m3: string }> }>;
        const totalInput = inputs.reduce((sum, row) => sum.plus(row.volume_m3), new Decimal(0));
        const totalOutput = outputs.reduce((sum, row) => sum.plus(row.volume_m3), new Decimal(0));
        for (const input of inputs) {
          const vol = new Decimal(input.volume_m3); const balance = await tx.balance.findUnique({ where: { lot_id_organization_id: { lot_id: input.lot_id, organization_id: actor.organization_id } } });
          const check = checkBalance(balance?.available_m3.toString() ?? '0', vol.toFixed(), 'R08');
          if (!check.confirmed) throw Object.assign(new Error('Saldo de entrada insuficiente.'), { code: 'R08', details: check });
        }
        const parameter = await tx.conversionParameter.findUnique({ where: { id: String(b.conversion_parameter_id) } });
        if (!parameter) throw Object.assign(new Error('Parâmetro CRV não encontrado; operação permanece sem conclusão.'), { code: 'CRV_PARAMETER_MISSING' });
        const assessment = assessConversion({ inputVolumeM3: totalInput.toFixed(), outputVolumeM3: totalOutput.toFixed(), multiplier: parameter.coefficient.toString(), parameterVersion: parameter.version, parameterSource: parameter.source_url, assessmentDate: String(b.occurred_at).slice(0, 10) });
        const transformation = await tx.transformation.create({ data: { code: String(b.code), organization_id: actor.organization_id, occurred_at: new Date(String(b.occurred_at)), conversion_parameter_id: parameter.id, residue_m3: String(b.residue_m3 ?? '0'), loss_m3: String(b.loss_m3 ?? '0'), assessment_scope: String(b.assessment_scope ?? 'DEMONSTRATIVO'), created_by_user_id: actor.id, inputs: { create: inputs.map(i => ({ lot_id: i.lot_id, volume_m3: i.volume_m3 })) } } });
        for (const input of inputs) {
          await tx.balance.update({ where: { lot_id_organization_id: { lot_id: input.lot_id, organization_id: actor.organization_id } }, data: { available_m3: { decrement: input.volume_m3 } } });
          await tx.balanceMovement.create({ data: { lot_id: input.lot_id, organization_id: actor.organization_id, entity_type: 'TRANSFORMATION', entity_id: transformation.id, action: 'CONSUME', volume_m3: input.volume_m3 } });
        }
        const created = [];
        for (const output of outputs) {
          const provenance = allocateProvenance(output.volume_m3, output.allocations);
          const productLot = await tx.productLot.create({ data: { code: output.client_ref, organization_id: actor.organization_id, transformation_id: transformation.id, product: output.product, species_common: String(b.species_common_name ?? 'não informado'), species_scientific: String(b.species_scientific_name ?? 'não informado'), volume_m3: output.volume_m3, assessment_scope: String(b.assessment_scope ?? 'DEMONSTRATIVO'), data_provenance: { label: 'SIMULADA', source: 'operação demonstrativa' }, created_by_user_id: actor.id } });
          for (const allocation of provenance.allocations) await tx.lotProvenance.create({ data: { product_lot_id: productLot.id, origin_lot_id: allocation.origin_lot_id, volume_m3: allocation.volume_m3, fraction: allocation.fraction } });
          const restricted = assessment.result !== 'PASSOU' || provenance.evidence_incomplete;
          await tx.balance.create({ data: { lot_id: productLot.id, organization_id: actor.organization_id, available_m3: restricted ? '0' : output.volume_m3, quarantined_m3: restricted ? output.volume_m3 : '0' } });
          created.push({ product_lot: productLot, provenance, quarantined: restricted });
        }
        for (const [ruleId, status, dimension, message, values] of [
          ['R10', assessment.result, 'volume_check', assessment.explanation, assessment],
          ...(created.some(x => x.provenance.evidence_incomplete) ? [['R11', 'ALERTA', 'chain_of_custody_check', 'Há volume de origem desconhecida.', { outputs: created.map(x => x.provenance) }]] : []),
        ] as Array<[string, string, string, string, unknown]>) {
          if (status === 'PASSOU') continue;
          const check = await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: 'TRANSFORMATION', entity_id: transformation.id, rule_id: ruleId, rule_version: '1', name: ruleId === 'R10' ? 'Rendimento de conversão' : 'Proveniência incompleta', description: message, source: { parameter_id: parameter.id, source_url: parameter.source_url }, modality: 'DEMONSTRATIVO', dimension, status, technical_severity: 'HIGH', message, suggested_action: 'Revisar evidências e parâmetros aplicáveis.', values: values as object, assessment_scope: transformation.assessment_scope } });
          await tx.auditCase.create({ data: { organization_id: actor.organization_id, check_id: check.id, entity_type: 'TRANSFORMATION', entity_id: transformation.id, created_by_user_id: actor.id, rule_id: ruleId } });
        }
        await appendEvent(tx, { streamId: transformation.id, entityType: 'TRANSFORMATION', entityId: transformation.id, type: 'TRANSFORMATION_RECORDED', actorId: actor.id, payload: { inputs, outputs: created.map(x => ({ id: x.product_lot.id, provenance: x.provenance })), assessment } });
        return { transformation, outputs: created, assessment };
      }, { isolationLevel: 'Serializable' });
      return reply.code(201).send(result);
    } catch (error) { const e = error as Error & { code?: string; details?: unknown }; return reply.code(e.code === 'R08' ? 409 : e.code === 'CRV_PARAMETER_MISSING' ? 422 : 422).send({ error: { code: e.code ?? 'TRANSFORMATION_REJECTED', message: e.message, request_id: request.id }, details: e.details }); }
  });

  app.post<{ Params: { id: string }; Body: { decision: string; comment: string; evidence_ids: string[]; conversion_exception_id?: string } }>('/api/v1/audit-cases/:id/decisions', { schema: { body: DecisionCreateSchema, params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const actor = request.authUser!; const body = request.body;
    const auditCase = await prisma.auditCase.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id } });
    if (!auditCase) return reply.code(404).send({ error: { code: 'CASE_NOT_FOUND', message: 'Caso não encontrado no escopo da organização.', request_id: request.id } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!user.roles.includes('AUDITOR')) return reply.code(403).send({ error: { code: 'AUDITOR_ROLE_REQUIRED', message: 'Perfil de auditor necessário.', request_id: request.id } });
    let operationAuthor: string | null = null;
    if (auditCase.entity_type === 'ORIGIN_LOT') operationAuthor = (await prisma.originLot.findUnique({ where: { id: auditCase.entity_id }, select: { created_by_user_id: true } }))?.created_by_user_id ?? null;
    if (auditCase.entity_type === 'TRANSFORMATION') operationAuthor = (await prisma.transformation.findUnique({ where: { id: auditCase.entity_id }, select: { created_by_user_id: true } }))?.created_by_user_id ?? null;
    try { assertNoSelfReview({ reviewerUserId: actor.id, operationAuthorUserId: operationAuthor, versionAuthorUserId: auditCase.created_by_user_id }); }
    catch (error) {
      await logAccess(request, actor.id, false, (error as { code?: string }).code ?? 'REVIEW_AUTHOR_UNKNOWN');
      const e = error as Error & { code?: string };
      return reply.code(403).send({ error: { code: e.code ?? 'REVIEW_AUTHOR_UNKNOWN', message: e.message, request_id: request.id } });
    }
    if (!body.comment?.trim() || body.decision === 'RESOLVIDO_COM_EVIDENCIA' && (!Array.isArray(body.evidence_ids) || body.evidence_ids.length === 0)) return reply.code(422).send({ error: { code: 'REVIEW_EVIDENCE_REQUIRED', message: 'Informe justificativa e evidência vinculada para resolver o caso.', request_id: request.id } });
    if (body.evidence_ids.length) {
      const docs = await prisma.document.count({ where: { id: { in: body.evidence_ids }, organization_id: actor.organization_id } });
      if (docs !== body.evidence_ids.length) return reply.code(422).send({ error: { code: 'EVIDENCE_NOT_ACCESSIBLE', message: 'Uma ou mais evidências não estão disponíveis neste escopo.', request_id: request.id } });
    }
    const review = contextualHumanReview({ original_signal: auditCase.rule_id, decision: body.decision, comment: body.comment, evidenceIds: body.evidence_ids });
    const saved = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const decision = await tx.auditDecision.create({ data: { case_id: auditCase.id, reviewer_user_id: actor.id, decision: body.decision, comment: body.comment.trim(), evidence_ids: body.evidence_ids, conversion_exception_id: body.conversion_exception_id } });
      const updated = await tx.auditCase.update({ where: { id: auditCase.id }, data: { status: body.decision } });
      return { decision, audit_case: updated };
    });
    return reply.code(201).send({ ...saved, review });
  });

  app.get<{ Params: { public_token: string } }>('/p/:public_token', async (request, reply) => {
    const passport = await prisma.passport.findUnique({ where: { public_token: request.params.public_token } });
    if (!passport) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Passaporte não encontrado.', request_id: request.id } });
    const content = passport.content as Record<string, unknown>;
    return { id: passport.id, version: passport.version, product: content.product ?? null, species: content.species ?? null, region: content.region ?? null, stages: content.stages ?? [], evidence_status: content.evidence_status ?? 'MISSING_EVIDENCE', assessment_scope: passport.assessment_scope, content_hash: passport.content_hash };
  });

  app.post<{ Body: { product_lot_id: string; assessment_scope: 'REAL' | 'DEMONSTRATIVO' } }>('/api/v1/passports', { schema: { body: PassportCreateSchema } }, async (request, reply) => {
    const actor = request.authUser!;
    const lot = await prisma.productLot.findFirst({ where: { id: request.body.product_lot_id, organization_id: actor.organization_id }, include: { transformation: { include: { inputs: true } } } });
    if (!lot) return reply.code(404).send({ error: { code: 'PRODUCT_LOT_NOT_FOUND', message: 'Lote de produto não encontrado.', request_id: request.id } });
    const [checks, provenanceRows] = await Promise.all([
      prisma.check.findMany({ where: { entity_id: { in: [lot.id, lot.transformation_id] } }, orderBy: { created_at: 'desc' } }),
      prisma.lotProvenance.findMany({ where: { product_lot_id: lot.id } }),
    ]);
    const dimensions: Record<string, 'PASSOU' | 'ALERTA' | 'PENDENTE' | 'NAO_AVALIADO'> = {};
    for (const check of checks) if (!dimensions[check.dimension]) dimensions[check.dimension] = check.status as typeof dimensions[string];
    const unknown = provenanceRows.some((p: Prisma.LotProvenanceGetPayload<{}>) => !p.origin_lot_id && new Decimal(p.volume_m3.toString()).gt(0));
    const simulated = request.body.assessment_scope === 'DEMONSTRATIVO' || (lot.data_provenance as { label?: string } | null)?.label === 'SIMULADA';
    const readiness = assessReadiness({ assessment_scope: request.body.assessment_scope, dimensions, regulatory_coverage: 'PENDENTE_DE_VERIFICACAO', has_open_alert: checks.some((c: Prisma.CheckGetPayload<{}>) => c.status === 'ALERTA'), has_unknown_origin: unknown, has_simulated_supporting_evidence: simulated });
    const publicToken = randomBytes(32).toString('base64url');
    const snapshot = {
      product: lot.product, species: { common: lot.species_common, scientific: lot.species_scientific },
      region: 'Brasil', stages: ['origem', 'transformação', 'revisão', 'passaporte'],
      evidence_status: readiness.readiness, readiness_reasons: readiness.reasons,
      assessment_scope: request.body.assessment_scope, regulatory_coverage: readiness.regulatory_coverage,
      volume_m3: lot.volume_m3.toString(), provenance: provenanceRows.map((p: Prisma.LotProvenanceGetPayload<{}>) => ({ origin_lot_id: p.origin_lot_id, volume_m3: p.volume_m3.toString(), fraction: p.fraction.toString() })),
      checks: checks.map((c: Prisma.CheckGetPayload<{}>) => ({ rule_id: c.rule_id, status: c.status, message: c.message, dimension: c.dimension })),
      disclaimer: 'Documento demonstrativo de evidências; não certifica legalidade nem substitui decisão humana.',
    };
    const contentHash = sha256Canonical(snapshot);
    const passport = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const previous = await tx.passport.findFirst({ where: { product_lot_id: lot.id }, orderBy: { version: 'desc' } });
      const created = await tx.passport.create({ data: { organization_id: actor.organization_id, product_lot_id: lot.id, public_token: publicToken, version: (previous?.version ?? 0) + 1, content: snapshot, content_hash: contentHash, snapshot_heads: {}, assessment_scope: request.body.assessment_scope, created_by_user_id: actor.id } });
      await appendEvent(tx, { streamId: lot.id, entityType: 'PASSPORT', entityId: created.id, type: 'PASSPORT_ISSUED', actorId: actor.id, payload: { passport_id: created.id, version: created.version, content_hash: contentHash } });
      const head = await tx.streamHead.findUnique({ where: { stream_id: lot.id } });
      return tx.passport.update({ where: { id: created.id }, data: { snapshot_heads: { [lot.id]: { sequence: head?.sequence ?? 0, event_hash: head?.event_hash ?? null } } } });
    });
    const qr = await QRCode.toDataURL(`${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'}/p/${publicToken}`);
    return reply.code(201).send({ passport, qr_data_url: qr, readiness });
  });

  app.get<{ Params: { id: string } }>('/api/v1/passports/:id', async (request, reply) => {
    const passport = await prisma.passport.findFirst({ where: { id: request.params.id, organization_id: request.authUser!.organization_id } });
    if (!passport) return reply.code(404).send({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passaporte não encontrado neste escopo.', request_id: request.id } });
    return { passport };
  });

  app.get<{ Params: { id: string }; Querystring: { format?: string } }>('/api/v1/passports/:id/bundle', async (request, reply) => {
    const started = Date.now();
    const passport = await prisma.passport.findFirst({ where: { id: request.params.id, organization_id: request.authUser!.organization_id } });
    if (!passport) return reply.code(404).send({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passaporte não encontrado neste escopo.', request_id: request.id } });
    const bundle = { passport_id: passport.id, version: passport.version, generated_at: new Date().toISOString(), content_hash: passport.content_hash, content: passport.content, guidance: 'Guarde os documentos e registros por cinco anos conforme orientação do operador; esta aplicação não garante retenção por esse prazo.', limitations: ['Integridade dos hashes não comprova veracidade nem assinatura digital.'] };
    const format = (request.query.format ?? 'JSON').toUpperCase();
    if (format === 'HTML') {
      const escape = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Pacote de evidências ForestTrace</title><body><h1>Pacote de evidências ForestTrace</h1><p>Versão ${passport.version} · SHA-256 ${escape(passport.content_hash)}</p><pre>${escape(JSON.stringify(passport.content, null, 2))}</pre><p>${escape(bundle.guidance)}</p><p>${escape(bundle.limitations.join(' '))}</p></body></html>`;
      const duration = Date.now() - started; await prisma.evidenceBundle.create({ data: { passport_id: passport.id, user_id: request.authUser!.id, format, duration_ms: duration, state: 'GENERATED' } });
      return reply.type('text/html; charset=utf-8').send(html);
    }
    if (format !== 'JSON') return reply.code(422).send({ error: { code: 'FORMAT_UNSUPPORTED', message: 'Formato aceito: JSON ou HTML.', request_id: request.id } });
    await prisma.evidenceBundle.create({ data: { passport_id: passport.id, user_id: request.authUser!.id, format, duration_ms: Date.now() - started, state: 'GENERATED' } });
    return bundle;
  });

  app.get<{ Params: { id: string } }>('/api/v1/passports/:id/verify', async (request, reply) => {
    const passport = await prisma.passport.findFirst({ where: { id: request.params.id, organization_id: request.authUser!.organization_id } });
    if (!passport) return reply.code(404).send({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passaporte não encontrado neste escopo.', request_id: request.id } });
    const calculatedHash = sha256Canonical(passport.content);
    const events = await prisma.custodyEvent.findMany({ where: { stream_id: passport.product_lot_id }, orderBy: { sequence: 'asc' } });
    const integrity = verifyEventChain(events.map((e: Prisma.CustodyEventGetPayload<{}>) => ({ event_id: e.event_id, stream_id: e.stream_id, sequence: e.sequence, entity: e.entity_type, entity_id: e.entity_id, type: e.type, actor_id: e.actor_id, timestamp: e.timestamp.toISOString(), payload: e.payload, previous_hash: e.previous_hash, event_hash: e.event_hash })));
    return { valid: calculatedHash === passport.content_hash && integrity.valid, passport_hash: { expected: passport.content_hash, actual: calculatedHash, valid: calculatedHash === passport.content_hash }, event_chain: integrity, limitation: 'Integridade criptográfica não comprova veracidade, assinatura digital ou retenção externa.' };
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.', request_id: request.id } }));
  return app;
}

async function logAccess(request: FastifyRequest, userId: string | null, allowed: boolean, reason: string) {
  await prisma.accessLog.create({ data: { user_id: userId, action: `${request.method} ${request.url}`, allowed, reason, request_id: request.id } }).catch(() => undefined);
}
