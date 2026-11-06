import { expect, test, type Page } from '@playwright/test';

const orgId = '11000000-0000-4000-8000-000000000001';
const lotId = '61000000-0000-4000-8000-000000000001';
const queryId = '71000000-0000-4000-8000-000000000001';
const secondQueryId = '71000000-0000-4000-8000-000000000002';
const person = { id:'21000000-0000-4000-8000-000000000001', name:'Operadora Whisp',
  organization:{id:orgId,name:'Origem sintética'}, roles:['OPERATOR'] };
type Assessment = {result:string;provenance:string;reason?:string;job_id?:string;reused_cache?:boolean};
function query(assessment: Assessment, id = queryId) {
  return { id, created_at:'2026-11-06T12:00:00Z', status:assessment.result, job_id:assessment.job_id,
    data_provenance:assessment.provenance, result:{assessment, response:{coordinates:'private-sentinel-coordinates',secret:'private-sentinel-secret'}} };
}
type Query = ReturnType<typeof query>;

async function whispPage(page: Page, initial: Query[] = []) {
  const state = {rows:initial,posts:[] as Array<Record<string,unknown>>,historyReads:0,
    next:query({result:'PENDENTE',provenance:'INDISPONIVEL',reason:'Consulta registrada; acompanhe pelo histórico.'}),
    status:202};
  await page.context().addCookies([{name:'foresttrace_csrf',value:'fixture-csrf',url:'http://127.0.0.1:5173'}]);
  await page.route('**/*',async route=>{
    const request = route.request(); const url = new URL(request.url());
    // No external fonts, maps, APIs or provider requests leave the browser in this suite.
    if(url.hostname!=='127.0.0.1' && url.hostname!=='localhost') return route.abort();
    if(!url.pathname.startsWith('/api/')) return route.continue();
    if(url.pathname==='/api/v1/auth/personas') return route.fulfill({json:{personas:[person]}});
    if(url.pathname==='/api/v1/auth/session') return route.fulfill({json:{user:person,csrf_token:'fixture-csrf'}});
    if(url.pathname==='/api/v1/dashboard') return route.fulfill({json:{
      user:person,organizations:[person.organization],plots:[],
      origin_lots:[{id:lotId,code:'WHISP-SINTETICO-01',organization_id:orgId,assessment_scope:'DEMONSTRATIVO',authorized_volume_m3:'10'},
        {id:'61000000-0000-4000-8000-000000000099',code:'LOTE-OUTRA-ORGANIZACAO',organization_id:'outra-organizacao'}],
      product_lots:[],shipments:[],transformations:[],audit_cases:[],passports:[],conversion_parameters:[],documents:[],metrics:{},
      checks:[{id:'check-whisp',entity_id:lotId,dimension:'geospatial_check',rule_id:'GEO_PROVIDER',status:'NAO_AVALIADO',modality:'SIMULADA',created_at:'2026-11-06T12:00:00Z'}],
    }});
    if(url.pathname===`/api/v1/lots/${lotId}/assessments`) {
      state.historyReads++;
      return route.fulfill({json:{source_queries:state.rows,sources:[]}});
    }
    if(url.pathname===`/api/v1/lots/${lotId}/assess` && request.method()==='POST') {
      state.posts.push(request.postDataJSON());
      expect(request.headers()['x-csrf-token']).toBe('fixture-csrf');
      expect(request.headers()['idempotency-key']).toMatch(/^[a-f0-9-]{36}$/);
      const assessment = state.next.result.assessment;
      return route.fulfill({status:state.status,json:{assessment,source_query:state.next}});
    }
    return route.fulfill({status:404,json:{error:{code:'UNMOCKED_ENDPOINT',message:'Endpoint não configurado neste teste.'}}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Próxima etapa'}).click();
  await expect(page.getByRole('heading',{name:'Whisp & indicadores'})).toBeVisible();
  return state;
}

test('Whisp acompanha ack pendente e resultado real pelo histórico local, preservando a demo e privacidade',async({page})=>{
  const state = await whispPage(page);
  const selector = page.getByLabel('Lote para avaliação');
  await expect(selector.getByRole('option',{name:'LOTE-OUTRA-ORGANIZACAO'})).toHaveCount(0);
  await selector.selectOption(lotId);
  await expect(page.getByRole('button',{name:'Consultar Whisp'})).toBeEnabled();
  await page.getByRole('button',{name:'Consultar Whisp'}).click();
  await expect(page.locator('.whisp-result')).toContainText('Estado: PENDENTE');
  await expect(page.getByText('Consulta aceita e ainda pendente.',{exact:false})).toBeVisible();
  expect(state.posts).toEqual([{options:{},use_simulated_fixture:false}]);

  state.rows = [query({result:'CONCLUIDO',provenance:'REAL_CONSULTADA',reason:'Indicadores disponíveis para revisão contextual.'})];
  const reads = state.historyReads;
  await page.getByRole('button',{name:'Recarregar histórico'}).click();
  await expect(page.locator('.whisp-result')).toContainText('Estado: CONCLUIDO');
  await expect(page.locator('.whisp-result')).toContainText('REAL_CONSULTADA');
  await expect(page.locator('.whisp-result')).toContainText('Fonte: Whisp');
  await expect(page.getByText('Uma consulta real à Whisp não confirma a origem física nem libera a prontidão do pacote.',{exact:false})).toBeVisible();
  await expect(page.getByRole('cell',{name:'NAO_AVALIADO',exact:true})).toBeVisible();
  expect(state.historyReads).toBe(reads+1); expect(state.posts).toHaveLength(1);
  await expect(page.locator('body')).not.toContainText('private-sentinel');

  state.status = 200;
  state.next = query({result:'CONCLUIDO',provenance:'REAL_CONSULTADA',reused_cache:true});
  await page.getByRole('button',{name:'Consultar Whisp'}).click();
  await expect(page.locator('.whisp-result')).toContainText('resultado em cache');
  state.status = 202; state.next = query({result:'PENDENTE',provenance:'INDISPONIVEL'},secondQueryId);
  await page.getByRole('button',{name:'Nova consulta sem cache'}).click();
  await expect.poll(()=>state.posts.length).toBe(3);
  expect(state.posts[2]).toMatchObject({refresh:true,use_simulated_fixture:false});
});

test('Whisp registra uma simulação explícita com selo DADOS SIMULADOS e sem prontidão',async({page})=>{
  const state = await whispPage(page);
  await page.getByLabel('Lote para avaliação').selectOption(lotId);
  await page.getByRole('checkbox',{name:'Usar apenas simulação local (DADOS SIMULADOS)'}).check();
  await expect(page.getByRole('button',{name:'Nova consulta sem cache'})).toBeDisabled();
  state.next = query({result:'NAO_AVALIADO',provenance:'SIMULADA',reason:'Simulação local; nenhuma consulta ambiental real foi realizada.'});
  await page.getByRole('button',{name:'Registrar simulação'}).click();
  await expect(page.locator('.whisp-result')).toContainText('WHISP · DADOS SIMULADOS');
  await expect(page.locator('.whisp-result')).toContainText('Estado: NAO_AVALIADO');
  expect(state.posts).toEqual([{options:{},use_simulated_fixture:true}]);
  await expect(page.getByText('Os lotes e as geometrias deste ambiente são sintéticos.',{exact:false})).toBeVisible();
});

test('Whisp retoma um job preservado e mostra falha de histórico sem inventar resultados',async({page})=>{
  const state = await whispPage(page,[query({result:'PENDENTE',provenance:'INDISPONIVEL',job_id:'provider-job-test'})]);
  await page.getByLabel('Lote para avaliação').selectOption(lotId);
  await expect(page.getByRole('button',{name:'Retomar consulta pendente'})).toBeEnabled();
  state.next = query({result:'PENDENTE',provenance:'INDISPONIVEL',job_id:'provider-job-test'},secondQueryId);
  await page.getByRole('button',{name:'Retomar consulta pendente'}).click();
  await expect.poll(()=>state.posts.length).toBe(1);
  expect(state.posts[0]).toEqual({options:{},use_simulated_fixture:false,resume_query_id:queryId});
  await expect(page.locator('.whisp-result')).toContainText('job preservado');
  await expect(page.getByRole('button',{name:'Recarregar histórico'})).toBeEnabled();
  await page.route(`**/api/v1/lots/${lotId}/assessments`,route=>route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'Histórico temporariamente indisponível.'}}}));
  await page.getByRole('button',{name:'Recarregar histórico'}).click();
  await expect(page.getByRole('alert')).toContainText('Histórico temporariamente indisponível.');
  await expect(page.locator('.whisp-result')).toContainText('Estado: PENDENTE');
  expect(state.posts).toHaveLength(1);
});
