import { describe, expect, it } from 'vitest';
import { eventHash, type ChainEvent } from '../../src/services/integrity.js';
import { loadProductAncestry, plotGeometrySha } from '../../src/services/ancestry.js';
import { verifyPassportIntegrity } from '../../src/services/passport-integrity.js';
import { containsSimulatedEvidence, latestChecks } from '../../src/services/review-readiness.js';

function graphDb(products: Record<string, any>, origins: Record<string, any>) {
  return {
    productLot: { findUnique: async ({ where }: any) => products[where.id] ?? null },
    originLot: { findUnique: async ({ where }: any) => origins[where.id] ?? null },
    shipmentItem: { findMany: async () => [] }, shipment: { findMany: async () => [] },
  } as any;
}

describe('passport ancestry traversal', () => {
  it('hashes GeoJSON canonically so JSONB key order does not look like tampering', () => {
    expect(plotGeometrySha({ geometry: { type: 'Point', coordinates: [1, 2] } })).toBe(plotGeometrySha({ geometry: { coordinates: [1, 2], type: 'Point' } }));
  });

  it('walks through intermediate product lots to the source and transformation', async () => {
    const db = graphDb({
      finished: { id: 'finished', code: 'FIN', transformation_id: 't2', transformation: { id: 't2', inputs: [{ lot_id: 'intermediate' }] } },
      intermediate: { id: 'intermediate', code: 'INT', transformation_id: 't1', transformation: { id: 't1', inputs: [{ lot_id: 'origin' }] } },
    }, { origin: { id: 'origin', code: 'ORG', plot: { id: 'plot' }, permits: [{ document_id: 'permit-doc' }] } });
    const ancestry = await loadProductAncestry(db, 'finished');
    expect(ancestry.product_lot_ids).toEqual(['finished', 'intermediate']);
    expect(ancestry.transformations.map((x) => x.id)).toEqual(['t2', 't1']);
    expect(ancestry.origin_lots.map((x) => x.id)).toEqual(['origin']);
    expect(ancestry.document_ids).toContain('permit-doc');
  });

  it('rejects missing links and cycles instead of returning partial ancestry', async () => {
    const missingDb = graphDb({ lot: { id: 'lot', transformation_id: 'missing-t', transformation: null } }, {});
    await expect(loadProductAncestry(missingDb, 'lot')).rejects.toMatchObject({ code: 'ANCESTRY_LINK_MISSING' });
    const cyclicDb = graphDb({ lot: { id: 'lot', transformation_id: 't', transformation: { id: 't', inputs: [{ lot_id: 'lot' }] } } }, {});
    await expect(loadProductAncestry(cyclicDb, 'lot')).rejects.toMatchObject({ code: 'ANCESTRY_CYCLE' });
  });
});

describe('current evidence state', () => {
  it('detects nested simulated provenance and uses only the latest check per rule/entity', () => {
    expect(containsSimulatedEvidence({ volume: 'SIMULADA', nested: [{ label: 'REAL' }] })).toBe(true);
    expect(containsSimulatedEvidence({ label: 'DECLARACAO_DO_USUARIO' })).toBe(false);
    const latest = latestChecks([
      { entity_type: 'TRANSFORMATION', entity_id: 't1', rule_id: 'R10', assessment_scope: 'REAL', status: 'PASSOU' },
      { entity_type: 'TRANSFORMATION', entity_id: 't1', rule_id: 'R10', assessment_scope: 'REAL', status: 'ALERTA' },
      { entity_type: 'TRANSFORMATION', entity_id: 't1', rule_id: 'R10', assessment_scope: 'DEMONSTRATIVO', status: 'ALERTA' },
      { entity_type: 'ORIGIN_LOT', entity_id: 'l1', rule_id: 'R10', assessment_scope: 'REAL', status: 'ALERTA' },
    ]);
    expect(latest).toHaveLength(3);
    expect(latest[0]).toMatchObject({ entity_id: 't1', status: 'PASSOU' });
    expect(latest[1]).toMatchObject({ entity_id: 't1', assessment_scope: 'DEMONSTRATIVO', status: 'ALERTA' });
    expect(latest[2]).toMatchObject({ entity_id: 'l1', status: 'ALERTA' });
  });
});

function makeEvent(): ChainEvent {
  const body = { event_id: 'e1', stream_id: 's1', sequence: 1, entity: 'LOT', entity_id: 'l1', type: 'CREATED', actor_id: 'u1', timestamp: '2026-01-01T00:00:00.000Z', payload: { value: '1' }, previous_hash: null };
  return { ...body, event_hash: eventHash(body) };
}

function verifyInput(overrides: Record<string, unknown> = {}) {
  const event = makeEvent();
  return {
    content: { name: 'snapshot' }, content_hash: 'unused', snapshot_heads: { s1: { sequence: 1, event_hash: event.event_hash } },
    events_by_stream: { s1: [event] }, current_heads: { s1: { sequence: 1, event_hash: event.event_hash } },
    documents: [{ id: 'd1', content_hash: 'bytes-hash', storage_key: 'opaque.bin' }], required_document_ids: ['d1'],
    read_document: async () => new TextEncoder().encode('valid bytes'), ...overrides,
  } as any;
}

describe('passport integrity verification', () => {
  it('accepts unchanged snapshot, checkpoint chain, and document bytes', async () => {
    const input = verifyInput();
    const { sha256Canonical } = await import('../../src/services/integrity.js');
    input.content_hash = sha256Canonical(input.content);
    const { sha256Bytes } = await import('../../src/services/integrity.js');
    input.documents[0].content_hash = sha256Bytes(new TextEncoder().encode('valid bytes'));
    input.expected_document_hashes = { d1: input.documents[0].content_hash };
    const result = await verifyPassportIntegrity(input);
    expect(result.valid).toBe(true);
    expect(result.documents).toEqual([{ document_id: 'd1', valid: true }]);
  });

  it('detects changed payload, removed checkpoint event, and altered or unavailable bytes', async () => {
    const input = verifyInput({ content: { name: 'tampered' }, events_by_stream: { s1: [] }, read_document: async () => new TextEncoder().encode('altered') });
    input.expected_document_hashes = { d1: 'bytes-hash' };
    const result = await verifyPassportIntegrity(input);
    expect(result.valid).toBe(false);
    expect(result.issues.map((x: any) => x.code)).toEqual(expect.arrayContaining(['PASSPORT_PAYLOAD_HASH_MISMATCH', 'SNAPSHOT_CHECKPOINT_MISMATCH', 'STREAM_HEAD_MISMATCH', 'DOCUMENT_HASH_MISMATCH']));
    const absent = await verifyPassportIntegrity(verifyInput({ read_document: async () => { throw new Error('not found'); } }));
    expect(absent.issues).toContainEqual({ code: 'DOCUMENT_BYTES_UNAVAILABLE', id: 'd1' });
  });
});
