import type { FastifyInstance } from 'fastify';
import { FormatRegistry, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { ResponseErrorSchema, SessionResponseSchema, PlotResponseSchema, OriginLotResponseSchema,
  DocumentResponseSchema, ShipmentResponseSchema, HarvestResponseSchema, PendingHarvestResponseSchema,
  TransformationResponseSchema, PassportResponseSchema } from '@foresttrace/contracts';

// TypeBox validates serialized JSON; Fastify continues to validate incoming schemas independently.
if (!FormatRegistry.Has('uuid')) FormatRegistry.Set('uuid', value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
if (!FormatRegistry.Has('date-time')) FormatRegistry.Set('date-time', value => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(value) && Number.isFinite(Date.parse(value)));
if (!FormatRegistry.Has('date')) FormatRegistry.Set('date', value => /^\d{4}-\d\d-\d\d$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);

const mappedResponses: Record<string, Record<number, TSchema>> = {
  'POST /api/v1/auth/session': { 200: SessionResponseSchema },
  'POST /api/v1/plots': { 201: PlotResponseSchema },
  'POST /api/v1/origin-lots': { 201: OriginLotResponseSchema },
  'POST /api/v1/documents': { 201: DocumentResponseSchema },
  'POST /api/v1/harvests': { 201: HarvestResponseSchema, 202: PendingHarvestResponseSchema },
  'POST /api/v1/shipments': { 201: ShipmentResponseSchema },
  'POST /api/v1/shipments/:id/dispatch': { 200: ShipmentResponseSchema },
  'POST /api/v1/shipments/:id/receive': { 200: ShipmentResponseSchema },
  'POST /api/v1/transformations': { 201: TransformationResponseSchema },
  'POST /api/v1/passports': { 201: PassportResponseSchema },
};

/** Must be installed before route registration so schemas also appear in OpenAPI. */
export function registerResponseContracts(app: FastifyInstance) {
  app.addHook('onRoute', options => {
    if (!options.url.startsWith('/api/v1/')) return;
    const method = Array.isArray(options.method) ? options.method[0] : options.method;
    const existingResponses = options.schema?.response as Record<string, TSchema> | undefined;
    options.schema = { ...options.schema, response: {
      '4xx': ResponseErrorSchema, '5xx': ResponseErrorSchema,
      ...mappedResponses[`${method} ${options.url}`], ...existingResponses,
    } };
  });
  app.addHook('preSerialization', async (request, reply, payload) => {
    if (!request.routeOptions.url?.startsWith('/api/v1/') || payload === null || typeof payload !== 'object' || Buffer.isBuffer(payload)) return payload;
    const responses = request.routeOptions.schema?.response as Record<string, TSchema> | undefined;
    const schema = responses?.[String(reply.statusCode)] ?? responses?.[`${Math.floor(reply.statusCode / 100)}xx`] ?? responses?.default;
    if (!schema) return payload;
    const serialized = JSON.parse(JSON.stringify(payload)) as unknown;
    if (!Value.Check(schema, serialized)) {
      // Do not include values or validation details: a bad payload can contain private data.
      throw Object.assign(new Error('Resposta incompatível com o contrato HTTP.'), { code: 'RESPONSE_CONTRACT_INVALID', statusCode: 500 });
    }
    return serialized;
  });
}
