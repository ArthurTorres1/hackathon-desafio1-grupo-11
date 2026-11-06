import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { sha256Canonical } from '../../src/services/integrity.js';

const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const organizationId = randomUUID(); const buyerId = randomUUID(); const authorId = randomUUID(); const reviewerId = randomUUID();
const parameterId = randomUUID();
let app: Awaited<ReturnType<typeof buildServer>>; let storage: string;
type Session = { cookie: string; 'x-csrf-token': string };
let author: Session; let reviewer: Session; let invoiceId: string;
const geometry = { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] };
async function login(id: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: id } });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: response.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), 'x-csrf-token': response.json().csrf_token };
}
async function post(path: string, payload: unknown, session = author, key = randomUUID()) {
  return app.inject({ method: 'POST', url: `/api/v1/${path}`, headers: { ...session, 'idempotency-key': key }, payload: payload as object });
}
beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), 'foresttrace-delivery-')); process.env.PRIVATE_STORAGE_DIR = storage;
  await owner.organization.createMany({ data: [organizationId, buyerId].map(id => ({ id, name: 'Entrega sintética isolada', role: 'OPERATOR', state: 'AM', municipality: 'Teste', data_provenance: { label: 'SIMULADA' } })) });
  await owner.user.createMany({ data: [{ id: authorId, name: 'Autor', organization_id: organizationId, roles: ['OPERATOR','AUDITOR'] }, { id: reviewerId, name: 'Revisora distinta', organization_id: organizationId, roles: ['AUDITOR'] }] });
  await owner.membership.createMany({ data: [{ user_id: authorId, organization_id: organizationId, role: 'OPERATOR' }, { user_id: authorId, organization_id: organizationId, role: 'AUDITOR' }, { user_id: reviewerId, organization_id: organizationId, role: 'AUDITOR' }] });
  await owner.conversionParameter.create({ data: { id: parameterId, input_product: 'tora', output_product: 'serrado', coefficient: '0.35', regulation_reference: 'SIMULADA', source_url: 'https://example.invalid', version: randomUUID(), valid_from: new Date('2026-01-01'), data_provenance: 'SIMULADA' } });
  app = await buildServer(); author = await login(authorId); reviewer = await login(reviewerId);
  const invoice = await post('documents', { name: 'NF-e-sintetica.txt', type: 'NFE', content_base64: Buffer.from('NOTA FICTÍCIA SEM VALOR FISCAL').toString('base64'), source: 'Teste sintético', data_provenance: 'SIMULADA', assessment_scope: 'DEMONSTRATIVO', visibility: 'PRIVATE', fiscal_key: `SIMULADA-${randomUUID()}` });
  expect(invoice.statusCode, invoice.body).toBe(201); invoiceId = invoice.json().document.id;
});
afterAll(async () => { await app?.close(); await Promise.all([owner.$disconnect(), prisma.$disconnect()]); if (storage) await rm(storage, { recursive: true, force: true }); });

async function inputLots() {
  const lots = [];
  for (const volume of ['6','4']) {
    const plot = await owner.plot.create({ data: { organization_id: organizationId, state: 'AM', municipality: 'Teste', declared_property: 'Sintética', geometry, geometry_hash: sha256Canonical(geometry), geometry_date: new Date('2026-01-01'), area_ha: '1.23', data_provenance: { label: 'SIMULADA' }, created_by_user_id: authorId } });
    const lot = await owner.originLot.create({ data: { code: randomUUID(), organization_id: organizationId, plot_id: plot.id, species_common: 'Angelim', species_scientific: 'Dinizia excelsa', authorized_volume_m3: volume, harvested_volume_m3: volume, valid_from: new Date('2026-01-01'), valid_until: new Date('2027-12-31'), right_of_use: 'SIMULADO', data_provenance: { label: 'SIMULADA' }, created_by_user_id: authorId } });
    await owner.permit.create({ data: { origin_lot_id: lot.id, reference: 'SIMULADA', issuing_authority: 'Teste', official_system: 'NAO_VERIFICADO', document_id: invoiceId, valid_from: new Date('2026-01-01'), valid_until: new Date('2027-12-31'), volume_m3: volume, data_provenance: { label: 'SIMULADA' } } });
    await owner.balance.create({ data: { lot_id: lot.id, organization_id: organizationId, available_m3: volume } });
    await owner.shipment.create({ data: { sender_id: organizationId, recipient_id: organizationId, carrier: 'Sintética', origin_state: 'AM', destination_state: 'AM', route_states: ['AM'], official_system: 'NAO_VERIFICADO', document_ids: [invoiceId], status: 'RECEIVED', declared_at: new Date('2026-01-01'), dispatched_at: new Date('2026-01-02'), received_at: new Date('2026-01-03'), created_by_user_id: authorId, items: { create: { lot_id: lot.id, volume_m3: volume, received_volume_m3: volume } } } });
    lots.push(lot);
  }
  return lots;
}
async function transform(lots: Awaited<ReturnType<typeof inputLots>>, outputs?: any[], coefficientOutput = '3') {
  return post('transformations', { code: randomUUID(), occurred_at: new Date().toISOString(), operator_organization_id: organizationId, conversion_parameter_id: parameterId,
    inputs: lots.map(lot => ({ lot_id: lot.id, volume_m3: lot.authorized_volume_m3.toString() })),
    outputs: outputs ?? [{ client_ref: randomUUID(), product: 'serrado', volume_m3: coefficientOutput, allocations: [{ origin_lot_id: lots[0]!.id, volume_m3: coefficientOutput === '3' ? '1.8' : '3' }, { origin_lot_id: lots[1]!.id, volume_m3: coefficientOutput === '3' ? '1.2' : '2' }] }],
    residue_m3: coefficientOutput === '3' ? '7' : '5', loss_m3: '0', assessment_scope: 'DEMONSTRATIVO' });
}

describe.sequential('mistura, revisão e entrega persistidas', () => {
  it('persiste mistura 60/40, múltiplas saídas e numerador/denominador sem duplicar entrada', async () => {
    const lots = await inputLots();
    const response = await transform(lots, [
      { client_ref: randomUUID(), product: 'serrado', volume_m3: '1.8', allocations: [{ origin_lot_id: lots[0]!.id, volume_m3: '1.08' }, { origin_lot_id: lots[1]!.id, volume_m3: '0.72' }] },
      { client_ref: randomUUID(), product: 'serrado', volume_m3: '1.2', allocations: [{ origin_lot_id: lots[0]!.id, volume_m3: '0.72' }, { origin_lot_id: lots[1]!.id, volume_m3: '0.48' }] },
    ]);
    expect(response.statusCode, response.body).toBe(201);
    for (const output of response.json().outputs) {
      const trace = await app.inject({ url: `/api/v1/product-lots/${output.product_lot.id}/trace`, headers: author });
      expect(trace.statusCode, trace.body).toBe(200); expect(trace.json().provenance.map((row: any) => row.fraction)).toEqual(['0.6','0.4']);
      expect(trace.json().ancestry.plots).toHaveLength(2); expect(trace.json().metrics.tracked_fraction).toBe('1');
    }
    expect((await owner.balance.findMany({ where: { lot_id: { in: lots.map(lot => lot.id) } } })).every(balance => balance.available_m3.toString() === '0')).toBe(true);
    expect(await owner.balanceMovement.count({ where: { entity_id: response.json().transformation.id, action: 'CONSUME' } })).toBe(2);
  });

  it('origem desconhecida positiva e soma incorreta preservam bloqueio e rollback', async () => {
    const lots = await inputLots(); const payload = [{ client_ref: randomUUID(), product: 'serrado', volume_m3: '3', allocations: [{ origin_lot_id: lots[0]!.id, volume_m3: '2.999999' }, { origin_lot_id: null, volume_m3: '0.000001' }] }];
    const bad = await transform(lots, [{ ...payload[0], allocations: [{ origin_lot_id: lots[0]!.id, volume_m3: '2' }] }]);
    expect(bad.statusCode).toBe(422);
    expect((await owner.balance.findFirstOrThrow({ where: { lot_id: lots[0]!.id } })).available_m3.toString()).toBe('6');
    const response = await transform(lots, payload); expect(response.statusCode, response.body).toBe(201);
    const product = response.json().outputs[0].product_lot;
    expect(response.json().outputs[0].provenance.unknown_volume_m3).toBe('0.000001'); expect(response.json().outputs[0].quarantined).toBe(true);
    const passport = await post('passports', { product_lot_id: product.id, assessment_scope: 'REAL' });
    expect(passport.statusCode, passport.body).toBe(201); expect(passport.json().readiness.readiness).toBe('MISSING_EVIDENCE');
    expect(passport.json().readiness.reasons).toContain('UNKNOWN_ORIGIN'); expect(passport.json().readiness.reasons).toContain('SIMULATED_SUPPORTING_EVIDENCE');
  });

  it('bloqueia venda normal anômala; declaração com ciência não movimenta; venda normal é idempotente', async () => {
    const lots = await inputLots(); const anomalous = await transform(lots, undefined, '5'); expect(anomalous.statusCode, anomalous.body).toBe(201);
    const productId = anomalous.json().outputs[0].product_lot.id;
    const saleBody = { seller_organization_id: organizationId, buyer_organization_id: buyerId, product_lot_id: productId, volume_m3: '1', fiscal_document_id: invoiceId, occurred_at: new Date().toISOString() };
    const denied = await post('sales', saleBody); expect(denied.statusCode).toBe(409); expect(denied.json().error.code).toBe('SALE_BLOCKED_BY_REVIEW');
    const pending = await post('sales', { ...saleBody, acknowledge_pending: true }); expect(pending.statusCode, pending.body).toBe(201);
    expect(pending.json()).toMatchObject({ sale: { status: 'EM_REVISAO' }, balance_moved: false, fiscal_document: { simulated: true } });
    expect(await owner.balanceMovement.count({ where: { entity_id: pending.json().sale.id } })).toBe(0);
    expect((await owner.balance.findFirstOrThrow({ where: { lot_id: productId } })).quarantined_m3.toString()).toBe('5');
    const healthy = await transform(await inputLots()); const cleanId = healthy.json().outputs[0].product_lot.id; const key = randomUUID();
    const normalBody = { ...saleBody, product_lot_id: cleanId, occurred_at: new Date().toISOString() }; const first = await post('sales', normalBody, author, key); const replay = await post('sales', normalBody, author, key);
    expect(first.statusCode, first.body).toBe(201); expect(replay.body).toBe(first.body);
    expect((await owner.balance.findFirstOrThrow({ where: { lot_id: cleanId } })).available_m3.toString()).toBe('2');
    expect(await owner.balanceMovement.count({ where: { entity_id: first.json().sale.id } })).toBe(1);
  });

  it('revisão contextual preserva sinal original e perde efeito com geometria ou bytes alterados', async () => {
    const [lot] = await inputLots();
    const check = await owner.check.create({ data: { organization_id: organizationId, entity_type: 'ORIGIN_LOT', entity_id: lot!.id, rule_id: 'R12', rule_version: '1', name: 'Sinal contextual sintético', description: 'Teste', source: { label: 'SIMULADA' }, modality: 'DEMO', dimension: 'geospatial_check', status: 'ALERTA', technical_severity: 'HIGH', message: 'Sinal de mudança', suggested_action: 'Revisar', values: {}, assessment_scope: 'DEMONSTRATIVO' } });
    const auditCase = await owner.auditCase.create({ data: { organization_id: organizationId, check_id: check.id, entity_type: 'ORIGIN_LOT', entity_id: lot!.id, created_by_user_id: authorId, rule_id: 'R12' } });
    const body = { decision: 'RESOLVIDO_COM_EVIDENCIA', comment: 'Evidência contextual sintética para revisão humana', evidence_ids: [invoiceId] };
    expect((await post(`audit-cases/${auditCase.id}/decisions`, body)).statusCode).toBe(403);
    const response = await post(`audit-cases/${auditCase.id}/decisions`, body, reviewer); expect(response.statusCode, response.body).toBe(201);
    const view = () => app.inject({ url: `/api/v1/audit-cases/${auditCase.id}`, headers: reviewer });
    expect((await view()).json()).toMatchObject({ original_check: { status: 'ALERTA' }, effective_check: { status: 'PASSOU', original_status: 'ALERTA', contextual_resolution: { valid: true } } });
    await owner.plot.update({ where: { id: lot!.plot_id }, data: { geometry_version: 2 } });
    expect((await view()).json().effective_check.status).toBe('ALERTA');
    await owner.plot.update({ where: { id: lot!.plot_id }, data: { geometry_version: 1 } });
    const doc = await owner.document.findUniqueOrThrow({ where: { id: invoiceId } });
    await writeFile(join(storage, doc.storage_key), 'BYTES ALTERADOS');
    expect((await view()).json().effective_check.contextual_resolution.valid).toBe(false);
    await writeFile(join(storage, doc.storage_key), 'NOTA FICTÍCIA SEM VALOR FISCAL');
    expect((await owner.check.findUniqueOrThrow({ where: { id: check.id } })).status).toBe('ALERTA');
  });

  it('exporta JSON/HTML com checklist, geometria autorizada e limitação de guarda; demo nunca pronta', async () => {
    const transformation = await transform(await inputLots()); const productId = transformation.json().outputs[0].product_lot.id;
    const passportResponse = await post('passports', { product_lot_id: productId, assessment_scope: 'DEMONSTRATIVO' }); expect(passportResponse.statusCode, passportResponse.body).toBe(201);
    const passportId = passportResponse.json().passport.id;
    const response = await app.inject({ url: `/api/v1/passports/${passportId}/bundle`, headers: author }); expect(response.statusCode, response.body).toBe(200);
    const bundle = response.json(); expect(bundle.evidence.plots).toHaveLength(2); expect(bundle.evidence.documents[0].storage_key).toBeUndefined();
    expect(bundle.checklist).toHaveLength(5); expect(bundle.dds_reference_status).toBe('NAO_FORNECIDA'); expect(bundle.duration_ms).toBeGreaterThanOrEqual(0);
    expect(bundle.current_state.readiness_status).toBe('MISSING_EVIDENCE'); expect(bundle.guidance).toContain('cinco anos');
    const html = await app.inject({ url: `/api/v1/passports/${passportId}/bundle?format=HTML`, headers: author });
    expect(html.statusCode).toBe(200); expect(html.headers['content-type']).toContain('text/html'); expect(html.body).toContain('MISSING_EVIDENCE'); expect(html.body).toContain('checklist');
    const share = await post(`passports/${passportId}/grants`, { organization_id: buyerId }); expect(share.statusCode, share.body).toBe(201);
    const externalUserId = randomUUID();
    await owner.user.create({ data: { id: externalUserId, name: 'Comprador autorizado', organization_id: buyerId, roles: ['BUYER'] } });
    await owner.membership.create({ data: { user_id: externalUserId, organization_id: buyerId, role: 'BUYER' } });
    const external = await login(externalUserId);
    const reduced = await app.inject({ url: `/api/v1/passports/${passportId}/bundle`, headers: external });
    expect(reduced.statusCode, reduced.body).toBe(200); expect(reduced.json().evidence.plots).toEqual([]);
    expect(reduced.json().evidence.documents).toEqual([]); expect(reduced.json().exact_geometry_withheld).toBe(true);
    expect(reduced.json().current_state.reasons).toContain('WITHHELD_DOCUMENT_EVIDENCE'); expect(reduced.body).not.toContain('coordinates');
    const allocation = await owner.lotProvenance.findFirstOrThrow({ where: { product_lot_id: productId } });
    await owner.lotProvenance.update({ where: { id: allocation.id }, data: { fraction: '0.7' } });
    const altered = await app.inject({ url: `/api/v1/passports/${passportId}/verify`, headers: author });
    expect(altered.json().valid).toBe(false); expect(altered.json().issues.some((issue: any) => issue.code === 'PROVENANCE_HASH_MISMATCH')).toBe(true);
    await owner.lotProvenance.update({ where: { id: allocation.id }, data: { fraction: allocation.fraction } });
    const publicView = await app.inject({ url: `/api/v1/public/passports/${passportResponse.json().passport.public_token}` });
    expect(publicView.body).not.toMatch(/coordinates|storage_key|reviewer_user_id/);
  });
});
