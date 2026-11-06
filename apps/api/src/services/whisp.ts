import { sha256Canonical } from './integrity.js';

export const WHISP_SUBMIT_URL = 'https://whisp.openforis.org/api/submit/geojson';
export const WHISP_POLL_URL_TEMPLATE = 'https://whisp.openforis.org/api/status/{job_id}';
/** Contract snapshot, not an assertion about the deployed engine version. */
export const WHISP_PROVIDER_VERSION = 'whisp-app-contract-2026-11-06';
export interface WhispHttpResponse { status: number; body?: unknown; retryAfter?: string; }
export interface WhispTransport {
  submit(input: { geometry: unknown; options: Record<string, unknown>; idempotency_key: string; api_key: string; timeout_ms: number }): Promise<WhispHttpResponse>;
  poll(input: { job_id: string; api_key: string; timeout_ms: number }): Promise<WhispHttpResponse>;
}
export type WhispFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function buildWhispRequest(geometry: unknown, options: Record<string, unknown> = {}) {
  const analysisOptions: Record<string, unknown> = { nationalCodes: ['br'], unitType: 'ha', async: true, geometryAuditTrail: false, ...options };
  const allowed = ['nationalCodes', 'unitType', 'async', 'geometryAuditTrail', 'externalIdColumn'];
  if (Object.keys(options).some(key => !allowed.includes(key)) || !Array.isArray(analysisOptions.nationalCodes)
    || !analysisOptions.nationalCodes.every(code => typeof code === 'string' && /^[a-z]{2}$/.test(code))
    || !['ha', 'acres'].includes(String(analysisOptions.unitType)) || typeof analysisOptions.async !== 'boolean'
    || typeof analysisOptions.geometryAuditTrail !== 'boolean'
    || (analysisOptions.externalIdColumn !== undefined && typeof analysisOptions.externalIdColumn !== 'string')) {
    throw Object.assign(new Error('Opções Whisp inválidas para o contrato confirmado.'), { code: 'WHISP_OPTIONS_INVALID', statusCode: 422 });
  }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }], analysisOptions };
}
export function whispQueryHash(input: { geometry: unknown; options?: Record<string, unknown>; providerVersion?: string; geometryVersion?: number }) {
  return sha256Canonical({ request: buildWhispRequest(input.geometry, input.options), provider_version: input.providerVersion ?? WHISP_PROVIDER_VERSION, geometry_version: input.geometryVersion ?? 1 });
}
function endpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw new Error('Whisp requer URL HTTPS sem credenciais, query ou fragmento.');
  return url;
}
/** Official GeoJSON contract; status URLs come from configuration, never from a response. */
export function createHttpWhispTransport(config: { submitUrl?: string; pollUrl?: (jobId: string) => string; fetchImpl?: WhispFetch } = {}): WhispTransport {
  const fetchImpl = config.fetchImpl ?? fetch;
  const submitUrl = endpoint(config.submitUrl ?? WHISP_SUBMIT_URL);
  const pollUrl = config.pollUrl ?? (id => WHISP_POLL_URL_TEMPLATE.replace('{job_id}', encodeURIComponent(id)));
  const request = async (url: URL, apiKey: string, timeoutMs: number, init: RequestInit): Promise<WhispHttpResponse> => {
    if (url.origin !== submitUrl.origin) throw new Error('O polling Whisp deve usar a mesma origem do submit.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.href, { ...init, signal: controller.signal, redirect: 'error', headers: {
        ...init.headers as Record<string, string>, 'X-API-KEY': apiKey, accept: 'application/json',
      } });
      const raw = await response.text();
      let body: unknown;
      if (raw) { try { body = JSON.parse(raw); } catch { body = { unparsed_response: true }; } }
      return { status: response.status, ...(body === undefined ? {} : { body }), ...(response.headers.get('retry-after') ? { retryAfter: response.headers.get('retry-after')! } : {}) };
    } finally { clearTimeout(timer); }
  };
  return {
    submit: ({ geometry, options, api_key, timeout_ms }) => request(submitUrl, api_key, timeout_ms, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildWhispRequest(geometry, options)),
    }),
    poll: ({ job_id, api_key, timeout_ms }) => request(endpoint(pollUrl(job_id)), api_key, timeout_ms, { method: 'GET' }),
  };
}
export interface WhispAssessmentInput {
  geometry: unknown; options?: Record<string, unknown>;
  contractConfirmed: boolean; apiKey?: string;
  transport?: WhispTransport; simulatedFixture?: unknown;
  maxPolls?: number; timeoutMs?: number; maxRetries?: number;
  jobId?: string; geometryVersion?: number; providerVersion?: string;
  deadlineMs?: number; pollIntervalMs?: number;
  /** Injectable clocks keep backoff tests deterministic. */
  now?: () => number; sleep?: (milliseconds: number) => Promise<void>;
}
export type WhispAssessment = {
  integration: 'REAL' | 'SEM_INTEGRACAO_REAL'; result: 'CONCLUIDO' | 'PENDENTE' | 'NAO_AVALIADO';
  provenance: 'REAL_CONSULTADA' | 'SIMULADA' | 'INDISPONIVEL';
  query_hash: string; geometry_hash: string; reused_cache: false; attempts: number;
  request_payload: ReturnType<typeof buildWhispRequest>; queried_at: string; provider_version: string;
  response_body?: unknown; response_hash?: string; http_status?: number;
  provider_result?: unknown; simulated_fixture?: unknown; reason?: string; job_id?: string; submit_uncertain?: boolean;
};
function bounded(value: number | undefined, fallback: number, min: number, max: number) {
  return value === undefined || !Number.isFinite(value) ? fallback : Math.max(min, Math.min(value, max));
}
function waitTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('WHISP_TIMEOUT')), timeoutMs); })]).finally(() => clearTimeout(timer!));
}
function completedCollection(value: unknown) {
  const result = record(value);
  return result.type === 'FeatureCollection' && Array.isArray(result.features) && result.features.length > 0
    && result.features.every(feature => record(feature).type === 'Feature' && Object.keys(record(record(feature).properties)).length > 0);
}
function withoutSecret(value: unknown, secret: string): unknown {
  if (typeof value === 'string') return value.split(secret).join('[REDACTED]');
  if (Array.isArray(value)) return value.map(item => withoutSecret(item, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.split(secret).join('[REDACTED]'), withoutSecret(item, secret)]));
  return value;
}
/** Accepted work is never mistaken for a completed environmental assessment. */
export async function assessWhisp(input: WhispAssessmentInput): Promise<WhispAssessment> {
  const options = input.options ?? {};
  const requestPayload = buildWhispRequest(input.geometry, options);
  const queryHash = whispQueryHash(input);
  const now = input.now ?? Date.now;
  const started = now();
  const deadline = started + bounded(input.deadlineMs, 120_000, 1, 120_000);
  const sleep = input.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const timeoutMs = bounded(input.timeoutMs, 15_000, 1, 15_000);
  const retries = Math.floor(bounded(input.maxRetries, 2, 0, 2));
  const maxPolls = Math.floor(bounded(input.maxPolls, 45, 0, 60));
  const pollInterval = bounded(input.pollIntervalMs, 2500, 0, 30_000);
  let attempts = 0;
  let jobId = input.jobId;
  let lastResponse: WhispHttpResponse | undefined;
  const output = (reason: string, pending = false): WhispAssessment => {
    const body = lastResponse?.body === undefined ? undefined : withoutSecret(lastResponse.body, input.apiKey || '\u0000');
    return { integration: pending ? 'REAL' : 'SEM_INTEGRACAO_REAL', result: pending ? 'PENDENTE' : 'NAO_AVALIADO',
      provenance: input.simulatedFixture === undefined ? 'INDISPONIVEL' : 'SIMULADA',
      query_hash: queryHash, geometry_hash: sha256Canonical(input.geometry), reused_cache: false, attempts,
      request_payload: requestPayload, queried_at: new Date(started).toISOString(), provider_version: input.providerVersion ?? WHISP_PROVIDER_VERSION,
      ...(body === undefined ? {} : { response_body: body, response_hash: sha256Canonical(body) }),
      ...(lastResponse ? { http_status: lastResponse.status } : {}), ...(jobId ? { job_id: jobId } : {}),
      ...(input.simulatedFixture === undefined ? {} : { simulated_fixture: input.simulatedFixture }), reason };
  };
  if (!input.contractConfirmed) return output('Contrato do provedor pendente de confirmação.');
  if (!input.apiKey?.trim()) return output('Credencial do provedor não configurada.');
  if (!input.transport) return output('Adapter real não configurado com contrato e URL confirmados.');
  const pause = async (ms: number) => {
    if (now() + ms >= deadline) throw new Error('WHISP_DEADLINE');
    if (ms > 0) await sleep(ms);
  };
  const request = async (poll: boolean): Promise<WhispHttpResponse> => {
    for (let attempt = 0; ; attempt++) {
      const remaining = deadline - now();
      if (remaining <= 0) throw new Error('WHISP_DEADLINE');
      attempts++;
      let response: WhispHttpResponse;
      try {
        const callTimeout = Math.min(timeoutMs, remaining);
        response = await waitTimeout(poll
          ? input.transport!.poll({ job_id: jobId!, api_key: input.apiKey!, timeout_ms: callTimeout })
          : input.transport!.submit({ geometry: input.geometry, options, idempotency_key: queryHash, api_key: input.apiKey!, timeout_ms: callTimeout }), callTimeout);
      } catch (error) {
        // POST can create a job before connection loss; never repeat an uncertain submit.
        if (!poll || attempt >= retries) throw error;
        await pause(1000 * 2 ** attempt);
        continue;
      }
      lastResponse = response;
      const retryable = response.status === 429 || (poll && response.status >= 500 && response.status <= 599);
      if (!retryable || attempt >= retries) return response;
      const seconds = Number(response.retryAfter);
      const headerDelay = response.retryAfter ? (Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(response.retryAfter) - now())) : 0;
      await pause(Math.max(1000 * 2 ** attempt, Number.isFinite(headerDelay) ? headerDelay : 0));
    }
  };
  try {
    let response = await request(!!jobId);
    let polls = input.jobId ? 1 : 0;
    while (true) {
      const envelope = record(response.body);
      const data = record(envelope.data);
      if (typeof data.token === 'string' && data.token.length > 0) jobId = data.token;
      if (response.status === 401 || response.status === 403) return output('Provedor negou autenticação/autorização.');
      if (response.status < 200 || response.status >= 300) return {
        ...output(`Provedor indisponível (HTTP ${response.status}); avaliação real não concluída.`, !!jobId && (response.status === 429 || response.status >= 500)),
        ...(!jobId && response.status >= 500 ? { submit_uncertain: true } : {}),
      };
      if (response.status === 200 && envelope.code === 'analysis_completed' && completedCollection(envelope.data)) {
        const { simulated_fixture: _fixture, ...result } = output('Consulta concluída; os indicadores exigem interpretação contextual.');
        return { ...result, integration: 'REAL', result: 'CONCLUIDO', provenance: 'REAL_CONSULTADA', provider_result: withoutSecret(envelope.data, input.apiKey) };
      }
      const pending = response.status === 202 && ['analysis_queued', 'analysis_processing'].includes(String(envelope.code));
      if (!pending || !jobId) return output('Resposta não contém resultado final válido ou job reconhecido; não avaliada.');
      if (polls >= maxPolls) return output('Job preservado para retomada manual após o limite de polling.', true);
      await pause(pollInterval);
      response = await request(true);
      polls++;
    }
  } catch (error) {
    const timedOut = error instanceof Error && ['WHISP_TIMEOUT', 'WHISP_DEADLINE'].includes(error.message);
    return { ...output(timedOut ? 'Prazo da consulta excedido; eventual job foi preservado para retomada manual.' : 'Consulta ao provedor falhou; avaliação real não concluída.', !!jobId), ...(!jobId ? { submit_uncertain: true } : {}) };
  }
}
