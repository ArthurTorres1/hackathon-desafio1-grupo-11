# Fontes, procedência e limites

Atualizado em 2026-11-06. Dados operacionais nos fixtures e no GeoJSON de demonstração são sintéticos. Uma consulta Whisp externa foi executada sobre o polígono sintético conforme o registro abaixo; isso não transforma os cenários em operações reais. O nome científico associado ao nome comum angelim-vermelho está registrado apenas como exemplo e permanece **PENDENTE DE VERIFICAÇÃO** taxonômica para a origem proposta.

## Evidência geográfica

`data/public_samples/demo-plot.geojson` contém polígono numérico criado para teste. Não possui fonte geográfica externa, licença de terceiros ou município real associados. A área de referência de cerca de 122,93 ha é uma aproximação aritmética WGS84 para a extensão do quadrado e não um resultado PostGIS; deve ser recalculada no banco antes de servir como valor de sistema. Coordenadas não afirmam propriedade, posse, autorização de corte ou localização de uma parcela real. A validação estrutural R01 não substitui validação topológica/cálculo de área PostGIS.

## Integrações e requisitos normativos

- Whisp: contrato publicado confirmado e consulta autorizada concluída em 06/11/2026 com HTTP 200 e `REAL_CONSULTADA`, sobre geometria **SIMULADA** e escopo **DEMONSTRATIVO**. Chave fornecida pelo operador configurada somente no `.env` local ignorado pelo Git. Protocolo, limites e fontes oficiais em [whisp-integration.md](whisp-integration.md). A cobertura, atualização e interpretação de cada indicador continuam sujeitas aos metadados das camadas e à revisão contextual; não há conclusão de legalidade.
- Matriz de 27 UFs em `docs/research/controle-florestal-27-ufs-2026-11-05.csv`: inventário de pesquisa, não catálogo de obrigações confirmado para cada operação.
- Elegibilidade no evento, combinação de frentes e responsáveis pela validação normativa: **PENDENTES DE CONFIRMAÇÃO**.
  David acompanha a confirmação de elegibilidade e combinação de frentes; David e Adriano respondem pela pesquisa de requisitos e pela delimitação normativa da rota. A atribuição de responsáveis não significa confirmação do evento ou validação da rota.
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
