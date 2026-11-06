import type { Prisma } from '@prisma/client';
import { sha256Canonical, sha256Bytes } from './integrity.js';
import { readDocument } from './document-storage.js';

type CaseContext = { id: string; check_id: string; entity_type: string; entity_id: string; organization_id: string };
type ReviewBinding = { context_hash: string; evidence: Array<{ id: string; content_hash: string }> };
function fail(message: string): never { throw Object.assign(new Error(message), { statusCode: 422, code: 'REVIEW_EVIDENCE_INVALID' }); }

async function contextDigest(db: Prisma.TransactionClient, auditCase: CaseContext) {
  let entity: unknown = null;
  if (auditCase.entity_type === 'ORIGIN_LOT') entity = await db.originLot.findUnique({ where: { id: auditCase.entity_id }, include: { plot: true } });
  if (auditCase.entity_type === 'PLOT') entity = await db.plot.findUnique({ where: { id: auditCase.entity_id } });
  if (auditCase.entity_type === 'TRANSFORMATION') entity = await db.transformation.findUnique({ where: { id: auditCase.entity_id }, include: { inputs: true, outputs: true } });
  if (auditCase.entity_type === 'SHIPMENT') entity = await db.shipment.findUnique({ where: { id: auditCase.entity_id }, include: { items: true } });
  if (!entity) fail('Operação avaliada não está disponível.');
  for (const field of ['inputs','outputs','items']) {
    const rows = (entity as Record<string, unknown>)[field];
    if (Array.isArray(rows)) rows.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  }
  const queries = await db.sourceQuery.findMany({ where: { lot_id: auditCase.entity_id }, orderBy: { id: 'asc' }, select: { id: true, geometry_hash: true, payload_hash: true, result_hash: true, status: true } });
  return sha256Canonical(JSON.parse(JSON.stringify({ check_id: auditCase.check_id, entity, source_queries: queries })));
}

/** Evidence bytes and metadata are bound to the exact operation/check context reviewed. */
export async function bindContextualReview(db: Prisma.TransactionClient, auditCase: CaseContext, evidenceIds: string[]): Promise<ReviewBinding> {
  if (!evidenceIds.length || new Set(evidenceIds).size !== evidenceIds.length) fail('Informe evidências distintas para a revisão.');
  const evidence: ReviewBinding['evidence'] = [];
  for (const id of [...evidenceIds].sort()) {
    const document = await db.document.findFirst({ where: { id, OR: [{ organization_id: auditCase.organization_id }, { allowed_organization_ids: { has: auditCase.organization_id } }] } });
    if (!document) fail('Evidência não está disponível no escopo da revisão.');
    const bytes = await readDocument(document.storage_key).catch(() => null);
    if (!bytes || sha256Bytes(bytes) !== document.content_hash) fail('Evidência ausente ou com hash divergente.');
    evidence.push({ id, content_hash: document.content_hash });
  }
  return { context_hash: await contextDigest(db, auditCase), evidence };
}

/** Original checks stay immutable. A valid contextual decision only changes the effective view. */
export async function effectiveReviewedChecks<T extends { id: string; status: string; dimension: string }>(db: Prisma.TransactionClient, checks: T[]) {
  const output: Array<T & { original_status?: string; contextual_resolution?: { case_id: string; decision_id: string; valid: boolean } }> = [];
  for (const check of checks) {
    if (check.status !== 'ALERTA' || check.dimension !== 'geospatial_check') { output.push(check); continue; }
    const auditCase = await db.auditCase.findFirst({ where: { check_id: check.id, status: 'RESOLVIDO_COM_EVIDENCIA' }, include: { decisions: { orderBy: { created_at: 'desc' }, take: 1 } } });
    const decision = auditCase?.decisions[0];
    if (!auditCase || decision?.decision !== 'RESOLVIDO_COM_EVIDENCIA') { output.push(check); continue; }
    const events = await db.custodyEvent.findMany({ where: { entity_id: auditCase.entity_id, type: 'AUDIT_CASE_DECIDED' }, orderBy: { sequence: 'desc' } });
    const event = events.find(item => (item.payload as { decision_id?: string })?.decision_id === decision.id);
    const binding = (event?.payload as unknown as { contextual_binding?: ReviewBinding })?.contextual_binding;
    let valid = false;
    if (binding) {
      try { valid = sha256Canonical(await bindContextualReview(db, auditCase, decision.evidence_ids)) === sha256Canonical(binding); }
      catch { valid = false; }
    }
    output.push({ ...check, original_status: check.status, status: valid ? 'PASSOU' : check.status,
      contextual_resolution: { case_id: auditCase.id, decision_id: decision.id, valid } });
  }
  return output;
}
