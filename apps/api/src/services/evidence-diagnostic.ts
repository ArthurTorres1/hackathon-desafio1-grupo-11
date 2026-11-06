import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { EvidenceDiagnosticSchema } from '@foresttrace/contracts';
import { prisma } from '../db.js';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function fieldProvenance(entity: { data_provenance: unknown; created_by_user_id?: string; created_at?: Date }, field: string) {
  const root = object(entity.data_provenance);
  const original = root[field] ?? (typeof root.label === 'string' ? root : 'NAO_VERIFICADA');
  if (typeof original === 'object' && original !== null) return original;
  return { label: original, source: 'Fonte detalhada não informada no registro original',
    informed_by: entity.created_by_user_id ?? 'NAO_INFORMADO', recorded_at: entity.created_at?.toISOString() ?? null,
    confidence: 'NAO_AVALIADA' };
}

/** Private diagnostic export preserves field and evidence labels without promoting simulations. */
export function registerEvidenceDiagnosticRoutes(app: FastifyInstance) {
  for (const url of ['/api/v1/origin-lots/:id/evidence-diagnostic', '/api/v1/origin-lots/:id/evidence-diagnostic/export']) {
    app.get<{ Params: { id: string } }>(url, { schema: {
      tags: ['Evidências e proveniência'], params: Type.Object({ id: Type.String({ format: 'uuid' }) }, { additionalProperties: false }),
      response: { 200: EvidenceDiagnosticSchema },
    } }, async (request, reply) => {
      const actor = request.authUser!;
      const lot = await prisma.originLot.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id }, include: { plot: true, permits: true } });
      if (!lot) return reply.code(404).send({ error: { code: 'LOT_NOT_FOUND', message: 'Lote não encontrado neste escopo.', request_id: request.id } });
      const [documents, queries] = await Promise.all([
        prisma.document.findMany({ where: { id: { in: lot.permits.map(permit => permit.document_id) }, organization_id: actor.organization_id },
          select: { id: true, type: true, name: true, source: true, data_provenance: true, content_hash: true, version: true, created_by_user_id: true, created_at: true } }),
        prisma.sourceQuery.findMany({ where: { lot_id: lot.id, organization_id: actor.organization_id }, orderBy: { created_at: 'asc' } }),
      ]);
      const sources = await prisma.source.findMany({ where: { id: { in: [...new Set(queries.map(query => query.source_id))] } } });
      const fields = [
        ...['geometry', 'declared_property', 'state', 'municipality'].map(field => ({ entity_type: 'PLOT', entity_id: lot.plot.id, field,
          value: (lot.plot as unknown as Record<string, unknown>)[field], provenance: fieldProvenance(lot.plot, field) })),
        ...['authorized_volume_m3', 'right_of_use', 'species_common', 'species_scientific'].map(field => ({ entity_type: 'ORIGIN_LOT', entity_id: lot.id, field,
          value: (lot as unknown as Record<string, unknown>)[field], provenance: fieldProvenance(lot, field) })),
      ];
      if (url.endsWith('/export')) reply.header('content-disposition', `attachment; filename="foresttrace-evidence-${lot.id}.json"`);
      return { schema_version: '1', generated_at: new Date().toISOString(), origin_lot_id: lot.id,
        assessment_scope: lot.assessment_scope, regulatory_coverage: 'PENDENTE_DE_VERIFICACAO',
        fields, documents, sources, source_queries: queries,
        limitations: ['Diagnóstico de evidências declaradas; não confirma propriedade, autorização ou legalidade.',
          'Rótulos de geometria, documentos e consultas permanecem independentes.',
          'Ausência de consulta ou documento não corresponde a PASSOU. Evidência simulada não se torna real por associação.'] };
    });
  }
}
