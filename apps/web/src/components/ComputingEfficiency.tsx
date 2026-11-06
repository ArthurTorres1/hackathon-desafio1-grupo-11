import { useState } from 'react';

export default function ComputingEfficiency() {
  const [navigation, setNavigation] = useState<PerformanceNavigationTiming | undefined>();
  return <section id="computacao-verde" className="panel efficiency-panel ft-feature" aria-labelledby="efficiency-title">
    <span className="panel-kicker">COMPUTAÇÃO VERDE · TELEMETRIA LOCAL</span>
    <h2 id="efficiency-title">Medir antes de estimar impacto</h2>
    <p>Cache, processamento e IA devem ser avaliados por carga equivalente. Ainda não há medição de energia ou emissões nesta aplicação.</p>
    <button className="ft-btn ft-btn--secondary" onClick={() => setNavigation(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)}>Medir carregamento desta página</button>
    <dl><dt>Carregamento da navegação · {navigation?.duration ? 'Medido' : 'Não medido'}</dt><dd>{navigation?.duration ? `${Math.round(navigation.duration)} ms` : 'Sem amostra coletada'}</dd></dl>
    <p>Amostra: uma navegação do navegador atual. Inclui carregamento da página, sem medir consultas posteriores, CPU, IA ou mapa separadamente. Cache: sem taxa medida. Nenhum valor é convertido em economia de energia ou CO₂.</p>
  </section>;
}
