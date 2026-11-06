import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import { ForestUtilizationResponseSchema } from '@foresttrace/contracts';
const mocks = vi.hoisted(() => ({ session: vi.fn(), log: vi.fn(), transaction: vi.fn() }));
vi.mock('../../src/db.js', () => ({ prisma: { session: { findUnique: mocks.session }, accessLog: { create: mocks.log }, $transaction: mocks.transaction } }));
import { buildServer } from '../../src/app.js';
import * as calculator from '../../src/services/forest-utilization.js';

const input = { area_total_ha: '120', area_app_ha: '20', area_effective_ha: '100', extracted_log_volume_m3: '2100', declared_sawn_volume_m3: '714', management_profile_id: 'DEMO_MECHANIZED_35Y_V1' };
const headers = { cookie: 'foresttrace_session=test-session; foresttrace_csrf=test-csrf', 'x-csrf-token': 'test-csrf', 'idempotency-key': 'calculation-test' };
const url = '/api/v1/calculations/forest-utilization';
let app: Awaited<ReturnType<typeof buildServer>>;
let roles = ['OPERATOR'];
beforeAll(async () => { app = await buildServer(); });
afterAll(async () => { await app?.close(); });
beforeEach(() => {
  roles = ['OPERATOR'];
  mocks.log.mockReset().mockResolvedValue({});
  mocks.transaction.mockReset().mockImplementation(() => { throw new Error('Cálculo não pode persistir operações.'); });
  mocks.session.mockReset().mockImplementation(async () => ({ user_id: 'test-user', expires_at: new Date(Date.now() + 60_000), csrf_hash: createHash('sha256').update('test-csrf').digest('hex'), user: { id: 'test-user', organization_id: 'test-org', roles } }));
});
describe('API de cálculo demonstrativo isolada do banco operacional', () => {
  it('nega anônimo sem executar domínio ou transação', async () => {
    const response = await app.inject({ method: 'POST', url, payload: input });
    expect(response.statusCode).toBe(401); expect(response.json().error.code).toBe('AUTH_REQUIRED');
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('exige CSRF e papel autorizado', async () => {
    expect((await app.inject({ method: 'POST', url, payload: input, headers: { cookie: headers.cookie } })).statusCode).toBe(403);
    roles = ['BUYER'];
    expect((await app.inject({ method: 'POST', url, payload: input, headers })).statusCode).toBe(403);
  });
  it('calcula como operador ou auditor e valida contrato sem mutação', async () => {
    for (const role of ['OPERATOR', 'AUDITOR']) {
      roles = [role];
      const response = await app.inject({ method: 'POST', url, payload: input, headers });
      expect(response.statusCode, response.body).toBe(200);
      const report = response.json();
      expect(Value.Check(ForestUtilizationResponseSchema, report)).toBe(true);
      expect(report).toMatchObject({ assessment_scope: 'DEMONSTRATIVO', readiness: 'MISSING_EVIDENCE', origin: { intensity_m3_ha: '21', utilization_pct: '70' }, mill: { crv_pct: '34' } });
    }
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
  });
  it.each([
    { area_total_ha: '-1' }, { area_app_ha: '121' }, { area_effective_ha: '101' },
    { extracted_log_volume_m3: '1.0000001' }, { declared_sawn_volume_m3: 714 },
    { management_profile_id: 'UNKNOWN' }, { crv_limit: '0.45' }, { approved_exception: true },
  ])('rejeita entrada inválida ou parâmetro não autorizado: %j', async change => {
    const response = await app.inject({ method: 'POST', url, payload: { ...input, ...change }, headers });
    expect(response.statusCode, response.body).toBe(422);
    expect(response.json().error.request_id).toEqual(expect.any(String));
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('publica os schemas no OpenAPI', async () => {
    const response = await app.inject({ url: '/openapi.json' });
    const operation = response.json().paths[url].post;
    expect(operation.requestBody).toBeDefined(); expect(operation.responses['200']).toBeDefined();
  });
  it('rejeita relatório interno incompatível antes da serialização', async () => {
    const report = calculator.calculateForestUtilization(input as calculator.ForestUtilizationInput);
    const spy = vi.spyOn(calculator, 'calculateForestUtilization').mockReturnValue({ ...report, readiness: 'READY_FOR_OPERATOR_REVIEW' } as unknown as calculator.ForestUtilizationReport);
    try {
      const response = await app.inject({ method: 'POST', url, payload: input, headers });
      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
      expect(response.body).not.toContain('READY_FOR_OPERATOR_REVIEW');
    } finally { spy.mockRestore(); }
  });
});
