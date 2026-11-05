import { createHash } from 'node:crypto';

/** RFC 8785 canonical JSON for the JSON value subset used in persisted events. */
export function canonicalize(value: unknown): string {
  const stack = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item);
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('RFC 8785 não permite números não finitos.');
      return JSON.stringify(item);
    }
    if (Array.isArray(item)) {
      if (stack.has(item)) throw new TypeError('JSON cíclico.');
      stack.add(item); const result = `[${item.map(encode).join(',')}]`; stack.delete(item); return result;
    }
    if (typeof item === 'object' && item !== undefined) {
      const obj = item as Record<string, unknown>;
      if (stack.has(obj)) throw new TypeError('JSON cíclico.');
      stack.add(obj);
      const result = `{${Object.keys(obj).filter((key) => obj[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${encode(obj[key])}`).join(',')}}`;
      stack.delete(obj); return result;
    }
    throw new TypeError(`Valor não representável como JSON: ${typeof item}`);
  };
  return encode(value);
}

export const sha256Bytes = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export function sha256Canonical(value: unknown): string {
  return sha256Bytes(canonicalize(value));
}

export interface ChainEvent {
  event_id: string; stream_id: string; sequence: number; entity: string; entity_id?: string; type: string;
  actor_id: string | null; timestamp: string; payload: unknown; previous_hash: string | null; event_hash: string;
}
export function eventHash(event: Omit<ChainEvent, 'event_hash'>): string {
  return sha256Canonical(event);
}
export function verifyEventChain(events: ChainEvent[]) {
  const ordered = events;
  const errors: Array<{ event_id: string; reason: string }> = [];
  const seen = new Set<string>();
  let previous: string | null = null;
  ordered.forEach((event,index) => {
    if (seen.has(event.event_id)) errors.push({event_id:event.event_id,reason:'DUPLICATE_EVENT_ID'});
    seen.add(event.event_id);
    if (event.sequence !== index+1) errors.push({event_id:event.event_id,reason:'SEQUENCE_GAP_OR_ORDER'});
    if (event.previous_hash !== previous) errors.push({event_id:event.event_id,reason:'PREVIOUS_HASH_MISMATCH'});
    const {event_hash: _hash,...body}=event;
    if (eventHash(body)!==event.event_hash) errors.push({event_id:event.event_id,reason:'EVENT_HASH_MISMATCH'});
    previous=event.event_hash;
  });
  return { valid:errors.length===0, first_invalid_event_id:errors[0]?.event_id ?? null, errors };
}

export async function sha256Document(content: Uint8Array) { return sha256Bytes(content); }
