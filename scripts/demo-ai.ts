import { config } from 'dotenv';
import { Type } from '@sinclair/typebox';
import { runCodex } from '../apps/api/src/services/codex-cli.js';
import { assessConversion } from '../apps/api/src/services/rules.js';

config({ path: '.env', quiet: true });
const check = assessConversion({ inputVolumeM3: '10', outputVolumeM3: '5', multiplier: '0.35',
  parameterVersion: 'demo-v1', parameterSource: 'Parâmetro demonstrativo sintético',
  parameterValidFrom: '2026-01-01', assessmentDate: '2026-11-06' });
try {
  const suggestion = await runCodex({
    instruction: 'Explique o alerta R10 citando os campos e a fonte fornecidos. Liste lacunas e próximos passos para o auditor.',
    context: { assessment_scope: 'DEMONSTRATIVO', data_provenance: 'SIMULADA', check },
    schema: Type.Object({ explanation: Type.String(), gaps: Type.Array(Type.String()),
      next_steps: Type.Array(Type.String()) }, { additionalProperties: false }),
  });
  console.log(JSON.stringify({ check, suggestion, human_review_required: true }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Falha na demonstração de IA.');
  process.exitCode = 1;
}
