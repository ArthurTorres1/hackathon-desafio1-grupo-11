import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { StateSchema, UF_CODES, PlotCreateSchema, ProvenanceAllocationSchema } from '../src/index.js';

describe('shared HTTP contracts',()=>{
  it('accepts all 27 Brazilian federation units and rejects unknown codes',()=>{
    expect(UF_CODES).toHaveLength(27);
    for (const uf of UF_CODES) expect(Value.Check(StateSchema,uf)).toBe(true);
    expect(Value.Check(StateSchema,'XX')).toBe(false);
  });
  it('uses snake_case plot fields and measured provenance fractions',()=>{
    expect(Value.Check(ProvenanceAllocationSchema,{origin_lot_id:null,volume_m3:'0.001',fraction:'0.0003'})).toBe(true);
    expect(Value.Check(ProvenanceAllocationSchema,{origin_lot_id:null,volume_m3:'0.001',fraction:'0.0003',inferred:true})).toBe(false);
    expect(PlotCreateSchema.properties).toHaveProperty('geometry_version');
  });
});
