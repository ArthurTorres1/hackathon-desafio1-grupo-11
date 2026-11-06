import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type SourceQuery } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UF_CODES } from '@foresttrace/contracts';
import { buildServer } from '../../src/app.js';
import { prisma } from '../../src/db.js';

const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const producerOrg = randomUUID(); const producerUser = randomUUID(); const parameterId = randomUUID();
const runId = randomUUID();
const destinations = UF_CODES.map(state => ({ state, organization: randomUUID(), user: randomUUID() }));
type Session = { cookie: string; 'x-csrf-token': string };
type Delivered = { state: string; origin: string; shipment: string; product: string; passport: string; token: string; session: Session; document: string };
const deliveries: Delivered[] = [];
let app: Awaited<ReturnType<typeof buildServer>>;
let producer: Session; let plotId: string; let documentId: string; let storage: string;
const fetchMock = vi.fn<typeof fetch>();
const geometry = { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] };

async function login(user: string): Promise<Session> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: user } });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: response.cookies.map(value => `${value.name}=${value.value}`).join('; '), 'x-csrf-token': response.json().csrf_token };
}
async function post(path: string, payload: object, session = producer) {
  const response = await app.inject({ method: 'POST', url: `/api/v1/${path}`, payload, headers: { ...session, 'idempotency-key': randomUUID() } });
  expect(response.statusCode, `${path}: ${response.body}`).toBeLessThan(400);
  return response;
}
async function finished(id: string): Promise<SourceQuery> {
  let query: SourceQuery | null = null;
  await vi.waitFor(async () => {
    query = await owner.sourceQuery.findUnique({ where: { id } });
    expect(query?.status).not.toBe('PENDENTE');
    expect(query).not.toBeNull();
  }, { timeout: 10_000, interval: 25 });
  return query!;
}

beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), 'foresttrace-national-'));
  process.env.PRIVATE_STORAGE_DIR = storage;
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => { throw new Error('OFFLINE_ISOLATED_TEST'); });
  vi.stubEnv('WHISP_API_KEY', 'national-isolated-provider-key');
  vi.stubEnv('WHISP_CONTRACT_CONFIRMED', 'true');
  vi.stubEnv('WHISP_SUBMIT_URL', 'https://national.test.invalid/submit');
  vi.stubEnv('WHISP_POLL_URL_TEMPLATE', 'https://national.test.invalid/status/{job_id}');
  await owner.organization.createMany({ data: [
    { id: producerOrg, name: 'Origem nacional sintética', role: 'OPERATOR', state: 'AM', municipality: 'Teste', data_provenance: { label: 'SIMULADA' } },
    ...destinations.map(destination => ({ id: destination.organization, name: `Destino sintético ${destination.state}`, role: 'PROCESSOR', state: destination.state, municipality: 'Teste', data_provenance: { label: 'SIMULADA' } })),
  ] });
  await owner.user.createMany({ data: [
    { id: producerUser, name: 'Autora nacional sintética', organization_id: producerOrg, roles: ['OPERATOR'] },
    ...destinations.map(destination => ({ id: destination.user, name: `Recebedor sintético ${destination.state}`, organization_id: destination.organization, roles: ['OPERATOR'] })),
  ] });
  await owner.membership.createMany({ data: [
    { user_id: producerUser, organization_id: producerOrg, role: 'OPERATOR' },
    ...destinations.map(destination => ({ user_id: destination.user, organization_id: destination.organization, role: 'OPERATOR' })),
  ] });
  await owner.conversionParameter.create({ data: { id: parameterId, input_product: 'tora', output_product: 'serrado', coefficient: '0.35', regulation_reference: 'SIMULADA', source_url: 'https://example.invalid/national-test', version: runId, valid_from: new Date('2026-01-01'), data_provenance: 'SIMULADA' } });
  app = await buildServer(); producer = await login(producerUser);
  const document = await post('documents', { name: 'Autorização nacional SIMULADA', type: 'AUTHORIZATION', content_base64: Buffer.from('FICTÍCIO, SEM VALIDADE OFICIAL').toString('base64'), source: 'Teste nacional isolado', data_provenance: 'SIMULADA', assessment_scope: 'DEMONSTRATIVO', visibility: 'PRIVATE' });
  documentId = document.json().document.id;
  const plot = await post('plots', { organization_id: producerOrg, country: 'BR', state: 'AM', municipality: 'Teste', declared_property: 'Parcela sintética', geometry, geometry_version: 1, geometry_date: '2026-11-06', data_provenance: { geometry: 'SIMULADA' } });
  plotId = plot.json().plot.id;
});

afterAll(async () => {
  await app?.close(); await Promise.all([owner.$disconnect(), prisma.$disconnect()]);
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
  // Only this suite's freshly created private directory is removed.
  if (storage) await rm(storage, { recursive: true, force: true });
});

describe.sequential('cadastro e cadeia persistida para as 27 UFs com provedor offline', () => {
  it.each(destinations)('AM → $state: registra custódia, trace e pacote sem aprovação presumida', async destination => {
    const receiver = await login(destination.user);
    const destinationPlot = await post('plots', { organization_id: destination.organization, country: 'BR', state: destination.state, municipality: 'Teste', declared_property: 'Cadastro nacional sintético', geometry, geometry_version: 1, geometry_date: '2026-11-06', data_provenance: { geometry: 'SIMULADA' } }, receiver);
    expect(destinationPlot.json().plot.state).toBe(destination.state);
    await post(`documents/${documentId}/grants`, { organization_id: destination.organization });
    const origin = (await post('origin-lots', { plot_id: plotId, code: `NATIONAL-${runId}-${destination.state}`, species_common_name: 'Exemplo', species_scientific_name: 'Exemplo', authorized_volume_m3: '10', permit_reference: 'SIMULADA', permit_document_id: documentId, valid_from: '2026-01-01', valid_until: '2027-12-31', right_of_use: 'SIMULADO', assessment_scope: 'DEMONSTRATIVO', data_provenance: { volume: 'SIMULADA' } })).json().origin_lot.id;
    await post('harvests', { origin_lot_id: origin, start_date: '2026-11-05', end_date: '2026-11-05', volume_m3: '10' });
    const shipment = (await post('shipments', { sender_organization_id: producerOrg, recipient_organization_id: destination.organization, origin_state: 'AM', destination_state: destination.state, route_states: [...new Set(['AM', destination.state])], items: [{ lot_id: origin, volume_m3: '10' }], transporter: 'SIMULADO', official_system: 'NAO_VERIFICADO', document_ids: [documentId] })).json().shipment.id;
    await post(`shipments/${shipment}/dispatch`, { occurred_at: new Date().toISOString() });
    await post(`shipments/${shipment}/receive`, { occurred_at: new Date().toISOString(), items: [{ lot_id: origin, volume_m3: '10' }] }, receiver);
    const assessment = await post('regulatory/assessments', { entity_type: 'SHIPMENT', entity_id: shipment, modality: `ISOLATED_SOFTWARE_TEST_${runId}` });
    expect(assessment.body).toContain('PENDENTE_DE_VERIFICACAO');
    const transformation = (await post('transformations', { code: `NATIONAL-TRANSFORM-${runId}-${destination.state}`, occurred_at: new Date().toISOString(), operator_organization_id: destination.organization, conversion_parameter_id: parameterId, inputs: [{ lot_id: origin, volume_m3: '10' }], outputs: [{ client_ref: `NATIONAL-PRODUCT-${runId}-${destination.state}`, product: 'serrado', volume_m3: '3', allocations: [{ origin_lot_id: origin, volume_m3: '3' }] }], residue_m3: '7', loss_m3: '0', assessment_scope: 'DEMONSTRATIVO' }, receiver)).json();
    const product = transformation.outputs[0].product_lot.id;
    const trace = await app.inject({ url: `/api/v1/product-lots/${product}/trace`, headers: receiver });
    expect(trace.statusCode, trace.body).toBe(200);
    expect(trace.json().ancestry.shipments).toEqual(expect.arrayContaining([expect.objectContaining({ id: shipment, origin_state: 'AM', destination_state: destination.state, status: 'RECEIVED' })]));
    expect(trace.json().metrics).toMatchObject({ total_volume_m3: '3', tracked_fraction: '1' });
    const senderBalance = await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: origin, organization_id: producerOrg } } });
    const recipientBalance = await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: origin, organization_id: destination.organization } } });
    expect(senderBalance.available_m3.toString()).toBe('0'); expect(senderBalance.reserved_m3.toString()).toBe('0'); expect(senderBalance.quarantined_m3.toString()).toBe('0');
    expect(recipientBalance.available_m3.toString()).toBe('0');
    const passportResponse = (await post('passports', { product_lot_id: product, assessment_scope: 'DEMONSTRATIVO' }, receiver)).json();
    const passport = passportResponse.passport.id; const token = passportResponse.passport.public_token;
    expect(passportResponse.readiness.readiness).toBe('MISSING_EVIDENCE');
    const bundle = await app.inject({ url: `/api/v1/passports/${passport}/bundle?format=JSON`, headers: receiver });
    expect(bundle.statusCode, bundle.body).toBe(200);
    expect(bundle.json().regulatory_summary.coverage).toBe('PENDENTE_DE_VERIFICACAO');
    expect(bundle.json().current_state.readiness_status).toBe('MISSING_EVIDENCE');
    expect(bundle.json().evidence.shipments).toEqual(expect.arrayContaining([expect.objectContaining({ id: shipment, destination_state: destination.state })]));
    const publicResponse = await app.inject({ url: `/api/v1/public/passports/${token}` });
    expect(publicResponse.statusCode).toBe(200);
    expect(publicResponse.json().regulatory_coverage).toBe('PENDENTE_DE_VERIFICACAO');
    expect(publicResponse.body).toContain('MISSING_EVIDENCE');
    expect(publicResponse.body).not.toMatch(/coordinates|geometry|storage_key|created_by_user_id|fiscal_key|content_base64/);
    expect(fetchMock).not.toHaveBeenCalled();
    deliveries.push({ state: destination.state, origin, shipment, product, passport, token, session: receiver, document: documentId });
  });

  it('reabre servidor e conexão e recupera todas as 27 cadeias, arquivos e JSON público sem rede', async () => {
    expect(deliveries).toHaveLength(27);
    await app.close(); await prisma.$disconnect();
    app = await buildServer();
    for (const delivery of deliveries) {
      const trace = await app.inject({ url: `/api/v1/product-lots/${delivery.product}/trace`, headers: delivery.session });
      expect(trace.statusCode, trace.body).toBe(200);
      expect(trace.json().ancestry.shipments.some((shipment: { id: string }) => shipment.id === delivery.shipment)).toBe(true);
      const bundle = await app.inject({ url: `/api/v1/passports/${delivery.passport}/bundle?format=HTML`, headers: delivery.session });
      expect(bundle.statusCode, bundle.body).toBe(200); expect(bundle.body).toContain('MISSING_EVIDENCE');
      const publicResponse = await app.inject({ url: `/api/v1/public/passports/${delivery.token}` });
      expect(publicResponse.statusCode).toBe(200);
    }
    const document = await app.inject({ url: `/api/v1/documents/${documentId}/download`, headers: producer });
    expect(document.statusCode).toBe(200); expect(document.body).toContain('FICTÍCIO');
    expect(fetchMock).not.toHaveBeenCalled();
  }, 60_000);

  it('preserva cache identificado após reinício e mantém indisponibilidade sem falso PASSOU', async () => {
    const origin = deliveries[0]!.origin;
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: 'analysis_completed', data: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null, properties: { Area: 1.23, TreeCover: 42 } }] } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const first = await post(`lots/${origin}/assess`, {});
    const completed = await finished(first.json().source_query.id);
    expect(completed.data_provenance).toBe('REAL_CONSULTADA');
    expect(completed.assessment_scope).toBe('DEMONSTRATIVO');
    await app.close(); await prisma.$disconnect(); app = await buildServer();
    const calls = fetchMock.mock.calls.length;
    const cached = await post(`lots/${origin}/assess`, {});
    expect(cached.statusCode).toBe(200);
    expect(cached.json().assessment).toMatchObject({ reused_cache: true, original_queried_at: completed.created_at.toISOString() });
    expect(cached.json().source_query.id).toBe(completed.id);
    expect(fetchMock.mock.calls.length).toBe(calls);
    const refreshed = await post(`lots/${origin}/assess`, { refresh: true });
    const unavailable = await finished(refreshed.json().source_query.id);
    expect(unavailable.status).toBe('NAO_AVALIADO'); expect(unavailable.data_provenance).toBe('INDISPONIVEL');
    expect(await owner.check.count({ where: { entity_id: origin, rule_id: 'GEO_PROVIDER', status: 'PASSOU' } })).toBe(0);
    const history = await app.inject({ url: `/api/v1/lots/${origin}/assessments`, headers: producer });
    expect(history.statusCode).toBe(200);
    expect(history.json().source_queries).toHaveLength(2);
    expect(history.body).not.toContain('national-isolated-provider-key');
    expect((await app.inject({ url: `/api/v1/public/passports/${deliveries[0]!.token}` })).body).toContain('MISSING_EVIDENCE');
  });
});
