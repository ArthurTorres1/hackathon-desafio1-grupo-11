# Validação das pendências técnicas — 06/11/2026

## Continuação em Windows — base executável

Verificação da tarefa 1.1 nesta máquina com Node 24.18.0 e npm 11.16.0: `npm ci` instalou 306 pacotes a partir do lockfile; `npm run db:generate`, `npm run typecheck` e `npm run build` passaram. Não foram encontrados arquivos vazios em `apps/api/src`, `apps/web/src` ou `packages/contracts/src`. Prisma e Vite precisaram de execução fora da sandbox por bloqueio `spawn EPERM` do esbuild. Nenhuma versão de dependência foi alterada para essa verificação.

Docker e psql não foram encontrados no PATH nem nas instalações convencionais pesquisadas. PostgreSQL/PostGIS, migração, seed e testes contra banco não foram reexecutados nesta máquina; a tarefa 1.2 permanece aberta. Os resultados de banco registrados nas demais seções desta rodada são evidência histórica, não execução nesta continuação.

## Calculadora de cubagem e aproveitamento — tarefas 9.1–9.3

Implementados serviço puro Decimal com precisão interna de 60 dígitos, contratos TypeBox e `POST /api/v1/calculations/forest-utilization`. Os perfis são demonstrativos e versionados. Área efetiva é informada separadamente; não se presume exploração apenas pela diferença total menos APP. Denominadores nulos mantêm razões não avaliadas; dados incoerentes são rejeitados. O equivalente adicional indica quantidade sob o coeficiente, sem comprovar crime.

Verificações executadas: 30 testes do motor (incluindo limites exatos antes de arredondar, maior magnitude permitida, perfis inválidos e zeros), oito de contrato e 13 HTTP via `app.inject`. Os testes HTTP usam sessão/log simulados e validam autenticação, CSRF, perfis, rejeição de parâmetros extras e resposta incompatível, sem transação operacional. Não constituem teste contra banco real. A suíte completa `npm test` passou com 117 testes em 14 arquivos no estado disponível do workspace; `npm run typecheck` e `npm run build` também passaram. `docs/openapi.json` foi exportado da aplicação real por `app.inject`, sem banco.

O caso 120/20/100 ha, 2100→714 m³ apresentou 21 m³/ha, aproveitamento 70% e CRV 34%. O caso 60/10/50 ha, 1850→1100 m³ apresentou 37 m³/ha, excesso sob perfil de 350 m³, CRV 59,459459% e equivalente adicional 1292,857143 m³. Ambos permanecem `DEMONSTRATIVO`/`SIMULADA`/`MISSING_EVIDENCE`, sem alteração de saldo, autorização ou passaporte. Referências e condições estão em `docs/sources-and-limits.md`.

O painel **Cubagem e aproveitamento**, no passo **Transformação**, passou em 18 testes de navegador: dez da calculadora e oito de regressão da navegação existente, em Chromium desktop e móvel (`npm run test:e2e -- tests/e2e/forest-utilization.spec.ts tests/e2e/foresttrace.spec.ts --workers=2`). Cobertos exemplos, cubagem opcional, ausência de área efetiva, limite exato, erro de entrada/serviço, sessão e invalidação do relatório ao editar. Os E2E usam API interceptada, sem banco real. As capturas `calculator-example-2.png` em `test-results/` foram inspecionadas; números mantêm leitura em tela móvel e fontes longas quebram linha. Após o ajuste visual, `npm run build -w @foresttrace/web` passou novamente.

As cinco pendências do contrato foram implementadas e verificadas nesta rodada com três subagentes GPT-6 Luna e integração pelo agente principal.

| Entrega | Comportamento verificado |
|---|---|
| Idempotência operacional | Chave obrigatória; replay preserva status/corpo; conteúdo divergente retorna 409/R17; falhas revertem mutação e chave. Duas remessas concorrentes de 6 m³ sobre saldo de 10 m³ produzem uma reserva aceita e outra rejeitada, com um único movimento/evento. |
| Permissões comerciais | Grants explícitos e revogáveis para documentos e passaportes; comprador/auditor precisa de autorização por objeto. Um grant de passaporte não libera os documentos. Usuário sem papel de gestão não cria/revoga grants mesmo dentro da organização proprietária. Exportação filtra referências indisponíveis e distingue hash da visualização do hash do snapshot. |
| Retificações | Origem, remessa e transformação têm histórico anterior/corrigido, controle de versão e evento compensatório. Descendentes recebem R19 e saldo disponível vai para quarentena. Campos de alocações/consumos históricos não aceitam edição direta; volume inválido ou reserva/transporte em curso rejeitam a alteração atomicamente. |
| Reavaliação por exceção CRV | Aprovação vinculada exige documento íntegro, autoridade/referência, parâmetro, produto, espécie e vigência compatíveis. Nova avaliação, decisão, evento e compensação de quarentena são transacionais. A checagem anterior é preservada; justificativa isolada não libera volume. Autor não decide o próprio caso. |
| Ancestrais e documentos | Percurso recursivo inclui produtos intermediários, origens, parcelas, transformações, remessas e documentos de suporte. Hashes canônicos evitam falsos positivos pela ordem de chaves JSONB. Metadado alterado, checkpoint removido, bytes alterados/ausentes, ciclo ou vínculo faltante impedem verificação válida. Novo alerta invalida o estado atual sem reescrever o snapshot. |

## Resultados executados

| Comando | Resultado |
|---|---|
| `npm run db:generate` | Cliente Prisma gerado |
| `npm run db:prepare-test` | Migrações aplicadas em `foresttrace_test` |
| `npm run db:migrate` | Três migrações aditivas aplicadas no banco local `foresttrace` |
| `npm run typecheck` | Passou |
| `npm test` | 53 testes passaram |
| `npm run test:integration` | 36 testes passaram em seis arquivos |
| `npm run test:e2e` | 8 testes passaram em Chromium desktop e móvel |
| `npm run build` | API, contratos e interface compilados |
| `npm run seed:demo` | Dados sintéticos sincronizados; documento de suporte materializado no storage privado |
| `npm run verify:chain` | Válido: oito eventos, quatro streams e um documento de demonstração |
| `git diff --check` | Sem erros de whitespace |

Os testes de integração usam PostgreSQL/PostGIS e chamadas HTTP via `app.inject`, com papel de aplicação e banco isolado. Eles cobrem geração e verificação de passaportes. O banco local de demonstração não tinha passaportes no momento do comando `verify:chain`; esse resultado não substitui os testes HTTP de passaporte.

Os testes de navegador cobrem navegação, consulta pública, erro de serviço e troca de remetente/destinatário com respostas de API interceptadas. Não constituem ensaio completo de navegador contra API/banco reais. Instalação limpa em outro sistema operacional, restauração de backup e apresentação cronometrada não foram executadas nesta rodada.

## Limites preservados

Mutações idempotentes compartilham um lock transacional de domínio para proteger saldo e estado no MVP local; isso serializa escritas. A verificação detecta inconsistências em relação aos snapshots e registros preservados, sem assinatura forte ou proteção contra um administrador capaz de reescrever tudo.

Geometrias antigas registradas com hash não canônico e snapshots anteriores sem os novos checkpoints/digests podem exigir revisão e reemissão; não são reinterpretados como verificados automaticamente.

Os dados demonstrativos continuam `MISSING_EVIDENCE`. O fechamento dessas pendências técnicas não confirma requisitos normativos, documentos oficiais, elegibilidade no evento nem acesso externo. Consulte [external-dependencies.md](external-dependencies.md) e [api-contract.md](api-contract.md).

Houve alterações paralelas no workspace relativas a Whisp e licença. Foram preservadas. As contagens acima correspondem às suítes completas disponíveis no momento da execução, incluindo esses testes adicionais; não representam uma auditoria integral de todas as tarefas do OpenSpec.
