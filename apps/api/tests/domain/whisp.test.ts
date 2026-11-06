import { describe, expect, it, vi } from 'vitest';
import { assessWhisp, buildWhispRequest, createHttpWhispTransport, whispQueryHash, WHISP_PROVIDER_VERSION, WHISP_SUBMIT_URL, type WhispFetch, type WhispTransport } from '../../src/services/whisp.js';

const geometry = { type: 'Polygon', coordinates: [[[-60, -3], [-59.9, -3], [-59.9, -2.9], [-60, -2.9], [-60, -3]]] };
const collection = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry, properties: { Area: 123, Treecover: 0 } }] };
const completed = { code: 'analysis_completed', message: 'Complete', data: collection };
const queued = { code: 'analysis_queued', message: 'Queued', data: { token: 'job-1', statusUrl: 'https://untrusted.example/steal' } };
const processing = { code: 'analysis_processing', data: { token: 'job-1', percent: 30 } };
const input = { geometry, contractConfirmed: true, apiKey: 'test-key', pollIntervalMs: 0 };
const instant = vi.fn(async (_ms: number) => {});
function transport(responses: { status: number; body?: unknown; retryAfter?: string }[]) {
  const fn = vi.fn();
  for (const response of responses) fn.mockResolvedValueOnce(response);
  return { submit: fn, poll: fn } satisfies WhispTransport;
}

describe('Whisp official contract', () => {
  it('constructs a FeatureCollection with official options, never the provisional geometry/options body', () => {
    expect(buildWhispRequest(geometry)).toEqual({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }], analysisOptions: { nationalCodes: ['br'], unitType: 'ha', async: true, geometryAuditTrail: false } });
    expect(() => buildWhispRequest(geometry, { callbackUrl: 'https://example.test' })).toThrow('Opções Whisp inválidas');
    expect(() => buildWhispRequest(geometry, { async: 'true' })).toThrow('Opções Whisp inválidas');
  });
  it('uses HTTPS, the API key header, rejects redirects, and ignores provider-supplied status URLs', async () => {
    const fetchMock = vi.fn<WhispFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(queued), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completed), { status: 200 }));
    const result = await assessWhisp({ ...input, transport: createHttpWhispTransport({ fetchImpl: fetchMock }) });
    expect(result).toMatchObject({ integration: 'REAL', result: 'CONCLUIDO', provenance: 'REAL_CONSULTADA', job_id: 'job-1', provider_result: collection });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(WHISP_SUBMIT_URL);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://whisp.openforis.org/api/status/job-1');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'X-API-KEY': 'test-key' } });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual(buildWhispRequest(geometry));
    expect(fetchMock.mock.calls[0]?.[1]?.headers).not.toHaveProperty('idempotency-key');
  });
  it('rejects insecure or credential-bearing configured endpoints and cross-origin polls before fetching', async () => {
    expect(() => createHttpWhispTransport({ submitUrl: 'http://example.test/api' })).toThrow('HTTPS');
    expect(() => createHttpWhispTransport({ submitUrl: 'https://user:password@example.test/api' })).toThrow('HTTPS');
    const fetchMock = vi.fn<WhispFetch>();
    const adapter = createHttpWhispTransport({ pollUrl: () => 'https://untrusted.example/api', fetchImpl: fetchMock });
    await expect(adapter.poll({ job_id: 'job', api_key: 'test-key', timeout_ms: 1 })).rejects.toThrow('mesma origem');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Whisp assessment boundaries', () => {
  it.each([
    { contractConfirmed: false, apiKey: 'test-key' },
    { contractConfirmed: true, apiKey: '' },
  ])('keeps the real assessment unevaluated without confirmed access: %j', async (access) => {
    const adapter = transport([]);
    const result = await assessWhisp({ ...input, ...access, transport: adapter, simulatedFixture: { signal: 'fixture' } });
    expect(result).toMatchObject({ integration: 'SEM_INTEGRACAO_REAL', result: 'NAO_AVALIADO', provenance: 'SIMULADA', attempts: 0, simulated_fixture: { signal: 'fixture' } });
    expect(adapter.submit).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('test-key');
  });
  it('requires a configured real adapter', async () => {
    expect(await assessWhisp(input)).toMatchObject({ result: 'NAO_AVALIADO', attempts: 0 });
  });
  it('persists the accepted token without polling when maxPolls is zero', async () => {
    const adapter = transport([{ status: 202, body: queued }]);
    const result = await assessWhisp({ ...input, transport: adapter, maxPolls: 0 });
    expect(result).toMatchObject({ result: 'PENDENTE', integration: 'REAL', job_id: 'job-1', http_status: 202, response_body: queued });
    expect(adapter.submit).toHaveBeenCalledTimes(1);
    expect(result.provider_result).toBeUndefined();
  });
  it('resumes an existing job with one GET and never submits it again', async () => {
    const adapter: WhispTransport = { submit: vi.fn(), poll: vi.fn().mockResolvedValue({ status: 202, body: processing }) };
    const result = await assessWhisp({ ...input, transport: adapter, jobId: 'job-1', maxPolls: 1 });
    expect(result).toMatchObject({ result: 'PENDENTE', job_id: 'job-1', attempts: 1 });
    expect(adapter.submit).not.toHaveBeenCalled();
    expect(adapter.poll).toHaveBeenCalledTimes(1);
  });
  it('bounds polling, preserving a pending job', async () => {
    const adapter = transport([{ status: 202, body: queued }, { status: 202, body: processing }]);
    expect(await assessWhisp({ ...input, transport: adapter, maxPolls: 1 })).toMatchObject({ result: 'PENDENTE', job_id: 'job-1', attempts: 2 });
  });
  it.each([401, 403, 429, 500])('does not turn HTTP %s into evaluated evidence', async (status) => {
    const adapter = transport([{ status, body: { code: 'error', message: 'test-key' } }]);
    const result = await assessWhisp({ ...input, transport: adapter, maxRetries: 0 });
    expect(result.result).toBe('NAO_AVALIADO');
    expect(result.provenance).toBe('INDISPONIVEL');
    expect(JSON.stringify(result)).not.toContain('test-key');
    expect(result.http_status).toBe(status);
    expect(adapter.submit).toHaveBeenCalledTimes(1);
  });
  it('does not retry an uncertain 5xx submit because upstream has no idempotency support', async () => {
    const adapter = transport([{ status: 503, body: { code: 'analysis_error' } }, { status: 200, body: completed }]);
    const result = await assessWhisp({ ...input, transport: adapter, sleep: instant });
    expect(result).toMatchObject({ result: 'NAO_AVALIADO', submit_uncertain: true, attempts: 1 });
    expect(adapter.submit).toHaveBeenCalledTimes(1);
  });
  it('does not retry an uncertain timeout or expose its error contents', async () => {
    const adapter: WhispTransport = { submit: vi.fn(() => new Promise(() => {})), poll: vi.fn() };
    const result = await assessWhisp({ ...input, transport: adapter, timeoutMs: 1 });
    expect(result).toMatchObject({ result: 'NAO_AVALIADO', submit_uncertain: true, attempts: 1 });
    expect(adapter.submit).toHaveBeenCalledTimes(1);
  });
  it('backs off on explicit rate rejection and honors Retry-After', async () => {
    const fetchMock = vi.fn<WhispFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'auth_rate_limit_exceeded' }), { status: 429, headers: { 'Retry-After': '3' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(completed), { status: 200 }));
    const sleep = vi.fn(async (_ms: number) => {});
    const result = await assessWhisp({ ...input, transport: createHttpWhispTransport({ fetchImpl: fetchMock }), sleep });
    expect(result).toMatchObject({ result: 'CONCLUIDO', attempts: 2 });
    expect(sleep).toHaveBeenCalledWith(3000);
  });
  it('retries safe polling 5xx at most twice with exponential backoff', async () => {
    const adapter: WhispTransport = { submit: vi.fn(), poll: vi.fn().mockResolvedValue({ status: 503 }) };
    const sleep = vi.fn(async (_ms: number) => {});
    const result = await assessWhisp({ ...input, jobId: 'job-1', transport: adapter, sleep });
    expect(result).toMatchObject({ result: 'PENDENTE', attempts: 3, job_id: 'job-1' });
    expect(adapter.poll).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1000], [2000]]);
  });
  it('honors the total deadline without throwing away an accepted job', async () => {
    const adapter = transport([{ status: 202, body: queued }]);
    const sleep = vi.fn(async (_ms: number) => {});
    const result = await assessWhisp({ ...input, transport: adapter, deadlineMs: 1000, pollIntervalMs: 2500, sleep });
    expect(result).toMatchObject({ result: 'PENDENTE', job_id: 'job-1', attempts: 1 });
    expect(sleep).not.toHaveBeenCalled();
  });
  it.each([
    { status: 200, body: { status: 'completed', result: { ok: true } } },
    { status: 200, body: { code: 'analysis_completed', data: {} } },
    { status: 200, body: { code: 'analysis_completed', data: { type: 'FeatureCollection', features: [] } } },
    { status: 200, body: { code: 'analysis_cancelled', data: { token: 'job-1' } } },
    { status: 202, body: { code: 'analysis_queued', data: {} } },
  ])('rejects cancelled, missing, provisional and empty results: %j', async (response) => {
    expect(await assessWhisp({ ...input, transport: transport([response]) })).toMatchObject({ result: 'NAO_AVALIADO' });
  });
  it('records stable hashes and original time without authentication headers', async () => {
    const result = await assessWhisp({ ...input, transport: transport([{ status: 200, body: completed }]), now: () => Date.UTC(2026, 10, 6) });
    expect(result).toMatchObject({ queried_at: '2026-11-06T00:00:00.000Z', provider_version: WHISP_PROVIDER_VERSION, request_payload: buildWhispRequest(geometry), response_body: completed, http_status: 200, reused_cache: false });
    expect(result.query_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.response_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain('test-key');
  });
  it('keys cache by geometry, geometry version, normalized options and contract version', () => {
    const base = whispQueryHash({ geometry });
    expect(whispQueryHash({ geometry, options: { nationalCodes: ['br'], unitType: 'ha', async: true, geometryAuditTrail: false } })).toBe(base);
    expect(whispQueryHash({ geometry: { ...geometry, coordinates: [] } })).not.toBe(base);
    expect(whispQueryHash({ geometry, geometryVersion: 2 })).not.toBe(base);
    expect(whispQueryHash({ geometry, providerVersion: 'next-contract' })).not.toBe(base);
    expect(whispQueryHash({ geometry, options: { geometryAuditTrail: true } })).not.toBe(base);
  });
});
