import { readFileSync } from 'node:fs';
import { Decimal } from 'decimal.js';
import { Value } from '@sinclair/typebox/value';
import { PositiveDecimalSchema, StateSchema } from '@foresttrace/contracts';
import { describe, expect, it } from 'vitest';
import { assessConversion } from '../../src/services/rules.js';
import { allocateProvenance } from '../../src/services/provenance.js';

interface Harvest { start_date: string; end_date: string; volume_m3: string; data_provenance: string }
interface Shipment {
  created_at: string; dispatched_at: string; received_at: string;
  volume_dispatched_m3: string; volume_received_m3: string;
  route_states: string[]; recipient_confirmation: string;
}
interface Fixture {
  scenario: string; label: string; assessment_scope: string; created_at: string; readiness: string;
  origin?: { code: string; volume_m3: string; species_common_name: string; species_scientific_name: string; data_provenance: string };
  species?: { common_name: string; scientific_name: string; verification: string };
  harvest?: Harvest; harvests?: Harvest[]; shipment?: Shipment; shipments?: Shipment[];
  unknown_input?: { origin_lot_id: null; volume_m3: string; data_provenance: string };
  transformation: {
    occurred_at: string; input_m3: string; output_m3: string; residue_m3: string; loss_m3: string;
    crv: string; expected_result: string;
  };
  output?: { volume_m3: string; allocations: { origin_lot_id: string | null; volume_m3: string; fraction: string }[] };
}

const fixtures = ['demo_valid', 'demo_anomaly', 'demo_mixed_origin', 'demo_unknown_origin'].map(name => ({
  name, data: JSON.parse(readFileSync(new URL(`../../../../data/fixtures/${name}.json`, import.meta.url), 'utf8')) as Fixture,
}));

describe('coerência das fixtures demonstrativas', () => {
  it.each(fixtures)('$name preserva rótulos, espécies, cronologia e reconciliação decimal', ({ data }) => {
    expect(data).toMatchObject({ label: 'DADOS SIMULADOS', assessment_scope: 'DEMONSTRATIVO', readiness: 'MISSING_EVIDENCE' });
    const common = data.origin?.species_common_name ?? data.species?.common_name;
    const scientific = data.origin?.species_scientific_name ?? data.species?.scientific_name;
    expect(common).toBe('angelim-vermelho');
    expect(scientific).toBe('Dinizia excelsa');
    const harvests = data.harvest ? [data.harvest] : data.harvests!;
    const shipments = data.shipment ? [data.shipment] : data.shipments!;
    const input = new Decimal(data.transformation.input_m3);
    let harvested = new Decimal(0);
    for (const harvest of harvests) {
      expect(harvest.data_provenance).toBe('SIMULADA');
      expect(Value.Check(PositiveDecimalSchema, harvest.volume_m3)).toBe(true);
      expect(Date.parse(harvest.start_date)).toBeLessThanOrEqual(Date.parse(harvest.end_date));
      expect(Date.parse(harvest.end_date)).toBeLessThanOrEqual(Date.parse(shipments[0]!.created_at));
      harvested = harvested.plus(harvest.volume_m3);
    }
    if (data.unknown_input) {
      expect(data.unknown_input).toMatchObject({ origin_lot_id: null, data_provenance: 'SIMULADA' });
      harvested = harvested.plus(data.unknown_input.volume_m3);
    }
    expect(harvested.eq(input)).toBe(true);
    for (const shipment of shipments) {
      expect(shipment.recipient_confirmation).toBe('DECLARADA_SIMULADA');
      expect(shipment.route_states.every(state => Value.Check(StateSchema, state))).toBe(true);
      expect(Date.parse(shipment.created_at)).toBeLessThanOrEqual(Date.parse(shipment.dispatched_at));
      expect(Date.parse(shipment.dispatched_at)).toBeLessThan(Date.parse(shipment.received_at));
      expect(Date.parse(shipment.received_at)).toBeLessThan(Date.parse(data.transformation.occurred_at));
      expect(new Decimal(shipment.volume_dispatched_m3).eq(input)).toBe(true);
      expect(new Decimal(shipment.volume_received_m3).eq(input)).toBe(true);
    }
    expect(Date.parse(data.transformation.occurred_at)).toBeLessThan(Date.parse(data.created_at));
    const t = data.transformation;
    expect(new Decimal(t.output_m3).plus(t.residue_m3).plus(t.loss_m3).eq(input)).toBe(true);
    const assessment = assessConversion({
      inputVolumeM3: t.input_m3, outputVolumeM3: t.output_m3, multiplier: t.crv,
      parameterVersion: 'demo-v1', parameterSource: 'SIMULADA', parameterValidFrom: '2026-01-01', assessmentDate: t.occurred_at.slice(0, 10),
    });
    expect(assessment.result).toBe(t.expected_result);
  });

  it('A demonstra 10→3 e LT-204 preserva a anomalia 10→5', () => {
    expect(fixtures[0]!.data.transformation).toMatchObject({ input_m3: '10.000000', output_m3: '3.000000', expected_result: 'PASSOU' });
    expect(fixtures[1]!.data.origin?.code).toBe('LT-204');
    expect(fixtures[1]!.data.transformation).toMatchObject({ input_m3: '10.000000', output_m3: '5.000000', expected_result: 'ALERTA' });
  });

  it('C conserva 1,8/1,2 medidos e a variante não esconde a fração desconhecida positiva', () => {
    const known = fixtures[2]!.data.output!;
    const result = allocateProvenance(known.volume_m3, known.allocations);
    expect(result.allocations.map(a => a.fraction)).toEqual(['0.6', '0.4']);
    expect(known.allocations.map(a => a.fraction)).toEqual(['0.6', '0.4']);
    const unknown = fixtures[3]!.data.output!;
    expect(allocateProvenance(unknown.volume_m3, unknown.allocations)).toMatchObject({ result: 'ALERTA', unknown_volume_m3: '0.001', evidence_incomplete: true });
    expect(unknown.allocations.map(a => a.fraction)).toEqual(['0.999666666667', '0.000333333333']);
  });
});
