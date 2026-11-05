import 'dotenv/config';
import { prisma } from '../apps/api/src/db.js';
import { sha256Canonical, sha256Bytes } from '../apps/api/src/services/integrity.js';

const ids = {
  forest: '10000000-0000-4000-8000-000000000001', mill: '10000000-0000-4000-8000-000000000002', buyerOrg: '10000000-0000-4000-8000-000000000003',
  operator: '20000000-0000-4000-8000-000000000001', reviewer: '20000000-0000-4000-8000-000000000002', buyerUser: '20000000-0000-4000-8000-000000000003',
  plot: '30000000-0000-4000-8000-000000000001', document: '40000000-0000-4000-8000-000000000001', parameter: '50000000-0000-4000-8000-000000000001',
} as const;
const origin = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const harvest = (n: number) => `61000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const transform = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const product = (n: number) => `71000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const caseId = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const checkId = (n: number) => `81000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sampleGeo = { type: 'Polygon', coordinates: [[[-60.1, -3.1], [-60.099, -3.1], [-60.099, -3.099], [-60.1, -3.099], [-60.1, -3.1]]] };
const synthetic = { label: 'SIMULADA', source: 'Fixture sintética ForestTrace', informed_by: 'equipe de demonstração', recorded_at: '2026-11-05T12:00:00.000Z', confidence: 'NAO_AVALIADA' };
const content = (text: string) => Buffer.from(text, 'utf8');

async function upsertDemoData() {
  const orgs = [
    { id: ids.forest, name: 'Floresta Demo (sintética)', role: 'OPERATOR', country: 'BR', state: 'AM', municipality: 'Manaus', data_provenance: synthetic },
    { id: ids.mill, name: 'Serraria Demo (sintética)', role: 'PROCESSOR', country: 'BR', state: 'AM', municipality: 'Itacoatiara', data_provenance: synthetic },
    { id: ids.buyerOrg, name: 'Comprador Demo (sintético)', role: 'BUYER', country: 'BR', state: 'SP', municipality: 'São Paulo', data_provenance: synthetic },
  ];
  for (const o of orgs) await prisma.organization.upsert({ where: { id: o.id }, create: o, update: o });
  const users = [
    { id: ids.operator, name: 'Operadora Demo (autora)', organization_id: ids.forest, roles: ['OPERATOR', 'AUDITOR'] },
    { id: ids.reviewer, name: 'Auditora Demo (revisora distinta)', organization_id: ids.forest, roles: ['AUDITOR'] },
    { id: ids.buyerUser, name: 'Comprador Demo', organization_id: ids.buyerOrg, roles: ['BUYER'] },
  ];
  for (const u of users) await prisma.user.upsert({ where: { id: u.id }, create: u, update: u });
  for (const [user_id, organization_id, role] of [[ids.operator, ids.forest, 'OPERATOR'], [ids.operator, ids.forest, 'AUDITOR'], [ids.reviewer, ids.forest, 'AUDITOR'], [ids.buyerUser, ids.buyerOrg, 'BUYER']] as const) {
    await prisma.membership.upsert({ where: { user_id_organization_id_role: { user_id, organization_id, role } }, create: { user_id, organization_id, role }, update: {} });
  }
  await prisma.plot.upsert({ where: { id: ids.plot }, create: { id: ids.plot, organization_id: ids.forest, state: 'AM', municipality: 'Manaus', declared_property: 'Parcela demonstrativa fictícia', geometry: sampleGeo, geometry_hash: sha256Canonical(sampleGeo), geometry_date: new Date('2026-11-05'), area_ha: '1.2', data_provenance: synthetic, created_by_user_id: ids.operator }, update: {} });
  await prisma.document.upsert({ where: { id: ids.document }, create: { id: ids.document, organization_id: ids.forest, type: 'AUTHORIZATION', name: 'Autorização de demonstração (sintética)', storage_key: 'demo://authorization/foresttrace-001', content_hash: sha256Bytes(content('DOCUMENTO FICTÍCIO - NÃO É AUTORIZAÇÃO')), content_type: 'text/plain', data_provenance: 'SIMULADA', source: 'Fixture sintética ForestTrace', visibility: 'PRIVATE', allowed_organization_ids: [], created_by_user_id: ids.operator }, update: {} });
  await prisma.conversionParameter.upsert({ where: { id: ids.parameter }, create: { id: ids.parameter, input_product: 'tora', output_product: 'serrado', coefficient: '0.35', regulation_reference: 'Parâmetro demonstrativo; vigência não confirmada', source_url: 'https://example.invalid/demo-crv', version: 'demo-tora-serrado-v1', valid_from: new Date('2026-01-01'), data_provenance: 'SIMULADA' }, update: {} });

  for (let i = 1; i <= 4; i++) {
    const lotId = origin(i); const harvestId = harvest(i); const transformId = transform(i);
    const lotCode = i === 2 ? 'LT-204' : `DEMO-${String.fromCharCode(64 + i)}`;
    await prisma.originLot.upsert({ where: { id: lotId }, create: { id: lotId, organization_id: ids.forest, plot_id: ids.plot, code: lotCode, species_common: 'angelim-vermelho', species_scientific: 'Dinizia excelsa', authorized_volume_m3: '10', harvested_volume_m3: '10', valid_from: new Date('2026-01-01'), valid_until: new Date('2026-12-31'), right_of_use: 'declaração sintética sem efeito jurídico', data_provenance: synthetic, assessment_scope: 'DEMONSTRATIVO', created_by_user_id: ids.operator }, update: { harvested_volume_m3: '10' } });
    await prisma.permit.upsert({ where: { id: origin(i) }, create: { id: origin(i), origin_lot_id: lotId, reference: `SIMULADA-${lotCode}`, issuing_authority: 'NÃO VERIFICADO', official_system: 'NÃO VERIFICADO', document_id: ids.document, valid_from: new Date('2026-01-01'), valid_until: new Date('2026-12-31'), volume_m3: '10', data_provenance: synthetic }, update: {} });
    await prisma.harvest.upsert({ where: { id: harvestId }, create: { id: harvestId, organization_id: ids.forest, origin_lot_id: lotId, species: 'angelim-vermelho', volume_m3: '10', period_start: new Date('2026-02-01'), period_end: new Date('2026-02-02'), tag: 'SIMULADA', document_ids: [ids.document], created_by_user_id: ids.operator }, update: {} });
    await prisma.balance.upsert({ where: { lot_id_organization_id: { lot_id: lotId, organization_id: ids.forest } }, create: { lot_id: lotId, organization_id: ids.forest, available_m3: i === 2 ? '5' : i === 1 ? '7' : '0', quarantined_m3: i === 2 ? '5' : '0' }, update: {} });
    const outputVolumes = i === 1 ? ['3'] : i === 2 ? ['5'] : i === 3 ? ['6', '4'] : ['6'];
    await prisma.transformation.upsert({ where: { id: transformId }, create: { id: transformId, code: `DEMO-TRANS-${i}`, organization_id: ids.forest, occurred_at: new Date('2026-02-03T12:00:00Z'), conversion_parameter_id: ids.parameter, residue_m3: '0', loss_m3: String(10 - outputVolumes.reduce((a, x) => a + Number(x), 0)), assessment_scope: 'DEMONSTRATIVO', created_by_user_id: ids.operator }, update: {} });
    await prisma.transformationInput.upsert({ where: { id: transformId }, create: { id: transformId, transformation_id: transformId, lot_id: lotId, volume_m3: '10' }, update: {} });
    for (let o = 0; o < outputVolumes.length; o++) {
      const outId = product(i * 10 + o + 1); const outVolume = outputVolumes[o]!; const outCode = `DEMO-${i}-${o + 1}`;
      await prisma.productLot.upsert({ where: { id: outId }, create: { id: outId, code: outCode, organization_id: ids.forest, transformation_id: transformId, product: 'madeira serrada', species_common: 'angelim-vermelho', species_scientific: 'Dinizia excelsa', volume_m3: outVolume, assessment_scope: 'DEMONSTRATIVO', data_provenance: synthetic, created_by_user_id: ids.operator }, update: {} });
      await prisma.lotProvenance.create({ data: { product_lot_id: outId, origin_lot_id: i === 4 ? null : lotId, volume_m3: outVolume, fraction: '1' } });
      await prisma.balance.upsert({ where: { lot_id_organization_id: { lot_id: outId, organization_id: ids.forest } }, create: { lot_id: outId, organization_id: ids.forest, available_m3: i === 2 ? '0' : outVolume, quarantined_m3: i === 2 ? outVolume : '0' }, update: {} });
    }
    const needsAlert = i === 2 || i === 4;
    if (needsAlert) {
      const cId = checkId(i); const aId = caseId(i); const rule = i === 2 ? 'R10' : 'R11';
      await prisma.check.upsert({ where: { id: cId }, create: { id: cId, organization_id: ids.forest, entity_type: 'TRANSFORMATION', entity_id: transformId, rule_id: rule, rule_version: '1', name: i === 2 ? 'Rendimento de conversão' : 'Origem desconhecida', description: 'Checagem de cenário sintético.', source: { label: 'fixture' }, modality: 'DEMONSTRATIVO', dimension: i === 2 ? 'volume_check' : 'chain_of_custody_check', status: 'ALERTA', technical_severity: 'HIGH', message: i === 2 ? 'LT-204 declara 5 m³ frente ao parâmetro demonstrativo 0,35.' : 'Uma fração positiva permanece sem origem atribuída.', suggested_action: 'Revisar evidências; nenhuma aprovação automática.', values: { input_m3: '10', output_m3: i === 2 ? '5' : '6', coefficient: '0.35' }, assessment_scope: 'DEMONSTRATIVO' }, update: {} });
      await prisma.auditCase.upsert({ where: { id: aId }, create: { id: aId, organization_id: ids.forest, check_id: cId, entity_type: 'TRANSFORMATION', entity_id: transformId, created_by_user_id: ids.operator, rule_id: rule }, update: {} });
    }
    const entries = [
      { event_id: `90000000-0000-4000-8000-${String(i * 10 + 1).padStart(12, '0')}`, sequence: 1, entity: 'ORIGIN_LOT', entity_id: lotId, type: 'HARVEST_RECORDED', actor_id: ids.operator, timestamp: '2026-02-02T12:00:00.000Z', payload: { harvest_id: harvestId, volume_m3: '10' }, previous_hash: null },
      { event_id: `90000000-0000-4000-8000-${String(i * 10 + 2).padStart(12, '0')}`, sequence: 2, entity: 'TRANSFORMATION', entity_id: transformId, type: 'TRANSFORMATION_RECORDED', actor_id: ids.operator, timestamp: '2026-02-03T12:00:00.000Z', payload: { transformation_id: transformId, output_volumes_m3: outputVolumes }, previous_hash: null },
    ];
    let previousHash: string | null = null;
    for (const entry of entries) {
      const data = { ...entry, stream_id: lotId, previous_hash: previousHash };
      const event_hash = sha256Canonical(data);
      await prisma.custodyEvent.upsert({ where: { stream_id_sequence: { stream_id: lotId, sequence: entry.sequence } }, create: { event_id: entry.event_id, stream_id: lotId, sequence: entry.sequence, entity_type: entry.entity, entity_id: entry.entity_id, type: entry.type, actor_id: entry.actor_id, timestamp: new Date(entry.timestamp), payload: entry.payload, previous_hash: previousHash, event_hash }, update: {} });
      previousHash = event_hash;
    }
    await prisma.streamHead.upsert({ where: { stream_id: lotId }, create: { stream_id: lotId, sequence: 2, event_hash: previousHash }, update: { sequence: 2, event_hash: previousHash } });
  }
  console.log('Fixtures A/B/C + origem desconhecida sincronizados; todos os dados estão marcados SIMULADA.');
}

upsertDemoData().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
