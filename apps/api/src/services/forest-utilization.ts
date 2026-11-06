import { Decimal } from 'decimal.js';

// Keep financial/domain consumers of Decimal independent of this calculator.
const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
const DECIMAL_INPUT = /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/;
const PI = new D('3.14159265358979323846264338327950288419716939937510582097494');
const SOURCE_406 = 'https://conama.mma.gov.br/?id=578&option=com_sisconama&task=arquivo.download';
const SOURCE_411 = 'https://www.gov.br/ibama/pt-br/assuntos/biodiversidade/flora-e-madeira/arquivos/dof/legislacao/20221212_Resolucao_Conama_411_6_maio_2009_compilada.pdf';

export type ManagementProfileId = 'DEMO_MECHANIZED_35Y_V1' | 'DEMO_NON_MECHANIZED_10Y_V1';
export type UtilizationResult = 'PASSOU' | 'ALERTA' | 'NAO_AVALIADO';
export interface ForestUtilizationInput {
  area_total_ha: string;
  area_app_ha: string;
  area_effective_ha?: string;
  extracted_log_volume_m3: string;
  declared_sawn_volume_m3: string;
  management_profile_id: ManagementProfileId;
  tree?: { dap_cm: string; commercial_height_m: string };
}
interface ManagementProfile {
  id: ManagementProfileId; version: string; source: string;
  intensity_m3_ha: string; initial_cycle_years: number;
}
export interface ForestUtilizationReport {
  assessment_scope: 'DEMONSTRATIVO'; data_provenance: 'SIMULADA';
  label: 'DADOS SIMULADOS'; readiness: 'MISSING_EVIDENCE';
  inputs: ForestUtilizationInput;
  parameters: {
    management: ManagementProfile;
    conversion: { id: string; version: string; source: string; coefficient: string };
    tree: { id: string; version: string; source: string; form_factor: string };
  };
  origin: {
    result: UtilizationResult; area_effective_ha: string | null;
    capacity_m3: string | null; intensity_m3_ha: string | null;
    utilization_pct: string | null; excess_m3: string | null; explanation: string;
  };
  mill: {
    result: UtilizationResult; crv_pct: string | null; expected_sawn_m3: string;
    residue_difference_m3: string; additional_log_equivalent_m3: string; explanation: string;
  };
  tree: { result: UtilizationResult; volume_m3: string | null; explanation: string };
  gaps: string[];
  formulas: { tree: string; capacity: string; intensity: string; utilization: string; crv: string; additional_log_equivalent: string };
  units: { area: 'ha'; volume: 'm³'; dap: 'cm'; height: 'm'; intensity: 'm³/ha'; ratio: '%' };
}

const PROFILES: Readonly<Record<ManagementProfileId, Readonly<ManagementProfile>>> = Object.freeze({
  DEMO_MECHANIZED_35Y_V1: Object.freeze({ id: 'DEMO_MECHANIZED_35Y_V1', version: '1', source: SOURCE_406, intensity_m3_ha: '30', initial_cycle_years: 35 }),
  DEMO_NON_MECHANIZED_10Y_V1: Object.freeze({ id: 'DEMO_NON_MECHANIZED_10Y_V1', version: '1', source: SOURCE_406, intensity_m3_ha: '10', initial_cycle_years: 10 }),
});

export class ForestUtilizationInputError extends Error {
  readonly statusCode = 422;
  readonly code = 'FOREST_UTILIZATION_INVALID_INPUT';
  constructor(readonly fields: Record<string, string>) {
    super(Object.values(fields).join(' '));
    this.name = 'ForestUtilizationInputError';
  }
}

function invalid(field: string, message: string): never {
  throw new ForestUtilizationInputError({ [field]: message });
}
function decimal(value: unknown, field: string, positive = false): Decimal {
  if (typeof value !== 'string' || !DECIMAL_INPUT.test(value)) {
    invalid(field, `${field}: informe string decimal não negativa com até 14 inteiros e seis casas, sem expoente.`);
  }
  const parsed = new D(value);
  if (positive && !parsed.gt(0)) invalid(field, `${field}: informe valor estritamente positivo.`);
  return parsed;
}
function display(value: Decimal): string { return value.toDecimalPlaces(6).toFixed(); }
function assertKeys(value: object, keys: string[], field: string): void {
  if (Object.keys(value).some(key => !keys.includes(key))) invalid(field, `${field}: campo não reconhecido; parâmetros são selecionados no servidor.`);
}

/** Demonstrative report only: no database, custody, authorization or readiness mutation. */
export function calculateForestUtilization(input: ForestUtilizationInput): ForestUtilizationReport {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('input', 'Informe um objeto de cálculo.');
  assertKeys(input, ['area_total_ha', 'area_app_ha', 'area_effective_ha', 'extracted_log_volume_m3', 'declared_sawn_volume_m3', 'management_profile_id', 'tree'], 'input');
  const total = decimal(input.area_total_ha, 'area_total_ha');
  const app = decimal(input.area_app_ha, 'area_app_ha');
  const logs = decimal(input.extracted_log_volume_m3, 'extracted_log_volume_m3');
  const sawn = decimal(input.declared_sawn_volume_m3, 'declared_sawn_volume_m3');
  if (app.gt(total)) invalid('area_app_ha', 'APP não pode exceder a área total.');
  const profile = Object.hasOwn(PROFILES, input.management_profile_id) ? PROFILES[input.management_profile_id] : undefined;
  if (!profile) invalid('management_profile_id', 'Selecione um perfil demonstrativo conhecido de método de arraste e ciclo.');
  const effective = input.area_effective_ha === undefined ? undefined : decimal(input.area_effective_ha, 'area_effective_ha');
  if (effective?.gt(total.minus(app))) invalid('area_effective_ha', 'Área efetiva não pode exceder a diferença entre área total e APP.');
  if (effective?.eq(0) && logs.gt(0)) invalid('area_effective_ha', 'Extração positiva exige área efetiva positiva.');
  if (logs.eq(0) && sawn.gt(0)) invalid('extracted_log_volume_m3', 'Saída serrada positiva exige entrada de tora positiva.');

  const gaps = [
    'Aplicabilidade, vigência e autorização da operação não foram confirmadas; os perfis são demonstrativos.',
    'Este relatório não cria saldo, autorização ou evidência operacional e não altera prontidão de passaporte.',
  ];
  const coefficient = new D('0.35');
  const capacity = effective?.mul(profile.intensity_m3_ha);
  const originEvaluated = !!effective?.gt(0);
  const originAlert = originEvaluated && logs.gt(capacity!);
  if (!originEvaluated) gaps.push('Área efetiva de exploração ausente ou nula: intensidade e aproveitamento não avaliados.');
  const expected = logs.mul(coefficient);
  const additional = D.max(0, sawn.div(coefficient).minus(logs));
  const millEvaluated = logs.gt(0);
  if (!millEvaluated) gaps.push('Entrada de tora nula: CRV observado não avaliado.');

  let treeInput: ForestUtilizationInput['tree'];
  let treeVolume: Decimal | undefined;
  if (input.tree !== undefined) {
    if (!input.tree || typeof input.tree !== 'object' || Array.isArray(input.tree)) invalid('tree', 'Cubagem deve informar DAP e altura comercial.');
    assertKeys(input.tree, ['dap_cm', 'commercial_height_m'], 'tree');
    const dap = decimal(input.tree.dap_cm, 'tree.dap_cm', true);
    const height = decimal(input.tree.commercial_height_m, 'tree.commercial_height_m', true);
    treeVolume = PI.mul(dap.div(100).pow(2)).div(4).mul(height).mul('0.70');
    treeInput = { dap_cm: input.tree.dap_cm, commercial_height_m: input.tree.commercial_height_m };
    gaps.push('Cubagem aproximada com fator demonstrativo 0,70; não substitui equação específica do PMFS nem autoriza corte.');
  } else gaps.push('DAP e altura comercial não informados: cubagem não avaliada.');

  return {
    assessment_scope: 'DEMONSTRATIVO', data_provenance: 'SIMULADA', label: 'DADOS SIMULADOS', readiness: 'MISSING_EVIDENCE',
    inputs: {
      area_total_ha: input.area_total_ha, area_app_ha: input.area_app_ha,
      ...(input.area_effective_ha === undefined ? {} : { area_effective_ha: input.area_effective_ha }),
      extracted_log_volume_m3: input.extracted_log_volume_m3, declared_sawn_volume_m3: input.declared_sawn_volume_m3,
      management_profile_id: profile.id, ...(treeInput ? { tree: treeInput } : {}),
    },
    parameters: {
      management: { ...profile },
      conversion: { id: 'DEMO_LOG_TO_SAWN_V1', version: '1', source: SOURCE_411, coefficient: '0.35' },
      tree: { id: 'DEMO_FORM_FACTOR_V1', version: '1', source: 'Hipótese demonstrativa do projeto; não há fator universal confirmado.', form_factor: '0.70' },
    },
    origin: {
      result: !originEvaluated ? 'NAO_AVALIADO' : originAlert ? 'ALERTA' : 'PASSOU',
      area_effective_ha: effective === undefined ? null : display(effective),
      capacity_m3: capacity === undefined ? null : display(capacity),
      intensity_m3_ha: originEvaluated ? display(logs.div(effective!)) : null,
      utilization_pct: originEvaluated ? display(logs.div(capacity!).mul(100)) : null,
      excess_m3: capacity === undefined ? null : display(D.max(0, logs.minus(capacity))),
      explanation: !originEvaluated ? 'Área efetiva ausente ou nula; não se presume área explorável pela simples subtração de APP.' : originAlert ? 'Extração declarada acima da capacidade sob o perfil demonstrativo; divergência para revisão, sem comprovação de fraude.' : 'Extração dentro da capacidade sob o perfil demonstrativo; isso não confirma autorização ou conformidade.',
    },
    mill: {
      result: !millEvaluated ? 'NAO_AVALIADO' : sawn.gt(expected) ? 'ALERTA' : 'PASSOU',
      crv_pct: millEvaluated ? display(sawn.div(logs).mul(100)) : null,
      expected_sawn_m3: display(expected), residue_difference_m3: display(logs.minus(sawn)),
      additional_log_equivalent_m3: display(additional),
      explanation: !millEvaluated ? 'Entrada de tora nula; razão de rendimento não avaliada.' : sawn.gt(expected) ? 'Saída declarada acima do coeficiente demonstrativo. Volume adicional equivalente é estimativa condicional, não prova de madeira ilegal.' : 'Rendimento dentro do coeficiente demonstrativo; isso não confirma conformidade. Diferença entrada menos saída não mede resíduos e perdas separadamente.',
    },
    tree: {
      result: treeVolume === undefined ? 'NAO_AVALIADO' : 'PASSOU', volume_m3: treeVolume === undefined ? null : display(treeVolume),
      explanation: treeVolume === undefined ? 'Cubagem opcional não informada.' : 'Estimativa geométrica com fator demonstrativo; não valida inventário, DAP mínimo ou autorização de corte.',
    },
    gaps,
    formulas: {
      tree: 'pi × (DAP_cm / 100)² / 4 × altura_comercial_m × fator_forma',
      capacity: 'area_effective_ha × intensidade_do_perfil_m3_ha',
      intensity: 'extracted_log_volume_m3 / area_effective_ha',
      utilization: 'extracted_log_volume_m3 / capacidade_m3 × 100',
      crv: 'declared_sawn_volume_m3 / extracted_log_volume_m3 × 100',
      additional_log_equivalent: 'max(0, declared_sawn_volume_m3 / coeficiente - extracted_log_volume_m3)',
    },
    units: { area: 'ha', volume: 'm³', dap: 'cm', height: 'm', intensity: 'm³/ha', ratio: '%' },
  };
}
