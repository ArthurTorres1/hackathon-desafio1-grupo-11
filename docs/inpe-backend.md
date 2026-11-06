# API privada INPE

Todas as rotas exigem sessão; POST exige CSRF e Idempotency-Key. `GET /api/v1/imagery/capabilities` informa flag, coleção e limites compartilhados. A flag desabilitada retorna 503 `IMAGERY_DISABLED` para busca/render/vínculo; referências preservadas continuam legíveis.

`POST /api/v1/imagery/search` recebe `geometry` Polygon/MultiPolygon WGS84 e `datetime` no formato `2026-01-01T00:00:00Z/2026-11-01T00:00:00Z`; `collection_ids` opcional contém somente `S2-16D-2`. `POST /api/v1/plots/:id/imagery/search` aceita os mesmos filtros sem geometria, resolvendo a parcela da organização. `cursor` opaco permite no máximo cinco páginas de vinte cenas, mantendo organização, geometria, versão e filtros. Ordenação por data vale dentro da página.

Resposta 200: `{query_id, geometry_hash, geometry_version, status, scenes, next_cursor, queried_at, cached, context_provenance, limitations}`. Cenas contêm identificadores, datas/intervalo, footprint, bbox, nuvens (null quando desconhecidas), plataforma, instrumentos, licença/atribuição, renderabilidade, bounds e URL interna. URLs de assets não são aceitas do cliente nem devolvidas. `SEM_IMAGENS` significa resposta válida sem cenas; falha externa é 503, nunca vazio sintético.

`GET /api/v1/imagery/queries/:queryId/scenes/:sceneKey/render` produz PNG privado autenticado, limitado ao bbox da consulta. Assets incompatíveis retornam 422 `SEM_VISUALIZACAO`; não se georreferencia thumbnail. Cache de PNG privado por organização/query/cena/hash dura 24 horas, limitado a 32 entradas e dois renders simultâneos. Headers `Cache-Control: private, no-store` e `Vary: Cookie` impedem reutilização pelo browser sem autorização.

`POST /api/v1/plots/:id/imagery-references` recebe `{query_id,scene_key,geometry_version}`. Hash/versão divergentes retornam 409; recurso de outra organização retorna 404. O vínculo é idempotente, imutável e gera `PLOT_IMAGERY_LINKED` no stream da própria referência, sem alterar stream da parcela, checks, Whisp, saldos ou prontidão. `GET` na mesma URL retorna histórico com `is_current` para identificar versões anteriores.

Consultas têm cache de uma hora, segregado por organização, geometria, filtros, página, versão de parcela e adaptador. Data original é preservada. Rascunhos não exigem lote e não usam `SourceQuery`. Metadados/snapshots vinculados permanecem preservados após expiração de cache; FK RESTRICT impede apagar consultas vinculadas. Rascunhos sem vínculo podem ser removidos após sete dias por manutenção autorizada; nenhuma remoção automática está habilitada. O raster remoto não é arquivado: indisponibilidade futura preserva metadados, mas pode impedir nova visualização.

Limites: 10.000 ha; mil vértices contados antes de PostGIS; intervalo até cinco anos; dez buscas/minuto/organização; busca 10 s e 5 MiB; render 20 s, 32 MiB e 1024 pixels/lado. Transporte valida HTTPS, hostname/path, DNS público, conexão fixada ao IP validado e redirects. Há no máximo uma repetição transitória dentro do prazo. 401 sem sessão, 404 recurso inacessível, 409 versão/idempotência, 422 entrada inválida, 429 limite, 503 provedor/flag. Exemplos são demonstrativos; consulta real não comprova a origem declarada.

Trecho sanitizado de cena real retornada no smoke de 06/11/2026 (envelope privado, query/plot/footprint e URL interna omitidos):

```json
{
  "collection_id": "S2-16D-2",
  "item_id": "S2-16D_V2_016009_20261016",
  "datetime": "2026-10-16T00:00:00.000000Z",
  "start_datetime": "2026-10-16T00:00:00.000000Z",
  "end_datetime": "2026-10-31T00:00:00.000000Z",
  "cloud_cover": 16.26,
  "platform": null,
  "instruments": [],
  "license": "proprietary",
  "renderable": true
}
```

O registro integral local fica em `data/private/inpe-live-smoke.json`, fora de exportações públicas. O período acima é uma composição; não representa uma fotografia instantânea nem aprovação regulatória.
