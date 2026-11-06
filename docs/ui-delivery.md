# Interface conectada — entrega de 06/11/2026

As oito etapas continuam na mesma aplicação React. Cadastro, corte, remessa, expedição, recebimento, transformação, decisão e emissão de passaporte usam `/api/v1` com sessão, CSRF e chave de idempotência. Falha de serviço é exibida sem substituir os dados por exemplos locais. Trocar a pessoa da sessão limpa os formulários operacionais.

## Implementação

- Cadastro: GeoJSON sintético carregável, prévia Leaflet, mensagens em português para JSON inválido, anel aberto e coordenadas fora dos limites; validação final de topologia e área na API/PostGIS. Fonte e informante declarados são enviados na proveniência, com rótulo SIMULADA.
- Custódia: início/fim de corte independentes, seleção do destinatário cadastrado, UFs, IDs das remessas, confirmação de expedição pelo remetente e volume conferido pelo destinatário em outra sessão. A pendência normativa aparece para a origem e o destino declarados, sem afirmar validação de rota.
- Serraria: entradas recebidas, seleção do parâmetro versionado, resíduos/perdas explícitos, alocações medidas e modo de múltiplas entradas/saídas. Erro JSON é visível antes do envio. Consulta das transformações mostra IDs, entradas, saídas e volumes persistidos.
- Revisão: sinal original, regra/versão, mensagem, fonte, valores/limites, autoria, histórico de decisões, documentos privados e resultado efetivo obtido da API. Autor não decide seu próprio caso; a interface oferece pendência, análise, rejeição ou resolução com evidência e respaldo aplicável. Para R10, a referência de exceção precisa existir e ser validada no servidor.
- Passaporte e trace: emissão real pela API, QR, região pública generalizada, consulta privada dos ancestrais, quantidades e frações por origem, mapa de cada parcela única e etapas ancestrais. Indicadores mostram volume conhecido/total, desconhecido/total, fração, data e duração de geração. Exibição percentual não recalcula saldos.
- Privacidade: a página `/p/token` não consulta personas ou dashboard. O mapa público mostra apenas uma região ilustrativa do Brasil; não recebe geometrias exatas. O mapa privado preserva os contornos mesmo sem tiles. Nenhum indicador estima impacto ambiental ou economia.

## Verificação executada

`npm run build -w @foresttrace/web` passou. Os 24 E2E existentes de navegação, consulta pública, atores, Whisp e calculadora passaram em Chromium desktop e móvel. Oito novos casos com API interceptada (`tests/e2e/delivery-panels.spec.ts`) passaram: cadastro inválido/válido e proveniência, transformação e JSON inválido, revisão com histórico e documento, trace conhecido/desconhecido e mapa sem tiles.

Também foi executado navegador contra API e PostgreSQL reais (`tests/e2e/delivery-live.spec.ts`), sem interceptar as chamadas operacionais. O teste cria somente registros sintéticos novos: parcela → documento privado → lote → corte10 → remessa10 → expedição → troca de pessoa → recebimento10 → transformação10→3 → trace → passaporte/QR → consulta pública → downloads JSON/HTML. Desktop e móvel passaram; os arquivos exportados mantiveram MISSING_EVIDENCE. Capturas `01-registration.png` a `08-public.png`, trace e vídeos WebM ficam sob `test-results/ui-live/`.

```powershell
# Pré-requisitos: banco migrado, seed:demo e API rodando em3000.
$env:FORESTTRACE_LIVE_E2E='true'
npm.cmd run test:e2e -- tests/e2e/delivery-live.spec.ts --workers=1 --output=test-results/ui-live
```

Sem a variável, os testes que exigem API/banco reais ficam explicitamente ignorados. A suíte usual com API interceptada não substitui o ensaio real. A inicialização usa localhost5173, uma das origens autorizadas; o exemplo também permite127.0.0.1:5173. Os testes geram dados com prefixo UI-LIVE e não apagam o histórico da demo.

As capturas são de dados sintéticos. Cobertura normativa pendente, revisão demonstrativa e integridade verificada não significam autorização, conformidade oficial ou prontidão real. A validação normativa da rota candidata permanece fora desta entrega.
