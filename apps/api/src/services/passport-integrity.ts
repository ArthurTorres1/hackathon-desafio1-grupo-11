import { sha256Canonical, sha256Bytes, verifyEventChain, type ChainEvent } from './integrity.js';
import { loadProductAncestry, plotGeometrySha } from './ancestry.js';
import { latestChecks } from './review-readiness.js';
import { ancestryDigests } from './ancestry-digests.js';
import { effectiveReviewedChecks } from './contextual-review.js';

export type SnapshotHead = { sequence: number; event_hash: string | null };
export type DocumentDigest = { id: string; content_hash: string; storage_key: string };
export type PassportIntegrityInput = {
  content: unknown;
  content_hash: string;
  snapshot_heads: Record<string, SnapshotHead>;
  events_by_stream: Record<string, ChainEvent[]>;
  current_heads: Record<string, SnapshotHead | null>;
  documents: DocumentDigest[];
  required_document_ids: string[];
  expected_document_hashes?: Record<string, string>;
  read_document: (storageKey: string) => Promise<Uint8Array>;
};

export type IntegrityIssue = { code: string; id: string; expected?: string | number | null; actual?: string | number | null };

/** Database adapter used by the API and the standalone audit-chain verifier. */
export async function verifyStoredPassport(db: any, passport: any, readDocumentBytes: (key: string) => Promise<Uint8Array>) {
  const ancestry = await loadProductAncestry(db, passport.product_lot_id);
  const entityIds = [...new Set([passport.product_lot_id, ...ancestry.product_lot_ids, ...ancestry.origin_lots.map((x: any) => x.id), ...ancestry.plots.map((x: any) => x.id), ...ancestry.transformations.map((x: any) => x.id), ...ancestry.shipments.map((x: any) => x.id)])];
  const [openCases, checkRows] = await Promise.all([
    db.auditCase.findMany({ where: { entity_id: { in: entityIds }, status: { in: ['ABERTO', 'EM_ANALISE', 'MANTIDO_PENDENTE'] } }, select: { rule_id: true } }),
    db.check.findMany({ where: { entity_id: { in: entityIds } }, orderBy: { created_at: 'desc' } }),
  ]);
  const alerts = (await effectiveReviewedChecks(db, latestChecks(checkRows) as any[])).filter((check: any) => check.status === 'ALERTA');
  const snapshot = passport.content as any;
  const expectedAncestry = snapshot?.ancestry ?? {};
  const snapshotHeads = passport.snapshot_heads as Record<string, SnapshotHead>;
  const missingCheckpointIds = entityIds.filter((id) => !Object.hasOwn(snapshotHeads, id));
  const currentSets: Record<string, string[]> = {
    origin_lot_ids: ancestry.origin_lots.map((x: any) => x.id).sort(),
    product_lot_ids: ancestry.product_lot_ids.slice().sort(),
    plot_ids: ancestry.plots.map((x: any) => x.id).sort(),
    transformation_ids: ancestry.transformations.map((x: any) => x.id).sort(),
    shipment_ids: ancestry.shipments.map((x: any) => x.id).sort(),
    document_ids: ancestry.document_ids.slice().sort(),
  };
  const linksChanged = Object.entries(currentSets).some(([key, ids]) => JSON.stringify(ids) !== JSON.stringify([...(expectedAncestry[key] ?? [])].sort()));
  const entityDigests = ancestryDigests(ancestry);
  const expectedEntityDigests = [...(expectedAncestry.entity_digests ?? [])].sort((a: any, b: any) => `${a.type}:${a.id}`.localeCompare(`${b.type}:${b.id}`));
  const entitiesChanged = sha256Canonical(entityDigests) !== sha256Canonical(expectedEntityDigests);
  const plotDigests = ancestry.plots.map((plot: any) => ({ id: plot.id, geometry_hash: plot.geometry_hash, geometry_version: plot.geometry_version, calculated_hash: plotGeometrySha(plot) })).sort((a: any, b: any) => a.id.localeCompare(b.id));
  const expectedPlots = [...(expectedAncestry.plot_digests ?? [])].sort((a: any, b: any) => a.id.localeCompare(b.id));
  const geometryChanged = sha256Canonical(plotDigests) !== sha256Canonical(expectedPlots) || plotDigests.some((plot: any) => plot.geometry_hash !== plot.calculated_hash);
  let provenanceChanged = false;
  if (Array.isArray(snapshot?.provenance_digests)) {
    const rows = db.lotProvenance ? await db.lotProvenance.findMany({ where: { product_lot_id: { in: ancestry.product_lot_ids } }, orderBy: { id: 'asc' } }) : [];
    const current = rows.map((row: any) => ({ id: row.id, content_hash: sha256Canonical(JSON.parse(JSON.stringify(row))) }));
    provenanceChanged = sha256Canonical(current) !== sha256Canonical(snapshot.provenance_digests);
  }
  const streamIds = Object.keys(snapshotHeads);
  const requiredDocumentIds = [...new Set([...ancestry.document_ids, ...(expectedAncestry.document_ids ?? [])])];
  const [events, heads, documents] = await Promise.all([
    db.custodyEvent.findMany({ where: { stream_id: { in: streamIds } }, orderBy: [{ stream_id: 'asc' }, { sequence: 'asc' }] }),
    db.streamHead.findMany({ where: { stream_id: { in: streamIds } } }),
    db.document.findMany({ where: { id: { in: requiredDocumentIds } }, select: { id: true, content_hash: true, storage_key: true } }),
  ]);
  const toChainEvent = (e: any): ChainEvent => ({ event_id: e.event_id, stream_id: e.stream_id, sequence: e.sequence, entity: e.entity_type, entity_id: e.entity_id, type: e.type, actor_id: e.actor_id, timestamp: e.timestamp.toISOString(), payload: e.payload, previous_hash: e.previous_hash, event_hash: e.event_hash });
  const eventsByStream = Object.fromEntries(streamIds.map((id) => [id, events.filter((e: any) => e.stream_id === id).map(toChainEvent)]));
  const headsByStream = Object.fromEntries(streamIds.map((id) => { const head = heads.find((x: any) => x.stream_id === id); return [id, head ? { sequence: head.sequence, event_hash: head.event_hash } : null]; }));
  const integrity = await verifyPassportIntegrity({ content: passport.content, content_hash: passport.content_hash, snapshot_heads: snapshotHeads, events_by_stream: eventsByStream, current_heads: headsByStream, documents, required_document_ids: requiredDocumentIds, expected_document_hashes: Object.fromEntries((expectedAncestry.document_digests ?? []).map((x: any) => [x.id, x.content_hash])), read_document: readDocumentBytes });
  if (linksChanged) integrity.issues.push({ code: 'ANCESTRY_LINKS_CHANGED', id: passport.product_lot_id });
  for (const id of missingCheckpointIds) integrity.issues.push({ code: 'SNAPSHOT_CHECKPOINT_MISSING', id });
  if (entitiesChanged) integrity.issues.push({ code: 'ANCESTRY_ENTITY_HASH_MISMATCH', id: passport.product_lot_id });
  if (geometryChanged) integrity.issues.push({ code: 'PLOT_GEOMETRY_HASH_MISMATCH', id: passport.product_lot_id });
  if (provenanceChanged) integrity.issues.push({ code: 'PROVENANCE_HASH_MISMATCH', id: passport.product_lot_id });
  integrity.valid = integrity.valid && !linksChanged && !missingCheckpointIds.length && !entitiesChanged && !geometryChanged && !provenanceChanged;
  const requiresReview = openCases.length > 0 || alerts.length > 0 || linksChanged || missingCheckpointIds.length > 0 || entitiesChanged || geometryChanged || provenanceChanged || integrity.changed_streams_since_snapshot.length > 0 || !integrity.valid;
  return {
    integrity, ancestry,
    current_state: { requires_review: requiresReview, readiness_status: requiresReview ? 'MISSING_EVIDENCE' : snapshot?.evidence_status ?? 'MISSING_EVIDENCE', open_case_count: openCases.length, alerts: alerts.map((x: any) => ({ rule_id: x.rule_id })) },
  };
}

/** Checks immutable snapshot, checkpoint links, current stream heads, and raw document bytes. */
export async function verifyPassportIntegrity(input: PassportIntegrityInput) {
  const issues: IntegrityIssue[] = [];
  const changedStreams: string[] = [];
  const actualContentHash = sha256Canonical(input.content);
  if (actualContentHash !== input.content_hash) issues.push({ code: 'PASSPORT_PAYLOAD_HASH_MISMATCH', id: 'passport', expected: input.content_hash, actual: actualContentHash });

  const chainResults: Record<string, ReturnType<typeof verifyEventChain>> = {};
  for (const [streamId, checkpoint] of Object.entries(input.snapshot_heads)) {
    const events = [...(input.events_by_stream[streamId] ?? [])].sort((a, b) => a.sequence - b.sequence);
    const chain = verifyEventChain(events);
    chainResults[streamId] = chain;
    if (!chain.valid) issues.push({ code: 'EVENT_CHAIN_INVALID', id: chain.first_invalid_event_id ?? streamId });
    const checkpointEvent = events.find((event) => event.sequence === checkpoint.sequence);
    const emptyCheckpoint = checkpoint.sequence === 0 && checkpoint.event_hash === null;
    if (!emptyCheckpoint && (!checkpointEvent || checkpointEvent.event_hash !== checkpoint.event_hash)) {
      issues.push({ code: 'SNAPSHOT_CHECKPOINT_MISMATCH', id: streamId, expected: checkpoint.event_hash, actual: checkpointEvent?.event_hash ?? null });
    }
    const current = input.current_heads[streamId];
    const last = events.at(-1);
    if ((current?.sequence ?? 0) !== checkpoint.sequence || (current?.event_hash ?? null) !== checkpoint.event_hash) changedStreams.push(streamId);
    if ((current?.sequence ?? 0) !== (last?.sequence ?? 0) || (current?.event_hash ?? null) !== (last?.event_hash ?? null)) {
      issues.push({ code: 'STREAM_HEAD_MISMATCH', id: streamId, expected: last?.event_hash ?? null, actual: current?.event_hash ?? null });
    }
  }

  const docs = new Map(input.documents.map((document) => [document.id, document]));
  const documentResults: Array<{ document_id: string; valid: boolean; code?: string }> = [];
  for (const id of [...new Set(input.required_document_ids)]) {
    const document = docs.get(id);
    if (!document) {
      issues.push({ code: 'DOCUMENT_METADATA_MISSING', id });
      documentResults.push({ document_id: id, valid: false, code: 'DOCUMENT_METADATA_MISSING' });
      continue;
    }
    const expectedMetadataHash = input.expected_document_hashes?.[id];
    if (expectedMetadataHash && expectedMetadataHash !== document.content_hash) {
      issues.push({ code: 'DOCUMENT_METADATA_HASH_MISMATCH', id, expected: expectedMetadataHash, actual: document.content_hash });
      documentResults.push({ document_id: id, valid: false, code: 'DOCUMENT_METADATA_HASH_MISMATCH' });
      continue;
    }
    try {
      const actual = sha256Bytes(await input.read_document(document.storage_key));
      if (actual !== document.content_hash) {
        issues.push({ code: 'DOCUMENT_HASH_MISMATCH', id, expected: document.content_hash, actual });
        documentResults.push({ document_id: id, valid: false, code: 'DOCUMENT_HASH_MISMATCH' });
      } else documentResults.push({ document_id: id, valid: true });
    } catch {
      issues.push({ code: 'DOCUMENT_BYTES_UNAVAILABLE', id });
      documentResults.push({ document_id: id, valid: false, code: 'DOCUMENT_BYTES_UNAVAILABLE' });
    }
  }
  return { valid: issues.length === 0, passport_hash: { expected: input.content_hash, actual: actualContentHash, valid: actualContentHash === input.content_hash }, event_chains: chainResults, changed_streams_since_snapshot: changedStreams, documents: documentResults, issues };
}
