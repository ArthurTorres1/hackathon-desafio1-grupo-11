import { sha256Canonical } from './integrity.js';

export interface WhispHttpResponse { status: number; body?: unknown; }
export interface WhispTransport {
  submit(input: { geometry: unknown; options: Record<string, unknown>; idempotency_key: string; api_key: string; timeout_ms: number }): Promise<WhispHttpResponse>;
  poll(input: { job_id: string; api_key: string; timeout_ms: number }): Promise<WhispHttpResponse>;
}
export type WhispFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
/** HTTP transport with caller-supplied endpoints; no provider URL or protocol is assumed. */
export function createHttpWhispTransport(config: { submitUrl: string; pollUrl: (jobId: string) => string; fetchImpl?: WhispFetch }): WhispTransport {
  const fetchImpl = config.fetchImpl ?? fetch;
  const request = async (url: string, apiKey: string, timeoutMs: number, init: RequestInit): Promise<WhispHttpResponse> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { ...init, signal: controller.signal, headers: {
        ...init.headers as Record<string,string>, 'X-API-KEY': apiKey, accept: 'application/json',
      } });
      const raw = await response.text();
      let body: unknown;
      if (raw) { try { body = JSON.parse(raw); } catch { body = { unparsed_response: true }; } }
      return { status: response.status, ...(body === undefined ? {} : { body }) };
    } finally { clearTimeout(timer); }
  };
  return {
    submit: ({ geometry, options, idempotency_key, api_key, timeout_ms }) => request(config.submitUrl, api_key, timeout_ms, {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idempotency_key }, body: JSON.stringify({ geometry, options }),
    }),
    poll: ({ job_id, api_key, timeout_ms }) => request(config.pollUrl(job_id), api_key, timeout_ms, { method: 'GET' }),
  };
}
export interface WhispAssessmentInput {
  geometry: unknown; options?: Record<string, unknown>;
  contractConfirmed: boolean; apiKey?: string;
  transport?: WhispTransport; simulatedFixture?: unknown;
  maxPolls?: number; timeoutMs?: number; maxRetries?: number;
}
export type WhispAssessment = {
  integration: 'REAL' | 'SEM_INTEGRACAO_REAL';
  result: 'CONCLUIDO' | 'PENDENTE' | 'NAO_AVALIADO';
  provenance: 'REAL_CONSULTADA' | 'SIMULADA' | 'INDISPONIVEL';
  query_hash: string; reused_cache: false; attempts: number;
  provider_result?: unknown; simulated_fixture?: unknown; reason?: string;
  job_id?: string;
};

function responseBody(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}
function simulated(input: WhispAssessmentInput, queryHash: string, reason: string): WhispAssessment {
  return { integration: 'SEM_INTEGRACAO_REAL', result: 'NAO_AVALIADO', provenance: input.simulatedFixture === undefined ? 'INDISPONIVEL' : 'SIMULADA',
    query_hash: queryHash, reused_cache: false, attempts: 0, ...(input.simulatedFixture === undefined ? {} : { simulated_fixture: input.simulatedFixture }), reason };
}
function transient(status: number) { return status === 429 || status >= 500; }
function waitTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { onTimeout(); reject(new Error('WHISP_TIMEOUT')); }, timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
}

/**
 * Provider-neutral Whisp workflow. It cannot invent a URL or submit shape: a transport is injected
 * only after the upstream contract is confirmed. No credentials are returned or persisted here.
 */
export async function assessWhisp(input: WhispAssessmentInput): Promise<WhispAssessment> {
  const options = input.options ?? {};
  const queryHash = sha256Canonical({ geometry: input.geometry, options });
  if (!input.contractConfirmed) return simulated(input, queryHash, 'Contrato do provedor pendente de confirmação.');
  if (!input.apiKey) return simulated(input, queryHash, 'Credencial do provedor não configurada.');
  if (!input.transport) return simulated(input, queryHash, 'Adapter real não configurado com contrato e URL confirmados.');
  const timeoutMs = input.timeoutMs ?? 5000;
  const retries = Math.max(0, Math.min(input.maxRetries ?? 1, 3));
  const maxPolls = Math.max(0, Math.min(input.maxPolls ?? 3, 10));
  let attempts = 0;
  const request = async (fn: () => Promise<WhispHttpResponse>): Promise<WhispHttpResponse> => {
    for (let attempt = 0; ; attempt++) {
      attempts++;
      try {
        const result = await waitTimeout(fn(), timeoutMs, () => undefined);
        if (transient(result.status) && attempt < retries) continue;
        return result;
      } catch (error) {
        if (attempt < retries && (error instanceof Error && (error.message === 'WHISP_TIMEOUT' || error.name === 'TypeError'))) continue;
        throw error;
      }
    }
  };
  try {
    const submitted = await request(() => input.transport!.submit({ geometry: input.geometry, options, idempotency_key: queryHash, api_key: input.apiKey!, timeout_ms: timeoutMs }));
    if (submitted.status === 401 || submitted.status === 403) return { ...simulated(input, queryHash, 'Provedor negou autenticação/autorização; nenhum segredo foi incluído no resultado.'), attempts };
    if (submitted.status !== 202 && (submitted.status < 200 || submitted.status >= 300)) return { ...simulated(input, queryHash, `Provedor indisponível (HTTP ${submitted.status}); avaliação real não concluída.`), attempts };
    let body = responseBody(submitted.body);
    let jobId = typeof body.job_id === 'string' ? body.job_id : undefined;
    let polls = 0;
    let pending = submitted.status === 202 || body.status === 'pending' || body.status === 'running';
    while (pending) {
      if (!jobId || polls >= maxPolls) return { ...simulated(input, queryHash, 'Consulta aceita, mas resultado final não foi confirmado antes do limite de polling.'), integration: 'REAL', result: 'PENDENTE', attempts, ...(jobId ? { job_id: jobId } : {}) };
      const polled = await request(() => input.transport!.poll({ job_id: jobId!, api_key: input.apiKey!, timeout_ms: timeoutMs }));
      polls++;
      if (polled.status === 401 || polled.status === 403 || polled.status < 200 || polled.status >= 300) return { ...simulated(input, queryHash, `Polling não confirmado (HTTP ${polled.status}); avaliação real não concluída.`), attempts, job_id: jobId };
      body = responseBody(polled.body);
      if (typeof body.job_id === 'string') jobId = body.job_id;
      pending = body.status === 'pending' || body.status === 'running';
    }
    if (body.status !== 'completed' || !Object.hasOwn(body, 'result')) return { ...simulated(input, queryHash, 'Resposta final não corresponde ao formato confirmado de resultado; não avaliada.'), attempts, ...(jobId ? { job_id: jobId } : {}) };
    return { integration: 'REAL', result: 'CONCLUIDO', provenance: 'REAL_CONSULTADA', query_hash: queryHash, reused_cache: false, attempts,
      provider_result: body.result, ...(jobId ? { job_id: jobId } : {}) };
  } catch (error) {
    const reason = error instanceof Error && error.message === 'WHISP_TIMEOUT' ? 'Tempo limite do provedor excedido.' : 'Consulta ao provedor falhou; avaliação real não concluída.';
    return { ...simulated(input, queryHash, reason), attempts };
  }
}
