import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
vi.mock('../../src/db.js', () => ({ prisma: { $queryRaw: query } }));
import { buildServer } from '../../src/app.js';

let app: Awaited<ReturnType<typeof buildServer>>;
beforeAll(async () => { app = await buildServer(); });
afterAll(async () => { await app.close(); });

describe('saúde das dependências de persistência', () => {
  it('retorna 200 após consultar a extensão PostGIS', async () => {
    query.mockResolvedValueOnce([{ postgis_version: '3.5' }]);
    const response = await app.inject({ url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', database: 'ok', postgis: 'ok' });
    expect(query.mock.calls.at(-1)![0].join('')).toBe('SELECT PostGIS_Version()');
  });

  it('retorna 503 sem expor credenciais quando banco ou extensão falha', async () => {
    query.mockRejectedValueOnce(new Error('postgresql://owner:secret@database/internal'));
    const response = await app.inject({ url: '/health' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', service: 'foresttrace-api', database: 'unavailable' });
    expect(response.body).not.toContain('secret');
  });
});
