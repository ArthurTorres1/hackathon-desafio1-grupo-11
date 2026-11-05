import { describe, expect, it, vi } from 'vitest';
import { assessWhisp, createHttpWhispTransport, type WhispFetch, type WhispTransport } from '../../src/services/whisp.js';

const geometry={type:'Polygon',coordinates:[[[-60,-3],[-59.9,-3],[-59.9,-2.9],[-60,-2.9],[-60,-3]]]};

describe('Whisp integration boundaries',()=>{
  it('uses explicit simulated fallback until contract and credential are configured',async()=>{
    const transport: WhispTransport={submit:vi.fn(),poll:vi.fn()};
    const result=await assessWhisp({geometry,contractConfirmed:false,apiKey:'secret',transport,simulatedFixture:{signal:'fixture'}});
    expect(result).toMatchObject({integration:'SEM_INTEGRACAO_REAL',result:'NAO_AVALIADO',provenance:'SIMULADA',simulated_fixture:{signal:'fixture'}});
    expect(transport.submit).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('mocks HTTP 202 then bounded polling; only a confirmed result is real evidence',async()=>{
    const fetchMock=vi.fn<WhispFetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({job_id:'job-1',status:'pending'}),{status:202}))
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'completed',result:{signals:[]}}),{status:200}));
    const transport=createHttpWhispTransport({submitUrl:'https://confirmed.example/submit',pollUrl:(id)=>`https://confirmed.example/jobs/${id}`,fetchImpl:fetchMock});
    const result=await assessWhisp({geometry,contractConfirmed:true,apiKey:'secret',transport});
    expect(result).toMatchObject({integration:'REAL',result:'CONCLUIDO',provenance:'REAL_CONSULTADA',job_id:'job-1',provider_result:{signals:[]}});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({'X-API-KEY':'secret'});
  });
  it.each([401,429,500])('does not turn provider HTTP %s into a pass',async(status)=>{
    const fetchMock=vi.fn().mockResolvedValue(new Response('untrusted',{status}));
    const result=await assessWhisp({geometry,contractConfirmed:true,apiKey:'secret',maxRetries:0,
      transport:createHttpWhispTransport({submitUrl:'https://confirmed.example/submit',pollUrl:(id)=>id,fetchImpl:fetchMock})});
    expect(result.result).toBe('NAO_AVALIADO');
    expect(result.provenance).toBe('INDISPONIVEL');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('retries a transient provider failure only within the configured bound',async()=>{
    const fetchMock=vi.fn<WhispFetch>()
      .mockResolvedValueOnce(new Response('temporary',{status:503}))
      .mockResolvedValueOnce(new Response(JSON.stringify({status:'completed',result:{ok:true}}),{status:200}));
    const result=await assessWhisp({geometry,contractConfirmed:true,apiKey:'secret',maxRetries:1,
      transport:createHttpWhispTransport({submitUrl:'https://confirmed.example/submit',pollUrl:(id)=>id,fetchImpl:fetchMock})});
    expect(result).toMatchObject({result:'CONCLUIDO',attempts:2});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('returns no evaluated signal after timeout',async()=>{
    const transport:WhispTransport={submit:vi.fn<WhispTransport['submit']>(()=>new Promise(()=>{})),poll:vi.fn()};
    expect(await assessWhisp({geometry,contractConfirmed:true,apiKey:'secret',transport,timeoutMs:1,maxRetries:0})).toMatchObject({result:'NAO_AVALIADO',provenance:'INDISPONIVEL'});
  });
  it('keeps accepted work pending when polling reaches its configured limit',async()=>{
    const transport:WhispTransport={submit:vi.fn().mockResolvedValue({status:202,body:{job_id:'job-1',status:'pending'}}),poll:vi.fn().mockResolvedValue({status:200,body:{status:'running'}})};
    expect(await assessWhisp({geometry,contractConfirmed:true,apiKey:'secret',transport,maxPolls:1})).toMatchObject({result:'PENDENTE',job_id:'job-1'});
    expect(transport.poll).toHaveBeenCalledTimes(1);
  });
  it('does not reuse a result across different geometry hashes',async()=>{
    const transport:WhispTransport={submit:vi.fn().mockResolvedValue({status:200,body:{status:'completed',result:{ok:true}}}),poll:vi.fn()};
    const a=await assessWhisp({geometry,contractConfirmed:true,apiKey:'secret',transport});
    const b=await assessWhisp({geometry:{...geometry,coordinates:[]},contractConfirmed:true,apiKey:'secret',transport});
    expect(a.query_hash).not.toBe(b.query_hash);
    expect(b.reused_cache).toBe(false);
  });
});
