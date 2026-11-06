import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UF_CODES } from '@foresttrace/contracts';
import { buildServer } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { sha256Canonical } from '../../src/services/integrity.js';

const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const organization = randomUUID(); const otherOrganization = randomUUID();
const user = randomUUID(); const otherUser = randomUUID();
const geometry = { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] };
let app: Awaited<ReturnType<typeof buildServer>>;
let storage: string;
let headers: Record<string, string>; let otherHeaders: Record<string, string>;
let plotId: string; let lotId: string; let documentId: string;
const post = (path: string, payload: object) => app.inject({ method: 'POST', url: `/api/v1/${path}`, payload, headers: { ...headers, 'idempotency-key': randomUUID() } });

beforeAll(async () => {
  storage = await mkdtemp(join(tmpdir(), 'foresttrace-registration-'));
  process.env.PRIVATE_STORAGE_DIR = storage;
  for (const [id, userId] of [[organization, user], [otherOrganization, otherUser]]) {
    await owner.organization.create({ data: { id, name: 'Cadastro sintético isolado', role: 'OPERATOR', state: 'AM', municipality: 'Teste', data_provenance: { label: 'SIMULADA' } } });
    await owner.user.create({ data: { id: userId, name: 'Operador sintético', organization_id: id!, roles: ['OPERATOR'] } });
    await owner.membership.create({ data: { user_id: userId!, organization_id: id!, role: 'OPERATOR' } });
  }
  app = await buildServer();
  const login = async (id: string) => {
    const result = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: id } });
    expect(result.statusCode, result.body).toBe(200);
    return { cookie: result.cookies.map(c => `${c.name}=${c.value}`).join('; '), 'x-csrf-token': result.json().csrf_token };
  };
  headers = await login(user); otherHeaders = await login(otherUser);
});
afterAll(async () => { await app?.close(); await Promise.all([owner.$disconnect(), prisma.$disconnect()]); if (storage) await rm(storage, { recursive: true, force: true }); });

describe.sequential('cadastro e consulta de parcelas/lotes persistidos', () => {
  it('aceita parcelas nas 27 UFs e consulta área/hash/autoria sem confirmar autorização', async () => {
    for (const state of UF_CODES) {
      const result = await post('plots', { organization_id: organization, country: 'BR', state, municipality: 'Teste sintético', declared_property: 'Área fictícia', geometry, geometry_version: 1, geometry_date: '2026-11-06', data_provenance: { geometry: 'SIMULADA' } });
      expect(result.statusCode, result.body).toBe(201);
      const plot = result.json().plot;
      plotId = plot.id;
      expect(plot.geometry_hash).toBe(sha256Canonical(geometry));
      expect(plot.created_by_user_id).toBe(user);
      const read = await app.inject({ url: `/api/v1/plots/${plotId}`, headers });
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json().plot.state).toBe(state);
      expect(Number(read.json().plot.area_ha)).toBeGreaterThan(1.2);
      expect(Number(read.json().plot.area_ha)).toBeLessThan(1.3);
    }
    const list = await app.inject({ url: '/api/v1/plots', headers });
    expect(list.json().plots).toHaveLength(27);
  });

  it('rejeita anel aberto, autointerseção e limites sem persistir parcela', async () => {
    const before = await owner.plot.count({ where: { organization_id: organization } });
    for (const coordinates of [
      [[[-60,-3],[-59,-3],[-59,-2],[-60,-2]]],
      [[[-60,-3],[-59,-2],[-60,-2],[-59,-3],[-60,-3]]],
      [[[181,-3],[182,-3],[182,-2],[181,-2],[181,-3]]],
    ]) {
      const response = await post('plots', { organization_id: organization, country: 'BR', state: 'AM', municipality: 'Teste', declared_property: 'Inválida', geometry: { type: 'Polygon', coordinates }, geometry_version: 1, geometry_date: '2026-11-06', data_provenance: {} });
      expect(response.statusCode, response.body).toBe(422);
      expect(response.json().checks[0].rule_id).toBe('R01');
    }
    expect(await owner.plot.count({ where: { organization_id: organization } })).toBe(before);
  });

  it('recupera lote, parcela e autorização com IDs próprios e saldo zero', async () => {
    const document = await post('documents', { name: 'autorizacao-sintetica.txt', type: 'AUTHORIZATION', content_base64: Buffer.from('SEM VALIDADE OFICIAL').toString('base64'), source: 'Teste sintético', data_provenance: 'SIMULADA', assessment_scope: 'DEMONSTRATIVO', visibility: 'PRIVATE' });
    expect(document.statusCode, document.body).toBe(201); documentId = document.json().document.id;
    const result = await post('origin-lots', { plot_id: plotId, code: `REG-${randomUUID()}`, species_common_name: 'Exemplo', species_scientific_name: 'Exemplo sintético', authorized_volume_m3: '10.000001', permit_reference: 'SIMULADA', permit_document_id: documentId, valid_from: '2026-01-01', valid_until: '2027-12-31', right_of_use: 'Declaração sintética', assessment_scope: 'DEMONSTRATIVO', data_provenance: { volume: 'SIMULADA' } });
    expect(result.statusCode, result.body).toBe(201); lotId = result.json().origin_lot.id;
    expect(new Set([lotId, plotId, documentId]).size).toBe(3);
    const read = await app.inject({ url: `/api/v1/origin-lots/${lotId}`, headers });
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().origin_lot.authorized_volume_m3).toBe('10.000001');
    expect(read.json().origin_lot.plot.id).toBe(plotId);
    expect(read.json().origin_lot.permits[0].document_id).toBe(documentId);
    expect(read.json().balance.available_m3).toBe('0');
    const checks = await owner.check.findMany({ where: { entity_id: lotId } });
    expect(checks.every(check => check.status !== 'PASSOU')).toBe(true);
  });

  it('nega leitura sem sessão e de outra organização, inclusive conhecendo IDs', async () => {
    for (const path of [`plots/${plotId}`, `origin-lots/${lotId}`]) {
      expect((await app.inject({ url: `/api/v1/${path}` })).statusCode).toBe(401);
      const denied = await app.inject({ url: `/api/v1/${path}`, headers: otherHeaders });
      expect(denied.statusCode).toBe(404);
      expect(denied.body).not.toContain('coordinates');
    }
    expect((await app.inject({ url: '/api/v1/plots', headers: otherHeaders })).json().plots).toEqual([]);
    expect((await app.inject({ url: '/api/v1/origin-lots', headers: otherHeaders })).json().origin_lots).toEqual([]);
  });
});
