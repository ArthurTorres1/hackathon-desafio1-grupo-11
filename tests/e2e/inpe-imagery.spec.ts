import { expect, test, type Page } from '@playwright/test';

const geometry={type:'Polygon',coordinates:[[[-60,-3],[-59.999,-3],[-59.999,-2.999],[-60,-2.999],[-60,-3]]]};
const hash='a'.repeat(64);
const plot={id:'plot-one',geometry,geometry_hash:hash,geometry_version:1};
const scene={scene_key:'b'.repeat(64),collection_id:'S2-16D-2',item_id:'TEST-INPE',datetime:null,start_datetime:'2026-10-16T00:00:00Z',end_datetime:'2026-10-31T23:59:59Z',cloud_cover:null,platform:null,instruments:[],license:null,attribution:'INPE / BDC',renderable:true,render_bounds:[[-60,-3],[-59.999,-2.999]],render_url:'/api/v1/imagery/queries/query-one/scenes/scene-one/render',limitations:[]};
const result={query_id:'query-one',geometry_hash:hash,geometry_version:null,status:'SUCESSO',scenes:[scene],next_cursor:null,queried_at:'2026-11-06T12:00:00Z',cached:false,context_provenance:'SIMULADA',limitations:[]};
async function setup(page:Page,{enabled=true,linkFails=false}={}) {
  const calls={creates:0,links:0,searches:0,paths:[] as string[]};
  let sessionId='person';
  await page.route(/tile\.openstreetmap\.org/,route=>route.abort());
  await page.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;calls.paths.push(path);
    let data:unknown={};let status=200;
    if(path.endsWith('/dashboard'))data={user:{id:sessionId,name:'Operadora',organization:{id:'org'}},plots:[plot],origin_lots:[{id:'lot-one',code:'Lote A',organization_id:'org',plot_id:plot.id,plot},{id:'lot-two',code:'Lote B',organization_id:'org',plot_id:'plot-two',plot:{...plot,id:'plot-two',geometry_hash:'c'.repeat(64),geometry_version:2}}]};
    else if(path.endsWith('/auth/personas'))data={personas:[{id:'person',name:'Operadora inicial'},{id:'person-two',name:'Outra sessão'}]};
    else if(path.endsWith('/auth/session')){sessionId=route.request().postDataJSON().user_id;data={user:{id:sessionId,name:'Operadora',organization_id:'org'},csrf_token:`csrf-${sessionId}`};}
    else if(path.endsWith('/imagery/capabilities'))data={enabled,collection_ids:['S2-16D-2'],limits:{max_area_ha:10000,max_period_years:5,max_scenes_per_page:20,max_pages:5,max_render_side:1024},limitations:[]};
    else if(path.endsWith('/imagery/search')){calls.searches++;data=result;}
    else if(path.endsWith('/render')){status=503;data={error:{code:'INDISPONIVEL',message:'Asset indisponível'}};}
    else if(path==='/api/v1/plots'){calls.creates++;status=201;data={plot};}
    else if(path.endsWith('/imagery-references')){
      if(route.request().method()==='POST'){calls.links++;if(linkFails&&calls.links===1){status=503;data={error:{code:'INDISPONIVEL',message:'Falha temporária'}};}else data={reference:{}};}
      else data={plot_id:plot.id,current_geometry_hash:hash,current_geometry_version:1,references:[]};
    }else if(path.endsWith('/assessments'))data={source_queries:[]};
    await route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto('/');
  return calls;
}

test('preserva cadastro e permite repetir apenas vínculo após falha do INPE',async({page})=>{
  const calls=await setup(page,{linkFails:true});
  await page.getByRole('button',{name:'Buscar imagens INPE',exact:true}).click();
  await page.getByRole('button',{name:'Selecionar cena TEST-INPE'}).click();
  await expect(page.getByText('Nuvens: não informadas',{exact:false})).toBeVisible();
  await expect(page.getByRole('alert').filter({hasText:'Asset indisponível'})).toBeVisible();
  await page.getByRole('button',{name:/Registrar parcela/}).click();
  await expect(page.getByRole('button',{name:'Tentar vínculo novamente'})).toBeVisible();
  await page.getByRole('button',{name:'Tentar vínculo novamente'}).click();
  await expect(page.getByRole('button',{name:'Referência vinculada'})).toBeVisible();
  expect(calls.creates).toBe(1);expect(calls.links).toBe(2);
});

test('busca indisponível preserva campos e permite cadastrar sem imagem',async({page})=>{
  const calls=await setup(page);
  await page.route('**/api/v1/imagery/search',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'INDISPONIVEL',message:'Catálogo indisponível'}})}));
  await page.getByLabel('Identificação da propriedade *').fill('Parcela preservada');
  const before=await page.getByRole('textbox',{name:'GeoJSON da parcela'}).inputValue();
  await page.getByRole('button',{name:'Buscar imagens INPE',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Catálogo indisponível'})).toBeVisible();
  await expect(page.getByLabel('Identificação da propriedade *')).toHaveValue('Parcela preservada');
  await expect(page.getByRole('textbox',{name:'GeoJSON da parcela'})).toHaveValue(before);
  await page.getByRole('button',{name:/Registrar parcela/}).click();
  await expect.poll(()=>calls.creates).toBe(1);expect(calls.links).toBe(0);
});

test('descarta busca antiga ao trocar sessão',async({page})=>{
  await setup(page);
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let started=false;
  await page.route('**/api/v1/imagery/search',async route=>{started=true;await held;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)}).catch(()=>{});});
  await page.getByRole('button',{name:'Buscar imagens INPE',exact:true}).click();
  await expect.poll(()=>started).toBe(true);
  await page.locator('#persona-select').selectOption('person-two');
  await expect(page.locator('#persona-select')).toHaveValue('person-two');
  release();
  await expect(page.getByRole('button',{name:'Selecionar cena TEST-INPE'})).toHaveCount(0);
  await expect(page.getByText('CENA SELECIONADA')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Buscar imagens INPE',exact:true})).toBeEnabled();
});

test('cena incompatível preserva metadados sem criar overlay',async({page})=>{
  const calls=await setup(page);
  await page.route('**/api/v1/imagery/search',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...result,scenes:[{...scene,renderable:false,render_url:null,render_bounds:null}]})}));
  await page.getByRole('button',{name:'Buscar imagens INPE',exact:true}).click();
  await page.getByRole('button',{name:'Selecionar cena TEST-INPE'}).click();
  await expect(page.getByRole('alert').filter({hasText:'SEM_VISUALIZACAO'})).toBeVisible();
  await expect(page.getByText('CENA SELECIONADA')).toBeVisible();
  await expect(page.getByRole('img',{name:/Composição RGB INPE/})).toHaveCount(0);
  expect(calls.paths.some(path=>path.endsWith('/render'))).toBe(false);
  await expect(page.getByRole('button',{name:/Registrar parcela/})).toBeEnabled();
});

test('invalida cena ao editar geometria e mantém cadastro disponível',async({page})=>{
  await setup(page);
  await page.getByRole('button',{name:'Buscar imagens INPE',exact:true}).click();
  await page.getByRole('button',{name:'Selecionar cena TEST-INPE'}).click();
  await page.getByRole('textbox',{name:'GeoJSON da parcela'}).fill(JSON.stringify({...geometry,coordinates:[[[-61,-3],[-60.999,-3],[-60.999,-2.999],[-61,-2.999],[-61,-3]]]}));
  await expect(page.getByText('CENA SELECIONADA')).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Registrar parcela/})).toBeEnabled();
});

test('descarta resposta atrasada após alterar filtro',async({page})=>{
  await setup(page);
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let started=false;
  await page.route('**/api/v1/imagery/search',async route=>{
    started=true;await held;
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)}).catch(()=>{});
  });
  await page.getByRole('button',{name:'Buscar imagens INPE',exact:true}).click();
  await expect.poll(()=>started).toBe(true);
  await page.getByLabel('Imagens desde',{exact:true}).fill('2026-01-01');
  release();
  await expect(page.getByRole('button',{name:'Selecionar cena TEST-INPE'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Buscar imagens INPE',exact:true})).toBeEnabled();
});

test('mostra overlay privado com controles de base e opacidade',async({page},info)=>{
  await setup(page);
  await page.route('**/render',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1sAAAAASUVORK5CYII=','base64')}));
  await page.getByRole('button',{name:'Buscar imagens INPE',exact:true}).click();
  await page.getByRole('button',{name:'Selecionar cena TEST-INPE'}).click();
  const image=page.getByRole('img',{name:/Composição RGB INPE/});
  await expect(image).toBeVisible();
  await page.getByRole('slider',{name:/Opacidade da imagem INPE/}).fill('0.35');
  await expect(image).toHaveCSS('opacity','0.35');
  await page.getByLabel('Mostrar mapa-base OpenStreetMap').uncheck();
  await expect(image).toBeVisible();
  await page.getByLabel('Mostrar imagem INPE').uncheck();
  await expect(image).toHaveCount(0);
  await page.screenshot({path:info.outputPath('inpe-private-controls.png'),fullPage:true});
});

test('flag desabilitada conserva cadastro e não inicia busca',async({page})=>{
  const calls=await setup(page,{enabled:false});
  await expect(page.getByText('Integração INPE desabilitada neste ambiente.',{exact:false})).toBeVisible();
  await expect(page.getByRole('button',{name:'Buscar imagens INPE',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:/Registrar parcela/}).click();
  await expect.poll(()=>calls.creates).toBe(1);expect(calls.searches).toBe(0);
});

test('consulta parcela associada ao lote selecionado e limpa seleção ao trocar lote',async({page})=>{
  const calls=await setup(page);
  await page.locator('.step-footer .primary-button').click();
  await page.getByLabel('Lote para avaliação').selectOption('lot-one');
  await page.getByRole('button',{name:'Buscar imagens INPE',exact:true}).click();
  await page.getByRole('button',{name:'Selecionar cena TEST-INPE'}).click();
  await page.getByLabel('Lote para avaliação').selectOption('lot-two');
  await expect(page.getByText('CENA SELECIONADA')).toHaveCount(0);
  await page.getByRole('button',{name:'Buscar imagens INPE',exact:true}).click();
  expect(calls.paths).toContain('/api/v1/plots/plot-one/imagery/search');
  expect(calls.paths).toContain('/api/v1/plots/plot-two/imagery/search');
});

test('preserva metadados de versão anterior com integração desabilitada',async({page})=>{
  await setup(page,{enabled:false});
  await page.route('**/plots/*/imagery-references',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({plot_id:plot.id,current_geometry_hash:hash,current_geometry_version:2,references:[{id:'reference-old',query_id:'query-one',scene_key:scene.scene_key,geometry_hash:'d'.repeat(64),geometry_version:1,is_current:false,scene,created_at:'2026-11-06T12:00:00Z'}]})}));
  await page.locator('.step-footer .primary-button').click();
  await page.getByLabel('Lote para avaliação').selectOption('lot-one');
  await page.getByText('TEST-INPE · versão 1',{exact:false}).click();
  await expect(page.getByText('Esta referência não será aplicada automaticamente à geometria atual.')).toBeVisible();
  await expect(page.getByRole('button',{name:'Reabrir cena vinculada'})).toHaveCount(0);
});
