import 'dotenv/config';
import { prisma } from '../apps/api/src/db.js';
import { verifyEventChain, sha256Bytes } from '../apps/api/src/services/integrity.js';
import { verifyStoredPassport } from '../apps/api/src/services/passport-integrity.js';
import { readDocument } from '../apps/api/src/services/document-storage.js';

async function main() {
  const events = await prisma.custodyEvent.findMany({ orderBy: [{ stream_id: 'asc' }, { sequence: 'asc' }] });
  const grouped = new Map<string, typeof events>();
  for (const event of events) grouped.set(event.stream_id, [...(grouped.get(event.stream_id) ?? []), event]);
  // A head with no remaining events must not disappear from the verification report.
  const heads = await prisma.streamHead.findMany();
  for (const head of heads) if (!grouped.has(head.stream_id)) grouped.set(head.stream_id, []);
  let valid = true;
  const streams = [];
  for (const [streamId, rows] of grouped) {
    const check = verifyEventChain(rows.map(e => ({ event_id: e.event_id, stream_id: e.stream_id, sequence: e.sequence, entity: e.entity_type, entity_id: e.entity_id, type: e.type, actor_id: e.actor_id, timestamp: e.timestamp.toISOString(), payload: e.payload, previous_hash: e.previous_hash, event_hash: e.event_hash })));
    const head = heads.find(item => item.stream_id === streamId);
    const headMatches = !!head && head.sequence === rows.length && head.event_hash === (rows.at(-1)?.event_hash ?? null);
    const result = { stream_id: streamId, ...check, head_matches: headMatches };
    streams.push(result); if (!check.valid || !headMatches) valid = false;
  }
  const documents = await prisma.document.findMany({ select: { id: true, storage_key: true, content_hash: true } });
  const documentChecks = [];
  for (const document of documents) {
    try {
      const actual = sha256Bytes(await readDocument(document.storage_key));
      documentChecks.push({ document_id: document.id, valid: actual === document.content_hash, reason: actual === document.content_hash ? null : 'DOCUMENT_HASH_MISMATCH' });
    } catch { documentChecks.push({ document_id: document.id, valid: false, reason: 'DOCUMENT_BYTES_UNAVAILABLE' }); }
  }
  if (documentChecks.some(document => !document.valid)) valid = false;
  const passports = await prisma.passport.findMany();
  const passportChecks = [];
  for (const passport of passports) {
    try {
      const result = await verifyStoredPassport(prisma, passport, readDocument);
      passportChecks.push({ passport_id: passport.id, valid: result.integrity.valid, issues: result.integrity.issues, current_state: result.current_state });
    } catch (error) {
      passportChecks.push({ passport_id: passport.id, valid: false, issues: [{ code: (error as { code?: string }).code ?? 'ANCESTRY_INVALID' }] });
    }
  }
  if (passportChecks.some(p => !p.valid)) valid = false;
  console.log(JSON.stringify({ valid, event_count: events.length, stream_count: streams.length, streams, documents: documentChecks, passports: passportChecks, limitation: 'Hash-chain validation establishes consistency, not truth or externally anchored immutability.' }, null, 2));
  if (!valid) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
