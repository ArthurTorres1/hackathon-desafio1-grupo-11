export type Entity = Record<string, unknown> & { id: string };
export type User = { id: string; name?: string; display_name?: string; organization_id?: string; organization?: { id: string; name?: string }; roles?: string[] };
export type Session = { user: User | null; csrf_token?: string; demo_mode?: boolean };
export type Dashboard = {
  organizations: Entity[]; plots: Entity[]; origin_lots: Entity[]; product_lots: Entity[];
  shipments: Entity[]; transformations: Entity[]; audit_cases: Entity[]; passports: Entity[];
  conversion_parameters: Entity[]; checks: Entity[]; documents: Entity[]; metrics: Record<string, unknown>;
};

export const emptyDashboard: Dashboard = {
  organizations: [], plots: [], origin_lots: [], product_lots: [], shipments: [],
  transformations: [], audit_cases: [], passports: [], conversion_parameters: [], checks: [], documents: [], metrics: {},
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; csrf?: string; signal?: AbortSignal } = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const response = await fetch(path, {
    method, credentials: 'include', signal: options.signal,
    headers: {
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
      ...(options.csrf ? { 'X-CSRF-Token': options.csrf } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  let data: unknown;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const detail = (data as { error?: { message?: string; code?: string; fields?: Record<string, string> } } | null)?.error;
    throw new ApiError(detail?.message ?? `Não foi possível concluir a solicitação (${response.status}).`, response.status, detail?.code ?? 'REQUEST_FAILED', detail?.fields);
  }
  return data as T;
}

export async function downloadBundle(passportId: string, format: 'json' | 'html'): Promise<void> {
  const response = await fetch(`/api/v1/passports/${encodeURIComponent(passportId)}/bundle?format=${format.toUpperCase()}`, { credentials: 'include' });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new ApiError(data?.error?.message ?? 'Não foi possível exportar o pacote.', response.status, 'EXPORT_FAILED');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `foresttrace-${passportId}.${format}`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
export const SYNTHETIC_POLYGON = { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] };
export const label = (entity: Entity): string => String(entity.code ?? entity.name ?? entity.declared_property ?? entity.product ?? entity.id.slice(0, 8));
export const value = (entity: Record<string, unknown>, key: string, fallback = '—'): string => entity[key] == null ? fallback : String(entity[key]);
export const date = (input: unknown): string => input && !Number.isNaN(new Date(String(input)).getTime()) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(String(input))) : '—';
