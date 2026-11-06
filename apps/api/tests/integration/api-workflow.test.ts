import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/app.js';
import { prisma } from '../../src/db.js';

const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const producer = randomUUID(); const mill = randomUUID();
const operator = randomUUID(); const receiver = randomUUID(); const reviewer = randomUUID();
const stranger = randomUUID(); const buyer = randomUUID();
const parameterId = randomUUID();
let app: Awaited<ReturnType<typeof buildServer>>;
let storage: string;
type Login = { cookie: string; 'x-csrf-token': string };
let producerSession: Login; let millSession: Login; let reviewerSession: Login; let buyerSession: Login;

async function login(userId: string): Promise<Login> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: userId } });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: response.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), 'x-csrf-token': response.json().csrf_token };
}
async function post(path: string, body: unknown, session = producerSession) {
  return app.inject({ method: 'POST', url: `/api/v1/${path}`, headers: { ...session, 'idempotency-key': randomUUID() }, payload: body as object });
}
const geometry = { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] };
let plotId: string; let documentId: string; let lotId: string; let shipmentId: string; let productId: string;
let passportId: string; let token: string; let caseId: string;
let passportKey: string;

beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), 'foresttrace-api-'));
  process.env.PRIVATE_STORAGE_DIR = storage;
  await owner.organization.createMany({ data: [
    { id: producer, name: 'Origem sintética', role: 'OPERATOR', state: 'AM', municipality: 'Teste', data_provenance: { label: 'SIMULADA' } },
    { id: mill, name: 'Serraria sintética', role: 'PROCESSOR', state: 'SP', municipality: 'Teste', data_provenance: { label: 'SIMULADA' } },
    { id: stranger, name: 'Comprador sem relação', role: 'BUYER', state: 'SP', municipality: 'Teste', data_provenance: { label: 'SIMULADA' } },
  ] });
  await owner.user.createMany({ data: [
    { id: operator, name: 'Autora', organization_id: producer, roles: ['OPERATOR', 'AUDITOR'] },
    { id: receiver, name: 'Recebedora', organization_id: mill, roles: ['OPERATOR'] },
    { id: reviewer, name: 'Auditora distinta', organization_id: producer, roles: ['AUDITOR'] },
    { id: buyer, name: 'Comprador', organization_id: stranger, roles: ['BUYER'] },
  ] });
  await owner.conversionParameter.create({ data: { id: parameterId, input_product: 'tora', output_product: 'serrado', coefficient: '0.35', regulation_reference: 'SIMULADA', source_url: 'https://example.invalid', version: randomUUID(), valid_from: new Date('2026-01-01'), data_provenance: 'SIMULADA' } });
  await owner.membership.createMany({ data: [
    { user_id: operator, organization_id: producer, role: 'OPERATOR' },
    { user_id: operator, organization_id: producer, role: 'AUDITOR' },
    { user_id: receiver, organization_id: mill, role: 'OPERATOR' },
    { user_id: reviewer, organization_id: producer, role: 'AUDITOR' },
    { user_id: buyer, organization_id: stranger, role: 'BUYER' },
  ] });
  app = await buildServer();
  producerSession = await login(operator); millSession = await login(receiver);
  reviewerSession = await login(reviewer); buyerSession = await login(buyer);
}, 60_000);

afterAll(async () => {
  await app?.close(); await Promise.all([owner.$disconnect(), prisma.$disconnect()]);
  // Only the fresh temporary document directory created by this suite is removed.
  if (storage) await rm(storage, { recursive: true, force: true });
});

describe.sequential('cadeia persistida pela API com papel de aplicação', () => {
  it('expõe saúde e documentação sem sessão', async () => {
    expect((await app.inject({ url: '/health' })).json()).toMatchObject({ status: 'ok' });
    expect((await app.inject({ url: '/docs/' })).statusCode).toBe(200);
    const spec = await app.inject({ url: '/openapi.json' });
    expect(spec.statusCode).toBe(200);
    expect(spec.json().paths['/api/v1/documents']).toBeDefined();
  });
  it('nega escrita anônima e CSRF inválido', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/documents', payload: {} })).statusCode).toBe(422);
    const payload = { name: 'sintético', type: 'AUTHORIZATION', content_base64: 'eA==', source: 'Teste', data_provenance: 'SIMULADA', assessment_scope: 'DEMONSTRATIVO', visibility: 'PRIVATE' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/documents', payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/documents', payload, headers: { cookie: producerSession.cookie } })).statusCode).toBe(403);
  });

  it('grava bytes privados e recupera somente na organização autorizada', async () => {
    const bytes = Buffer.from('AUTORIZAÇÃO SIMULADA - sem valor oficial');
    const response = await post('documents', { name: 'autorização.txt', type: 'AUTHORIZATION', content_base64: bytes.toString('base64'), source: 'Teste sintético', data_provenance: 'SIMULADA', assessment_scope: 'DEMONSTRATIVO', visibility: 'PRIVATE' });
    expect(response.statusCode, response.body).toBe(201);
    documentId = response.json().document.id;
    expect(response.json().document.storage_key).toBeUndefined();
    expect(response.json().document.content_hash).toBe(createHash('sha256').update(bytes).digest('hex'));
    const download = await app.inject({ url: `/api/v1/documents/${documentId}/download`, headers: producerSession });
    expect(download.rawPayload).toEqual(bytes);
    expect((await app.inject({ url: `/api/v1/documents/${documentId}/download`, headers: buyerSession })).statusCode).toBe(404);
    expect((await post(`documents/${documentId}/grants`, { organization_id: producer }, buyerSession)).statusCode).toBe(403);
    const grant = await post(`documents/${documentId}/grants`, { organization_id: stranger });
    expect(grant.statusCode, grant.body).toBe(201);
    expect((await app.inject({ url: `/api/v1/documents/${documentId}/download`, headers: buyerSession })).rawPayload).toEqual(bytes);
    const revoke = await app.inject({ method: 'DELETE', url: `/api/v1/documents/${documentId}/grants/${stranger}`, headers: { ...producerSession, 'idempotency-key': randomUUID() } });
    expect(revoke.statusCode, revoke.body).toBe(200);
    expect((await app.inject({ url: `/api/v1/documents/${documentId}/download`, headers: buyerSession })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/v1/documents/${documentId}/download` })).statusCode).toBe(401);
    expect((await post('documents', { name: 'negado.txt', type: 'AUTHORIZATION', content_base64: 'eA==', source: 'Teste', data_provenance: 'SIMULADA', assessment_scope: 'DEMONSTRATIVO', visibility: 'PRIVATE' }, buyerSession)).statusCode).toBe(403);
  });

  it('auditor proprietário gerencia grants; comprador da mesma organização não altera permissões', async () => {
    const restrictedId = randomUUID();
    await owner.user.create({ data: { id: restrictedId, name: 'Leitor sem gestão', organization_id: producer, roles: ['BUYER'] } });
    await owner.membership.create({ data: { user_id: restrictedId, organization_id: producer, role: 'BUYER' } });
    const restricted = await login(restrictedId);
    const grant = await post(`documents/${documentId}/grants`, { organization_id: stranger }, reviewerSession);
    expect(grant.statusCode, grant.body).toBe(201);
    expect((await post(`documents/${documentId}/grants`, { organization_id: stranger }, restricted)).statusCode).toBe(403);
    const revoke = (session: Login) => app.inject({ method: 'DELETE', url: `/api/v1/documents/${documentId}/grants/${stranger}`, headers: { ...session, 'idempotency-key': randomUUID() } });
    expect((await revoke(restricted)).statusCode).toBe(403);
    expect((await revoke(reviewerSession)).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/v1/documents/${documentId}/download`, headers: buyerSession })).statusCode).toBe(404);
  });

  it('valida topologia e persiste parcela, documento e lote com IDs distintos', async () => {
    const body = { organization_id: producer, country: 'BR', state: 'AM', municipality: 'Teste sintético', declared_property: 'Área fictícia', geometry, geometry_version: 1, geometry_date: '2026-11-05', data_provenance: { geometry: 'SIMULADA' } };
    const invalid = await post('plots', { ...body, geometry: { type: 'Polygon', coordinates: [[[-60,-3],[-59,-2],[-60,-2],[-59,-3],[-60,-3]]] } });
    expect(invalid.statusCode, invalid.body).toBe(422);
    const plot = await post('plots', body);
    expect(plot.statusCode, plot.body).toBe(201); plotId = plot.json().plot.id;
    expect(Number(plot.json().plot.area_ha)).toBeGreaterThan(1.2);
    const response = await post('origin-lots', { plot_id: plotId, code: `API-${randomUUID()}`, species_common_name: 'angelim-vermelho', species_scientific_name: 'Dinizia excelsa', authorized_volume_m3: '10', permit_reference: 'SIMULADA', permit_document_id: documentId, valid_from: '2026-01-01', valid_until: '2027-12-31', right_of_use: 'SIMULADO', assessment_scope: 'DEMONSTRATIVO', data_provenance: { volume: 'SIMULADA' } });
    expect(response.statusCode, response.body).toBe(201); lotId = response.json().origin_lot.id;
    expect(lotId).not.toBe(plotId);
    const harvest = await post('harvests', { origin_lot_id: lotId, start_date: '2026-11-05', end_date: '2026-11-05', volume_m3: '10' });
    expect(harvest.statusCode, harvest.body).toBe(201);
  });

  it('reserva e expede 10 m³; somente destinatário pode receber; rejeita criação de volume', async () => {
    const create = await post('shipments', { sender_organization_id: producer, recipient_organization_id: mill, origin_state: 'AM', destination_state: 'SP', route_states: ['AM','SP'], items: [{ lot_id: lotId, volume_m3: '10' }], transporter: 'SIMULADO', official_system: 'NAO_VERIFICADO', document_ids: [documentId] });
    expect(create.statusCode, create.body).toBe(201); shipmentId = create.json().shipment.id;
    const dispatched = await post(`shipments/${shipmentId}/dispatch`, { occurred_at: new Date().toISOString() });
    expect(dispatched.statusCode, dispatched.body).toBe(200);
    const payload = { occurred_at: new Date().toISOString(), items: [{ lot_id: lotId, volume_m3: '10' }] };
    expect((await post(`shipments/${shipmentId}/receive`, payload)).statusCode).toBe(409);
    expect((await post(`shipments/${shipmentId}/receive`, { ...payload, items: [{ lot_id: lotId, volume_m3: '11' }] }, millSession)).statusCode).toBe(422);
    const received = await post(`shipments/${shipmentId}/receive`, payload, millSession);
    expect(received.statusCode, received.body).toBe(200);
    expect(received.json().shipment.status).toBe('RECEIVED');
    expect((await post(`shipments/${shipmentId}/receive`, payload, millSession)).statusCode).toBe(409);
    const dashboard = await app.inject({ url: '/api/v1/dashboard', headers: millSession });
    expect(dashboard.json().origin_lots.find((lot: {id:string}) => lot.id === lotId).available_m3).toBe('10');
    expect(dashboard.json().conversion_parameters.some((p: {id:string}) => p.id === parameterId)).toBe(true);
  });

  it('transforma 10 em 3 m³ sem duplicar saldo e gera passaporte e pacote privados', async () => {
    const transformation = await post('transformations', { code: randomUUID(), occurred_at: new Date().toISOString(), operator_organization_id: mill, conversion_parameter_id: parameterId, inputs: [{ lot_id: lotId, volume_m3: '10' }], outputs: [{ client_ref: randomUUID(), product: 'serrado', volume_m3: '3', allocations: [{ origin_lot_id: lotId, volume_m3: '3' }] }], residue_m3: '7', loss_m3: '0', assessment_scope: 'DEMONSTRATIVO' }, millSession);
    expect(transformation.statusCode, transformation.body).toBe(201); productId = transformation.json().outputs[0].product_lot.id;
    expect(transformation.json().assessment.result).toBe('PASSOU');
    expect((await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: mill } } })).available_m3.toString()).toBe('0');
    passportKey = randomUUID();
    const passportBody = { product_lot_id: productId, assessment_scope: 'DEMONSTRATIVO' };
    const passport = await app.inject({ method: 'POST', url: '/api/v1/passports', headers: { ...millSession, 'idempotency-key': passportKey }, payload: passportBody });
    expect(passport.statusCode, passport.body).toBe(201);
    passportId = passport.json().passport.id; token = passport.json().passport.public_token;
    expect(passport.json().readiness.readiness).toBe('MISSING_EVIDENCE');
    expect(passport.json().qr_data_url).toMatch(/^data:image\/png;base64,/);
    const replay = await app.inject({ method: 'POST', url: '/api/v1/passports', headers: { ...millSession, 'idempotency-key': passportKey }, payload: passportBody });
    expect(replay.statusCode).toBe(201); expect(replay.json().passport.id).toBe(passportId);
    expect(await owner.passport.count({ where: { product_lot_id: productId } })).toBe(1);
    const verify = await app.inject({ url: `/api/v1/passports/${passportId}/verify`, headers: millSession });
    expect(verify.json().valid, JSON.stringify(verify.json())).toBe(true);
    const oldSnapshot = await owner.passport.findUniqueOrThrow({ where: { id: passportId } });
    const correctionSignal = await owner.check.create({ data: { organization_id: mill, entity_type: 'ORIGIN_LOT', entity_id: lotId, rule_id: 'R19', rule_version: '1', name: 'Retificação ancestral', description: 'Fixture negativa', source: { label: 'SIMULADA' }, modality: 'DEMONSTRATIVO', dimension: 'chain_of_custody_check', status: 'ALERTA', technical_severity: 'HIGH', message: 'Retificação pendente', suggested_action: 'Revisar descendentes', values: {}, assessment_scope: 'DEMONSTRATIVO' } });
    await owner.auditCase.create({ data: { organization_id: mill, check_id: correctionSignal.id, entity_type: 'ORIGIN_LOT', entity_id: lotId, created_by_user_id: receiver, rule_id: 'R19' } });
    const currentVerify = await app.inject({ url: `/api/v1/passports/${passportId}/verify`, headers: millSession });
    expect(currentVerify.json().current_state).toMatchObject({ requires_review: true, readiness_status: 'MISSING_EVIDENCE' });
    const unchangedSnapshot = await owner.passport.findUniqueOrThrow({ where: { id: passportId } });
    expect(unchangedSnapshot.content_hash).toBe(oldSnapshot.content_hash); expect(unchangedSnapshot.content).toEqual(oldSnapshot.content);
    for (const format of ['JSON', 'HTML']) {
      const bundle = await app.inject({ url: `/api/v1/passports/${passportId}/bundle?format=${format}`, headers: millSession });
      expect(bundle.statusCode, bundle.body).toBe(200); expect(bundle.body).toContain('MISSING_EVIDENCE');
    }
  });

  it('detecta metadados ancestrais adulterados, checkpoint removido e novo alerta sem reescrever snapshot', async () => {
    const originalOrigin = await owner.originLot.findUniqueOrThrow({ where: { id: lotId } });
    const originalPassport = await owner.passport.findUniqueOrThrow({ where: { id: passportId } });
    const verify = () => app.inject({ url: `/api/v1/passports/${passportId}/verify`, headers: millSession });
    try {
      await owner.originLot.update({ where: { id: lotId }, data: { right_of_use: 'METADADO ADULTERADO' } });
      const modified = (await verify()).json();
      expect(modified.valid).toBe(false);
      expect(modified.issues.some((issue: {code: string}) => issue.code === 'ANCESTRY_ENTITY_HASH_MISMATCH')).toBe(true);
      const replay = await app.inject({ method: 'POST', url: '/api/v1/passports', headers: { ...millSession, 'idempotency-key': passportKey }, payload: { product_lot_id: productId, assessment_scope: 'DEMONSTRATIVO' } });
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.json().passport.id).toBe(passportId);
      expect(await owner.passport.count({ where: { product_lot_id: productId } })).toBe(1);
    } finally { await owner.originLot.update({ where: { id: lotId }, data: { right_of_use: originalOrigin.right_of_use } }); }
    try {
      await owner.passport.update({ where: { id: passportId }, data: { snapshot_heads: {} } });
      const missingCheckpoint = (await verify()).json();
      expect(missingCheckpoint.valid).toBe(false);
      expect(missingCheckpoint.issues.some((issue: {code: string}) => issue.code === 'SNAPSHOT_CHECKPOINT_MISSING')).toBe(true);
    } finally { await owner.passport.update({ where: { id: passportId }, data: { snapshot_heads: originalPassport.snapshot_heads as object } }); }
    const check = await owner.check.create({ data: { organization_id: mill, entity_type: 'PRODUCT_LOT', entity_id: productId, rule_id: 'R19', rule_version: 'test', name: 'Novo alerta sintético', description: 'Teste de invalidação', source: {}, modality: 'DEMONSTRATIVO', dimension: 'chain_of_custody_check', status: 'ALERTA', technical_severity: 'HIGH', message: 'Novo alerta', suggested_action: 'Revisar', values: {}, assessment_scope: 'DEMONSTRATIVO' } });
    try {
      const current = (await verify()).json();
      expect(current.current_state.requires_review).toBe(true);
      expect(current.current_state.readiness_status).toBe('MISSING_EVIDENCE');
      const preserved = await owner.passport.findUniqueOrThrow({ where: { id: passportId } });
      expect(preserved.content).toEqual(originalPassport.content);
      expect(preserved.content_hash).toBe(originalPassport.content_hash);
    } finally { await owner.check.delete({ where: { id: check.id } }); }
  });

  it('consulta JSON público sem sessão e nega acesso privado com IDs conhecidos', async () => {
    const response = await app.inject({ url: `/api/v1/public/passports/${token}` });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().readiness_status).toBe('MISSING_EVIDENCE');
    expect(response.body).not.toMatch(/geometry|coordinates|storage_key|created_by_user_id|permit_document_id|cpf|contact/);
    expect((await app.inject({ url: `/api/v1/passports/${passportId}`, headers: buyerSession })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/v1/passports/${passportId}/bundle`, headers: buyerSession })).statusCode).toBe(404);
    const passportGrant = await post(`passports/${passportId}/grants`, { organization_id: stranger }, millSession);
    expect(passportGrant.statusCode, passportGrant.body).toBe(201);
    expect((await app.inject({ url: `/api/v1/passports/${passportId}`, headers: buyerSession })).statusCode).toBe(200);
    expect((await app.inject({ url: `/api/v1/passports/${passportId}/bundle`, headers: buyerSession })).statusCode).toBe(200);
    const passportRevoke = await app.inject({ method: 'DELETE', url: `/api/v1/passports/${passportId}/grants/${stranger}`, headers: { ...millSession, 'idempotency-key': randomUUID() } });
    expect(passportRevoke.statusCode, passportRevoke.body).toBe(200);
    expect((await app.inject({ url: `/api/v1/passports/${passportId}`, headers: buyerSession })).statusCode).toBe(404);
    if ((await app.inject({ url: '/' })).statusCode === 200) {
      const page = await app.inject({ url: `/p/${token}` });
      expect(page.headers['content-type']).toContain('text/html');
    }
  });

  it('preserva anomalia 10→5 em quarentena e desfaz transformação que cria volume', async () => {
    const lot = await post('origin-lots', { plot_id: plotId, code: `ANOMALY-${randomUUID()}`, species_common_name: 'angelim-vermelho', species_scientific_name: 'Dinizia excelsa', authorized_volume_m3: '10', permit_reference: 'SIMULADA', permit_document_id: documentId, valid_from: '2026-01-01', valid_until: '2027-12-31', right_of_use: 'SIMULADO', assessment_scope: 'DEMONSTRATIVO', data_provenance: { volume: 'SIMULADA' } });
    expect(lot.statusCode, lot.body).toBe(201); const originId = lot.json().origin_lot.id;
    // This actor also processes locally; receipt remains a separately authenticated fact.
    expect((await post('harvests', { origin_lot_id: originId, start_date: '2026-11-05', end_date: '2026-11-05', volume_m3: '10' })).statusCode).toBe(201);
    const localShipment = await post('shipments', { sender_organization_id: producer, recipient_organization_id: producer, origin_state: 'AM', destination_state: 'AM', route_states: ['AM'], items: [{ lot_id: originId, volume_m3: '10' }], transporter: 'Custódia local sintética', official_system: 'NAO_VERIFICADO', document_ids: [documentId] });
    expect(localShipment.statusCode, localShipment.body).toBe(201);
    const localShipmentId = localShipment.json().shipment.id;
    expect((await post(`shipments/${localShipmentId}/dispatch`, { occurred_at: new Date().toISOString() })).statusCode).toBe(200);
    expect((await post(`shipments/${localShipmentId}/receive`, { occurred_at: new Date().toISOString(), items: [{ lot_id: originId, volume_m3: '10' }] })).statusCode).toBe(200);
    const payload = { code: randomUUID(), occurred_at: new Date().toISOString(), operator_organization_id: producer, conversion_parameter_id: parameterId, inputs: [{ lot_id: originId, volume_m3: '10' }], outputs: [{ client_ref: randomUUID(), product: 'serrado', volume_m3: '5', allocations: [{ origin_lot_id: originId, volume_m3: '5' }] }], residue_m3: '6', loss_m3: '0', assessment_scope: 'DEMONSTRATIVO' };
    const invalid = await post('transformations', payload);
    expect(invalid.statusCode, invalid.body).toBe(422); expect(invalid.json().error.code).toBe('MASS_BALANCE_EXCEEDED');
    const balance = () => owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: originId, organization_id: producer } } });
    expect((await balance()).available_m3.toString()).toBe('10');
    const result = await post('transformations', { ...payload, residue_m3: '5' });
    expect(result.statusCode, result.body).toBe(201); expect(result.json().assessment.result).toBe('ALERTA');
    const product = result.json().outputs[0].product_lot;
    const outputBalance = await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: product.id, organization_id: producer } } });
    expect(outputBalance.available_m3.toString()).toBe('0'); expect(outputBalance.quarantined_m3.toString()).toBe('5');
    const openCase = await owner.auditCase.findFirstOrThrow({ where: { entity_id: result.json().transformation.id, rule_id: 'R10' } });
    const resolution = await post(`audit-cases/${openCase.id}/decisions`, { decision: 'RESOLVIDO_COM_EVIDENCIA', comment: 'Justificativa isolada não altera CRV', evidence_ids: [documentId] }, reviewerSession);
    expect(resolution.statusCode).toBe(422); expect(resolution.json().error.code).toBe('RULE_REASSESSMENT_REQUIRED');
    expect(await owner.auditDecision.count({ where: { case_id: openCase.id } })).toBe(0);
    const approvalBytes = Buffer.from('Aprovação CRV demonstrativa, sem validade oficial');
    const approvalResponse = await post('documents', { name: 'aprovacao-crv.txt', type: 'CRV_APPROVAL', content_base64: approvalBytes.toString('base64'), source: 'Fixture sintética', data_provenance: 'SIMULADA', assessment_scope: 'DEMONSTRATIVO', visibility: 'PRIVATE' });
    expect(approvalResponse.statusCode, approvalResponse.body).toBe(201);
    const approvalId = approvalResponse.json().document.id;
    const mismatchedException = await post('conversion-exceptions', { conversion_parameter_id: parameterId, document_id: approvalId, coefficient: '0.50', product: 'serrado', species_scientific: 'Swietenia macrophylla', issuing_authority: 'Autoridade demonstrativa', approval_reference: 'SIMULADA-CRV-ERRADA', valid_from: '2026-01-01', valid_until: '2027-12-31', data_provenance: 'SIMULADA' });
    expect(mismatchedException.statusCode, mismatchedException.body).toBe(201);
    const mismatchedReview = await post(`audit-cases/${openCase.id}/decisions`, { decision: 'RESOLVIDO_COM_EVIDENCIA', comment: 'Espécie da exceção não corresponde', evidence_ids: [approvalId], conversion_exception_id: mismatchedException.json().conversion_exception.id }, reviewerSession);
    expect(mismatchedReview.statusCode).toBe(422); expect(mismatchedReview.json().error.code).toBe('CONVERSION_EXCEPTION_INVALID');
    expect(await owner.auditDecision.count({ where: { case_id: openCase.id } })).toBe(0);
    const exceptionResponse = await post('conversion-exceptions', { conversion_parameter_id: parameterId, document_id: approvalId, coefficient: '0.50', product: 'serrado', species_scientific: 'Dinizia excelsa', issuing_authority: 'Autoridade demonstrativa', approval_reference: 'SIMULADA-CRV-001', valid_from: '2026-01-01', valid_until: '2027-12-31', data_provenance: 'SIMULADA' });
    expect(exceptionResponse.statusCode, exceptionResponse.body).toBe(201);
    const reviewed = await post(`audit-cases/${openCase.id}/decisions`, { decision: 'RESOLVIDO_COM_EVIDENCIA', comment: 'Reavaliação com documento CRV simulado', evidence_ids: [approvalId], conversion_exception_id: exceptionResponse.json().conversion_exception.id }, reviewerSession);
    expect(reviewed.statusCode, reviewed.body).toBe(201);
    expect(reviewed.json().review).toMatchObject({ rule_re_evaluated: true, assessment: { result: 'PASSOU', exception_applied: true } });
    const released = await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: product.id, organization_id: producer } } });
    expect(released.available_m3.toString()).toBe('5'); expect(released.quarantined_m3.toString()).toBe('0');
  });

  it('bloqueia autoavaliação em qualquer decisão mesmo após renovar a sessão', async () => {
    const check = await owner.check.create({ data: { organization_id: producer, entity_type: 'ORIGIN_LOT', entity_id: lotId, rule_id: 'R12', rule_version: '1', name: 'Sinal sintético', description: 'Contexto para teste', source: { label: 'SIMULADA' }, modality: 'DEMONSTRATIVO', dimension: 'geospatial_check', status: 'ALERTA', technical_severity: 'MEDIUM', message: 'SIMULADA', suggested_action: 'Revisar', values: {}, assessment_scope: 'DEMONSTRATIVO' } });
    const auditCase = await owner.auditCase.create({ data: { organization_id: producer, check_id: check.id, entity_type: 'ORIGIN_LOT', entity_id: lotId, created_by_user_id: operator, rule_id: 'R12' } });
    caseId = auditCase.id;
    for (const session of [producerSession, await login(operator)]) for (const decision of ['EM_ANALISE', 'RESOLVIDO_COM_EVIDENCIA', 'REJEITADO', 'MANTIDO_PENDENTE']) {
      const result = await post(`audit-cases/${caseId}/decisions`, { decision, comment: 'Justificativa sintética', evidence_ids: [documentId] }, session);
      expect(result.statusCode, result.body).toBe(403); expect(result.json().error.code).toBe('SELF_REVIEW_NOT_ALLOWED');
    }
    expect(await owner.auditDecision.count({ where: { case_id: caseId } })).toBe(0);
    expect((await owner.auditCase.findUniqueOrThrow({ where: { id: caseId } })).status).toBe('ABERTO');
    const deniedLogs = await owner.accessLog.findMany({ where: { user_id: operator, reason: 'SELF_REVIEW_NOT_ALLOWED' } });
    expect(deniedLogs).toHaveLength(8);
    expect(JSON.stringify(deniedLogs)).not.toContain(producerSession.cookie);
  });

  it('outro auditor da organização decide com evidência; autoria ausente impede decisão', async () => {
    expect((await post(`audit-cases/${caseId}/decisions`, { decision: 'RESOLVIDO_COM_EVIDENCIA', comment: 'Contexto sintético', evidence_ids: [] }, reviewerSession)).statusCode).toBe(422);
    expect((await post(`audit-cases/${caseId}/decisions`, { decision: 'MANTIDO_PENDENTE', comment: 'Sem relação', evidence_ids: [] }, buyerSession)).statusCode).toBe(404);
    const result = await post(`audit-cases/${caseId}/decisions`, { decision: 'RESOLVIDO_COM_EVIDENCIA', comment: 'Evidência contextual sintética', evidence_ids: [documentId] }, reviewerSession);
    expect(result.statusCode, result.body).toBe(201);
    expect(result.json().decision.reviewer_user_id).toBe(reviewer);
    const current = await owner.auditCase.findUniqueOrThrow({ where: { id: caseId } });
    const unknown = await owner.auditCase.create({ data: { organization_id: producer, check_id: current.check_id, entity_type: 'UNKNOWN', entity_id: randomUUID(), created_by_user_id: null, rule_id: 'R12' } });
    const denied = await post(`audit-cases/${unknown.id}/decisions`, { decision: 'MANTIDO_PENDENTE', comment: 'Autor ausente', evidence_ids: [] }, reviewerSession);
    expect(denied.statusCode).toBe(403);
    expect(await owner.auditDecision.count({ where: { case_id: unknown.id } })).toBe(0);
  });

  it('verifica byte alterado/ausente e elo de lote removido via HTTP', async () => {
    const document = await owner.document.findUniqueOrThrow({ where: { id: documentId } });
    const original = await readFile(`${storage}/${document.storage_key}`);
    const product = await owner.productLot.findUniqueOrThrow({ where: { id: productId } });
    const originalInputs = await owner.transformationInput.findMany({ where: { transformation_id: product.transformation_id } });
    await owner.user.update({ where: { id: receiver }, data: { roles: ['OPERATOR', 'AUDITOR'] } });
    await owner.membership.create({ data: { user_id: receiver, organization_id: mill, role: 'AUDITOR' } });
    expect((await post(`documents/${documentId}/grants`, { organization_id: mill }, producerSession)).statusCode).toBe(201);
    try {
      await writeFile(`${storage}/${document.storage_key}`, Buffer.from('bytes adulterados'));
      const tampered = await app.inject({ url: `/api/v1/passports/${passportId}/verify`, headers: millSession });
      expect(tampered.json().valid).toBe(false);
      expect(tampered.json().issues.some((issue: any) => issue.code === 'DOCUMENT_HASH_MISMATCH')).toBe(true);
      await unlink(`${storage}/${document.storage_key}`);
      const missingBytes = await app.inject({ url: `/api/v1/passports/${passportId}/verify`, headers: millSession });
      expect(missingBytes.json().issues.some((issue: any) => issue.code === 'DOCUMENT_BYTES_UNAVAILABLE')).toBe(true);
      await owner.transformationInput.deleteMany({ where: { transformation_id: product.transformation_id } });
      const missingLink = await app.inject({ url: `/api/v1/passports/${passportId}/verify`, headers: millSession });
      expect(missingLink.json().valid).toBe(false);
      expect(missingLink.json().issues[0].code).toBe('ANCESTRY_LINK_MISSING');
    } finally {
      await writeFile(`${storage}/${document.storage_key}`, original);
      if (originalInputs.length) await owner.transformationInput.createMany({ data: originalInputs, skipDuplicates: true });
    }
  });
});
