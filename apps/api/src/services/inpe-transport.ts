import { request as httpsRequest, type RequestOptions } from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type InpeDestinationKind = 'catalog' | 'asset';
export class InpeTransportError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 503) { super(message); }
}
export const INPE_MAX_ASSET_BYTES = 32 * 1024 * 1024;
export const INPE_MAX_JSON_BYTES = 5 * 1024 * 1024;
export type InpeByteBudget = { bytes_read: number; max_bytes: number; retries_remaining?: number };
export type InpeJsonOptions = { method?: 'GET' | 'POST'; body?: unknown; deadlineMs?: number; maxBytes?: number; signal?: AbortSignal };
export type InpeNetworkResponse = { status: number; headers: Record<string, string>; body: Buffer };
export type InpeNetworkRequest = { method: 'GET' | 'POST'; headers: Record<string, string>; body?: Buffer; pinned: { address: string; family: number }; signal: AbortSignal; maxBytes: number; budget?: InpeByteBudget; range?: [number, number] };
export type InpeNetworkDependencies = {
  lookup(hostname: string): Promise<Array<{ address: string; family: number }>>;
  request(url: URL, options: InpeNetworkRequest): Promise<InpeNetworkResponse>;
};
const error = (code: string, message: string, status = 503): never => { throw new InpeTransportError(code, message, status); };

/** An exact provider/path allowlist; no user URL, credentials, alternate port or arbitrary asset host. */
export function assertInpeUrl(input: string | URL, kind: InpeDestinationKind): URL {
  let url: URL;
  try { url = new URL(input); } catch { return error('INPE_DESTINATION_REJECTED', 'Destino INPE inválido.', 422); }
  if (url.protocol !== 'https:' || url.hostname !== 'data.inpe.br' || url.username || url.password || url.hash || url.port && url.port !== '443' || /[%\\]/.test(url.pathname)) return error('INPE_DESTINATION_REJECTED', 'Destino INPE não autorizado.', 422);
  const catalogPath = /^\/bdc\/stac\/v1\/(?:search|collections(?:\/[A-Za-z0-9_.-]+(?:\/items(?:\/[A-Za-z0-9_.-]+)?)?)?)?\/?$/;
  const assetPath = /^\/bdc\/data\/s2-16d\/v2\/\d{3}\/\d{3}\/\d{4}\/\d{2}\/\d{2}\/S2-16D_V2_\d{6}_\d{8}_B(?:02|03|04)\.tif$/;
  if (!(kind === 'catalog' ? catalogPath.test(url.pathname) : assetPath.test(url.pathname)) || kind === 'asset' && url.search) return error('INPE_DESTINATION_REJECTED', 'Caminho INPE não autorizado.', 422);
  const allowedKeys = new Set(['limit','collections','datetime','bbox','intersects','filter','filter-lang','token','page','sortby']);
  if (kind === 'catalog' && [...url.searchParams.keys()].some(key => !allowedKeys.has(key))) return error('INPE_DESTINATION_REJECTED', 'Parâmetros de destino não autorizados.', 422);
  return url;
}

/** Restrict routing to public unicast addresses; IPv4-mapped/transition IPv6 is rejected too. */
export function isPublicInpeAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number); const [a = 0, b = 0, c = 0] = octets;
    if ([0,10,127].includes(a) || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127) return false;
    if (a === 192 && (b === 0 || b === 2 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (isIP(address) === 6) {
    const text = address.toLowerCase();
    // Native global unicast only; exclude documentation, 6to4, Teredo and mapped/private forms.
    return /^[23][0-9a-f]{3}:/.test(text) && !text.startsWith('2001:db8:') && !text.startsWith('2001:0:') && !text.startsWith('2001::') && !text.startsWith('2002:') && !text.includes('.') && !text.startsWith('3fff:');
  }
  return false;
}

const nativeDependencies: InpeNetworkDependencies = {
  lookup: hostname => dnsLookup(hostname, { all: true, verbatim: true }),
  request: (url, options) => new Promise((resolve, reject) => {
    const lookup: RequestOptions['lookup'] = (_hostname, lookupOptions, callback) => {
      // Pin the DNS result used for the real connection, rather than validating then re-resolving.
      if ((lookupOptions as { all?: boolean }).all) (callback as unknown as (error: null, records: Array<{ address: string; family: number }>) => void)(null, [options.pinned]);
      else (callback as unknown as (error: null, address: string, family: number) => void)(null, options.pinned.address, options.pinned.family);
    };
    const req = httpsRequest(url, { method: options.method, headers: options.headers, agent: false, lookup,
      signal: options.signal, servername: url.hostname,
    }, response => {
      const status = response.statusCode ?? 0;
      const headers = Object.fromEntries(Object.entries(response.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(',') : value ?? '']));
      if ([301,302,303,307,308].includes(status)) { response.destroy(); resolve({ status, headers, body: Buffer.alloc(0) }); return; }
      if (options.range && status !== 206) { response.destroy(); reject(new InpeTransportError([429,500,502,503,504].includes(status) ? 'INPE_TRANSIENT' : 'INPE_RANGE_REQUIRED', 'Asset não forneceu resposta HTTP Range 206.')); return; }
      if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') { response.destroy(); reject(new InpeTransportError('INPE_ENCODING_UNSUPPORTED', 'Codificação remota incompatível com o orçamento de leitura.')); return; }
      let expectedRangeLength: number | undefined;
      if (options.range) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers['content-range'] ?? '');
        const [start, end] = options.range;
        if (!match || Number(match[1]) !== start || Number(match[2]) !== Math.min(end, Number(match[3]) - 1) || Number(match[3]) <= Number(match[2])) { response.destroy(); reject(new InpeTransportError('INPE_RANGE_INVALID', 'Content-Range incompatível com a janela solicitada.')); return; }
        expectedRangeLength = Number(match[2]) - start + 1;
      }
      const declaredLength = Number(headers['content-length']);
      const available = Math.min(options.maxBytes, options.budget ? options.budget.max_bytes - options.budget.bytes_read : options.maxBytes);
      if (declaredLength > available || expectedRangeLength !== undefined && expectedRangeLength > available) { response.destroy(); reject(new InpeTransportError('INPE_BYTE_LIMIT', 'Resposta excede o orçamento de bytes.')); return; }
      const chunks: Buffer[] = []; let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (options.budget) options.budget.bytes_read += chunk.length;
        if (received > options.maxBytes || options.budget && options.budget.bytes_read > options.budget.max_bytes) { response.destroy(new InpeTransportError('INPE_BYTE_LIMIT', 'Leitura excede o orçamento de bytes.')); return; }
        chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => {
        if (expectedRangeLength !== undefined && received !== expectedRangeLength) { reject(new InpeTransportError('INPE_RANGE_INVALID', 'Corpo Range truncado ou com tamanho incorreto.')); return; }
        resolve({ status, headers, body: Buffer.concat(chunks, received) });
      });
    });
    req.once('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  }),
};

/** Injectable network boundary keeps redirects/DNS/byte accounting testable without external calls. */
export function createInpeTransport(dependencies: InpeNetworkDependencies = nativeDependencies) {
  async function request(input: string, kind: InpeDestinationKind, options: {
    method?: 'GET' | 'POST'; body?: unknown; signal: AbortSignal; maxBytes: number; budget?: InpeByteBudget; range?: [number, number];
  }) {
    let url = assertInpeUrl(input, kind); let method = options.method ?? 'GET';
    let body = options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body));
    if (body && body.length > INPE_MAX_JSON_BYTES) return error('INPE_BYTE_LIMIT', 'Requisição excede o limite de bytes.', 422);
    for (let redirects = 0; redirects <= 3; redirects++) {
      options.signal.throwIfAborted();
      let cancelLookup: (() => void) | undefined;
      const records = await Promise.race([dependencies.lookup(url.hostname), new Promise<never>((_resolve, reject) => {
        const aborted = () => reject(options.signal.reason);
        options.signal.addEventListener('abort', aborted, { once: true });
        cancelLookup = () => options.signal.removeEventListener('abort', aborted);
      })]).finally(() => cancelLookup?.());
      if (!records.length || records.some(record => !isPublicInpeAddress(record.address))) return error('INPE_DESTINATION_REJECTED', 'DNS do provedor retornou destino não autorizado.', 422);
      const headers: Record<string, string> = { Accept: kind === 'catalog' ? 'application/geo+json,application/json' : 'image/tiff', 'Accept-Encoding': 'identity' };
      if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = String(body.length); }
      if (options.range) headers.Range = `bytes=${options.range[0]}-${options.range[1]}`;
      const response = await dependencies.request(url, { ...options, method, headers, body, pinned: records[0]! });
      if (response.body.length > options.maxBytes) return error('INPE_BYTE_LIMIT', 'Resposta excede o limite de bytes.');
      if (options.range && ![301,302,303,307,308].includes(response.status)) {
        if (response.status !== 206) return error([429,500,502,503,504].includes(response.status) ? 'INPE_TRANSIENT' : 'INPE_RANGE_REQUIRED', 'Asset não forneceu resposta HTTP Range 206.');
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range'] ?? '');
        if (!match || Number(match[1]) !== options.range[0] || Number(match[2]) !== Math.min(options.range[1],Number(match[3])-1) || response.body.length !== Number(match[2])-Number(match[1])+1) return error('INPE_RANGE_INVALID','Content-Range incompatível com a janela solicitada.');
      }
      if (![301,302,303,307,308].includes(response.status)) return response;
      const location = response.headers.location;
      if (!location || redirects === 3) return error('INPE_REDIRECT_REJECTED', 'Redirecionamento do provedor excede o limite.');
      url = assertInpeUrl(new URL(location, url), kind);
      if (response.status === 303 || (response.status === 301 || response.status === 302) && method === 'POST') { method = 'GET'; body = undefined; }
    }
    return error('INPE_REDIRECT_REJECTED', 'Redirecionamento inválido.');
  }
  async function json(input: string, options: InpeJsonOptions = {}) {
    const timeout = Math.min(options.deadlineMs ?? 10_000, 10_000);
    const signal = AbortSignal.any([AbortSignal.timeout(timeout), ...(options.signal ? [options.signal] : [])]);
    const maxBytes = Math.min(options.maxBytes ?? INPE_MAX_JSON_BYTES, INPE_MAX_JSON_BYTES);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await request(input, 'catalog', { ...options, signal, maxBytes });
        if (attempt === 0 && [429,500,502,503,504].includes(response.status)) continue;
        let body: unknown = null;
        try { body = response.body.length ? JSON.parse(response.body.toString('utf8')) : null; }
        catch { return error('INPE_RESPONSE_INVALID', 'Resposta do catálogo não contém JSON válido.'); }
        return { status: response.status, body };
      } catch (failure) {
        if (failure instanceof InpeTransportError || signal.aborted || attempt === 1) throw failure instanceof InpeTransportError ? failure : new InpeTransportError('INPE_UNAVAILABLE', 'Catálogo INPE indisponível ou prazo excedido.');
      }
    }
    return error('INPE_UNAVAILABLE', 'Catálogo INPE indisponível.');
  }
  async function range(input: string, window: [number,number], budget: InpeByteBudget, signal: AbortSignal): Promise<InpeNetworkResponse> {
    if (!window.every(Number.isSafeInteger) || window[0]<0 || window[1]<window[0]) return error('INPE_RANGE_INVALID','Janela de bytes inválida.',422);
    try { return await request(input,'asset',{signal,maxBytes:INPE_MAX_ASSET_BYTES,budget,range:window}); }
    catch (failure) {
      const transient = !(failure instanceof InpeTransportError) || failure.code === 'INPE_TRANSIENT';
      if (!signal.aborted && transient && (budget.retries_remaining ?? 0)>0) {
        budget.retries_remaining = (budget.retries_remaining ?? 0)-1;
        return request(input,'asset',{signal,maxBytes:INPE_MAX_ASSET_BYTES,budget,range:window});
      }
      throw failure;
    }
  }
  return { request, json, range };
}
const transport = createInpeTransport();
export const safeInpeJson = transport.json;
export async function safeInpeRange(input: string, range: [number, number], budget: InpeByteBudget, signal: AbortSignal) {
  return transport.range(input, range, budget, signal);
}
