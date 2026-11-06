import type { Prisma, PrismaClient } from '@prisma/client';
import { canonicalize, sha256Canonical } from './integrity.js';

export type IdempotentResult<T = unknown> = { statusCode: number; body: T; replayed?: boolean };
export type IdempotencyScope = { actorId: string; operation: string; key: string; payload: unknown };
export class IdempotencyConflict extends Error {
  readonly statusCode = 409;
  readonly code = 'R17';
  constructor() { super('A chave de idempotência já foi usada com outro conteúdo.'); }
}
export class IdempotencyKeyRequired extends Error {
  readonly statusCode = 422;
  readonly code = 'IDEMPOTENCY_KEY_REQUIRED';
  constructor() { super('Informe o cabeçalho Idempotency-Key.'); }
}
class IdempotentOperationRejected extends Error {
  readonly code: string;
  constructor(readonly statusCode: number, body: unknown) {
    const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
    super(error?.message ?? 'Operação rejeitada.');
    this.code = error?.code ?? 'REQUEST_REJECTED';
  }
}

export function canonicalPayloadHash(value: unknown): string {
  return sha256Canonical(value);
}
export function requireIdempotencyKey(header: string | string[] | undefined): string {
  const key = Array.isArray(header) ? header[0] : header;
  if (!key || key.length > 200 || !/^[\x21-\x7e]+$/.test(key)) throw new IdempotencyKeyRequired();
  return key;
}

/** Runs the mutation and stores its exact HTTP status/body in the same transaction. */
export async function executeIdempotent<T>(
  client: PrismaClient,
  scope: IdempotencyScope,
  operation: (tx: Prisma.TransactionClient) => Promise<IdempotentResult<T>>,
): Promise<IdempotentResult<T>> {
  const payloadHash = canonicalPayloadHash(scope.payload);
  return client.$transaction(async tx => {
    // One domain lock protects cross-key balance and state invariants as well as idempotency rows.
    // This deliberately favors correctness over write throughput for the local MVP.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('foresttrace-domain-mutation-v1', 0))`;
    // Serialize same-key contenders before looking up the durable result.
    const lockName = canonicalize([scope.actorId, scope.operation, scope.key]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))`;
    const where = { user_id_operation_key: { user_id: scope.actorId, operation: scope.operation, key: scope.key } };
    const existing = await tx.idempotencyKey.findUnique({ where });
    if (existing) {
      if (existing.payload_hash !== payloadHash) throw new IdempotencyConflict();
      const body = typeof existing.response === 'string' ? JSON.parse(existing.response) as T : existing.response as T;
      return { statusCode: existing.status_code, body, replayed: true };
    }
    const result = await operation(tx);
    // A returned error must roll back any partial work just like a thrown error.
    if (result.statusCode >= 400) throw new IdempotentOperationRejected(result.statusCode, result.body);
    await tx.idempotencyKey.create({ data: {
      user_id: scope.actorId,
      operation: scope.operation,
      key: scope.key,
      payload_hash: payloadHash,
      // Persist the exact JSON serialization as a JSON string because JSONB reorders object keys.
      response: JSON.stringify(result.body) as Prisma.InputJsonValue,
      status_code: result.statusCode,
    } });
    return result;
  }, { isolationLevel: 'ReadCommitted', maxWait: 30_000, timeout: 30_000 });
}
