import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { RegulatoryAssessmentCreateSchema, RegulatoryHistoryParamsSchema, RegulatoryRequirementQuerySchema, type RegulatoryAssessmentCreate } from '@foresttrace/contracts';
import { prisma } from '../db.js';
import { executeIdempotent } from './idempotency.js';
import { appendAuditEvent } from './audit-events.js';
import { assessRegulatoryRequirements, publicRegulatorySummary, type RegulatoryContext, type RegulatoryScope } from './regulatory.js';
import { sha256Canonical } from './integrity.js';
import { loadProductAncestry } from './ancestry.js';

type EntityType = RegulatoryAssessmentCreate['entity_type'];
type Actor = { id: string; organization_id: string; roles: string[] };
function fail(code: string, message: string, statusCode = 422): never { throw Object.assign(new Error(message), { code, statusCode }); }
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const day = (value: Date) => value.toISOString().slice(0, 10);
const authorize = (actor: Actor) => {
  if (!actor.roles.some(role => ['OPERATOR','AUDITOR','REGULATOR'].includes(role))) fail('R20', 'Perfil sem acesso à avaliação normativa.', 403);
};

/** Derives national/local scopes from persisted operation, never from client-supplied UFs. */
async function operationContext(tx: Prisma.TransactionClient, actor: Actor, input: RegulatoryAssessmentCreate): Promise<RegulatoryContext> {
  const scopes: RegulatoryScope[] = [];
  const addScope = (jurisdiction: string, phase: RegulatoryScope['phase']) => {
    for (const value of ['BR', jurisdiction]) if (!scopes.some(scope => scope.jurisdiction === value && scope.phase === phase)) scopes.push({ jurisdiction: value, phase });
  };
  let products: string[]; let occurred_on: string; let official_system: string; let entity_version: number;
  let assessment_scope: 'REAL' | 'DEMONSTRATIVO';
  if (input.entity_type === 'ORIGIN_LOT') {
    const lot = await tx.originLot.findFirst({ where: { id: input.entity_id, organization_id: actor.organization_id }, include: { plot: true, permits: true } });
    if (!lot) fail('NOT_FOUND', 'Operação não encontrada neste escopo.', 404);
    addScope(lot.plot.state, 'ORIGIN'); products = ['tora']; entity_version = lot.version;
    assessment_scope = lot.assessment_scope === 'REAL' ? 'REAL' : 'DEMONSTRATIVO';
    occurred_on = input.occurred_on ?? day(lot.created_at);
    const systems = [...new Set(lot.permits.map(permit => permit.official_system))];
    official_system = systems.length === 1 ? systems[0]! : 'NAO_VERIFICADO';
  } else if (input.entity_type === 'SHIPMENT') {
    const shipment = await tx.shipment.findFirst({ where: { id: input.entity_id, OR: [{ sender_id: actor.organization_id }, { recipient_id: actor.organization_id }] }, include: { items: true } });
    if (!shipment) fail('NOT_FOUND', 'Operação não encontrada neste escopo.', 404);
    addScope(shipment.origin_state, 'ORIGIN'); addScope(shipment.destination_state, 'DESTINATION');
    for (const state of new Set([shipment.origin_state, ...shipment.route_states, shipment.destination_state])) addScope(state, 'TRANSPORT');
    const lotIds = shipment.items.map(item => item.lot_id);
    const origins = await tx.originLot.findMany({ where: { id: { in: lotIds } }, select: { assessment_scope: true } });
    const outputs = await tx.productLot.findMany({ where: { id: { in: lotIds } }, select: { product: true, assessment_scope: true } });
    products = [...new Set([...(origins.length ? ['tora'] : []), ...outputs.map(output => output.product)])];
    assessment_scope = [...origins, ...outputs].length > 0 && [...origins, ...outputs].every(lot => lot.assessment_scope === 'REAL') ? 'REAL' : 'DEMONSTRATIVO';
    occurred_on = day(shipment.dispatched_at ?? shipment.declared_at); official_system = shipment.official_system; entity_version = shipment.version;
  } else {
    const transformation = await tx.transformation.findFirst({ where: { id: input.entity_id, organization_id: actor.organization_id }, include: { outputs: true } });
    if (!transformation) fail('NOT_FOUND', 'Operação não encontrada neste escopo.', 404);
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: actor.organization_id } });
    addScope(organization.state, 'TRANSFORMATION'); products = [...new Set(transformation.outputs.map(output => output.product))];
    assessment_scope = transformation.assessment_scope === 'REAL' ? 'REAL' : 'DEMONSTRATIVO';
    occurred_on = day(transformation.occurred_at); official_system = input.official_system ?? 'NAO_VERIFICADO'; entity_version = transformation.version;
  }
  return { scopes, products, modality: input.modality, official_system, occurred_on, entity_version, assessment_scope };
}

/** Returns only coverage/count/phases for the current persisted version/context. */
export async function regulatorySummaryForEntity(tx: Prisma.TransactionClient, organizationId: string, entityType: EntityType, entityId: string) {
  const latest = await tx.regulatoryAssessment.findFirst({ where: { organization_id: organizationId, entity_type: entityType, entity_id: entityId }, orderBy: { version: 'desc' } });
  const stored = latest?.context as unknown as RegulatoryContext | undefined;
  if (!latest || !stored?.modality || !latest.context_hash) return publicRegulatorySummary(null);
  try {
    const context = await operationContext(tx, { organization_id: organizationId, id: '', roles: [] }, {
      entity_type: entityType, entity_id: entityId, modality: stored.modality,
      official_system: stored.official_system, occurred_on: stored.occurred_on,
    });
    const rules = await tx.regulatoryRequirement.findMany({ where: { jurisdiction: { in: context.scopes.map(scope => scope.jurisdiction) } } });
    const current = assessRegulatoryRequirements(rules, context);
    if (current.context_hash !== latest.context_hash || sha256Canonical(json(current.requirements)) !== sha256Canonical(latest.requirements)) return publicRegulatorySummary(null);
    return publicRegulatorySummary(latest);
  } catch { return publicRegulatorySummary(null); }
}

/** Coverage of the complete persisted ancestry, with no private fields in the result. */
export async function regulatorySummaryForProduct(tx: Prisma.TransactionClient, productId: string) {
  try {
    const ancestry = await loadProductAncestry(tx, productId);
    const targets: Array<{ organization_id: string; type: EntityType; id: string }> = [
      ...ancestry.origin_lots.map(lot => ({ organization_id: lot.organization_id as string, type: 'ORIGIN_LOT', id: lot.id })),
      ...ancestry.shipments.map(shipment => ({ organization_id: shipment.sender_id as string, type: 'SHIPMENT', id: shipment.id })),
      ...ancestry.transformations.map(transformation => ({ organization_id: transformation.organization_id as string, type: 'TRANSFORMATION', id: transformation.id })),
    ];
    if (!targets.length) return publicRegulatorySummary(null);
    const summaries = await Promise.all(targets.map(target => regulatorySummaryForEntity(tx, target.organization_id, target.type, target.id)));
    const coverage = summaries.some(summary => summary.coverage === 'CONFLITANTE') ? 'CONFLITANTE' as const
      : summaries.every(summary => summary.coverage === 'CONFIRMADA') ? 'CONFIRMADA' as const : 'PENDENTE_DE_VERIFICACAO' as const;
    return { coverage, gap_count: summaries.reduce((sum, summary) => sum + summary.gap_count, 0), pending_phases: [...new Set(summaries.flatMap(summary => summary.pending_phases))] };
  } catch { return publicRegulatorySummary(null); }
}

export function registerRegulatoryRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { jurisdiction?: string; phase?: string } }>('/api/v1/regulatory/requirements', { schema: { querystring: RegulatoryRequirementQuerySchema } }, async request => {
    authorize(request.authUser!);
    return { requirements: await prisma.regulatoryRequirement.findMany({ where: request.query, orderBy: [{ jurisdiction: 'asc' }, { checked_at: 'desc' }] }) };
  });

  app.post<{ Body: RegulatoryAssessmentCreate }>('/api/v1/regulatory/assessments', { schema: { body: RegulatoryAssessmentCreateSchema } }, async (request, reply) => {
    const actor = request.authUser!; authorize(actor);
    const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/regulatory/assessments', key: request.idempotencyKey!, payload: request.body }, async tx => {
      const context = await operationContext(tx, actor, request.body);
      const rules = await tx.regulatoryRequirement.findMany({ where: { jurisdiction: { in: [...new Set(context.scopes.map(scope => scope.jurisdiction))] } } });
      const result = assessRegulatoryRequirements(rules, context);
      const previous = await tx.regulatoryAssessment.findFirst({ where: { organization_id: actor.organization_id, entity_type: request.body.entity_type, entity_id: request.body.entity_id }, orderBy: { version: 'desc' } });
      const assessment = await tx.regulatoryAssessment.create({ data: { organization_id: actor.organization_id,
        entity_type: request.body.entity_type, entity_id: request.body.entity_id, coverage: result.coverage,
        requirements: json(result.requirements), gaps: json(result.gaps), version: (previous?.version ?? 0) + 1,
        context: json(result.context), context_hash: result.context_hash, created_by_user_id: actor.id,
      } });
      await tx.check.create({ data: { organization_id: actor.organization_id, entity_type: request.body.entity_type,
        entity_id: request.body.entity_id, rule_id: 'REGULATORY_COVERAGE', rule_version: '1',
        name: 'Cobertura normativa por contexto', description: 'Aplicabilidade de fontes e requisitos; conferência documental é uma etapa separada.',
        source: { assessment_id: assessment.id }, modality: context.modality, dimension: 'documentary_check',
        status: result.coverage === 'CONFIRMADA' ? 'NAO_AVALIADO' : 'PENDENTE', technical_severity: 'INFO',
        message: result.coverage === 'CONFIRMADA' ? 'Requisitos selecionados; evidências ainda exigem conferência.' : 'Cobertura normativa pendente ou conflitante.',
        suggested_action: 'Conferir requisitos, fontes e evidências no escopo da operação.',
        values: { coverage: result.coverage, gap_count: result.gaps.length }, assessment_scope: context.assessment_scope,
      } });
      await appendAuditEvent(tx, { streamId: request.body.entity_id, entityType: request.body.entity_type, entityId: request.body.entity_id,
        type: 'REGULATORY_ASSESSMENT_RECORDED', actorId: actor.id, payload: { assessment_id: assessment.id, version: assessment.version, coverage: assessment.coverage, context_hash: result.context_hash } });
      return { statusCode: 201, body: { assessment, public_summary: publicRegulatorySummary(assessment), disclaimer: 'Cobertura de requisitos não comprova evidências nem aprova a operação.' } };
    });
    return reply.code(result.statusCode).send(result.body);
  });

  app.get<{ Params: { entity_type: EntityType; entity_id: string } }>('/api/v1/regulatory/assessments/:entity_type/:entity_id', { schema: { params: RegulatoryHistoryParamsSchema } }, async request => {
    const actor = request.authUser!; authorize(actor);
    // Check persisted ownership/relation before returning history, including empty histories.
    await operationContext(prisma, actor, { ...request.params, modality: 'HISTORY_QUERY' });
    const assessments = await prisma.regulatoryAssessment.findMany({ where: { organization_id: actor.organization_id, ...request.params }, orderBy: { version: 'desc' } });
    return { assessments, public_summary: await regulatorySummaryForEntity(prisma, actor.organization_id, request.params.entity_type, request.params.entity_id) };
  });
}
