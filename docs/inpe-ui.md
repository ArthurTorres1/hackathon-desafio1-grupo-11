# Interface privada INPE

O cadastro e a etapa Origem & sinais compartilham `SatelliteImagery`. A busca é explícita, com período inicial visível dos últimos 12 meses. A API informa coleções e limites pelo contrato compartilhado de capabilities. Não há consulta por digitação do GeoJSON.

O mapa mantém OpenStreetMap como base e recebe somente PNG privado georreferenciado. Os bounds do contrato são longitude/latitude e são convertidos para latitude/longitude no Leaflet. A opacidade pode ser alterada sem nova consulta. A base e a imagem podem ser desligadas separadamente. Mapas públicos generalizados rejeitam o overlay mesmo se um chamador o fornecer.

A seleção mostra coleção, item, data ou intervalo de composição, nuvens desconhecidas, plataforma/sensor, atribuição e licença declarada. Pixels sem dados ficam transparentes. Uma prévia sem referência espacial aparece somente fora do mapa. A falha de PNG mantém os metadados e a base disponíveis.

Cada busca/render possui AbortController e contexto composto por sessão, parcela, hash/versão, geometria e filtros. Alterações cancelam a operação e removem seleção e imagem. Respostas de um contexto antigo são descartadas. URLs de imagem precisam ser internas às rotas privadas de consultas. Blobs são revogados ao substituir ou desmontar a imagem.

Após criar a parcela, o formulário guarda o resultado e tenta vincular a cena em uma operação separada. Uma falha de vínculo mostra nova tentativa e mantém a parcela cadastrada; não chama novamente o cadastro. A etapa Origem & sinais resolve a parcela do lote efetivamente selecionado e não usa o GeoJSON do formulário. O histórico mostra referências de versões anteriores sem aplicá-las automaticamente.

Com a flag desligada, o cadastro e o mapa continuam utilizáveis. O histórico privado de metadados pode ser lido; novas buscas e renders ficam indisponíveis. O controle não transforma imagem real sobre geometria sintética em evidência de origem comprovada nem altera Whisp/prontidão.

## Verificação determinística

Em 06/11/2026, `npm.cmd run test:e2e -- tests/e2e/inpe-imagery.spec.ts --workers=1 --output=test-results-inpe-extra` passou 20 casos (dez cenários em Chromium desktop e móvel):

- Falha de render e do primeiro vínculo, seguida de nova tentativa de vínculo, com exatamente uma criação de parcela.
- Edição da geometria removendo a seleção anterior e preservando o cadastro.
- Resposta atrasada descartada após alteração do período.
- Overlay privado, opacidade e alternância independente da base e da imagem.
- Flag desabilitada sem chamada de busca e com cadastro disponível.
- Alternância entre dois lotes consultando os IDs de suas respectivas parcelas e removendo seleção anterior.
- Histórico de versão anterior disponível com a integração desligada, sem aplicação automática à geometria atual.
- Falha de busca com HTTP 503 preservando os campos e permitindo cadastro sem vínculo de imagem.
- Troca de sessão descartando a resposta atrasada de uma busca da sessão anterior.
- Cena incompatível mantendo metadados com SEM_VISUALIZACAO, sem pedido de render nem overlay.

Esses testes usam respostas e PNG de fixture para verificar comportamento da interface. Não constituem prova de alinhamento do raster real nem disponibilidade externa; essa evidência pertence ao smoke integrado documentado no guia INPE.

## Smoke real no navegador

`FORESTTRACE_INPE_LIVE_E2E=true npm.cmd run test:e2e -- tests/e2e/inpe-live.spec.ts --project=desktop-chromium --workers=1 --output=test-results/inpe-live-final` passou um caso com API local real na rodada final (5,8 segundos): sessão da Autora entregável, seleção do lote sintético criado pelo smoke, reabertura da referência preservada e PNG privado renderizado. A execução leu o smoke `eb9952f7-3aaa-4265-865e-d0d58bb75e2d`, com parcela `dde3d4d5-38cd-46e7-8886-4bf4bbfff58d` e lote `52ea5e4f-bcbc-4dd1-bf96-26885cb4ec81`.

As evidências atualizadas estão em `data/private/inpe-live-browser.png` e `data/private/inpe-live-browser-full.png`. A captura foi inspecionada: imagem aparece no contorno da parcela, com atribuição INPE/BDC, intervalo temporal, coleção, licença declarada e controles; isso verifica posicionamento pela extensão geográfica retornada, sem afirmar acurácia física ou origem comprovada. Datas das cenas usam UTC para não deslocar a data da composição pelo fuso local. Nenhuma resposta da API ou pixel do INPE foi substituído por fixture nesta execução real.

## Verificação final da suíte de interface

A rodada final completa e a repetição dos casos interrompidos somaram **58 testes com fixtures aprovados**: 33 aprovados e seis ignorados na execução completa, mais 25 casos interrompidos aprovados na repetição. O teste real INPE foi executado explicitamente e passou separadamente (um caso). As interrupções anteriores decorreram do ciclo de vida do servidor de desenvolvimento e da colisão de diretórios de artefatos entre execuções; a repetição utilizou saídas separadas. A expectativa antiga de título na navegação foi atualizada para o título atual da interface.
