import { Type, type Static } from '@sinclair/typebox';

const decimal = Type.String({ pattern: '^(0|[1-9][0-9]{0,13})(\\.[0-9]{1,6})?$' });
const metric = Type.String({ pattern: '^(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$' });
const signedMetric = Type.String({ pattern: '^-?(0|[1-9][0-9]*)(\\.[0-9]{1,6})?$' });
const nullableMetric = Type.Union([metric, Type.Null()]);
const text = Type.String({ minLength: 1 });
const closed = { additionalProperties: false } as const;
const result = Type.Union([Type.Literal('PASSOU'), Type.Literal('ALERTA'), Type.Literal('NAO_AVALIADO')]);
export const ForestUtilizationInputSchema = Type.Object({
  area_total_ha: decimal, area_app_ha: decimal, area_effective_ha: Type.Optional(decimal),
  extracted_log_volume_m3: decimal, declared_sawn_volume_m3: decimal,
  management_profile_id: Type.Union([Type.Literal('DEMO_MECHANIZED_35Y_V1'), Type.Literal('DEMO_NON_MECHANIZED_10Y_V1')]),
  tree: Type.Optional(Type.Object({ dap_cm: decimal, commercial_height_m: decimal }, closed)),
}, closed);
export type ForestUtilizationRequest = Static<typeof ForestUtilizationInputSchema>;
export const ForestUtilizationResponseSchema = Type.Object({
  assessment_scope: Type.Literal('DEMONSTRATIVO'), data_provenance: Type.Literal('SIMULADA'),
  label: Type.Literal('DADOS SIMULADOS'), readiness: Type.Literal('MISSING_EVIDENCE'),
  inputs: ForestUtilizationInputSchema,
  parameters: Type.Object({
    management: Type.Object({ id: text, version: text, source: text, intensity_m3_ha: metric, initial_cycle_years: Type.Integer({ minimum: 1 }) }, closed),
    conversion: Type.Object({ id: text, version: text, source: text, coefficient: metric }, closed),
    tree: Type.Object({ id: text, version: text, source: text, form_factor: metric }, closed),
  }, closed),
  origin: Type.Object({ result, area_effective_ha: nullableMetric, capacity_m3: nullableMetric, intensity_m3_ha: nullableMetric, utilization_pct: nullableMetric, excess_m3: nullableMetric, explanation: text }, closed),
  mill: Type.Object({ result, crv_pct: nullableMetric, expected_sawn_m3: metric, residue_difference_m3: signedMetric, additional_log_equivalent_m3: metric, explanation: text }, closed),
  tree: Type.Object({ result, volume_m3: nullableMetric, explanation: text }, closed),
  gaps: Type.Array(text),
  formulas: Type.Object({ tree: text, capacity: text, intensity: text, utilization: text, crv: text, additional_log_equivalent: text }, closed),
  units: Type.Object({ area: Type.Literal('ha'), volume: Type.Literal('m³'), dap: Type.Literal('cm'), height: Type.Literal('m'), intensity: Type.Literal('m³/ha'), ratio: Type.Literal('%') }, closed),
}, closed);
export type ForestUtilizationResponse = Static<typeof ForestUtilizationResponseSchema>;
