import { describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { calculateForestUtilization, ForestUtilizationInputError, type ForestUtilizationInput } from '../../src/services/forest-utilization.js';

const base: ForestUtilizationInput = {
  area_total_ha: '120', area_app_ha: '20', area_effective_ha: '100',
  extracted_log_volume_m3: '2100', declared_sawn_volume_m3: '714', management_profile_id: 'DEMO_MECHANIZED_35Y_V1',
};

describe('calculadora demonstrativa de cubagem e aproveitamento', () => {
  it('reproduz o primeiro caso sem atribuir conformidade ou prontidão', () => {
    const report = calculateForestUtilization(base);
    expect(report.origin).toMatchObject({ result: 'PASSOU', capacity_m3: '3000', intensity_m3_ha: '21', utilization_pct: '70', excess_m3: '0' });
    expect(report.mill).toMatchObject({ result: 'PASSOU', crv_pct: '34', expected_sawn_m3: '735', residue_difference_m3: '1386', additional_log_equivalent_m3: '0' });
    expect(report).toMatchObject({ assessment_scope: 'DEMONSTRATIVO', data_provenance: 'SIMULADA', label: 'DADOS SIMULADOS', readiness: 'MISSING_EVIDENCE' });
    expect(report.gaps.length).toBeGreaterThan(0);
    expect(report).not.toHaveProperty('anomaly_risk_score');
  });

  it('reproduz o segundo caso como divergência condicional para revisão', () => {
    const report = calculateForestUtilization({ ...base, area_total_ha: '60', area_app_ha: '10', area_effective_ha: '50', extracted_log_volume_m3: '1850', declared_sawn_volume_m3: '1100' });
    expect(report.origin).toMatchObject({ result: 'ALERTA', capacity_m3: '1500', intensity_m3_ha: '37', utilization_pct: '123.333333', excess_m3: '350' });
    expect(report.mill).toMatchObject({ result: 'ALERTA', crv_pct: '59.459459', expected_sawn_m3: '647.5', additional_log_equivalent_m3: '1292.857143' });
    expect(report.mill.explanation).toContain('não prova');
  });

  it('calcula cubagem em metros com fator explícito e não altera Decimal global', () => {
    const precision = Decimal.precision;
    const report = calculateForestUtilization({ ...base, tree: { dap_cm: '50', commercial_height_m: '20' } });
    expect(report.tree).toMatchObject({ result: 'PASSOU', volume_m3: '2.748894' });
    expect(report.parameters.tree.form_factor).toBe('0.70');
    expect(Decimal.precision).toBe(precision);
  });

  it('mantém os limites exatos inclusive acima do limite antes de arredondar', () => {
    expect(calculateForestUtilization({ ...base, extracted_log_volume_m3: '3000', declared_sawn_volume_m3: '1050' }).origin.result).toBe('PASSOU');
    expect(calculateForestUtilization({ ...base, extracted_log_volume_m3: '3000', declared_sawn_volume_m3: '1050' }).mill.result).toBe('PASSOU');
    const slightlyAbove = calculateForestUtilization({ ...base, extracted_log_volume_m3: '3000.000001', declared_sawn_volume_m3: '1050.000001' });
    expect(slightlyAbove.origin.result).toBe('ALERTA');
    expect(slightlyAbove.mill.result).toBe('ALERTA');
  });

  it('usa método sem máquinas explicitamente, não categoria comunitária', () => {
    const report = calculateForestUtilization({ ...base, management_profile_id: 'DEMO_NON_MECHANIZED_10Y_V1' });
    expect(report.parameters.management).toMatchObject({ intensity_m3_ha: '10', initial_cycle_years: 10 });
    expect(report.origin).toMatchObject({ result: 'ALERTA', capacity_m3: '1000' });
    expect(() => calculateForestUtilization({ ...base, management_profile_id: 'comunitario' as never })).toThrow(ForestUtilizationInputError);
  });

  it.each(['__proto__', 'constructor', 'toString'])('não resolve perfil herdado %s', management_profile_id => {
    expect(() => calculateForestUtilization({ ...base, management_profile_id: management_profile_id as never })).toThrow(ForestUtilizationInputError);
  });

  it('mantém área efetiva ausente sem inferi-la pela subtração de APP', () => {
    const report = calculateForestUtilization({ ...base, area_effective_ha: undefined });
    expect(report.origin).toMatchObject({ result: 'NAO_AVALIADO', area_effective_ha: null, capacity_m3: null, utilization_pct: null, intensity_m3_ha: null, excess_m3: null });
    expect(report.mill.result).toBe('PASSOU');
  });

  it('zero coerente produz razões nulas sem falso resultado aprovado', () => {
    const report = calculateForestUtilization({ ...base, area_total_ha: '0', area_app_ha: '0', area_effective_ha: '0', extracted_log_volume_m3: '0', declared_sawn_volume_m3: '0' });
    expect(report.origin).toMatchObject({ result: 'NAO_AVALIADO', capacity_m3: '0', utilization_pct: null, intensity_m3_ha: null });
    expect(report.mill).toMatchObject({ result: 'NAO_AVALIADO', crv_pct: null, expected_sawn_m3: '0', additional_log_equivalent_m3: '0' });
    expect(report.tree.result).toBe('NAO_AVALIADO');
  });

  it.each(['-1', 'NaN', 'Infinity', '1e2', '1.0000001', '100000000000000', '01', '1,2', '', ' 1'])('rejeita decimal inválido %s', value => {
    expect(() => calculateForestUtilization({ ...base, extracted_log_volume_m3: value })).toThrow(ForestUtilizationInputError);
  });

  it.each([
    { area_app_ha: '121' }, { area_effective_ha: '100.000001' },
    { area_effective_ha: '0' }, { extracted_log_volume_m3: '0' },
    { tree: { dap_cm: '0', commercial_height_m: '1' } },
    { tree: { dap_cm: '1', commercial_height_m: '-1' } },
  ])('rejeita entradas incoerentes %j', changes => {
    expect(() => calculateForestUtilization({ ...base, ...changes })).toThrow(ForestUtilizationInputError);
  });

  it('rejeita parâmetros, exceções e campos desconhecidos enviados pelo cliente', () => {
    expect(() => calculateForestUtilization({ ...base, crv_limite: '0.45' } as ForestUtilizationInput)).toThrow(ForestUtilizationInputError);
    expect(() => calculateForestUtilization({ ...base, exception: { approved: true } } as ForestUtilizationInput)).toThrow(ForestUtilizationInputError);
    expect(() => calculateForestUtilization({ ...base, tree: { dap_cm: '50', commercial_height_m: '20', form_factor: '1' } } as ForestUtilizationInput)).toThrow(ForestUtilizationInputError);
  });

  it('resultados de magnitudes máximas não usam notação exponencial', () => {
    const report = calculateForestUtilization({ ...base, area_total_ha: '99999999999999.999999', area_app_ha: '0', area_effective_ha: '99999999999999.999999', extracted_log_volume_m3: '99999999999999.999999', declared_sawn_volume_m3: '99999999999999.999999', tree: { dap_cm: '99999999999999.999999', commercial_height_m: '99999999999999.999999' } });
    expect(report.tree.volume_m3).toMatch(/^\d+(\.\d{1,6})?$/);
    expect(report.mill.additional_log_equivalent_m3).toMatch(/^\d+(\.\d{1,6})?$/);
    expect(report.origin.intensity_m3_ha).toBe('1');
  });

  it('não modifica entradas nem compartilha parâmetros mutáveis entre relatórios', () => {
    const input = structuredClone(base);
    const report = calculateForestUtilization(input);
    report.inputs.area_total_ha = '1';
    report.parameters.management.intensity_m3_ha = '999';
    expect(input).toEqual(base);
    expect(calculateForestUtilization(base).parameters.management.intensity_m3_ha).toBe('30');
  });

  it('preserva diferença negativa quando saída supera entrada, sem inventar resíduo positivo', () => {
    const report = calculateForestUtilization({ ...base, extracted_log_volume_m3: '10', declared_sawn_volume_m3: '11' });
    expect(report.mill).toMatchObject({ result: 'ALERTA', residue_difference_m3: '-1' });
  });
});
