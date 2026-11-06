# Design

## Context

Ver motivação em `proposal.md`. `apps/web/src/components/Map.tsx` cria um mapa Leaflet com OpenStreetMap e GeoJSON. `Registration` em `App.tsx` trabalha com geometria antes do cadastro; a etapa `Whisp` seleciona um lote de origem. `Plot` preserva geometria, versão e hash; `OriginLot` associa a parcela. A API usa sessão, escopo de organização, CSRF e chave de idempotência para mutações.

`SourceQuery` exige `lot_id`, portanto não atende consultas antes de existir parcela/lote. A nova funcionalidade terá armazenamento próprio e não reutilizará avaliações Whisp. Não há specs principais arquivadas; a mudança ativa do passaporte continua independente. Há alterações locais de outras frentes que devem ser preservadas.

Fontes oficiais consultadas em 06/11/2026:

- [Documentação STAC do BDC](https://data.inpe.br/bdc/stac/v1/docs): contrato de busca espacial/temporal e coleções.
- [Coleções do catálogo](https://data.inpe.br/bdc/stac/v1/collections): o catálogo foi acessível pela ferramenta de pesquisa; contém produtos COG, inclusive composição temporal. Isso não comprova renderização ou disponibilidade de cada asset.
- [Descrição STAC do INPE](https://data.inpe.br/bdc/stac-spatiotemporal-asset-catalog/): descoberta e acesso a coleções de imagens e cubos.

A tentativa de ler itens por meio da ferramenta web falhou sem diagnóstico HTTP confiável. Busca de cenas, acesso aos arquivos, Range Requests e montagem RGB são critérios da prova técnica, não funcionalidades já verificadas.

## Goals / Non-Goals

**Goals:** integrar catálogo, armazenamento de referências e visualização privada sem acoplar o cadastro à disponibilidade externa. Reutilizar Leaflet, autenticação e validação geoespacial existentes.

**Non-Goals:** servir catálogo global, baixar cenas inteiras por padrão, implantar uma plataforma de sensoriamento remoto ou criar novas permissões públicas. O MVP consulta explicitamente a origem na etapa Origem & sinais; navegação automática por ancestrais de produtos transformados fica para evolução posterior.

## Decisions

### 1. STAC no servidor e coleções compatíveis configuradas

Base proposta: `https://data.inpe.br/bdc/stac/v1/`. Usar busca `POST /search` com `intersects`, `datetime`, `collections` e limite; normalizar o contrato do provedor para contratos TypeBox próprios. Paginação por cursor opaco associado aos filtros e à organização, sem receber URLs do cliente. Ordenar resultados da página por data localmente; não prometer ordenação global se o provedor não suportar ordenação.

Selecionar ao menos uma coleção óptica com bandas RGB e cobertura comprovada pela prova técnica. Coleções, bandas, escala, nodata, licença e hosts dos assets serão configuração versionada do servidor. Não assumir uma coleção CBERS pelo nome nem suporte uniforme a filtros de nuvens. Campos ausentes ficam nulos. A interface usa período padrão visível dos últimos 12 meses, editável; data de referência do lote pode orientar o operador sem alterar silenciosamente o período.

Alternativas: chamar INPE diretamente do browser dificulta limites e tratamento uniforme; TerraBrasilis/alertas ambientais não substituem a imagem óptica pretendida. Não presumir um serviço XYZ/WMS do INPE sem verificar seu contrato.

### 2. Renderização RGB COG com recorte limitado

Implementar renderizador no servidor com biblioteca Node de leitura COG e reprojeção validada na prova técnica. Ler somente janelas necessárias por HTTP Range, aplicar transformação geográfica, nodata e composição RGB conforme configuração da coleção. Produzir PNG com pixels reamostrados em EPSG:3857, compatível com o mapa Leaflet atual, e bounds dos cantos expressos em WGS84 para `L.imageOverlay`; limitar a imagem ao bbox da consulta com margem controlada. Leaflet continua responsável pelo contorno, alternância e opacidade. O renderizador precisa respeitar CRS, rotação e footprint; reprojeção não pode ser substituída por esticar pixels.

MVP: recorte de até 1024 x 1024 pixels e área máxima inicial de 10.000 ha, configurável. Áreas maiores retornam erro de limite antes de consultar. Essa fronteira evita um serviço de mosaicos/tiles e deve constar da interface. Preview sem referência espacial aparece em cartão, nunca como overlay. Cena incompatível permanece consultável por metadados com estado SEM_VISUALIZACAO.

Comparação: tiles dinâmicos e TiTiler adicionam serviço Python, implantação e operação. Renderização no browser transfere URLs dos arquivos e volume de leitura ao cliente. A escolha Node deve passar no teste de alinhamento e memória; se nenhuma biblioteca adequada cumprir os critérios, registrar a limitação e revisar o design antes de substituir a arquitetura. Não entregar a integração como concluída com apenas miniaturas.

### 3. Contrato privado proposto

Todas as rotas sob `/api/v1`, protegidas pelos hooks atuais. POSTs usam CSRF e idempotência existentes; GET de imagem usa sessão do mesmo domínio.

| Operação | Entrada e saída |
|---|---|
| `POST /imagery/search` | `{geometry, datetime, collection_ids?, cursor?}`; retorna `query_id`, `geometry_hash`, cenas normalizadas, `next_cursor`, `queried_at`, cache e limitações |
| `POST /plots/:id/imagery/search` | Mesmo filtro temporal, sem geometria do cliente; resolve parcela própria e fixa sua versão |
| `GET /imagery/queries/:queryId/scenes/:sceneKey/render` | Só cena retornada naquela consulta; retorna PNG georreferenciado usando bounds fornecidos pelos metadados da consulta |
| `POST /plots/:id/imagery-references` | `{query_id, scene_key, geometry_version}`; revalida hash/versão e cria referência idempotente |
| `GET /plots/:id/imagery-references` | Histórico privado com indicação de versão atual/anterior; reabertura usa consulta persistida |

Cena normalizada: `scene_key`, `collection_id`, `item_id`, `datetime` ou `start_datetime/end_datetime`, `footprint`, `bbox`, `cloud_cover: number|null`, plataforma/sensor, licença/atribuição, `renderable`, `render_bounds`, `render_url` interna e limitações. `render_bounds` descreve o PNG renderizado, não somente o bbox nativo do item. URLs externas de assets ficam no snapshot privado do servidor. Miniaturas, se disponibilizadas, passam por rota privada com os mesmos controles.

Erros no envelope existente: 401 sem sessão; 404 para recurso ausente/inacessível; 409 versão alterada; 422 entrada/limite inválido; 429 limite local; 503 INDISPONIVEL; 422 SEM_VISUALIZACAO para asset incompatível. HTTP 200 com cenas vazias significa SEM_IMAGENS. Falha de PNG usa resposta de erro e a interface trata o evento de falha do overlay.

### 4. Persistência e separação de avaliações

Adicionar `ImageryQuery`: UUID, organização, autor, `plot_id` opcional, geometria ou snapshot privado, hash/versão opcional, filtros canônicos, hash da requisição, versão do adaptador, snapshot STAC sanitizado e hash, status/HTTP/motivo, proveniência do contexto, consulta UTC, expiração do cache. Um registro por consulta/página; consultas de rascunho pertencem à organização e não são públicas.

Adicionar `PlotImageryReference`: parcela/organização, query, cena, coleção/item, geometria/hash/versão, snapshot dos metadados, atribuição, autor/data. Verificar relações e organização em cada leitura/vínculo/render. Snapshot garante rastreabilidade de metadados; não é cópia arquivística do raster. Se o arquivo desaparecer, mostrar metadados preservados e visualização indisponível. Query vinculada permanece preservada; rascunhos sem vínculo podem expirar após sete dias. Emitir evento privado `PLOT_IMAGERY_LINKED` usando o serviço de auditoria existente.

Não inserir `Check` com aprovação nem alterar `SourceQuery`, avaliações Whisp, readiness ou lógica de exportação pública. Proveniência da imagem e da geometria são campos distintos: consulta real sobre fixture sintética continua demonstrativa.

### 5. Cache, limites e acesso externo

Cache de busca por organização, hash da geometria, período, coleções, cursor e versão do adaptador; TTL inicial 1 hora. Cache de PNG por organização, query/cena, bounds, dimensões e configuração RGB; TTL 24 horas, sem expor arquivo estático público. Respostas usam `Cache-Control: private`; autorização é conferida mesmo quando há cache. Snapshot de referência não expira com o cache.

Limites iniciais: 20 cenas por página, 5 páginas por consulta, período máximo 5 anos, 10 s de busca e 20 s de render, no máximo uma repetição transitória dentro do prazo total, 2 renders simultâneos por processo e 10 buscas/minuto por organização. Limitar bytes da resposta STAC a 5 MB e leitura de assets a 32 MB por render; decodificação limitada por janela e dimensões. Não usar download integral como fallback quando Range não for suportado. Limites serão documentados e testados.

Permitir somente HTTPS, hosts e caminhos aprovados na configuração; bloquear IPs privados/loopback e validar DNS/destino e cada redirecionamento para catálogo, paginação, assets e miniaturas. Não aceitar parâmetros de URL/host arbitrários. Credenciais eventualmente necessárias ficam no servidor e nunca em logs ou snapshots. Validar corpo e quantidade de vértices antes de validações geométricas custosas, reutilizando PostGIS para topologia e área quando aplicável. Consulta externa ocorre fora de transação de banco longa.

### 6. Integração da interface

Componente de consulta separado de `PlotMap`, compartilhado pelo cadastro e pela etapa de origem. `PlotMap` recebe overlay opcional e legenda. Botão explícito “Buscar imagens INPE”, período, resultados, seleção de cena, opacidade e estados acessíveis. Não consultar a cada digitação do GeoJSON.

Usar AbortController e identificador da consulta para descartar resposta atrasada ao mudar geometria, lote, filtros ou sessão. Invalidar seleção pendente ao mudar hash. Após cadastro bem-sucedido, tentar vínculo separado e informar eventual falha sem repetir cadastro. Para lote, resolver parcela por associação real e carregar dados privados autorizados; não usar a última geometria digitada no formulário.

## Risks / Trade-offs

- [Acesso público ao catálogo não garante acesso aos assets] → prova técnica verifica uma cena, bandas, autenticação, Range e licença antes de habilitar a coleção.
- [CRS, nodata ou composição incorretos] → fixture raster conhecida com pontos de controle, buracos e cobertura parcial; comparar alinhamento com ferramenta geoespacial de referência.
- [Cenas extensas e consumo de memória] → recorte, limites, concorrência e ausência de fallback para download integral.
- [Imagem antiga, composição ou nuvens] → apresentar período e metadados disponíveis; sem promessa de monitoramento em tempo real.
- [Identificadores expõem áreas privadas] → sessão e escopo por organização em todas as rotas, incluindo cache e PNG; regressão de endpoints públicos.
- [Dependência externa instável] → habilitação opcional, timeout e continuidade de cadastro; sem fallback sintético silencioso.

## Migration Plan

1. Concluir prova técnica com geometria sintética e uma coleção compatível; registrar evidências e limitações sem usar credenciais reais em fixtures.
2. Aplicar migração aditiva e configuração `INPE_IMAGERY_ENABLED=false` por padrão. Não modificar registros Whisp ou parcelas existentes.
3. Implementar e verificar adaptador, renderizador, rotas e interface; habilitar no ambiente local após sucesso dos critérios.
4. Atualizar `.env.example`, README, contrato da API e guia INPE com coleção suportada, atribuição e limites.
5. Rollback: desabilitar a integração e retirar overlay/controles pela flag. Preservar referências/metadados privados para auditoria; não executar migração destrutiva como rollback automático.
