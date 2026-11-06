import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { UF_CODES } from '@foresttrace/contracts';
import { buildServer } from '../../src/app.js';
import { prisma } from '../../src/db.js';

const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const organization = randomUUID(), otherOrganization = randomUUID(), user = randomUUID(), otherUser = randomUUID();
const modality = `ISOLATED_SYNTHETIC_${randomUUID()}`;
let app: Awaited<ReturnType<typeof buildServer>>;
let headers: Record<string, string>, otherHeaders: Record<string, string>;
const lots = new Map<string, string>();
let firstRule: string;
const assess = (lotId: string, key = randomUUID(), auth = headers) => app.inject({ method: 'POST', url: '/api/v1/regulatory/assessments', headers: { ...auth, 'idempotency-key': key }, payload: { entity_type: 'ORIGIN_LOT', entity_id: lotId, modality, occurred_on: '2026-11-06' } });
const history = (lotId: string, auth = headers) => app.inject({ url: `/api/v1/regulatory/assessments/ORIGIN_LOT/${lotId}`, headers: auth });
const requirement = (jurisdiction: string) => ({ jurisdiction, phase: 'ORIGIN', product: 'tora', modality, official_system: 'NAO_VERIFICADO', source_url: 'https://example.invalid/isolated-synthetic-profile', article: 'ISOLATED_TEST_NO_OFFICIAL_VALUE', version: '1', valid_from: new Date('2026-01-01'), coverage: 'CONFIRMADA' as const, required_evidence: ['ISOLATED_SYNTHETIC_DOCUMENT'], resolution_criteria: 'Somente teste de software; não usar como regra normativa', checked_at: new Date('2026-11-06'), checked_by: 'PRIVATE_TEST_AUTHOR' });

beforeAll(async () => {
  for (const [id, actor, role] of [[organization, user, 'AUDITOR'], [otherOrganization, otherUser, 'BUYER']] as const) {
    await owner.organization.create({ data: { id, name: 'Normativa sintética isolada', role, state: 'AM', municipality: 'Teste', data_provenance: { label: 'SIMULADA' } } });
    await owner.user.create({ data: { id: actor, name: 'Teste isolado', organization_id: id, roles: [role] } });
    await owner.membership.create({ data: { user_id: actor, organization_id: id, role } });
  }
  for (const state of UF_CODES) {
    const plot = await owner.plot.create({ data: { organization_id: organization, state, municipality: 'Teste', declared_property: 'SIMULADA', geometry: { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] }, geometry_hash: '0'.repeat(64), geometry_date: new Date('2026-11-06'), area_ha: '1.2', data_provenance: { label: 'SIMULADA' }, created_by_user_id: user } });
    const lot = await owner.originLot.create({ data: { organization_id: organization, plot_id: plot.id, code: `REG-TEST-${randomUUID()}`, species_common: 'Sintética', species_scientific: 'Sintética', authorized_volume_m3: '10', valid_from: new Date('2026-01-01'), valid_until: new Date('2027-12-31'), right_of_use: 'SEM VALIDADE OFICIAL', data_provenance: { label: 'SIMULADA' }, created_by_user_id: user } });
    lots.set(state, lot.id);
  }
  app = await buildServer();
  const login = async (id: string) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: id } });
    expect(response.statusCode, response.body).toBe(200);
    return { cookie: response.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), 'x-csrf-token': response.json().csrf_token };
  };
  headers = await login(user); otherHeaders = await login(otherUser);
});
afterAll(async () => { await app?.close(); await Promise.all([owner.$disconnect(), prisma.$disconnect()]); });

describe.sequential('avaliação normativa versionada e autorizada no banco', () => {
  it('nas 27 UFs, ausência de perfil preserva fatos e gera pendência explícita', async () => {
    for (const [state, lotId] of lots) {
      const response = await assess(lotId);
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().assessment).toMatchObject({ coverage: 'PENDENTE_DE_VERIFICACAO', version: 1, created_by_user_id: user });
      expect(response.json().assessment.gaps).toEqual(expect.arrayContaining([expect.objectContaining({ jurisdiction: state, code: 'NO_APPLICABLE_PROFILE' })]));
      expect((await history(lotId)).json().public_summary.coverage).toBe('PENDENTE_DE_VERIFICACAO');
      expect((await owner.originLot.findUniqueOrThrow({ where: { id: lotId } })).harvested_volume_m3.toString()).toBe('0');
    }
  });

  it('consulta autorizada aceita BR/UF e rejeita sigla inválida, anônimo e comprador', async () => {
    for (const jurisdiction of ['BR', 'AM']) expect((await app.inject({ url: `/api/v1/regulatory/requirements?jurisdiction=${jurisdiction}`, headers })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/v1/regulatory/requirements?jurisdiction=XX', headers })).statusCode).toBe(422);
    expect((await app.inject({ url: '/api/v1/regulatory/requirements' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/v1/regulatory/requirements', headers: otherHeaders })).statusCode).toBe(403);
    expect((await history(lots.get('AM')!, otherHeaders)).statusCode).toBe(403);
    expect((await assess(lots.get('AM')!, randomUUID(), otherHeaders)).statusCode).toBe(403);
    await owner.user.update({ where: { id: otherUser }, data: { roles: ['BUYER', 'AUDITOR'] } });
    await owner.membership.create({ data: { user_id: otherUser, organization_id: otherOrganization, role: 'AUDITOR' } });
    expect((await history(lots.get('AM')!, otherHeaders)).statusCode).toBe(404);
    expect((await assess(lots.get('AM')!, randomUUID(), otherHeaders)).statusCode).toBe(404);
  });

  it('auditor grava versão com perfis local/federal isolados, replay e resumo minimizado', async () => {
    await owner.regulatoryRequirement.create({ data: requirement('BR') });
    firstRule = (await owner.regulatoryRequirement.create({ data: requirement('AM') })).id;
    const lotId = lots.get('AM')!, key = randomUUID();
    const response = await assess(lotId, key), replay = await assess(lotId, key);
    expect(response.statusCode, response.body).toBe(201); expect(replay.body).toBe(response.body);
    expect(response.json().assessment).toMatchObject({ version: 2, coverage: 'CONFIRMADA' });
    expect(response.json().public_summary).toEqual({ coverage: 'CONFIRMADA', gap_count: 0, pending_phases: [] });
    expect(JSON.stringify(response.json().public_summary)).not.toMatch(/PRIVATE_TEST_AUTHOR|example.invalid|requirement_id/);
    expect((await history(lotId)).json().public_summary.coverage).toBe('CONFIRMADA');
    const check = await owner.check.findFirstOrThrow({ where: { entity_id: lotId, rule_id: 'REGULATORY_COVERAGE' }, orderBy: { created_at: 'desc' } });
    expect(check.status).toBe('NAO_AVALIADO'); // Profile coverage alone does not confer documentary approval.
    expect(await owner.custodyEvent.count({ where: { stream_id: lotId, type: 'REGULATORY_ASSESSMENT_RECORDED' } })).toBe(2);
  });

  it('nova versão com lista vazia invalida resumo atual sem reescrever avaliações anteriores', async () => {
    await owner.regulatoryRequirement.create({ data: { ...requirement('AM'), version: '2', supersedes_id: firstRule, required_evidence: [] } });
    const lotId = lots.get('AM')!;
    expect((await history(lotId)).json().public_summary.coverage).toBe('PENDENTE_DE_VERIFICACAO');
    const response = await assess(lotId);
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().assessment).toMatchObject({ version: 3, coverage: 'PENDENTE_DE_VERIFICACAO' });
    const rows = (await history(lotId)).json().assessments;
    expect(rows.find((value: { version: number }) => value.version === 2).coverage).toBe('CONFIRMADA');
    expect(rows.find((value: { version: number }) => value.version === 1).coverage).toBe('PENDENTE_DE_VERIFICACAO');
  });

  it('fonte conflitante mantém conflito e mudança da operação invalida contexto', async () => {
    await owner.regulatoryRequirement.create({ data: { ...requirement('AM'), source_url: 'https://example.invalid/conflicting-synthetic-profile', coverage: 'CONFLITANTE' } });
    const lotId = lots.get('AM')!;
    const response = await assess(lotId);
    expect(response.json().assessment.coverage).toBe('CONFLITANTE');
    expect((await history(lotId)).json().public_summary.coverage).toBe('CONFLITANTE');
    await owner.originLot.update({ where: { id: lotId }, data: { version: { increment: 1 } } });
    expect((await history(lotId)).json().public_summary.coverage).toBe('PENDENTE_DE_VERIFICACAO');
  });
});
