# Proposal

## Why

O ForestTrace mostra o contorno declarado sobre OpenStreetMap, sem imagens de satélite para contextualizar a origem florestal. Operadores precisam consultar imagens disponibilizadas pelo INPE no cadastro e voltar à mesma área durante o rastreamento privado da madeira.

## What Changes

- Consultar cenas do Brazil Data Cube/INPE por geometria e período através do backend, usando o catálogo STAC oficial.
- Exibir uma composição RGB georreferenciada no Leaflet, com seleção de cena, data ou intervalo da composição, coleção, origem e limitações; miniaturas serão apenas prévias.
- Permitir consulta antes de salvar a parcela e consulta posterior pela parcela associada ao lote de origem; preservar a cena escolhida com a versão da geometria.
- Distinguir ausência de imagens, indisponibilidade do catálogo, falha de renderização e dados demonstrativos, mantendo o cadastro utilizável.
- Manter imagens precisas no acesso privado e preservar as regras atuais de prontidão, Whisp e consulta pública.
- Não inclui detecção automática de desmatamento, monitoramento contínuo, rastreamento do transporte por satélite nem certificação de origem.

## Capabilities

### New Capabilities

- `satellite-imagery`: busca, visualização e referência persistente de imagens INPE vinculadas à geometria de origem.

### Modified Capabilities

Nenhuma spec principal existente: `openspec list --specs --json` retornou inventário vazio. A spec `geospatial-evidence` da mudança ativa `foresttrace-digital-timber-passport` trata avaliações ambientais e Whisp; a nova capacidade complementa esse contrato sem alterá-lo.

## Impact

- Backend Fastify: adaptador INPE, rotas privadas de busca, renderização e vínculo, limites e cache.
- Contratos TypeBox/OpenAPI e Prisma: metadados das consultas e referências às cenas por parcela/versão.
- Frontend React/Leaflet: `Map.tsx`, cadastro e etapa Origem & sinais em `App.tsx`.
- Dependência nova de leitura/renderização COG, a selecionar após prova técnica delimitada; nenhuma chave INPE é presumida necessária ou existente.
- Testes de contrato, autorização, renderização e fluxos de interface; documentação de configuração e atribuição.

Referência oficial consultada em 06/11/2026: [API STAC BDC](https://data.inpe.br/bdc/stac/v1/docs). Acesso a cenas e arquivos e solução de renderização ainda precisam de validação técnica; esta proposta não declara conexão implementada.
