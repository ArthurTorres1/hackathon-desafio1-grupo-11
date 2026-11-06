import { Type } from '@sinclair/typebox';

const id = Type.String({ format: 'uuid' });
const text = Type.String({ minLength: 1 });
const timestamp = Type.String({ format: 'date-time' });
const decimal = Type.String({ pattern: '^(0|[1-9][0-9]{0,13})(\\.[0-9]{1,6})?$' });
const record = Type.Record(Type.String(), Type.Unknown());
const scope = Type.Union([Type.Literal('REAL'), Type.Literal('DEMONSTRATIVO')]);
const role = Type.Union(['OPERATOR', 'AUDITOR', 'BUYER', 'REGULATOR'].map(value => Type.Literal(value)));
const entity = (properties: Record<string, import('@sinclair/typebox').TSchema>) => Type.Object(properties, { additionalProperties: true });

export const ResponseErrorSchema = Type.Object({ error: Type.Object({
  code: text, message: text, request_id: text,
  fields: Type.Optional(Type.Union([Type.Record(Type.String(), Type.String()), Type.Array(Type.String())])),
}, { additionalProperties: false }),
  checks: Type.Optional(Type.Array(Type.Object({
    rule_id: text,
    status: Type.Union(['PASSOU', 'ALERTA', 'PENDENTE', 'NAO_AVALIADO'].map(value => Type.Literal(value))),
    errors: Type.Array(text),
  }, { additionalProperties: false }))),
}, { additionalProperties: false });

export const SessionResponseSchema = Type.Object({
  user: Type.Object({ id, name: text, roles: Type.Array(role), organization: Type.Object({ id, name: text }, { additionalProperties: false }) }, { additionalProperties: false }),
  csrf_token: text, expires_at: timestamp,
}, { additionalProperties: false });
export const PersistedPlotSchema = entity({ id, organization_id: id, state: text, municipality: text,
  geometry: record, geometry_hash: text, geometry_version: Type.Integer({ minimum: 1 }),
  geometry_date: timestamp, area_ha: decimal, data_provenance: record, created_by_user_id: id });
export const PlotResponseSchema = entity({ plot: PersistedPlotSchema, checks: Type.Array(entity({ rule_id: text, status: text, message: text })) });
export const OriginLotResponseSchema = entity({ origin_lot: entity({ id, organization_id: id, plot_id: id, code: text,
  authorized_volume_m3: decimal, harvested_volume_m3: decimal, valid_from: timestamp, valid_until: timestamp,
  assessment_scope: scope, data_provenance: record, created_by_user_id: id }),
  plot: entity({ id, geometry_hash: text }), balance: entity({ available_m3: decimal }) });
export const DocumentResponseSchema = entity({ document: entity({ id, organization_id: id, name: text, type: text,
  content_hash: Type.String({ pattern: '^[0-9a-f]{64}$' }), data_provenance: text, created_by_user_id: id }) });
export const ShipmentResponseSchema = entity({ shipment: entity({ id, sender_id: id, recipient_id: id, status: text,
  created_by_user_id: id, items: Type.Optional(Type.Array(entity({ id, lot_id: id, volume_m3: decimal }))) }) });
export const HarvestResponseSchema = entity({ harvest: entity({ id, origin_lot_id: id, organization_id: id,
  volume_m3: decimal, created_by_user_id: id }), status: Type.Literal('CONFIRMADO') });
export const PendingHarvestResponseSchema = entity({ status: Type.Literal('PENDENTE_REVISAO'),
  pending_operation: entity({ id, operation: text, payload_hash: text, created_by_user_id: id }), check: text });
export const TransformationResponseSchema = entity({ transformation: entity({ id, organization_id: id,
  residue_m3: decimal, loss_m3: decimal, assessment_scope: scope, created_by_user_id: id }),
  outputs: Type.Array(entity({ product_lot: entity({ id, transformation_id: id, volume_m3: decimal, created_by_user_id: id }),
    provenance: record, quarantined: Type.Boolean() })), assessment: record });
export const PassportResponseSchema = entity({ passport: entity({ id, product_lot_id: id, version: Type.Integer({ minimum: 1 }),
  content: record, content_hash: text, snapshot_heads: record, assessment_scope: scope }), qr_data_url: text, readiness: record });

export const DiagnosticFieldSchema = Type.Object({
  entity_type: text, entity_id: id, field: text, value: Type.Unknown(), provenance: Type.Unknown(),
}, { additionalProperties: false });
export const EvidenceDiagnosticSchema = Type.Object({
  schema_version: Type.Literal('1'), generated_at: timestamp, origin_lot_id: id, assessment_scope: scope,
  regulatory_coverage: Type.Literal('PENDENTE_DE_VERIFICACAO'),
  fields: Type.Array(DiagnosticFieldSchema), documents: Type.Array(entity({ id, data_provenance: text, content_hash: text })),
  sources: Type.Array(record), source_queries: Type.Array(record),
  limitations: Type.Array(text),
}, { additionalProperties: false });
