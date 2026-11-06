import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { Prisma, SourceQuery } from '@prisma/client';
import { prisma } from '../db.js';
import { executeIdempotent } from './idempotency.js';
import { sha256Canonical } from './integrity.js';
import { appendAuditEvent } from './audit-events.js';
import { assessWhisp, buildWhispRequest, createHttpWhispTransport, whispQueryHash,
  WHISP_PROVIDER_VERSION, WHISP_SUBMIT_URL, WHISP_POLL_URL_TEMPLATE } from './whisp.js';

type AssessmentBody = { options?: Record<string, unknown>; refresh?: boolean; resume_query_id?: string; use_simulated_fixture?: boolean };
type AssessmentResponse = { source_query: SourceQuery; assessment: Record<string, unknown> & { reused_cache: boolean }; check_status: string };
const params = Type.Object({ id: Type.String({ format: 'uuid' }) });
const body = Type.Object({
  options: Type.Optional(Type.Object({
    nationalCodes: Type.Optional(Type.Array(Type.String({ pattern: '^[a-z]{2}$' }), { maxItems: 20 })),
    unitType: Type.Optional(Type.Union([Type.Literal('ha'), Type.Literal('acres')])),
    async: Type.Optional(Type.Boolean()), geometryAuditTrail: Type.Optional(Type.Boolean()),
  }, { additionalProperties: false })),
  refresh: Type.Optional(Type.Boolean()), resume_query_id: Type.Optional(Type.String({ format: 'uuid' })),
  use_simulated_fixture: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const fixture = { status: 'SIMULADA', signal: 'PENDENTE_DE_AVALIACAO', note: 'Fixture ilustrativa; não constitui consulta ambiental real.' };

/** Durable acknowledgement precedes external IO; no database transaction waits on Whisp. */
export async function registerWhispRoutes(app: FastifyInstance) {
  const running = new Set<Promise<void>>();
  app.addHook('onClose', async () => { await Promise.allSettled([...running]); });
  for (const url of ['/api/v1/lots/:id/assess', '/api/v1/origin-lots/:id/geospatial-assessments']) {
    app.post<{ Params: { id: string }; Body: AssessmentBody }>(url, { schema: { params, body } }, async (request, reply) => {
      const actor = request.authUser!;
      const lot = await prisma.originLot.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id }, include: { plot: true } });
      if (!lot) return reply.code(404).send({ error: { code: 'LOT_NOT_FOUND', message: 'Lote não encontrado neste escopo.', request_id: request.id } });
      const input = request.body;
      const confirmed = !input.use_simulated_fixture && process.env.WHISP_CONTRACT_CONFIRMED === 'true';
      const options = input.options ?? {};
      const queryHash = whispQueryHash({ geometry: lot.plot.geometry, geometryVersion: lot.plot.geometry_version, options });
      const result = await executeIdempotent<AssessmentResponse>(prisma, {
        actorId: actor.id, operation: 'POST /api/v1/lots/:id/assess', key: request.idempotencyKey!, payload: { id: lot.id, body: input },
      }, async tx => {
        let previous = null;
        if (input.resume_query_id) {
          previous = await tx.sourceQuery.findFirst({ where: { id: input.resume_query_id, lot_id: lot.id, organization_id: actor.organization_id } });
          if (!previous?.job_id || previous.status !== 'PENDENTE') throw Object.assign(new Error('Consulta sem job pendente para retomar.'), { statusCode: 409, code: 'WHISP_JOB_NOT_PENDING' });
          if (object(previous.payload).query_hash !== queryHash) throw Object.assign(new Error('Geometria, opções ou versão mudaram; o job pertence à consulta anterior.'), { statusCode: 409, code: 'WHISP_QUERY_CHANGED' });
        }
        if (!input.refresh && !previous && confirmed && !!process.env.WHISP_API_KEY) {
          const candidates = await tx.sourceQuery.findMany({ where: { lot_id: lot.id, organization_id: actor.organization_id,
            geometry_hash: lot.plot.geometry_hash, provider_version: WHISP_PROVIDER_VERSION,
            assessment_scope: lot.assessment_scope, status: { in: ['CONCLUIDO', 'PENDENTE'] } }, orderBy: { created_at: 'desc' } });
          const cached = candidates.find(query => object(query.payload).query_hash === queryHash &&
            (query.status === 'PENDENTE' || query.data_provenance === 'REAL_CONSULTADA'));
          if (cached) {
            const saved = object(object(cached.result).assessment);
            return { statusCode: cached.status === 'PENDENTE' ? 202 : 200, body: { source_query: cached,
              assessment: { ...saved, reused_cache: true, original_queried_at: cached.created_at.toISOString() }, check_status: 'NAO_AVALIADO' } };
          }
        }
        const source = await tx.source.findFirst({ where: { name: 'Whisp', integration_status: confirmed ? 'CONTRATO_CONFIRMADO' : 'SEM_INTEGRACAO_REAL' } }) ?? await tx.source.create({ data: {
          name: 'Whisp', owner: 'Open Foris / Forest Data Partnership', url: 'https://whisp.openforis.org/', access_mode: 'API', requires_auth: true,
          spatial_coverage: 'Camadas globais e indicadores nacionais solicitados; disponibilidade por indicador deve ser conferida.',
          time_coverage: 'Períodos específicos das camadas; conferir metadados do resultado.', update_frequency: 'Conforme fontes do provedor; sem garantia de atualidade.',
          license: 'Conferir termos de cada camada; licença do código não licencia todos os dados.', fields_used: ['geometry', 'analysisOptions'],
          integration_status: confirmed ? 'CONTRATO_CONFIRMADO' : 'SEM_INTEGRACAO_REAL', confidence: 'NAO_AVALIADA',
          limitations: 'Indicadores exigem revisão contextual; não determinam legalidade, embargo ou autorização de volume.', checked_at: new Date(),
        } });
        const payload = { request: buildWhispRequest(lot.plot.geometry, options), geometry_version: lot.plot.geometry_version,
          geometry_provenance: lot.plot.data_provenance, options, query_hash: queryHash,
          ...(previous ? { resume_query_id: previous.id, job_id: previous.job_id } : {}) };
        const assessment = { integration: confirmed ? 'REAL' : 'SEM_INTEGRACAO_REAL', result: 'PENDENTE', provenance: 'INDISPONIVEL',
          query_hash: queryHash, reused_cache: false, attempts: 0, reason: 'Consulta registrada; consulte o histórico para acompanhar.', ...(previous ? { job_id: previous.job_id } : {}) };
        const initial = { assessment };
        const query = await tx.sourceQuery.create({ data: { organization_id: actor.organization_id, lot_id: lot.id, source_id: source.id,
          geometry_hash: lot.plot.geometry_hash, payload: json(payload), result: json(initial), payload_hash: sha256Canonical(payload), result_hash: sha256Canonical(initial),
          status: 'PENDENTE', provider_version: WHISP_PROVIDER_VERSION, assessment_scope: lot.assessment_scope, data_provenance: 'INDISPONIVEL', job_id: previous?.job_id ?? null } });
        await appendAuditEvent(tx, { streamId: lot.id, entityType: 'ORIGIN_LOT', entityId: lot.id, type: 'GEOSPATIAL_QUERY_REGISTERED', actorId: actor.id,
          payload: { source_query_id: query.id, query_hash: queryHash, geometry_version: lot.plot.geometry_version } });
        return { statusCode: 202, body: { source_query: query, assessment, check_status: 'NAO_AVALIADO' } };
      });
      if (!result.replayed && !result.body.assessment.reused_cache) {
        // The initial row and idempotency acknowledgement are committed before starting the request.
        const queryId = result.body.source_query.id;
        const jobId = result.body.source_query.job_id ?? undefined;
        const task = (async () => {
          let transport;
          try {
            if (confirmed) transport = createHttpWhispTransport({ submitUrl: process.env.WHISP_SUBMIT_URL || WHISP_SUBMIT_URL,
              pollUrl: id => (process.env.WHISP_POLL_URL_TEMPLATE || WHISP_POLL_URL_TEMPLATE).replace('{job_id}', encodeURIComponent(id)) });
            const assessment = await assessWhisp({ geometry: lot.plot.geometry, geometryVersion: lot.plot.geometry_version, options,
              contractConfirmed: confirmed, apiKey: process.env.WHISP_API_KEY, transport, jobId,
              simulatedFixture: input.use_simulated_fixture ? fixture : undefined, maxPolls: jobId ? 1 : 0 });
            const stored = { assessment, response: assessment.response_body ?? null };
            await prisma.$transaction(async tx => {
              const query = await tx.sourceQuery.update({ where: { id: queryId }, data: { result: json(stored), result_hash: sha256Canonical(stored),
                status: assessment.result, http_status: assessment.http_status ?? null, data_provenance: assessment.provenance,
                failure_reason: assessment.reason ?? null, job_id: assessment.job_id ?? jobId ?? null } });
              await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: 'ORIGIN_LOT', entity_id: lot.id,
                rule_id: 'GEO_PROVIDER', rule_version: '1', name: 'Avaliação geoespacial', description: 'Consulta de provedor preservada para revisão contextual.',
                source: { source_id: query.source_id, source_name: 'Whisp' }, modality: assessment.provenance, dimension: 'geospatial_check', status: 'NAO_AVALIADO', technical_severity: 'INFO',
                message: assessment.reason ?? 'Resultado preservado para revisão contextual; sem conclusão de legalidade.', suggested_action: 'Conferir os indicadores, períodos e evidências antes da decisão humana.',
                values: { source_query_id: query.id, result_hash: query.result_hash, geometry_hash: query.geometry_hash }, assessment_scope: lot.assessment_scope } });
              await appendAuditEvent(tx, { streamId: lot.id, entityType: 'ORIGIN_LOT', entityId: lot.id, type: 'GEOSPATIAL_QUERY_RECORDED', actorId: actor.id,
                payload: { source_query_id: query.id, result_hash: query.result_hash, status: query.status } });
            });
          } catch {
            // Never log provider errors: their text may contain URLs, headers or credentials.
            const failed = { assessment: { result: 'NAO_AVALIADO', provenance: 'INDISPONIVEL', query_hash: queryHash,
              reason: 'Falha de configuração ou execução; não reenviar submissão incerta automaticamente.', ...(jobId ? { job_id: jobId } : {}) } };
            await prisma.sourceQuery.update({ where: { id: queryId }, data: { status: 'NAO_AVALIADO', result: json(failed), result_hash: sha256Canonical(failed),
              failure_reason: failed.assessment.reason } }).catch(() => app.log.error({ source_query_id: queryId }, 'Whisp: falha ao persistir; consulta permanece para inspeção manual.'));
          }
        })();
        running.add(task);
        void task.finally(() => running.delete(task));
      }
      return reply.code(result.statusCode).send(result.body);
    });
  }
  for (const url of ['/api/v1/lots/:id/assessments', '/api/v1/origin-lots/:id/geospatial-assessments']) {
    app.get<{ Params: { id: string } }>(url, { schema: { params } }, async (request, reply) => {
      const organization_id = request.authUser!.organization_id;
      const lot = await prisma.originLot.findFirst({ where: { id: request.params.id, organization_id }, select: { id: true } });
      if (!lot) return reply.code(404).send({ error: { code: 'LOT_NOT_FOUND', message: 'Lote não encontrado neste escopo.', request_id: request.id } });
      const assessments = await prisma.sourceQuery.findMany({ where: { lot_id: lot.id, organization_id }, orderBy: { created_at: 'desc' } });
      const sources = await prisma.source.findMany({ where: { id: { in: [...new Set(assessments.map(query => query.source_id))] } } });
      return { source_queries: assessments, assessments, sources };
    });
  }
}
