import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildServer } from '../apps/api/src/app.js';
import { prisma } from '../apps/api/src/db.js';
import { configureImageryForTests } from '../apps/api/src/services/inpe-routes.js';

// Explicit live-provider smoke, using only the repository's synthetic polygon.
assert.equal(process.env.INPE_IMAGERY_ENABLED, 'true', 'Habilite INPE_IMAGERY_ENABLED explicitamente para executar o smoke real.');
const fixture = JSON.parse(await readFile('data/public_samples/demo-plot.geojson', 'utf8'));
const app = await buildServer();
const run = randomUUID();
const report: Record<string, unknown> = { run, started_at: new Date().toISOString(), context: 'SIMULADA', provider: 'REAL_CONSULTADA' };
try {
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: '20000000-0000-4000-8000-000000000011' } });
  assert.equal(login.statusCode, 200, login.body);
  const headers = { cookie: login.cookies.map(c => `${c.name}=${c.value}`).join('; '), 'x-csrf-token': login.json().csrf_token };
  const post = async (path: string, payload: object) => {
    const response = await app.inject({ method: 'POST', url: `/api/v1/${path}`, headers: { ...headers, 'idempotency-key': randomUUID() }, payload });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${path}: ${response.statusCode} ${response.body}`);
    return response.json();
  };
  const search = await post('imagery/search', { geometry: fixture.geometry, datetime: '2026-10-01T00:00:00Z/2026-10-31T23:59:59Z' });
  const scene = search.scenes.find((value: { renderable: boolean }) => value.renderable);
  assert.ok(scene, 'O provedor não retornou cena renderizável para a geometria sintética.');
  const rendered = await app.inject({ url: scene.render_url, headers });
  assert.equal(rendered.statusCode, 200, `render: ${rendered.statusCode}`);
  assert.match(String(rendered.headers['content-type']), /image\/png/);
  assert.deepEqual([...rendered.rawPayload.subarray(0, 8)], [137,80,78,71,13,10,26,10]);
  // Separate process-local simulation; the preceding search and PNG used the real provider.
  const unavailable = await buildServer();
  try {
    configureImageryForTests({ render: async () => { throw Object.assign(new Error('Indisponibilidade simulada no smoke.'), { statusCode: 503, code: 'INDISPONIVEL' }); } });
    const failure = await unavailable.inject({ url: scene.render_url, headers });
    assert.equal(failure.statusCode, 503);
    report.simulated_asset_failure_status = failure.statusCode;
  } finally {
    configureImageryForTests();
    await unavailable.close();
  }
  const plot = await post('plots', { organization_id: '10000000-0000-4000-8000-000000000011', country: 'BR', state: 'AM', municipality: 'Demonstração', declared_property: `Smoke INPE sintético ${run}`, geometry: fixture.geometry, geometry_version: 1, geometry_date: '2026-11-06', data_provenance: { geometry: 'SIMULADA' } });
  const linkBody = { query_id: search.query_id, scene_key: scene.scene_key, geometry_version: 1 };
  await post(`plots/${plot.plot.id}/imagery-references`, linkBody);
  await post(`plots/${plot.plot.id}/imagery-references`, linkBody);
  const reopened = await app.inject({ url: `/api/v1/plots/${plot.plot.id}/imagery-references`, headers });
  assert.equal(reopened.statusCode, 200, reopened.body);
  assert.equal(reopened.json().references.length, 1, 'O vínculo repetido deve preservar uma única referência.');
  const document = await post('documents', { name: `Autorização sintética INPE ${run}`, type: 'AUTHORIZATION', content_base64: Buffer.from('SIMULADA - SEM VALIDADE OFICIAL').toString('base64'), source: 'Smoke sintético INPE', data_provenance: 'SIMULADA', assessment_scope: 'DEMONSTRATIVO', visibility: 'PRIVATE' });
  const lot = await post('origin-lots', { plot_id: plot.plot.id, code: `INPE-SMOKE-${run}`, species_common_name: 'angelim-vermelho', species_scientific_name: 'Dinizia excelsa', authorized_volume_m3: '1', permit_reference: 'SIMULADA', permit_document_id: document.document.id, valid_from: '2026-01-01', valid_until: '2027-12-31', right_of_use: 'SIMULADO', assessment_scope: 'DEMONSTRATIVO', data_provenance: { volume: 'SIMULADA' } });
  const lotView = await app.inject({ url: `/api/v1/origin-lots/${lot.origin_lot.id}`, headers });
  assert.equal(lotView.statusCode, 200, lotView.body);
  assert.ok(lotView.body.includes(plot.plot.id), 'O lote deve apontar para a parcela consultada.');
  const anonymous = await app.inject({ url: scene.render_url });
  assert.equal(anonymous.statusCode, 401, 'Cache aquecido não pode dispensar sessão.');
  await mkdir('data/private', { recursive: true });
  await writeFile('data/private/inpe-live-smoke.png', rendered.rawPayload);
  Object.assign(report, { finished_at: new Date().toISOString(), query_id: search.query_id, plot_id: plot.plot.id, origin_lot_id: lot.origin_lot.id, scene, queried_at: search.queried_at, png_bytes: rendered.rawPayload.length, private_cache_control: rendered.headers['cache-control'], reference_count: reopened.json().references.length, anonymous_render_status: anonymous.statusCode });
  await writeFile('data/private/inpe-live-smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: 'ok', plot_id: plot.plot.id, item_id: scene.item_id, png_bytes: rendered.rawPayload.length, evidence: 'data/private/inpe-live-smoke.json' }));
} finally {
  await app.close();
  await prisma.$disconnect();
}
