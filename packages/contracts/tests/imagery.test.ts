import { describe,it,expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { ImagerySearchSchema, ImagerySceneSchema } from '../src/imagery.js';
const polygon={type:'Polygon',coordinates:[[[-60,-3],[-59.99,-3],[-59.99,-2.99],[-60,-3]]]};
describe('private imagery contract',()=>{
  it('accepts bounded polygon/multipolygon and rejects arbitrary URLs/collections/cursors',()=>{
    const input={geometry:polygon,datetime:'2026-01-01T00:00:00Z/2026-11-01T00:00:00Z'};
    expect(Value.Check(ImagerySearchSchema,input)).toBe(true);
    expect(Value.Check(ImagerySearchSchema,{...input,geometry:{type:'MultiPolygon',coordinates:[polygon.coordinates]}})).toBe(true);
    for(const extra of [{url:'https://evil.invalid'},{collection_ids:['UNKNOWN']},{cursor:'https://evil.invalid'}])expect(Value.Check(ImagerySearchSchema,{...input,...extra})).toBe(false);
  });
  it('requires explicit nullable metadata instead of inventing missing quality values',()=>{
    const scene={scene_key:'a'.repeat(64),collection_id:'S2-16D-2',item_id:'example',datetime:null,start_datetime:null,end_datetime:null,footprint:polygon,bbox:[-60,-3,-59.99,-2.99],cloud_cover:null,platform:null,instruments:[],license:null,attribution:'INPE / BDC',renderable:false,render_bounds:null,render_url:null,preview_url:null,limitations:['SEM_VISUALIZACAO']};
    expect(Value.Check(ImagerySceneSchema,scene)).toBe(true);
    const {cloud_cover,...missing}=scene;expect(Value.Check(ImagerySceneSchema,missing)).toBe(false);
    expect(Value.Check(ImagerySceneSchema,{...scene,cloud_cover:101})).toBe(false);
  });
});
