import { Decimal } from 'decimal.js';

export interface AllocationInput { origin_lot_id: string | null; volume_m3: string }
export interface MeasuredAllocation extends AllocationInput { fraction: string }
const VOLUME_PATTERN = /^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$/;
export function allocateProvenance(outputVolume: string, allocations: AllocationInput[]) {
  if (!VOLUME_PATTERN.test(outputVolume)) throw new Error('Saída deve ter no máximo seis casas decimais.');
  const total = new Decimal(outputVolume);
  if (!total.isFinite() || total.lte(0) || allocations.length === 0) throw new Error('Saída e atribuições devem ser positivas.');
  const rows = allocations.map((a) => {
    if (!VOLUME_PATTERN.test(a.volume_m3)) throw new Error('Atribuição deve ter no máximo seis casas decimais.');
    const amount = new Decimal(a.volume_m3);
    if (!amount.isFinite() || amount.lte(0)) throw new Error('Cada atribuição deve ter volume positivo.');
    return { origin_lot_id: a.origin_lot_id, volume_m3: amount, fraction: amount.div(total) };
  });
  const sum = rows.reduce((acc, row) => acc.plus(row.volume_m3), new Decimal(0));
  if (!sum.eq(total)) throw new Error(`Atribuições (${sum.toFixed()}) devem somar exatamente à saída (${total.toFixed()}).`);
  const unknown = rows.filter((a) => a.origin_lot_id === null).reduce((acc, a) => acc.plus(a.volume_m3), new Decimal(0));
  return {
    allocations: rows.map((a): MeasuredAllocation => ({ origin_lot_id: a.origin_lot_id, volume_m3: a.volume_m3.toFixed(), fraction: a.fraction.toDecimalPlaces(12).toFixed() })),
    unknown_volume_m3: unknown.toFixed(), rule_code: 'R11' as const,
    result: unknown.gt(0) ? 'ALERTA' as const : 'PASSOU' as const,
    evidence_incomplete: unknown.gt(0),
  };
}

export function mixProvenance(outputs: Array<{ volume_m3: string; allocations: AllocationInput[] }>) {
  return outputs.map((output) => allocateProvenance(output.volume_m3, output.allocations));
}
