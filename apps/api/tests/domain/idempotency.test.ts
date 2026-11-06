import { describe, expect, it } from 'vitest';
import { canonicalPayloadHash, IdempotencyKeyRequired, requireIdempotencyKey } from '../../src/services/idempotency.js';

describe('idempotência operacional', () => {
  it('canonicaliza objetos sem depender da ordem das propriedades', () => {
    expect(canonicalPayloadHash({ b: 2, a: { y: 1, x: 0 } })).toBe(canonicalPayloadHash({ a: { x: 0, y: 1 }, b: 2 }));
    expect(canonicalPayloadHash({ items: [1, 2] })).not.toBe(canonicalPayloadHash({ items: [2, 1] }));
  });

  it('exige uma chave válida e limita tamanho/bytes imprimíveis', () => {
    expect(requireIdempotencyKey('retry-123')).toBe('retry-123');
    expect(() => requireIdempotencyKey(undefined)).toThrow(IdempotencyKeyRequired);
    expect(() => requireIdempotencyKey('invalid key')).toThrow(IdempotencyKeyRequired);
    expect(() => requireIdempotencyKey('k'.repeat(201))).toThrow(IdempotencyKeyRequired);
  });
});
