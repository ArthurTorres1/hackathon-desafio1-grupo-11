import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { debitAvailable, lockBalances } from '../../src/services/balances.js';
import { executeIdempotent } from '../../src/services/idempotency.js';
import { appendAuditEvent } from '../../src/services/audit-events.js';
import { sha256Canonical } from '../../src/services/integrity.js';

const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const producer = randomUUID(), mill = randomUUID(), operator = randomUUID(), receiver = randomUUID();
let app: Awaited<ReturnType<typeof buildServer>>;
type Session = { cookie: string; 'x-csrf-token': string };
let producerSession: Session, millSession: Session, plotId: string, documentId: string, parameterId: string;
async function login(userId: string): Promise<Session> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: userId } });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: response.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), 'x-csrf-token': response.json().csrf_token };
}
function post(path: string, payload: object, session = producerSession, key = randomUUID()) {
  return app.inject({ method: 'POST', url: `/api/v1/${path}`, headers: { ...session, 'idempotency-key': key }, payload });
}
async function origin() {
  const lot = await owner.originLot.create({ data: { code: `CUSTODY-${randomUUID()}`, organization_id: producer, plot_id: plotId, species_common: 'Sintética', species_scientific: 'Dinizia excelsa', authorized_volume_m3: '10', valid_from: new Date('2026-01-01'), valid_until: new Date('2027-12-31'), right_of_use: 'SIMULADO', data_provenance: { label: 'SIMULADA' }, created_by_user_id: operator } });
  await owner.permit.create({ data: { origin_lot_id: lot.id, reference: 'SIMULADA', issuing_authority: 'SIMULADA', official_system: 'NAO_VERIFICADO', document_id: documentId, valid_from: lot.valid_from, valid_until: lot.valid_until, volume_m3: '10', data_provenance: { label: 'SIMULADA' } } });
  await owner.balance.create({ data: { lot_id: lot.id, organization_id: producer } });
  return lot.id;
}
async function cut(lotId: string) {
  const response = await post('harvests', { origin_lot_id: lotId, start_date: '2026-11-05', end_date: '2026-11-05', volume_m3: '10' });
  expect(response.statusCode, response.body).toBe(201);
}
async function shipment(lotId: string) {
  const response = await post('shipments', { sender_organization_id: producer, recipient_organization_id: mill, origin_state: 'AM', destination_state: 'SP', route_states: ['AM','SP'], items: [{ lot_id: lotId, volume_m3: '10' }], transporter: 'SIMULADO', official_system: 'NAO_VERIFICADO', document_ids: [documentId] });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().shipment;
}
beforeAll(async () => {
  for (const [id, state] of [[producer,'AM'],[mill,'SP']]) await owner.organization.create({ data: { id, name: 'Custódia sintética', role: 'OPERATOR', state, municipality: 'Teste', data_provenance: { label: 'SIMULADA' } } });
  for (const [id, organization_id] of [[operator,producer],[receiver,mill]]) {
    await owner.user.create({ data: { id, organization_id, name: 'Operador sintético', roles: ['OPERATOR'] } });
    await owner.membership.create({ data: { user_id: id, organization_id, role: 'OPERATOR' } });
  }
  const plot = await owner.plot.create({ data: { organization_id: producer, state: 'AM', municipality: 'Teste', declared_property: 'SIMULADA', geometry: { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] }, geometry_hash: '0'.repeat(64), geometry_date: new Date('2026-11-05'), area_ha: '1.2', data_provenance: { label: 'SIMULADA' }, created_by_user_id: operator } });
  plotId = plot.id;
  const doc = await owner.document.create({ data: { organization_id: producer, name: 'SIMULADA', type: 'AUTHORIZATION', storage_key: randomUUID(), content_hash: '0'.repeat(64), content_type: 'text/plain', data_provenance: 'SIMULADA', source: 'Teste', allowed_organization_ids: [], created_by_user_id: operator } });
  documentId = doc.id;
  const parameter = await owner.conversionParameter.create({ data: { input_product: 'tora', output_product: 'serrado', coefficient: '0.35', regulation_reference: 'SIMULADA', source_url: 'https://example.invalid', version: randomUUID(), valid_from: new Date('2026-01-01'), data_provenance: 'SIMULADA' } });
  parameterId = parameter.id;
  app = await buildServer(); producerSession = await login(operator); millSession = await login(receiver);
});
afterAll(async () => { await app?.close(); await Promise.all([owner.$disconnect(), prisma.$disconnect()]); });

describe('custódia persistida com limites temporais, saldos e reconciliação', () => {
  it('preserva 12/10 como solicitação idempotente R07, sem corte ou crédito', async () => {
    const lotId = await origin(); const key = randomUUID();
    const payload = { origin_lot_id: lotId, start_date: '2026-11-05', end_date: '2026-11-05', volume_m3: '12' };
    const response = await post('harvests', payload, producerSession, key);
    const replay = await post('harvests', payload, producerSession, key);
    expect(response.statusCode, response.body).toBe(202); expect(replay.body).toBe(response.body);
    expect(response.json().check).toBe('R07');
    const pending = await owner.pendingOperationRequest.findUniqueOrThrow({ where: { id: response.json().pending_operation.id } });
    expect(pending.payload_hash).toBe(sha256Canonical(payload));
    expect(await owner.harvest.count({ where: { origin_lot_id: lotId } })).toBe(0);
    expect(await owner.balanceMovement.count({ where: { lot_id: lotId } })).toBe(0);
    expect(await owner.custodyEvent.count({ where: { stream_id: lotId, type: 'HARVEST_RECORDED' } })).toBe(0);
    expect((await owner.originLot.findUniqueOrThrow({ where: { id: lotId } })).harvested_volume_m3.toString()).toBe('0');
  });

  it('mantém corte fora da vigência pendente R04 e rejeita período invertido R06', async () => {
    const lotId = await origin();
    const response = await post('harvests', { origin_lot_id: lotId, start_date: '2028-01-01', end_date: '2028-01-02', volume_m3: '1' });
    expect(response.statusCode, response.body).toBe(202); expect(response.json().check).toBe('R04');
    const reversed = await post('harvests', { origin_lot_id: lotId, start_date: '2026-11-06', end_date: '2026-11-05', volume_m3: '1' });
    expect(reversed.statusCode).toBe(422); expect(reversed.json().error.code).toBe('R06');
    expect(await owner.harvest.count({ where: { origin_lot_id: lotId } })).toBe(0);
    expect((await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: producer } } })).available_m3.toString()).toBe('0');
  });

  it('valida datas e preserva diferença 10/9,9 em quarentena com movimentos e caso R09', async () => {
    const lotId = await origin(); await cut(lotId); const created = await shipment(lotId);
    const invalidDispatch = await post(`shipments/${created.id}/dispatch`, { occurred_at: '2020-01-01T00:00:00.000Z' });
    expect(invalidDispatch.statusCode).toBe(422); expect(invalidDispatch.json().error.code).toBe('R06');
    const dispatchTime = new Date().toISOString();
    expect((await post(`shipments/${created.id}/dispatch`, { occurred_at: dispatchTime })).statusCode).toBe(200);
    const invalidReceipt = await post(`shipments/${created.id}/receive`, { occurred_at: '2020-01-01T00:00:00.000Z', items: [{ lot_id: lotId, volume_m3: '9.9' }] }, millSession);
    expect(invalidReceipt.statusCode).toBe(422); expect(invalidReceipt.json().error.code).toBe('R06');
    const response = await post(`shipments/${created.id}/receive`, { occurred_at: new Date().toISOString(), items: [{ lot_id: lotId, volume_m3: '9.9' }] }, millSession);
    expect(response.statusCode, response.body).toBe(200); expect(response.json().shipment.status).toBe('RECEIVED_WITH_VARIANCE');
    expect(response.json().checks[0].difference_m3).toBe('0.1');
    const sender = await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: producer } } });
    const recipient = await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: mill } } });
    expect(sender.quarantined_m3.toString()).toBe('0.1'); expect(recipient.available_m3.toString()).toBe('9.9');
    expect(await owner.balanceMovement.count({ where: { entity_id: created.id, action: { in: ['RECEIPT_DEBIT','RECEIPT_CREDIT'] } } })).toBe(2);
    const check = await owner.check.findFirstOrThrow({ where: { entity_id: created.id, rule_id: 'R09' } });
    expect(check.rule_version).toBe('receipt-zero-v1');
    expect(await owner.auditCase.count({ where: { check_id: check.id } })).toBe(1);
  });

  it('exige recebimento e transforma 10→3 uma única vez com evento e resíduos persistidos', async () => {
    const lotId = await origin(); await cut(lotId);
    const payload = { code: randomUUID(), occurred_at: new Date().toISOString(), operator_organization_id: producer, conversion_parameter_id: parameterId, inputs: [{ lot_id: lotId, volume_m3: '10' }], outputs: [{ client_ref: randomUUID(), product: 'serrado', volume_m3: '3', allocations: [{ origin_lot_id: lotId, volume_m3: '3' }] }], residue_m3: '7', loss_m3: '0', assessment_scope: 'DEMONSTRATIVO' };
    const denied = await post('transformations', payload);
    expect(denied.statusCode).toBe(409); expect(denied.json().error.code).toBe('INPUT_NOT_RECEIVED');
    const created = await shipment(lotId);
    expect((await post(`shipments/${created.id}/dispatch`, { occurred_at: new Date().toISOString() })).statusCode).toBe(200);
    expect((await post(`shipments/${created.id}/receive`, { occurred_at: new Date().toISOString(), items: [{ lot_id: lotId, volume_m3: '10' }] }, millSession)).statusCode).toBe(200);
    const key = randomUUID(); const receivedPayload = { ...payload, occurred_at: new Date().toISOString(), operator_organization_id: mill };
    const response = await post('transformations', receivedPayload, millSession, key);
    const replay = await post('transformations', receivedPayload, millSession, key);
    expect(response.statusCode, response.body).toBe(201); expect(replay.body).toBe(response.body);
    const transformation = await owner.transformation.findUniqueOrThrow({ where: { id: response.json().transformation.id }, include: { inputs: true, outputs: true } });
    expect(transformation.residue_m3.toString()).toBe('7'); expect(transformation.loss_m3.toString()).toBe('0');
    expect(transformation.inputs[0]!.volume_m3.toString()).toBe('10'); expect(transformation.outputs[0]!.volume_m3.toString()).toBe('3');
    expect(await owner.custodyEvent.count({ where: { entity_id: transformation.id, type: 'TRANSFORMATION_RECORDED' } })).toBe(1);
    expect((await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: mill } } })).available_m3.toString()).toBe('0');
  });

  it('recebimento zero preserva todo o volume em reconciliação, sem crédito inventado', async () => {
    const lotId = await origin(); await cut(lotId); const created = await shipment(lotId);
    expect((await post(`shipments/${created.id}/dispatch`, { occurred_at: new Date().toISOString() })).statusCode).toBe(200);
    const response = await post(`shipments/${created.id}/receive`, { occurred_at: new Date().toISOString(), items: [{ lot_id: lotId, volume_m3: '0' }] }, millSession);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().shipment.status).toBe('RECEIVED_WITH_VARIANCE');
    expect((await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: producer } } })).quarantined_m3.toString()).toBe('10');
    expect((await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: mill } } })).available_m3.toString()).toBe('0');
    expect(await owner.balanceMovement.count({ where: { entity_id: created.id, action: 'RECEIPT_CREDIT' } })).toBe(0);
  });

  it('reverte débito e movimento quando o evento falha e calcula décimos sem arredondamento', async () => {
    const lotId = await origin();
    await owner.balance.update({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: producer } }, data: { available_m3: '0.3' } });
    const scope = { actorId: operator, operation: 'CUSTODY_ROLLBACK_TEST', key: randomUUID(), payload: { lot_id: lotId } };
    await expect(executeIdempotent(owner, scope, async tx => {
      await lockBalances(tx, producer, [lotId]); await debitAvailable(tx, producer, lotId, '0.1');
      await tx.balanceMovement.create({ data: { lot_id: lotId, organization_id: producer, entity_type: 'ORIGIN_LOT', entity_id: lotId, action: 'CONSUME', volume_m3: '0.1' } });
      await appendAuditEvent(tx, { streamId: lotId, entityId: lotId, entityType: 'ORIGIN_LOT', type: 'TEST', actorId: randomUUID(), payload: {} });
      return { statusCode: 201, body: {} };
    })).rejects.toThrow();
    const balance = () => owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: producer } } });
    expect((await balance()).available_m3.toString()).toBe('0.3');
    expect(await owner.balanceMovement.count({ where: { lot_id: lotId } })).toBe(0);
    expect(await owner.streamHead.count({ where: { stream_id: lotId } })).toBe(0);
    expect(await owner.idempotencyKey.count({ where: { key: scope.key } })).toBe(0);
    await owner.$transaction(async tx => { await lockBalances(tx, producer, [lotId]); await debitAvailable(tx, producer, lotId, '0.1'); await debitAvailable(tx, producer, lotId, '0.1'); });
    expect((await balance()).available_m3.toString()).toBe('0.1');
  });
});
