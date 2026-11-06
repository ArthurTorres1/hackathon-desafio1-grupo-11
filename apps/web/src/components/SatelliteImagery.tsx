import type { Static } from '@sinclair/typebox';
import type { ImageryScene, ImageryCapabilities, ImagerySearchResponseSchema, ImageryReferenceSchema, ImageryReferencesResponseSchema } from '@foresttrace/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import PlotMap, { type SatelliteOverlay } from './Map';
import { api, ApiError, date } from '../lib/api';

export type ImageryPlot = { id:string; geometry_hash:string; geometry_version:number; geometry?:unknown };
type Scene = ImageryScene;
type Capabilities = ImageryCapabilities;
type SearchResult = Static<typeof ImagerySearchResponseSchema>;
type Selection = {scene:Scene;query:Omit<SearchResult,'scenes'>;context:string};
type Reference = Static<typeof ImageryReferenceSchema>;
type References = Static<typeof ImageryReferencesResponseSchema>;
const MAX_PNG_BYTES=8*1024*1024;
const imageryDate=(value:string)=>Number.isNaN(Date.parse(value))?'não informada':new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeZone:'UTC'}).format(new Date(value));
const scenePeriod=(scene:Scene)=>scene.start_datetime&&scene.end_datetime ? `${imageryDate(scene.start_datetime)} a ${imageryDate(scene.end_datetime)} (UTC) · composição temporal` : scene.datetime ? `${imageryDate(scene.datetime)} (UTC) · aquisição informada` : 'Data de aquisição não informada';
function privateImageUrl(value:string|null|undefined):string|null {
  if(!value)return null;
  try {const url=new URL(value,location.origin);return url.origin===location.origin&&url.pathname.startsWith('/api/v1/imagery/queries/')?url.href:null;}catch{return null;}
}
function readableProvenance(value:unknown):string {
  if(typeof value==='string')return value;
  if(value&&typeof value==='object'&&'label' in value)return String(value.label);
  return 'Contexto declarado da geometria';
}
function initialDates(){const end=new Date();const start=new Date(end);start.setUTCFullYear(start.getUTCFullYear()-1);return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10)};}

/** Private controls shared by the unsaved form and the actual parcel associated with a lot. */
export default function SatelliteImagery({geometry,plot,linkTarget,csrf,sessionKey,disabled=false}:{geometry:unknown;plot?:ImageryPlot;linkTarget?:ImageryPlot;csrf:string;sessionKey:string;disabled?:boolean}) {
  const defaults=useMemo(initialDates,[]);
  const [start,setStart]=useState(defaults.start),[end,setEnd]=useState(defaults.end),[collection,setCollection]=useState('');
  const [capabilities,setCapabilities]=useState<Capabilities|null>(null),[capabilityError,setCapabilityError]=useState('');
  const [result,setResult]=useState<SearchResult|null>(null),[selection,setSelection]=useState<Selection|null>(null),[loading,setLoading]=useState(false),[searchError,setSearchError]=useState('');
  const [renderState,setRenderState]=useState<'idle'|'loading'|'ready'|'failed'>('idle'),[renderError,setRenderError]=useState(''),[image,setImage]=useState<{context:string;url:string;sceneKey:string}|null>(null);
  const [showImage,setShowImage]=useState(true),[showBase,setShowBase]=useState(true),[opacity,setOpacity]=useState(.8);
  const [references,setReferences]=useState<Reference[]>([]),[referenceError,setReferenceError]=useState(''),[referenceLoading,setReferenceLoading]=useState(false);
  const [linkState,setLinkState]=useState<{sceneKey:string;targetId:string;state:'loading'|'saved'|'failed';message:string}|null>(null);
  const requests=useRef<AbortController|null>(null),renderRequest=useRef<AbortController|null>(null),linkRequest=useRef<AbortController|null>(null),sequence=useRef(0);
  const autoLinkAttempted=useRef(new Set<string>());
  const geometryKey=useMemo(()=>JSON.stringify(geometry??null),[geometry]);
  const context=JSON.stringify([sessionKey,plot?.id??'draft',plot?.geometry_version??null,plot?.geometry_hash??null,geometryKey,start,end,collection]);
  const currentContext=useRef(context);currentContext.current=context;
  const target=plot??linkTarget;
  const selected=selection?.context===context?selection:null;
  const resultContext=useRef('');
  const activeResult=result&&resultContext.current===context?result:null;
  function cancelAndClear(){sequence.current++;requests.current?.abort();renderRequest.current?.abort();linkRequest.current?.abort();setResult(null);setSelection(null);setSearchError('');setRenderError('');setRenderState('idle');setImage(null);setLoading(false);setShowBase(true);setLinkState(null);}

  useEffect(()=>{
    const controller=new AbortController();setCapabilities(null);setCapabilityError('');
    if(disabled||!sessionKey)return;
    void api<Capabilities>('/api/v1/imagery/capabilities',{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setCapabilities(value);}).catch(error=>{if(!controller.signal.aborted)setCapabilityError((error as Error).message);});
    return()=>controller.abort();
  },[sessionKey,disabled]);
  useEffect(()=>{cancelAndClear();return()=>{requests.current?.abort();renderRequest.current?.abort();linkRequest.current?.abort();};},[context]);
  useEffect(()=>{
    const controller=new AbortController();setReferences([]);setReferenceError('');setReferenceLoading(false);
    if(!plot?.id||disabled)return;
    setReferenceLoading(true);
    void api<References>(`/api/v1/plots/${encodeURIComponent(plot.id)}/imagery-references`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setReferences(value.references);}).catch(error=>{if(!controller.signal.aborted)setReferenceError((error as Error).message);}).finally(()=>{if(!controller.signal.aborted)setReferenceLoading(false);});
    return()=>controller.abort();
  },[plot?.id,plot?.geometry_hash,plot?.geometry_version,sessionKey,disabled]);

  async function search(cursor?:string){
    if(!capabilities?.enabled)return;
    requests.current?.abort();renderRequest.current?.abort();setSelection(null);setImage(null);setRenderState('idle');setShowBase(true);setSearchError('');
    if(!start||!end||start>end){setSearchError('Período inválido: informe início e fim em ordem cronológica.');return;}
    if(!plot&&!geometry){setSearchError('Informe uma geometria GeoJSON válida antes de buscar.');return;}
    const controller=new AbortController();requests.current=controller;const requestId=++sequence.current;const requestedContext=context;setLoading(true);
    const body={...(!plot?{geometry}:{}),datetime:`${start}T00:00:00.000Z/${end}T23:59:59.999Z`,...(collection?{collection_ids:[collection]}:{}),...(cursor?{cursor}:{})};
    try {
      const value=await api<SearchResult>(plot?`/api/v1/plots/${encodeURIComponent(plot.id)}/imagery/search`:'/api/v1/imagery/search',{method:'POST',body,csrf,signal:controller.signal});
      if(controller.signal.aborted||requestId!==sequence.current||currentContext.current!==requestedContext)return;
      resultContext.current=requestedContext;setResult(value);
    }catch(error){if(!controller.signal.aborted&&requestId===sequence.current&&currentContext.current===requestedContext)setSearchError(`${error instanceof ApiError?`${error.code}: `:''}${(error as Error).message}`);}
    finally {if(!controller.signal.aborted&&requestId===sequence.current)setLoading(false);}
  }
  function choose(scene:Scene,query:Omit<SearchResult,'scenes'>){renderRequest.current?.abort();setImage(null);setRenderError('');setLinkState(null);setSelection({scene,query,context});setShowImage(true);}
  useEffect(()=>{
    setImage(null);setRenderError('');setRenderState('idle');
    if(!selected||!capabilities?.enabled)return;
    const renderUrl=privateImageUrl(selected.scene.render_url);
    if(!selected.scene.renderable||!selected.scene.render_bounds||!renderUrl){setRenderState('failed');setRenderError('SEM_VISUALIZACAO: esta cena não possui composição georreferenciada compatível.');return;}
    const controller=new AbortController();renderRequest.current=controller;let blobUrl:string|null=null;const requestedContext=context;const sceneKey=selected.scene.scene_key;setRenderState('loading');
    void (async()=>{
      try {
        const response=await fetch(renderUrl,{credentials:'include',signal:controller.signal});
        if(!response.ok){const detail=await response.json().catch(()=>null) as {error?:{code?:string;message?:string}}|null;throw new Error(`${detail?.error?.code??'SEM_VISUALIZACAO'}: ${detail?.error?.message??'Não foi possível renderizar a imagem; metadados preservados.'}`);}
        if(!response.headers.get('content-type')?.startsWith('image/png'))throw new Error('SEM_VISUALIZACAO: o servidor não retornou uma composição PNG.');
        const size=Number(response.headers.get('content-length')??0);if(size>MAX_PNG_BYTES)throw new Error('SEM_VISUALIZACAO: imagem excede o limite de visualização.');
        const blob=await response.blob();if(blob.size>MAX_PNG_BYTES)throw new Error('SEM_VISUALIZACAO: imagem excede o limite de visualização.');
        if(controller.signal.aborted||currentContext.current!==requestedContext)return;
        blobUrl=URL.createObjectURL(blob);setImage({context:requestedContext,url:blobUrl,sceneKey});setRenderState('ready');
      }catch(error){if(!controller.signal.aborted&&currentContext.current===requestedContext){setRenderState('failed');setRenderError((error as Error).message);setShowBase(true);}}
    })();
    return()=>{controller.abort();if(blobUrl)URL.revokeObjectURL(blobUrl);};
  },[selected?.scene.scene_key,selected?.query.query_id,context,capabilities?.enabled]);

  async function link(){
    if(!selected||!target)return;
    linkRequest.current?.abort();const controller=new AbortController();linkRequest.current=controller;const requestedContext=context;const selectedScene=selected.scene.scene_key;const targetId=target.id;
    setLinkState({sceneKey:selectedScene,targetId,state:'loading',message:'Vinculando referência à parcela já cadastrada…'});
    try {
      if(target.geometry_hash!==selected.query.geometry_hash)throw new Error('A geometria da parcela difere da consulta; busque novamente antes de vincular.');
      await api(`/api/v1/plots/${encodeURIComponent(targetId)}/imagery-references`,{method:'POST',body:{query_id:selected.query.query_id,scene_key:selectedScene,geometry_version:target.geometry_version},csrf,signal:controller.signal});
      if(!controller.signal.aborted&&currentContext.current===requestedContext)setLinkState({sceneKey:selectedScene,targetId,state:'saved',message:'Referência visual privada vinculada. Avaliações e prontidão não foram alteradas.'});
      if(plot&&currentContext.current===requestedContext){
        // Refresh metadata separately; a failed refresh must never turn a committed link into a failed write.
        void api<References>(`/api/v1/plots/${encodeURIComponent(targetId)}/imagery-references`,{signal:controller.signal}).then(value=>{if(!controller.signal.aborted&&currentContext.current===requestedContext)setReferences(value.references);}).catch(()=>{});
      }
    }catch(error){if(!controller.signal.aborted&&currentContext.current===requestedContext)setLinkState({sceneKey:selectedScene,targetId,state:'failed',message:`A parcela permanece cadastrada. O vínculo da imagem falhou: ${(error as Error).message}`});}
  }
  useEffect(()=>{
    if(!linkTarget?.id||!selected||autoLinkAttempted.current.has(linkTarget.id))return;
    autoLinkAttempted.current.add(linkTarget.id);void link();
  },[linkTarget?.id,selected?.scene.scene_key]);

  const overlay:SatelliteOverlay|null=selected&&image?.context===context&&image.sceneKey===selected.scene.scene_key&&selected.scene.render_bounds&&showImage?{url:image.url,bounds:selected.scene.render_bounds,opacity,label:`Composição RGB INPE · ${selected.scene.item_id} · ${scenePeriod(selected.scene)}`}:null;
  return <section aria-label="Imagens privadas INPE" className="satellite-imagery">
    <PlotMap geometry={geometry} height={300} overlay={overlay} showBaseMap={showBase} onOverlayError={()=>{setRenderState('failed');setRenderError('SEM_VISUALIZACAO: falha ao abrir o PNG georreferenciado.');setImage(null);setShowBase(true);}}/>
    <h3 className="subheading">Imagens de satélite INPE</h3>
    <p className="form-footnote">Contexto visual privado da parcela. Imagem disponível não comprova autorização, origem ou ausência de desmatamento. A imagem real sobre geometria sintética continua demonstrativa.</p>
    {disabled?<p>Inicie uma sessão para buscar imagens.</p>:capabilityError?<p className="field-error" role="status">INDISPONIVEL: {capabilityError} O cadastro e o mapa-base continuam disponíveis.</p>:!capabilities?<p role="status">Consultando configuração de imagens…</p>:!capabilities.enabled?<p role="status">Integração INPE desabilitada neste ambiente. Cadastro, mapa-base e histórico privado permanecem disponíveis.</p>:<>
      <div className="form-grid"><label>Imagens desde<input type="date" value={start} onChange={event=>{cancelAndClear();setStart(event.target.value);}}/></label><label>Imagens até<input type="date" value={end} onChange={event=>{cancelAndClear();setEnd(event.target.value);}}/></label><label className="full">Coleção INPE<select value={collection} onChange={event=>{cancelAndClear();setCollection(event.target.value);}}><option value="">Coleções habilitadas no servidor</option>{capabilities.collection_ids.map(id=><option value={id} key={id}>{id}</option>)}</select></label></div>
      <p className="form-footnote">Limites: {capabilities.limits.max_area_ha.toLocaleString('pt-BR')} ha; período de até {capabilities.limits.max_period_years} anos; {capabilities.limits.max_scenes_per_page} cenas por página; PNG até {capabilities.limits.max_render_side} × {capabilities.limits.max_render_side} pixels. Resultados da página ordenados por data; inventário não necessariamente completo.</p>
      <div className="inline-actions"><button className="outline-button" disabled={loading} aria-busy={loading} onClick={()=>void search()}>{loading?'Buscando imagens…':'Buscar imagens INPE'}</button>{loading&&<button className="quiet-button" onClick={cancelAndClear}>Cancelar busca</button>}{activeResult?.next_cursor&&<button className="outline-button" disabled={loading} onClick={()=>void search(activeResult.next_cursor!)}>Próxima página de imagens</button>}</div>
      {searchError&&<p className="field-error" role="alert">{searchError} O mapa-base e o cadastro continuam disponíveis. Tente novamente ou altere os filtros.</p>}
      {activeResult&&<><p className="form-footnote">Consulta {date(activeResult.queried_at)}{activeResult.cached?' · resultado em cache; horário original preservado':''}. Proveniência do contexto: {readableProvenance(activeResult.context_provenance)}.</p>{activeResult.status==='SEM_IMAGENS'?<p role="status">SEM_IMAGENS: nenhuma cena retornada para este período e área. Isso não permite concluir ausência de floresta ou legalidade.</p>:<ul style={{paddingLeft:'1.25rem'}}>{activeResult.scenes.map(scene=><li key={scene.scene_key} style={{marginBlock:'1rem'}}><b>{scene.collection_id} · {scene.item_id}</b><p>{scenePeriod(scene)} · Nuvens: {scene.cloud_cover===null?'não informadas':`${scene.cloud_cover.toLocaleString('pt-BR')}%`}</p><button className="outline-button" aria-pressed={selected?.scene.scene_key===scene.scene_key} onClick={()=>choose(scene,activeResult)}>Selecionar cena {scene.item_id}</button>{!scene.renderable&&<p>SEM_VISUALIZACAO · metadados disponíveis</p>}</li>)}</ul>}</>}
      {selected&&<><div className="case-detail"><div><small>CENA SELECIONADA</small><b>{selected.scene.item_id}</b><p>{selected.scene.collection_id}</p></div><div><small>DATA DA IMAGEM</small><p>{scenePeriod(selected.scene)}</p></div><div><small>PLATAFORMA / SENSOR</small><p>{selected.scene.platform??'Não informada'} · {selected.scene.instruments?.join(', ')||'Sensor não informado'}</p></div></div><p className="form-footnote">Fonte: INPE / Brazil Data Cube. {selected.scene.attribution} Licença declarada: {selected.scene.license??'não informada'}. A cena pode cobrir apenas parte da parcela; áreas sem dados ficam transparentes.</p><p className="form-footnote">{selected.scene.limitations?.join(' ')}</p>
        <div className="inline-actions"><label className="field-block"><span><input type="checkbox" checked={showBase} onChange={event=>setShowBase(event.target.checked)}/>Mostrar mapa-base OpenStreetMap</span></label><label className="field-block"><span><input type="checkbox" checked={showImage} disabled={renderState!=='ready'} onChange={event=>setShowImage(event.target.checked)}/>Mostrar imagem INPE</span></label></div><label className="field-block">Opacidade da imagem INPE: {Math.round(opacity*100)}%<input type="range" min="0" max="1" step="0.05" value={opacity} onChange={event=>setOpacity(Number(event.target.value))}/></label>
        {renderState==='loading'&&<p role="status">Renderizando composição RGB georreferenciada…</p>}{renderError&&<p className="field-error" role="alert">{renderError} A seleção de metadados foi preservada.</p>}
        {!selected.scene.renderable&&privateImageUrl(selected.scene.preview_url)&&<figure><img src={privateImageUrl(selected.scene.preview_url)!} alt="Prévia INPE sem referência espacial; não utilizada como camada no mapa" style={{maxWidth:'100%'}}/><figcaption>Prévia sem georreferenciamento — não é overlay da parcela.</figcaption></figure>}
        {target?<><button className="outline-button" disabled={linkState?.state==='loading'||linkState?.state==='saved'} onClick={()=>void link()}>{linkState?.state==='failed'?'Tentar vínculo novamente':linkState?.state==='saved'?'Referência vinculada':'Vincular cena à parcela'}</button>{linkState&&<p role={linkState.state==='failed'?'alert':'status'} className={linkState.state==='failed'?'field-error':'form-footnote'}>{linkState.message}</p>}</>:<p className="form-footnote">A seleção é um rascunho. Após cadastrar a parcela, o vínculo será tentado separadamente, sem repetir o cadastro em caso de falha.</p>}
      </>}
    </>}
    {plot&&<><h3 className="subheading">Referências de imagens desta parcela</h3>{referenceLoading&&<p role="status">Carregando histórico privado…</p>}{referenceError&&<p className="field-error" role="alert">Histórico indisponível: {referenceError}</p>}{!referenceLoading&&!referenceError&&!references.length&&<p>Nenhuma referência retornada para esta parcela.</p>}{references.map(reference=><details key={reference.id}><summary>{reference.scene.item_id} · versão {reference.geometry_version} · {reference.is_current?'geometria atual':'versão anterior — metadados preservados'}</summary><p>{scenePeriod(reference.scene)} · registro {date(reference.created_at)}</p><p>Fonte: INPE. {reference.scene.attribution} Licença: {reference.scene.license??'não informada'}.</p>{reference.is_current&&capabilities?.enabled?<button className="outline-button" onClick={()=>choose(reference.scene,{query_id:reference.query_id,geometry_hash:reference.geometry_hash,geometry_version:reference.geometry_version,status:'SUCESSO',next_cursor:null,queried_at:reference.created_at,cached:false,context_provenance:'REFERENCIA_PRESERVADA',limitations:[]})}>Reabrir cena vinculada</button>:<p>Esta referência não será aplicada automaticamente à geometria atual.</p>}</details>)}</>}
  </section>;
}
