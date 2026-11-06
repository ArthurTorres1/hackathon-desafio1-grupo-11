import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient, type SourceQuery } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { buildServer } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { sha256Canonical } from '../../src/services/integrity.js';
import { WHISP_PROVIDER_VERSION, type WhispFetch } from '../../src/services/whisp.js';

// Every upstream request is mocked and every credential below is an isolated test value.
const owner = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
const organizationId = randomUUID(); const otherOrganizationId = randomUUID();
const userId = randomUUID(); const otherUserId = randomUUID();
const fetchMock = vi.fn<WhispFetch>();
const geometry = { type: 'Polygon', coordinates: [[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]] };
let app: Awaited<ReturnType<typeof buildServer>>;
type Session = { cookie: string; 'x-csrf-token': string };
let session: Session; let otherSession: Session;
let lotId: string; let plotId: string;

const completed = () => new Response(JSON.stringify({ code: 'analysis_completed', data: {
  type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null,
    properties: { Area: 1.25, TreeCover: 42, untrusted_echo: 'test-secret' } }],
} }), { status: 200, headers: { 'content-type': 'application/json' } });
const pending = () => new Response(JSON.stringify({ code: 'analysis_queued', data: { token: 'isolated-job' } }), { status: 202 });

async function login(id: string): Promise<Session> {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/session', payload: { user_id: id } });
  expect(response.statusCode, response.body).toBe(200);
  return { cookie: response.cookies.map(cookie=>`${cookie.name}=${cookie.value}`).join('; '), 'x-csrf-token': response.json().csrf_token };
}
const post = (body: object = {}, key = randomUUID(), auth = session) => app.inject({
  method: 'POST', url: `/api/v1/lots/${lotId}/assess`, headers: { ...auth, 'idempotency-key': key }, payload: body,
});
async function waitForQuery(id: string, ready: (query: SourceQuery) => boolean = query=>query.status!=='PENDENTE') {
  let saved: SourceQuery | undefined;
  await vi.waitFor(async()=>{
    saved = await owner.sourceQuery.findUniqueOrThrow({ where: { id } });
    expect(ready(saved)).toBe(true);
  }, { timeout: 10_000, interval: 25 });
  return saved!;
}

beforeAll(async()=>{
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('WHISP_API_KEY', 'test-secret');
  vi.stubEnv('WHISP_CONTRACT_CONFIRMED', 'true');
  vi.stubEnv('WHISP_SUBMIT_URL', 'https://whisp.test.invalid/api/submit/geojson');
  vi.stubEnv('WHISP_POLL_URL_TEMPLATE', 'https://whisp.test.invalid/api/status/{job_id}');
  await owner.organization.createMany({ data: [organizationId,otherOrganizationId].map(id=>({ id,
    name: 'Whisp isolated synthetic organization', role: 'OPERATOR', state: 'AM', municipality: 'Teste', data_provenance: { label: 'SIMULADA' },
  })) });
  await owner.user.createMany({ data: [
    { id: userId, name: 'Whisp operator', organization_id: organizationId, roles: ['OPERATOR'] },
    { id: otherUserId, name: 'Whisp unrelated operator', organization_id: otherOrganizationId, roles: ['OPERATOR'] },
  ] });
  app = await buildServer();
  session = await login(userId); otherSession = await login(otherUserId);
});

beforeEach(async()=>{
  fetchMock.mockReset();
  fetchMock.mockImplementation(async()=>{ throw new Error('Unexpected mocked Whisp request'); });
  vi.stubEnv('WHISP_API_KEY', 'test-secret');
  vi.stubEnv('WHISP_CONTRACT_CONFIRMED', 'true');
  plotId = randomUUID(); lotId = randomUUID();
  await owner.plot.create({ data: { id: plotId, organization_id: organizationId, state: 'AM', municipality: 'Teste',
    declared_property: 'Área sintética isolada', geometry, geometry_hash: sha256Canonical(geometry), geometry_version: 1,
    geometry_date: new Date('2026-11-06'), area_ha: '1.25', data_provenance: { geometry: 'SIMULADA' }, created_by_user_id: userId,
  } });
  await owner.originLot.create({ data: { id: lotId, code: `WHISP-TEST-${randomUUID()}`, organization_id: organizationId, plot_id: plotId,
    species_common: 'Exemplo sintético', species_scientific: 'Exemplo sintético', authorized_volume_m3: '10',
    valid_from: new Date('2026-01-01'), valid_until: new Date('2027-12-31'), right_of_use: 'SIMULADO',
    data_provenance: { label: 'SIMULADA' }, assessment_scope: 'DEMONSTRATIVO', created_by_user_id: userId,
  } });
});

afterAll(async()=>{
  await app?.close();
  try {
    const lots = await owner.originLot.findMany({ where: { organization_id: organizationId }, select: { id: true } });
    const ids = lots.map(lot=>lot.id);
    await owner.sourceQuery.deleteMany({ where: { organization_id: organizationId } });
    await owner.check.deleteMany({ where: { organization_id: organizationId } });
    await owner.custodyEvent.deleteMany({ where: { stream_id: { in: ids } } });
    await owner.streamHead.deleteMany({ where: { stream_id: { in: ids } } });
    await owner.originLot.deleteMany({ where: { organization_id: organizationId } });
    await owner.plot.deleteMany({ where: { organization_id: organizationId } });
    await owner.idempotencyKey.deleteMany({ where: { user_id: { in: [userId,otherUserId] } } });
    await owner.session.deleteMany({ where: { user_id: { in: [userId,otherUserId] } } });
    await owner.user.deleteMany({ where: { id: { in: [userId,otherUserId] } } });
    await owner.organization.deleteMany({ where: { id: { in: [organizationId,otherOrganizationId] } } });
  } finally {
    await Promise.all([owner.$disconnect(),prisma.$disconnect()]);
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
  }
});

describe.sequential('Whisp HTTP integration with isolated mocked provider',()=>{
  it('acknowledges a durable pending row before provider completion, preserving hashes and synthetic scope',async()=>{
    let release!: (response: Response) => void;
    fetchMock.mockImplementationOnce(()=>new Promise<Response>(resolve=>{ release=resolve; }));
    const ack = await post();
    try {
      expect(ack.statusCode,ack.body).toBe(202);
      expect(ack.json().assessment).toMatchObject({ result:'PENDENTE', provenance:'INDISPONIVEL' });
      const row = await owner.sourceQuery.findUniqueOrThrow({ where: { id:ack.json().source_query.id } });
      expect(row.status).toBe('PENDENTE');
      expect(row.payload_hash).toBe(sha256Canonical(row.payload));
      expect(row.payload).toMatchObject({ geometry_version:1, geometry_provenance:{geometry:'SIMULADA'},
        request:{type:'FeatureCollection',features:[{type:'Feature',geometry}],analysisOptions:{nationalCodes:['br'],unitType:'ha',async:true}} });
    } finally {
      await vi.waitFor(()=>expect(release).toBeTypeOf('function'));
      release(completed());
    }
    const row = await waitForQuery(ack.json().source_query.id);
    expect(row).toMatchObject({ status:'CONCLUIDO', http_status:200, provider_version:WHISP_PROVIDER_VERSION,
      data_provenance:'REAL_CONSULTADA', assessment_scope:'DEMONSTRATIVO' });
    expect(row.result_hash).toBe(sha256Canonical(row.result));
    expect(row.created_at).toBeInstanceOf(Date);
    expect(JSON.stringify(row)).not.toContain('test-secret');
    expect(row.result).toMatchObject({assessment:{result:'CONCLUIDO',response_body:{code:'analysis_completed'},provider_result:{type:'FeatureCollection'}}});
    const checks = await owner.check.findMany({where:{entity_id:lotId,rule_id:'GEO_PROVIDER'}});
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({status:'NAO_AVALIADO',assessment_scope:'DEMONSTRATIVO'});
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({'X-API-KEY':'test-secret'});
  });

  it('replays the same acknowledgement, reuses completed cache with original date, and refreshes explicitly',async()=>{
    fetchMock.mockImplementation(async()=>completed());
    const key = randomUUID();
    const first = await post({},key);
    const saved = await waitForQuery(first.json().source_query.id);
    const replay = await post({},key);
    expect(replay.statusCode).toBe(202); expect(replay.body).toBe(first.body);
    const cached = await post();
    expect(cached.statusCode,cached.body).toBe(200);
    expect(cached.json().assessment).toMatchObject({reused_cache:true,original_queried_at:saved.created_at.toISOString()});
    expect(cached.json().source_query.id).toBe(saved.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await owner.sourceQuery.count({where:{lot_id:lotId}})).toBe(1);
    const renewed = await post({refresh:true});
    expect(renewed.statusCode,renewed.body).toBe(202);
    expect(renewed.json().source_query.id).not.toBe(saved.id);
    await waitForQuery(renewed.json().source_query.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const conflict = await post({refresh:true},key);
    expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe('R17');
  });

  it('invalidates cache when options, geometry or its version change, preserving the original payload',async()=>{
    fetchMock.mockImplementation(async()=>completed());
    const initial = await post();
    const saved = await waitForQuery(initial.json().source_query.id);
    const changedOptions = await post({options:{nationalCodes:['id']}});
    expect(changedOptions.statusCode,changedOptions.body).toBe(202);
    await waitForQuery(changedOptions.json().source_query.id);
    const replacement = {type:'Polygon',coordinates:[[[-61,-3],[-60.999,-3],[-60.999,-2.999],[-61,-2.999],[-61,-3]]]};
    await owner.plot.update({where:{id:plotId},data:{geometry:replacement,geometry_hash:sha256Canonical(replacement),geometry_version:2}});
    const changedGeometry = await post();
    expect(changedGeometry.statusCode,changedGeometry.body).toBe(202);
    const changed = await waitForQuery(changedGeometry.json().source_query.id);
    expect(changed.geometry_hash).not.toBe(saved.geometry_hash);
    expect(changed.payload).toMatchObject({geometry_version:2,request:{features:[{geometry:replacement}]}});
    const original = await owner.sourceQuery.findUniqueOrThrow({where:{id:saved.id}});
    expect(original.payload).toEqual(saved.payload);
    await owner.plot.update({where:{id:plotId},data:{geometry_version:3}});
    const changedVersion = await post();
    expect(changedVersion.statusCode).toBe(202);
    await waitForQuery(changedVersion.json().source_query.id);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('preserves accepted jobs, reads local history without upstream IO and resumes with one GET per action',async()=>{
    fetchMock.mockResolvedValueOnce(pending()).mockResolvedValueOnce(pending()).mockResolvedValueOnce(completed());
    const initial = await post();
    const queued = await waitForQuery(initial.json().source_query.id,row=>row.job_id==='isolated-job');
    expect(queued.status).toBe('PENDENTE'); expect(queued.http_status).toBe(202);
    const history = await app.inject({url:`/api/v1/lots/${lotId}/assessments`,headers:session});
    expect(history.statusCode).toBe(200);
    expect(history.json().source_queries[0]).toMatchObject({id:queued.id,job_id:'isolated-job',status:'PENDENTE'});
    const cachedPending = await post();
    expect(cachedPending.statusCode).toBe(202); expect(cachedPending.json().assessment.reused_cache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const wrongOptions = await post({resume_query_id:queued.id,options:{nationalCodes:['id']}});
    expect(wrongOptions.statusCode).toBe(409); expect(wrongOptions.json().error.code).toBe('WHISP_QUERY_CHANGED');
    const resumed = await post({resume_query_id:queued.id});
    expect(resumed.statusCode,resumed.body).toBe(202);
    const stillPending = await waitForQuery(resumed.json().source_query.id,row=>(row.result as {assessment?:{attempts?:number}}).assessment?.attempts===1);
    expect(stillPending.status).toBe('PENDENTE');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const finished = await post({resume_query_id:stillPending.id});
    const completedRow = await waitForQuery(finished.json().source_query.id);
    expect(completedRow).toMatchObject({status:'CONCLUIDO',job_id:'isolated-job'});
    expect(fetchMock.mock.calls.map(([,init])=>init?.method)).toEqual(['POST','GET','GET']);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://whisp.test.invalid/api/status/isolated-job');
  });

  it('rejects cross-organization access, absent CSRF and invalid options before provider IO',async()=>{
    expect((await post({},randomUUID(),otherSession)).statusCode).toBe(404);
    expect((await app.inject({url:`/api/v1/lots/${lotId}/assessments`,headers:otherSession})).statusCode).toBe(404);
    expect((await app.inject({method:'POST',url:`/api/v1/lots/${lotId}/assess`,headers:{cookie:session.cookie,'idempotency-key':randomUUID()},payload:{}})).statusCode).toBe(403);
    const invalid = await post({options:{nationalCodes:['BRA']}});
    expect(invalid.statusCode,invalid.body).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await owner.sourceQuery.count({where:{lot_id:lotId}})).toBe(0);
  });

  it('records an unavailable assessment without a credential and never returns a passing check',async()=>{
    vi.stubEnv('WHISP_API_KEY','');
    const ack = await post();
    const row = await waitForQuery(ack.json().source_query.id);
    expect(row).toMatchObject({status:'NAO_AVALIADO',data_provenance:'INDISPONIVEL',http_status:null});
    expect(row.failure_reason).toContain('Credencial');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await owner.check.count({where:{entity_id:lotId,status:'PASSOU'}})).toBe(0);
  });

  it('keeps an explicitly requested local simulation separate from real cached evidence',async()=>{
    fetchMock.mockImplementation(async()=>completed());
    const real = await post(); await waitForQuery(real.json().source_query.id);
    const simulated = await post({use_simulated_fixture:true});
    expect(simulated.statusCode,simulated.body).toBe(202);
    const row = await waitForQuery(simulated.json().source_query.id);
    expect(row).toMatchObject({status:'NAO_AVALIADO',data_provenance:'SIMULADA',assessment_scope:'DEMONSTRATIVO'});
    expect(row.result).toMatchObject({assessment:{integration:'SEM_INTEGRACAO_REAL',simulated_fixture:{status:'SIMULADA'}}});
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
