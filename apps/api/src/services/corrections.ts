import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { Prisma } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { prisma } from '../db.js';
import { appendAuditEvent } from './audit-events.js';
import { executeIdempotent, requireIdempotencyKey } from './idempotency.js';
import { readDocument } from './document-storage.js';
import { sha256Bytes } from './integrity.js';

type EntityType = 'ORIGIN_LOT' | 'SHIPMENT' | 'TRANSFORMATION';
type CorrectionInput = { entity_type: EntityType; entity_id: string; expected_version: number;
  reason: string; changes: Record<string, unknown>; evidence_ids: string[] };
const fail = (code: string, message: string, statusCode = 422) => { throw Object.assign(new Error(message), { code, statusCode }); };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const fields: Record<EntityType, string[]> = {
  ORIGIN_LOT: ['species_common', 'species_scientific', 'right_of_use', 'valid_from', 'valid_until', 'authorized_volume_m3'],
  SHIPMENT: ['carrier', 'official_system', 'origin_state', 'destination_state', 'route_states', 'declared_at', 'dispatched_at', 'received_at'],
  TRANSFORMATION: ['occurred_at', 'residue_m3', 'loss_m3'],
};

/** Quantities already consumed and historical allocations are never overwritten by a correction. */
export function validateCorrectionChanges(type: EntityType, changes: Record<string, unknown>) {
  if (!Object.keys(changes).length) fail('CORRECTION_EMPTY', 'Informe pelo menos um campo a retificar.');
  if (Object.keys(changes).some(field => !fields[type].includes(field))) fail('CORRECTION_FIELD_FORBIDDEN', 'Campo imutável ou não retificável. Entradas, saídas, recebimentos e alocações históricas exigem reconciliação, sem edição direta.');
  for (const [field, value] of Object.entries(changes)) {
    if (field.endsWith('_m3')) {
      if (typeof value !== 'string' || !/^\d+(\.\d{1,6})?$/.test(value)) fail('CORRECTION_VOLUME_INVALID', 'Informe volumes decimais não negativos com até seis casas.');
    } else if (field === 'route_states') {
      if (!Array.isArray(value) || value.some(state => typeof state !== 'string' || !states.includes(state))) fail('CORRECTION_STATE_INVALID', 'Percurso contém UF inválida.');
    } else if (typeof value !== 'string' || !value.trim()) fail('CORRECTION_VALUE_INVALID', 'Valores de retificação devem ser preenchidos.');
    if (['origin_state', 'destination_state'].includes(field) && !states.includes(String(value))) fail('CORRECTION_STATE_INVALID', 'UF inválida.');
    if (['valid_from', 'valid_until', 'occurred_at', 'declared_at', 'dispatched_at', 'received_at'].includes(field) &&
      (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10))) fail('CORRECTION_DATE_INVALID', 'Data de retificação inválida; use data ISO ou horário UTC.');
  }
}
const states = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

async function affectedGraph(tx: Prisma.TransactionClient, input: CorrectionInput) {
  const lots = new Set<string>();
  const transformations = new Set<string>();
  const shipments = new Set<string>();
  if (input.entity_type === 'ORIGIN_LOT') lots.add(input.entity_id);
  if (input.entity_type === 'SHIPMENT') {
    shipments.add(input.entity_id);
    for (const item of await tx.shipmentItem.findMany({ where: { shipment_id: input.entity_id } })) lots.add(item.lot_id);
  }
  if (input.entity_type === 'TRANSFORMATION') {
    transformations.add(input.entity_id);
    for (const output of await tx.productLot.findMany({ where: { transformation_id: input.entity_id } })) lots.add(output.id);
  }
  let frontier = [...lots];
  while (frontier.length) {
    const rows = await tx.transformation.findMany({ where: { inputs: { some: { lot_id: { in: frontier } } } }, include: { outputs: true } });
    frontier = [];
    for (const row of rows) {
      transformations.add(row.id);
      for (const output of row.outputs) if (!lots.has(output.id)) { lots.add(output.id); frontier.push(output.id); }
    }
  }
  for (const row of await tx.shipment.findMany({ where: { items: { some: { lot_id: { in: [...lots] } } } } })) shipments.add(row.id);
  return { lots: [...lots].sort(), transformations: [...transformations].sort(), shipments: [...shipments].sort() };
}

export async function applyCorrection(tx: Prisma.TransactionClient, actor: { id: string; organization_id: string }, input: CorrectionInput) {
  validateCorrectionChanges(input.entity_type, input.changes);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`correction:${input.entity_id}`}, 0))`;
  const previous = input.entity_type === 'ORIGIN_LOT' ? await tx.originLot.findUnique({ where: { id: input.entity_id } }) :
    input.entity_type === 'SHIPMENT' ? await tx.shipment.findUnique({ where: { id: input.entity_id } }) :
    await tx.transformation.findUnique({ where: { id: input.entity_id } });
  if (!previous || ('sender_id' in previous ? previous.sender_id : previous.organization_id) !== actor.organization_id) fail('ENTITY_NOT_FOUND', 'Registro não encontrado neste escopo.', 404);
  const record = previous!;
  if (record.version !== input.expected_version) fail('CORRECTION_VERSION_CONFLICT', 'O registro mudou; consulte a versão atual antes de retificar.', 409);
  const evidence = await tx.document.findMany({ where: { id: { in: input.evidence_ids }, organization_id: actor.organization_id } });
  if (!input.evidence_ids.length || evidence.length !== new Set(input.evidence_ids).size) fail('CORRECTION_EVIDENCE_REQUIRED', 'Vincule documentos acessíveis que respaldem a retificação.');
  for (const document of evidence) {
    let bytes: Buffer;
    try { bytes = await readDocument(document.storage_key); } catch { fail('CORRECTION_EVIDENCE_UNAVAILABLE', 'Documento de respaldo indisponível.'); }
    if (sha256Bytes(bytes!) !== document.content_hash) fail('R18', 'O documento de respaldo não confere com o hash preservado.', 409);
  }
  const changes = { ...input.changes };
  for (const field of ['valid_from','valid_until','occurred_at','declared_at','dispatched_at','received_at']) if (field in changes) changes[field] = new Date(String(changes[field]));
  const corrected = { ...record, ...changes } as Record<string, any>;
  if (input.entity_type === 'ORIGIN_LOT') {
    const authorized = new Decimal(corrected.authorized_volume_m3.toString());
    if (authorized.lte(0) || authorized.lt(corrected.harvested_volume_m3.toString())) fail('R07', 'A retificação não pode deixar o corte acima do volume autorizado.');
    if (corrected.valid_from > corrected.valid_until) fail('CORRECTION_PERIOD_INVALID', 'Vigência inicial posterior à final.');
    const harvests = await tx.harvest.findMany({ where: { origin_lot_id: input.entity_id } });
    if (harvests.some(h => h.period_start < corrected.valid_from || h.period_end > corrected.valid_until)) fail('R06', 'A vigência retificada não pode excluir cortes já registrados.');
    if ('authorized_volume_m3' in changes && authorized.gt((record as { authorized_volume_m3: Decimal }).authorized_volume_m3.toString())) {
      const permit = await tx.permit.findFirst({ where: { origin_lot_id: input.entity_id, document_id: { in: input.evidence_ids }, volume_m3: { gte: authorized.toFixed() }, valid_from: { lte: corrected.valid_from }, valid_until: { gte: corrected.valid_until } } });
      if (!permit) fail('AUTHORIZATION_ADJUSTMENT_REQUIRED', 'Aumento exige autorização competente vinculada, com volume e vigência suficientes; justificativa interna não cria saldo.');
    }
  }
  if (input.entity_type === 'SHIPMENT') {
    if (corrected.dispatched_at && corrected.dispatched_at < corrected.declared_at || corrected.received_at && (!corrected.dispatched_at || corrected.received_at < corrected.dispatched_at)) fail('R06', 'Datas de remessa fora da sequência declaração, expedição e recebimento.');
    // A destination change cannot rewrite the authenticated custodian organizations.
    const [sender, recipient] = await Promise.all([tx.organization.findUnique({ where: { id: corrected.sender_id } }), tx.organization.findUnique({ where: { id: corrected.recipient_id } })]);
    if (sender?.state !== corrected.origin_state || recipient?.state !== corrected.destination_state) fail('CORRECTION_STATE_INVALID', 'UF deve corresponder às organizações remetente e destinatária preservadas.');
  }
  if (input.entity_type === 'TRANSFORMATION') {
    const inputs = await tx.transformationInput.findMany({ where: { transformation_id: input.entity_id } });
    const outputs = await tx.productLot.findMany({ where: { transformation_id: input.entity_id } });
    const totalIn = inputs.reduce((s, i) => s.plus(i.volume_m3.toString()), new Decimal(0));
    const totalOut = outputs.reduce((s, o) => s.plus(o.volume_m3.toString()), new Decimal(0));
    if (totalOut.plus(String(corrected.residue_m3)).plus(String(corrected.loss_m3)).gt(totalIn)) fail('R08', 'Saídas, resíduos e perdas não podem superar as entradas preservadas.');
    const parameter = await tx.conversionParameter.findUniqueOrThrow({ where: { id: corrected.conversion_parameter_id } });
    const day = corrected.occurred_at.toISOString().slice(0, 10);
    if (day < parameter.valid_from.toISOString().slice(0, 10) || parameter.valid_until && day > parameter.valid_until.toISOString().slice(0, 10)) fail('CRV_PARAMETER_EXPIRED', 'Data retificada fora da vigência do parâmetro de conversão.');
  }
  const graph = await affectedGraph(tx, input);
  // In-flight reservations require their own operational reconciliation before correction.
  const balances = await tx.balance.findMany({ where: { lot_id: { in: graph.lots } }, orderBy: { id: 'asc' } });
  if (balances.some(balance => balance.reserved_m3.gt(0)) || await tx.shipment.count({ where: { id: { in: graph.shipments }, status: { in: ['DISPATCHED', 'IN_TRANSIT'] } } })) fail('CORRECTION_RECONCILIATION_REQUIRED', 'Há reserva ou transporte em curso. Reconcilie a custódia antes de retificar.', 409);
  const version = record.version + 1;
  const previousData = json(record); const correctedData = json({ ...corrected, version });
  const saved = await tx.correction.create({ data: { organization_id: actor.organization_id, entity_type: input.entity_type, entity_id: input.entity_id,
    previous_version: record.version, new_version: version, previous_data: previousData, corrected_data: correctedData,
    reason: input.reason.trim(), created_by_user_id: actor.id } });
  const update = { ...changes, version };
  if (input.entity_type === 'ORIGIN_LOT') await tx.originLot.update({ where: { id: input.entity_id }, data: update });
  else if (input.entity_type === 'SHIPMENT') await tx.shipment.update({ where: { id: input.entity_id }, data: update });
  else await tx.transformation.update({ where: { id: input.entity_id }, data: update });
  for (const balance of balances) {
    if (balance.available_m3.lte(0)) continue;
    await tx.balance.update({ where: { id: balance.id }, data: { available_m3: '0', quarantined_m3: { increment: balance.available_m3 } } });
    await tx.balanceMovement.create({ data: { lot_id: balance.lot_id, organization_id: balance.organization_id, entity_type: 'CORRECTION', entity_id: saved.id, action: 'CORRECTION_QUARANTINE', volume_m3: balance.available_m3 } });
  }
  const affected = new Map<string, { type: string; org: string; author: string }>();
  affected.set(input.entity_id, { type: input.entity_type, org: actor.organization_id, author: actor.id });
  for (const transformation of await tx.transformation.findMany({ where: { id: { in: graph.transformations } } })) affected.set(transformation.id, { type: 'TRANSFORMATION', org: transformation.organization_id, author: transformation.created_by_user_id });
  for (const product of await tx.productLot.findMany({ where: { id: { in: graph.lots } } })) affected.set(product.id, { type: 'PRODUCT_LOT', org: product.organization_id, author: product.created_by_user_id });
  for (const shipment of await tx.shipment.findMany({ where: { id: { in: graph.shipments } } })) affected.set(shipment.id, { type: 'SHIPMENT', org: shipment.sender_id, author: shipment.created_by_user_id });
  for (const [entityId, entity] of affected) {
    const check = await tx.check.create({ data: { organization_id: entity.org, entity_type: entity.type, entity_id: entityId, rule_id: 'R19', rule_version: '1', name: 'Retificação exige reconciliação', description: 'Registro ou ancestral retificado; histórico preservado e descendentes em revisão.', source: { correction_id: saved.id }, modality: 'CORRECTION', dimension: 'chain_of_custody_check', status: 'ALERTA', technical_severity: 'HIGH', message: 'Retificação pendente de reconciliação; volume disponível movido para quarentena.', suggested_action: 'Reconciliar versões e evidências antes de nova revisão.', values: { correction_id: saved.id, previous_version: record.version, new_version: version }, assessment_scope: 'REAL' } });
    await tx.auditCase.create({ data: { organization_id: entity.org, check_id: check.id, entity_type: entity.type, entity_id: entityId, created_by_user_id: entityId === input.entity_id ? actor.id : entity.author, rule_id: 'R19' } });
    await appendAuditEvent(tx, { streamId: entityId, entityType: entity.type, entityId, type: entityId === input.entity_id ? 'CORRECTION_RECORDED' : 'ANCESTOR_CORRECTION_BLOCKED', actorId: actor.id, payload: { correction_id: saved.id, corrected_entity_id: input.entity_id, previous_version: record.version, new_version: version, evidence_ids: input.evidence_ids, reason: input.reason, balances_compensated: true } });
  }
  return { correction: saved, affected_lot_ids: graph.lots, reconciliation_required: true };
}

export function registerCorrectionRoutes(app: FastifyInstance) {
  app.post<{ Body: CorrectionInput }>('/api/v1/corrections', { schema: { body: Type.Object({
    entity_type: Type.Union([Type.Literal('ORIGIN_LOT'), Type.Literal('SHIPMENT'), Type.Literal('TRANSFORMATION')]),
    entity_id: Type.String({ format: 'uuid' }), expected_version: Type.Integer({ minimum: 1 }), reason: Type.String({ minLength: 1 }),
    changes: Type.Record(Type.String(), Type.Unknown()), evidence_ids: Type.Array(Type.String({ format: 'uuid' }), { minItems: 1, uniqueItems: true }),
  }, { additionalProperties: false }) } }, async (request, reply) => {
    try {
      if (!request.body.reason.trim()) fail('CORRECTION_REASON_REQUIRED', 'Informe uma justificativa.');
      const actor = request.authUser!;
      const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/corrections', key: requireIdempotencyKey(request.headers['idempotency-key']), payload: request.body }, async tx => ({ statusCode: 201, body: await applyCorrection(tx, actor, request.body) }));
      return reply.code(result.statusCode).send(result.body);
    } catch (error) {
      const e = error as Error & { code?: string; statusCode?: number };
      return reply.code(e.statusCode ?? 422).send({ error: { code: e.code ?? 'CORRECTION_REJECTED', message: e.message, request_id: request.id } });
    }
  });
  app.get<{ Params: { type: EntityType; id: string } }>('/api/v1/corrections/:type/:id', { schema: { params: Type.Object({ type: Type.Union([Type.Literal('ORIGIN_LOT'),Type.Literal('SHIPMENT'),Type.Literal('TRANSFORMATION')]), id: Type.String({ format: 'uuid' }) }) } }, async request => ({ corrections: await prisma.correction.findMany({ where: { entity_type: request.params.type, entity_id: request.params.id, organization_id: request.authUser!.organization_id }, orderBy: { new_version: 'asc' } }) }));
}
