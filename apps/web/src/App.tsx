import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import PlotMap from './components/Map';
import SatelliteImagery, { type ImageryPlot } from './components/SatelliteImagery';
import ThemeToggle from './components/ThemeToggle';
import ComputingEfficiency from './components/ComputingEfficiency';
import DomainBadge from './components/DomainBadge';
import ForestUtilizationCalculator from './components/ForestUtilizationCalculator';
import { ConnectedMill, ConnectedReview, TracePanel } from './components/DeliveryPanels';
import ConnectedRegistration from './components/ConnectedRegistration';
import { api, ApiError, date, downloadBundle, emptyDashboard, label, type Dashboard, type Entity, type User, UFS, SYNTHETIC_POLYGON } from './lib/api';

const steps = [
  ['01', 'Cadastro da origem', 'Parcela, geometria e evidências'], ['02', 'Origem & sinais', 'Lotes, cobertura e risco'],
  ['03', 'Corte & transporte', 'Movimentações de custódia'], ['04', 'Transformação', 'Entradas, saídas e alocações'],
  ['05', 'Revisão humana', 'Casos, evidências e decisões'], ['06', 'Passaporte', 'Versões e consulta pública'],
  ['07', 'Pacote DDS', 'Exportação e limitações'], ['08', 'Consulta & decisão', 'Acesso público, integridade e revisão'],
] as const;
const navIcons = ['⌖','◉','↗','⌁','✓','▤','⇩','✳'];
const asText = (e: Entity, ...keys: string[]) => { for (const k of keys) if (e[k] != null) return String(e[k]); return '—'; };

export default function App() {
  const [step, setStep] = useState(() => location.pathname.startsWith('/p/') ? 7 : 0);
  const [dash, setDash] = useState<Dashboard>(emptyDashboard);
  const [user, setUser] = useState<User | null>(null);
  const [csrf, setCsrf] = useState('');
  const [personas, setPersonas] = useState<Entity[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [geo, setGeo] = useState(JSON.stringify(SYNTHETIC_POLYGON, null, 2));
  const [uf, setUf] = useState('AM');
  const [publicToken, setPublicToken] = useState(() => location.pathname.startsWith('/p/') ? decodeURIComponent(location.pathname.slice(3)) : '');
  const [passportId, setPassportId] = useState('');
  const [selected, setSelected] = useState('');
  const [comment, setComment] = useState('');
  const [evidence, setEvidence] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      const d = await api<Dashboard & { user?: User }>('/api/v1/dashboard'); setDash({ ...emptyDashboard, ...d });
      if (d.user) setUser({ ...d.user, organization_id: d.user.organization?.id });
      const cookie = document.cookie.split('; ').find(item => item.startsWith('foresttrace_csrf='));
      if (cookie) setCsrf(decodeURIComponent(cookie.slice('foresttrace_csrf='.length)));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setDash(emptyDashboard); setUser(null); setCsrf(''); }
      else setError(`${(e as Error).message} Os dados da tela não foram substituídos por exemplos locais.`);
    }
  }, []);
  useEffect(() => {
    if (location.pathname.startsWith('/p/')) return;
    void refresh();
    void api<{ personas?: Entity[] }>('/api/v1/auth/personas').then(r => setPersonas(r.personas ?? [])).catch(() => setPersonas([]));
  }, [refresh]);
  const action = async (labelText: string, fn: () => Promise<unknown>, onSuccess?: (result: unknown) => void) => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await fn(); onSuccess?.(result); setNotice(labelText); await refresh(); return result; }
    catch (e) { setError(`${(e as Error).message}${e instanceof ApiError && e.code ? ` · ${e.code}` : ''}`); }
    finally { setBusy(false); }
  };
  const post = (path: string, body: unknown) => api(path, { method: 'POST', body, csrf });
  const login = async (id: string) => action('Sessão de demonstração iniciada.', async () => {
    setDash(emptyDashboard); setSelected(''); setEvidence(''); setPassportId(''); setPublicToken('');
    const s = await api<{ user?: User; csrf_token?: string }>('/api/v1/auth/session', { method: 'POST', body: { user_id: id } });
    setUser(s.user ? { ...s.user, organization_id: s.user.organization_id ?? s.user.organization?.id } : null); setCsrf(s.csrf_token ?? '');
  });
  const parsedGeo = useMemo(() => { try { return JSON.parse(geo); } catch { return undefined; } }, [geo]);
  const navTo = (next: number) => { setStep(next); setError(''); setNotice(''); };
  const lists: Record<string, Entity[]> = { plots: dash.plots, origin_lots: dash.origin_lots, shipments: dash.shipments, transformations: dash.transformations, audit_cases: dash.audit_cases, passports: dash.passports };
  const totalLots = dash.origin_lots.length + dash.product_lots.length;
  const orgOptions = dash.organizations.concat(personas.flatMap(p => { const org = p.organization as Entity | undefined; return org?.id ? [{ ...org, id: String(org.id) }] : []; })).filter((org, i, all) => all.findIndex(x => x.id === org.id) === i);
  const metrics = dash.metrics ?? {};

  return <div className="shell ft-app">
    <aside className="sidebar">
      <a className="brand" href="#top" onClick={() => navTo(0)}><span className="logo-surface"><img className="brand-logo" src="/foresttrace-logo.png" alt="ForestTrace" width="2400" height="604" /></span><small>PASSAPORTE DIGITAL DA MADEIRA</small></a>
      <div className="workspace-label">ESPAÇO DE TRABALHO <span>⌄</span></div>
      <div className="org-card"><span className="org-avatar">FT</span><span>Operação demonstrativa<small>Ambiente local</small></span><span className="chevrons">⌄</span></div>
      <div className="nav-heading">FLUXO DE RASTREABILIDADE</div>
      <nav className="step-nav" aria-label="Etapas do fluxo">{steps.map(([n, title, sub], i) => <button key={n} className={`nav-item ${step === i ? 'active' : ''} ${step > i ? 'visited' : ''}`} onClick={() => navTo(i)} aria-current={step === i ? 'step' : undefined}><span className="nav-icon">{navIcons[i]}</span><span className="nav-copy"><b>{title}</b><small>{sub}</small></span><span className="step-num">{step > i ? '✓' : n}</span></button>)}</nav>
      <div className="side-bottom"><span className="pulse"/> API <b>conectividade verificada ao carregar</b><small>v0.1 · ambiente de demonstração</small></div>
    </aside>
    <main id="top" className="main-area">
      <header className="topbar"><button className="mobile-brand" aria-label="ForestTrace — início" onClick={() => navTo(0)}><span className="logo-surface"><img className="brand-logo" src="/foresttrace-logo.png" alt="ForestTrace" width="2400" height="604" /></span></button><div className="breadcrumb">Operação <span>/</span> <b>{steps[step][1]}</b></div><div className="top-actions"><ThemeToggle /><span className="env-chip"><i/> DEMONSTRAÇÃO</span><button className="help-btn" aria-label="Ajuda">?</button><button className="user-pill" onClick={() => document.getElementById('persona-select')?.focus()}><span className="user-avatar">{user?.name?.slice(0,1) ?? 'A'}</span><span>{user?.name ?? 'Selecionar perfil'}<small>{user ? 'Sessão ativa' : 'Sessão não iniciada'}</small></span><span>⌄</span></button></div></header>
      <section className="content">
        <nav className="executive-nav" aria-label="Navegação principal">
          <a href="#visao-geral" aria-current={step === 0 ? 'page' : undefined} onClick={event => { event.preventDefault(); navTo(0); }}>Visão geral</a>
          <a href="#lotes-origens" aria-current={step >= 1 && step <= 4 ? 'page' : undefined} onClick={event => { event.preventDefault(); navTo(1); }}>Lotes e origens</a>
          <a href="#passaporte" aria-current={step >= 5 ? 'page' : undefined} onClick={event => { event.preventDefault(); navTo(5); }}>Passaporte digital</a>
          <a href="#computacao-verde">Computação verde</a>
        </nav>
        <div className="welcome-row"><div><div className="eyebrow">{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date())} <span>·</span> OPERAÇÃO LOCAL</div><h1>{steps[step][1]} <span className="title-leaf">✳</span></h1><p className="subtitle">{steps[step][2]} <span className="dot-sep">·</span> Evidências organizadas da parcela ao produto.</p></div><button className="quiet-button" onClick={() => void refresh()} disabled={busy}>↻ Atualizar dados</button></div>
        <div className="notice-stack" aria-live="polite">{error && <div className="alert alert-error"><b>Não foi possível concluir</b><span>{error}</span><button onClick={() => setError('')} aria-label="Fechar">×</button></div>}{notice && <div className="alert alert-success"><b>✓</b><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Fechar">×</button></div>}</div>
        <div className="stats-grid">
          <Stat icon="⌖" label="PARCELAS REGISTRADAS" value={dash.plots.length} note="Geometrias declaradas" />
          <Stat icon="▰" label="LOTES NA CADEIA" value={totalLots} note="Origem e produtos" />
          <Stat icon="◷" label="CASOS EM REVISÃO" value={dash.audit_cases.filter(c => ['ABERTO','EM_ANALISE','MANTIDO_PENDENTE'].includes(String(c.status))).length} note="Requerem análise humana" tone="amber" />
          <Stat icon="◉" label="PACOTES DDS" value={dash.passports.length} note="Simulados · MISSING_EVIDENCE" tone="red" />
        </div>
        <div className="ft-sim-banner"><span><DomainBadge value="SIMULADA" /> Demonstração: os registros sintéticos não constituem autorização ou resultado real de checagem.</span></div>
        <div className="workspace-grid">
          <div className="primary-column">{step === 0 && <ConnectedRegistration key={user?.id??'anonymous'} geo={geo} setGeo={setGeo} geometry={parsedGeo} uf={uf} setUf={setUf} busy={busy} organizationId={user?.organization_id ?? ''} csrf={csrf} sessionKey={`${user?.id??''}:${csrf}`} onCreate={(body) => action('Parcela persistida; confira os dados em Origem & sinais.', () => post('/api/v1/plots', body))} />}
            {step === 1 && <Origin csrf={csrf} sessionKey={`${user?.id??''}:${csrf}`} dashboard={dash} uf={uf} setUf={setUf} busy={busy} onRefresh={refresh} currentOrgId={user?.organization_id ?? ''} checks={dash.checks} run={action} post={post} />}
            {step === 2 && <Custody key={user?.id??'anonymous'} dashboard={dash} busy={busy} run={action} post={post} orgOptions={orgOptions} currentOrgId={user?.organization_id ?? ''} />}
            {step === 3 && <><ConnectedMill key={user?.id??'anonymous'} dashboard={dash} busy={busy} run={action} post={post} currentOrgId={user?.organization_id ?? ''} /><ForestUtilizationCalculator key={user?.id ?? 'anonymous'} csrf={csrf} disabled={!user} /></>}
            {step === 4 && <ConnectedReview key={user?.id??'anonymous'} userId={user?.id??''} dashboard={dash} busy={busy} run={action} post={post} />}
            {step === 5 && <><PassportForm items={dash.passports} products={dash.product_lots} token={passportId} setToken={setPassportId} busy={busy} run={action} post={post} publicToken={publicToken} setPublicToken={setPublicToken} /><TracePanel key={user?.id??'anonymous'} products={dash.product_lots}/></>}
            {step === 6 && <Bundle items={dash.passports} busy={busy} onDownload={(id, format) => action(`Solicitando exportação ${format.toUpperCase()}…`, () => downloadBundle(id, format))} />}
            {step === 7 && <PublicSearch token={publicToken} setToken={setPublicToken} onReview={() => navTo(4)} />}
            <div className="step-footer"><button className="quiet-button" disabled={step === 0} onClick={() => navTo(step - 1)}>← Etapa anterior</button><span>ETAPA {String(step + 1).padStart(2,'0')} DE 08</span><button className="primary-button" disabled={step === 7} onClick={() => navTo(step + 1)}>Próxima etapa <span>→</span></button></div>
          </div>
          <aside className="right-column"><div className="panel journey-panel"><div className="panel-heading"><div><span className="panel-kicker">VISÃO GERAL</span><h2>Jornada da madeira</h2></div><span className="live-label"><i/> AO VIVO</span></div><Journey plots={dash.plots.length} lots={totalLots} shipments={dash.shipments.length} transformations={dash.transformations.length} passports={dash.passports.length} /></div>
            <div className="panel activity-panel"><div className="panel-heading"><div><span className="panel-kicker">ACOMPANHAMENTO</span><h2>Atividade recente</h2></div><button className="text-link" onClick={() => navTo(4)}>Ver casos →</button></div><Activity dashboard={dash} /></div>
            <div className="integrity-card"><div className="integrity-icon">⌁</div><div><b>Integridade verificável</b><p>Eventos encadeados e evidências versionadas ajudam a reconstruir o histórico. Integridade não comprova a veracidade.</p><span>SHA-256 · trilha auditável</span></div></div>
            <div className="privacy-note"><span>◈</span><p>Coordenadas e documentos ficam restritos a perfis autorizados. A consulta pública mostra apenas região generalizada.</p></div>
          </aside>
        </div>
        <ComputingEfficiency />
        <footer className="page-footer"><span>FORESTTRACE <b>·</b> TRILHA DE EVIDÊNCIAS</span><span>Dados demonstrativos são sintéticos e não representam validação oficial.</span></footer>
      </section>
    </main>
    <div className="persona-float"><label htmlFor="persona-select">PERFIL DE DEMONSTRAÇÃO</label><select id="persona-select" value={user?.id ?? ''} onChange={e => e.target.value && void login(e.target.value)}><option value="">Selecione uma pessoa</option>{personas.map(p => <option key={p.id} value={p.id}>{label(p)}</option>)}</select></div>
  </div>;
}

function Stat({icon,label,value,note,tone='green'}:{icon:string;label:string;value:unknown;note:string;tone?:string}) { return <div className="stat-card"><span className={`stat-icon ${tone}`}>{icon}</span><div className="stat-copy"><span>{label}</span><strong>{value as string}</strong><small>{note}</small></div><span className="stat-trend">↗</span></div>; }
function PanelTitle({kicker,title,action}:{kicker:string;title:string;action?:ReactNode}) { return <div className="panel-title"><div><span className="panel-kicker">{kicker}</span><h2>{title}</h2></div>{action}</div>; }
function Origin({csrf,sessionKey,dashboard,uf,setUf,busy,onRefresh,currentOrgId,checks,run,post}:{csrf:string;sessionKey:string;dashboard:Dashboard;uf:string;setUf:(x:string)=>void;busy:boolean;onRefresh:()=>void;currentOrgId:string;checks:Entity[];run:(l:string,f:()=>Promise<unknown>)=>void;post:(p:string,b:unknown)=>Promise<unknown>}) {
  const [plotId,setPlotId]=useState(''); const [code,setCode]=useState('LT-204'); const [species,setSpecies]=useState('Ipê'); const [scientific,setScientific]=useState('Handroanthus spp.'); const [volume,setVolume]=useState('10'); const [permit,setPermit]=useState('DOC-SINTETICO-001'); const [docId,setDocId]=useState(''); const [dateFrom,setDateFrom]=useState('2026-01-01'); const [dateTo,setDateTo]=useState('2027-01-01'); const [file,setFile]=useState<File|null>(null);
  const uploadEvidence=async()=>{if(!file)return;const content=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.onerror=()=>reject(new Error('Não foi possível ler o arquivo.'));reader.readAsDataURL(file);});const created=await post('/api/v1/documents',{name:file.name,type:file.type||'application/octet-stream',content_base64:content,source:'Arquivo enviado na operação demonstrativa',data_provenance:'SIMULADA',assessment_scope:'DEMONSTRATIVO',visibility:'PRIVATE'}) as {document?:Entity};if(created.document?.id)setDocId(created.document.id);};
  return <><div className="panel form-panel"><PanelTitle kicker="ORIGEM & COBERTURA · PASSO 02" title="Lotes e sinais de origem" action={<span className="status-chip pending">PENDENTE DE VERIFICAÇÃO</span>} /><p className="panel-intro">Acompanhe lotes vinculados às parcelas e o estado das evidências disponíveis para cada jurisdição.</p><div className="coverage-box"><div><span className="panel-kicker">COBERTURA JURISDICIONAL</span><b>Cadastro disponível nas 27 UFs</b><small>O inventário não equivale a regras normativas integralmente confirmadas.</small></div><select value={uf} onChange={e=>setUf(e.target.value)}>{UFS.map(x=><option key={x}>{x}</option>)}</select></div><div className="callout callout-amber"><span>!</span><p><b>{uf} · cobertura normativa não confirmada.</b> Requisitos sem fonte, vigência ou avaliação permanecem PENDENTE. O registro declaratório pode ser mantido, mas não libera prontidão.</p></div><div className="table-wrap"><table><thead><tr><th>LOTE DE ORIGEM</th><th>PARCELA</th><th>VOLUME AUTORIZADO</th><th>ESTADO DA EVIDÊNCIA</th></tr></thead><tbody>{dashboard.origin_lots.map(l=><tr key={l.id}><td><b>{label(l)}</b></td><td>{asText(l,'plot_code','plot_id')}</td><td>{asText(l,'authorized_volume_m3','volume_m3')} m³</td><td><span className="status-chip pending">{asText(l,'status','evidence_status','PENDENTE')}</span></td></tr>)}</tbody></table>{!dashboard.origin_lots.length&&<Empty text="Nenhum lote retornado pela API." />}</div><button className="outline-button" disabled={busy} onClick={onRefresh}>↻ Atualizar lotes</button>
  <h3 className="subheading">Registrar lote e evidência de suporte</h3><p className="form-footnote">Documentos enviados são privados e identificados como simulados. Use arquivos sintéticos neste ambiente.</p><div className="form-grid"><label>Parcela vinculada<select value={plotId} onChange={e=>setPlotId(e.target.value)}><option value="">Selecione parcela retornada pela API</option>{dashboard.plots.map(p=><option key={p.id} value={p.id}>{label(p)} · {asText(p,'state')}</option>)}</select></label><label>Código do lote<input value={code} onChange={e=>setCode(e.target.value)} /></label><label>Espécie comum<input value={species} onChange={e=>setSpecies(e.target.value)} /></label><label>Espécie científica<input value={scientific} onChange={e=>setScientific(e.target.value)} /></label><label>Volume autorizado (m³)<input type="number" min="0.000001" step="0.000001" value={volume} onChange={e=>setVolume(e.target.value)} /></label><label>Referência da autorização<input value={permit} onChange={e=>setPermit(e.target.value)} /></label><label>Válido desde<input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} /></label><label>Válido até<input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} /></label><label>Direito de uso declarado<input defaultValue="Declaração sintética para demonstração" /></label><label>Documento de autorização (privado)<input type="file" accept="application/pdf,image/*" onChange={e=>setFile(e.target.files?.[0]??null)} /></label></div><button className="outline-button" disabled={!file||busy} onClick={()=>void run('Documento enviado e mantido privado.',uploadEvidence)}>Enviar documento privado</button>{docId&&<span className="form-footnote"> Evidência anexada: {docId.slice(0,8)}…</span>}<div><button className="primary-button form-submit" disabled={!plotId||!docId||busy} onClick={()=>run('Lote enviado para validação da API.',()=>post('/api/v1/origin-lots',{plot_id:plotId,code,species_common_name:species,species_scientific_name:scientific,authorized_volume_m3:volume,permit_reference:permit,permit_document_id:docId,valid_from:dateFrom,valid_until:dateTo,right_of_use:'Declaração sintética para demonstração',assessment_scope:'DEMONSTRATIVO',data_provenance:{species_common_name:'SIMULADA',species_scientific_name:'SIMULADA',authorized_volume_m3:'SIMULADA',permit_reference:'SIMULADA'}}))}>Registrar lote <span>→</span></button></div></div><Whisp csrf={csrf} sessionKey={sessionKey} plots={dashboard.plots} key={currentOrgId} lots={dashboard.origin_lots.filter(lot=>lot.organization_id===currentOrgId)} busy={busy} checks={checks} run={run} post={post}/></>;
}
function Custody({dashboard,busy,run,post,orgOptions,currentOrgId}:{dashboard:Dashboard;busy:boolean;run:(l:string,f:()=>Promise<unknown>)=>void;post:(p:string,b:unknown)=>Promise<unknown>;orgOptions:Entity[];currentOrgId:string}) {
  const [lot,setLot]=useState('');const [qty,setQty]=useState('');const [recipient,setRecipient]=useState('');const [destination,setDestination]=useState('SP');const [transporter,setTransporter]=useState('Transportador demonstrativo');const [dateValue,setDateValue]=useState(new Date().toISOString().slice(0,10));const [endDate,setEndDate]=useState(new Date().toISOString().slice(0,10));
  const entity=dashboard.origin_lots.find(x=>x.id===lot);const recipientOrg=orgOptions.find(o=>o.id===recipient);const originState=String((entity?.plot as Entity|undefined)?.state??dashboard.plots.find(p=>p.id===entity?.plot_id)?.state??'AM');
  return <div className="panel form-panel"><PanelTitle kicker="CUSTÓDIA · PASSO 03" title="Registrar corte e remessa" /><p className="panel-intro">As movimentações dependem de saldo e autorização registrados na API. Uma tentativa inválida não deve aparecer como operação confirmada.</p><div className="callout callout-blue"><span>↗</span><p>Remetente e destinatário são organizações distintas. Corte excedente fica como tentativa pendente; não é registrado como produção confirmada.</p></div><div className="form-grid"><label>Lote disponível<select value={lot} onChange={e=>setLot(e.target.value)}><option value="">Selecione um lote</option>{dashboard.origin_lots.map(l=><option key={l.id} value={l.id}>{label(l)} · {asText(l,'authorized_volume_m3')} m³ autorizado</option>)}</select></label><label>Volume de corte (m³)<input value={qty} onChange={e=>setQty(e.target.value)} type="number" min="0.000001" step="0.000001" placeholder="0,00" /></label><label>Início do corte<input type="date" value={dateValue} onChange={e=>setDateValue(e.target.value)} /></label><label>Fim do corte<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)} /></label><label>Organização remetente<input disabled value={orgOptions.find(o=>o.id===currentOrgId)?.name as string??'Organização da sessão'} /></label><label>Organização destinatária<select value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Selecione organização distinta</option>{orgOptions.filter(o=>o.id!==currentOrgId).map(o=><option key={o.id} value={o.id}>{label(o)}</option>)}</select></label><label>UF de destino<select value={destination} onChange={e=>setDestination(e.target.value)}>{UFS.map(x=><option key={x}>{x}</option>)}</select></label><label>Transportador declarado<input value={transporter} onChange={e=>setTransporter(e.target.value)} /></label></div><div className="inline-actions"><button className="primary-button" disabled={busy||!lot||!qty||!entity} onClick={()=>run('Solicitação de corte enviada para validação.',()=>post('/api/v1/harvests',{origin_lot_id:lot,start_date:dateValue,end_date:endDate,volume_m3:qty,species_common_name:asText(entity!,'species_common')}))}>Registrar corte <span>→</span></button><button className="outline-button" disabled={busy||!lot||!qty||!currentOrgId||!recipient||!recipientOrg||recipient===currentOrgId} onClick={()=>run('Solicitação de remessa enviada para validação.',()=>post('/api/v1/shipments',{sender_organization_id:currentOrgId,recipient_organization_id:recipient,origin_state:originState,destination_state:destination,route_states:[originState,destination],items:[{lot_id:lot,volume_m3:qty}],transporter,official_system:'NAO_VERIFICADO',document_ids:[]}))}>Criar remessa</button></div><div className="callout callout-amber"><p>Cobertura normativa {originState} → {destination}: PENDENTE DE VERIFICAÇÃO. O registro declaratório não representa autorização nem libera prontidão.</p></div><ShipmentActions items={dashboard.shipments} organizationId={currentOrgId} busy={busy} run={run} post={post}/><h3 className="subheading">Movimentações retornadas pela API</h3><EntityTable items={dashboard.shipments} cols={['id','status','sender_id','recipient_id']} empty="Nenhuma remessa retornada pela API." /></div>;
}
function Bundle({items,busy,onDownload}:{items:Entity[];busy:boolean;onDownload:(id:string,format:'json'|'html')=>void}) {
  const [id,setId]=useState('');
  const [bundle,setBundle]=useState<Entity|null>(null);
  const [loading,setLoading]=useState(false);
  const [loadError,setLoadError]=useState('');
  useEffect(()=>{if(!id&&items[0]?.id)setId(String(items[0].id));},[id,items]);
  useEffect(()=>{
    if(!id){setBundle(null);setLoadError('');return;}
    let active=true;setLoading(true);setBundle(null);setLoadError('');
    void api<Entity>(`/api/v1/passports/${id}/bundle?format=JSON`).then(value=>{if(active)setBundle(value);}).catch(error=>{if(active)setLoadError((error as Error).message);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[id]);
  const evidence=bundle?.evidence as Entity|undefined;
  const documents=Array.isArray(evidence?.documents)?evidence.documents as Entity[]:[];
  const current=bundle?.current_state as Entity|undefined;
  return <div className="panel form-panel"><PanelTitle kicker="EXPORTAÇÃO · PASSO 07" title="Pacote de evidências" /><p className="panel-intro">Confira os documentos ligados à ancestralidade do passaporte e exporte o pacote JSON ou HTML.</p><div className="callout callout-amber"><span>ⓘ</span><p>Os documentos desta demo são sintéticos. Este pacote não é envio oficial de DDS, não substitui sistemas governamentais e não declara conformidade.</p></div><label className="field-block">Passaporte para consultar e exportar<select value={id} onChange={e=>setId(e.target.value)}><option value="">Selecione um passaporte</option>{items.map(x=><option key={x.id} value={x.id}>{label(x)} · {asText(x,'readiness_status','status')}</option>)}</select></label>
    {loading&&<p className="panel-intro" role="status">Carregando evidências do passaporte…</p>}
    {loadError&&<div className="callout callout-amber" role="alert"><span>!</span><p>Não foi possível carregar as evidências: {loadError}</p></div>}
    {bundle&&!loading&&<section aria-label="Evidências do passaporte"><h3 className="subheading">Documentos de suporte ({documents.length})</h3>{documents.length?<div className="table-wrap"><table><thead><tr><th>DOCUMENTO</th><th>TIPO</th><th>PROCEDÊNCIA</th><th>HASH SHA-256</th></tr></thead><tbody>{documents.map((doc,index)=><tr key={String(doc.id??index)}><td><b>{asText(doc,'name','id')}</b><small>{asText(doc,'source')}</small></td><td>{asText(doc,'type')}</td><td><span className="status-chip pending">{asText(doc,'data_provenance','SIMULADA')}</span></td><td><code>{asText(doc,'content_hash').slice(0,16)}…</code></td></tr>)}</tbody></table></div>:<p className="panel-intro">Este passaporte não tem documentos de suporte acessíveis nesta sessão.</p>}<p className="form-footnote">Estado atual: {asText(current??{id:''},'readiness_status','MISSING_EVIDENCE')}. Hashes ajudam a conferir integridade dos bytes armazenados; não comprovam autenticidade nem validade oficial.</p></section>}
    <div className="export-options"><button disabled={!id||busy} onClick={()=>onDownload(id,'json')}><span>{'{ }'}</span><b>Baixar JSON</b><small>Dados estruturados e proveniência</small><i>↓</i></button><button disabled={!id||busy} onClick={()=>onDownload(id,'html')}><span>▤</span><b>Baixar HTML</b><small>Resumo imprimível do pacote</small><i>↓</i></button></div></div>;
}
type WhispAssessment = {
  result?: string; provenance?: string; reason?: string; job_id?: string; reused_cache?: boolean;
};
type WhispResponse = { assessment: WhispAssessment; source_query: Entity };
function whispAssessment(query: Entity): WhispAssessment {
  const result = query.result;
  if (!result || typeof result !== 'object') return {};
  return ((result as { assessment?: WhispAssessment }).assessment ?? result) as WhispAssessment;
}
function Whisp({lots,plots,csrf,sessionKey,busy,checks,run,post}:{lots:Entity[];plots:Entity[];csrf:string;sessionKey:string;busy:boolean;checks:Entity[];run:(label:string,action:()=>Promise<unknown>)=>void;post:(path:string,body:unknown)=>Promise<unknown>}) {
  const [lotId,setLotId] = useState('');
  const [queries,setQueries] = useState<Entity[]>([]);
  const [latest,setLatest] = useState<WhispResponse|null>(null);
  const [loading,setLoading] = useState(false);
  const [historyError,setHistoryError] = useState('');
  const [simulated,setSimulated] = useState(false);
  const selectedLot = lots.find(lot=>lot.id===lotId);
  const selectedPlot=(selectedLot?.plot as Entity|undefined)??plots.find(plot=>plot.id===selectedLot?.plot_id);
  const imageryPlot=selectedPlot&&typeof selectedPlot.geometry_hash==='string'&&Number.isInteger(selectedPlot.geometry_version)?selectedPlot as unknown as ImageryPlot:undefined;
  const unavailable = busy || loading || !selectedLot;
  useEffect(()=>{
    let active = true;
    setQueries([]); setLatest(null); setHistoryError('');
    if (!lotId || !lots.some(lot=>lot.id===lotId)) { setLoading(false); return; }
    setLoading(true);
    void api<{source_queries:Entity[]}>(`/api/v1/lots/${encodeURIComponent(lotId)}/assessments`)
      .then(response=>{ if(active) {
        setQueries(response.source_queries);
        const first = response.source_queries[0];
        if(first) setLatest({assessment:whispAssessment(first),source_query:first});
      } })
      .catch(error=>{ if(active) setHistoryError((error as Error).message); })
      .finally(()=>{ if(active) setLoading(false); });
    return ()=>{ active=false; };
  },[lotId, lots.map(lot=>lot.id).join(',')]);
  const loadHistory = async () => {
    setLoading(true); setHistoryError('');
    try {
      const response = await api<{source_queries:Entity[]}>(`/api/v1/lots/${encodeURIComponent(lotId)}/assessments`);
      setQueries(response.source_queries);
      setLatest(previous=>{
        const query = response.source_queries.find(row=>row.id===previous?.source_query.id) ?? response.source_queries[0];
        return query ? {assessment:whispAssessment(query),source_query:query} : null;
      });
    } catch (error) { setHistoryError((error as Error).message); }
    finally { setLoading(false); }
  };
  const assess = (options:{refresh?:boolean;resume_query_id?:string}={}) => {
    run('Avaliação Whisp registrada. Confira a procedência e o estado abaixo.',async()=>{
      const response = await post(`/api/v1/lots/${encodeURIComponent(lotId)}/assess`,{
        options:{}, use_simulated_fixture:options.resume_query_id?false:simulated, ...options,
      }) as WhispResponse;
      setLatest(response);
      setQueries(previous=>[response.source_query,...previous.filter(query=>query.id!==response.source_query.id)]);
      return response;
    });
  };
  const current = latest?.assessment;
  const lotChecks = checks.filter(check=>check.entity_id===lotId && check.dimension==='geospatial_check');
  return <div className="panel form-panel">
    <PanelTitle kicker="SINAIS DE ORIGEM · PASSO 02" title="Whisp & indicadores" action={<span className="status-chip pending">REVISÃO CONTEXTUAL</span>} />
    <p className="panel-intro">Consulte os indicadores ambientais da parcela vinculada ao lote. Cada avaliação mantém sua fonte, data e procedência para revisão humana.</p>
    <div className="callout callout-blue"><span>✳</span><p><b>Operação demonstrativa.</b> Os lotes e as geometrias deste ambiente são sintéticos. Uma consulta real à Whisp não confirma a origem física nem libera a prontidão do pacote.</p></div>
    <label className="field-block">Lote para avaliação<select value={selectedLot?lotId:''} disabled={busy||loading} onChange={event=>setLotId(event.target.value)}><option value="">Selecione um lote da sua organização</option>{lots.map(lot=><option key={lot.id} value={lot.id}>{label(lot)}</option>)}</select></label>
    {selectedLot&&imageryPlot?<SatelliteImagery key={selectedLot.id} geometry={selectedPlot?.geometry} plot={imageryPlot} csrf={csrf} sessionKey={sessionKey}/>:selectedLot?<p role="status">Geometria da parcela vinculada indispon?vel. Atualize os dados antes de consultar imagens.</p>:null}
    <label className="field-block"><span><input type="checkbox" checked={simulated} disabled={busy||loading} onChange={event=>setSimulated(event.target.checked)} /> Usar apenas simulação local (DADOS SIMULADOS)</span></label>
    <div className="inline-actions">
      <button className="primary-button" disabled={unavailable} onClick={()=>assess()}>{busy?'Consultando…':simulated?'Registrar simulação':'Consultar Whisp'} <span>→</span></button>
      <button className="outline-button" disabled={unavailable||simulated} onClick={()=>assess({refresh:true})}>Nova consulta sem cache</button>
      <button className="outline-button" disabled={unavailable} onClick={()=>void loadHistory()}>↻ Recarregar histórico</button>
    </div>
    <p className="form-footnote">Consultar Whisp pode reutilizar um resultado compatível já armazenado. Recarregar histórico consulta apenas os registros locais.</p>
    {current?.result==='PENDENTE'&&<p className="form-footnote">Consulta aceita e ainda pendente. Recarregue o histórico para acompanhar o processamento; um job preservado pode ser retomado pelo botão abaixo.</p>}
    <div aria-live="polite">
      {loading&&<p className="form-footnote">Carregando histórico…</p>}
      {historyError&&<div className="alert alert-error" role="alert">{historyError}</div>}
      {current&&<div className="whisp-result"><span>WHISP · {current.provenance==='SIMULADA'?'DADOS SIMULADOS':current.provenance??'INDISPONIVEL'}</span><p>Estado: {current.result??'NAO_AVALIADO'}{current.reused_cache?' · resultado em cache':''}</p><p>{current.reason??'Resultado disponível para revisão contextual; não constitui conclusão de legalidade.'}</p><small>Data do registro: {date(String(latest.source_query.created_at??''))} · Fonte: Whisp{current.job_id?' · job preservado':''}</small></div>}
    </div>
    <h3 className="subheading">Histórico de avaliações</h3>
    {queries.length?<div className="table-wrap"><table><thead><tr><th>DATA DO REGISTRO</th><th>ESTADO</th><th>PROCEDÊNCIA</th><th>ACOMPANHAMENTO</th></tr></thead><tbody>{queries.map(query=>{
      const assessment = whispAssessment(query);
      const pending = query.status==='PENDENTE' && Boolean(query.job_id??assessment.job_id);
      return <tr key={query.id}><td>{date(String(query.created_at??''))}</td><td>{asText(query,'status')}{assessment.reused_cache?' · cache':''}</td><td>{query.data_provenance==='SIMULADA'?'DADOS SIMULADOS':asText(query,'data_provenance')}</td><td>{pending?<button className="outline-button" disabled={unavailable} onClick={()=>assess({resume_query_id:query.id})}>Retomar consulta pendente</button>:'Registro preservado'}</td></tr>;
    })}</tbody></table></div>:<Empty text={selectedLot?'Nenhuma avaliação retornada para este lote.':'Selecione um lote para consultar o histórico.'}/>}
    <h3 className="subheading">Checagens geoespaciais do lote</h3>
    <EntityTable items={lotChecks} cols={['rule_id','status','modality','created_at']} empty="Nenhuma checagem geoespacial retornada para este lote." />
    <div className="callout callout-green"><span>↗</span><p>Sinais ambientais exigem revisão contextual com as evidências e o período aplicável. Indisponibilidade ou ausência de informação mantém a avaliação não avaliada.</p></div>
  </div>;
}
function PublicSearch({token,setToken,onReview}:{token:string;setToken:(v:string)=>void;onReview:()=>void}) {const [result,setResult]=useState<Entity|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const lookup=async()=>{setBusy(true);setError('');setResult(null);try{setResult(await api<Entity>(`/api/v1/public/passports/${encodeURIComponent(token)}`));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};return <div className="panel form-panel"><PanelTitle kicker="CONSULTA · PASSO 08" title="Acesso público & decisão" /><p className="panel-intro">Consulte o resumo público por token e verifique o estado de evidências. A interface pública não expõe documentos, dados pessoais ou coordenadas precisas.</p><label className="field-block">Token de consulta pública<input value={token} onChange={e=>setToken(e.target.value)} placeholder="Cole o token do passaporte" /></label><button className="primary-button" disabled={!token||busy} onClick={()=>void lookup()}>{busy?'Consultando…':'Consultar passaporte'} <span>→</span></button>{error&&<div className="alert alert-error" role="alert">{error}</div>}{result&&<div className="public-result"><div className="passport-stamp">FT</div><div><span className="panel-kicker">RESUMO PÚBLICO · API</span><h3>{label(result)}</h3><span className="status-chip pending">{asText(result,'readiness_status','evidence_status','status')}</span><p>{asText(result,'region','generalized_region','Região não informada')} · sem geometria exata ou PII</p><small>Integridade: {asText(result,'integrity_status','chain_status','não informada pela API')}</small></div></div>}{result&&<PlotMap generalizedRegion={String(result.region??result.generalized_region??'Brasil')} height={240}/>}<div className="callout callout-amber"><span>ⓘ</span><p>Uma decisão humana é registrada na etapa Revisão e exige evidência e justificativa. Resolver um alerta não muda MISSING_EVIDENCE quando o pacote inclui suporte simulado.</p></div><button className="outline-button" onClick={onReview}>Ir para revisão humana ↗</button></div>; }
function ShipmentActions({items,organizationId,busy,run,post}:{items:Entity[];organizationId:string;busy:boolean;run:(label:string,action:()=>Promise<unknown>)=>void;post:(path:string,body:unknown)=>Promise<unknown>}) {
  const [received,setReceived] = useState<Record<string,string>>({});
  return <div>{items.map(shipment => {
    const lines = (shipment.items ?? []) as Array<{lot_id:string;volume_m3:string}>;
    const canDispatch = shipment.sender_id === organizationId && shipment.status === 'CREATED';
    const canReceive = shipment.recipient_id === organizationId && shipment.status === 'DISPATCHED';
    if (!canDispatch && !canReceive) return null;
    return <div className="callout callout-blue" key={shipment.id}><div>
      <b>Remessa {shipment.id.slice(0,8)} · {String(shipment.status)}</b>
      {canDispatch && <button className="outline-button" disabled={busy} onClick={()=>run('Expedição confirmada pelo remetente.',()=>post(`/api/v1/shipments/${shipment.id}/dispatch`,{occurred_at:new Date().toISOString()}))}>Confirmar expedição</button>}
      {canReceive && <>
        {lines.map(line=><label className="field-block" key={line.lot_id}>Volume recebido do lote {line.lot_id.slice(0,8)} (expedido: {line.volume_m3} m³)
          <input aria-label={`Volume recebido ${line.lot_id}`} type="number" min="0.000001" step="0.000001" value={received[`${shipment.id}:${line.lot_id}`]??line.volume_m3} onChange={e=>setReceived({...received,[`${shipment.id}:${line.lot_id}`]:e.target.value})}/>
        </label>)}
        <button className="outline-button" disabled={busy} onClick={()=>run('Recebimento registrado pelo destinatário; confira divergências R09.',()=>post(`/api/v1/shipments/${shipment.id}/receive`,{occurred_at:new Date().toISOString(),items:lines.map(line=>({lot_id:line.lot_id,volume_m3:received[`${shipment.id}:${line.lot_id}`]??line.volume_m3}))}))}>Confirmar recebimento</button>
      </>}
    </div></div>;
  })}</div>;
}

function PassportForm({items,products,token,setToken,busy,run,post,publicToken,setPublicToken}:{items:Entity[];products:Entity[];token:string;setToken:(v:string)=>void;busy:boolean;run:(l:string,f:()=>Promise<unknown>,onSuccess?:(result:unknown)=>void)=>void;post:(p:string,b:unknown)=>Promise<unknown>;publicToken:string;setPublicToken:(v:string)=>void}) {const [productId,setProductId]=useState('');const [qr,setQr]=useState('');const passport=items.find(p=>p.id===token);return <div className="panel form-panel"><PanelTitle kicker="PUBLICAÇÃO · PASSO 06" title="Passaporte digital" /><p className="panel-intro">Gere uma versão pública minimizada a partir de um produto rastreado pela API.</p><div className="callout callout-red"><span>◉</span><p><b>MISSING_EVIDENCE.</b> Todo pacote demonstrativo que inclui evidência simulada permanece sem prontidão, mesmo quando uma checagem demonstrativa é resolvida.</p></div><label className="field-block">Lote de produto<select value={productId} onChange={e=>setProductId(e.target.value)}><option value="">Selecione um produto retornado pela API</option>{products.map(p=><option key={p.id} value={p.id}>{label(p)}</option>)}</select></label><button className="primary-button" disabled={!productId||busy} onClick={()=>run('Passaporte criado pela API; estado de evidência preservado.',()=>post('/api/v1/passports',{product_lot_id:productId,assessment_scope:'DEMONSTRATIVO'}),result=>{const passport=(result as {passport?:Entity})?.passport;if(passport?.id)setToken(passport.id);if(passport?.public_token)setPublicToken(String(passport.public_token));const image=(result as {qr_data_url?:string}).qr_data_url;if(image)setQr(image);})}>Gerar passaporte <span>→</span></button>{passport&&<div className="passport-card"><div className="passport-stamp">FT</div><div><span className="panel-kicker">RESUMO PRIVADO · PASSAPORTE</span><h3>{label(passport)}</h3><p>Versão {asText(passport,'version')} · região pública generalizada</p><DomainBadge value="MISSING_EVIDENCE" /></div></div>}{qr&&<img src={qr} width={180} height={180} alt="QR para consulta pública do passaporte"/>}{publicToken&&<div className="callout callout-green"><span>✓</span><p>Token público recebido da API. <a href={`/p/${encodeURIComponent(publicToken)}`} target="_blank" rel="noreferrer">Abrir consulta pública ↗</a></p></div>}<label className="field-block">Consultar passaporte emitido<select value={token} onChange={e=>setToken(e.target.value)}><option value="">Selecione um passaporte</option>{items.map(p=><option key={p.id} value={p.id}>{label(p)} · {asText(p,'status','readiness_status')}</option>)}</select></label></div>; }
function EntityTable({items,cols,empty}:{items:Entity[];cols:string[];empty:string}) {return <div className="table-wrap"><table><thead><tr>{cols.map(c=><th key={c}>{c.replaceAll('_',' ').toUpperCase()}</th>)}</tr></thead><tbody>{items.map(item=><tr key={item.id}>{cols.map(c=><td key={c}>{asText(item,c)}</td>)}</tr>)}</tbody></table>{!items.length&&<Empty text={empty}/>}</div>; }
function Empty({text}:{text:string}) {return <div className="empty-state"><span>⌕</span><p>{text}</p></div>;}
function Journey({plots,lots,shipments,transformations,passports}:{plots:number;lots:number;shipments:number;transformations:number;passports:number}) {const values=[plots,lots,shipments,transformations,passports];const names=['Origem','Lotes','Transporte','Serraria','Passaporte'];const icons=['⌖','▰','↗','⌁','▤'];return <div className="journey">{names.map((name,i)=><div key={name} className={`journey-node ${values[i]?'done':''}`}><span className="journey-icon">{icons[i]}</span><span>{name}</span><b>{values[i]}</b></div>)}</div>; }
function Activity({dashboard}:{dashboard:Dashboard}) {const all=[...dashboard.audit_cases.map(x=>({...x,_kind:'Caso',_title:asText(x,'rule_code','reason','Revisão')})),...dashboard.transformations.map(x=>({...x,_kind:'Transformação',_title:label(x)})),...dashboard.shipments.map(x=>({...x,_kind:'Remessa',_title:label(x)}))].slice(0,4);return all.length?<div className="activity-list">{all.map((x,i)=><div className="activity-item" key={x.id}><span className={`activity-dot d${i%3}`}/><div><b>{x._title}</b><small>{x._kind} <span>·</span> {asText(x,'status','created_at')}</small></div><time>{date((x as Entity).created_at)}</time></div>)}</div>:<Empty text="A atividade aparecerá conforme a API registrar eventos."/>; }
