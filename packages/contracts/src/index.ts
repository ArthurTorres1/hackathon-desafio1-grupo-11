import { Type, type Static } from '@sinclair/typebox';
import { ResponseErrorSchema } from './responses.js';
export * from './forest-utilization.js';
export * from './regulatory.js';
export * from './responses.js';
export * from './delivery.js';

export const UF_CODES = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
export type UF = typeof UF_CODES[number];
export const StateSchema = Type.Union(UF_CODES.map((value) => Type.Literal(value)));
export const UFS = UF_CODES;
export const UfSchema = StateSchema;
export const UUIDSchema = Type.String({ format: 'uuid' });
export const DecimalSchema = Type.String({ pattern: '^(0|[1-9][0-9]{0,13})(\\.[0-9]{1,6})?$' });
export const PositiveDecimalSchema = Type.String({ pattern: '^(?=.*[1-9])(0|[1-9][0-9]{0,13})(\\.[0-9]{1,6})?$' });
export const DateSchema = Type.String({ format: 'date' });
export const TimestampSchema = Type.String({ format: 'date-time' });
export const DATA_PROVENANCE_LABELS = ['REAL_CONSULTADA', 'DADO_PUBLICO_IMPORTADO', 'DOCUMENTO_FORNECIDO', 'DECLARACAO_DO_USUARIO', 'SIMULADA', 'INDISPONIVEL', 'NAO_VERIFICADA'] as const;
export type DataProvenanceLabel = typeof DATA_PROVENANCE_LABELS[number];
export const DataProvenanceLabelSchema = Type.Union(DATA_PROVENANCE_LABELS.map((v) => Type.Literal(v)));
export const DataProvenanceSchema = Type.Object({
  label: DataProvenanceLabelSchema,
  source: Type.String({ minLength: 1 }), informed_by: Type.String({ minLength: 1 }),
  recorded_at: TimestampSchema, confidence: Type.Union([Type.Literal('ALTA'), Type.Literal('MEDIA'), Type.Literal('BAIXA'), Type.Literal('NAO_AVALIADA')]),
}, { additionalProperties: false });
export const FieldProvenanceSchema = Type.Record(Type.String(), Type.Union([DataProvenanceLabelSchema, DataProvenanceSchema]));
export const CHECK_RESULTS = ['PASSOU', 'ALERTA', 'PENDENTE', 'NAO_AVALIADO'] as const;
export type CheckResult = typeof CHECK_RESULTS[number];
export const CheckResultSchema = Type.Union(CHECK_RESULTS.map((v) => Type.Literal(v)));
export const CHECK_DIMENSIONS = ['documentary_check', 'geospatial_check', 'volume_check', 'chain_of_custody_check', 'human_review'] as const;
export type CheckDimension = typeof CHECK_DIMENSIONS[number];
export const CheckDimensionSchema = Type.Union(CHECK_DIMENSIONS.map((v) => Type.Literal(v)));
export const ASSESSMENT_SCOPES = ['REAL', 'DEMONSTRATIVO'] as const;
export type AssessmentScope = typeof ASSESSMENT_SCOPES[number];
export const AssessmentScopeSchema = Type.Union(ASSESSMENT_SCOPES.map((v) => Type.Literal(v)));
export const REGULATORY_COVERAGES = ['CONFIRMADA', 'PENDENTE_DE_VERIFICACAO', 'CONFLITANTE'] as const;
export type RegulatoryCoverage = typeof REGULATORY_COVERAGES[number];
export const RegulatoryCoverageSchema = Type.Union(REGULATORY_COVERAGES.map((v) => Type.Literal(v)));
export const AUDIT_CASE_STATES = ['ABERTO', 'EM_ANALISE', 'RESOLVIDO_COM_EVIDENCIA', 'REJEITADO', 'MANTIDO_PENDENTE'] as const;
export type AuditCaseState = typeof AUDIT_CASE_STATES[number];
export const AuditCaseStateSchema = Type.Union(AUDIT_CASE_STATES.map((v) => Type.Literal(v)));
export const PassportReadinessSchema = Type.Union([Type.Literal('READY_FOR_OPERATOR_REVIEW'), Type.Literal('MISSING_EVIDENCE')]);
export const AggregateStatusSchema = Type.Union([Type.Literal('NAO_VERIFICADO'), Type.Literal('EM_REVISAO'), Type.Literal('EVIDENCIAS_CONFERIDAS')]);
export const ROLE_NAMES = ['OPERATOR', 'AUDITOR', 'BUYER', 'REGULATOR'] as const;
export const RoleSchema = Type.Union(ROLE_NAMES.map((v) => Type.Literal(v)));

// Explicit measured provenance and review contracts. Unknown shares stay explicit.
export const ProvenanceAllocationSchema = Type.Object({
  origin_lot_id: Type.Union([UUIDSchema, Type.Null()]),
  volume_m3: PositiveDecimalSchema,
  fraction: Type.String({ pattern: '^(0|1)(\\.[0-9]{1,12})?$|^0\\.[0-9]{1,12}$' }),
}, { additionalProperties: false });
export const RegulatoryGapSchema = Type.Object({
  phase: Type.String({ minLength: 1 }), state: StateSchema,
  requirement: Type.String({ minLength: 1 }), source: Type.Optional(Type.String()),
  next_action: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export const RegulatorySummarySchema = Type.Object({
  coverage: RegulatoryCoverageSchema, gaps: Type.Array(RegulatoryGapSchema),
}, { additionalProperties: false });
export const HumanReviewSchema = Type.Object({
  decision: Type.String({ minLength: 1 }), comment: Type.String({ minLength: 1 }),
  evidence_ids: Type.Array(UUIDSchema, { minItems: 1 }), reviewer_user_id: UUIDSchema,
  original_signal: Type.String({ minLength: 1 }),
}, { additionalProperties: false });
export type ProvenanceAllocation = Static<typeof ProvenanceAllocationSchema>;
export type RegulatoryGap = Static<typeof RegulatoryGapSchema>;

const PositionSchema = Type.Array(Type.Number(), { minItems: 2, maxItems: 3 });
const RingSchema = Type.Array(PositionSchema, { minItems: 4 });
export const PolygonSchema = Type.Object({ type: Type.Literal('Polygon'), coordinates: Type.Array(RingSchema, { minItems: 1 }) }, { additionalProperties: false });
export const MultiPolygonSchema = Type.Object({ type: Type.Literal('MultiPolygon'), coordinates: Type.Array(Type.Array(RingSchema, { minItems: 1 }), { minItems: 1 }) }, { additionalProperties: false });
export const GeometrySchema = Type.Union([PolygonSchema, MultiPolygonSchema]);
export type Geometry = Static<typeof GeometrySchema>;
export const OrganizationCreateSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }), country: Type.Literal('BR'), state: StateSchema,
  municipality: Type.String({ minLength: 1, maxLength: 200 }), role: Type.String({ minLength: 1 }),
  document_reference: Type.Optional(Type.String()), contact: Type.Optional(Type.String()),
  data_provenance: Type.Optional(FieldProvenanceSchema),
}, { additionalProperties: false });
export const PlotCreateSchema = Type.Object({
  organization_id: UUIDSchema, country: Type.Literal('BR'), state: StateSchema,
  municipality: Type.String({ minLength: 1, maxLength: 200 }), declared_property: Type.String({ minLength: 1, maxLength: 300 }),
  geometry: GeometrySchema, geometry_version: Type.Integer({ minimum: 1 }), geometry_date: DateSchema,
  data_provenance: FieldProvenanceSchema,
}, { additionalProperties: false });
export type PlotCreate = Static<typeof PlotCreateSchema>;
export const OriginLotCreateSchema = Type.Object({
  plot_id: UUIDSchema, code: Type.String({ minLength: 1 }), species_common_name: Type.String({ minLength: 1 }),
  species_scientific_name: Type.String({ minLength: 1 }), authorized_volume_m3: PositiveDecimalSchema,
  permit_reference: Type.String({ minLength: 1 }), permit_document_id: UUIDSchema,
  valid_from: DateSchema, valid_until: DateSchema, right_of_use: Type.String({ minLength: 1 }),
  assessment_scope: AssessmentScopeSchema, data_provenance: FieldProvenanceSchema,
}, { additionalProperties: false });
export const HarvestCreateSchema = Type.Object({
  origin_lot_id: UUIDSchema, start_date: DateSchema, end_date: DateSchema, volume_m3: PositiveDecimalSchema,
  species_common_name: Type.Optional(Type.String()), tag: Type.Optional(Type.String()),
  document_ids: Type.Optional(Type.Array(UUIDSchema)), pending_request_id: Type.Optional(UUIDSchema),
}, { additionalProperties: false });
export const ShipmentItemSchema = Type.Object({ lot_id: UUIDSchema, volume_m3: PositiveDecimalSchema }, { additionalProperties: false });
export const ShipmentCreateSchema = Type.Object({
  sender_organization_id: UUIDSchema, recipient_organization_id: UUIDSchema,
  origin_state: StateSchema, destination_state: StateSchema,
  items: Type.Array(ShipmentItemSchema, { minItems: 1 }), route_states: Type.Array(StateSchema),
  transporter: Type.String({ minLength: 1 }), official_system: Type.String({ minLength: 1 }),
  document_ids: Type.Array(UUIDSchema), fiscal_key: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const ShipmentDispatchSchema = Type.Object({ occurred_at: TimestampSchema }, { additionalProperties: false });
export const ShipmentReceiveSchema = Type.Object({ occurred_at: TimestampSchema, items: Type.Array(Type.Object({ lot_id: UUIDSchema, volume_m3: DecimalSchema }, { additionalProperties: false }), { minItems: 1 }) }, { additionalProperties: false });
export const AllocationSchema = Type.Object({ origin_lot_id: Type.Union([UUIDSchema, Type.Null()]), volume_m3: PositiveDecimalSchema }, { additionalProperties: false });
export const TransformationOutputSchema = Type.Object({
  client_ref: Type.String({ minLength: 1 }), product: Type.String({ minLength: 1 }), volume_m3: PositiveDecimalSchema,
  allocations: Type.Array(AllocationSchema, { minItems: 1 }),
}, { additionalProperties: false });
export const TransformationCreateSchema = Type.Object({
  code: Type.String({ minLength: 1 }), occurred_at: TimestampSchema, operator_organization_id: UUIDSchema,
  conversion_parameter_id: UUIDSchema, inputs: Type.Array(ShipmentItemSchema, { minItems: 1 }),
  outputs: Type.Array(TransformationOutputSchema, { minItems: 1 }), residue_m3: DecimalSchema, loss_m3: DecimalSchema,
  assessment_scope: AssessmentScopeSchema,
}, { additionalProperties: false });
export const DecisionCreateSchema = Type.Object({
  decision: Type.Union([Type.Literal('EM_ANALISE'), Type.Literal('RESOLVIDO_COM_EVIDENCIA'), Type.Literal('REJEITADO'), Type.Literal('MANTIDO_PENDENTE')]),
  comment: Type.String({ minLength: 1, maxLength: 10000 }), evidence_ids: Type.Array(UUIDSchema),
  conversion_exception_id: Type.Optional(UUIDSchema),
}, { additionalProperties: false });
export const SaleCreateSchema = Type.Object({
  seller_organization_id: UUIDSchema, buyer_organization_id: UUIDSchema, product_lot_id: UUIDSchema,
  volume_m3: PositiveDecimalSchema, fiscal_document_id: UUIDSchema,
  acknowledge_pending: Type.Optional(Type.Boolean()), occurred_at: TimestampSchema,
}, { additionalProperties: false });
export const DocumentCreateSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }), type: Type.String({ minLength: 1 }),
  content_base64: Type.String({ maxLength: 14000000 }), source: Type.String({ minLength: 1 }),
  data_provenance: DataProvenanceLabelSchema, assessment_scope: AssessmentScopeSchema,
  visibility: Type.Union([Type.Literal('PRIVATE'), Type.Literal('BUYER_RELEASED')]),
  fiscal_key: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const PassportCreateSchema = Type.Object({ product_lot_id: UUIDSchema, assessment_scope: AssessmentScopeSchema }, { additionalProperties: false });
export const ErrorSchema = ResponseErrorSchema;
export const HealthSchema = Type.Object({ status: Type.String(), service: Type.String(), database: Type.Optional(Type.String()), postgis: Type.Optional(Type.String()) }, { additionalProperties: false });
export const speciesDemo = { common_name: 'angelim-vermelho', scientific_name: 'Dinizia excelsa', scientific_name_verification: 'PENDENTE_DE_VERIFICACAO' } as const;

export const API_PATHS = { plots: '/api/v1/plots', origin_lots: '/api/v1/origin-lots', harvests: '/api/v1/harvests', shipments: '/api/v1/shipments', transformations: '/api/v1/transformations', sales: '/api/v1/sales', passports: '/api/v1/passports' } as const;
