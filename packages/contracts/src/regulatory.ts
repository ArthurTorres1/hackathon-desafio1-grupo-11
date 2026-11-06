import { Type, type Static } from '@sinclair/typebox';

export const REGULATORY_JURISDICTIONS = ['BR','AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'] as const;
export const RegulatoryJurisdictionSchema = Type.Union(REGULATORY_JURISDICTIONS.map(value => Type.Literal(value)));
export const RegulatoryPhaseSchema = Type.Union(['ORIGIN', 'TRANSPORT', 'DESTINATION', 'TRANSFORMATION'].map(value => Type.Literal(value)));
export const RegulatoryEntitySchema = Type.Union(['ORIGIN_LOT', 'SHIPMENT', 'TRANSFORMATION'].map(value => Type.Literal(value)));
const coverage = Type.Union(['CONFIRMADA', 'PENDENTE_DE_VERIFICACAO', 'CONFLITANTE'].map(value => Type.Literal(value)));
const text = Type.String({ minLength: 1, maxLength: 200 });
const id = Type.String({ format: 'uuid' });
export const RegulatoryAssessmentCreateSchema = Type.Object({
  entity_type: RegulatoryEntitySchema, entity_id: id,
  modality: text,
  // Systems and date come from persisted shipments; origin/processing declarations must supply them.
  official_system: Type.Optional(text), occurred_on: Type.Optional(Type.String({ format: 'date' })),
}, { additionalProperties: false });
export type RegulatoryAssessmentCreate = Static<typeof RegulatoryAssessmentCreateSchema>;
export const RegulatoryHistoryParamsSchema = Type.Object({ entity_type: RegulatoryEntitySchema, entity_id: id }, { additionalProperties: false });
export const RegulatoryRequirementQuerySchema = Type.Object({
  jurisdiction: Type.Optional(RegulatoryJurisdictionSchema), phase: Type.Optional(RegulatoryPhaseSchema),
}, { additionalProperties: false });
export const RegulatoryPublicSummarySchema = Type.Object({
  coverage, gap_count: Type.Integer({ minimum: 0 }),
  pending_phases: Type.Array(RegulatoryPhaseSchema),
}, { additionalProperties: false });
