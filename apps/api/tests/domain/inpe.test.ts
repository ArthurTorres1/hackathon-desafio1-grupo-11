import { describe, it, expect } from 'vitest';
import { searchInpe, validateImageryInput } from '../../src/services/inpe.js';
const geometry = { type: 'Polygon' as const, coordinates: [[[-60, -3], [-59.99, -3], [-59.99, -2.99], [-60, -2.99], [-60, -3]]] };
const input = { geometry, datetime: '2026-01-01T00:00:00Z/2026-11-01T00:00:00Z' };
describe('INPE adapter', () => {
    it('binds provider pagination to original filters for both GET and POST', async () => {
        for (const method of ['GET', 'POST'] as const) {
            let capturedUrl = '', capturedBody: any;
            await searchInpe(input, [-60,-3,-59.99,-2.99], async (url, options) => {
                capturedUrl = url; capturedBody = options?.body;
                return { status: 200, body: { features: [] } };
            }, { url: 'https://data.inpe.br/bdc/stac/v1/search?datetime=2000-01-01&collections=OTHER&page=2', method, body: { datetime: '2000-01-01', collections: ['OTHER'], limit: 999 } });
            if (method === 'GET') {
                const url = new URL(capturedUrl);
                expect(url.searchParams.get('datetime')).toBe(input.datetime);
                expect(url.searchParams.get('collections')).toBe('S2-16D-2');
                expect(url.searchParams.get('limit')).toBe('20');
            } else expect(capturedBody).toMatchObject({ datetime: input.datetime, collections: ['S2-16D-2'], limit: 20, intersects: geometry });
        }
    });
    it('accepts polygon/multipolygon and rejects reversed/excessive intervals and vertices', () => {
        expect(validateImageryInput(input)).toEqual([-60, -3, -59.99, -2.99]);
        expect(validateImageryInput({ ...input, geometry: { type: 'MultiPolygon', coordinates: [geometry.coordinates] } })).toEqual([-60, -3, -59.99, -2.99]);
        for (const datetime of ['2026-11-01/2026-01-01', '2000-01-01/2026-01-01'])
            expect(() => validateImageryInput({ ...input, datetime })).toThrow();
        expect(() => validateImageryInput({ ...input, geometry: { type: 'Polygon', coordinates: [Array.from({ length: 1001 }, () => [-60, -3])] } })).toThrow();
    });
    it('distinguishes empty success, provider failure and unsupported assets', async () => {
        expect((await searchInpe(input, [-60, -3, -59.99, -2.99], async () => ({ status: 200, body: { features: [] } }))).scenes).toEqual([]);
        await expect(searchInpe(input, [-60, -3, -59.99, -2.99], async () => ({ status: 503, body: {} }))).rejects.toMatchObject({ statusCode: 503 });
        const result = await searchInpe(input, [-60, -3, -59.99, -2.99], async () => ({ status: 200, body: { features: [{ id: 'x', collection: 'S2-16D-2', geometry, bbox: [-60, -3, -59.99, -2.99], properties: { start_datetime: '2026-10-16', end_datetime: '2026-10-31' }, assets: { thumbnail: { href: 'https://example.org/image.png' } } }], links: [{ rel: 'next', href: 'https://data.inpe.br/bdc/stac/v1/search?page=2' }] } }));
        expect(result.scenes[0]?.scene).toMatchObject({ renderable: false, render_url: null, preview_url: null, cloud_cover: null, datetime: null, start_datetime: '2026-10-16' });
        expect(result.nextRequest?.url).toContain('page=2');
    });
});
