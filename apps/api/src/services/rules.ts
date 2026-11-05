import { Decimal } from 'decimal.js';

export type RuleResult = 'PASSOU' | 'ALERTA' | 'PENDENTE' | 'NAO_AVALIADO';
export interface ConversionException {
  multiplier: string; approved: boolean; evidenceIds: string[];
  validFrom: string; validUntil: string; species?: string; product?: string;
  expectedSpecies?: string; expectedProduct?: string;
}
export interface ConversionAssessment {
  rule_code: 'R10'; result: RuleResult; input_volume_m3: string;
  actual_volume_m3: string; multiplier: string; expected_volume_m3: string;
  parameter_version: string | null; parameter_source: string | null;
  exception_applied: boolean; explanation: string;
}

const VOLUME_PATTERN = /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/;
function volume(value: string, field: string): Decimal {
  if (!VOLUME_PATTERN.test(value)) throw new Error(`${field} deve ser decimal positivo com no máximo seis casas.`);
  return new Decimal(value);
}

/** Pure R10 evaluation. The default is a demonstrative reference, not a legal rule. */
export function assessConversion(input: {
  inputVolumeM3: string; outputVolumeM3: string;
  multiplier?: string; parameterVersion?: string; parameterSource?: string;
  parameterValidFrom?: string; parameterValidUntil?: string;
  assessmentDate?: string; species?: string; product?: string; exception?: ConversionException;
}): ConversionAssessment {
  const consumed = volume(input.inputVolumeM3, 'Entrada');
  const produced = volume(input.outputVolumeM3, 'Saída');
  let multiplier = new Decimal(input.multiplier ?? '0');
  let exceptionApplied = false;
  let result: RuleResult = 'PASSOU';
  if (consumed.lte(0) || produced.lt(0)) {
    throw new Error('R10 requer volumes decimais válidos e entrada positiva.');
  }
  const parameterDateValid = !!input.assessmentDate && !!input.parameterValidFrom && !!input.parameterValidUntil && input.assessmentDate >= input.parameterValidFrom && input.assessmentDate <= input.parameterValidUntil;
  if (!input.multiplier || !input.parameterVersion || !input.parameterSource || !parameterDateValid) result = 'PENDENTE';
  if (input.exception) {
    const e = input.exception;
    const date = input.assessmentDate;
    const scopeMatches = (!e.expectedSpecies || e.expectedSpecies === input.species) && (!e.expectedProduct || e.expectedProduct === input.product);
    const valid = e.approved && e.evidenceIds.length > 0 && scopeMatches && !!date && date >= e.validFrom && date <= e.validUntil;
    if (!valid) result = 'ALERTA';
    else { multiplier = new Decimal(e.multiplier); exceptionApplied = true; }
  }
  const limit = consumed.mul(multiplier);
  if (result === 'PASSOU' && produced.gt(limit)) result = 'ALERTA';
  return {
    rule_code: 'R10', result, input_volume_m3: consumed.toFixed(), actual_volume_m3: produced.toFixed(),
    multiplier: multiplier.toFixed(), expected_volume_m3: limit.toFixed(),
    parameter_version: input.parameterVersion ?? null,
    parameter_source: input.parameterSource ?? null,
    exception_applied: exceptionApplied,
    explanation: result === 'PENDENTE' ? 'Parâmetro versionado, fonte ou vigência aplicável não informados.' : result === 'ALERTA' ? 'Saída declarada acima do parâmetro aplicável ou exceção sem comprovação válida.' : 'Saída dentro do parâmetro configurado; isso não certifica conformidade normativa.',
  };
}

export function checkBalance(available: string, requested: string, rule: 'R07' | 'R08') {
  const a = volume(available, 'Saldo'), r = volume(requested, 'Quantidade');
  if (a.lt(0) || r.lte(0)) throw new Error('Volumes inválidos.');
  return { rule_code: rule, result: r.lte(a) ? 'PASSOU' as const : 'ALERTA' as const,
    available_m3: a.toFixed(), requested_m3: r.toFixed(), pending: rule === 'R07' && r.gt(a),
    confirmed: r.lte(a) };
}

export function checkReceipt(dispatched: string, received: string, tolerance = '0') {
  const d = volume(dispatched, 'Expedido'), r = volume(received, 'Recebido'), t = volume(tolerance, 'Tolerância');
  if (d.lt(0) || r.lt(0) || t.lt(0)) throw new Error('Volumes inválidos.');
  const difference = d.minus(r).abs();
  return { rule_code: 'R09' as const, result: difference.lte(t) ? 'PASSOU' as const : 'ALERTA' as const,
    dispatched_m3: d.toFixed(), received_m3: r.toFixed(), difference_m3: difference.toFixed(), tolerance_m3: t.toFixed() };
}
