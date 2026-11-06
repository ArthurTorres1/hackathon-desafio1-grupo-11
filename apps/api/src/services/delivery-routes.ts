import type { FastifyInstance } from 'fastify';
import { Decimal } from 'decimal.js';
import { SaleCreateSchema, ProductTraceParamsSchema, type SaleCreate } from '@foresttrace/contracts';
import { prisma } from '../db.js';
import { executeIdempotent } from './idempotency.js';
import { debitAvailable, lockBalances } from './balances.js';
import { appendAuditEvent } from './audit-events.js';
import { loadProductAncestry } from './ancestry.js';
import { latestChecks, containsSimulatedEvidence } from './review-readiness.js';
import { readDocument } from './document-storage.js';
import { sha256Bytes } from './integrity.js';
import { effectiveReviewedChecks } from './contextual-review.js';

function fail(code: string, message: string, statusCode = 422): never { throw Object.assign(new Error(message), { code, statusCode }); }
const ensureRole = (roles: string[]) => { if (!roles.some(role => ['OPERATOR','AUDITOR','REGULATOR'].includes(role))) fail('R20', 'Perfil sem acesso à operação.', 403); };
const ancestryIds = (ancestry: Awaited<ReturnType<typeof loadProductAncestry>>) => [...new Set([
  ...ancestry.product_lot_ids, ...ancestry.origin_lots.map(lot => lot.id), ...ancestry.plots.map(plot => plot.id),
  ...ancestry.transformations.map(operation => operation.id), ...ancestry.shipments.map(shipment => shipment.id),
])];

export function registerDeliveryRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/v1/audit-cases/:id', { schema: { params: ProductTraceParamsSchema } }, async (request, reply) => {
    const actor = request.authUser!; ensureRole(actor.roles);
    const auditCase = await prisma.auditCase.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id }, include: { decisions: { orderBy: { created_at: 'asc' } } } });
    if (!auditCase) return reply.code(404).send({ error: { code: 'CASE_NOT_FOUND', message: 'Caso não encontrado neste escopo.', request_id: request.id } });
    const original = await prisma.check.findUniqueOrThrow({ where: { id: auditCase.check_id } });
    const [effective] = await effectiveReviewedChecks(prisma, [original]);
    const ids = [...new Set(auditCase.decisions.flatMap(decision => decision.evidence_ids))];
    const documents = await prisma.document.findMany({ where: { id: { in: ids }, OR: [{ organization_id: actor.organization_id }, { allowed_organization_ids: { has: actor.organization_id } }] }, select: { id: true, name: true, type: true, content_hash: true, data_provenance: true, created_by_user_id: true } });
    return { audit_case: auditCase, original_check: original, effective_check: effective, documents,
      limitations: ['Resolução contextual não apaga o sinal original e deixa de valer quando o contexto ou a evidência muda.'] };
  });
  app.get<{ Params: { id: string } }>('/api/v1/product-lots/:id/trace', { schema: { params: ProductTraceParamsSchema } }, async (request, reply) => {
    const started = performance.now(); const actor = request.authUser!; ensureRole(actor.roles);
    const lot = await prisma.productLot.findUnique({ where: { id: request.params.id } });
    const custody = lot ? await prisma.balance.findUnique({ where: { lot_id_organization_id: { lot_id: lot.id, organization_id: actor.organization_id } } }) : null;
    if (!lot || lot.organization_id !== actor.organization_id && !custody) return reply.code(404).send({ error: { code: 'PRODUCT_LOT_NOT_FOUND', message: 'Lote não encontrado neste escopo.', request_id: request.id } });
    const [ancestry, provenance] = await Promise.all([loadProductAncestry(prisma, lot.id), prisma.lotProvenance.findMany({ where: { product_lot_id: lot.id } })]);
    const total = new Decimal(lot.volume_m3.toString());
    const unknown = provenance.filter(row => row.origin_lot_id === null).reduce((sum, row) => sum.plus(row.volume_m3.toString()), new Decimal(0));
    const attributed = provenance.reduce((sum, row) => sum.plus(row.volume_m3.toString()), new Decimal(0));
    const known = provenance.filter(row => row.origin_lot_id !== null).reduce((sum, row) => sum.plus(row.volume_m3.toString()), new Decimal(0));
    const incomplete = !attributed.eq(total) || unknown.gt(0);
    return { product_lot: lot, provenance, ancestry: { plots: ancestry.plots, origin_lots: ancestry.origin_lots,
      transformations: ancestry.transformations, shipments: ancestry.shipments, nodes: ancestry.nodes },
      metrics: { known_volume_m3: known.toFixed(), unknown_volume_m3: unknown.plus(Decimal.max(0, total.minus(attributed))).toFixed(),
        total_volume_m3: total.toFixed(), tracked_fraction: total.gt(0) ? known.div(total).toFixed() : '0',
        provenance_status: incomplete ? 'EVIDENCIA_INCOMPLETA' : 'ATRIBUIDA', generated_at: new Date().toISOString(), duration_ms: Math.round(performance.now() - started) },
      limitations: ['Atribuição documental não comprova mistura física.', 'Consulta privada não significa aprovação normativa.'] };
  });

  app.get('/api/v1/sales', async request => {
    const actor = request.authUser!;
    if (!actor.roles.some(role => ['OPERATOR','AUDITOR','REGULATOR','BUYER'].includes(role))) fail('R20', 'Perfil sem acesso à consulta comercial.', 403);
    return { sales: await prisma.sale.findMany({ where: { OR: [{ seller_id: actor.organization_id }, { buyer_id: actor.organization_id }] }, orderBy: { occurred_at: 'desc' } }) };
  });

  app.post<{ Body: SaleCreate }>('/api/v1/sales', { schema: { body: SaleCreateSchema } }, async (request, reply) => {
    const actor = request.authUser!; ensureRole(actor.roles); const body = request.body;
    if (body.seller_organization_id !== actor.organization_id) fail('R20', 'Vendedor deve corresponder à organização autenticada.', 403);
    const result = await executeIdempotent(prisma, { actorId: actor.id, operation: 'POST /api/v1/sales', key: request.idempotencyKey!, payload: body }, async tx => {
      const lot = await tx.productLot.findFirst({ where: { id: body.product_lot_id, organization_id: actor.organization_id } });
      if (!lot) fail('PRODUCT_LOT_NOT_FOUND', 'Produto não encontrado neste escopo.', 404);
      const operation = await tx.transformation.findUniqueOrThrow({ where: { id: lot.transformation_id } });
      if (new Date(body.occurred_at) < operation.occurred_at) fail('R06', 'A venda não pode anteceder a transformação do produto.');
      if (body.buyer_organization_id === actor.organization_id || !await tx.organization.findUnique({ where: { id: body.buyer_organization_id } })) fail('BUYER_INVALID', 'Informe organização compradora distinta e cadastrada.');
      if (new Decimal(body.volume_m3).gt(lot.volume_m3.toString())) fail('R08', 'Volume declarado supera o volume do produto.', 409);
      const document = await tx.document.findFirst({ where: { id: body.fiscal_document_id, organization_id: actor.organization_id } });
      if (!document || !['NFE','NF_E','INVOICE','SALE_INVOICE'].includes(document.type)) fail('FISCAL_DOCUMENT_REQUIRED', 'Vincule documento fiscal acessível; exemplos devem ser identificados como sintéticos.');
      const bytes = await readDocument(document.storage_key).catch(() => null);
      if (!bytes || sha256Bytes(bytes) !== document.content_hash) fail('R18', 'Documento fiscal ausente ou divergente.', 409);
      const ancestry = await loadProductAncestry(tx, lot.id); const ids = ancestryIds(ancestry);
      const [openCases, checks, provenanceRows] = await Promise.all([
        tx.auditCase.findMany({ where: { entity_id: { in: ids }, status: { in: ['ABERTO','EM_ANALISE','MANTIDO_PENDENTE'] } }, select: { id: true, rule_id: true } }),
        tx.check.findMany({ where: { entity_id: { in: ids } }, orderBy: { created_at: 'desc' } }),
        tx.lotProvenance.findMany({ where: { product_lot_id: { in: ancestry.product_lot_ids } } }),
      ]);
      const effectiveChecks = await effectiveReviewedChecks(tx, latestChecks(checks));
      const allocationMissing = ancestry.products.some(product => !provenanceRows.filter(row => row.product_lot_id === product.id).reduce((sum, row) => sum.plus(row.volume_m3.toString()), new Decimal(0)).eq(product.volume_m3.toString()));
      const contested = openCases.length > 0 || effectiveChecks.some(check => check.status === 'ALERTA') || provenanceRows.some(row => row.origin_lot_id === null) || allocationMissing;
      const pending = body.acknowledge_pending === true;
      if (!pending && contested) fail('SALE_BLOCKED_BY_REVIEW', 'Venda normal bloqueada por alerta ou origem desconhecida; registre somente declaração com ciência da pendência.', 409);
      if (!pending) { await lockBalances(tx, actor.organization_id, [lot.id]); await debitAvailable(tx, actor.organization_id, lot.id, body.volume_m3); }
      const sale = await tx.sale.create({ data: { seller_id: actor.organization_id, buyer_id: body.buyer_organization_id,
        product_lot_id: lot.id, volume_m3: body.volume_m3, document_id: document.id,
        status: pending ? 'EM_REVISAO' : 'CONFIRMED', occurred_at: new Date(body.occurred_at),
        pending_acknowledged: pending, created_by_user_id: actor.id,
      } });
      if (!pending) await tx.balanceMovement.create({ data: { lot_id: lot.id, organization_id: actor.organization_id, entity_type: 'SALE', entity_id: sale.id, action: 'SALE_CONSUME', volume_m3: body.volume_m3 } });
      await appendAuditEvent(tx, { streamId: lot.id, entityType: 'SALE', entityId: sale.id, type: pending ? 'SALE_DECLARED_PENDING' : 'SALE_CONFIRMED', actorId: actor.id,
        payload: { sale_id: sale.id, product_lot_id: lot.id, volume_m3: body.volume_m3, document_id: document.id, pending_acknowledged: pending, simulated_document: containsSimulatedEvidence(document.data_provenance) } });
      return { statusCode: 201, body: { sale, balance_moved: !pending, fiscal_document: { id: document.id, data_provenance: document.data_provenance, simulated: containsSimulatedEvidence(document.data_provenance) },
        limitations: ['Registro comercial não aprova a origem, o documento fiscal ou a prontidão do pacote.'] } };
    });
    return reply.code(result.statusCode).send(result.body);
  });
}
