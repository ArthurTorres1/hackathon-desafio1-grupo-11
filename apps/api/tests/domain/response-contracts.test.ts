import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { Type } from '@sinclair/typebox';
import { registerResponseContracts } from '../../src/services/response-contracts.js';

describe('validação de respostas antes da serialização HTTP', () => {
  it('preserva erro R01 com campos e diagnóstico estruturado em 422', async () => {
    const app = Fastify();
    registerResponseContracts(app);
    const payload = { error: { code: 'INVALID_GEOJSON', message: 'Anel não fechado.', fields: ['geometry'], request_id: 'isolated-r01' },
      checks: [{ rule_id: 'R01', status: 'ALERTA', errors: ['Anel não fechado.'] }] };
    app.post('/api/v1/plots', async (_request, reply) => reply.code(422).send(payload));
    try {
      const response = await app.inject({ method: 'POST', url: '/api/v1/plots' });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual(payload);
    } finally { await app.close(); }
  });

  it('rejeita resposta incompatível sem expor os valores privados', async () => {
    const app = Fastify();
    app.setErrorHandler((_error, request, reply) => reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Erro interno.', request_id: request.id } }));
    registerResponseContracts(app);
    app.get('/api/v1/test-response', { schema: { response: { 200: Type.Object({ volume_m3: Type.String() }, { additionalProperties: false }) } } }, async () => ({ volume_m3: 10, private_secret: 'never-serialize-private-marker' }));
    try {
      const response = await app.inject({ url: '/api/v1/test-response' });
      expect(response.statusCode).toBe(500);
      expect(response.json().error.code).toBe('INTERNAL_ERROR');
      expect(response.body).not.toContain('never-serialize-private-marker');
    } finally { await app.close(); }
  });

  it('valida o JSON efetivo de datas e decimais sem converter volume para number', async () => {
    const app = Fastify();
    registerResponseContracts(app);
    app.get('/api/v1/test-response', { schema: { response: { 200: Type.Object({ volume_m3: Type.String(), occurred_at: Type.String({ format: 'date-time' }) }) } } }, async () => ({ volume_m3: { toJSON: () => '0.000001' }, occurred_at: new Date('2026-11-06T00:00:00Z') }));
    try {
      const response = await app.inject({ url: '/api/v1/test-response' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ volume_m3: '0.000001', occurred_at: '2026-11-06T00:00:00.000Z' });
    } finally { await app.close(); }
  });

  it('adiciona contratos para sucessos e erros das rotas centrais', async () => {
    const app = Fastify();
    let schema: Record<string, unknown> | undefined;
    registerResponseContracts(app);
    app.addHook('onRoute', route => { if (route.url === '/api/v1/plots') schema = route.schema?.response as Record<string, unknown>; });
    app.post('/api/v1/plots', async () => ({}));
    try {
      await app.ready();
      expect(schema?.['201']).toBeDefined();
      expect(schema?.['4xx']).toBeDefined();
      expect(schema?.['5xx']).toBeDefined();
    } finally { await app.close(); }
  });
});
