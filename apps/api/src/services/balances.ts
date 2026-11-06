import { Decimal } from 'decimal.js';
import type { Prisma } from '@prisma/client';

/** Fixed policy: changing it requires a new version; every receipt records the policy and actor. */
export const RECEIPT_POLICY = Object.freeze({ version: 'receipt-zero-v1', tolerance_m3: '0' });

export function assertDistinctLots(items: Array<{ lot_id: string }>) {
  if (new Set(items.map(item => item.lot_id)).size !== items.length) {
    throw Object.assign(new Error('Informe cada lote uma única vez.'), { statusCode: 422, code: 'DUPLICATE_LOT' });
  }
}

/** Acquire row locks in stable UUID order inside the same domain transaction. */
export async function lockBalances(tx: Prisma.TransactionClient, organizationId: string, lotIds: string[]) {
  for (const lotId of [...new Set(lotIds)].sort()) {
    await tx.$queryRaw`SELECT id FROM balances WHERE organization_id = ${organizationId}::uuid AND lot_id = ${lotId}::uuid FOR UPDATE`;
  }
}

export async function debitAvailable(
  tx: Prisma.TransactionClient, organizationId: string, lotId: string, volume: string, reserve = false,
) {
  const amount = new Decimal(volume);
  if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 6) {
    throw Object.assign(new Error('Volume deve ser positivo com até seis casas decimais.'), { statusCode: 422, code: 'VOLUME_INVALID' });
  }
  const result = await tx.balance.updateMany({
    where: { organization_id: organizationId, lot_id: lotId, available_m3: { gte: amount.toFixed() } },
    data: { available_m3: { decrement: amount.toFixed() }, ...(reserve ? { reserved_m3: { increment: amount.toFixed() } } : {}) },
  });
  if (result.count !== 1) throw Object.assign(new Error('Saldo disponível insuficiente.'), { statusCode: 409, code: 'R08' });
}
