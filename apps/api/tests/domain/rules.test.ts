import { describe, expect, it } from 'vitest';
import { assessConversion, checkBalance, checkReceipt } from '../../src/services/rules.js';
import { allocateProvenance } from '../../src/services/provenance.js';
import { assertNoSelfReview } from '../../src/services/self-review.js';
import { assessReadiness } from '../../src/services/review-readiness.js';
import { canonicalize, eventHash, verifyEventChain, type ChainEvent } from '../../src/services/integrity.js';

describe('volume rules',()=>{
  it.each([['3','PASSOU'],['5','ALERTA'],['3.5','PASSOU']] as const)('R10 input 10 output %s', (output,result)=>{
    expect(assessConversion({inputVolumeM3:'10',outputVolumeM3:output,multiplier:'0.35',parameterVersion:'demo-v1',parameterSource:'fixture sintética',parameterValidFrom:'2025-01-01',parameterValidUntil:'2027-01-01',assessmentDate:'2026-01-01'}).result).toBe(result);
  });
  it('requires a valid, current, evidenced, scoped exception for a higher CRV',()=>{
    const base={inputVolumeM3:'10',outputVolumeM3:'5',assessmentDate:'2026-01-01',multiplier:'0.35',parameterVersion:'demo-v1',parameterSource:'fixture sintética',parameterValidFrom:'2025-01-01',parameterValidUntil:'2027-01-01',species:'angelim-vermelho',product:'SAWN_WOOD'};
    expect(assessConversion({...base,exception:{multiplier:'0.50',approved:true,evidenceIds:['doc-1'],validFrom:'2025-01-01',validUntil:'2027-01-01',expectedSpecies:'angelim-vermelho',expectedProduct:'SAWN_WOOD'}})).toMatchObject({result:'PASSOU',exception_applied:true});
    expect(assessConversion({...base,exception:{multiplier:'0.50',approved:false,evidenceIds:[],validFrom:'2025-01-01',validUntil:'2027-01-01'}})).toMatchObject({result:'ALERTA',exception_applied:false});
    expect(assessConversion({...base,exception:{multiplier:'0.50',approved:true,evidenceIds:['doc-1'],validFrom:'2025-01-01',validUntil:'2027-01-01',expectedSpecies:'jatoba'}})).toMatchObject({result:'ALERTA',exception_applied:false});
    expect(assessConversion({inputVolumeM3:'10',outputVolumeM3:'3'}).result).toBe('PENDENTE');
    expect(assessConversion({inputVolumeM3:'10',outputVolumeM3:'3',multiplier:'0.35',parameterVersion:'demo-v1',parameterSource:'fixture',parameterValidFrom:'2027-01-01',parameterValidUntil:'2028-01-01',assessmentDate:'2026-01-01'}).result).toBe('PENDENTE');
    expect(()=>assessConversion({inputVolumeM3:'10.0000001',outputVolumeM3:'3',multiplier:'0.35'})).toThrow();
  });
  it('R07 preserves an over-authorization attempt and R08 blocks excess use',()=>{
    expect(checkBalance('10','12','R07')).toMatchObject({pending:true,confirmed:false});
    expect(checkBalance('10','12','R08').result).toBe('ALERTA');
  });
  it('R09 has zero tolerance by default',()=>expect(checkReceipt('10','9.9').result).toBe('ALERTA'));
});

describe('provenance and review integrity',()=>{
  it('computes 60/40 shares and flags any positive unknown share',()=>{
    const known=allocateProvenance('3',[{origin_lot_id:'A',volume_m3:'1.8'},{origin_lot_id:'B',volume_m3:'1.2'}]);
    expect(known.allocations.map(x=>x.fraction)).toEqual(['0.6','0.4']);
    const mixed=allocateProvenance('3',[{origin_lot_id:'A',volume_m3:'2.999'},{origin_lot_id:null,volume_m3:'0.001'}]);
    expect(mixed).toMatchObject({result:'ALERTA',unknown_volume_m3:'0.001',evidence_incomplete:true});
    expect(()=>allocateProvenance('3',[{origin_lot_id:'A',volume_m3:'2.9'}])).toThrow();
    expect(()=>allocateProvenance('3.0000001',[{origin_lot_id:'A',volume_m3:'3.0000001'}])).toThrow();
  });
  it('rejects self-review including author of the assessed version',()=>{
    try {
      assertNoSelfReview({reviewerUserId:'user-a',operationAuthorUserId:'user-b',versionAuthorUserId:'user-a'});
      throw new Error('Expected self-review rejection.');
    } catch (error) {
      expect(error).toMatchObject({code:'SELF_REVIEW_NOT_ALLOWED'});
      expect((error as Error).message).toContain('não pode decidir');
    }
    expect(()=>assertNoSelfReview({reviewerUserId:'user-c',operationAuthorUserId:'user-a',versionAuthorUserId:'user-b'})).not.toThrow();
  });
  it('never marks simulated or normatively pending evidence ready',()=>{
    expect(assessReadiness({assessment_scope:'DEMONSTRATIVO',dimensions:{documentary_check:'PASSOU',geospatial_check:'PASSOU',volume_check:'PASSOU',chain_of_custody_check:'PASSOU',human_review:'PASSOU'},regulatory_coverage:'CONFIRMADA',has_open_alert:false,has_unknown_origin:false,has_simulated_supporting_evidence:false}).readiness).toBe('MISSING_EVIDENCE');
    expect(assessReadiness({assessment_scope:'REAL',dimensions:{documentary_check:'PASSOU',geospatial_check:'PASSOU',volume_check:'PASSOU',chain_of_custody_check:'PASSOU',human_review:'PASSOU'},regulatory_coverage:'PENDENTE_DE_VERIFICACAO',has_open_alert:false,has_unknown_origin:false,has_simulated_supporting_evidence:false}).readiness).toBe('MISSING_EVIDENCE');
  });
  it('detects a tampered event payload',()=>{
    const first: Omit<ChainEvent,'event_hash'>={event_id:'e1',stream_id:'s',sequence:1,entity:'lot',type:'CREATED',actor_id:'u',timestamp:'2026-01-01T00:00:00.000Z',payload:{volume:'3'},previous_hash:null};
    const event: ChainEvent={...first,event_hash:eventHash(first)};
    expect(verifyEventChain([event]).valid).toBe(true);
    expect(verifyEventChain([{...event,payload:{volume:'4'}}])).toMatchObject({valid:false,first_invalid_event_id:'e1'});
    const secondBody={...first,event_id:'e2',sequence:2,previous_hash:event.event_hash};
    const second:ChainEvent={...secondBody,event_hash:eventHash(secondBody)};
    expect(verifyEventChain([second,event]).valid).toBe(false);
  });
  it('canonicalizes object keys deterministically for RFC 8785 hashing',()=>{
    expect(canonicalize({z:1,a:{b:2,a:'x'}})).toBe('{"a":{"a":"x","b":2},"z":1}');
  });
});
