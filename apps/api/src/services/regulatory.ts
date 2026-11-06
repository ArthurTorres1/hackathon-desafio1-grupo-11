import type { RegulatoryRequirement } from '@prisma/client';
import { sha256Canonical } from './integrity.js';

export type RegulatoryCoverage = 'CONFIRMADA' | 'PENDENTE_DE_VERIFICACAO' | 'CONFLITANTE';
export type RegulatoryPhase = 'ORIGIN' | 'TRANSPORT' | 'DESTINATION' | 'TRANSFORMATION';
export type RegulatoryScope = { jurisdiction: string; phase: RegulatoryPhase };
export type RegulatoryContext = {
  scopes: RegulatoryScope[]; products: string[]; modality: string; official_system: string; occurred_on: string;
  entity_version: number;
  assessment_scope: 'REAL' | 'DEMONSTRATIVO';
};
export type RegulatoryGap = { jurisdiction: string; phase: RegulatoryPhase; product: string; code: string; requirement_id?: string; source_url?: string; next_action: string };
export type RegulatoryResult = { coverage: RegulatoryCoverage; requirements: RegulatoryRequirement[]; gaps: RegulatoryGap[]; context: RegulatoryContext; context_hash: string };
const fail = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 422, code: 'REGULATORY_CONTEXT_INVALID' }); };
const matches = (rule: string, value: string) => rule === '*' || rule === value;
const date = (value: Date) => value.toISOString().slice(0, 10);

/** Selects documented applicability only. Coverage is never an approval of supporting evidence. */
export function assessRegulatoryRequirements(rules: RegulatoryRequirement[], context: RegulatoryContext): RegulatoryResult {
  if (!context.scopes.length || !context.products.length || !context.modality || !context.official_system ||
    !/^\d{4}-\d{2}-\d{2}$/.test(context.occurred_on) || !Number.isFinite(Date.parse(context.occurred_on)) ||
    new Date(context.occurred_on).toISOString().slice(0, 10) !== context.occurred_on) fail('Contexto de aplicabilidade incompleto ou data inválida.');
  const gaps: RegulatoryGap[] = [];
  const selected = new Map<string, RegulatoryRequirement>();
  const byId = new Map(rules.map(rule => [rule.id, rule]));
  const versionScope = (rule: RegulatoryRequirement) => JSON.stringify([rule.jurisdiction, rule.phase, rule.product, rule.modality, rule.official_system, rule.source_url, rule.article]);
  for (const scope of context.scopes) for (const product of context.products) {
    const candidates = rules.filter(rule => rule.jurisdiction === scope.jurisdiction && rule.phase === scope.phase &&
      matches(rule.product, product) && matches(rule.modality, context.modality) && matches(rule.official_system, context.official_system) &&
      date(rule.valid_from) <= context.occurred_on && (!rule.valid_until || date(rule.valid_until) >= context.occurred_on));
    // A successor only replaces its predecessor within the applicable period and scope.
    const superseded = new Set<string>();
    for (const candidate of candidates) {
      const visited = new Set([candidate.id]);
      let current = candidate;
      const predecessors: string[] = [];
      let invalid = false;
      while (current.supersedes_id) {
        const previous = byId.get(current.supersedes_id);
        if (!previous || visited.has(previous.id) || versionScope(previous) !== versionScope(candidate)) { invalid = true; break; }
        visited.add(previous.id); predecessors.push(previous.id); current = previous;
      }
      if (invalid) gaps.push({ ...scope, product, requirement_id: candidate.id, code: 'VERSION_CHAIN_INVALID', next_action: 'Conferir os vínculos e o escopo das versões normativas.' });
      else for (const id of predecessors) superseded.add(id);
    }
    const active = candidates.filter(rule => !superseded.has(rule.id));
    if (!active.length) gaps.push({ ...scope, product, code: 'NO_APPLICABLE_PROFILE', next_action: 'Confirmar fontes, vigência e requisitos aplicáveis para este contexto.' });
    for (const rule of active) {
      selected.set(rule.id, rule);
      let code: string | undefined;
      if (rule.coverage === 'CONFLITANTE') code = 'CONFLICTING_SOURCES';
      else if (rule.coverage !== 'CONFIRMADA') code = 'REQUIREMENT_UNCONFIRMED';
      else if (!Array.isArray(rule.required_evidence) || !rule.required_evidence.length) code = 'EVIDENCE_REQUIREMENTS_EMPTY';
      const overlappingVersions = active.some(other => other.id !== rule.id && other.source_url === rule.source_url && other.article === rule.article && other.version !== rule.version);
      if (overlappingVersions) code = 'CONFLICTING_VERSIONS';
      if (code) gaps.push({ ...scope, product, code, requirement_id: rule.id, source_url: rule.source_url, next_action: rule.resolution_criteria || 'Verificar fonte e critério de resolução com responsável.' });
    }
  }
  const coverage: RegulatoryCoverage = gaps.some(gap => ['CONFLICTING_SOURCES','CONFLICTING_VERSIONS'].includes(gap.code)) ? 'CONFLITANTE' : gaps.length ? 'PENDENTE_DE_VERIFICACAO' : 'CONFIRMADA';
  return { coverage, requirements: [...selected.values()].sort((a, b) => a.id.localeCompare(b.id)), gaps, context, context_hash: sha256Canonical(context) };
}

/** Explicit allowlist: no source notes, authors, routes, evidence references or private IDs. */
export function publicRegulatorySummary(value?: { coverage: string; gaps: unknown } | null) {
  const gaps = Array.isArray(value?.gaps) ? value.gaps : [];
  const coverage: RegulatoryCoverage = value?.coverage === 'CONFLITANTE' ? 'CONFLITANTE' : value?.coverage === 'CONFIRMADA' && gaps.length === 0 ? 'CONFIRMADA' : 'PENDENTE_DE_VERIFICACAO';
  const phases = ['ORIGIN','TRANSPORT','DESTINATION','TRANSFORMATION'] as const;
  return { coverage, gap_count: value ? gaps.length : 1,
    pending_phases: phases.filter(phase => gaps.some(gap => gap && typeof gap === 'object' && gap.phase === phase)) };
}
