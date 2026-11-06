import { sha256Canonical } from './integrity.js';
import type { ProductAncestry } from './ancestry.js';

export type AncestorDigest = { type: string; id: string; version: number; content_hash: string };

function stableRecord(value: unknown, field = ''): unknown {
  if (Array.isArray(value)) {
    const rows = ['inputs', 'outputs', 'permits', 'items'].includes(field)
      ? [...value].sort((a, b) => String(a.id).localeCompare(String(b.id))) : value;
    return rows.map(row => stableRecord(row));
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stableRecord(item, key)]));
  return value;
}

/** Bind persisted ancestor fields as well as their identifiers to the issued snapshot. */
export function ancestryDigests(ancestry: ProductAncestry): AncestorDigest[] {
  const records: Array<{ type: string; record: any }> = [
    ...ancestry.origin_lots.map(record => ({ type: 'ORIGIN_LOT', record })),
    ...ancestry.transformations.map(record => ({ type: 'TRANSFORMATION', record })),
    ...ancestry.shipments.map(record => ({ type: 'SHIPMENT', record })),
    ...ancestry.plots.map(record => ({ type: 'PLOT', record })),
    ...ancestry.harvests.map(record => ({ type: 'HARVEST', record })),
    ...ancestry.source_queries.map(record => ({ type: 'SOURCE_QUERY', record })),
    ...ancestry.documents.map(({ allowed_organization_ids: _grants, visibility: _visibility, storage_key: _storage, ...record }) => ({ type: 'DOCUMENT', record })),
  ];
  // Product nodes retain their complete persisted fields when provided by the loader.
  for (const record of ancestry.products ?? []) records.push({ type: 'PRODUCT_LOT', record });
  return records.map(({ type, record }) => ({ type, id: record.id,
    version: record.version ?? record.geometry_version ?? 1,
    content_hash: sha256Canonical(stableRecord(JSON.parse(JSON.stringify(record)))),
  })).sort((a, b) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
}
