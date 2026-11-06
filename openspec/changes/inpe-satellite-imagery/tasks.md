# Tasks

## 1. Prova técnica delimitada do INPE

- [x] 1.1 Consultar catálogo e busca STAC com o polígono sintético, confirmar uma coleção óptica, item e bandas RGB e registrar requisição sanitizada, HTTP, período, licença e hosts em `docs/inpe-integration.md`; verificar resultado real sem confundir contexto sintético com origem comprovada.
- [x] 1.2 Validar acesso às bandas, HTTP Range, CRS, nodata, escala e biblioteca Node para leitura/reprojeção; produzir recorte PNG em EPSG:3857 de até 1024 x 1024 e bounds WGS84, verificando três pontos de controle com erro máximo de um pixel de saída e leitura dentro de 32 MB, sem download integral como fallback.
- [x] 1.3 Registrar versão das dependências escolhidas, configuração da coleção e evidência de tempo/memória no guia; verificar instalação/build no ambiente Windows e na imagem da aplicação antes de prosseguir. Se a prova falhar, registrar o impedimento e revisar o design antes de trocar a arquitetura ou declarar a integração pronta.

## 2. Contratos e persistência privada

- [x] 2.1 Adicionar contratos TypeBox de busca, cenas, referências, paginação e estados com limites do design; verificar testes de Polygon/MultiPolygon, datas invertidas, área/período excessivos e metadados ausentes, documentando exemplos de resposta no contrato da API.
- [x] 2.2 Criar migração aditiva `ImageryQuery`/`PlotImageryReference`, relações e índices por organização/parcela/hash; verificar migração em banco de teste, persistência de snapshot/hash/proveniência e preservação de consultas vinculadas após expirar o cache.
- [x] 2.3 Documentar retenção de rascunhos, metadados preservados e ausência de arquivamento do raster; verificar que schema e exemplos não exigem lote para uma consulta de cadastro nem modificam `SourceQuery` Whisp.

## 3. Adaptador e busca STAC

- [x] 3.1 Implementar adaptador com transporte injetável, normalização, interseção e paginação limitada a filtros imutáveis; verificar fixtures de cenas, composições temporais, resposta vazia, próxima página e item incompatível.
- [x] 3.2 Implementar limites, allowlist de destinos, verificação de DNS/redirecionamentos, timeout e repetição limitada; verificar testes de URL arbitrária, IP privado, redirect indevido, resposta excessiva, 401/429/5xx e timeout, sem transformar erro em SEM_IMAGENS.
- [x] 3.3 Implementar cache segregado com data original e proveniência separada da geometria; verificar expiração e isolamento entre organizações, filtros, páginas e versões do adaptador, documentando configuração e comportamento.
- [x] 3.4 Registrar rotas privadas de busca de rascunho e parcela com sessão, CSRF e idempotência; verificar testes de integração 401/404/422/503, ausência de chamada externa para entrada inválida e consulta persistida com hashes sem criar parcela automaticamente.

## 4. Renderização e vínculo da cena

- [x] 4.1 Implementar renderizador aprovado na prova técnica com recorte, reprojeção EPSG:3857, RGB e nodata; verificar fixture georreferenciada com pontos de controle, cobertura parcial, limites de bytes/pixels/tempo e ausência de georreferenciamento fictício de thumbnail.
- [x] 4.2 Expor PNG e prévias por rotas privadas da consulta, com cache e concorrência limitados; verificar acesso por sessão, cena pertencente à consulta, bloqueio entre organizações inclusive em cache aquecido, falha de asset e headers privados.
- [x] 4.3 Implementar vínculo idempotente e histórico por parcela/versão com evento `PLOT_IMAGERY_LINKED`; verificar hash/versão divergentes retornando 409, organização indevida retornando 404 e reabertura de metadados quando o asset remoto não está mais disponível.
- [x] 4.4 Atualizar OpenAPI e guia com rotas de busca/render/referência, erros e limites; verificar schemas das respostas contra exemplos reais sanitizados e garantir que URLs arbitrárias de assets não são aceitas como entrada.

## 5. Cadastro e consulta privada de origem

- [x] 5.1 Criar controles compartilhados de busca e estender `PlotMap` para overlay, legenda, data/intervalo, coleção, nuvens desconhecidas e opacidade; verificar alternância com OpenStreetMap, cobertura parcial e SEM_VISUALIZACAO com prévia fora do mapa.
- [x] 5.2 Integrar busca explícita no cadastro e vínculo após criação, sem repetir cadastro em falha de vínculo; verificar E2E com cadastro bem-sucedido e indisponibilidade de busca/render/vínculo, mantendo campos e opção de nova tentativa.
- [x] 5.3 Integrar consulta à parcela efetivamente associada ao lote na etapa Origem & sinais; verificar E2E alternando dois lotes de parcelas distintas, referências da versão anterior e consulta Whisp sem regressão.
- [x] 5.4 Cancelar buscas obsoletas e invalidar seleção ao mudar geometria/lote/filtro/sessão; verificar respostas fora de ordem e garantir que uma imagem antiga não aparece como seleção da nova parcela.
- [x] 5.5 Adicionar flag de habilitação, configuração sem segredos em `.env.example` e instruções no README/guia INPE; verificar interface com integração habilitada/desabilitada, mensagens acessíveis e procedimento documentado de rollback por flag.

## 6. Verificação integrada

- [x] 6.1 Executar testes de regressão da consulta pública e exportações garantindo ausência de geometria, query IDs e referências/URLs privadas; verificar também que vínculo real não altera Whisp, alertas, saldos ou MISSING_EVIDENCE demonstrativo.
- [x] 6.2 Executar `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run test:integration`, `npm.cmd run test:e2e` e `npm.cmd run build` no ambiente preparado; registrar resultados e limitações, sem marcar execução externa como coberta apenas por mocks.
- [x] 6.3 Fazer smoke test autorizado com geometria sintética: buscar cena real, renderizar, cadastrar, vincular, reabrir pelo lote e simular indisponibilidade; registrar evidência visual, alinhamento e atribuição no guia e confirmar continuidade do cadastro.
