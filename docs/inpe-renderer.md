# Renderizador privado INPE

O serviço `apps/api/src/services/inpe-render.ts` usa `fromCustomClient` do GeoTIFF, com transporte próprio por instância. Não altera `globalThis.fetch`. Aceita somente as bandas B04/B03/B02 da configuração S2-16D-2 comprovada, recorta a janela de origem, converte Albers BDC para EPSG:3857 e devolve PNG com bounds WGS84 em ordem longitude/latitude. A interface deve inverter essa ordem ao construir bounds Leaflet.

A configuração exige os parâmetros GeoTIFF Albers aprovados; transformação com rotação, CRS diferente ou metadados não finitos são rejeitados. Nodata zero e pixels fora da cobertura ficam transparentes. Escala RGB linear: valor bruto × 0,0001 × 255, limitado a 0–255. Não há thumbnail georreferenciada artificialmente.

Limites: 1024 pixels por lado, 4.194.304 pixels por janela e por bloco TIFF decodificado, no máximo 16.777.216 pixels no conjunto de blocos tocados por banda, até quatro bytes por pixel de origem e 32 MiB de bytes remotos por render. O limite do conjunto também impede que um recorte estreito toque milhares de blocos largos e contorne o orçamento de memória. O prazo de 20 segundos é compartilhado entre as bandas, leituras e reprojeção; há uma única repetição transitória compartilhada pelo render, sem renovar o prazo. Não há fallback para arquivo inteiro se HTTP Range não retornar 206 válido. PNG é mantido apenas pelo chamador privado; este serviço não cria arquivo público.

O transporte usa HTTPS com host e caminho exatos, valida DNS público e fixa o endereço na conexão TLS real. Revalida cada redirecionamento; rejeita IP privado, loopback e IPv4 mapeado em IPv6. JSON é limitado a 5 MiB, dez segundos e uma repetição transitória. Autenticação remota rejeitada não vira lista vazia. Os buffers de resposta são limitados durante o recebimento, além da verificação de Content-Range.

## Evidências de 06/11/2026

- `npx.cmd vitest run apps/api/tests/domain/inpe-render.test.ts`: 23 testes passaram, incluindo TIFF georreferenciado gerado no teste, canais RGB, transparência parcial, três pontos de controle da footprint STAC independentes dos tags lidos, tamanho, URLs, DNS, redirecionamento, IPv4 mapeado, 401, 429/5xx, prazo, corpo excessivo, Range incompatível, orçamento único de repetição entre bandas e limite agregado de blocos decodificados para recorte estreito.
- `npm.cmd run typecheck -w @foresttrace/api`: passou.
- Chamada real ao **serviço de produção**, sem mock, sobre bbox sintético `[-60,-3,-59.99,-2.99]`, item `S2-16D_V2_016009_20261016`: PNG 96 × 96, 20.359 bytes, leitura Range total de 1.279.670 bytes. Artefato privado: `data/private/inpe-production-render.png`. O resultado coincide com a prova delimitada. O teste de três pontos verifica consistência de metadados espaciais, não precisão de levantamento em campo.

Essas evidências cobrem transporte e renderizador. Sessão, autorização da consulta, cache segregado, concorrência por processo e integração da interface pertencem à camada de rotas e precisam de seus próprios testes. A cena real consultada sobre geometria sintética continua demonstrativa. A licença não é presumida livre para redistribuição; preservar as limitações registradas no guia INPE.
