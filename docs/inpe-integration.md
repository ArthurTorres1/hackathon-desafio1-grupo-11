# Evidência da prova técnica INPE

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

Conforme inspeção registrada pelo agente principal: não foram encontrados Docker/Podman nem serviços disponíveis, `wsl.exe --status` indica WSL não instalado, `psql`/`pg_isready` não estão disponíveis e as portas 5432/5433 estão fechadas; há apenas `.env.example`. O host observado é Node 24.18/npm 11.16 e o `Dockerfile` declara `node:22-bookworm-slim`. A imagem de aplicação não pode ser validada neste ambiente sem container runtime. Portanto, a tarefa 1.3 permanece bloqueada/em aberto e não está marcada como concluída.

Dependências instaladas e fixadas no workspace da API: `geotiff@3.0.5`, `proj4@2.22.0`, `pngjs@7.0.0` e tipos `@types/pngjs@6.0.5`. As bibliotecas de runtime declaram licença MIT; isso não altera a licença das imagens do provedor. Há uma versão transitiva distinta de `pngjs` na raiz por causa do QR: o probe deve resolver explicitamente a versão do workspace da API.

`npm.cmd install` e `npm.cmd run build` passaram em Windows com essas dependências, compilando contratos, API e interface. O build precisou ser reexecutado fora da sandbox após `spawn EPERM` do esbuild; essa restrição de execução não foi interpretada como falha do código. Não foi executado build Linux. Na máquina com Docker, executar `docker build -t foresttrace-inpe-proof .` a partir deste mesmo lockfile e registrar o resultado antes de prosseguir além da prova técnica. Não é necessário aplicar migrações para esse build.
