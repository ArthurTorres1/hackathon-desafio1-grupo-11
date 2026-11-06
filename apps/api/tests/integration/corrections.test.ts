import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { storeDocument } from '../../src/services/document-storage.js';
import { sha256Bytes } from '../../src/services/integrity.js';
import { appendAuditEvent } from '../../src/services/audit-events.js';

const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const org = randomUUID(); const user = randomUUID(); const plot = randomUUID();
const origin = randomUUID(); const product = randomUUID(); const transformation = randomUUID();
const doc = randomUUID(); const parameter = randomUUID(); const shipment = randomUUID();
let app: Awaited<ReturnType<typeof buildServer>>;
let headers: Record<string, string>;
let originVersion = 1;
const post = (body: object, key = randomUUID()) => app.inject({ method: 'POST', url: '/api/v1/corrections', headers: { ...headers, 'idempotency-key': key }, payload: body });

beforeAll(async () => {
  process.env.PRIVATE_STORAGE_DIR = await mkdtemp(join(tmpdir(), 'foresttrace-corrections-'));
  const bytes = Buffer.from('Respaldo sintético de correção, sem validade oficial');
  const key = `${randomUUID()}.bin`; await storeDocument(key, bytes);
  await owner.organization.create({ data: { id: org, name: 'Organização sintética retificações', role: 'OPERATOR', state: 'AM', municipality: 'Teste', data_provenance: { label: 'SIMULADA' } } });
  await owner.user.create({ data: { id: user, name: 'Autor correção', organization_id: org, roles: ['OPERATOR'] } });
  await owner.membership.create({ data: { user_id: user, organization_id: org, role: 'OPERATOR' } });
  await owner.document.create({ data: { id: doc, organization_id: org, name: 'Respaldo', type: 'AUTHORIZATION', storage_key: key, content_hash: sha256Bytes(bytes), content_type: 'text/plain', data_provenance: 'SIMULADA', source: 'Teste', visibility: 'PRIVATE', allowed_organization_ids: [], created_by_user_id: user } });
  await owner.plot.create({ data: { id: plot, organization_id: org, state: 'AM', municipality: 'Teste', declared_property: 'Sintética', geometry: { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] }, geometry_hash: sha256Bytes('geometry'), geometry_date: new Date('2026-01-01'), area_ha: '1', data_provenance: { label: 'SIMULADA' }, created_by_user_id: user } });
  await owner.originLot.create({ data: { id: origin, code: randomUUID(), organization_id: org, plot_id: plot, species_common: 'Sintética', species_scientific: 'Dinizia excelsa', authorized_volume_m3: '10', harvested_volume_m3: '10', valid_from: new Date('2026-01-01'), valid_until: new Date('2027-12-31'), right_of_use: 'DECLARADO', data_provenance: { label: 'SIMULADA' }, created_by_user_id: user } });
  await owner.permit.create({ data: { origin_lot_id: origin, document_id: doc, reference: 'SIMULADA', issuing_authority: 'SIMULADA', official_system: 'SIMULADA', valid_from: new Date('2026-01-01'), valid_until: new Date('2027-12-31'), volume_m3: '10', data_provenance: { label: 'SIMULADA' } } });
  await owner.conversionParameter.create({ data: { id: parameter, input_product: 'tora', output_product: 'serrado', coefficient: '0.35', regulation_reference: 'SIMULADA', source_url: 'https://example.invalid', version: randomUUID(), valid_from: new Date('2026-01-01'), data_provenance: 'SIMULADA' } });
  await owner.$transaction(async tx => {
    await tx.transformation.create({ data: { id: transformation, code: randomUUID(), organization_id: org, occurred_at: new Date('2026-11-05'), conversion_parameter_id: parameter, residue_m3: '7', loss_m3: '0', assessment_scope: 'DEMONSTRATIVO', created_by_user_id: user, inputs: { create: [{ lot_id: origin, volume_m3: '10' }] } } });
    await tx.productLot.create({ data: { id: product, code: randomUUID(), organization_id: org, transformation_id: transformation, product: 'serrado', species_common: 'Sintética', species_scientific: 'Dinizia excelsa', volume_m3: '3', assessment_scope: 'DEMONSTRATIVO', data_provenance: { label: 'SIMULADA' }, created_by_user_id: user } });
    await tx.balance.create({ data: { lot_id: product, organization_id: org, available_m3: '3' } });
    await appendAuditEvent(tx, { streamId: transformation, entityType: 'TRANSFORMATION', entityId: transformation, type: 'TRANSFORMATION_RECORDED', actorId: user, payload: { input: origin, output: product } });
  });
  await owner.shipment.create({ data: { id: shipment, sender_id: org, recipient_id: org, carrier: 'Sintética', origin_state: 'AM', destination_state: 'AM', route_states: ['AM'], official_system: 'DECLARADO', document_ids: [doc], status: 'RECEIVED', declared_at: new Date('2026-10-01'), dispatched_at: new Date('2026-10-02'), received_at: new Date('2026-10-03'), created_by_user_id: user, items: { create: [{ lot_id: origin, volume_m3: '10', received_volume_m3: '10' }] } } });
  app = await buildServer();
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: user } });
  headers = { cookie: response.cookies.map(c => `${c.name}=${c.value}`).join('; '), 'x-csrf-token': response.json().csrf_token };
}, 60_000);
afterAll(async () => { await app?.close(); await owner.$disconnect(); await prisma.$disconnect(); });

describe.sequential('retificações versionadas e compensação de saldo', () => {
  it('reenvio de documento reproduz resposta sem duplicar arquivo, metadados ou evento', async () => {
    const key = randomUUID();
    const body = { name: 'documento idempotente', type: 'AUTHORIZATION', content_base64: Buffer.from('SIMULADA').toString('base64'), source: 'Teste', data_provenance: 'SIMULADA', assessment_scope: 'DEMONSTRATIVO', visibility: 'PRIVATE' };
    const send = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/documents', headers: { ...headers, 'idempotency-key': key }, payload });
    const first = await send(body); const second = await send(body);
    expect(first.statusCode, first.body).toBe(201); expect(second.statusCode, second.body).toBe(201);
    expect(second.json()).toEqual(first.json());
    const id = first.json().document.id;
    expect(await owner.custodyEvent.count({ where: { stream_id: id } })).toBe(1);
    expect((await send({ ...body, name: 'outro conteúdo' })).statusCode).toBe(409);
  });
  it('retifica origem, preserva evento e snapshot anterior e bloqueia produtos descendentes', async () => {
    const before = await owner.custodyEvent.findMany({ where: { stream_id: transformation } });
    const body = { entity_type: 'ORIGIN_LOT', entity_id: origin, expected_version: 1, reason: 'Correção documental sintética', changes: { right_of_use: 'DECLARAÇÃO RETIFICADA' }, evidence_ids: [doc] };
    const key = randomUUID();
    const response = await post(body, key);
    expect(response.statusCode, response.body).toBe(201);
    const correction = response.json().correction;
    expect(correction.previous_data.right_of_use).toBe('DECLARADO');
    expect(correction.corrected_data.right_of_use).toBe('DECLARAÇÃO RETIFICADA');
    expect(correction.previous_version).toBe(1); expect(correction.new_version).toBe(2); originVersion = 2;
    const replay = await post(body, key); expect(replay.statusCode, replay.body).toBe(201); expect(replay.json()).toEqual(response.json());
    expect(await owner.correction.count({ where: { entity_id: origin } })).toBe(1);
    const balance = await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: product, organization_id: org } } });
    expect(balance.available_m3.toString()).toBe('0'); expect(balance.quarantined_m3.toString()).toBe('3');
    expect(await owner.check.count({ where: { entity_id: product, rule_id: 'R19', status: 'ALERTA' } })).toBe(1);
    expect(await owner.custodyEvent.findUnique({ where: { event_id: before[0]!.event_id } })).toEqual(before[0]);
    const blockedHarvest = await app.inject({ method: 'POST', url: '/api/v1/harvests', headers: { ...headers, 'idempotency-key': randomUUID() }, payload: { origin_lot_id: origin, start_date: '2026-11-05', end_date: '2026-11-05', volume_m3: '1' } });
    expect(blockedHarvest.statusCode, blockedHarvest.body).toBe(409);
    expect(blockedHarvest.json().error.code).toBe('R19');
  });
  it('rejeita versão obsoleta, alteração direta de alocações e volume autorizado abaixo do corte', async () => {
    const base = { entity_type: 'ORIGIN_LOT', entity_id: origin, expected_version: 1, reason: 'Teste', changes: { right_of_use: 'teste' }, evidence_ids: [doc] };
    expect((await post(base)).json().error.code).toBe('CORRECTION_VERSION_CONFLICT');
    const negative = await post({ ...base, expected_version: originVersion, changes: { authorized_volume_m3: '9' } });
    expect(negative.json().error.code).toBe('R07');
    expect((await post({ ...base, expected_version: originVersion, changes: { authorized_volume_m3: '11' } })).json().error.code).toBe('AUTHORIZATION_ADJUSTMENT_REQUIRED');
    expect((await post({ ...base, expected_version: originVersion, changes: { harvested_volume_m3: '0' } })).json().error.code).toBe('CORRECTION_FIELD_FORBIDDEN');
    expect((await owner.originLot.findUniqueOrThrow({ where: { id: origin } })).version).toBe(2);
  });
  it('versiona remessa e transformação sem alterar volumes históricos; erro reverte tudo', async () => {
    const common = { reason: 'Revisão sintética', evidence_ids: [doc], expected_version: 1 };
    const received = await post({ ...common, entity_type: 'SHIPMENT', entity_id: shipment, changes: { carrier: 'Transportador retificado' } });
    expect(received.statusCode, received.body).toBe(201); expect(received.json().correction.new_version).toBe(2);
    const invalid = await post({ ...common, entity_type: 'TRANSFORMATION', entity_id: transformation, changes: { residue_m3: '8' } });
    expect(invalid.statusCode, invalid.body).toBe(422); expect(invalid.json().error.code).toBe('R08');
    expect(await owner.correction.count({ where: { entity_id: transformation } })).toBe(0);
    const transformed = await post({ ...common, entity_type: 'TRANSFORMATION', entity_id: transformation, changes: { residue_m3: '6', loss_m3: '1' } });
    expect(transformed.statusCode, transformed.body).toBe(201);
    expect((await owner.transformationInput.findFirstOrThrow({ where: { transformation_id: transformation } })).volume_m3.toString()).toBe('10');
    expect((await owner.productLot.findUniqueOrThrow({ where: { id: product } })).volume_m3.toString()).toBe('3');
  });
  it('bloqueia correção com reservas e não aceita registro de outra organização', async () => {
    await owner.balance.update({ where: { lot_id_organization_id: { lot_id: product, organization_id: org } }, data: { reserved_m3: '1', quarantined_m3: '2' } });
    const response = await post({ entity_type: 'ORIGIN_LOT', entity_id: origin, expected_version: 2, reason: 'Teste', changes: { right_of_use: 'Não deve gravar' }, evidence_ids: [doc] });
    expect(response.statusCode, response.body).toBe(409); expect(response.json().error.code).toBe('CORRECTION_RECONCILIATION_REQUIRED');
    expect((await owner.originLot.findUniqueOrThrow({ where: { id: origin } })).version).toBe(2);
    expect((await post({ entity_type: 'ORIGIN_LOT', entity_id: randomUUID(), expected_version: 1, reason: 'Teste', changes: { right_of_use: 'Teste' }, evidence_ids: [doc] })).statusCode).toBe(404);
  });
});
