import { useState } from 'react';
import PlotMap from './Map';
import { SYNTHETIC_POLYGON, UFS } from '../lib/api';

function validateGeometry(value: unknown): string | null {
  const geometry = value as { type?: string; coordinates?: unknown[] } | null;
  if (!geometry || !['Polygon','MultiPolygon'].includes(geometry.type??'') || !Array.isArray(geometry.coordinates)) return 'Informe uma geometria Polygon ou MultiPolygon em GeoJSON.';
  const polygons = geometry.type==='Polygon' ? [geometry.coordinates] : geometry.coordinates;
  if (!polygons.length) return 'A geometria precisa de ao menos um polígono.';
  for (const polygon of polygons) {
    if (!Array.isArray(polygon)||!polygon.length) return 'Polígono sem anel exterior.';
    for (const ring of polygon) {
      if (!Array.isArray(ring)||ring.length<4) return 'Cada anel deve ter ao menos quatro posições.';
      for (const position of ring) if (!Array.isArray(position)||position.length<2||!Number.isFinite(position[0])||!Number.isFinite(position[1])||position[0]<-180||position[0]>180||position[1]<-90||position[1]>90) return 'Coordenadas fora dos limites de longitude e latitude.';
      if (ring[0][0]!==ring.at(-1)[0]||ring[0][1]!==ring.at(-1)[1]) return 'Anel aberto: a última posição deve repetir a primeira.';
    }
  }
  return null;
}

export default function ConnectedRegistration({geo,setGeo,geometry,uf,setUf,busy,organizationId,onCreate}:{geo:string;setGeo:(value:string)=>void;geometry:unknown;uf:string;setUf:(value:string)=>void;busy:boolean;organizationId:string;onCreate:(body:unknown)=>void}) {
  const [name,setName]=useState('Fazenda demonstrativa'), [municipality,setMunicipality]=useState('Parintins'), [informant,setInformant]=useState(''), [source,setSource]=useState('Exemplo sintético ForestTrace'), [error,setError]=useState('');
  const submit = () => {
    let parsed: unknown;
    try { parsed=JSON.parse(geo); } catch { setError('GeoJSON inválido. Corrija a estrutura JSON antes de enviar.'); return; }
    const problem = validateGeometry(parsed);
    if (problem) { setError(problem); return; }
    setError('');
    onCreate({organization_id:organizationId,country:'BR',state:uf,municipality,declared_property:name,geometry:parsed,geometry_version:1,geometry_date:new Date().toISOString().slice(0,10),data_provenance:{declared_property:{label:'SIMULADA',source:source.trim()||'Declaração sintética',informed_by:informant.trim()||'Operador autenticado',recorded_at:new Date().toISOString(),confidence:'NAO_AVALIADA'},geometry:'SIMULADA',municipality:'DECLARACAO_DO_USUARIO'}});
  };
  return <div className="panel form-panel"><div className="panel-title"><div><span className="panel-kicker">ORIGEM FLORESTAL · PASSO 01</span><h2>Cadastrar parcela</h2></div><span className="required-label">* CAMPOS OBRIGATÓRIOS</span></div><p className="panel-intro">Registre a origem declarada e confira seu contorno. O cadastro não comprova propriedade ou autorização.</p>{!organizationId&&<div className="callout callout-blue"><p>Selecione um perfil de demonstração para iniciar sessão antes de gravar.</p></div>}<div className="form-grid"><label>Identificação da propriedade *<input value={name} onChange={event=>setName(event.target.value)} /></label><label>UF da origem *<select value={uf} onChange={event=>setUf(event.target.value)}>{UFS.map(state=><option key={state}>{state}</option>)}</select></label><label>Município *<input value={municipality} onChange={event=>setMunicipality(event.target.value)} /></label><label>Informante declarado<input value={informant} onChange={event=>setInformant(event.target.value)} /></label><label className="full">Fonte da informação<input value={source} onChange={event=>setSource(event.target.value)} /></label></div><div className="geo-header"><div><b>Geometria GeoJSON *</b><small>EPSG:4326 · DADOS SIMULADOS</small></div><button className="outline-button" onClick={()=>{setGeo(JSON.stringify(SYNTHETIC_POLYGON,null,2));setError('');}}>Carregar exemplo sintético</button></div><div className="geo-grid"><textarea aria-label="GeoJSON da parcela" value={geo} onChange={event=>{setGeo(event.target.value);setError('');}} spellCheck={false}/><PlotMap geometry={geometry} height={240}/></div>{error&&<p className="field-error" role="alert">{error}</p>}<div className="callout callout-amber"><p><b>Origem declarada, não certificada.</b> PostGIS valida a topologia e calcula hectares na API. Nenhum polígono inválido é reparado automaticamente.</p></div><button className="primary-button" disabled={busy||!organizationId||!name.trim()||!municipality.trim()} onClick={submit}>{busy?'Enviando…':'Registrar parcela'} →</button></div>;
}
