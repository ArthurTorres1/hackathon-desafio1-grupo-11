import 'dotenv/config';
import { prisma } from '../apps/api/src/db.js';
import { verifyEventChain, sha256Canonical } from '../apps/api/src/services/integrity.js';

async function main() {
  const events = await prisma.custodyEvent.findMany({ orderBy: [{ stream_id: 'asc' }, { sequence: 'asc' }] });
  const grouped = new Map<string, typeof events>();
  for (const event of events) grouped.set(event.stream_id, [...(grouped.get(event.stream_id) ?? []), event]);
  let valid = true;
  const streams = [];
  for (const [streamId, rows] of grouped) {
    const check = verifyEventChain(rows.map(e => ({ event_id: e.event_id, stream_id: e.stream_id, sequence: e.sequence, entity: e.entity_type, entity_id: e.entity_id, type: e.type, actor_id: e.actor_id, timestamp: e.timestamp.toISOString(), payload: e.payload, previous_hash: e.previous_hash, event_hash: e.event_hash })));
    const head = await prisma.streamHead.findUnique({ where: { stream_id: streamId } });
    const headMatches = !!head && head.sequence === rows.length && head.event_hash === rows.at(-1)?.event_hash;
    const result = { stream_id: streamId, ...check, head_matches: headMatches };
    streams.push(result); if (!check.valid || !headMatches) valid = false;
  }
  const passports = await prisma.passport.findMany({ select: { id: true, content: true, content_hash: true } });
  const passportChecks = passports.map(p => ({ passport_id: p.id, valid: sha256Canonical(p.content) === p.content_hash }));
  if (passportChecks.some(p => !p.valid)) valid = false;
  console.log(JSON.stringify({ valid, event_count: events.length, stream_count: streams.length, streams, passports: passportChecks, limitation: 'Hash-chain validation establishes consistency, not truth or externally anchored immutability.' }, null, 2));
  if (!valid) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
