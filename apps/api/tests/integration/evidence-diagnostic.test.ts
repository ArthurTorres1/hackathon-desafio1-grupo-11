import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { sha256Canonical } from '../../src/services/integrity.js';

const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const org = randomUUID(); const outsiderOrg = randomUUID();
const user = randomUUID(); const outsider = randomUUID(); const sourceId = randomUUID();
let app: Awaited<ReturnType<typeof buildServer>>;
let lotId: string; let documentId: string;
let cookie: string; let outsiderCookie: string;
const geometry = { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] };

async function login(id: string) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: id } });
  expect(response.statusCode, response.body).toBe(200);
  return response.cookies.map(value => `${value.name}=${value.value}`).join('; ');
}

beforeAll(async () => {
  await owner.organization.createMany({ data: [org, outsiderOrg].map(id => ({ id, name: 'Diagnóstico sintético', role: 'OPERATOR', state: 'AM', municipality: 'Teste', data_provenance: { label: 'SIMULADA' } })) });
  await owner.user.createMany({ data: [{ id: user, name: 'Autor sintético', organization_id: org, roles: ['OPERATOR'] }, { id: outsider, name: 'Outro autor sintético', organization_id: outsiderOrg, roles: ['OPERATOR'] }] });
  await owner.membership.createMany({ data: [{ user_id: user, organization_id: org, role: 'OPERATOR' }, { user_id: outsider, organization_id: outsiderOrg, role: 'OPERATOR' }] });
  const plot = await owner.plot.create({ data: { organization_id: org, state: 'AM', municipality: 'Teste', declared_property: 'Área fictícia', geometry, geometry_hash: sha256Canonical(geometry), geometry_date: new Date('2026-11-06'), area_ha: '1.23', created_by_user_id: user, data_provenance: { geometry: { label: 'DADO_PUBLICO_IMPORTADO', source: 'Amostra pública sintética de teste', informed_by: 'Teste', recorded_at: '2026-11-06T00:00:00Z', confidence: 'NAO_AVALIADA' } } } });
  const lot = await owner.originLot.create({ data: { code: `DIAGNOSTIC-${randomUUID()}`, organization_id: org, plot_id: plot.id, species_common: 'Exemplo', species_scientific: 'Exemplo', authorized_volume_m3: '10', valid_from: new Date('2026-01-01'), valid_until: new Date('2027-12-31'), right_of_use: 'SIMULADO', data_provenance: { label: 'SIMULADA' }, created_by_user_id: user } });
  lotId = lot.id;
  const document = await owner.document.create({ data: { organization_id: org, name: 'Autorização sintética', type: 'AUTHORIZATION', source: 'Fixture', content_hash: 'a'.repeat(64), storage_key: randomUUID(), content_type: 'text/plain', data_provenance: 'SIMULADA', allowed_organization_ids: [], created_by_user_id: user } });
  documentId = document.id;
  await owner.permit.create({ data: { origin_lot_id: lotId, reference: 'SIMULADA', issuing_authority: 'SIMULADA', official_system: 'NAO_VERIFICADO', document_id: documentId, valid_from: lot.valid_from, valid_until: lot.valid_until, volume_m3: '10', data_provenance: { label: 'SIMULADA' } } });
  await owner.source.create({ data: { id: sourceId, name: 'Fonte isolada', owner: 'Teste', url: 'https://example.invalid', access_mode: 'FIXTURE', requires_auth: false, spatial_coverage: 'Amostra isolada', time_coverage: '2026', update_frequency: 'FIXTURE', license: 'Sintética', fields_used: ['geometry'], integration_status: 'SEM_INTEGRACAO_REAL', confidence: 'NAO_AVALIADA', limitations: 'Sem consulta real', checked_at: new Date() } });
  const payload = { geometry_version: 1, geometry_provenance: plot.data_provenance, request: { geometry } };
  const result = { assessment: { provenance: 'SIMULADA', result: 'NAO_AVALIADO' } };
  await owner.sourceQuery.create({ data: { organization_id: org, lot_id: lotId, source_id: sourceId, geometry_hash: plot.geometry_hash, payload, result, payload_hash: sha256Canonical(payload), result_hash: sha256Canonical(result), status: 'NAO_AVALIADO', provider_version: 'isolated-test-v1', assessment_scope: 'DEMONSTRATIVO', data_provenance: 'SIMULADA' } });
  app = await buildServer(); cookie = await login(user); outsiderCookie = await login(outsider);
});
afterAll(async () => { await app?.close(); await Promise.all([owner.$disconnect(), prisma.$disconnect()]); });

describe('proveniência persistida no diagnóstico autorizado', () => {
  it('preserva geometria importada, autorização simulada e catálogo/consulta sem promover evidência', async () => {
    const response = await app.inject({ url: `/api/v1/origin-lots/${lotId}/evidence-diagnostic/export`, headers: { cookie } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-disposition']).toContain('attachment');
    const report = response.json();
    expect(report.assessment_scope).toBe('DEMONSTRATIVO');
    expect(report.regulatory_coverage).toBe('PENDENTE_DE_VERIFICACAO');
    expect(report.fields.find((value: { field: string }) => value.field === 'geometry').provenance.label).toBe('DADO_PUBLICO_IMPORTADO');
    expect(report.documents.find((value: { id: string }) => value.id === documentId).data_provenance).toBe('SIMULADA');
    expect(report.sources[0]).toMatchObject({ id: sourceId, owner: 'Teste', integration_status: 'SEM_INTEGRACAO_REAL', license: 'Sintética' });
    const query = report.source_queries[0];
    expect(query.payload_hash).toBe(sha256Canonical(query.payload));
    expect(query.result_hash).toBe(sha256Canonical(query.result));
    expect(query.data_provenance).toBe('SIMULADA');
    expect(report.documents[0].storage_key).toBeUndefined();
  });

  it('nega consulta/arquivo a organização alheia e a sessão ausente', async () => {
    for (const suffix of ['', '/export']) {
      const url = `/api/v1/origin-lots/${lotId}/evidence-diagnostic${suffix}`;
      expect((await app.inject({ url })).statusCode).toBe(401);
      const other = await app.inject({ url, headers: { cookie: outsiderCookie } });
      expect(other.statusCode).toBe(404);
      expect(other.body).not.toContain(documentId);
      expect(other.body).not.toContain('coordinates');
    }
  });

  it('expõe schemas de resposta e erros no OpenAPI', async () => {
    const spec = (await app.inject({ url: '/openapi.json' })).json();
    expect(spec.paths['/api/v1/plots'].post.responses['201']).toBeDefined();
    expect(spec.paths['/api/v1/plots'].post.responses['4XX'] ?? spec.paths['/api/v1/plots'].post.responses['4xx']).toBeDefined();
    expect(spec.paths['/api/v1/origin-lots/{id}/evidence-diagnostic/export'].get.responses['200']).toBeDefined();
  });
});
