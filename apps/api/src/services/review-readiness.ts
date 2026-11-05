import type { AssessmentScope, CheckResult, RegulatoryCoverage } from '@foresttrace/contracts';

export interface ReadinessInput {
  assessment_scope: AssessmentScope;
  dimensions: Partial<Record<'documentary_check'|'geospatial_check'|'volume_check'|'chain_of_custody_check'|'human_review',CheckResult>>;
  regulatory_coverage: RegulatoryCoverage;
  has_open_alert: boolean;
  has_unknown_origin: boolean;
  has_simulated_supporting_evidence: boolean;
}
export function assessReadiness(input: ReadinessInput) {
  const reasons: string[]=[];
  if (input.assessment_scope==='DEMONSTRATIVO') reasons.push('ASSESSMENT_SCOPE_DEMONSTRATIVE');
  if (input.has_open_alert) reasons.push('OPEN_ALERT');
  if (input.has_unknown_origin) reasons.push('UNKNOWN_ORIGIN');
  if (input.regulatory_coverage!=='CONFIRMADA') reasons.push('REGULATORY_COVERAGE_UNCONFIRMED');
  if (input.has_simulated_supporting_evidence) reasons.push('SIMULATED_SUPPORTING_EVIDENCE');
  for (const dimension of ['documentary_check','geospatial_check','volume_check','chain_of_custody_check','human_review'] as const) {
    if (input.dimensions[dimension]!=='PASSOU') reasons.push(`DIMENSION_${dimension.toUpperCase()}_NOT_PASSED`);
  }
  return { readiness: reasons.length===0 ? 'READY_FOR_OPERATOR_REVIEW' as const : 'MISSING_EVIDENCE' as const,
    reasons, regulatory_coverage:input.regulatory_coverage };
}

export function contextualHumanReview(input: { original_signal:string; decision:string; comment:string; evidenceIds:string[] }) {
  if (!input.comment.trim() || !input.evidenceIds.length) throw new Error('Revisão exige justificativa e evidência vinculada.');
  return { original_signal:input.original_signal, human_decision:input.decision, comment:input.comment.trim(), evidence_ids:[...input.evidenceIds],
    signal_overwritten:false, rule_re_evaluated:false };
}
