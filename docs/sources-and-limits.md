# Fontes, procedência e limites

Atualizado em 2026-11-06. Dados operacionais nos fixtures e no GeoJSON de demonstração são sintéticos. Uma consulta Whisp externa foi executada sobre o polígono sintético conforme o registro abaixo; isso não transforma os cenários em operações reais. O nome científico associado ao nome comum angelim-vermelho está registrado apenas como exemplo e permanece **PENDENTE DE VERIFICAÇÃO** taxonômica para a origem proposta.

## Evidência geográfica

`data/public_samples/demo-plot.geojson` contém polígono numérico criado para teste. Não possui fonte geográfica externa, licença de terceiros ou município real associados. A área de referência de cerca de 122,93 ha é uma aproximação aritmética WGS84 para a extensão do quadrado e não um resultado PostGIS; deve ser recalculada no banco antes de servir como valor de sistema. Coordenadas não afirmam propriedade, posse, autorização de corte ou localização de uma parcela real. A validação estrutural R01 não substitui validação topológica/cálculo de área PostGIS.

### Verificação do exemplo sintético — tarefa 1.4

- Fonte e licença: coordenadas numéricas produzidas para teste no projeto, sem importação de base geográfica e sem licença de terceiros aplicável. O arquivo conserva o rótulo **POLÍGONO NUMÉRICO SINTÉTICO**; não deve ser apresentado como parcela pública consultada.
- Região: referência operacional amazônica fictícia da demo. A extensão numérica é longitude −60,00 a −59,99 e latitude −3,00 a −2,99, em EPSG:4326 (longitude, latitude). Não houve consulta a limites administrativos para atribuir município ou imóvel; a referência AM→SP é cenário declarado, cuja validação normativa permanece separada.
- Validade observada em 06/11/2026: leitura JSON válida, um `Polygon` com um anel exterior, quatro vértices distintos e fechamento explícito. Os quatro lados formam retângulo de largura/altura positivas, sem sobreposição ou autointerseção; todas as coordenadas estão nos limites EPSG:4326. O validador de domínio `validateGeometry` retornou `{valid: true, errors: [], rule_code: "R01"}` sobre o arquivo efetivo.
- Área de referência reproduzida: **122,92708395026331 ha**, arredondada para **122,93 ha**. Usou-se latitude média −2,995°, lados de 0,01°, elipsoide WGS84 com `a = 6378137 m`, `f = 1/298,257223563`, `e² = f(2−f)`, `W = sqrt(1−e² sin²φ)`, `M = a(1−e²)/W³` e `N = a/W`. A aproximação local é `M × N × cosφ × Δφ × Δλ / 10000`, com ângulos em radianos. A comparação do metadado do arquivo com essa referência passou com tolerância absoluta de **0,01 ha**; essa tolerância descreve a referência aproximada, sem estabelecer tolerância regulatória.
- Limite da verificação: não foi executado PostGIS nesta rodada. O cálculo acima serve à conferência independente do exemplo e não substitui `ST_IsValid` e `ST_Area(geometry::geography)` no cadastro. O teste não confirma posse, propriedade, licença, legalidade nem situação ambiental. A geometria e seus metadados foram preservados, mantendo a referência dos hashes da consulta Whisp anterior.

## Integrações e requisitos normativos

- Whisp: contrato publicado confirmado e consulta autorizada concluída em 06/11/2026 com HTTP 200 e `REAL_CONSULTADA`, sobre geometria **SIMULADA** e escopo **DEMONSTRATIVO**. Chave fornecida pelo operador configurada somente no `.env` local ignorado pelo Git. Protocolo, limites e fontes oficiais em [whisp-integration.md](whisp-integration.md). A cobertura, atualização e interpretação de cada indicador continuam sujeitas aos metadados das camadas e à revisão contextual; não há conclusão de legalidade.
- Matriz de 27 UFs em `docs/research/controle-florestal-27-ufs-2026-11-05.csv`: inventário de pesquisa, não catálogo de obrigações confirmado para cada operação.
- Elegibilidade no evento, combinação de frentes e responsáveis pela validação normativa: **PENDENTES DE CONFIRMAÇÃO**.
  David acompanha a confirmação de elegibilidade e combinação de frentes; David e Adriano respondem pela pesquisa de requisitos e pela delimitação normativa da rota. A atribuição de responsáveis não significa confirmação do evento ou validação da rota.
  Em 06/11/2026, não há neste registro regulamento ou resposta explícita que encerre a elegibilidade de Arthur ou autorize a combinação de frentes. David deve registrar a regra ou resposta da organização com data e escopo antes de alterar esses estados. Ausência de resposta não equivale a aprovação. A conclusão normativa também permanece pendente: David e Adriano devem registrar fontes, artigos, vigência, escopo e revisão identificada no [checklist da rota](demo-route-validation.md); a atribuição interna não comprova validação por autoridade competente. O acompanhamento e os critérios de encerramento estão em [external-dependencies.md](external-dependencies.md).
- Vigência e aplicabilidade de parâmetros CRV: o fator 0,35 usado em teste é apenas configurável/demonstrativo até confirmação documental competente.
- Licença de distribuição do produto: MIT, escolhida pelo responsável e registrada em [License.md](../License.md). As fontes de terceiros mantêm suas próprias condições de uso.

## Execução Whisp autorizada de 06/11/2026

Executada com `npm exec -- tsx scripts/assess-whisp.ts`, usando `data/public_samples/demo-plot.geojson`, sem documento comercial ou imóvel real. O submit retornou HTTP 202 e um token; o acompanhamento autenticado concluiu com HTTP 200 e `analysis_completed`. Início do submit: `2026-11-06T13:10:54.754Z`; início da etapa de acompanhamento: `2026-11-06T13:10:55.652Z`.

- Hash canônico da consulta: `1949337c6292a3600a3ead8d2ee673b70c85f8218bc5772561854453574784f9`.
- Hash canônico da resposta final: `0bd2b8c29e1ca6d7e9f3f9ada3eb9623dfa8a478d2801040b45d69bac6624c38`.
- Payload, resposta, horários e job estão preservados em `data/private/whisp-synthetic-assessment.json`, ignorado pelo Git. Não contém a chave.

Esse arquivo privado é evidência da tentativa externa, separada dos registros de lote no banco. Consultas pela interface/API são persistidas em `source_queries`. Reexecutar o script reutiliza resultado concluído ou retoma o token disponível; `--refresh` solicita uma nova submissão explicitamente. A consulta sobre geometria sintética continua sem comprovar origem, propriedade, autorização ou prontidão; os pacotes demonstrativos permanecem `MISSING_EVIDENCE`.

## Limite de interpretação

Status do sistema descrevem evidência e regras implementadas, não legalidade, sustentabilidade ou autorização oficial. Pacotes baseados em documentos ou sinais simulados permanecem `MISSING_EVIDENCE`, ainda que regras demonstrativas passem.

## Referências dos cálculos florestais — consulta em 06/11/2026

As fontes abaixo foram abertas em portais oficiais. A leitura do texto publicado não confirma, por si, ausência de alterações posteriores, aplicabilidade à operação, aprovação de PMFS ou validade de autorização. A confirmação de vigência e escopo continua **PENDENTE DE VERIFICAÇÃO**, sob responsabilidade de David e Adriano.

### Cubagem e intensidade de exploração

Fonte primária: [Resolução CONAMA 406/2009, PDF no CONAMA](https://conama.mma.gov.br/?id=578&option=com_sisconama&task=arquivo.download). O art. 1º delimita florestas nativas no bioma Amazônia, excluindo plantadas. O art. 2º, VI, considera área de efetiva exploração por unidade de trabalho; portanto, `área total − APP` é apenas uma diferença aritmética, não comprovação dessa área. O art. 4º associa 30 m³/ha ao arraste mecanizado com ciclo inicial de 35 anos e 10 m³/ha ao arraste sem máquinas com ciclo inicial de 10 anos; os valores dependem também de inventário e critérios de seleção. O art. 5º contempla hipótese específica de várzea. O art. 6º estabelece DMC de 50 cm onde não houver DMC específico. O art. 10 exige equação própria do PMFS a partir do segundo POA.

Não se identificou nesse texto um fator de forma universal de 0,70. A fórmula `π × (DAP_cm/100)² × altura_comercial × fator / 4` será estimativa demonstrativa com fator explícito/versionado, sem substituir equação local aprovada ou autorizar corte. A modalidade comunitária não identifica automaticamente método de arraste. Limites demonstrativos não constituem volume autorizado.

### Rendimento industrial e exceções

Fonte primária: [CONAMA 411/2009 compilada, hospedada pelo Ibama](https://www.gov.br/ibama/pt-br/assuntos/biodiversidade/flora-e-madeira/arquivos/dof/legislacao/20221212_Resolucao_Conama_411_6_maio_2009_compilada.pdf). O Anexo II apresenta 35% para tora/torete em madeira serrada; 45% corresponde a lâmina faqueada, outro produto. O art. 6º, § 4º, exige estudo técnico e aprovação do órgão competente para coeficiente superior ao tabelado; § 12 considera o coeficiente vigente na transformação. O Anexo III prevê análise técnica de coeficientes específicos. Assim, laudo isolado não habilita automaticamente CRV de 45%. A aplicação de exceção exige referência da aprovação, produto, espécie, escopo e vigência compatíveis.

O balanço `entrada − serrado` não mede separadamente resíduos, serragem e perdas; a divisão percentual sugerida no exemplo não será tratada como medição ou distribuição universal.

### Interpretação das saídas demonstrativas

`max(0, serrado / CRV_aplicado − entrada)` expressa volume adicional equivalente necessário sob o coeficiente adotado. Divergência matemática não comprova injeção de madeira ilegal, fraude, origem física ou intenção. A saída deve indicar inconsistência para revisão com fonte, valores e parâmetro, sem acusação ou score probabilístico arbitrário. Área efetiva ausente e denominadores nulos mantêm a métrica não avaliada; entradas incoerentes são rejeitadas, sem aprovação por divisão impossível. Esses cálculos não criam saldo, não alteram autorização e não promovem passaporte demonstrativo a pronto.
## Persistência de requisitos — continuação em 06/11/2026

O motor e a API normativa versionados estão descritos em [regulatory-persistence.md](regulatory-persistence.md). Eles selecionam requisitos declarados por jurisdição/fase/data/produto/modalidade/sistema e preservam lacunas e conflitos. O inventário CSV não foi convertido em regras confirmadas. Os perfis usados nos testes são sintéticos e isolados no banco de testes; não representam confirmação de norma ou consulta oficial. A rota candidata AM→SP continua pendente de checklist e validação das fontes pertinentes.
