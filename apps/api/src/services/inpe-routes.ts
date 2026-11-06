import { randomUUID, randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Prisma } from '@prisma/client';
import { Type } from '@sinclair/typebox';
import { ImageryCapabilitiesSchema, ImagerySearchSchema, ImageryFiltersSchema, ImagerySearchResponseSchema, ImageryReferenceCreateSchema, ImageryReferencesResponseSchema, ImagerySceneSchema, ImageryPlotParamsSchema, ImageryQuerySceneParamsSchema, type ImagerySearch } from '@foresttrace/contracts';
import { prisma } from '../db.js';
import { executeIdempotent } from './idempotency.js';
import { appendAuditEvent } from './audit-events.js';
import { sha256Canonical } from './integrity.js';
import { INPE_ADAPTER_VERSION, searchInpe, validateImageryInput, imageryError, type StoredScene } from './inpe.js';
import { renderInpeScene } from './inpe-render.js';
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
const publicScenes = (id: string, stored: StoredScene[]) => stored.map(({ scene }) => ({ ...scene, render_url: scene.renderable ? `/api/v1/imagery/queries/${id}/scenes/${scene.scene_key}/render` : null }));
const snapshot = (q: any) => q.snapshot as {
    scenes: StoredScene[];
    bbox: [
        number,
        number,
        number,
        number
    ];
};
export type ImageryRouteDependencies = {
    search: typeof searchInpe;
    render: typeof renderInpeScene;
    enabled: () => boolean;
    now: () => number;
};
let overrides: Partial<ImageryRouteDependencies> = {};
export function configureImageryForTests(value: Partial<ImageryRouteDependencies> = {}) { overrides = value; }
export async function registerImageryRoutes(app: FastifyInstance) {
    const rates = new Map<string, number[]>(), cache = new Map<string, {
        expires: number;
        png: Buffer;
    }>();
    let rendering = 0;
    const deps = () => ({ search: searchInpe, render: renderInpeScene, enabled: () => process.env.INPE_IMAGERY_ENABLED === 'true', now: Date.now, ...overrides });
    const enabled = () => { if (!deps().enabled())
        throw imageryError('IMAGERY_DISABLED', 'Integração INPE desabilitada.', 503); };
    const fail = (reply: any, request: any, error: any) => reply.code(error.statusCode ?? 503).send({ error: { code: error.code ?? 'INDISPONIVEL', message: error.statusCode && error.statusCode < 500 ? error.message : 'Imagens INPE indisponíveis; tente novamente.', request_id: request.id } });
    const safe = (handler: (request: any, reply: any) => Promise<any>) => async (request: any, reply: any) => { try {
        return await handler(request, reply);
    }
    catch (error) {
        return fail(reply, request, error);
    } };
    app.get('/api/v1/imagery/capabilities', { schema: { response: { 200: ImageryCapabilitiesSchema } } }, async () => ({ enabled: deps().enabled(), collection_ids: ['S2-16D-2'], limits: { max_area_ha: 10000, max_vertices: 1000, max_period_years: 5, max_scenes_per_page: 20, max_pages: 5, max_render_side: 1024 }, limitations: ['Referência visual privada; não altera Whisp ou prontidão.'] }));
    for (const plotMode of [false, true]) {
        app.post(plotMode ? '/api/v1/plots/:id/imagery/search' : '/api/v1/imagery/search', { schema: { ...(plotMode ? { params: ImageryPlotParamsSchema } : {}), body: plotMode ? ImageryFiltersSchema : ImagerySearchSchema, response: { 200: ImagerySearchResponseSchema } } }, safe(async (request, reply) => {
            enabled();
            const actor = request.authUser!;
            const organization_id = actor.organization_id;
            const plot = plotMode ? await prisma.plot.findFirst({ where: { id: request.params.id, organization_id } }) : null;
            if (plotMode && !plot)
                throw imageryError('PLOT_NOT_FOUND', 'Parcela não encontrada.', 404);
            const input = { ...request.body, ...(plot ? { geometry: plot.geometry } : {}) } as ImagerySearch;
            const idemPayload = { organization_id, plot_id: plot?.id ?? null, input };
            const previous = await prisma.idempotencyKey.findUnique({ where: { user_id_operation_key: { user_id: actor.id, operation: request.routeOptions.url, key: request.idempotencyKey! } } });
            if (previous) {
                if (previous.payload_hash !== sha256Canonical(idemPayload))
                    throw imageryError('R17', 'Chave de idempotência já utilizada com outro conteúdo.', 409);
                return reply.code(previous.status_code).send(typeof previous.response === 'string' ? JSON.parse(previous.response) : previous.response);
            }
            const bbox = validateImageryInput(input);
            const geometry_hash = sha256Canonical(input.geometry), filters = { datetime: input.datetime, collection_ids: input.collection_ids ?? ['S2-16D-2'] };
            const spatial = await prisma.$queryRaw<Array<{
                valid: boolean;
                area: number;
            }>> `SELECT ST_IsValid(g) valid, CASE WHEN ST_IsValid(g) THEN ST_Area(g::geography)/10000 ELSE 0 END area FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(input.geometry)}),4326) g) q`;
            if (!spatial[0]?.valid || spatial[0].area <= 0 || spatial[0].area > 10000)
                throw imageryError('IMAGERY_AREA_INVALID', 'Geometria inválida ou área superior a 10.000 ha.');
            let page = 1, next: Parameters<typeof searchInpe>[3];
            if (input.cursor) {
                const parent = await prisma.imageryQuery.findFirst({ where: { next_cursor: input.cursor, organization_id } });
                if (!parent || parent.geometry_hash !== geometry_hash || sha256Canonical(parent.filters) !== sha256Canonical(filters) || parent.plot_id !== (plot?.id ?? null) || parent.geometry_version !== (plot?.geometry_version ?? null) || parent.page >= 5)
                    throw imageryError('IMAGERY_CURSOR_INVALID', 'Cursor não pertence aos filtros ou à parcela.');
                page = parent.page + 1;
                next = parent.next_request as typeof next;
            }
            const request_hash = sha256Canonical({ organization_id, geometry_hash, filters, cursor: input.cursor ?? null, version: INPE_ADAPTER_VERSION, plot_id: plot?.id ?? null, geometry_version: plot?.geometry_version ?? null });
            const cached = await prisma.imageryQuery.findFirst({ where: { organization_id, request_hash, expires_at: { gt: new Date(deps().now()) }, status: { in: ['SUCESSO', 'SEM_IMAGENS'] } }, orderBy: { queried_at: 'desc' } });
            const response = (q: any, isCache: boolean) => ({ query_id: q.id, geometry_hash: q.geometry_hash, geometry_version: q.geometry_version, status: q.status, scenes: publicScenes(q.id, snapshot(q).scenes), next_cursor: q.next_cursor, queried_at: q.queried_at.toISOString(), cached: isCache, context_provenance: q.context_provenance, limitations: ['Ordenação por data limitada à página.', 'Consulta real não comprova origem da geometria.'] });
            if (cached) {
                const result = await executeIdempotent(prisma, { actorId: actor.id, operation: request.routeOptions.url, key: request.idempotencyKey!, payload: idemPayload }, async () => ({ statusCode: 200, body: response(cached, true) }));
                return reply.code(result.statusCode).send(result.body);
            }
            const now = deps().now(), hits = (rates.get(organization_id) ?? []).filter(t => now - t < 60000);
            if (hits.length >= 10)
                throw imageryError('IMAGERY_RATE_LIMIT', 'Limite de dez buscas por minuto.', 429);
            rates.set(organization_id, [...hits, now]);
            // Remote IO happens before the short idempotent persistence transaction.
            let found: Awaited<ReturnType<typeof searchInpe>>;
            try {
                found = await deps().search(input, bbox, undefined, next);
            } catch {
                const stored = { scenes: [], bbox, failure: 'INDISPONIVEL' };
                const queried_at = new Date(deps().now());
                await prisma.imageryQuery.create({ data: {
                    organization_id, created_by_user_id: actor.id, plot_id: plot?.id ?? null,
                    geometry: json(input.geometry), geometry_hash, geometry_version: plot?.geometry_version ?? null,
                    context_provenance: json({ geometry: plot?.data_provenance ?? 'DECLARADA_NAO_VERIFICADA', imagery: 'INDISPONIVEL' }),
                    filters: json(filters), request_hash, adapter_version: INPE_ADAPTER_VERSION,
                    snapshot: json(stored), snapshot_hash: sha256Canonical(stored), status: 'INDISPONIVEL',
                    http_status: null, failure_reason: 'Catálogo indisponível ou resposta inválida; detalhes externos não armazenados.', page,
                    queried_at, expires_at: queried_at
                } });
                throw imageryError('INDISPONIVEL', 'Catálogo INPE indisponível.', 503);
            }
            // PostGIS intersection rejects bbox-only false positives, including holes.
            const scenes: StoredScene[] = [];
            for (const scene of found.scenes) {
                const rows = await prisma.$queryRaw<Array<{
                    intersects: boolean;
                }>> `SELECT ST_Intersects(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(input.geometry)}),4326), ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(scene.scene.footprint)}),4326)) intersects`;
                if (rows[0]?.intersects)
                    scenes.push(scene);
            }
            const stored = { scenes, bbox }, id = randomUUID(), queried_at = new Date(deps().now());
            const result = await executeIdempotent(prisma, { actorId: actor.id, operation: request.routeOptions.url, key: request.idempotencyKey!, payload: idemPayload }, async (tx) => {
                const q = await tx.imageryQuery.create({ data: { id, organization_id, created_by_user_id: actor.id, plot_id: plot?.id ?? null, geometry: json(input.geometry), geometry_hash, geometry_version: plot?.geometry_version ?? null, context_provenance: json({ geometry: plot?.data_provenance ?? 'DECLARADA_NAO_VERIFICADA', imagery: 'REAL_CONSULTADA' }), filters: json(filters), request_hash, adapter_version: INPE_ADAPTER_VERSION, snapshot: json(stored), snapshot_hash: sha256Canonical(stored), status: scenes.length ? 'SUCESSO' : 'SEM_IMAGENS', http_status: 200, page, next_cursor: found.nextRequest && page < 5 ? randomBytes(32).toString('hex') : null, ...(found.nextRequest && page < 5 ? { next_request: json(found.nextRequest) } : {}), queried_at, expires_at: new Date(queried_at.getTime() + 3600000) } });
                return { statusCode: 200, body: response(q, false) };
            });
            return reply.code(result.statusCode).send(result.body);
        }));
    }
    app.get('/api/v1/imagery/queries/:queryId/scenes/:sceneKey/render', { schema: { params: ImageryQuerySceneParamsSchema } }, safe(async (request, reply) => {
        reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie');
        enabled();
        const query = await prisma.imageryQuery.findFirst({ where: { id: request.params.queryId, organization_id: request.authUser!.organization_id } });
        const scene = query && snapshot(query).scenes.find(s => s.scene.scene_key === request.params.sceneKey);
        if (!query || !scene)
            throw imageryError('IMAGERY_NOT_FOUND', 'Imagem não encontrada.', 404);
        if (!scene.assets)
            throw imageryError('SEM_VISUALIZACAO', 'Cena sem bandas RGB compatíveis.');
        const key = `${query.organization_id}/${query.id}/${scene.scene.scene_key}/${query.snapshot_hash}`;
        const saved = cache.get(key);
        if (saved && saved.expires > deps().now())
            return reply.type('image/png').send(saved.png);
        if (rendering >= 2)
            throw imageryError('IMAGERY_RENDER_BUSY', 'Dois recortes já estão em processamento.', 429);
        rendering++;
        try {
            const result = await deps().render({ assets: scene.assets, bbox: snapshot(query).bbox });
            if (cache.size >= 32)
                cache.delete(cache.keys().next().value!);
            cache.set(key, { png: result.png, expires: deps().now() + 86400000 });
            return reply.type('image/png').send(result.png);
        }
        finally {
            rendering--;
        }
    }));
    const refs = async (plot: any, client: Pick<Prisma.TransactionClient, 'plotImageryReference'> = prisma) => {
        const rows = await client.plotImageryReference.findMany({ where: { plot_id: plot.id, organization_id: plot.organization_id }, orderBy: { created_at: 'desc' } });
        return { plot_id: plot.id, current_geometry_hash: plot.geometry_hash, current_geometry_version: plot.geometry_version, references: rows.map(r => ({ id: r.id, query_id: r.query_id, scene_key: r.scene_key, geometry_hash: r.geometry_hash, geometry_version: r.geometry_version, is_current: r.geometry_hash === plot.geometry_hash && r.geometry_version === plot.geometry_version, scene: publicScenes(r.query_id, [r.snapshot as unknown as StoredScene])[0], created_at: r.created_at.toISOString() })) };
    };
    app.get('/api/v1/plots/:id/imagery-references', { schema: { params: ImageryPlotParamsSchema, response: { 200: ImageryReferencesResponseSchema } } }, safe(async (request) => { const plot = await prisma.plot.findFirst({ where: { id: request.params.id, organization_id: request.authUser!.organization_id } }); if (!plot)
        throw imageryError('PLOT_NOT_FOUND', 'Parcela não encontrada.', 404); return refs(plot); }));
    app.post('/api/v1/plots/:id/imagery-references', { schema: { params: ImageryPlotParamsSchema, body: ImageryReferenceCreateSchema, response: { 200: ImageryReferencesResponseSchema } } }, safe(async (request, reply) => {
        enabled();
        const actor = request.authUser!, input = request.body;
        const accessible = await prisma.plot.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id }, select: { id: true } });
        if (!accessible) throw imageryError('IMAGERY_NOT_FOUND', 'Parcela não encontrada.', 404);
        const result = await executeIdempotent(prisma, { actorId: actor.id, operation: request.routeOptions.url, key: request.idempotencyKey!, payload: { organization_id: actor.organization_id, id: request.params.id, ...input } }, async (tx) => {
            const plot = await tx.plot.findFirst({ where: { id: request.params.id, organization_id: actor.organization_id } }), q = await tx.imageryQuery.findFirst({ where: { id: input.query_id, organization_id: actor.organization_id } });
            if (!plot || !q)
                throw imageryError('IMAGERY_NOT_FOUND', 'Parcela ou consulta não encontrada.', 404);
            if (q.plot_id !== null && q.plot_id !== plot.id)
                throw imageryError('IMAGERY_NOT_FOUND', 'Consulta pertence a outra parcela.', 404);
            if (plot.geometry_hash !== q.geometry_hash || input.geometry_version !== plot.geometry_version || q.geometry_version !== null && q.geometry_version !== plot.geometry_version)
                throw imageryError('IMAGERY_GEOMETRY_CHANGED', 'Geometria mudou; realize nova busca.', 409);
            const stored = snapshot(q).scenes.find(s => s.scene.scene_key === input.scene_key);
            if (!stored)
                throw imageryError('IMAGERY_NOT_FOUND', 'Cena não encontrada na consulta.', 404);
            const existing = await tx.plotImageryReference.findFirst({ where: { plot_id: plot.id, geometry_version: plot.geometry_version, query_id: q.id, scene_key: input.scene_key } });
            if (!existing) {
                const id = randomUUID();
                await tx.plotImageryReference.create({ data: { id, organization_id: actor.organization_id, created_by_user_id: actor.id, plot_id: plot.id, query_id: q.id, scene_key: input.scene_key, collection_id: stored.scene.collection_id, item_id: stored.scene.item_id, geometry_hash: plot.geometry_hash, geometry_version: plot.geometry_version, snapshot: json(stored), snapshot_hash: sha256Canonical(stored), attribution: stored.scene.attribution } });
                await appendAuditEvent(tx, { streamId: id, entityType: 'PLOT_IMAGERY_REFERENCE', entityId: id, type: 'PLOT_IMAGERY_LINKED', actorId: actor.id, payload: { plot_id: plot.id, query_id: q.id, geometry_hash: plot.geometry_hash, geometry_version: plot.geometry_version, scene_key: input.scene_key } });
            }
            return { statusCode: 200, body: await refs(plot, tx) };
        });
        return reply.code(result.statusCode).send(result.body);
    }));
}
