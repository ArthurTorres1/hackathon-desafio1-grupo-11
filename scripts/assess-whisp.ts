import { config } from 'dotenv';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assessWhisp, createHttpWhispTransport, WHISP_SUBMIT_URL, WHISP_POLL_URL_TEMPLATE, type WhispAssessment } from '../apps/api/src/services/whisp.js';
import { sha256Canonical } from '../apps/api/src/services/integrity.js';

config({ path: '.env', quiet: true });
const target = resolve('data/private/whisp-synthetic-assessment.json');
const sample = JSON.parse(await readFile('data/public_samples/demo-plot.geojson', 'utf8'));
const options = { nationalCodes: ['br'], unitType: 'ha', async: true, geometryAuditTrail: false };
const transport = createHttpWhispTransport({ submitUrl: process.env.WHISP_SUBMIT_URL || WHISP_SUBMIT_URL,
  pollUrl: id => (process.env.WHISP_POLL_URL_TEMPLATE || WHISP_POLL_URL_TEMPLATE).replace('{job_id}', encodeURIComponent(id)) });
const attempts: WhispAssessment[] = [];
let existing: { assessments?: WhispAssessment[] } | undefined;
try { existing = JSON.parse(await readFile(target, 'utf8')); } catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const last = existing?.assessments?.at(-1);
if (existing?.assessments) attempts.push(...existing.assessments);
const refresh = process.argv.includes('--refresh');
let assessment: WhispAssessment;
if (last?.result === 'CONCLUIDO' && !refresh) {
  console.log(JSON.stringify({ result: last.result, provenance: last.provenance, reused_cache: true, original_queried_at: last.queried_at, evidence: target }));
  process.exit(0);
}
if (last && !last.job_id && !refresh) throw new Error('Tentativa anterior sem token; use --refresh apenas para solicitar uma nova submissão explícita.');
const common = { geometry: sample.geometry, geometryVersion: 1, options, transport,
  contractConfirmed: process.env.WHISP_CONTRACT_CONFIRMED === 'true', apiKey: process.env.WHISP_API_KEY };
async function preserve(value: WhispAssessment) {
  attempts.push(value);
  await mkdir(resolve('data/private'), { recursive: true });
  const evidence = { assessment_scope: 'DEMONSTRATIVO', geometry_provenance: 'SIMULADA',
    note: 'Consulta externa sobre polígono numérico sintético; não representa imóvel ou autorização real.',
    geometry: sample.geometry, options, assessments: attempts };
  await writeFile(target, JSON.stringify({ ...evidence, evidence_hash: sha256Canonical(evidence) }, null, 2) + '\n');
  console.log(JSON.stringify({ result: value.result, provenance: value.provenance, http_status: value.http_status,
    query_hash: value.query_hash, response_hash: value.response_hash, queried_at: value.queried_at, evidence: target }));
}
assessment = await assessWhisp({ ...common, ...(last?.job_id && !refresh ? { jobId: last.job_id, maxPolls: 1 } : { maxPolls: 0 }) });
await preserve(assessment);
if (assessment.result === 'PENDENTE' && assessment.job_id) {
  assessment = await assessWhisp({ ...common, jobId: assessment.job_id, maxPolls: 30 });
  await preserve(assessment);
}
if (assessment.result !== 'CONCLUIDO') process.exitCode = 2;
