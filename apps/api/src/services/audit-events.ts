import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { sha256Canonical } from './integrity.js';

export async function appendAuditEvent(tx: Prisma.TransactionClient, input: {
  streamId: string; entityType: string; entityId: string; type: string; actorId: string; payload: unknown;
}) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.streamId}, 0))`;
  const head = await tx.streamHead.upsert({ where: { stream_id: input.streamId }, create: { stream_id: input.streamId }, update: {} });
  const timestamp = new Date();
  const body = { event_id: randomUUID(), stream_id: input.streamId, sequence: head.sequence + 1,
    entity: input.entityType, entity_id: input.entityId, type: input.type, actor_id: input.actorId,
    timestamp: timestamp.toISOString(), payload: input.payload, previous_hash: head.event_hash };
  const event_hash = sha256Canonical(body);
  await tx.custodyEvent.create({ data: { event_id: body.event_id, stream_id: body.stream_id, sequence: body.sequence,
    entity_type: body.entity, entity_id: body.entity_id, type: body.type, actor_id: body.actor_id, timestamp,
    payload: JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonValue, previous_hash: body.previous_hash, event_hash } });
  await tx.streamHead.update({ where: { stream_id: input.streamId }, data: { sequence: body.sequence, event_hash } });
}
