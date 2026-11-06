import { ImageryGeometrySchema, type ImageryScene, type ImagerySearch } from '@foresttrace/contracts';
import { Value } from '@sinclair/typebox/value';
import { sha256Canonical } from './integrity.js';
import { assertInpeUrl, safeInpeJson } from './inpe-transport.js';
export const INPE_ADAPTER_VERSION = 'bdc-s2-16d-2-rgb-v1';
export const INPE_SEARCH_URL = 'https://data.inpe.br/bdc/stac/v1/search';
export type StoredScene = {
    scene: ImageryScene;
    assets: Record<'B04' | 'B03' | 'B02', string> | null;
};
export const imageryError = (code: string, message: string, statusCode = 422) => Object.assign(new Error(message), { code, statusCode });
const obj = (x: unknown): Record<string, any> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, any> : {};
export function validateImageryInput(input: ImagerySearch) {
    const pieces = input.datetime.split('/');
    const start = Date.parse(pieces[0] ?? '');
    const end = Date.parse(pieces[1] ?? '');
    const maximum = new Date(start);
    maximum.setUTCFullYear(maximum.getUTCFullYear() + 5);
    if (pieces.length !== 2 || !pieces.every(p => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(p)) || !Number.isFinite(start) || !Number.isFinite(end) || end < start || end > maximum.getTime())
        throw imageryError('IMAGERY_PERIOD_INVALID', 'Informe intervalo crescente de até cinco anos.');
    const polygons = input.geometry.type === 'Polygon' ? [input.geometry.coordinates] : input.geometry.coordinates;
    let count = 0;
    const positions: number[][] = [];
    for (const polygon of polygons)
        for (const ring of polygon) {
            count += ring.length;
            if (count > 1000)
                throw imageryError('IMAGERY_VERTEX_LIMIT', 'Máximo de mil vértices por consulta.');
            if (ring.length < 4 || JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)))
                throw imageryError('IMAGERY_GEOMETRY_INVALID', 'Anel inválido ou não fechado.');
            for (const p of ring) {
                if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]!) > 180 || Math.abs(p[1]!) > 85)
                    throw imageryError('IMAGERY_GEOMETRY_INVALID', 'Coordenadas fora dos limites WGS84 do mapa.');
                positions.push(p);
            }
        }
    return [Math.min(...positions.map(p => p[0]!)), Math.min(...positions.map(p => p[1]!)), Math.max(...positions.map(p => p[0]!)), Math.max(...positions.map(p => p[1]!))] as [
        number,
        number,
        number,
        number
    ];
}
export type CatalogTransport = typeof safeInpeJson;
export async function searchInpe(input: ImagerySearch, bbox: [
    number,
    number,
    number,
    number
], transport: CatalogTransport = safeInpeJson, next?: {
    url: string;
    method: 'GET' | 'POST';
    body?: unknown;
}) {
    const fixedFilters = { intersects: input.geometry, datetime: input.datetime, collections: input.collection_ids ?? ['S2-16D-2'], limit: 20 };
    const request = next ? { ...next, ...(next.method === 'POST' ? { body: { ...obj(next.body), ...fixedFilters } } : {}) } : { url: INPE_SEARCH_URL, method: 'POST' as const, body: fixedFilters };
    if (next?.method === 'GET') {
        const url = assertInpeUrl(request.url, 'catalog');
        for (const key of ['bbox', 'filter', 'filter-lang']) url.searchParams.delete(key);
        url.searchParams.set('intersects', JSON.stringify(input.geometry));
        url.searchParams.set('datetime', input.datetime);
        url.searchParams.set('collections', fixedFilters.collections.join(','));
        url.searchParams.set('limit', '20');
        request.url = url.href;
    }
    if (next?.method === 'POST') {
        const url = assertInpeUrl(request.url, 'catalog');
        for (const key of ['intersects', 'bbox', 'filter', 'filter-lang', 'datetime', 'collections', 'limit']) url.searchParams.delete(key);
        request.url = url.href;
    }
    assertInpeUrl(request.url, 'catalog');
    const response = await transport(request.url, { method: request.method, body: request.body });
    if (response.status !== 200)
        throw imageryError('INPE_UNAVAILABLE', 'Catálogo INPE indisponível.', 503);
    const body = obj(response.body);
    if (!Array.isArray(body.features) || body.features.length > 20)
        throw imageryError('INPE_RESPONSE_INVALID', 'Resposta STAC inválida ou excessiva.', 503);
    const scenes: StoredScene[] = [];
    for (const raw of body.features) {
        const item = obj(raw), p = obj(item.properties), b = item.bbox;
        if (typeof item.id !== 'string' || item.id.length > 300 || item.collection !== 'S2-16D-2' || !Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || !Value.Check(ImageryGeometrySchema, item.geometry))
            continue;
        if (b[2] < bbox[0] || b[0] > bbox[2] || b[3] < bbox[1] || b[1] > bbox[3])
            continue;
        let assets: StoredScene['assets'] = null;
        try {
            assets = Object.fromEntries(['B04', 'B03', 'B02'].map(key => [key, assertInpeUrl(obj(obj(item.assets)[key]).href, 'asset').href])) as NonNullable<StoredScene['assets']>;
        }
        catch { /* Unsupported assets remain metadata only. */ }
        const str = (x: unknown) => typeof x === 'string' ? x : null;
        const scene: ImageryScene = { scene_key: sha256Canonical({ collection: item.collection, id: item.id }), collection_id: item.collection, item_id: item.id,
            datetime: str(p.datetime), start_datetime: str(p.start_datetime), end_datetime: str(p.end_datetime), footprint: item.geometry, bbox: b.slice(0, 4) as [
                number,
                number,
                number,
                number
            ],
            cloud_cover: typeof p['eo:cloud_cover'] === 'number' && p['eo:cloud_cover'] >= 0 && p['eo:cloud_cover'] <= 100 ? p['eo:cloud_cover'] : null,
            platform: str(p.platform), instruments: Array.isArray(p.instruments) ? p.instruments.filter((x: unknown) => typeof x === 'string') : [], license: str(p.license) ?? 'proprietary',
            attribution: 'INPE / Brazil Data Cube — Sentinel-2, composição de 16 dias', renderable: !!assets, render_bounds: assets ? [[bbox[0], bbox[1]], [bbox[2], bbox[3]]] : null,
            render_url: null, preview_url: null, limitations: ['Imagem não comprova autorização, origem ou ausência de desmatamento.', 'Cena intersectante pode cobrir apenas parte da parcela.', ...(!assets ? ['SEM_VISUALIZACAO: bandas RGB incompatíveis.'] : [])] };
        scenes.push({ scene, assets });
    }
    scenes.sort((a, b) => (b.scene.datetime ?? b.scene.start_datetime ?? '').localeCompare(a.scene.datetime ?? a.scene.start_datetime ?? ''));
    const link = Array.isArray(body.links) ? body.links.find((x: any) => x?.rel === 'next') : undefined;
    let nextRequest: typeof next = null as unknown as undefined;
    if (link) {
        const url = assertInpeUrl(new URL(link.href, INPE_SEARCH_URL), 'catalog').href;
        if (link.method && !['GET', 'POST'].includes(link.method))
            throw imageryError('INPE_RESPONSE_INVALID', 'Paginação STAC incompatível.', 503);
        nextRequest = { url, method: link.method ?? 'GET', ...(link.body ? { body: link.body } : {}) };
    }
    return { scenes, nextRequest };
}
