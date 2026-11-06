import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { prisma } from '../db.js';

export function registerOriginLotReadRoutes(app: FastifyInstance) {
  app.get('/api/v1/origin-lots', async request => ({
    origin_lots: await prisma.originLot.findMany({ where: { organization_id: request.authUser!.organization_id }, include: { permits: true }, orderBy: { created_at: 'desc' } }),
  }));
  app.get<{ Params: { id: string } }>('/api/v1/origin-lots/:id', { schema: { params: Type.Object({ id: Type.String({ format: 'uuid' }) }, { additionalProperties: false }) } }, async (request, reply) => {
    const actor = request.authUser!;
    const lot = await prisma.originLot.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id }, include: { permits: true, plot: true } });
    if (!lot) return reply.code(404).send({ error: { code: 'ORIGIN_LOT_NOT_FOUND', message: 'Lote não encontrado nesta organização.', request_id: request.id } });
    const balance = await prisma.balance.findUnique({ where: { lot_id_organization_id: { lot_id: lot.id, organization_id: actor.organization_id } } });
    return { origin_lot: lot, balance };
  });
}
