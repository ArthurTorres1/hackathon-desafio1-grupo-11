import { describe, it, expect } from 'vitest';
import { ancestryDigests } from '../../src/services/ancestry-digests.js';

const graph = () => ({ product_lot_ids: ['p'], products: [{ id: 'p', version: 1, volume_m3: '3' }],
  origin_lots: [{ id: 'o', version: 1, authorized_volume_m3: '10', created_at: new Date('2026-01-01'), permits: [{ id: 'b', volume_m3: '10' }, { id: 'a', volume_m3: '10' }] }],
  transformations: [{ id: 't', inputs: [{ id: 'i', lot_id: 'o', volume_m3: '10' }], outputs: [{ id: 'p', volume_m3: '3' }] }],
  shipments: [], plots: [], harvests: [], source_queries: [], documents: [], document_ids: [], nodes: [],
});

describe('hashes dos registros ancestrais', () => {
  it('independe da ordem de relações e preserva a semântica de volumes e versões', () => {
    const original = graph(); const reordered = graph();
    reordered.origin_lots[0]!.permits.reverse();
    expect(ancestryDigests(reordered)).toEqual(ancestryDigests(original));
    reordered.origin_lots[0]!.authorized_volume_m3 = '11';
    expect(ancestryDigests(reordered)).not.toEqual(ancestryDigests(original));
    const changedProduct = graph(); changedProduct.products[0]!.volume_m3 = '4';
    expect(ancestryDigests(changedProduct)).not.toEqual(ancestryDigests(original));
  });
});
