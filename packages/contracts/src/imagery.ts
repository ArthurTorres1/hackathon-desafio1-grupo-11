import { Type, type Static } from '@sinclair/typebox';
const text = Type.String({ minLength: 1, maxLength: 300 });
const id = Type.String({ format: 'uuid' });
const hash = Type.String({ pattern: '^[0-9a-f]{64}$' });
const position = Type.Array(Type.Number(), { minItems: 2, maxItems: 3 });
const ring = Type.Array(position, { minItems: 4, maxItems: 1001 });
const polygon = Type.Array(ring, { minItems: 1, maxItems: 100 });
export const ImageryGeometrySchema = Type.Union([
    Type.Object({ type: Type.Literal('Polygon'), coordinates: polygon }, { additionalProperties: false }),
    Type.Object({ type: Type.Literal('MultiPolygon'), coordinates: Type.Array(polygon, { minItems: 1, maxItems: 100 }) }, { additionalProperties: false }),
]);
export const ImageryFiltersSchema = Type.Object({
    datetime: Type.String({ minLength: 21, maxLength: 80 }),
    collection_ids: Type.Optional(Type.Array(Type.Literal('S2-16D-2'), { minItems: 1, maxItems: 1, uniqueItems: true })),
    cursor: Type.Optional(Type.String({ pattern: '^[0-9a-f]{64}$' })),
}, { additionalProperties: false });
export const ImagerySearchSchema = Type.Object({ geometry: ImageryGeometrySchema, ...ImageryFiltersSchema.properties }, { additionalProperties: false });
export type ImagerySearch = Static<typeof ImagerySearchSchema>;
export type ImageryFilters = Static<typeof ImageryFiltersSchema>;
const nullableText = Type.Union([Type.String(), Type.Null()]);
const bounds = Type.Tuple([Type.Tuple([Type.Number(), Type.Number()]), Type.Tuple([Type.Number(), Type.Number()])]);
export const ImagerySceneSchema = Type.Object({
    scene_key: hash, collection_id: text, item_id: text,
    datetime: nullableText, start_datetime: nullableText, end_datetime: nullableText,
    footprint: ImageryGeometrySchema, bbox: Type.Tuple([Type.Number(), Type.Number(), Type.Number(), Type.Number()]),
    cloud_cover: Type.Union([Type.Number({ minimum: 0, maximum: 100 }), Type.Null()]),
    platform: nullableText, instruments: Type.Array(Type.String()), license: nullableText, attribution: text,
    renderable: Type.Boolean(), render_bounds: Type.Union([bounds, Type.Null()]),
    render_url: nullableText, preview_url: Type.Null(), limitations: Type.Array(Type.String()),
}, { additionalProperties: false });
export const ImagerySearchResponseSchema = Type.Object({
    query_id: id, geometry_hash: hash, geometry_version: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    status: Type.Union([Type.Literal('SUCESSO'), Type.Literal('SEM_IMAGENS')]), scenes: Type.Array(ImagerySceneSchema, { maxItems: 20 }),
    next_cursor: Type.Union([hash, Type.Null()]), queried_at: Type.String({ format: 'date-time' }),
    cached: Type.Boolean(), context_provenance: Type.Unknown(), limitations: Type.Array(Type.String()),
}, { additionalProperties: false });
export const ImageryReferenceCreateSchema = Type.Object({ query_id: id, scene_key: hash, geometry_version: Type.Integer({ minimum: 1 }) }, { additionalProperties: false });
export const ImageryReferenceSchema = Type.Object({
    id, query_id: id, scene_key: hash, geometry_hash: hash, geometry_version: Type.Integer({ minimum: 1 }),
    is_current: Type.Boolean(), scene: ImagerySceneSchema, created_at: Type.String({ format: 'date-time' }),
}, { additionalProperties: false });
export const ImageryReferencesResponseSchema = Type.Object({
    plot_id: id, current_geometry_hash: hash, current_geometry_version: Type.Integer({ minimum: 1 }), references: Type.Array(ImageryReferenceSchema),
}, { additionalProperties: false });
export const ImageryQuerySceneParamsSchema = Type.Object({ queryId: id, sceneKey: hash }, { additionalProperties: false });
export const ImageryPlotParamsSchema = Type.Object({ id }, { additionalProperties: false });
export const ImageryRenderQuerySchema = Type.Object({ width: Type.Optional(Type.Integer({ minimum: 16, maximum: 1024 })), height: Type.Optional(Type.Integer({ minimum: 16, maximum: 1024 })) }, { additionalProperties: false });
export type ImageryScene = Static<typeof ImagerySceneSchema>;
export const ImageryCapabilitiesSchema = Type.Object({ enabled: Type.Boolean(), collection_ids: Type.Array(Type.String()), limits: Type.Object({ max_area_ha: Type.Number(), max_period_years: Type.Number(), max_scenes_per_page: Type.Number(), max_pages: Type.Number(), max_render_side: Type.Number(), max_vertices: Type.Number() }), limitations: Type.Array(Type.String()) }, { additionalProperties: false });
export type ImageryCapabilities = Static<typeof ImageryCapabilitiesSchema>;
