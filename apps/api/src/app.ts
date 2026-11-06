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
import { assessReadiness, containsSimulatedEvidence, latestChecks } from './services/review-readiness.js';
import { Type } from '@sinclair/typebox';
import { PlotCreateSchema, OriginLotCreateSchema, HarvestCreateSchema, ShipmentCreateSchema, ShipmentDispatchSchema, ShipmentReceiveSchema, TransformationCreateSchema, DecisionCreateSchema, PassportCreateSchema, DocumentCreateSchema } from '@foresttrace/contracts';
import { storeDocument, readDocument, removeDocument } from './services/document-storage.js';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerWhispRoutes } from './services/whisp-routes.js';
import { registerImageryRoutes } from './services/inpe-routes.js';
import { registerCorrectionRoutes } from './services/corrections.js';
import { registerForestUtilizationRoutes } from './services/forest-utilization-routes.js';
import { registerPlotReadRoutes } from './modules/plots.js';
import { registerOriginLotReadRoutes } from './modules/origin-lots.js';
import { registerResponseContracts } from './services/response-contracts.js';
import { registerEvidenceDiagnosticRoutes } from './services/evidence-diagnostic.js';
import { registerRegulatoryRoutes, regulatorySummaryForProduct } from './services/regulatory-routes.js';
import { registerDeliveryRoutes } from './services/delivery-routes.js';
import { bindContextualReview, effectiveReviewedChecks } from './services/contextual-review.js';
import { aggregateCheckDimensions } from './services/review-readiness.js';
import { buildEvidenceBundle } from './services/evidence-bundle.js';
import { appendAuditEvent } from './services/audit-events.js';
import { loadProductAncestry, plotGeometrySha } from './services/ancestry.js';
import { verifyStoredPassport } from './services/passport-integrity.js';
import { ancestryDigests } from './services/ancestry-digests.js';
import { canAccessCommercialDocument, canAccessCommercialPassport, changeDocumentGrant } from './services/commercial-access.js';
import { reassessConversionWithException } from './services/conversion-review.js';
import { executeIdempotent, IdempotencyKeyRequired, requireIdempotencyKey } from './services/idempotency.js';
import { assertDistinctLots, debitAvailable, lockBalances, RECEIPT_POLICY } from './services/balances.js';
import { effectiveMembershipRoles } from './auth/memberships.js';

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
async function appendEvent(tx: Prisma.TransactionClient, input: { streamId: string; entityType: string; entityId: string; type: string; actorId: string; payload: unknown }) {
  await appendAuditEvent(tx, input);
}
async function assertNoR19(tx: Prisma.TransactionClient, entityIds: string[]) {
  const ids = [...new Set(entityIds.filter(Boolean))];
  if (!ids.length) return;
  const provenance = await tx.lotProvenance.findMany({ where: { product_lot_id: { in: ids }, origin_lot_id: { not: null } }, select: { origin_lot_id: true } });
  const affectedIds = [...new Set([...ids, ...provenance.flatMap(row => row.origin_lot_id ? [row.origin_lot_id] : [])])];
  const blocking = await tx.auditCase.findFirst({ where: { entity_id: { in: affectedIds }, rule_id: 'R19', status: { in: ['ABERTO', 'EM_ANALISE', 'MANTIDO_PENDENTE'] } }, select: { id: true } });
  if (blocking) throw Object.assign(new Error('A operação está bloqueada por uma retificação pendente (R19).'), { statusCode: 409, code: 'R19' });
}
async function passportContentForUser(passport: any, actor: AuthUser) {
  const content = structuredClone(passport.content) as any;
  const documentIds: string[] = content?.ancestry?.document_ids ?? [];
  const documents = documentIds.length ? await prisma.document.findMany({ where: { id: { in: documentIds } }, select: { id: true, organization_id: true, allowed_organization_ids: true } }) : [];
  const allowed = new Set<string>(documents.filter((document: any) => canAccessCommercialDocument({ ownerOrganizationId: document.organization_id, requesterOrganizationId: actor.organization_id, requesterRoles: actor.roles, grantedOrganizationIds: document.allowed_organization_ids })).map((document: any) => document.id));
  const withheld = documentIds.filter((id) => !allowed.has(id)).length;
  if (content?.ancestry) {
    content.ancestry.document_ids = documentIds.filter((id) => allowed.has(id));
    content.ancestry.document_digests = (content.ancestry.document_digests ?? []).filter((digest: any) => allowed.has(digest.id));
    content.ancestry.entity_digests = (content.ancestry.entity_digests ?? []).filter((digest: any) => digest.type !== 'DOCUMENT' || allowed.has(digest.id));
  }
  return { content, content_hash: sha256Canonical(content), snapshot_content_hash: passport.content_hash, allowed_document_ids: [...allowed], withheld_document_count: withheld };
}
type AuthUser = { id: string; organization_id: string; roles: string[] };
declare module 'fastify' { interface FastifyRequest { authUser?: AuthUser; csrfToken?: string; idempotencyKey?: string } }

function setError(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    request.log.error({ err: error, request_id: request.id }, 'request failed');
    const err = error as Error;
    void prisma.accessLog.create({ data: { action: 'REQUEST_ERROR', allowed: false, reason: status === 500 ? 'INTERNAL_ERROR' : err.message, request_id: request.id } }).catch(() => undefined);
    const code = (error as { code?: string }).code;
    reply.code(status === 400 ? 422 : status >= 400 && status < 500 ? status : 500).send({ error: { code: status >= 500 ? 'INTERNAL_ERROR' : code ?? (status === 400 ? 'VALIDATION_ERROR' : 'REQUEST_REJECTED'), message: status < 500 ? err.message : 'Erro interno.', request_id: request.id } });
  });
}

export async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({ logger: {
    redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers.x-csrf-token'],
    serializers: { req: (request: FastifyRequest) => ({ method: request.method, url: request.url.split('?')[0] }) },
  }, bodyLimit: 15_000_000, genReqId: () => randomBytes(12).toString('hex') });
  setError(app);
  await app.register(cookie);
  const allowedOrigins = [...new Set([
    ...(process.env.WEB_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(v => v.trim()).filter(Boolean),
    new URL(process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`).origin,
  ])];
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || allowedOrigins.includes(origin)), credentials: true });
  await app.register(swagger, { openapi: { info: { title: 'ForestTrace API', version: '1.0.0', description: 'Trilha demonstrativa de evidências; não certifica legalidade.' }, servers: [{ url: '/' }] } });
  await app.register(swaggerUi, { routePrefix: '/docs' });
  registerResponseContracts(app);
  app.get('/openapi.json', async () => app.swagger());

  app.get('/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT PostGIS_Version()`;
      return { status: 'ok', service: 'foresttrace-api', database: 'ok', postgis: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable', service: 'foresttrace-api', database: 'unavailable' });
    }
  });
  app.get('/api/v1/auth/personas', async (_request, reply) => {
    if (process.env.DEMO_MODE !== 'true') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.', request_id: reply.request.id } });
    const users = await prisma.user.findMany({ select: { id: true, name: true, organization_id: true, roles: true, organization: { select: { id: true, name: true, role: true, state: true } } }, orderBy: { name: 'asc' } });
    const memberships = await prisma.membership.findMany({ where: { user_id: { in: users.map(user => user.id) } } });
    return { personas: users.map(user => ({ id: user.id, name: user.name, roles: effectiveMembershipRoles(user, memberships), organization: user.organization })).filter(user => user.roles.length > 0) };
  });
  app.post<{ Body: { user_id: string } }>('/api/v1/auth/session', { schema: { body: Type.Object({ user_id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    if (process.env.DEMO_MODE !== 'true') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.', request_id: request.id } });
    if (request.headers.origin && !allowedOrigins.includes(request.headers.origin)) {
      await logAccess(request, null, false, 'ORIGIN_INVALID');
      return reply.code(403).send({ error: { code: 'CSRF_INVALID', message: 'Origem não autorizada.', request_id: request.id } });
    }
    const user = await prisma.user.findUnique({ where: { id: request.body?.user_id }, include: { organization: true } });
    if (!user) return reply.code(404).send({ error: { code: 'PERSONA_NOT_FOUND', message: 'Perfil de demonstração não encontrado.', request_id: request.id } });
    const memberships = await prisma.membership.findMany({ where: { user_id: user.id, organization_id: user.organization_id } });
    const effectiveRoles = effectiveMembershipRoles(user, memberships);
    if (!effectiveRoles.length) {
      await logAccess(request, user.id, false, 'MEMBERSHIP_REQUIRED');
      return reply.code(403).send({ error: { code: 'MEMBERSHIP_REQUIRED', message: 'Vínculo ativo com a organização necessário.', request_id: request.id } });
    }
    const token = randomBytes(32).toString('base64url'); const csrf = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await prisma.session.create({ data: { token_hash: sha(token), csrf_hash: sha(csrf), user_id: user.id, expires_at: expires } });
    reply.setCookie('foresttrace_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires });
    reply.setCookie('foresttrace_csrf', csrf, { httpOnly: false, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', expires });
    return { user: { id: user.id, name: user.name, roles: effectiveRoles, organization: { id: user.organization.id, name: user.organization.name } }, csrf_token: csrf, expires_at: expires.toISOString() };
  });
  app.delete('/api/v1/auth/session', async (request, reply) => {
    const raw = request.cookies.foresttrace_session;
    if (raw) await prisma.session.deleteMany({ where: { token_hash: sha(raw) } });
    reply.clearCookie('foresttrace_session', { path: '/' }).clearCookie('foresttrace_csrf', { path: '/' });
    return { ok: true };
  });

  app.addHook('preHandler', async (request: FastifyRequest, reply) => {
    const path = request.url.split('?')[0]!;
    if (!path.startsWith('/api/v1/') || (path.startsWith('/api/v1/public/passports/') && request.method === 'GET') || (path === '/api/v1/auth/personas' && request.method === 'GET') || (path === '/api/v1/auth/session' && request.method === 'POST')) return;
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
    const memberships = await prisma.membership.findMany({ where: { user_id: session.user.id, organization_id: session.user.organization_id } });
    const effectiveRoles = effectiveMembershipRoles(session.user, memberships);
    // Revoked memberships stop existing sessions immediately, while allowing secure logout.
    if (!effectiveRoles.length && !(path === '/api/v1/auth/session' && request.method === 'DELETE')) {
      await logAccess(request, session.user_id, false, 'MEMBERSHIP_REQUIRED');
      return reply.code(403).send({ error: { code: 'MEMBERSHIP_REQUIRED', message: 'Vínculo ativo com a organização necessário.', request_id: request.id } });
    }
    request.authUser = { id: session.user.id, organization_id: session.user.organization_id, roles: effectiveRoles };
    request.csrfToken = csrfHeader;
    const grantMutation = ['POST', 'DELETE'].includes(request.method) && /^\/api\/v1\/(documents|passports)\/[^/]+\/grants(?:\/[^/]+)?$/.test(path);
    if (request.method === 'POST' || grantMutation) {
      try { request.idempotencyKey = requireIdempotencyKey(request.headers['idempotency-key']); }
      catch (error) {
        if (error instanceof IdempotencyKeyRequired) return reply.code(422).send({ error: { code: error.code, message: error.message, request_id: request.id } });
        throw error;
      }
    }
    if (grantMutation || request.method === 'POST' && !path.startsWith('/api/v1/audit-cases/')) {
      const imageryOperation = path.startsWith('/api/v1/imagery/') || /^\/api\/v1\/plots\/[^/]+\/imagery(?:\/|\-)/.test(path);
      const roles = path.startsWith('/api/v1/regulatory/') || imageryOperation ? ['OPERATOR', 'AUDITOR', 'REGULATOR'] : path === '/api/v1/documents' || path === '/api/v1/conversion-exceptions' || path === '/api/v1/calculations/forest-utilization' || grantMutation ? ['OPERATOR', 'AUDITOR'] : ['OPERATOR'];
      if (!effectiveRoles.some(role => roles.includes(role))) {
        await logAccess(request, session.user_id, false, 'ROLE_REQUIRED');
        return reply.code(403).send({ error: { code: 'ROLE_REQUIRED', message: 'Perfil sem permissão para esta operação.', request_id: request.id } });
      }
    }
  });

  app.get('/api/v1/dashboard', async (request, reply) => {
    const current = request.authUser!;
    const session = await prisma.user.findUnique({ where: { id: current.id }, include: { organization: true } });
    if (!session) return reply.code(401).send({ error: { code: 'SESSION_INVALID', message: 'Sessão inválida ou expirada.', request_id: request.id } });
    const orgId = current.organization_id;
    const balances = await prisma.balance.findMany({ where: { organization_id: orgId } });
    const heldLotIds = balances.map(b => b.lot_id);
    const [lots, shipments, products, cases, passports, plots, transformations, checks, organizations, parameters, documents] = await Promise.all([
      prisma.originLot.findMany({ where: { OR: [{ organization_id: orgId }, { id: { in: heldLotIds } }] }, include: { plot: true }, orderBy: { created_at: 'desc' } }),
      prisma.shipment.findMany({ where: { OR: [{ sender_id: orgId }, { recipient_id: orgId }] }, include: { items: true }, orderBy: { created_at: 'desc' } }),
      prisma.productLot.findMany({ where: { organization_id: orgId }, orderBy: { created_at: 'desc' } }),
      prisma.auditCase.findMany({ where: { organization_id: orgId }, include: { decisions: true }, orderBy: { opened_at: 'desc' } }),
      prisma.passport.findMany({ where: { organization_id: orgId }, select: { id: true, product_lot_id: true, version: true, assessment_scope: true, created_at: true } }),
      prisma.plot.findMany({ where: { organization_id: orgId }, orderBy: { created_at: 'desc' } }),
      prisma.transformation.findMany({ where: { organization_id: orgId }, include: { inputs: true, outputs: true }, orderBy: { created_at: 'desc' } }),
      prisma.check.findMany({ where: { organization_id: orgId }, orderBy: { created_at: 'desc' } }),
      prisma.organization.findMany({ select: { id: true, name: true, role: true, state: true, municipality: true }, orderBy: { name: 'asc' } }),
      prisma.conversionParameter.findMany({ orderBy: { valid_from: 'desc' } }),
      prisma.document.findMany({ where: { organization_id: orgId }, select: { id: true, name: true, type: true, content_hash: true, data_provenance: true, visibility: true, created_at: true }, orderBy: { created_at: 'desc' } }),
    ]);
    return { user: { id: session.id, name: session.name, roles: current.roles, organization: { id: orgId, name: session.organization.name, state: session.organization.state } }, organizations, plots, origin_lots: lots.map(lot => ({ ...lot, available_m3: balances.find(b => b.lot_id === lot.id)?.available_m3 ?? '0' })), balances, conversion_parameters: parameters, documents, harvests: await prisma.harvest.findMany({ where: { organization_id: orgId }, orderBy: { created_at: 'desc' } }), shipments, transformations, product_lots: products, checks, audit_cases: cases, passports, metrics: { plot_count: plots.length, origin_lot_count: lots.length, shipment_count: shipments.length, transformation_count: transformations.length, open_alert_count: cases.filter(c => ['ABERTO', 'EM_ANALISE', 'MANTIDO_PENDENTE'].includes(c.status)).length }, limitations: ['Dados demonstrativos são sintéticos e permanecem MISSING_EVIDENCE.'] };
  });

  app.post<{ Body: { name: string; type: string; content_base64: string; source: string; data_provenance: string; visibility: string; fiscal_key?: string } }>('/api/v1/documents', { schema: { body: DocumentCreateSchema } }, async (request, reply) => {
    const body = request.body;
    if (!body.content_base64 || body.content_base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.content_base64)) return reply.code(422).send({ error: { code: 'INVALID_DOCUMENT_CONTENT', message: 'Informe um arquivo não vazio em base64 válido.', request_id: request.id } });
    const bytes = Buffer.from(body.content_base64, 'base64');
    if (bytes.length > 10_000_000) return reply.code(422).send({ error: { code: 'DOCUMENT_TOO_LARGE', message: 'O arquivo deve ter no máximo 10 MB.', request_id: request.id } });
    let storedKey: string | undefined;
    try {
      const result = await executeIdempotent(prisma, { actorId: request.authUser!.id, operation: 'POST /api/v1/documents', key: request.idempotencyKey!, payload: body }, async tx => {
        const key = `${randomUUID()}.bin`;
        await storeDocument(key, bytes); storedKey = key;
        const document = await tx.document.create({ data: { organization_id: request.authUser!.organization_id, name: body.name, type: body.type, source: body.source, data_provenance: body.data_provenance, visibility: body.visibility, fiscal_key: body.fiscal_key, content_hash: createHash('sha256').update(bytes).digest('hex'), storage_key: key, content_type: 'application/octet-stream', allowed_organization_ids: [], created_by_user_id: request.authUser!.id } });
        await appendAuditEvent(tx, { streamId: document.id, entityType: 'DOCUMENT', entityId: document.id, type: 'DOCUMENT_STORED', actorId: request.authUser!.id, payload: { content_hash: document.content_hash, version: document.version } });
        const { storage_key: _key, ...metadata } = document;
        return { statusCode: 201, body: { document: metadata } };
      });
      return reply.code(result.statusCode).send(result.body);
    } catch (error) {
      if (storedKey) await removeDocument(storedKey).catch(() => undefined);
      if ((error as { code?: string }).code === 'P2002') return reply.code(409).send({ error: { code: 'R17', message: 'Documento fiscal já registrado.', request_id: request.id } });
      throw error;
    }
  });

  app.get<{ Params: { id: string } }>('/api/v1/documents/:id/download', { schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const document = await prisma.document.findUnique({ where: { id: request.params.id } });
    if (!document || !canAccessCommercialDocument({ ownerOrganizationId: document.organization_id, requesterOrganizationId: request.authUser!.organization_id, requesterRoles: request.authUser!.roles, grantedOrganizationIds: document.allowed_organization_ids })) {
      await logAccess(request, request.authUser!.id, false, 'DOCUMENT_GRANT_REQUIRED');
      return reply.code(404).send({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Documento não encontrado neste escopo.', request_id: request.id } });
    }
    let bytes: Buffer;
    try { bytes = await readDocument(document.storage_key); }
    catch { return reply.code(404).send({ error: { code: 'DOCUMENT_UNAVAILABLE', message: 'Conteúdo documental indisponível.', request_id: request.id } }); }
    if (createHash('sha256').update(bytes).digest('hex') !== document.content_hash) return reply.code(409).send({ error: { code: 'R18', message: 'O conteúdo do documento diverge do hash registrado.', request_id: request.id } });
    return reply.type('application/octet-stream').header('X-Content-Type-Options', 'nosniff').header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`).send(bytes);
  });

  app.post<{ Params: { id: string }; Body: { organization_id: string } }>('/api/v1/documents/:id/grants', { schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }) }), body: Type.Object({ organization_id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const actor = request.authUser!;
    const document = await prisma.document.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id } });
    if (!document) return reply.code(404).send({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Documento não encontrado na organização proprietária.', request_id: request.id } });
    const recipient = await prisma.organization.findUnique({ where: { id: request.body.organization_id } });
    if (!recipient) return reply.code(404).send({ error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Organização destinatária não encontrada.', request_id: request.id } });
    const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/documents/:id/grants', key: request.idempotencyKey!, payload: { params: request.params, body: request.body } }, async tx => {
      const current = await tx.document.findUniqueOrThrow({ where: { id: document.id } });
      const updated = await tx.document.update({ where: { id: document.id }, data: { allowed_organization_ids: changeDocumentGrant(current.allowed_organization_ids, recipient.id, 'grant') } });
      await tx.accessLog.create({ data: { user_id: actor.id, action: 'DOCUMENT_GRANT_CREATED', entity_id: updated.id, allowed: true, reason: `GRANT:${recipient.id}`, request_id: request.id } });
      return { statusCode: 201, body: { document_id: updated.id, organization_id: recipient.id, granted: true } };
    });
    return reply.code(result.statusCode).send(result.body);
  });

  app.delete<{ Params: { id: string; organization_id: string } }>('/api/v1/documents/:id/grants/:organization_id', { schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }), organization_id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const actor = request.authUser!;
    const document = await prisma.document.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id } });
    if (!document) return reply.code(404).send({ error: { code: 'DOCUMENT_NOT_FOUND', message: 'Documento não encontrado na organização proprietária.', request_id: request.id } });
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'DELETE /api/v1/documents/:id/grants/:organization_id', key, payload: { params: request.params } }, async tx => {
      const current = await tx.document.findUniqueOrThrow({ where: { id: document.id } });
      await tx.document.update({ where: { id: document.id }, data: { allowed_organization_ids: changeDocumentGrant(current.allowed_organization_ids, request.params.organization_id, 'revoke') } });
      await tx.accessLog.create({ data: { user_id: actor.id, action: 'DOCUMENT_GRANT_REVOKED', entity_id: document.id, allowed: true, reason: `REVOKE:${request.params.organization_id}`, request_id: request.id } });
      return { statusCode: 200, body: { document_id: document.id, organization_id: request.params.organization_id, granted: false } };
    });
    return reply.code(result.statusCode).send(result.body);
  });

  app.post<{ Body: { conversion_parameter_id: string; document_id: string; coefficient: string; product: string; species_scientific: string; issuing_authority: string; approval_reference: string; valid_from: string; valid_until: string; data_provenance: string } }>('/api/v1/conversion-exceptions', { schema: { body: Type.Object({ conversion_parameter_id: Type.String({ format: 'uuid' }), document_id: Type.String({ format: 'uuid' }), coefficient: Type.String({ pattern: '^(0|[1-9][0-9]*)(\\.[0-9]{1,9})?$' }), product: Type.String({ minLength: 1 }), species_scientific: Type.String({ minLength: 1 }), issuing_authority: Type.String({ minLength: 1 }), approval_reference: Type.String({ minLength: 1 }), valid_from: Type.String({ format: 'date' }), valid_until: Type.String({ format: 'date' }), data_provenance: Type.String({ minLength: 1 }) }, { additionalProperties: false }) } }, async (request, reply) => {
    const actor = request.authUser!; const body = request.body;
    try {
      const coefficient = new Decimal(body.coefficient);
      if (!coefficient.isFinite() || coefficient.lte(0) || coefficient.gt(1)) return reply.code(422).send({ error: { code: 'CONVERSION_EXCEPTION_SCOPE_INVALID', message: 'Coeficiente deve ser maior que zero e no máximo um.', request_id: request.id } });
      const result = await executeIdempotent<unknown>(prisma, { actorId: actor.id, operation: 'POST /api/v1/conversion-exceptions', key: request.idempotencyKey!, payload: body }, async tx => {
        const [parameter, document] = await Promise.all([
          tx.conversionParameter.findUnique({ where: { id: body.conversion_parameter_id } }),
          tx.document.findFirst({ where: { id: body.document_id, organization_id: actor.organization_id } }),
        ]);
        if (!parameter || !document) return { statusCode: 404, body: { error: { code: 'APPROVAL_EVIDENCE_NOT_FOUND', message: 'Parâmetro ou documento de aprovação não encontrado no escopo.', request_id: request.id } } };
        if (!['CRV_APPROVAL', 'CONVERSION_EXCEPTION'].includes(document.type)) return { statusCode: 422, body: { error: { code: 'APPROVAL_DOCUMENT_TYPE_REQUIRED', message: 'Use documento de tipo CRV_APPROVAL ou CONVERSION_EXCEPTION.', request_id: request.id } } };
        const bytes = await readDocument(document.storage_key).catch(() => null);
        if (!bytes || createHash('sha256').update(bytes).digest('hex') !== document.content_hash) return { statusCode: 422, body: { error: { code: 'APPROVAL_DOCUMENT_INVALID', message: 'Documento de aprovação ausente ou hash divergente.', request_id: request.id } } };
        if (!body.product.trim() || !body.species_scientific.trim() || !body.issuing_authority.trim() || !body.approval_reference.trim() || body.product !== parameter.output_product || body.valid_until < body.valid_from || !Number.isFinite(Number(body.coefficient)) || Number(body.coefficient) <= 0) return { statusCode: 422, body: { error: { code: 'CONVERSION_EXCEPTION_SCOPE_INVALID', message: 'Produto, espécie, autoridade, aprovação, coeficiente ou vigência da exceção não correspondem ao parâmetro.', request_id: request.id } } };
        const exception = await tx.conversionException.create({ data: { organization_id: actor.organization_id, conversion_parameter_id: parameter.id, document_id: document.id, coefficient: body.coefficient, product: body.product, species_scientific: body.species_scientific.trim(), issuing_authority: body.issuing_authority.trim(), approval_reference: body.approval_reference.trim(), valid_from: new Date(body.valid_from), valid_until: new Date(body.valid_until), data_provenance: body.data_provenance, created_by_user_id: actor.id } });
        return { statusCode: 201, body: { conversion_exception: exception } };
      });
      return reply.code(result.statusCode).send(result.body);
    } catch (error) { const e = error as Error & { code?: string; statusCode?: number }; return reply.code(e.statusCode ?? (e.code === 'R17' ? 409 : 500)).send({ error: { code: e.code ?? 'CONVERSION_EXCEPTION_FAILED', message: e.message, request_id: request.id } }); }
  });

  app.post<{ Params: { id: string }; Body: { organization_id: string } }>('/api/v1/passports/:id/grants', { schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }) }), body: Type.Object({ organization_id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const actor = request.authUser!;
    const passport = await prisma.passport.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id } });
    if (!passport) return reply.code(404).send({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passaporte não encontrado na organização proprietária.', request_id: request.id } });
    const recipient = await prisma.organization.findUnique({ where: { id: request.body.organization_id } });
    if (!recipient) return reply.code(404).send({ error: { code: 'ORGANIZATION_NOT_FOUND', message: 'Organização destinatária não encontrada.', request_id: request.id } });
    const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/passports/:id/grants', key: request.idempotencyKey!, payload: { params: request.params, body: request.body } }, async tx => {
      const current = await tx.passport.findUniqueOrThrow({ where: { id: passport.id } });
      const updated = await tx.passport.update({ where: { id: passport.id }, data: { allowed_organization_ids: changeDocumentGrant(current.allowed_organization_ids, recipient.id, 'grant') } });
      await tx.accessLog.create({ data: { user_id: actor.id, action: 'PASSPORT_GRANT_CREATED', entity_id: updated.id, allowed: true, reason: `GRANT:${recipient.id}`, request_id: request.id } });
      return { statusCode: 201, body: { passport_id: updated.id, organization_id: recipient.id, granted: true } };
    });
    return reply.code(result.statusCode).send(result.body);
  });

  app.delete<{ Params: { id: string; organization_id: string } }>('/api/v1/passports/:id/grants/:organization_id', { schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }), organization_id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const actor = request.authUser!;
    const passport = await prisma.passport.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id } });
    if (!passport) return reply.code(404).send({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passaporte não encontrado na organização proprietária.', request_id: request.id } });
    const key = requireIdempotencyKey(request.headers['idempotency-key']);
    const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'DELETE /api/v1/passports/:id/grants/:organization_id', key, payload: { params: request.params } }, async tx => {
      const current = await tx.passport.findUniqueOrThrow({ where: { id: passport.id } });
      await tx.passport.update({ where: { id: passport.id }, data: { allowed_organization_ids: changeDocumentGrant(current.allowed_organization_ids, request.params.organization_id, 'revoke') } });
      await tx.accessLog.create({ data: { user_id: actor.id, action: 'PASSPORT_GRANT_REVOKED', entity_id: passport.id, allowed: true, reason: `REVOKE:${request.params.organization_id}`, request_id: request.id } });
      return { statusCode: 200, body: { passport_id: passport.id, organization_id: request.params.organization_id, granted: false } };
    });
    return reply.code(result.statusCode).send(result.body);
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/plots', { schema: { body: PlotCreateSchema } }, async (request, reply) => {
    const body = request.body; const actor = request.authUser!;
    if (body.organization_id !== actor.organization_id) return reply.code(403).send({ error: { code: 'R20', message: 'A parcela deve pertencer à organização autenticada.', request_id: request.id } });
    const geo = body.geometry as { type?: string; coordinates?: unknown };
    if (!geo || typeof body.state !== 'string' || !Array.isArray(geo.coordinates)) {
      return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Informe parcela, UF, município, imóvel e polígono GeoJSON.', fields: ['geometry', 'state'], request_id: request.id } });
    }
    const validation = validateGeometry(geo);
    if (!validation.valid) return reply.code(422).send({ error: { code: 'INVALID_GEOJSON', message: validation.errors[0] ?? 'Geometria inválida.', fields: ['geometry'], request_id: request.id }, checks: [{ rule_id: 'R01', status: 'ALERTA', errors: validation.errors }] });
    const geom = geo; const serialized = JSON.stringify(geom); const hash = sha256Canonical(geom);
    const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/plots', key: request.idempotencyKey!, payload: body }, async tx => {
      const spatial = await tx.$queryRaw<Array<{ valid: boolean; area: number }>>`SELECT ST_IsValid(g) AS valid, ST_Area(g::geography)/10000 AS area FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${serialized}),4326) AS g) q`;
      if (!spatial[0]?.valid) throw Object.assign(new Error('O polígono é topologicamente inválido.'), { statusCode: 422, code: 'INVALID_GEOJSON' });
      const plot = await tx.plot.create({ data: {
        organization_id: actor.organization_id, state: String(body.state).toUpperCase(), municipality: String(body.municipality ?? ''), declared_property: String(body.declared_property ?? ''),
        geometry: geom as object, geometry_hash: hash, geometry_version: Number(body.geometry_version ?? 1), geometry_date: body.geometry_date ? new Date(String(body.geometry_date)) : new Date(), area_ha: spatial[0]?.area ?? 0,
        data_provenance: body.data_provenance ?? { label: 'DECLARACAO_DO_USUARIO', source: 'operador autenticado' }, created_by_user_id: actor.id,
      } });
      return { statusCode: 201, body: { plot, checks: [{ rule_id: 'R01', status: 'PASSOU', message: 'Polígono aceito estruturalmente; topologia deve ser conferida.' }] } };
    });
    return reply.code(result.statusCode).send(result.body);
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/origin-lots', { schema: { body: OriginLotCreateSchema } }, async (request, reply) => {
    const b = request.body; const actor = request.authUser!;
    const required = ['plot_id', 'code', 'species_common_name', 'species_scientific_name', 'authorized_volume_m3', 'valid_from', 'valid_until', 'right_of_use', 'permit_reference', 'permit_document_id'];
    const missing = required.filter(k => b[k] === undefined || b[k] === '');
    if (missing.length || !Number.isFinite(Number(b.authorized_volume_m3)) || Number(b.authorized_volume_m3) <= 0) return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Campos obrigatórios ausentes ou volume inválido.', fields: missing, request_id: request.id } });
    const plot = await prisma.plot.findFirst({ where: { id: String(b.plot_id), organization_id: actor.organization_id } });
    if (!plot) return reply.code(404).send({ error: { code: 'PLOT_NOT_FOUND', message: 'Parcela não encontrada nesta organização.', request_id: request.id } });
    const document = await prisma.document.findFirst({ where: { id: String(b.permit_document_id), organization_id: actor.organization_id } });
    if (!document) return reply.code(422).send({ error: { code: 'EVIDENCE_NOT_ACCESSIBLE', message: 'Documento de autorização não disponível nesta organização.', request_id: request.id } });
    try {
      const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/origin-lots', key: request.idempotencyKey!, payload: b }, async tx => {
        const created = await tx.originLot.create({ data: { organization_id: actor.organization_id, plot_id: plot.id, code: String(b.code), species_common: String(b.species_common_name), species_scientific: String(b.species_scientific_name), authorized_volume_m3: String(b.authorized_volume_m3), valid_from: new Date(String(b.valid_from)), valid_until: new Date(String(b.valid_until)), right_of_use: String(b.right_of_use), data_provenance: b.data_provenance ?? { label: 'SIMULADA', source: 'demo' }, assessment_scope: String(b.assessment_scope ?? 'DEMONSTRATIVO'), created_by_user_id: actor.id } });
        await tx.permit.create({ data: { origin_lot_id: created.id, reference: String(b.permit_reference), issuing_authority: 'DECLARADO_PELO_OPERADOR', official_system: 'NAO_VERIFICADO', document_id: String(b.permit_document_id), valid_from: new Date(String(b.valid_from)), valid_until: new Date(String(b.valid_until)), volume_m3: String(b.authorized_volume_m3), data_provenance: b.data_provenance ?? { label: 'SIMULADA', source: 'demo' } } });
        await tx.balance.create({ data: { lot_id: created.id, organization_id: actor.organization_id, available_m3: 0 } });
        await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: 'ORIGIN_LOT', entity_id: created.id, rule_id: 'R01', rule_version: '1', name: 'Geometria da parcela', description: 'Geometria associada ao lote de origem.', source: { type: 'USER_DECLARATION' }, modality: 'DEMONSTRATIVO', dimension: 'geospatial_check', status: 'PENDENTE', technical_severity: 'INFO', message: 'Cadastro não confirma propriedade ou autorização.', suggested_action: 'Conferir documentos e requisitos aplicáveis.', values: { plot_id: plot.id, geometry_hash: plot.geometry_hash }, assessment_scope: created.assessment_scope } });
        return { statusCode: 201, body: { origin_lot: created, plot: { id: plot.id, geometry_hash: plot.geometry_hash }, balance: { available_m3: '0' } } };
      });
      return reply.code(result.statusCode).send(result.body);
    } catch (e) { const code = (e as { code?: string }).code; if (code === 'R17') return reply.code(409).send({ error: { code: 'R17', message: (e as Error).message, request_id: request.id } }); if (code === 'P2002') return reply.code(409).send({ error: { code: 'DUPLICATE_LOT_CODE', message: 'Código de lote já utilizado.', request_id: request.id } }); throw e; }
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/harvests', { schema: { body: HarvestCreateSchema } }, async (request, reply) => {
    const b = request.body; const actor = request.authUser!; let volume: Decimal;
    try { volume = new Decimal(String(b.volume_m3)); } catch { return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Volume decimal inválido.', request_id: request.id } }); }
    if (!b.origin_lot_id || !volume.isFinite() || volume.lte(0) || !b.start_date || !b.end_date) return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Informe lote, período e volume positivo.', request_id: request.id } });
    if (String(b.start_date) > String(b.end_date)) return reply.code(422).send({ error: { code: 'R06', message: 'O fim do corte deve ser posterior ou igual ao início.', request_id: request.id } });
    const hash = sha256Canonical(b);
    const lot = await prisma.originLot.findFirst({ where: { id: String(b.origin_lot_id), organization_id: actor.organization_id }, include: { permits: true } });
    if (!lot) return reply.code(404).send({ error: { code: 'LOT_NOT_FOUND', message: 'Lote não encontrado nesta organização.', request_id: request.id } });
    const result = await executeIdempotent<unknown>(prisma, { actorId: actor.id, operation: 'POST /api/v1/harvests', key: request.idempotencyKey!, payload: b }, async tx => {
      const current = await tx.originLot.findUniqueOrThrow({ where: { id: lot.id }, include: { permits: true } });
      await assertNoR19(tx, [current.id]);
      const outsideValidity = String(b.start_date) < current.valid_from.toISOString().slice(0, 10) || String(b.end_date) > current.valid_until.toISOString().slice(0, 10)
        || !current.permits.some(permit => String(b.start_date) >= permit.valid_from.toISOString().slice(0, 10) && String(b.end_date) <= permit.valid_until.toISOString().slice(0, 10));
      if (outsideValidity) {
        const pending = await tx.pendingOperationRequest.create({ data: { organization_id: actor.organization_id, operation: 'HARVEST_OUTSIDE_AUTHORIZATION_PERIOD', payload: b as object, payload_hash: hash, created_by_user_id: actor.id } });
        const check = await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: 'ORIGIN_LOT', entity_id: lot.id, rule_id: 'R04', rule_version: '1', name: 'Vigência da autorização', description: 'Corte fora da vigência informada ou sem autorização vinculada.', source: { type: 'PERMIT_DECLARATION' }, modality: 'DEMONSTRATIVO', dimension: 'documentary_check', status: 'ALERTA', technical_severity: 'HIGH', message: 'O período do corte não está coberto pela autorização vinculada.', suggested_action: 'Conferir período e autorização antes de confirmar o corte.', values: { start_date: String(b.start_date), end_date: String(b.end_date) }, assessment_scope: current.assessment_scope } });
        await tx.auditCase.create({ data: { organization_id: actor.organization_id, check_id: check.id, entity_type: 'ORIGIN_LOT', entity_id: lot.id, created_by_user_id: actor.id, rule_id: 'R04' } });
        return { statusCode: 202, body: { status: 'PENDENTE_REVISAO', pending_operation: pending, check: 'R04' } };
      }
      const remaining = new Decimal(current.authorized_volume_m3.toString()).minus(current.harvested_volume_m3.toString());
      if (volume.gt(remaining)) {
        const pending = await tx.pendingOperationRequest.create({ data: { organization_id: actor.organization_id, operation: 'HARVEST_OVER_AUTHORIZATION', payload: b as object, payload_hash: hash, created_by_user_id: actor.id } });
        const check = await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: 'ORIGIN_LOT', entity_id: lot.id, rule_id: 'R07', rule_version: '1', name: 'Corte acima do saldo autorizado', description: 'Tentativa preservada como declaração pendente.', source: { type: 'DECLARATION' }, modality: 'DEMONSTRATIVO', dimension: 'volume_check', status: 'ALERTA', technical_severity: 'HIGH', message: 'O volume excede o saldo autorizado remanescente.', suggested_action: 'Conferir autorização ou corrigir a declaração com evidência competente.', values: { requested_m3: volume.toFixed(), remaining_m3: remaining.toFixed() }, assessment_scope: lot.assessment_scope } });
        const auditCase = await tx.auditCase.create({ data: { organization_id: actor.organization_id, check_id: check.id, entity_type: 'ORIGIN_LOT', entity_id: lot.id, created_by_user_id: actor.id, rule_id: 'R07' } });
        await tx.pendingOperationRequest.update({ where: { id: pending.id }, data: { payload: { ...(b as object), audit_case_id: auditCase.id } } });
        return { statusCode: 202, body: { status: 'PENDENTE_REVISAO', pending_operation: pending, check: 'R07', authorized_remaining_m3: remaining.toFixed() } };
      }
      const harvest = await tx.harvest.create({ data: { organization_id: actor.organization_id, origin_lot_id: lot.id, species: String(b.species_common_name ?? lot.species_common), volume_m3: volume.toFixed(), period_start: new Date(String(b.start_date)), period_end: new Date(String(b.end_date)), tag: String(b.tag ?? 'SIMULADA'), document_ids: Array.isArray(b.document_ids) ? b.document_ids.map(String) : [], created_by_user_id: actor.id } });
      await tx.originLot.update({ where: { id: lot.id }, data: { harvested_volume_m3: { increment: volume.toFixed() } } });
      await tx.balance.upsert({ where: { lot_id_organization_id: { lot_id: lot.id, organization_id: actor.organization_id } }, create: { lot_id: lot.id, organization_id: actor.organization_id, available_m3: volume.toFixed() }, update: { available_m3: { increment: volume.toFixed() } } });
      await tx.balanceMovement.create({ data: { lot_id: lot.id, organization_id: actor.organization_id, entity_type: 'HARVEST', entity_id: harvest.id, action: 'CREDIT', volume_m3: volume.toFixed() } });
      await appendEvent(tx, { streamId: lot.id, entityType: 'ORIGIN_LOT', entityId: lot.id, type: 'HARVEST_RECORDED', actorId: actor.id, payload: { harvest_id: harvest.id, volume_m3: volume.toFixed(), period_start: b.start_date, period_end: b.end_date } });
      return { statusCode: 201, body: { harvest, status: 'CONFIRMADO' } };
    });
    return reply.code(result.statusCode).send(result.body);
  });

  await registerWhispRoutes(app);
  await registerImageryRoutes(app);

  app.post<{ Body: Record<string, unknown> }>('/api/v1/shipments', { schema: { body: ShipmentCreateSchema } }, async (request, reply) => {
    const actor = request.authUser!; const b = request.body;
    if (String(b.sender_organization_id) !== actor.organization_id || !Array.isArray(b.items) || !b.items.length) return reply.code(403).send({ error: { code: 'ORGANIZATION_SCOPE_DENIED', message: 'Remessa deve ser criada pelo remetente autenticado.', request_id: request.id } });
    try {
      const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/shipments', key: request.idempotencyKey!, payload: b }, async tx => {
        assertDistinctLots(b.items as Array<{ lot_id: string }>);
        await lockBalances(tx, actor.organization_id, (b.items as Array<{ lot_id: string }>).map(item => item.lot_id));
        const items: Array<{ lot_id: string; volume_m3: string }> = [];
        for (const raw of b.items as Array<Record<string, unknown>>) {
          const vol = new Decimal(String(raw.volume_m3));
          if (!vol.isFinite() || vol.lte(0)) throw Object.assign(new Error('Volume inválido.'), { code: 'VOLUME_INVALID' });
          await assertNoR19(tx, [String(raw.lot_id)]);
          await debitAvailable(tx, actor.organization_id, String(raw.lot_id), vol.toFixed(), true);
          items.push({ lot_id: String(raw.lot_id), volume_m3: vol.toFixed() });
        }
        const shipment = await tx.shipment.create({ data: { sender_id: actor.organization_id, recipient_id: String(b.recipient_organization_id), carrier: String(b.transporter), origin_state: String(b.origin_state), destination_state: String(b.destination_state), route_states: Array.isArray(b.route_states) ? b.route_states.map(String) : [], official_system: String(b.official_system), document_ids: Array.isArray(b.document_ids) ? b.document_ids.map(String) : [], declared_at: new Date(), created_by_user_id: actor.id, items: { create: items } }, include: { items: true } });
        for (const item of items) await tx.balanceMovement.create({ data: { lot_id: item.lot_id, organization_id: actor.organization_id, entity_type: 'SHIPMENT', entity_id: shipment.id, action: 'RESERVE', volume_m3: item.volume_m3 } });
        await appendEvent(tx, { streamId: shipment.id, entityType: 'SHIPMENT', entityId: shipment.id, type: 'SHIPMENT_CREATED', actorId: actor.id, payload: { sender_id: shipment.sender_id, recipient_id: shipment.recipient_id, items } });
        return { statusCode: 201, body: { shipment } };
      });
      return reply.code(result.statusCode).send(result.body);
    } catch (error) { const e = error as Error & { code?: string; statusCode?: number }; if (e.code === 'R17') throw e; return reply.code(e.statusCode ?? (e.code === 'R08' ? 409 : 422)).send({ error: { code: e.code ?? 'VALIDATION_ERROR', message: e.message, request_id: request.id } }); }
  });

  app.post<{ Params: { id: string }; Body: { occurred_at: string } }>('/api/v1/shipments/:id/dispatch', { schema: { body: ShipmentDispatchSchema, params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const actor = request.authUser!;
    const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/shipments/:id/dispatch', key: request.idempotencyKey!, payload: { params: request.params, body: request.body } }, async tx => {
      const shipment = await tx.shipment.findFirst({ where: { id: request.params.id, sender_id: actor.organization_id }, include: { items: true } });
      if (!shipment || shipment.status !== 'CREATED') throw Object.assign(new Error('Remessa inexistente ou não pode ser expedida.'), { statusCode: 409, code: 'SHIPMENT_STATE_CONFLICT' });
      const dispatchedAt = new Date(request.body.occurred_at);
      if (dispatchedAt < shipment.declared_at) throw Object.assign(new Error('A expedição não pode anteceder a criação da remessa.'), { statusCode: 422, code: 'R06' });
      const latestHarvest = await tx.harvest.findFirst({ where: { origin_lot_id: { in: shipment.items.map(item => item.lot_id) } }, orderBy: { period_end: 'desc' } });
      if (latestHarvest && dispatchedAt < latestHarvest.period_end) throw Object.assign(new Error('A expedição não pode anteceder o corte informado.'), { statusCode: 422, code: 'R06' });
      await lockBalances(tx, actor.organization_id, shipment.items.map(item => item.lot_id));
      await assertNoR19(tx, [shipment.id, ...shipment.items.map(item => item.lot_id)]);
      for (const item of shipment.items) {
        await tx.balance.update({ where: { lot_id_organization_id: { lot_id: item.lot_id, organization_id: actor.organization_id } }, data: { reserved_m3: { decrement: item.volume_m3 }, quarantined_m3: { increment: item.volume_m3 } } });
        await tx.balanceMovement.create({ data: { lot_id: item.lot_id, organization_id: actor.organization_id, entity_type: 'SHIPMENT', entity_id: shipment.id, action: 'DISPATCH', volume_m3: item.volume_m3 } });
      }
      const saved = await tx.shipment.update({ where: { id: shipment.id }, data: { status: 'DISPATCHED', dispatched_at: new Date(request.body.occurred_at), dispatched_by_user_id: actor.id } });
      await appendEvent(tx, { streamId: shipment.id, entityType: 'SHIPMENT', entityId: shipment.id, type: 'SHIPMENT_DISPATCHED', actorId: actor.id, payload: { occurred_at: request.body.occurred_at } });
      return { statusCode: 200, body: { shipment: saved } };
    });
    return reply.code(result.statusCode).send(result.body);
  });

  app.post<{ Params: { id: string }; Body: { occurred_at: string; items: Array<{ lot_id: string; volume_m3: string }> } }>('/api/v1/shipments/:id/receive', { schema: { body: ShipmentReceiveSchema, params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const actor = request.authUser!;
    const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/shipments/:id/receive', key: request.idempotencyKey!, payload: { params: request.params, body: request.body } }, async tx => {
      const shipment = await tx.shipment.findFirst({ where: { id: request.params.id, recipient_id: actor.organization_id }, include: { items: true } });
      if (!shipment || shipment.status !== 'DISPATCHED') throw Object.assign(new Error('Remessa inexistente ou não pode ser recebida.'), { statusCode: 409, code: 'SHIPMENT_STATE_CONFLICT' });
      if (!shipment.dispatched_at || new Date(request.body.occurred_at) < shipment.dispatched_at) throw Object.assign(new Error('O recebimento não pode anteceder a expedição.'), { statusCode: 422, code: 'R06' });
      await assertNoR19(tx, [shipment.id, ...shipment.items.map(item => item.lot_id)]);
      const receivedIds = request.body.items.map(item => item.lot_id);
      if (new Set(receivedIds).size !== receivedIds.length || receivedIds.length !== shipment.items.length || shipment.items.some(item => !receivedIds.includes(item.lot_id))) throw Object.assign(new Error('Informe cada lote da remessa uma única vez.'), { statusCode: 422 });
      if (request.body.items.some(item => new Decimal(item.volume_m3).gt(shipment.items.find(line => line.lot_id === item.lot_id)!.volume_m3.toString()))) throw Object.assign(new Error('O recebimento não pode criar volume superior ao expedido.'), { statusCode: 422 });
      const receivedByLot = new Map(request.body.items.map(i => [i.lot_id, new Decimal(i.volume_m3)])); const checks = [] as Array<{ lot_id: string; difference_m3: string; status: string }>;
      for (const item of shipment.items) {
        const received = receivedByLot.get(item.lot_id) ?? new Decimal(0); const dispatched = new Decimal(item.volume_m3.toString()); const diff = dispatched.minus(received).abs();
        const current = await tx.balance.findUnique({ where: { lot_id_organization_id: { lot_id: item.lot_id, organization_id: shipment.sender_id } } });
        if (!current) throw Object.assign(new Error('Saldo em trânsito ausente; recebimento exige reconciliação.'), { statusCode: 409, code: 'R08' });
        // Keep an unreceived difference in quarantine until reconciliation, instead of losing it.
        await tx.balance.update({ where: { id: current.id }, data: { quarantined_m3: { decrement: received.toFixed() } } });
        await tx.balance.upsert({ where: { lot_id_organization_id: { lot_id: item.lot_id, organization_id: shipment.recipient_id } }, create: { lot_id: item.lot_id, organization_id: shipment.recipient_id, available_m3: received.toFixed() }, update: { available_m3: { increment: received.toFixed() } } });
        if (received.gt(0)) {
          await tx.balanceMovement.createMany({ data: [
            { lot_id: item.lot_id, organization_id: shipment.sender_id, entity_type: 'SHIPMENT', entity_id: shipment.id, action: 'RECEIPT_DEBIT', volume_m3: received.toFixed() },
            { lot_id: item.lot_id, organization_id: shipment.recipient_id, entity_type: 'SHIPMENT', entity_id: shipment.id, action: 'RECEIPT_CREDIT', volume_m3: received.toFixed() },
          ] });
        }
        await tx.shipmentItem.update({ where: { id: item.id }, data: { received_volume_m3: received.toFixed() } });
        checks.push({ lot_id: item.lot_id, difference_m3: diff.toFixed(), status: diff.isZero() ? 'PASSOU' : 'ALERTA' });
      }
      const saved = await tx.shipment.update({ where: { id: shipment.id }, data: { status: checks.every(c => c.status === 'PASSOU') ? 'RECEIVED' : 'RECEIVED_WITH_VARIANCE', received_at: new Date(request.body.occurred_at), received_by_user_id: actor.id } });
      await appendEvent(tx, { streamId: shipment.id, entityType: 'SHIPMENT', entityId: shipment.id, type: 'SHIPMENT_RECEIVED', actorId: actor.id, payload: { occurred_at: request.body.occurred_at, checks, receipt_policy: RECEIPT_POLICY } });
      if (checks.some(c => c.status === 'ALERTA')) {
        const check = await tx.check.create({ data: { organization_id: shipment.recipient_id, entity_type: 'SHIPMENT', entity_id: shipment.id, rule_id: 'R09', rule_version: RECEIPT_POLICY.version, name: 'Divergência de recebimento', description: 'Quantidade recebida difere da expedida; tolerância zero.', source: { type: 'SHIPMENT_DECLARATION' }, modality: 'DEMONSTRATIVO', dimension: 'chain_of_custody_check', status: 'ALERTA', technical_severity: 'MEDIUM', message: 'R09 detectou divergência entre expedição e recebimento.', suggested_action: 'Investigar e anexar evidência.', values: { checks, receipt_policy: RECEIPT_POLICY }, assessment_scope: 'DEMONSTRATIVO' } });
        await tx.auditCase.create({ data: { organization_id: shipment.recipient_id, check_id: check.id, entity_type: 'SHIPMENT', entity_id: shipment.id, created_by_user_id: actor.id, rule_id: 'R09' } });
      }
      return { statusCode: 200, body: { shipment: saved, checks } };
    });
    return reply.code(result.statusCode).send(result.body);
  });

  app.post<{ Body: Record<string, unknown> }>('/api/v1/transformations', { schema: { body: TransformationCreateSchema } }, async (request, reply) => {
    const actor = request.authUser!; const b = request.body;
    if (String(b.operator_organization_id) !== actor.organization_id || !Array.isArray(b.inputs) || !Array.isArray(b.outputs) || !b.inputs.length || !b.outputs.length) return reply.code(422).send({ error: { code: 'VALIDATION_ERROR', message: 'Informe organização, entradas e saídas da transformação.', request_id: request.id } });
    try {
      const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/transformations', key: request.idempotencyKey!, payload: b }, async tx => {
        const inputs = b.inputs as Array<{ lot_id: string; volume_m3: string }>;
        assertDistinctLots(inputs);
        await lockBalances(tx, actor.organization_id, inputs.map(input => input.lot_id));
        const outputs = b.outputs as Array<{ client_ref: string; product: string; volume_m3: string; allocations: Array<{ origin_lot_id: string | null; volume_m3: string }> }>;
        const totalInput = inputs.reduce((sum, row) => sum.plus(row.volume_m3), new Decimal(0));
        const totalOutput = outputs.reduce((sum, row) => sum.plus(row.volume_m3), new Decimal(0));
        if (totalOutput.plus(String(b.residue_m3)).plus(String(b.loss_m3)).gt(totalInput)) throw Object.assign(new Error('Saídas, resíduos e perdas excedem o volume de entrada.'), { code: 'MASS_BALANCE_EXCEEDED' });
        const inputIds = inputs.map(input => input.lot_id);
        const [origins, products, ancestors] = await Promise.all([
          tx.originLot.findMany({ where: { id: { in: inputIds } } }),
          tx.productLot.findMany({ where: { id: { in: inputIds } } }),
          tx.lotProvenance.findMany({ where: { product_lot_id: { in: inputIds } } }),
        ]);
        await assertNoR19(tx, [...inputIds, ...ancestors.map(row => row.origin_lot_id ?? '')]);
        const species = [...origins, ...products];
        for (const origin of origins) {
          const receipt = await tx.shipment.findFirst({ where: { recipient_id: actor.organization_id, status: { in: ['RECEIVED', 'RECEIVED_WITH_VARIANCE'] }, received_at: { lte: new Date(String(b.occurred_at)) }, items: { some: { lot_id: origin.id, received_volume_m3: { gt: 0 } } } } });
          if (!receipt) throw Object.assign(new Error('A transformação exige entrada recebida pelo operador antes da data informada.'), { statusCode: 409, code: 'INPUT_NOT_RECEIVED' });
        }
        if (!species.length || new Set(species.map(lot => lot.species_scientific)).size !== 1) throw Object.assign(new Error('Entradas devem possuir espécie compatível para o mesmo parâmetro de conversão.'), { code: 'SPECIES_MISMATCH' });
        const capacities = new Map<string, Decimal>();
        for (const input of inputs) {
          if (origins.some(origin => origin.id === input.lot_id)) capacities.set(input.lot_id, (capacities.get(input.lot_id) ?? new Decimal(0)).plus(input.volume_m3));
          else for (const ancestor of ancestors.filter(row => row.product_lot_id === input.lot_id && row.origin_lot_id)) {
            const product = products.find(lot => lot.id === input.lot_id)!;
            const contribution = new Decimal(input.volume_m3).mul(ancestor.volume_m3.toString()).div(product.volume_m3.toString());
            capacities.set(ancestor.origin_lot_id!, (capacities.get(ancestor.origin_lot_id!) ?? new Decimal(0)).plus(contribution));
          }
        }
        const assigned = new Map<string, Decimal>();
        for (const output of outputs) for (const allocation of output.allocations) if (allocation.origin_lot_id) assigned.set(allocation.origin_lot_id, (assigned.get(allocation.origin_lot_id) ?? new Decimal(0)).plus(allocation.volume_m3));
        for (const [originId, amount] of assigned) if (amount.gt(capacities.get(originId) ?? '0')) throw Object.assign(new Error('Alocação de origem excede a quantidade disponível nas entradas ou referencia origem sem vínculo.'), { code: 'R11' });
        for (const input of inputs) {
          const vol = new Decimal(input.volume_m3); const balance = await tx.balance.findUnique({ where: { lot_id_organization_id: { lot_id: input.lot_id, organization_id: actor.organization_id } } });
          const check = checkBalance(balance?.available_m3.toString() ?? '0', vol.toFixed(), 'R08');
          if (!check.confirmed) throw Object.assign(new Error('Saldo de entrada insuficiente.'), { code: 'R08', details: check });
        }
        const parameter = await tx.conversionParameter.findUnique({ where: { id: String(b.conversion_parameter_id) } });
        if (!parameter) throw Object.assign(new Error('Parâmetro CRV não encontrado; operação permanece sem conclusão.'), { code: 'CRV_PARAMETER_MISSING' });
        if (outputs.some(output => output.product !== parameter.output_product) || origins.length > 0 && parameter.input_product !== 'tora' || products.some(product => product.product !== parameter.input_product)) throw Object.assign(new Error('Produtos de entrada e saída devem corresponder ao parâmetro de conversão selecionado.'), { code: 'CRV_PRODUCT_MISMATCH' });
        const operationDate = String(b.occurred_at).slice(0, 10);
        if (operationDate < parameter.valid_from.toISOString().slice(0, 10) || parameter.valid_until && operationDate > parameter.valid_until.toISOString().slice(0, 10)) throw Object.assign(new Error('Parâmetro CRV fora da vigência da transformação.'), { code: 'CRV_PARAMETER_EXPIRED' });
        const assessment = assessConversion({ inputVolumeM3: totalInput.toFixed(), outputVolumeM3: totalOutput.toFixed(), multiplier: parameter.coefficient.toString(), parameterVersion: parameter.version, parameterSource: parameter.source_url, parameterValidFrom: parameter.valid_from.toISOString().slice(0, 10), parameterValidUntil: parameter.valid_until?.toISOString().slice(0, 10), assessmentDate: operationDate });
        const transformation = await tx.transformation.create({ data: { code: String(b.code), organization_id: actor.organization_id, occurred_at: new Date(String(b.occurred_at)), conversion_parameter_id: parameter.id, residue_m3: String(b.residue_m3 ?? '0'), loss_m3: String(b.loss_m3 ?? '0'), assessment_scope: String(b.assessment_scope ?? 'DEMONSTRATIVO'), created_by_user_id: actor.id, inputs: { create: inputs.map(i => ({ lot_id: i.lot_id, volume_m3: i.volume_m3 })) } } });
        for (const input of inputs) {
          await debitAvailable(tx, actor.organization_id, input.lot_id, input.volume_m3);
          await tx.balanceMovement.create({ data: { lot_id: input.lot_id, organization_id: actor.organization_id, entity_type: 'TRANSFORMATION', entity_id: transformation.id, action: 'CONSUME', volume_m3: input.volume_m3 } });
        }
        const created = [];
        for (const output of outputs) {
          const provenance = allocateProvenance(output.volume_m3, output.allocations);
          const productLot = await tx.productLot.create({ data: { code: output.client_ref, organization_id: actor.organization_id, transformation_id: transformation.id, product: output.product, species_common: species[0]!.species_common, species_scientific: species[0]!.species_scientific, volume_m3: output.volume_m3, assessment_scope: String(b.assessment_scope ?? 'DEMONSTRATIVO'), data_provenance: { label: 'SIMULADA', source: 'operação demonstrativa' }, created_by_user_id: actor.id } });
          for (const allocation of provenance.allocations) await tx.lotProvenance.create({ data: { product_lot_id: productLot.id, origin_lot_id: allocation.origin_lot_id, volume_m3: allocation.volume_m3, fraction: allocation.fraction } });
          const restricted = assessment.result !== 'PASSOU' || provenance.evidence_incomplete;
          await tx.balance.create({ data: { lot_id: productLot.id, organization_id: actor.organization_id, available_m3: restricted ? '0' : output.volume_m3, quarantined_m3: restricted ? output.volume_m3 : '0' } });
          created.push({ product_lot: productLot, provenance, quarantined: restricted });
        }
        for (const [ruleId, status, dimension, message, values] of [
          ['R10', assessment.result, 'volume_check', assessment.explanation, assessment],
          ...(created.some(x => x.provenance.evidence_incomplete) ? [['R11', 'ALERTA', 'chain_of_custody_check', 'Há volume de origem desconhecida.', { outputs: created.map(x => x.provenance) }]] : []),
        ] as Array<[string, string, string, string, unknown]>) {
          const check = await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: 'TRANSFORMATION', entity_id: transformation.id, rule_id: ruleId, rule_version: '1', name: ruleId === 'R10' ? 'Rendimento de conversão' : 'Proveniência incompleta', description: message, source: { parameter_id: parameter.id, source_url: parameter.source_url }, modality: 'DEMONSTRATIVO', dimension, status, technical_severity: 'HIGH', message, suggested_action: 'Revisar evidências e parâmetros aplicáveis.', values: values as object, assessment_scope: transformation.assessment_scope } });
          if (status !== 'PASSOU') await tx.auditCase.create({ data: { organization_id: actor.organization_id, check_id: check.id, entity_type: 'TRANSFORMATION', entity_id: transformation.id, created_by_user_id: actor.id, rule_id: ruleId } });
        }
        await appendEvent(tx, { streamId: transformation.id, entityType: 'TRANSFORMATION', entityId: transformation.id, type: 'TRANSFORMATION_RECORDED', actorId: actor.id, payload: { inputs, outputs: created.map(x => ({ id: x.product_lot.id, provenance: x.provenance })), assessment } });
        return { statusCode: 201, body: { transformation, outputs: created, assessment } };
      });
      return reply.code(result.statusCode).send(result.body);
    } catch (error) { const e = error as Error & { code?: string; details?: unknown; statusCode?: number }; return reply.code(e.statusCode ?? (['R08','R17'].includes(e.code ?? '') ? 409 : 422)).send({ error: { code: e.code ?? 'TRANSFORMATION_REJECTED', message: e.message, request_id: request.id }, details: e.details }); }
  });

  app.post<{ Params: { id: string }; Body: { decision: string; comment: string; evidence_ids: string[]; conversion_exception_id?: string } }>('/api/v1/audit-cases/:id/decisions', { schema: { body: DecisionCreateSchema, params: Type.Object({ id: Type.String({ format: 'uuid' }) }) } }, async (request, reply) => {
    const actor = request.authUser!; const body = request.body;
    const auditCase = await prisma.auditCase.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id } });
    if (!auditCase) return reply.code(404).send({ error: { code: 'CASE_NOT_FOUND', message: 'Caso não encontrado no escopo da organização.', request_id: request.id } });
    if (!actor.roles.includes('AUDITOR')) return reply.code(403).send({ error: { code: 'AUDITOR_ROLE_REQUIRED', message: 'Perfil de auditor necessário.', request_id: request.id } });
    let operationAuthor: string | null = null;
    if (auditCase.entity_type === 'ORIGIN_LOT') operationAuthor = (await prisma.originLot.findUnique({ where: { id: auditCase.entity_id }, select: { created_by_user_id: true } }))?.created_by_user_id ?? null;
    if (auditCase.entity_type === 'TRANSFORMATION') operationAuthor = (await prisma.transformation.findUnique({ where: { id: auditCase.entity_id }, select: { created_by_user_id: true } }))?.created_by_user_id ?? null;
    if (auditCase.entity_type === 'SHIPMENT') operationAuthor = (await prisma.shipment.findUnique({ where: { id: auditCase.entity_id }, select: { created_by_user_id: true } }))?.created_by_user_id ?? null;
    if (auditCase.entity_type === 'PLOT') operationAuthor = (await prisma.plot.findUnique({ where: { id: auditCase.entity_id }, select: { created_by_user_id: true } }))?.created_by_user_id ?? null;
    try { assertNoSelfReview({ reviewerUserId: actor.id, operationAuthorUserId: operationAuthor, versionAuthorUserId: auditCase.created_by_user_id }); }
    catch (error) {
      await logAccess(request, actor.id, false, (error as { code?: string }).code ?? 'REVIEW_AUTHOR_UNKNOWN');
      const e = error as Error & { code?: string };
      return reply.code(403).send({ error: { code: e.code ?? 'REVIEW_AUTHOR_UNKNOWN', message: e.message, request_id: request.id } });
    }
    if (!body.comment?.trim() || body.decision === 'RESOLVIDO_COM_EVIDENCIA' && (!Array.isArray(body.evidence_ids) || body.evidence_ids.length === 0)) return reply.code(422).send({ error: { code: 'REVIEW_EVIDENCE_REQUIRED', message: 'Informe justificativa e evidência vinculada para resolver o caso.', request_id: request.id } });
    if (body.evidence_ids.length) {
      const docs = await prisma.document.count({ where: { id: { in: body.evidence_ids }, OR: [{ organization_id: actor.organization_id }, { allowed_organization_ids: { has: actor.organization_id } }] } });
      if (docs !== body.evidence_ids.length) return reply.code(422).send({ error: { code: 'EVIDENCE_NOT_ACCESSIBLE', message: 'Uma ou mais evidências não estão disponíveis neste escopo.', request_id: request.id } });
    }
    if (body.decision === 'RESOLVIDO_COM_EVIDENCIA' && auditCase.rule_id === 'R19') return reply.code(422).send({ error: { code: 'RULE_REASSESSMENT_REQUIRED', message: 'Retificações exigem reconciliação dos descendentes afetados; justificativa contextual não resolve R19.', request_id: request.id } });
    const needsConversionReassessment = body.decision === 'RESOLVIDO_COM_EVIDENCIA' && auditCase.rule_id === 'R10' && Boolean(body.conversion_exception_id);
    if (body.decision === 'RESOLVIDO_COM_EVIDENCIA' && ['R07', 'R08', 'R09', 'R10', 'R11'].includes(auditCase.rule_id) && !needsConversionReassessment) return reply.code(422).send({ error: { code: 'RULE_REASSESSMENT_REQUIRED', message: 'Conflitos de volume ou origem exigem respaldo e reavaliação da regra antes da resolução.', request_id: request.id } });
    const review = body.decision === 'RESOLVIDO_COM_EVIDENCIA' ? contextualHumanReview({ original_signal: auditCase.rule_id, decision: body.decision, comment: body.comment, evidenceIds: body.evidence_ids }) : { original_signal: auditCase.rule_id, human_decision: body.decision, signal_overwritten: false, rule_re_evaluated: false };
    const saved = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/audit-cases/:id/decisions', key: request.idempotencyKey!, payload: { params: request.params, body } }, async (tx: Prisma.TransactionClient) => {
      const currentAuditCase = auditCase!;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${currentAuditCase.id}, 0))`;
      const currentCase = await tx.auditCase.findUniqueOrThrow({ where: { id: currentAuditCase.id } });
      if (!['ABERTO', 'EM_ANALISE', 'MANTIDO_PENDENTE'].includes(currentCase.status)) throw Object.assign(new Error('O caso já recebeu decisão final.'), { statusCode: 409, code: 'CASE_ALREADY_FINAL' });
      let txReassessment: ReturnType<typeof reassessConversionWithException> | undefined;
      const contextualBinding = body.decision === 'RESOLVIDO_COM_EVIDENCIA' && !needsConversionReassessment
        ? await bindContextualReview(tx, currentCase, body.evidence_ids) : undefined;
      if (needsConversionReassessment) {
        const [originalCheck, transformation, exception] = await Promise.all([
          tx.check.findFirst({ where: { id: currentAuditCase.check_id, entity_id: currentAuditCase.entity_id, rule_id: 'R10', status: 'ALERTA' } }),
          tx.transformation.findFirst({ where: { id: currentAuditCase.entity_id, organization_id: actor.organization_id }, include: { inputs: true, outputs: true } }),
          tx.conversionException.findFirst({ where: { id: body.conversion_exception_id, organization_id: actor.organization_id } }),
        ]);
        if (!originalCheck || !transformation || !exception || exception.conversion_parameter_id !== transformation.conversion_parameter_id || !body.evidence_ids.includes(exception.document_id)) throw Object.assign(new Error('A checagem original, operação e exceção precisam continuar válidas no escopo.'), { statusCode: 422, code: 'CONVERSION_EXCEPTION_INVALID' });
        const [parameter, approvalDocument, otherOpenCases] = await Promise.all([
          tx.conversionParameter.findUnique({ where: { id: transformation.conversion_parameter_id } }),
          tx.document.findFirst({ where: { id: exception.document_id, organization_id: actor.organization_id } }),
          tx.auditCase.count({ where: { entity_type: 'TRANSFORMATION', entity_id: transformation.id, id: { not: currentAuditCase.id }, status: { in: ['ABERTO', 'EM_ANALISE', 'MANTIDO_PENDENTE'] }, rule_id: { in: ['R07', 'R08', 'R09', 'R10', 'R11', 'R19'] } } }),
        ]);
        const products = new Set(transformation.outputs.map(output => output.product));
        const species = new Set(transformation.outputs.map(output => output.species_scientific));
        const day = transformation.occurred_at.toISOString().slice(0, 10);
        if (otherOpenCases || !parameter || !approvalDocument || !['CRV_APPROVAL', 'CONVERSION_EXCEPTION'].includes(approvalDocument.type) || !exception.approval_reference.trim() || !exception.issuing_authority.trim() || !exception.product || !exception.species_scientific || products.size !== 1 || species.size !== 1 || [...products][0] !== parameter.output_product || exception.product !== [...products][0] || exception.species_scientific !== [...species][0] || day < exception.valid_from.toISOString().slice(0, 10) || day > exception.valid_until.toISOString().slice(0, 10)) throw Object.assign(new Error('A aprovação está vencida, incompleta ou fora do escopo; conflitos correlatos seguem abertos.'), { statusCode: 422, code: otherOpenCases ? 'OTHER_CONFLICTS_OPEN' : 'CONVERSION_EXCEPTION_INVALID' });
        const approvalBytes = await readDocument(approvalDocument.storage_key).catch(() => null);
        if (!approvalBytes || createHash('sha256').update(approvalBytes).digest('hex') !== approvalDocument.content_hash) throw Object.assign(new Error('Documento de aprovação ausente ou hash divergente.'), { statusCode: 422, code: 'APPROVAL_DOCUMENT_INVALID' });
        const totalInput = transformation.inputs.reduce((sum, input) => sum.plus(input.volume_m3.toString()), new Decimal(0));
        const totalOutput = transformation.outputs.reduce((sum, output) => sum.plus(output.volume_m3.toString()), new Decimal(0));
        txReassessment = reassessConversionWithException({ inputVolumeM3: totalInput.toFixed(), outputVolumeM3: totalOutput.toFixed(), coefficient: parameter.coefficient.toString(), parameterVersion: parameter.version, parameterSource: parameter.source_url, parameterValidFrom: parameter.valid_from.toISOString().slice(0, 10), parameterValidUntil: parameter.valid_until?.toISOString().slice(0, 10), assessmentDate: day, species: [...species][0]!, product: [...products][0]!, exception: { coefficient: exception.coefficient.toString(), approved: true, evidenceIds: [exception.document_id], validFrom: exception.valid_from.toISOString().slice(0, 10), validUntil: exception.valid_until.toISOString().slice(0, 10), species: exception.species_scientific, product: exception.product } });
        if (txReassessment.result !== 'PASSOU') throw Object.assign(new Error('A reavaliação CRV permanece em alerta; o saldo segue em quarentena.'), { statusCode: 422, code: 'RULE_REASSESSMENT_FAILED' });
      }
      if (txReassessment) {
        const transformation = await tx.transformation.findUniqueOrThrow({ where: { id: currentAuditCase.entity_id }, include: { outputs: true } });
        for (const output of transformation.outputs) {
          const released = await tx.balance.updateMany({ where: { lot_id: output.id, organization_id: actor.organization_id, quarantined_m3: { gte: output.volume_m3 } }, data: { available_m3: { increment: output.volume_m3 }, quarantined_m3: { decrement: output.volume_m3 } } });
          if (released.count !== 1) throw Object.assign(new Error('Saldo em quarentena não corresponde ao volume reavaliado.'), { statusCode: 409, code: 'CRV_QUARANTINE_NOT_FOUND' });
          await tx.balanceMovement.create({ data: { lot_id: output.id, organization_id: actor.organization_id, entity_type: 'TRANSFORMATION', entity_id: transformation.id, action: 'CRV_EXCEPTION_RELEASE', volume_m3: output.volume_m3 } });
        }
        await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: 'TRANSFORMATION', entity_id: transformation.id, rule_id: 'R10', rule_version: '1', name: 'Reavaliação de rendimento CRV', description: txReassessment.explanation, source: { conversion_exception_id: body.conversion_exception_id }, modality: 'DEMONSTRATIVO', dimension: 'volume_check', status: txReassessment.result, technical_severity: 'HIGH', message: txReassessment.explanation, suggested_action: 'Preservar decisão e evidência de aprovação.', values: txReassessment as unknown as object, assessment_scope: transformation.assessment_scope } });
        await appendEvent(tx, { streamId: transformation.id, entityType: 'TRANSFORMATION', entityId: transformation.id, type: 'CRV_REASSESSED', actorId: actor.id, payload: { audit_case_id: currentAuditCase.id, conversion_exception_id: body.conversion_exception_id, evidence_ids: body.evidence_ids, assessment: txReassessment } });
      }
      const decision = await tx.auditDecision.create({ data: { case_id: currentAuditCase.id, reviewer_user_id: actor.id, decision: body.decision, comment: body.comment.trim(), evidence_ids: body.evidence_ids, conversion_exception_id: body.conversion_exception_id } });
      const updated = await tx.auditCase.update({ where: { id: currentAuditCase.id }, data: { status: body.decision } });
      await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: currentAuditCase.entity_type,
        entity_id: currentAuditCase.entity_id, rule_id: `HUMAN_REVIEW_${currentAuditCase.check_id}`, rule_version: '1',
        name: 'Revisão humana registrada', description: 'Decisão identificada sem apagar a checagem original.',
        source: { decision_id: decision.id, case_id: currentAuditCase.id }, modality: 'HUMAN_REVIEW', dimension: 'human_review',
        status: body.decision === 'RESOLVIDO_COM_EVIDENCIA' ? 'PASSOU' : 'PENDENTE', technical_severity: 'INFO',
        message: 'Decisão humana preservada; demais evidências e regras continuam aplicáveis.', suggested_action: 'Consultar decisão e evidências vinculadas.',
        values: { decision: body.decision, original_check_id: currentAuditCase.check_id },
        assessment_scope: (await tx.check.findUniqueOrThrow({ where: { id: currentAuditCase.check_id } })).assessment_scope,
      } });
      await appendEvent(tx, { streamId: currentAuditCase.entity_id, entityType: currentAuditCase.entity_type, entityId: currentAuditCase.entity_id, type: 'AUDIT_CASE_DECIDED', actorId: actor.id, payload: { audit_case_id: currentAuditCase.id, decision_id: decision.id, decision: body.decision, evidence_ids: body.evidence_ids, conversion_exception_id: body.conversion_exception_id ?? null, contextual_binding: contextualBinding ?? null } });
      return { statusCode: 201, body: { decision, audit_case: updated, review: txReassessment ? { original_signal: currentAuditCase.rule_id, signal_overwritten: false, rule_re_evaluated: true, assessment: txReassessment } : review } };
    });
    return reply.code(saved.statusCode).send(saved.body);
  });

  app.get<{ Params: { public_token: string } }>('/api/v1/public/passports/:public_token', async (request, reply) => {
    const passport = await prisma.passport.findUnique({ where: { public_token: request.params.public_token } });
    if (!passport) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Passaporte não encontrado.', request_id: request.id } });
    const content = passport.content as Record<string, unknown>;
    let requiresReview = false;
    try { requiresReview = (await verifyStoredPassport(prisma, passport, readDocument)).current_state.requires_review; }
    catch { requiresReview = true; }
    const regulatory = await regulatorySummaryForProduct(prisma, passport.product_lot_id);
    requiresReview ||= regulatory.coverage !== 'CONFIRMADA';
    return { id: passport.id, version: passport.version, product: content.product ?? null, species: content.species ?? null, region: content.region ?? null, stages: content.stages ?? [], readiness_status: requiresReview ? 'MISSING_EVIDENCE' : content.evidence_status ?? 'MISSING_EVIDENCE', evidence_status: content.evidence_status ?? 'MISSING_EVIDENCE', requires_review: requiresReview, assessment_scope: passport.assessment_scope, regulatory_coverage: regulatory.coverage, regulatory_summary: regulatory, content_hash: passport.content_hash };
  });

  app.post<{ Body: { product_lot_id: string; assessment_scope: 'REAL' | 'DEMONSTRATIVO' } }>('/api/v1/passports', { schema: { body: PassportCreateSchema } }, async (request, reply) => {
    const actor = request.authUser!;
    const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/passports', key: request.idempotencyKey!, payload: request.body }, async (tx: Prisma.TransactionClient) => {
    const lot = await tx.productLot.findFirst({ where: { id: request.body.product_lot_id, organization_id: actor.organization_id }, include: { transformation: { include: { inputs: true } } } });
    if (!lot) throw Object.assign(new Error('Lote de produto não encontrado.'), { statusCode: 404, code: 'PRODUCT_LOT_NOT_FOUND' });
    let ancestry;
    try { ancestry = await loadProductAncestry(tx as any, lot.id); }
    catch (error) { const e = error as Error & { code?: string }; throw Object.assign(e, { statusCode: 409, code: e.code ?? 'ANCESTRY_INVALID' }); }
    const ancestryEntityIds = [...new Set([lot.id, ...ancestry.product_lot_ids, ...ancestry.origin_lots.map((x: any) => x.id), ...ancestry.plots.map((x: any) => x.id), ...ancestry.transformations.map((x: any) => x.id), ...ancestry.shipments.map((x: any) => x.id)])];
    const [checks, provenanceRows, ancestorDocuments] = await Promise.all([
      tx.check.findMany({ where: { entity_id: { in: ancestryEntityIds } }, orderBy: { created_at: 'desc' } }),
      tx.lotProvenance.findMany({ where: { product_lot_id: { in: ancestry.product_lot_ids } }, orderBy: { id: 'asc' } }),
      tx.document.findMany({ where: { id: { in: ancestry.document_ids } }, select: { id: true, content_hash: true, storage_key: true, data_provenance: true } }),
    ]);
    const documentBytesValid = await Promise.all(ancestorDocuments.map(async (document: any) => {
      try { return createHash('sha256').update(await readDocument(document.storage_key)).digest('hex') === document.content_hash; }
      catch { return false; }
    }));
    const effectiveChecks = await effectiveReviewedChecks(tx, latestChecks(checks).filter((check: any) => check.assessment_scope === request.body.assessment_scope));
    const dimensions = aggregateCheckDimensions(effectiveChecks);
    const allocationMissing = ancestry.products.some(product => !provenanceRows.filter(row => row.product_lot_id === product.id).reduce((sum, row) => sum.plus(row.volume_m3.toString()), new Decimal(0)).eq(product.volume_m3.toString()));
    const unknown = allocationMissing || provenanceRows.some((p: Prisma.LotProvenanceGetPayload<{}>) => !p.origin_lot_id && new Decimal(p.volume_m3.toString()).gt(0));
    const openCases = await tx.auditCase.count({ where: { entity_id: { in: ancestryEntityIds }, status: { in: ['ABERTO', 'EM_ANALISE', 'MANTIDO_PENDENTE'] } } });
    const ancestorProducts = await tx.productLot.findMany({ where: { id: { in: ancestry.product_lot_ids } }, select: { assessment_scope: true, data_provenance: true } });
    const simulated = request.body.assessment_scope === 'DEMONSTRATIVO' || containsSimulatedEvidence({
      product: lot.data_provenance,
      origins: ancestry.origin_lots.map((x: any) => ({ scope: x.assessment_scope, data_provenance: x.data_provenance, permits: (x.permits ?? []).map((p: any) => p.data_provenance) })),
      products: ancestorProducts.map((x: any) => ({ scope: x.assessment_scope, data_provenance: x.data_provenance })),
      transformations: ancestry.transformations.map((x: any) => ({ scope: x.assessment_scope, data_provenance: x.data_provenance })),
      plots: ancestry.plots.map((x: any) => x.data_provenance),
      harvests: ancestry.harvests.map((x: any) => ({ tag: x.tag, data_provenance: x.data_provenance })),
      source_queries: ancestry.source_queries.map((x: any) => ({ scope: x.assessment_scope, data_provenance: x.data_provenance, result: x.result })),
      shipments: ancestry.shipments.map((x: any) => ({ official_system: x.official_system, carrier: x.carrier })),
      documents: ancestorDocuments.map((x: any) => x.data_provenance),
    });
    const missingDocumentEvidence = ancestry.origin_lots.some(origin => !origin.permits?.length) || ancestorDocuments.length !== new Set(ancestry.document_ids).size || documentBytesValid.some((valid) => !valid);
    const regulatory = await regulatorySummaryForProduct(tx, lot.id);
    const readiness = assessReadiness({ assessment_scope: request.body.assessment_scope, dimensions, regulatory_coverage: regulatory.coverage, has_open_alert: openCases > 0 || missingDocumentEvidence || effectiveChecks.some((c: Prisma.CheckGetPayload<{}>) => c.status === 'ALERTA'), has_unknown_origin: unknown, has_simulated_supporting_evidence: simulated });
    const publicToken = randomBytes(32).toString('base64url');
    const snapshot = {
      product: lot.product, species: { common: lot.species_common, scientific: lot.species_scientific },
      region: 'Brasil', stages: ['origem', 'transformação', 'revisão', 'passaporte'],
      evidence_status: readiness.readiness, readiness_reasons: readiness.reasons,
      assessment_scope: request.body.assessment_scope, regulatory_coverage: readiness.regulatory_coverage,
      volume_m3: lot.volume_m3.toString(), provenance: provenanceRows.filter(row => row.product_lot_id === lot.id).map((p: Prisma.LotProvenanceGetPayload<{}>) => ({ origin_lot_id: p.origin_lot_id, volume_m3: p.volume_m3.toString(), fraction: p.fraction.toString() })),
      ancestry: { origin_lot_ids: ancestry.origin_lots.map((x: any) => x.id), product_lot_ids: ancestry.product_lot_ids, plot_ids: ancestry.plots.map((x: any) => x.id), plot_digests: ancestry.plots.map((x: any) => ({ id: x.id, geometry_hash: x.geometry_hash, geometry_version: x.geometry_version, calculated_hash: plotGeometrySha(x) })), entity_digests: ancestryDigests(ancestry), transformation_ids: ancestry.transformations.map((x: any) => x.id), shipment_ids: ancestry.shipments.map((x: any) => x.id), document_ids: ancestry.document_ids, document_digests: ancestorDocuments.map((x: any) => ({ id: x.id, content_hash: x.content_hash })) },
      checks: effectiveChecks.map(c => ({ rule_id: c.rule_id, status: c.status, original_status: c.original_status ?? c.status, contextual_resolution: c.contextual_resolution ?? null, message: c.message, dimension: c.dimension })),
      provenance_digests: provenanceRows.map(row => ({ id: row.id, content_hash: sha256Canonical(JSON.parse(JSON.stringify(row))) })),
      disclaimer: 'Documento demonstrativo de evidências; não certifica legalidade nem substitui decisão humana.',
    };
    const contentHash = sha256Canonical(snapshot);
    const qr = await QRCode.toDataURL(`${process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000'}/p/${publicToken}`);
      const previous = await tx.passport.findFirst({ where: { product_lot_id: lot.id }, orderBy: { version: 'desc' } });
      const passportId = randomUUID();
      const version = (previous?.version ?? 0) + 1;
      await appendEvent(tx, { streamId: lot.id, entityType: 'PASSPORT', entityId: passportId, type: 'PASSPORT_ISSUED', actorId: actor.id, payload: { passport_id: passportId, version, content_hash: contentHash } });
      const streamIds = [...new Set([lot.id, ...ancestryEntityIds])];
      const heads = await tx.streamHead.findMany({ where: { stream_id: { in: streamIds } } });
      const headsById = Object.fromEntries(streamIds.map((id: string) => { const head = heads.find((x: any) => x.stream_id === id); return [id, { sequence: head?.sequence ?? 0, event_hash: head?.event_hash ?? null }]; }));
      const passport = await tx.passport.create({ data: { id: passportId, organization_id: actor.organization_id, product_lot_id: lot.id, public_token: publicToken, version, content: snapshot, content_hash: contentHash, snapshot_heads: headsById, assessment_scope: request.body.assessment_scope, created_by_user_id: actor.id } });
      return { statusCode: 201, body: { passport, qr_data_url: qr, readiness } };
    });
    return reply.code(result.statusCode).send(result.body);
  });

  app.get<{ Params: { id: string } }>('/api/v1/passports/:id', async (request, reply) => {
    const actor = request.authUser!;
    const passport = await prisma.passport.findUnique({ where: { id: request.params.id } });
    if (!passport || !canAccessCommercialPassport({ ownerOrganizationId: passport.organization_id, requesterOrganizationId: actor.organization_id, requesterRoles: actor.roles, grantedOrganizationIds: passport.allowed_organization_ids })) return reply.code(404).send({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passaporte não encontrado neste escopo.', request_id: request.id } });
    const visible = await passportContentForUser(passport, actor);
    return { passport: { ...passport, content: visible.content, content_hash: visible.content_hash, snapshot_content_hash: visible.snapshot_content_hash }, withheld_document_count: visible.withheld_document_count };
  });

  app.get<{ Params: { id: string }; Querystring: { format?: string } }>('/api/v1/passports/:id/bundle', async (request, reply) => {
    const started = performance.now();
    const actor = request.authUser!;
    const passport = await prisma.passport.findUnique({ where: { id: request.params.id } });
    if (!passport || !canAccessCommercialPassport({ ownerOrganizationId: passport.organization_id, requesterOrganizationId: actor.organization_id, requesterRoles: actor.roles, grantedOrganizationIds: passport.allowed_organization_ids })) return reply.code(404).send({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passaporte não encontrado neste escopo.', request_id: request.id } });
    const visible = await passportContentForUser(passport, actor);
    let currentState: { readiness_status: string; requires_review: boolean; reasons: string[] } = { readiness_status: (passport.content as any)?.evidence_status ?? 'MISSING_EVIDENCE', requires_review: false, reasons: [] };
    try {
      const current = await verifyStoredPassport(prisma, passport, readDocument);
      currentState = { ...current.current_state, reasons: [...new Set([...current.current_state.alerts.map((x: any) => x.rule_id), ...(current.integrity.issues.map((x: any) => x.code))])] };
    } catch { currentState = { readiness_status: 'MISSING_EVIDENCE', requires_review: true, reasons: ['ANCESTRY_INVALID'] }; }
    const regulatory = await regulatorySummaryForProduct(prisma, passport.product_lot_id);
    if (regulatory.coverage !== 'CONFIRMADA') currentState = { readiness_status: 'MISSING_EVIDENCE', requires_review: true, reasons: [...new Set([...currentState.reasons, 'REGULATORY_COVERAGE_UNCONFIRMED'])] };
    const bundle = await buildEvidenceBundle(prisma, { passport, actor, visible, current_state: currentState, regulatory_summary: regulatory, started_at: started });
    const format = (request.query.format ?? 'JSON').toUpperCase();
    if (format === 'HTML') {
      const escape = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
      const html = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Pacote de evidências ForestTrace</title><style>body{font-family:system-ui;margin:2rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}</style><body><h1>Pacote de evidências ForestTrace</h1><p>Versão ${passport.version} · SHA-256 desta visualização ${escape(bundle.content_hash)} · snapshot ${escape(bundle.snapshot_content_hash)}</p><h2>Estado atual e checklist</h2><pre>${escape(JSON.stringify(bundle, null, 2))}</pre><p>${escape(bundle.guidance)}</p><p>${escape(bundle.limitations.join(' '))}</p></body></html>`;
      const duration = Math.round(performance.now() - started); await prisma.evidenceBundle.create({ data: { passport_id: passport.id, user_id: request.authUser!.id, format, duration_ms: duration, state: 'GENERATED' } });
      return reply.type('text/html; charset=utf-8').send(html);
    }
    if (format !== 'JSON') return reply.code(422).send({ error: { code: 'FORMAT_UNSUPPORTED', message: 'Formato aceito: JSON ou HTML.', request_id: request.id } });
    await prisma.evidenceBundle.create({ data: { passport_id: passport.id, user_id: request.authUser!.id, format, duration_ms: Math.round(performance.now() - started), state: 'GENERATED' } });
    return bundle;
  });

  app.get<{ Params: { id: string } }>('/api/v1/passports/:id/verify', async (request, reply) => {
    const actor = request.authUser!;
    const passport = await prisma.passport.findUnique({ where: { id: request.params.id } });
    if (!passport || !canAccessCommercialPassport({ ownerOrganizationId: passport.organization_id, requesterOrganizationId: actor.organization_id, requesterRoles: actor.roles, grantedOrganizationIds: passport.allowed_organization_ids })) return reply.code(404).send({ error: { code: 'PASSPORT_NOT_FOUND', message: 'Passaporte não encontrado neste escopo.', request_id: request.id } });
    const visible = await passportContentForUser(passport, actor);
    try {
      const stored = await verifyStoredPassport(prisma, passport, readDocument);
      const integrity = stored.integrity;
      integrity.documents = integrity.documents.filter((document: any) => visible.allowed_document_ids.includes(document.document_id));
      integrity.issues = integrity.issues.filter((issue: any) => !issue.code.startsWith('DOCUMENT_') || visible.allowed_document_ids.includes(issue.id));
      return { ...integrity, withheld_document_count: visible.withheld_document_count, current_state: stored.current_state, ancestry: { product_lot_ids: stored.ancestry.product_lot_ids, origin_lot_ids: stored.ancestry.origin_lots.map((x: any) => x.id), transformation_ids: stored.ancestry.transformations.map((x: any) => x.id), shipment_ids: stored.ancestry.shipments.map((x: any) => x.id) }, limitation: 'Integridade criptográfica não comprova veracidade, assinatura digital ou retenção externa.' };
    } catch (error) {
      const e = error as Error & { code?: string };
      return { valid: false, withheld_document_count: visible.withheld_document_count, issues: [{ code: e.code ?? 'ANCESTRY_INVALID', id: passport.product_lot_id }], current_state: { requires_review: true, readiness_status: 'MISSING_EVIDENCE' }, limitation: 'Integridade criptográfica não comprova veracidade, assinatura digital ou retenção externa.' };
    }
  });

  registerCorrectionRoutes(app);
  registerForestUtilizationRoutes(app);
  registerPlotReadRoutes(app);
  registerOriginLotReadRoutes(app);
  registerEvidenceDiagnosticRoutes(app);
  registerRegulatoryRoutes(app);
  registerDeliveryRoutes(app);
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (existsSync(resolve(webRoot, 'index.html'))) {
    await app.register(fastifyStatic, { root: webRoot, wildcard: false });
    app.get('/p/:public_token', async (_request, reply) => reply.sendFile('index.html'));
  }
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.', request_id: request.id } }));
  return app;
}

async function logAccess(request: FastifyRequest, userId: string | null, allowed: boolean, reason: string) {
  await prisma.accessLog.create({ data: { user_id: userId, action: `${request.method} ${request.routeOptions.url ?? request.url.split('?')[0]}`, allowed, reason, request_id: request.id } }).catch(() => undefined);
}
