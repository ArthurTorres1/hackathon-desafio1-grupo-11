import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const databaseUrl = process.env.TEST_DATABASE_URL!;
if (!databaseUrl || new URL(databaseUrl).pathname !== '/foresttrace_test') throw new Error('Banco de teste isolado obrigatório.');
const owner = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const appUrl = new URL(databaseUrl);
appUrl.username = 'foresttrace_app';
appUrl.password = process.env.POSTGRES_APP_PASSWORD ?? 'foresttrace_dev_app';
const app = new PrismaClient({ datasources: { db: { url: appUrl.toString() } } });

afterAll(async () => { await Promise.all([owner.$disconnect(), app.$disconnect()]); });

async function createOrigin(tx: Prisma.TransactionClient) {
  const organization = await tx.organization.create({ data: { name: 'Teste isolado', role: 'PRODUCER', state: 'AM', municipality: 'Sintético', data_provenance: { label: 'SIMULADA' } } });
  const user = await tx.user.create({ data: { name: 'Ator sintético', organization_id: organization.id, roles: ['OPERATOR'] } });
  const plot = await tx.plot.create({ data: {
    organization_id: organization.id, state: 'AM', municipality: 'Sintético', declared_property: 'Teste',
    geometry: { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] },
    geometry_hash: '0'.repeat(64), geometry_date: new Date('2026-02-05'), area_ha: '1.23',
    data_provenance: { label: 'SIMULADA' }, created_by_user_id: user.id,
  } });
  const lot = await tx.originLot.create({ data: {
    code: `TEST-${randomUUID()}`, organization_id: organization.id, plot_id: plot.id,
    species_common: 'Teste sintético', species_scientific: 'Teste sintético', authorized_volume_m3: '10',
    valid_from: new Date('2026-02-01'), valid_until: new Date('2026-03-31'), right_of_use: 'SIMULADO',
    data_provenance: { label: 'SIMULADA' }, created_by_user_id: user.id,
  } });
  return { organization, user, plot, lot };
}

describe('invariantes persistidas em PostgreSQL/PostGIS', () => {
  it('valida a amostra GeoJSON sintética e sua área de referência em hectares', async () => {
    const sample = JSON.parse(await readFile('data/public_samples/demo-plot.geojson', 'utf8'));
    const geometry = JSON.stringify(sample.geometry);
    const rows = await owner.$queryRaw<Array<{ valid: boolean; area_ha: number }>>`SELECT ST_IsValid(g) AS valid, ST_Area(g::geography)/10000 AS area_ha FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geometry}),4326) AS g) q`;
    expect(rows[0]!.valid).toBe(true);
    expect(Math.abs(rows[0]!.area_ha - sample.properties.reference_area_ha_estimate)).toBeLessThan(0.2);
  });
  it('calcula hectares por geografia e não por graus', async () => {
    const rows = await owner.$queryRaw<Array<{ area_ha: number }>>`SELECT ST_Area(ST_GeomFromGeoJSON('{"type":"Polygon","coordinates":[[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]]}')::geography)/10000 AS area_ha`;
    expect(rows[0]!.area_ha).toBeGreaterThan(1.2);
    expect(rows[0]!.area_ha).toBeLessThan(1.3);
  });

  it('rejeita organização inexistente por foreign key', async () => {
    await expect(owner.user.create({ data: { name: 'Não persistir', organization_id: randomUUID(), roles: ['OPERATOR'] } })).rejects.toThrow();
  });

  it('rejeita saldo negativo e desfaz a transação inteira', async () => {
    const initial = await owner.organization.count();
    await expect(owner.$transaction(async tx => {
      const { organization, lot } = await createOrigin(tx);
      await tx.balance.create({ data: { organization_id: organization.id, lot_id: lot.id, available_m3: '-0.000001' } });
    })).rejects.toThrow();
    expect(await owner.organization.count()).toBe(initial);
  });

  it('não permite corte acumulado acima da autorização, mesmo em SQL direto', async () => {
    await expect(owner.$transaction(async tx => {
      const { lot } = await createOrigin(tx);
      await tx.originLot.update({ where: { id: lot.id }, data: { harvested_volume_m3: '12' } });
    })).rejects.toThrow();
  });

  it('rejeita chave fiscal duplicada sem perder o controle transacional', async () => {
    await expect(owner.$transaction(async tx => {
      const { organization, user } = await createOrigin(tx);
      const fiscalKey = `SYNTHETIC-${randomUUID()}`;
      const data = { organization_id: organization.id, type: 'NFE', name: 'Sintética', content_hash: '0'.repeat(64), fiscal_key: fiscalKey, content_type: 'text/plain', data_provenance: 'SIMULADA', source: 'Teste', allowed_organization_ids: [], created_by_user_id: user.id };
      await tx.document.create({ data: { ...data, storage_key: randomUUID() } });
      await tx.document.create({ data: { ...data, storage_key: randomUUID() } });
    })).rejects.toThrow();
  });

  it('impede criação de lote de saída sem evento de transformação', async () => {
    await expect(owner.$transaction(async tx => {
      const { organization, user } = await createOrigin(tx);
      const parameter = await tx.conversionParameter.create({ data: { input_product: 'LOG', output_product: 'SAWN_WOOD', coefficient: '0.35', regulation_reference: 'SIMULADA', source_url: 'https://example.invalid', version: randomUUID(), valid_from: new Date('2026-01-01'), data_provenance: 'SIMULADA' } });
      const transformation = await tx.transformation.create({ data: { code: `TEST-${randomUUID()}`, organization_id: organization.id, occurred_at: new Date(), conversion_parameter_id: parameter.id, residue_m3: '7', loss_m3: '0', assessment_scope: 'DEMONSTRATIVO', created_by_user_id: user.id } });
      await tx.productLot.create({ data: { code: `TEST-${randomUUID()}`, organization_id: organization.id, transformation_id: transformation.id, product: 'SAWN_WOOD', species_common: 'Sintética', species_scientific: 'Sintética', volume_m3: '3', assessment_scope: 'DEMONSTRATIVO', data_provenance: { label: 'SIMULADA' }, created_by_user_id: user.id } });
    })).rejects.toThrow();
  });

  it('o papel de aplicação não pode editar ou apagar o histórico', async () => {
    for (const query of [
      Prisma.sql`UPDATE custody_events SET type='ALTERADO' WHERE false`,
      Prisma.sql`DELETE FROM custody_events WHERE false`,
      Prisma.sql`UPDATE checks SET status='PASSOU' WHERE false`,
      Prisma.sql`DELETE FROM audit_decisions WHERE false`,
    ]) await expect(app.$executeRaw(query)).rejects.toThrow();
    const identity = await app.$queryRaw<Array<{ current_user: string }>>`SELECT current_user`;
    expect(identity[0]!.current_user).toBe('foresttrace_app');
  });
});
