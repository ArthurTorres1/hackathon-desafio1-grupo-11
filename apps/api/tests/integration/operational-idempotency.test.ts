import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../../src/app.js';

const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const organizationId = randomUUID(); const userId = randomUUID();
const recipientId = randomUUID(); const plotId = randomUUID(); const lotId = randomUUID();
let app: Awaited<ReturnType<typeof buildServer>>;
let headers: { cookie: string; 'x-csrf-token': string };
beforeAll(async () => {
  await owner.organization.create({ data: { id: organizationId, name: 'Idempotency HTTP test', role: 'OPERATOR', state: 'AM', municipality: 'Teste', data_provenance: { label: 'TEST' } } });
  await owner.user.create({ data: { id: userId, name: 'Operator', organization_id: organizationId, roles: ['OPERATOR'] } });
  await owner.organization.create({ data: { id: recipientId, name: 'Idempotency recipient', role: 'PROCESSOR', state: 'SP', municipality: 'Teste', data_provenance: { label: 'SIMULADA' } } });
  await owner.plot.create({ data: { id: plotId, organization_id: organizationId, state: 'AM', municipality: 'Teste', declared_property: 'Sintética', geometry: { type: 'Polygon', coordinates: [] }, geometry_hash: 'test', geometry_date: new Date('2026-11-05'), area_ha: '1', data_provenance: {}, created_by_user_id: userId } });
  await owner.originLot.create({ data: { id: lotId, code: `IDEMP-${randomUUID()}`, organization_id: organizationId, plot_id: plotId, species_common: 'angelim', species_scientific: 'Dinizia excelsa', authorized_volume_m3: '10', valid_from: new Date('2026-01-01'), valid_until: new Date('2027-12-31'), right_of_use: 'SIMULADO', data_provenance: { label: 'SIMULADA' }, created_by_user_id: userId } });
  await owner.balance.create({ data: { lot_id: lotId, organization_id: organizationId, available_m3: '10' } });
  app = await buildServer();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: userId } });
  headers = { cookie: login.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '), 'x-csrf-token': login.json().csrf_token };
}, 60_000);
afterAll(async () => {
  await app?.close();
  const shipments = await owner.shipment.findMany({ where: { sender_id: organizationId }, select: { id: true } });
  const shipmentIds = shipments.map(shipment => shipment.id);
  await owner.shipmentItem.deleteMany({ where: { shipment_id: { in: shipmentIds } } });
  await owner.custodyEvent.deleteMany({ where: { stream_id: { in: shipmentIds } } });
  await owner.streamHead.deleteMany({ where: { stream_id: { in: shipmentIds } } });
  await owner.balanceMovement.deleteMany({ where: { lot_id: lotId } });
  await owner.shipment.deleteMany({ where: { id: { in: shipmentIds } } });
  await owner.balance.deleteMany({ where: { lot_id: lotId } });
  await owner.originLot.deleteMany({ where: { id: lotId } });
  await owner.plot.deleteMany({ where: { organization_id: organizationId } });
  await owner.idempotencyKey.deleteMany({ where: { user_id: userId } });
  await owner.session.deleteMany({ where: { user_id: userId } });
  await owner.user.delete({ where: { id: userId } });
  await owner.organization.delete({ where: { id: organizationId } });
  await owner.organization.delete({ where: { id: recipientId } });
  await owner.$disconnect();
});

describe('idempotência HTTP das escritas operacionais', () => {
  it('reproduz a resposta e não duplica a mutação; payload diferente retorna R17', async () => {
    const key = `plot-${randomUUID()}`;
    const payload = { organization_id: organizationId, country: 'BR', state: 'AM', municipality: 'Teste', declared_property: 'Área sintética', geometry_version: 1, geometry_date: '2026-11-05', data_provenance: { geometry: 'SIMULADA' }, geometry: { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] } };
    const post = (body: unknown) => app.inject({ method: 'POST', url: '/api/v1/plots', headers: { ...headers, 'idempotency-key': key }, payload: body as object });
    const first = await post(payload); const second = await post(payload);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.body).toBe(first.body);
    expect(await owner.plot.count({ where: { organization_id: organizationId, id: { not: plotId } } })).toBe(1);
    const conflict = await post({ ...payload, declared_property: 'Outro conteúdo' });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('R17');
    expect(await owner.plot.count({ where: { organization_id: organizationId, id: { not: plotId } } })).toBe(1);
  }, 20_000);

  it('serializa duas remessas com chaves distintas e não reserva 12 m³ de saldo 10 m³', async () => {
    const body = { sender_organization_id: organizationId, recipient_organization_id: recipientId, origin_state: 'AM', destination_state: 'SP', route_states: ['AM', 'SP'], items: [{ lot_id: lotId, volume_m3: '6' }], transporter: 'SIMULADO', official_system: 'NAO_VERIFICADO', document_ids: [] };
    const request = (key: string) => app.inject({ method: 'POST', url: '/api/v1/shipments', headers: { ...headers, 'idempotency-key': key }, payload: body });
    const [first, second] = await Promise.all([request(`shipment-a-${randomUUID()}`), request(`shipment-b-${randomUUID()}`)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([201, 409]);
    const success = first.statusCode === 201 ? first : second;
    const rejected = first.statusCode === 409 ? first : second;
    expect(rejected.json().error.code).toBe('R08');
    const balance = await owner.balance.findUniqueOrThrow({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: organizationId } } });
    expect(balance.available_m3.toString()).toBe('4');
    expect(balance.reserved_m3.toString()).toBe('6');
    expect(await owner.shipment.count({ where: { sender_id: organizationId, recipient_id: recipientId } })).toBe(1);
    expect(await owner.balanceMovement.count({ where: { lot_id: lotId, action: 'RESERVE', entity_id: success.json().shipment.id } })).toBe(1);
    expect(await owner.custodyEvent.count({ where: { stream_id: success.json().shipment.id, type: 'SHIPMENT_CREATED' } })).toBe(1);
  }, 20_000);
});
