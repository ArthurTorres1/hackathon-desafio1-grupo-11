# Evidência da prova técnica INPE

As seções iniciais preservam o histórico das provas 1.1–1.3. Pendências descritas nelas foram resolvidas pela implementação e pelas verificações registradas em “Integração privada ponta a ponta” ao fim deste guia.

Consulta executada em 06/11/2026 contra o catálogo STAC do Brazil Data Cube, usando a geometria sintética existente em `data/public_samples/demo-plot.geojson`. O arquivo não foi editado. A geometria é um retângulo entre longitude -60 e -59.99 e latitude -3 e -2.99; seus metadados declaram explicitamente que não representa propriedade ou origem real.

## Busca observada

- Catálogo: [`https://data.inpe.br/bdc/stac/v1/`](https://data.inpe.br/bdc/stac/v1/)
- Endpoint: `POST https://data.inpe.br/bdc/stac/v1/search`
- HTTP: 200; a resposta é GeoJSON STAC e retornou itens para a interseção.
- Corpo sanitizado (sem credenciais):

```json
{
  "intersects": {
    "type": "Polygon",
    "coordinates": [[[-60,-3],[-59.99,-3],[-59.99,-2.99],[-60,-2.99],[-60,-3]]]
  },
  "collections": ["S2-16D-2"],
  "datetime": "2026-10-01T00:00:00Z/2026-10-31T23:59:59Z",
  "limit": 1
}
```

O item observado foi [`S2-16D_V2_016009_20261016`](https://data.inpe.br/bdc/stac/v1/collections/S2-16D-2/items/S2-16D_V2_016009_20261016), da coleção [`S2-16D-2`](https://data.inpe.br/bdc/stac/v1/collections/S2-16D-2). O item reporta `datetime=2026-10-16T00:00:00Z`, intervalo `2026-10-16` a `2026-10-31` e `eo:cloud_cover=16.26`. O `license` no item está ausente/nulo.

O item declara `bbox=[-60.21256392965003,-3.9302648349457026,-59.23913223958464,-2.959791516989484]` em WGS84, que inclui a geometria sintética consultada. `proj:epsg`, `proj:shape` e `proj:transform` não vieram nas propriedades do item.

## Coleção e assets

A descrição oficial identifica a coleção como Sentinel-2/MSI Level-2A, cubo temporal de 16 dias com composição Least Cloud Cover First, resolução espacial de 10 m, processado como Cloud Optimized GeoTIFF e reprojetado/recortado para a grade BDC_SM V2. O período da extensão STAC é `2017-01-01` a `2026-10-31`; a licença declarada no objeto da coleção é literalmente `proprietary`. O provedor indicado é INPE (host, processor e producer), com facility BDC/BIG. Esta evidência não estabelece uma licença aberta nem resolve os termos contratuais de uso; confirmar os termos antes de habilitar distribuição/uso em produção.

O item contém as chaves de banda `B02`, `B03` e `B04`, todas com `roles=["data"]` e media type `image/tiff; application=geotiff; profile=cloud-optimized`. Para a composição natural RGB, a associação espectral é B04 (red), B03 (green), B02 (blue); ajuste radiométrico/escala ainda precisa ser provado na tarefa 1.2. A geometria e o identificador da cena são reais apenas como resposta do catálogo; a área consultada permanece demonstrativa.

Nos metadados STAC de B02, `eo:bands` declara common name `blue`, `uint16`, nodata `0`, escala `0.0001`, sem `scale_add`, faixa `0..10000` e resolução `10 m`; o asset declara 10.560 x 10.560 pixels, chunks 512 x 512 e tamanho `209,997,539` bytes. Esses são campos declarados no catálogo; a leitura independente das tags TIFF continua na tarefa 1.2.

Assets registrados pelo STAC:

- B02 (blue): [`https://data.inpe.br/bdc/data/s2-16d/v2/016/009/2026/10/16/S2-16D_V2_016009_20261016_B02.tif`](https://data.inpe.br/bdc/data/s2-16d/v2/016/009/2026/10/16/S2-16D_V2_016009_20261016_B02.tif)
- B03 (green): [`https://data.inpe.br/bdc/data/s2-16d/v2/016/009/2026/10/16/S2-16D_V2_016009_20261016_B03.tif`](https://data.inpe.br/bdc/data/s2-16d/v2/016/009/2026/10/16/S2-16D_V2_016009_20261016_B03.tif)
- B04 (red): [`https://data.inpe.br/bdc/data/s2-16d/v2/016/009/2026/10/16/S2-16D_V2_016009_20261016_B04.tif`](https://data.inpe.br/bdc/data/s2-16d/v2/016/009/2026/10/16/S2-16D_V2_016009_20261016_B04.tif)
- Thumbnail (preview, não georreferenciada): [`https://data.inpe.br/bdc/data/s2-16d/v2/016/009/2026/10/16/S2-16D_V2_016009_20261016.png`](https://data.inpe.br/bdc/data/s2-16d/v2/016/009/2026/10/16/S2-16D_V2_016009_20261016.png)

O host STAC e o host observado dos assets são `data.inpe.br` (HTTPS). Em 06/11/2026 às `14:33:03 GMT` (horário do cabeçalho HTTP), uma solicitação `GET` ao asset B02 com `Range: bytes=0-16383` retornou `206 Partial Content`, `Content-Range: bytes 0-16383/209997539`, `Content-Length: 16384` e `Content-Type: image/tiff`. Isso comprova leitura parcial naquele asset e momento, não prova acesso/range em todas as bandas, reprojeção, escala, nodata ou renderização. Nenhum raster foi salvo.

## Reprodutibilidade e limites

Execute `node scripts/probe-inpe-catalog.mjs` na raiz do repositório para repetir a busca e imprimir somente `queried_at` UTC, status, identificadores, datas, licença da coleção, cloud cover, metadados reduzidos e links dos três assets RGB. O script não grava respostas nem arquivos raster. A consulta externa usa geometria sintética e não comprova origem de qualquer parcela real.

Esta evidência cobre a descoberta STAC e uma resposta item/asset real. Leitura COG pelas bandas, CRS/nodata/escala, recorte/reprojeção, controle de alinhamento e dependência Node são critérios separados da tarefa 1.2. A prova da tarefa 1.3 (ambientes Windows e imagem de aplicação) ainda depende de verificação própria.

## Recorte RGB e controle de alinhamento — tarefa 1.2

Executado `node --import tsx scripts/probe-inpe-render.ts` em Windows em 06/11/2026, com a cena e a área sintética delimitadas acima. Este script é uma prova fixa, não um endpoint de produção ou um renderizador genérico. A projeção Albers foi conferida contra as tags dos TIFFs e a definição PROJ publicada na [FAQ oficial BDC](https://data.inpe.br/bdc/faq/): `+proj=aea +lat_1=-2 +lat_2=-22 +lat_0=-12 +lon_0=-54 +x_0=5000000 +y_0=10000000 +ellps=GRS80 +units=m +no_defs`.

- As três bandas B04/B03/B02 foram lidas como janelas COG, com `allowFullFile=false`, respostas 206 e orçamento acumulado conferido durante o streaming. Respostas integrais são canceladas. A prova não usa thumbnail como imagem georreferenciada.
- Origem projetada `[4313600,11003200]`, resolução `[10,-10]` metros, dimensões 10560×10560 e janela `[2127,285,2244,401]`. Nodata 0 foi tratado como transparência; os 9216 pixels de saída tiveram cobertura válida nesta execução.
- PNG de **96×96**, 20359 bytes, reamostrado em grade EPSG:3857. Os bounds WGS84 no JSON usam pares **longitude, latitude**, aproximadamente `[[-60,-3],[-59.99,-2.99]]`; uma integração futura no Leaflet deverá convertê-los para latitude/longitude. Não se trata de melhoria da resolução nativa de 10 m.
- Os três controles comparam cantos do footprint STAC com a transformação afim das tags TIFF, projeção Albers e fórmula analítica de Web Mercator. O maior erro calculado foi `1.3685138805436313e-9` pixel de saída, abaixo do critério de um pixel. Esse número mede concordância entre representações dos metadados do provedor; não é acurácia de campo ou prova de origem.
- A leitura total foi **1279670 bytes**, abaixo do teto de **33554432 bytes (32 MiB)**. A última execução passou em **1408 ms**, com prazo total de rede de 20000 ms; delta de RSS de **14557184 bytes**, medido entre início e fim, sem alegar pico máximo de memória. Houve tentativas anteriores com falha TLS/timeout; não houve fallback para simulação nem download integral. Esses tempos observados não garantem latência futura.
- O TIFF informa `SampleFormat=2` (inteiro com sinal), enquanto o STAC declara `uint16`. A biblioteca respeitou o TIFF; os valores amostrados ficaram no intervalo declarado pelo STAC. A escala STAC `0.0001` foi usada para conversão linear de reflectância 0–1 para RGB de 8 bits, sem classificação ambiental ou ajuste de valores científicos.

PNG e relatório da execução estão em `data/private/inpe-render-probe.png` e `data/private/inpe-render-probe.json`, ignorados pelo Git. O raster derivado não foi incluído no repositório. O relatório registra bandas, metadados, bounds, controles, bytes, runtime e versões efetivas. O PNG foi inspecionado visualmente. O tipo de contexto permanece sintético, mesmo com consulta externa real. A licença declarada da coleção continua `proprietary`; não se presume licença aberta para os pixels a partir da licença MIT do código.

A checagem estática TypeScript do probe passou com `tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck scripts/probe-inpe-render.ts`. API, persistência de referências e overlay da interface ainda não foram implementados por esta prova.

## Estado do ambiente para a tarefa 1.3

Na verificação posterior de 06/11/2026, o host Windows executou instalação limpa pelo lockfile (`npm.cmd ci`: 320 pacotes instalados, 330 auditados), geração do cliente Prisma (`npm.cmd run db:generate`) e a prova externa novamente. A instalação anterior do host não correspondia ao lockfile: faltavam geotiff/proj4 e a resolução de pngjs encontrava a versão transitiva 5.0.0. A instalação limpa corrigiu essa diferença sem mudar as versões fixadas.

`npm.cmd ls geotiff proj4 pngjs --workspace @foresttrace/api` confirmou `geotiff@3.0.5`, `proj4@2.22.0` e `pngjs@7.0.0` da API, além de `pngjs@5.0.0` transitivo do QR. Os tipos permanecem `@types/pngjs@6.0.5`. Todas as bibliotecas do probe agora são resolvidas a partir de `apps/api/package.json` com `createRequire`, inclusive a importação dinâmica do geotiff; a resolução funciona tanto com dependências aninhadas como com hoisting. As bibliotecas de runtime declaram MIT; isso não altera a licença das imagens.

Na repetição autorizada `npm.cmd exec -- tsx scripts/probe-inpe-render.ts`, o ambiente foi Node **22.13.1**, Windows **10.0.26200 x64**. O resultado foi PNG **96×96**, **20359 bytes**, com **9216 pixels cobertos**, grade EPSG:3857 e bounds WGS84. As três bandas RGB consumiram **1279670 bytes** por HTTP Range (206), dentro do teto **33554432 bytes**. O prazo total permaneceu **20000 ms**; a execução terminou em **2633 ms**. RSS inicial **83308544 bytes**, final **98861056 bytes**, delta **15552512 bytes**: essas medidas não representam o pico máximo. Os três pontos de controle tiveram erro máximo **1,3685138805436313×10⁻⁹ pixel**, abaixo do limite de um pixel, medindo concordância dos metadados, sem alegar acurácia de campo.

Artefatos privados da repetição: `data/private/inpe-render-probe.png` e `.json`; o PNG foi inspecionado visualmente. O comando completo ficou em `inpe-gate-probe.log`. Não houve fallback para cena inteira, simulação ou thumbnail. A licença da coleção permanece `proprietary`; a prova não autoriza redistribuição dos pixels. A configuração aprovada é coleção **S2-16D-2**, bandas **B04/B03/B02**, nodata **0**, escala linear **0,0001**, CRS Albers da definição oficial descrita acima e saída EPSG:3857. Suporte de produção a outras coleções não é presumido por esse resultado.

O agente principal concluiu `docker build -t foresttrace-inpe-proof .` no `Dockerfile` da aplicação, com Node 22/Linux, registrando sucesso em `inpe-proof-image.log`. A inspeção `npm ls` dentro da imagem confirmou as mesmas versões de runtime. A instalação/build Linux deixa de estar bloqueada por ausência de runtime: os registros anteriores de Docker indisponível pertencem a outra rodada e não descrevem o ambiente atual. Nenhuma migração é necessária para a prova de build.

O build Windows completo (`npm.cmd run build`) também passou após a geração do Prisma, compilando contratos, API e interface; registro em `inpe-host-build.log`. O primeiro build imediatamente após `npm ci` falhou por ausência do cliente Prisma gerado, corrigida pelo comando previsto no README, sem alteração do código de domínio. A prova técnica satisfaz o gate de dependências e ambientes da tarefa 1.3; ela ainda não implementa as rotas, persistência e overlay de produção.
## Integração privada ponta a ponta — 06/11/2026

O script `scripts/smoke-inpe.ts` executou a implementação de produção pela API autenticada: busca real com o GeoJSON sintético do repositório, renderização PNG, cadastro, vínculo repetido sem duplicação, reabertura dos metadados e criação de lote associado à mesma parcela. A imagem retornou 75.025 bytes, com a cena `S2-16D_V2_016009_20261016`. O acesso anônimo ao PNG, após preencher o cache autenticado, retornou 401. Artefatos privados: `data/private/inpe-live-smoke.json` e `data/private/inpe-live-smoke.png`. O PNG foi inspecionado visualmente; o alinhamento geográfico é verificado também pelos pontos de controle do renderizador.

O smoke também simulou uma falha de asset com dependência injetada em uma segunda instância da API, sem cache: recebeu 503 e continuou o cadastro e o vínculo na instância normal. Essa etapa é uma simulação explícita de indisponibilidade; a busca e o PNG anteriores usam o provedor real. O teste de navegador `inpe-live.spec.ts` reabriu a cena pela parcela do lote real do smoke; capturas em `data/private/inpe-live-browser.png` e `data/private/inpe-live-browser-full.png` preservam a evidência visual privada.

Para reproduzir, prepare o banco e o seed demonstrativo, defina `INPE_IMAGERY_ENABLED=true` no processo e execute `node_modules/.bin/tsx.cmd scripts/smoke-inpe.ts`. O script cria registros identificados como sintéticos; não apaga os registros existentes. Requer acesso real ao INPE, ao banco local e à persona demonstrativa do entregável. Falha externa faz o script falhar explicitamente. Não substitua essa evidência por execução com mocks.

Consulte [renderizador e transporte](inpe-renderer.md), [API e retenção](inpe-backend.md) e [interface e testes de navegador](inpe-ui.md) para os critérios específicos. Os testes determinísticos de indisponibilidade são separados da consulta real.

### Verificação final e execução local

- `npm.cmd run typecheck`: passou após os ajustes finais.
- `npm.cmd test`: 192 testes passaram, em 21 arquivos.
- `npm.cmd run test:integration`: 103 casos verificados. A execução completa final passou 102; o caso INPE foi repetido e passou após a correção de isolamento da idempotência por organização. A execução completa anterior também passou os 103 casos.
- `npm.cmd run test:e2e -- --workers=1`: 58 testes determinísticos aprovados, seis condicionais ignorados. Casos interrompidos pelo encerramento de um servidor compartilhado foram repetidos em saída isolada e passaram. A prova real INPE foi executada separadamente e passou.
- `npm.cmd run build`, exportação OpenAPI e build Docker Linux: passaram. A revisão paralela acrescentou limites para o conjunto de blocos TIFF decodificados e para replays após mudança de organização; ambos têm testes específicos aprovados e estão na imagem final.

A imagem final foi recriada em `http://127.0.0.1:3001`, com `INPE_IMAGERY_ENABLED=true` no ambiente local. Verificação autenticada nessa imagem: `/health` OK, capabilities habilitadas e PNG real HTTP 200, `image/png`, 75.025 bytes, `Cache-Control: private, no-store`. `.env.example` continua desabilitado por padrão. Use a persona **Autora entregável**, selecione o lote sintético `INPE-SMOKE-…` em **Origem & sinais**, abra o histórico e escolha **Reabrir cena vinculada**. No cadastro, use **Buscar imagens INPE** após informar o polígono.
