import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { ForestUtilizationResponse as Report } from '@foresttrace/contracts';
const initial = { area_total_ha: '120', area_app_ha: '20', area_effective_ha: '100', extracted_log_volume_m3: '2100', declared_sawn_volume_m3: '714', management_profile_id: 'DEMO_MECHANIZED_35Y_V1', dap_cm: '', commercial_height_m: '' };
type Fields = typeof initial;
const names: [keyof Fields, string][] = [['area_total_ha', 'Área total (ha)'], ['area_app_ha', 'Área de APP (ha)'], ['area_effective_ha', 'Área efetiva declarada (ha) — opcional'], ['extracted_log_volume_m3', 'Tora extraída (m³)'], ['declared_sawn_volume_m3', 'Madeira serrada declarada (m³)'], ['dap_cm', 'DAP (cm) — cubagem opcional'], ['commercial_height_m', 'Altura comercial (m) — cubagem opcional']];
const outputNames: Record<string, string> = { area_effective_ha: 'Área efetiva (ha)', capacity_m3: 'Capacidade sob o perfil (m³)', intensity_m3_ha: 'Intensidade declarada (m³/ha)', utilization_pct: 'Aproveitamento sob o perfil (%)', excess_m3: 'Excesso sob o perfil (m³)', crv_pct: 'CRV observado (%)', expected_sawn_m3: 'Serrado esperado sob o perfil (m³)', residue_difference_m3: 'Diferença entre tora e serrado (m³)', additional_log_equivalent_m3: 'Volume adicional equivalente condicional (m³)', volume_m3: 'Cubagem estimada (m³)' };

export default function ForestUtilizationCalculator({ csrf, disabled }: { csrf: string; disabled: boolean }) {
  const [fields, setFields] = useState<Fields>(initial);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const revision = useRef(0);
  function update(next: Fields) { revision.current++; setFields(next); setReport(null); setError(''); }
  async function calculate(event: FormEvent) {
    event.preventDefault(); setReport(null); setError('');
    const decimal = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;
    if (names.some(([key]) => fields[key] !== '' && !decimal.test(fields[key])) || names.filter(([key]) => !['area_effective_ha', 'dap_cm', 'commercial_height_m'].includes(key)).some(([key]) => fields[key] === '')) {
      setError('Informe números não negativos com ponto decimal e até seis casas.'); return;
    }
    if (Boolean(fields.dap_cm) !== Boolean(fields.commercial_height_m)) { setError('Para cubagem, informe DAP e altura comercial juntos.'); return; }
    const { dap_cm, commercial_height_m, area_effective_ha, ...required } = fields;
    const body = { ...required, ...(area_effective_ha ? { area_effective_ha } : {}), ...(dap_cm ? { tree: { dap_cm, commercial_height_m } } : {}) };
    const submitted = revision.current;
    setPending(true);
    try {
      const result = await api<Report>('/api/v1/calculations/forest-utilization', { method: 'POST', body, csrf });
      if (revision.current === submitted) setReport(result);
    } catch (cause) { if (revision.current === submitted) setError(cause instanceof ApiError ? cause.message : 'Não foi possível acessar o serviço de cálculo. Tente novamente.'); }
    finally { setPending(false); }
  }
  return <section className="panel form-panel forest-calculator" aria-labelledby="forest-calculator-title">
    <div className="panel-title"><div><span className="panel-kicker">CÁLCULO EXPLORATÓRIO</span><h2 id="forest-calculator-title">Cubagem e aproveitamento</h2></div><span className="status-chip pending">DADOS SIMULADOS</span></div>
    <p className="panel-intro">Compare medidas declaradas com perfis demonstrativos. Este cálculo não cria saldo, autorização ou passaporte e não altera a prontidão do lote.</p>
    <div className="inline-actions"><button type="button" className="quiet-button" onClick={() => update({ ...initial })}>Carregar exemplo 1</button><button type="button" className="quiet-button" onClick={() => update({ ...initial, area_total_ha: '60', area_app_ha: '10', area_effective_ha: '50', extracted_log_volume_m3: '1850', declared_sawn_volume_m3: '1100' })}>Carregar exemplo 2</button></div>
    <form onSubmit={event => void calculate(event)}>
      <div className="form-grid">{names.map(([key, name]) => <label className="field-block" key={key}>{name}<input inputMode="decimal" value={fields[key]} onChange={event => update({ ...fields, [key]: event.target.value })} /></label>)}
        <label className="field-block">Perfil de manejo demonstrativo<select value={fields.management_profile_id} onChange={event => update({ ...fields, management_profile_id: event.target.value })}><option value="DEMO_MECHANIZED_35Y_V1">Mecanizado · 30 m³/ha · ciclo inicial 35 anos</option><option value="DEMO_NON_MECHANIZED_10Y_V1">Sem máquinas · 10 m³/ha · ciclo 10 anos</option></select></label>
      </div>
      <p className="form-footnote">A área efetiva não é inferida pela diferença entre área total e APP. Em branco, a avaliação da origem fica não avaliada. Cubagem usa fator demonstrativo 0,70; o CRV de referência é 35%. Um laudo não aplica automaticamente 45%.</p>
      {disabled && <p className="field-error">Inicie uma sessão de demonstração para calcular.</p>}
      <button className="primary-button" disabled={disabled || pending} type="submit">{pending ? 'Calculando…' : 'Calcular aproveitamento'}</button>
    </form>
    {error && <p className="field-error" role="alert">{error}</p>}
    {report && <div aria-live="polite" data-testid="forest-calculation-report">
      <h3 className="subheading">Resultado demonstrativo · {report.readiness}</h3>
      <p>Ausência de divergência matemática não confirma conformidade. O volume equivalente não comprova injeção ilegal ou fraude.</p>
      {([['Origem', report.origin], ['Serraria', report.mill], ['Árvore', report.tree]] as const).map(([title, metric]) => <section key={title} className="calculation-metric"><h3>{title} · {metric.result}</h3><p>{metric.explanation}</p><dl>{Object.entries(metric).filter(([key]) => outputNames[key]).map(([key, value]) => <div key={key}><dt>{outputNames[key]}</dt><dd>{value ?? 'Não avaliado'}</dd></div>)}</dl></section>)}
      <h3>Parâmetros e fontes</h3>
      <p>Intensidade do perfil: {report.parameters.management.intensity_m3_ha} m³/ha · ciclo inicial: {report.parameters.management.initial_cycle_years} anos · coeficiente CRV: {report.parameters.conversion.coefficient} · fator de forma: {report.parameters.tree.form_factor}.</p>
      {Object.values(report.parameters).map(parameter => <p key={parameter.id}><b>{parameter.id}</b> · versão {parameter.version} · {parameter.source}</p>)}
      <h3>Fórmulas utilizadas</h3><ul>{Object.entries(report.formulas).map(([key, formula]) => <li key={key}>{formula}</li>)}</ul>
      <h3>Lacunas e limites</h3><ul>{report.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>
    </div>}
  </section>;
}
