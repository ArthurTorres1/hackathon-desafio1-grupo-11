# Fontes, procedência e limites

Atualizado em 2026-11-05. Dados operacionais nos fixtures e no GeoJSON de demonstração são sintéticos. Nenhuma fonte externa foi consultada para os cenários de demonstração. O nome científico associado ao nome comum angelim-vermelho está registrado apenas como exemplo e permanece **PENDENTE DE VERIFICAÇÃO** taxonômica para a origem proposta.

## Evidência geográfica

`data/public_samples/demo-plot.geojson` contém polígono numérico criado para teste. Não possui fonte geográfica externa, licença de terceiros ou município real associados. A área de referência de cerca de 122,93 ha é uma aproximação aritmética WGS84 para a extensão do quadrado e não um resultado PostGIS; deve ser recalculada no banco antes de servir como valor de sistema. Coordenadas não afirmam propriedade, posse, autorização de corte ou localização de uma parcela real. A validação estrutural R01 não substitui validação topológica/cálculo de área PostGIS.

## Integrações e requisitos normativos

- Whisp: contrato, chave, cobertura e execução real **PENDENTES DE VERIFICAÇÃO**. Nenhum segredo foi solicitado ou armazenado. Fallback demonstrativo deve permanecer rotulado como simulado; indisponibilidade não equivale a resultado sem alerta.
- Matriz de 27 UFs em `docs/research/controle-florestal-27-ufs-2026-11-05.csv`: inventário de pesquisa, não catálogo de obrigações confirmado para cada operação.
- Elegibilidade no evento, combinação de frentes e responsáveis pela validação normativa: **PENDENTES DE CONFIRMAÇÃO**.
- Vigência e aplicabilidade de parâmetros CRV: o fator 0,35 usado em teste é apenas configurável/demonstrativo até confirmação documental competente.
- Licença de distribuição do produto: **PENDENTE DE DECISÃO** da equipe; esta nota não concede licença.

## Limite de interpretação

Status do sistema descrevem evidência e regras implementadas, não legalidade, sustentabilidade ou autorização oficial. Pacotes baseados em documentos ou sinais simulados permanecem `MISSING_EVIDENCE`, ainda que regras demonstrativas passem.
