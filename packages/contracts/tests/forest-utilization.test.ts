import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { ForestUtilizationInputSchema } from '../src/index.js';

const input = { area_total_ha: '120', area_app_ha: '20', extracted_log_volume_m3: '2100', declared_sawn_volume_m3: '714', management_profile_id: 'DEMO_MECHANIZED_35Y_V1' };
describe('contrato de entrada dos cálculos', () => {
  it('aceita área efetiva opcional, mantendo lacuna sob responsabilidade do domínio', () => {
    expect(Value.Check(ForestUtilizationInputSchema, input)).toBe(true);
    expect(Value.Check(ForestUtilizationInputSchema, { ...input, area_effective_ha: '100', tree: { dap_cm: '50', commercial_height_m: '12' } })).toBe(true);
  });
  it.each([{ area_total_ha: -1 }, { area_total_ha: 'NaN' }, { area_total_ha: '1e3' }, { area_total_ha: '1.0000001' }, { crv_limit: '0.45' }, { assessment_scope: 'REAL' }, { tree: { dap_cm: '50', commercial_height_m: '12', form_factor: '0.9' } }])('rejeita números ou campos fora do contrato: %j', change => {
    expect(Value.Check(ForestUtilizationInputSchema, { ...input, ...change })).toBe(false);
  });
});
