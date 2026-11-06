import { sha256Canonical } from './integrity.js';

/**
 * Resolves the upstream custody graph for a product lot. The graph is assembled
 * from persisted relationships (not the passport's display payload), so a broken
 * reference cannot silently become an apparently complete ancestry.
 */
export type AncestryDb = {
  productLot: { findUnique(args: unknown): Promise<any>; findMany?(args: unknown): Promise<any[]> };
  originLot: { findUnique(args: unknown): Promise<any> };
  shipmentItem: { findMany(args: unknown): Promise<any[]> };
  shipment: { findMany(args: unknown): Promise<any[]> };
  auditCase?: { findMany(args: unknown): Promise<any[]> };
  conversionException?: { findMany(args: unknown): Promise<any[]> };
  sourceQuery?: { findMany(args: unknown): Promise<any[]> };
  harvest?: { findMany(args: unknown): Promise<any[]> };
  document?: { findMany(args: unknown): Promise<any[]> };
};

export type ProductAncestry = {
  product_lot_ids: string[];
  products: any[];
  origin_lots: any[];
  transformations: any[];
  shipments: any[];
  plots: any[];
  harvests: any[];
  source_queries: any[];
  documents: any[];
  document_ids: string[];
  nodes: Array<{ type: 'PRODUCT_LOT' | 'ORIGIN_LOT'; id: string; code: string }>;
};

export function plotGeometrySha(plot: { geometry: unknown }): string {
  return sha256Canonical(plot.geometry);
}

function missing(kind: string, id: string): Error & { code: string } {
  return Object.assign(new Error(`Vínculo de ancestral ausente: ${kind} ${id}.`), { code: 'ANCESTRY_LINK_MISSING' });
}

/** Resolve product → transformation inputs → product/origin lots recursively. */
export async function loadProductAncestry(db: AncestryDb, productLotId: string): Promise<ProductAncestry> {
  const products = new Map<string, any>();
  const origins = new Map<string, any>();
  const transformations = new Map<string, any>();
  const plots = new Map<string, any>();
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const walk = async (lotId: string): Promise<void> => {
    const key = `lot:${lotId}`;
    if (visiting.has(key)) throw Object.assign(new Error(`Ciclo detectado na ancestralidade do lote ${lotId}.`), { code: 'ANCESTRY_CYCLE' });
    if (visited.has(key)) return;
    visiting.add(key);

    const product = await db.productLot.findUnique({ where: { id: lotId }, include: { transformation: { include: { inputs: true } } } });
    if (product) {
      products.set(product.id, product);
      const transformation = product.transformation;
      if (!transformation || !transformation.id) throw missing('TRANSFORMATION', product.transformation_id);
      if (!Array.isArray(transformation.inputs) || transformation.inputs.length === 0) throw missing('TRANSFORMATION_INPUT', transformation.id);
      if (!transformation.outputs && db.productLot.findMany) transformation.outputs = await db.productLot.findMany({ where: { transformation_id: transformation.id } });
      transformations.set(transformation.id, transformation);
      for (const input of transformation.inputs) {
        if (!input.lot_id) throw missing('LOT', String(input.lot_id));
        const upstreamProduct = await db.productLot.findUnique({ where: { id: input.lot_id }, select: { id: true } });
        if (upstreamProduct) {
          await walk(input.lot_id);
          continue;
        }
        const origin = await db.originLot.findUnique({ where: { id: input.lot_id }, include: { plot: true, permits: true } });
        if (!origin || !origin.plot) throw missing(origin ? 'PLOT' : 'LOT', input.lot_id);
        origins.set(origin.id, origin);
        plots.set(origin.plot.id, origin.plot);
      }
    } else {
      const origin = await db.originLot.findUnique({ where: { id: lotId }, include: { plot: true, permits: true } });
      if (!origin || !origin.plot) throw missing(origin ? 'PLOT' : 'LOT', lotId);
      origins.set(origin.id, origin);
      plots.set(origin.plot.id, origin.plot);
    }
    visiting.delete(key);
    visited.add(key);
  };

  await walk(productLotId);
  const lotIds = [...products.keys(), ...origins.keys()];
  const shipmentItems = await db.shipmentItem.findMany({ where: { lot_id: { in: lotIds } }, include: { shipment: true } });
  const shipments = new Map<string, any>();
  for (const item of shipmentItems) {
    if (!item.shipment) throw missing('SHIPMENT', item.shipment_id);
    shipments.set(item.shipment.id, item.shipment);
  }
  // Include shipments even if an adapter does not support relation includes.
  if (shipments.size === 0 && lotIds.length) {
    for (const shipment of await db.shipment.findMany({ where: { items: { some: { lot_id: { in: lotIds } } } }, include: { items: true } })) shipments.set(shipment.id, shipment);
  } else if (shipments.size) {
    const fullShipments = await db.shipment.findMany({ where: { id: { in: [...shipments.keys()] } }, include: { items: true } });
    for (const shipment of fullShipments) shipments.set(shipment.id, shipment);
  }
  const documentIds = new Set<string>();
  for (const origin of origins.values()) for (const permit of origin.permits ?? []) if (permit.document_id) documentIds.add(permit.document_id);
  for (const shipment of shipments.values()) for (const id of shipment.document_ids ?? []) documentIds.add(id);
  // Harvest evidence is part of the originating lot's support.
  const harvests = db.harvest ? await db.harvest.findMany({ where: { origin_lot_id: { in: [...origins.keys()] } } }) : [];
  for (const harvest of harvests) {
    for (const id of harvest.document_ids ?? []) documentIds.add(id);
  }
  const sourceQueries = db.sourceQuery ? await db.sourceQuery.findMany({ where: { lot_id: { in: [...origins.keys(), ...products.keys()] } } }) : [];
  const entityIds = [...new Set([...products.keys(), ...origins.keys(), ...transformations.keys(), ...shipments.keys()])];
  if (db.auditCase) {
    const cases = await db.auditCase.findMany({ where: { entity_id: { in: entityIds } }, include: { decisions: true } });
    const exceptionIds = new Set<string>();
    for (const auditCase of cases) for (const decision of auditCase.decisions ?? []) {
      for (const id of decision.evidence_ids ?? []) documentIds.add(id);
      if (decision.conversion_exception_id) exceptionIds.add(decision.conversion_exception_id);
    }
    if (db.conversionException && exceptionIds.size) {
      const exceptions = await db.conversionException.findMany({ where: { id: { in: [...exceptionIds] } } });
      for (const exception of exceptions) if (exception.document_id) documentIds.add(exception.document_id);
    }
  }
  const documents = db.document ? await db.document.findMany({ where: { id: { in: [...documentIds] } } }) : [];

  const nodes = [
    ...[...origins.values()].map((item) => ({ type: 'ORIGIN_LOT' as const, id: item.id, code: item.code })),
    ...[...products.values()].map((item) => ({ type: 'PRODUCT_LOT' as const, id: item.id, code: item.code })),
  ];
  return {
    product_lot_ids: [...products.keys()], products: [...products.values()], origin_lots: [...origins.values()],
    transformations: [...transformations.values()], shipments: [...shipments.values()], plots: [...plots.values()], harvests, source_queries: sourceQueries, documents,
    document_ids: [...documentIds], nodes,
  };
}

