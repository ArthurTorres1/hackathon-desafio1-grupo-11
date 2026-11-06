import type { Prisma } from '@prisma/client';
import { loadProductAncestry } from './ancestry.js';
import { aggregateCheckDimensions } from './review-readiness.js';

type CurrentState = { readiness_status: string; requires_review: boolean; reasons: string[] };

/** Export an allowlisted view. A passport grant does not grant exact upstream geometry or document bytes. */
export async function buildEvidenceBundle(db: Prisma.TransactionClient, input: {
  passport: any; actor: { id: string; organization_id: string; roles: string[] }; visible: any;
  current_state: CurrentState; regulatory_summary: unknown; started_at: number;
}) {
  const { passport, actor, visible } = input;
  const state = structuredClone(input.current_state);
  if (visible.withheld_document_count > 0) {
    state.readiness_status = 'MISSING_EVIDENCE'; state.requires_review = true;
    state.reasons.push('WITHHELD_DOCUMENT_EVIDENCE');
  }
  const ownerView = actor.organization_id === passport.organization_id && actor.roles.some(role => ['OPERATOR','AUDITOR','REGULATOR'].includes(role));
  let evidence: Record<string, unknown> = { plots: [], origin_lots: [], transformations: [], shipments: [], organizations: [], documents: [], decisions: [] };
  let withheldDecisions = 0;
  try {
    const ancestry = await loadProductAncestry(db, passport.product_lot_id);
    const ids = [...new Set([...ancestry.product_lot_ids, ...ancestry.origin_lots.map(lot => lot.id), ...ancestry.transformations.map(row => row.id), ...ancestry.shipments.map(row => row.id)])];
    const [documents, cases, organizations] = await Promise.all([
      db.document.findMany({ where: { id: { in: visible.allowed_document_ids } }, select: { id: true, type: true, name: true, content_hash: true, data_provenance: true, source: true, version: true } }),
      db.auditCase.findMany({ where: { entity_id: { in: ids } }, include: { decisions: true } }),
      db.organization.findMany({ where: { id: { in: [...new Set([...ancestry.origin_lots.map(lot => lot.organization_id), ...ancestry.shipments.flatMap(row => [row.sender_id, row.recipient_id]), passport.organization_id])] } }, select: { id: true, name: true, country: true, state: true, municipality: true } }),
    ]);
    const allowed = new Set(visible.allowed_document_ids);
    const allDecisions = cases.flatMap(auditCase => auditCase.decisions.map(decision => ({ auditCase, decision })));
    const permittedDecisions = allDecisions.filter(({ auditCase }) => ownerView && auditCase.organization_id === actor.organization_id);
    withheldDecisions = allDecisions.length - permittedDecisions.length;
    evidence = {
      plots: ownerView ? ancestry.plots.map(plot => ({ id: plot.id, country: plot.country, state: plot.state, municipality: plot.municipality,
        geometry: plot.geometry, geometry_hash: plot.geometry_hash, geometry_version: plot.geometry_version, geometry_date: plot.geometry_date, area_ha: plot.area_ha, data_provenance: plot.data_provenance })) : [],
      origin_lots: ownerView ? ancestry.origin_lots.map(lot => ({ id: lot.id, plot_id: lot.plot_id, organization_id: lot.organization_id,
        species_common: lot.species_common, species_scientific: lot.species_scientific, authorized_volume_m3: lot.authorized_volume_m3,
        valid_from: lot.valid_from, valid_until: lot.valid_until, data_provenance: lot.data_provenance,
        permits: (lot.permits ?? []).filter((permit: any) => allowed.has(permit.document_id)).map((permit: any) => ({ reference: permit.reference, issuing_authority: permit.issuing_authority, official_system: permit.official_system, document_id: permit.document_id, valid_from: permit.valid_from, valid_until: permit.valid_until, volume_m3: permit.volume_m3, data_provenance: permit.data_provenance })) })) : [],
      transformations: ownerView ? ancestry.transformations.map(row => ({ id: row.id, occurred_at: row.occurred_at, organization_id: row.organization_id,
        inputs: row.inputs, outputs: (row.outputs ?? []).map((lot: any) => ({ id: lot.id, product: lot.product, volume_m3: lot.volume_m3 })), residue_m3: row.residue_m3, loss_m3: row.loss_m3 })) : [],
      shipments: ownerView ? ancestry.shipments.map(row => ({ id: row.id, sender_id: row.sender_id, recipient_id: row.recipient_id,
        origin_state: row.origin_state, destination_state: row.destination_state, declared_at: row.declared_at,
        dispatched_at: row.dispatched_at, received_at: row.received_at, status: row.status, items: row.items })) : [],
      organizations: ownerView ? organizations : [], documents,
      decisions: permittedDecisions.map(({ auditCase, decision }) => ({ case_id: auditCase.id, original_check_id: auditCase.check_id,
        rule_id: auditCase.rule_id, status: auditCase.status, decision: decision.decision, reviewer_user_id: decision.reviewer_user_id,
        comment: decision.comment, created_at: decision.created_at, evidence_ids: decision.evidence_ids.filter(id => allowed.has(id)) })),
    };
  } catch {
    state.readiness_status = 'MISSING_EVIDENCE'; state.requires_review = true; state.reasons.push('ANCESTRY_EVIDENCE_UNAVAILABLE');
  }
  state.reasons = [...new Set(state.reasons)];
  const dimensions = aggregateCheckDimensions(visible.content?.checks ?? []);
  return { passport_id: passport.id, version: passport.version, generated_at: new Date().toISOString(), duration_ms: Math.round(performance.now() - input.started_at),
    content_hash: visible.content_hash, snapshot_content_hash: visible.snapshot_content_hash, content: visible.content,
    evidence, withheld_document_count: visible.withheld_document_count, withheld_decision_count: withheldDecisions,
    exact_geometry_withheld: !ownerView, current_state: state, regulatory_summary: input.regulatory_summary,
    checklist_scope: 'SNAPSHOT', checklist: Object.entries(dimensions).map(([dimension, status]) => ({ dimension, status, state: status === 'PASSOU' ? 'PREENCHIDO' : 'PENDENTE' })),
    dds_reference_status: 'NAO_FORNECIDA',
    guidance: 'Guarde os documentos e registros por cinco anos conforme orientação do operador; esta aplicação não garante retenção por esse prazo.',
    limitations: ['Integridade dos hashes não comprova veracidade nem assinatura digital.', 'Pacote preparado para revisão humana; não representa envio oficial de DDS nem aprovação EUDR.'],
  };
}
