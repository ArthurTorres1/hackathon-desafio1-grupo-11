import { describe, expect, it } from 'vitest';
import { aggregateCheckDimensions, assessReadiness } from '../../src/services/review-readiness.js';
describe('prontidão da entrega em conjunto isolado', () => {
  const dimensions = { documentary_check: 'PASSOU', geospatial_check: 'PASSOU', volume_check: 'PASSOU', chain_of_custody_check: 'PASSOU', human_review: 'PASSOU' } as const;
  const complete = { assessment_scope: 'REAL', dimensions, regulatory_coverage: 'CONFIRMADA', has_open_alert: false, has_unknown_origin: false, has_simulated_supporting_evidence: false } as const;
  it('permite apenas revisão de operador para conjunto isolado suficiente e bloqueia cada lacuna', () => {
    expect(assessReadiness(complete).readiness).toBe('READY_FOR_OPERATOR_REVIEW');
    for (const change of [{ assessment_scope: 'DEMONSTRATIVO' as const }, { has_simulated_supporting_evidence: true }, { has_open_alert: true }, { has_unknown_origin: true }, { regulatory_coverage: 'CONFLITANTE' as const }, { dimensions: { ...dimensions, geospatial_check: 'NAO_AVALIADO' as const } }]) expect(assessReadiness({ ...complete, ...change }).readiness).toBe('MISSING_EVIDENCE');
  });
  it('checagem PASSOU recente não esconde pendência de outro ancestral', () => {
    expect(aggregateCheckDimensions([{ dimension: 'geospatial_check', status: 'PASSOU' }, { dimension: 'geospatial_check', status: 'PENDENTE' }]).geospatial_check).toBe('PENDENTE');
  });
});
