import { describe, expect, it } from 'vitest';
import type { RegulatoryRequirement } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { UF_CODES } from '@foresttrace/contracts';
import { assessRegulatoryRequirements, publicRegulatorySummary, type RegulatoryContext } from '../../src/services/regulatory.js';

const context: RegulatoryContext = { scopes: [{ jurisdiction: 'AM', phase: 'ORIGIN' }], products: ['tora'], modality: 'SYNTHETIC_TEST', official_system: 'SYNTHETIC', occurred_on: '2026-11-06', entity_version: 1, assessment_scope: 'DEMONSTRATIVO' };
const rule = (changes: Partial<RegulatoryRequirement> = {}): RegulatoryRequirement => ({ id: randomUUID(), jurisdiction: 'AM', phase: 'ORIGIN', product: 'tora', modality: 'SYNTHETIC_TEST', official_system: 'SYNTHETIC', source_url: 'https://example.invalid/synthetic-test', article: 'TEST_ONLY', version: '1', valid_from: new Date('2026-01-01'), valid_until: null, coverage: 'CONFIRMADA', required_evidence: ['SYNTHETIC_DOCUMENT'], resolution_criteria: 'Teste isolado, sem valor normativo', checked_at: new Date('2026-11-06'), checked_by: 'SYNTHETIC_TEST', supersedes_id: null, ...changes });

describe('seleção normativa conservadora', () => {
  it.each(UF_CODES)('preserva pendência de perfil ausente na UF %s', jurisdiction => {
    const result = assessRegulatoryRequirements([], { ...context, scopes: [{ jurisdiction, phase: 'ORIGIN' }] });
    expect(result.coverage).toBe('PENDENTE_DE_VERIFICACAO'); expect(result.gaps[0]!.code).toBe('NO_APPLICABLE_PROFILE');
  });
  it.each([
    { product: 'outro' }, { modality: 'outra' }, { official_system: 'outro' }, { jurisdiction: 'SP' }, { phase: 'TRANSPORT' },
    { valid_from: new Date('2026-11-07') }, { valid_until: new Date('2026-11-05') },
  ])('não aplica regra fora do contexto: %j', changes => {
    expect(assessRegulatoryRequirements([rule(changes)], context).requirements).toHaveLength(0);
  });
  it('exige perfis federais e locais e inclui limites de vigência', () => {
    const scoped = { ...context, scopes: [{ jurisdiction: 'AM', phase: 'ORIGIN' as const }, { jurisdiction: 'BR', phase: 'ORIGIN' as const }] };
    const local = rule({ valid_from: new Date('2026-11-06'), valid_until: new Date('2026-11-06') });
    expect(assessRegulatoryRequirements([local], scoped).coverage).toBe('PENDENTE_DE_VERIFICACAO');
    expect(assessRegulatoryRequirements([local, rule({ jurisdiction: 'BR' })], scoped).coverage).toBe('CONFIRMADA');
  });
  it('mantém lista vazia, requisito pendente e fonte conflitante como lacunas', () => {
    expect(assessRegulatoryRequirements([rule({ required_evidence: [] })], context).coverage).toBe('PENDENTE_DE_VERIFICACAO');
    expect(assessRegulatoryRequirements([rule({ coverage: 'PENDENTE_DE_VERIFICACAO' })], context).coverage).toBe('PENDENTE_DE_VERIFICACAO');
    expect(assessRegulatoryRequirements([rule({ coverage: 'CONFLITANTE' })], context).coverage).toBe('CONFLITANTE');
    expect(assessRegulatoryRequirements([rule(), rule({ version: '2' })], context).coverage).toBe('CONFLITANTE');
  });
  it('seleciona sucessor sem apagar o histórico, inclusive com versão intermediária expirada', () => {
    const first = rule(); const second = rule({ version: '2', supersedes_id: first.id, valid_until: new Date('2026-09-30') });
    const third = rule({ version: '3', supersedes_id: second.id, valid_from: new Date('2026-10-01') });
    const result = assessRegulatoryRequirements([first, second, third], context);
    expect(result.coverage).toBe('CONFIRMADA'); expect(result.requirements.map(value => value.id)).toEqual([third.id]);
  });
  it('não permite que sucessor de outra fonte suprima exigência e detecta ciclo', () => {
    const first = rule(); const unrelated = rule({ source_url: 'https://example.invalid/other', supersedes_id: first.id });
    const result = assessRegulatoryRequirements([first, unrelated], context);
    expect(result.coverage).toBe('PENDENTE_DE_VERIFICACAO'); expect(result.requirements).toHaveLength(2);
    first.supersedes_id = first.id;
    expect(assessRegulatoryRequirements([first], context).gaps[0]!.code).toBe('VERSION_CHAIN_INVALID');
  });
  it('rejeita data incoerente e minimiza resumo público por allowlist', () => {
    expect(() => assessRegulatoryRequirements([], { ...context, occurred_on: '2026-02-30' })).toThrow();
    const result = assessRegulatoryRequirements([rule({ coverage: 'CONFLITANTE', checked_by: 'PRIVATE_PERSON' })], context);
    expect(publicRegulatorySummary(result)).toEqual({ coverage: 'CONFLITANTE', gap_count: 1, pending_phases: ['ORIGIN'] });
    expect(JSON.stringify(publicRegulatorySummary(result))).not.toMatch(/PRIVATE_PERSON|example.invalid|requirement_id/);
    expect(publicRegulatorySummary(null).coverage).toBe('PENDENTE_DE_VERIFICACAO');
  });
});
