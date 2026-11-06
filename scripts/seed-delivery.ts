import 'dotenv/config';
import { buildServer } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/db.js';

if (process.env.DEMO_MODE !== 'true') throw new Error('Seed exige DEMO_MODE=true.');
const app = await buildServer();
const ids = { producer: '10000000-0000-4000-8000-000000000011', mill: '10000000-0000-4000-8000-000000000012', author: '20000000-0000-4000-8000-000000000011', receiver: '20000000-0000-4000-8000-000000000012', reviewer: '20000000-0000-4000-8000-000000000013', parameter: '50000000-0000-4000-8000-000000000011' };
const provenance = { label: 'SIMULADA', source: 'Seed entregável', informed_by: 'equipe', recorded_at: '2026-11-06T12:00:00Z', confidence: 'NAO_AVALIADA' };
type Session = Record<string, string>;
async function login(id: string): Promise<Session> {
  const result = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: id } });
  if (result.statusCode !== 200) throw new Error(result.body);
  return { cookie: result.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), 'x-csrf-token': result.json().csrf_token };
}
async function post(path: string, body: object, session: Session, key: string) {
  const result = await app.inject({ method: 'POST', url: `/api/v1/${path}`, payload: body, headers: { ...session, 'idempotency-key': `delivery-v1:${key}` } });
  if (result.statusCode >= 400) throw new Error(`${path}: ${result.body}`);
  return result.json();
}
// Persisted operation timestamps must stay identical on replay.
async function stableTime(key: string, userId: string, operation: string) {
  const existing = await prisma.idempotencyKey.findUnique({ where: { user_id_operation_key: { user_id: userId, operation, key: `delivery-v1:${key}` } } });
  if (!existing) return new Date().toISOString();
  const response = typeof existing.response === 'string' ? JSON.parse(existing.response) : existing.response as any;
  return operation.endsWith('/receive') ? response.shipment.received_at : response.shipment?.dispatched_at ?? response.transformation?.occurred_at ?? new Date().toISOString();
}
try {
  for (const [id, name, state] of [[ids.producer, 'Produtor entregável (SIMULADO)', 'AM'], [ids.mill, 'Serraria entregável (SIMULADA)', 'SP'], ['10000000-0000-4000-8000-000000000013', 'Destinatário RS entregável (SIMULADO)', 'RS']]) {
    await prisma.organization.upsert({ where: { id }, create: { id, name, state, role: 'OPERATOR', municipality: 'Demonstração', data_provenance: provenance }, update: {} });
  }
  for (const [id, organization_id, name, role] of [[ids.author, ids.producer, 'Autora entregável', 'OPERATOR'], [ids.receiver, ids.mill, 'Recebedor entregável', 'OPERATOR'], [ids.reviewer, ids.mill, 'Auditor entregável distinto', 'AUDITOR'], ['20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000013', 'Recebedor RS entregável', 'OPERATOR']]) {
    await prisma.user.upsert({ where: { id }, create: { id, organization_id, name, roles: [role!] }, update: {} });
    await prisma.membership.upsert({ where: { user_id_organization_id_role: { user_id: id!, organization_id: organization_id!, role: role! } }, create: { user_id: id!, organization_id: organization_id!, role: role! }, update: {} });
  }
  await prisma.conversionParameter.upsert({ where: { id: ids.parameter }, create: { id: ids.parameter, input_product: 'tora', output_product: 'serrado', coefficient: '0.35', regulation_reference: 'DEMONSTRATIVO', source_url: 'https://example.invalid/demo', version: 'delivery-v1', valid_from: new Date('2026-01-01'), data_provenance: 'SIMULADA' }, update: {} });
  const producer = await login(ids.author), mill = await login(ids.receiver), reviewer = await login(ids.reviewer);
  const document = await post('documents', { name: 'Autorização SIMULADA', type: 'AUTHORIZATION', content_base64: Buffer.from('SIMULADA - SEM VALIDADE OFICIAL').toString('base64'), source: 'Seed entregável', data_provenance: 'SIMULADA', assessment_scope: 'DEMONSTRATIVO', visibility: 'PRIVATE' }, producer, 'document');
  await post(`documents/${document.document.id}/grants`, { organization_id: ids.mill }, producer, 'document-grant');
  const plot = await post('plots', { organization_id: ids.producer, country: 'BR', state: 'AM', municipality: 'Demonstração', declared_property: 'Parcela sintética', geometry: { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] }, geometry_version: 1, geometry_date: '2026-11-06', data_provenance: { geometry: 'SIMULADA' } }, producer, 'plot');
  const origins: string[] = [];
  for (let index = 0; index < 5; index++) {
    const lot = await post('origin-lots', { plot_id: plot.plot.id, code: `DELIVERY-ORIGIN-${index}`, species_common_name: 'angelim-vermelho', species_scientific_name: 'Dinizia excelsa', authorized_volume_m3: '10', permit_reference: 'SIMULADA', permit_document_id: document.document.id, valid_from: '2026-01-01', valid_until: '2027-12-31', right_of_use: 'SIMULADO', assessment_scope: 'DEMONSTRATIVO', data_provenance: { volume: 'SIMULADA' } }, producer, `origin-${index}`);
    origins.push(lot.origin_lot.id);
    await post('harvests', { origin_lot_id: lot.origin_lot.id, start_date: '2026-11-05', end_date: '2026-11-05', volume_m3: '10' }, producer, `harvest-${index}`);
    const shipment = await post('shipments', { sender_organization_id: ids.producer, recipient_organization_id: ids.mill, origin_state: 'AM', destination_state: 'SP', route_states: ['AM','SP'], items: [{ lot_id: lot.origin_lot.id, volume_m3: '10' }], transporter: 'SIMULADO', official_system: 'NAO_VERIFICADO', document_ids: [document.document.id] }, producer, `shipment-${index}`);
    await post(`shipments/${shipment.shipment.id}/dispatch`, { occurred_at: await stableTime(`dispatch-${index}`, ids.author, 'POST /api/v1/shipments/:id/dispatch') }, producer, `dispatch-${index}`);
    await post(`shipments/${shipment.shipment.id}/receive`, { occurred_at: await stableTime(`receive-${index}`, ids.receiver, 'POST /api/v1/shipments/:id/receive'), items: [{ lot_id: lot.origin_lot.id, volume_m3: '10' }] }, mill, `receive-${index}`);
  }
  for (let index = 0; index < 4; index++) {
    const mixed = index === 2, unknown = index === 3, anomaly = index === 1;
    const inputIds = mixed ? [origins[2]!, origins[3]!] : [origins[index === 3 ? 4 : index]!];
    const output = anomaly ? '5' : '3';
    const result = await post('transformations', { code: `DELIVERY-${['A','LT-204','C','UNKNOWN'][index]}`, occurred_at: await stableTime(`transform-${index}`, ids.receiver, 'POST /api/v1/transformations'), operator_organization_id: ids.mill, conversion_parameter_id: ids.parameter, inputs: inputIds.map(lot_id => ({ lot_id, volume_m3: '10' })), outputs: [{ client_ref: `DELIVERY-PRODUCT-${index}`, product: 'serrado', volume_m3: output, allocations: mixed || unknown ? [{ origin_lot_id: inputIds[0], volume_m3: '1.8' }, { origin_lot_id: unknown ? null : inputIds[1], volume_m3: '1.2' }] : [{ origin_lot_id: inputIds[0], volume_m3: output }] }], residue_m3: String(inputIds.length * 10 - Number(output)), loss_m3: '0', assessment_scope: 'DEMONSTRATIVO' }, mill, `transform-${index}`);
    if (anomaly) {
      const auditCase = await prisma.auditCase.findFirstOrThrow({ where: { entity_id: result.transformation.id, rule_id: 'R10' } });
      await post(`audit-cases/${auditCase.id}/decisions`, { decision: 'MANTIDO_PENDENTE', comment: 'Revisor distinto: declaração demonstrativa mantida pendente; não há aprovação oficial de exceção.', evidence_ids: [document.document.id] }, reviewer, 'review-lt204');
    }
    const passport = await post('passports', { product_lot_id: result.outputs[0].product_lot.id, assessment_scope: 'DEMONSTRATIVO' }, mill, `passport-reviewed-${index}`);
    console.log(JSON.stringify({ scenario: index, product_id: result.outputs[0].product_lot.id, passport_id: passport.passport.id, public_path: `/p/${passport.passport.public_token}`, readiness: passport.readiness.readiness }));
  }
} finally { await app.close(); await prisma.$disconnect(); }
