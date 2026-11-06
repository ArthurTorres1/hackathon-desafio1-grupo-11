import { Type, type Static } from '@sinclair/typebox';
const id = Type.String({ format: 'uuid' });
export type SaleCreate = Static<typeof import('./index.js').SaleCreateSchema>;
export const ProductTraceParamsSchema = Type.Object({ id }, { additionalProperties: false });
