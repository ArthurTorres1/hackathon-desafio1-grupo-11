import { expect, test, type Page } from '@playwright/test';

const producer='10000000-0000-4000-8000-000000000091', mill='10000000-0000-4000-8000-000000000092';
const user='20000000-0000-4000-8000-000000000091', author='20000000-0000-4000-8000-000000000092';
const plot='30000000-0000-4000-8000-000000000091', origin='60000000-0000-4000-8000-000000000091', product='71000000-0000-4000-8000-000000000091';
const caseId='80000000-0000-4000-8000-000000000091', checkId='81000000-0000-4000-8000-000000000091', documentId='40000000-0000-4000-8000-000000000091', parameter='50000000-0000-4000-8000-000000000091';
const geometry={type:'Polygon',coordinates:[[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]]};
const dashboard={
  user:{id:user,name:'Auditora distinta',roles:['OPERATOR','AUDITOR'],organization:{id:mill,name:'Serraria sintética'}},
  organizations:[{id:producer,name:'Origem sintética',state:'AM'},{id:mill,name:'Serraria sintética',state:'SP'}],
  plots:[{id:plot,declared_property:'Parcela sintética',state:'AM',geometry}],
  origin_lots:[{id:origin,code:'DELIVERY-A',organization_id:producer,plot_id:plot,available_m3:'10',authorized_volume_m3:'10',plot:{id:plot,state:'AM',geometry}}],
  product_lots:[{id:product,code:'SERR-C',volume_m3:'3'}],
  shipments:[{id:'shipment-id',sender_id:producer,recipient_id:mill,status:'RECEIVED',items:[{lot_id:origin,volume_m3:'10',received_volume_m3:'10'}]}],
  transformations:[],passports:[],
  audit_cases:[{id:caseId,check_id:checkId,created_by_user_id:author,rule_id:'R10',status:'ABERTO',decisions:[{id:'decision-id',decision:'EM_ANALISE',comment:'Documento recebido para análise',reviewer_user_id:author,created_at:'2026-11-06T12:00:00Z',evidence_ids:[documentId]}]}],
  checks:[{id:checkId,rule_id:'R10',status:'ALERTA',name:'Rendimento de conversão',rule_version:'1',message:'Saída5 acima do limite3.5',values:{input_m3:'10',output_m3:'5',limit_m3:'3.5'},source:{source_url:'https://example.invalid/demo'},suggested_action:'Conferir documento de exceção',assessment_scope:'DEMONSTRATIVO',created_at:'2026-11-06T12:00:00Z'}],
  documents:[{id:documentId,name:'Exceção sintética',data_provenance:'SIMULADA'}],
  conversion_parameters:[{id:parameter,input_product:'tora',output_product:'serrado',coefficient:'0.35',version:'DEMO1'}],metrics:{},
};
async function setup(page:Page) {
  await page.context().addCookies([{name:'foresttrace_csrf',value:'synthetic-csrf',url:'http://127.0.0.1:5173'}]);
  await page.route('**/api/v1/auth/personas',route=>route.fulfill({json:{personas:[]}}));
  await page.route('**/api/v1/dashboard',route=>route.fulfill({json:dashboard}));
  await page.route(/https:\/\/[^/]*tile\.openstreetmap\.org\//,route=>route.abort());
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Registrar parcela'})).toBeEnabled();
}
async function step(page:Page,count:number){for(let index=0;index<count;index++)await page.getByRole('button',{name:'Próxima etapa'}).click();}

test('cadastro rejeita anel aberto e persiste fonte e informante do exemplo',async({page})=>{
  await setup(page);let submitted:Record<string,unknown>|undefined;
  await page.route('**/api/v1/plots',route=>{submitted=route.request().postDataJSON();return route.fulfill({status:201,json:{plot:{id:plot}}});});
  await page.getByLabel('GeoJSON da parcela').fill(JSON.stringify({type:'Polygon',coordinates:[[[-60,-3],[-59,-3],[-59,-2],[-60,-2]]]}));
  await page.getByRole('button',{name:'Registrar parcela'}).click();
  await expect(page.getByRole('alert')).toContainText('Anel aberto');expect(submitted).toBeUndefined();
  await page.getByRole('button',{name:'Carregar exemplo sintético'}).click();
  await page.getByLabel('Fonte da informação').fill('Fixture de cadastro');await page.getByLabel('Informante declarado').fill('Operadora sintética');
  await page.getByRole('button',{name:'Registrar parcela'}).click();
  await expect(page.getByText('Parcela persistida; confira os dados em Origem & sinais.')).toBeVisible();
  expect(submitted).toMatchObject({country:'BR',geometry,data_provenance:{declared_property:{source:'Fixture de cadastro',informed_by:'Operadora sintética',label:'SIMULADA'}}});
});

test('transformação apresenta erro JSON e envia volume recebido com resíduos e perdas',async({page})=>{
  await setup(page);await step(page,3);let submitted:Record<string,unknown>|undefined;
  await page.route('**/api/v1/transformations',route=>{submitted=route.request().postDataJSON();return route.fulfill({status:201,json:{transformation:{id:'transformed'}}});});
  await page.getByLabel('Identificação da transformação').fill('SERR-UI');
  await page.getByLabel('Parâmetro de conversão').selectOption(parameter);
  await page.getByLabel('Lote de entrada').selectOption(origin);
  await page.getByLabel('Alocações medidas (JSON)',{exact:true}).fill('{');
  await page.getByRole('button',{name:'Registrar transformação',exact:false}).click();
  await expect(page.getByText(/JSON inválido nas entradas/)).toBeVisible();expect(submitted).toBeUndefined();
  await page.getByRole('button',{name:'Preencher alocação para conferir'}).click();
  await page.getByRole('button',{name:'Registrar transformação',exact:false}).click();
  await expect(page.getByText('Transformação persistida; confira saldo, alocações e checagens.')).toBeVisible();
  expect(submitted).toMatchObject({inputs:[{lot_id:origin,volume_m3:'10'}],outputs:[{product:'serrado',volume_m3:'3',allocations:[{origin_lot_id:origin,volume_m3:'3'}]}],residue_m3:'7',loss_m3:'0'});
});

test('revisão mostra fonte limite histórico e envia decisão com documento privado',async({page})=>{
  await setup(page);await step(page,4);let submitted:Record<string,unknown>|undefined;
  await page.route(`**/api/v1/audit-cases/${caseId}/decisions`,route=>{submitted=route.request().postDataJSON();return route.fulfill({status:201,json:{decision:{id:'new-decision'}}});});
  await page.getByLabel('Caso de revisão').selectOption(caseId);
  await expect(page.getByText('Saída5 acima do limite3.5')).toBeVisible();
  await expect(page.getByText(/Valor, limite e parâmetros/)).toContainText('3.5');
  await expect(page.getByText('Documento recebido para análise')).toBeVisible();
  await page.getByLabel('Justificativa da decisão').fill('Manter pendente até verificar documento aplicável.');
  await page.getByLabel('Evidência privada de suporte').selectOption(documentId);
  await page.getByRole('button',{name:'Registrar decisão'}).click();
  await expect(page.getByText('Decisão registrada; histórico original e evidências preservados.')).toBeVisible();
  expect(submitted).toMatchObject({decision:'MANTIDO_PENDENTE',evidence_ids:[documentId]});
});

test('trace mostra quantidades medidas e mapas privados mesmo sem tiles',async({page},testInfo)=>{
  await setup(page);await step(page,5);
  await page.route(`**/api/v1/product-lots/${product}/trace`,route=>route.fulfill({json:{product_lot:{id:product,code:'SERR-C'},provenance:[{id:'allocation-known',origin_lot_id:origin,volume_m3:'1.8',fraction:'0.6'},{id:'allocation-unknown',origin_lot_id:null,volume_m3:'1.2',fraction:'0.4'}],ancestry:{plots:dashboard.plots,origin_lots:dashboard.origin_lots,transformations:[],shipments:dashboard.shipments},metrics:{known_volume_m3:'1.8',unknown_volume_m3:'1.2',total_volume_m3:'3',tracked_fraction:'0.6',generated_at:'2026-11-06T12:00:00Z',duration_ms:12}}}));
  await page.getByLabel('Produto para rastrear').selectOption(product);
  await expect(page.getByText('1.8 / 3 m³',{exact:true})).toBeVisible();
  await expect(page.getByText('1.2 / 3 m³',{exact:true})).toBeVisible();
  await expect(page.getByRole('cell',{name:'Origem desconhecida',exact:true})).toBeVisible();
  await expect(page.getByLabel('Mapa da parcela declarada')).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('trace-delivery.png'),fullPage:true});
});
