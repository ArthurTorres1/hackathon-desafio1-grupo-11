import type { FastifyInstance } from 'fastify';
import { Value } from '@sinclair/typebox/value';
import { ForestUtilizationInputSchema, ForestUtilizationResponseSchema, type ForestUtilizationRequest } from '@foresttrace/contracts';
import { calculateForestUtilization } from './forest-utilization.js';

/** A pure demonstrative report; never invokes operational persistence. */
export function registerForestUtilizationRoutes(app: FastifyInstance) {
  app.post<{ Body: ForestUtilizationRequest }>('/api/v1/calculations/forest-utilization', {
    preValidation: async (request, reply) => {
      if (!Value.Check(ForestUtilizationInputSchema, request.body)) {
        return reply.code(422).send({ error: { code: 'FOREST_UTILIZATION_INVALID_INPUT', message: 'Informe decimais em texto, perfil demonstrativo conhecido e somente os campos previstos.', request_id: request.id } });
      }
    },
    schema: {
      tags: ['Calculadora demonstrativa'],
      summary: 'Calcula cubagem e aproveitamento sem alterar operações ou prontidão',
      body: ForestUtilizationInputSchema, response: { 200: ForestUtilizationResponseSchema },
    },
  }, async request => {
    const report = calculateForestUtilization(request.body);
    if (!Value.Check(ForestUtilizationResponseSchema, report)) {
      throw new Error('Resposta de cálculo incompatível com o contrato.');
    }
    return report;
  });
}
