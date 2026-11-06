import type { FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import { prisma } from '../db.js';

const params = Type.Object({ id: Type.String({ format: 'uuid' }) }, { additionalProperties: false });

/** Private registration reads are scoped to the authenticated organization. */
export function registerPlotReadRoutes(app: FastifyInstance) {
  app.get('/api/v1/plots', async request => ({
    plots: await prisma.plot.findMany({ where: { organization_id: request.authUser!.organization_id }, orderBy: { created_at: 'desc' } }),
  }));
  app.get<{ Params: { id: string } }>('/api/v1/plots/:id', { schema: { params } }, async (request, reply) => {
    const plot = await prisma.plot.findFirst({ where: { id: request.params.id, organization_id: request.authUser!.organization_id } });
    if (!plot) return reply.code(404).send({ error: { code: 'PLOT_NOT_FOUND', message: 'Parcela não encontrada nesta organização.', request_id: request.id } });
    return { plot };
  });
}
