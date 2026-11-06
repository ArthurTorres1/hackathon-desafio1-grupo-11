import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { executeIdempotent, IdempotencyConflict } from '../../src/services/idempotency.js';

const db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const actorId = randomUUID();
const otherActorId = randomUUID();
const organizationId = randomUUID();
const key = `idempotency-test-${randomUUID()}`;
beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, name: 'Idempotency test', role: 'OPERATOR', state: 'AM', municipality: 'Teste', data_provenance: { label: 'TEST' } } });
  await db.user.create({ data: { id: actorId, name: 'Idempotency test', organization_id: organizationId, roles: ['OPERATOR'] } });
  await db.user.create({ data: { id: otherActorId, name: 'Other idempotency test', organization_id: organizationId, roles: ['OPERATOR'] } });
});
afterAll(async () => {
  await db.idempotencyKey.deleteMany({ where: { user_id: actorId } });
  await db.idempotencyKey.deleteMany({ where: { user_id: otherActorId } });
  await db.user.delete({ where: { id: otherActorId } });
  await db.user.delete({ where: { id: actorId } });
  await db.organization.delete({ where: { id: organizationId } });
  await db.$disconnect();
});

describe('persistência idempotente em PostgreSQL', () => {
  it('reproduz status/body, serializa concorrência, separa ator/rota e libera chave após rollback', async () => {
    let effects = 0;
    const scope = { actorId, operation: 'test:shipment-create', key, payload: { lot: 'lot-1', volume: '10.00' } };
    const run = () => executeIdempotent(db, scope, async () => {
      effects++;
      await new Promise(resolve => setTimeout(resolve, 20));
      return { statusCode: 201, body: { created_id: 'stable-response' } };
    });
    const concurrent = await Promise.all(Array.from({ length: 8 }, run));
    expect(effects).toBe(1);
    expect(concurrent.filter(result => result.replayed)).toHaveLength(7);
    expect(concurrent.every(result => result.statusCode === 201 && result.body.created_id === 'stable-response')).toBe(true);
    expect(concurrent.map(({ statusCode, body }) => ({ statusCode, body }))).toEqual(Array.from({ length: 8 }, () => ({ statusCode: 201, body: { created_id: 'stable-response' } })));
    await expect(executeIdempotent(db, { ...scope, payload: { lot: 'lot-1', volume: '9.00' } }, async () => ({ statusCode: 201, body: {} }))).rejects.toBeInstanceOf(IdempotencyConflict);
    const otherOperation = await executeIdempotent(db, { ...scope, operation: 'test:shipment-dispatch' }, async () => ({ statusCode: 200, body: { separate: true } }));
    expect(otherOperation.replayed).toBeUndefined();
    const otherActor = await executeIdempotent(db, { ...scope, actorId: otherActorId }, async () => ({ statusCode: 201, body: { other_actor: true } }));
    expect(otherActor.replayed).toBeUndefined();
    let active = 0; let maxActive = 0;
    await Promise.all(Array.from({ length: 4 }, (_, index) => executeIdempotent(db, { ...scope, key: `${key}-distinct-${index}`, payload: { index } }, async () => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active--;
      return { statusCode: 201, body: { index } };
    })));
    expect(maxActive).toBe(1);
    const failedKey = `${key}-failure`;
    await expect(executeIdempotent(db, { ...scope, key: failedKey }, async () => { throw new Error('rollback'); })).rejects.toThrow('rollback');
    const retry = await executeIdempotent(db, { ...scope, key: failedKey }, async () => ({ statusCode: 202, body: { retry: true } }));
    expect(retry.body).toEqual({ retry: true });
    const rejectedKey = `${key}-returned-error`;
    await expect(executeIdempotent(db, { ...scope, key: rejectedKey }, async () => ({ statusCode: 422, body: { error: { code: 'DOMAIN_REJECTED', message: 'Teste de rollback' } } }))).rejects.toMatchObject({ statusCode: 422, code: 'DOMAIN_REJECTED' });
    expect(await db.idempotencyKey.count({ where: { user_id: actorId, key: rejectedKey } })).toBe(0);
    expect((await executeIdempotent(db, { ...scope, key: rejectedKey }, async () => ({ statusCode: 201, body: { recovered: true } }))).body).toEqual({ recovered: true });
  }, 20_000);
});
