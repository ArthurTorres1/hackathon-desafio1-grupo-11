# Validação das pendências técnicas — 06/11/2026

## Fechamento do entregável solicitado, excluindo rota e normas

Relatório final em [delivery-2026-11-06.md](delivery-2026-11-06.md). Implementadas as vinte tarefas restantes do escopo de produto/entrega: contratos, cadastro, interfaces, fontes, mistura, revisão/venda, pacote, trace/indicadores, seed pela API, integração nacional, recuperação e documentação/imagem. Controle final: 44/47; somente 1.7, 2.6 e 4.5 permanecem abertas por exclusão explícita de rota/normas.

Aceite completo executado: 164 testes unitários, 102 integrados contra PostgreSQL/PostGIS e 36 de navegador passaram. Destino RS foi percorrido no navegador móvel; dados, documentos e cadeia das 27 UFs foram recuperados após reabertura da API/conexão. A imagem Linux compilou e serviu SPA, sessão da própria origem, dashboard e pacote privado em 127.0.0.1:3001. Intervalos de geração usam relógio monotônico após a verificação em contêiner revelar ajuste regressivo do relógio civil; cinco testes integrados de entrega foram repetidos e passaram depois dessa correção.

O backup final de data/backups/2026-11-06T15-41-27-021Z foi restaurado no banco separado foresttrace_restore_1793979727086 com documentos em pasta própria; a verificação de hashes passou na cópia restaurada. Capturas das oito etapas e vídeos do ensaio automatizado estão em test-results/ui-live e test-results/release. Roteiro planejado de 180 segundos entregue; não foi gravada fala humana. Licença MIT conferida, elegibilidade no evento registrada como pendente, macOS nativo não executado e nenhuma aprovação normativa presumida.

## Continuação da persistência com subagentes

Implementadas e integradas as frentes de autenticação, cadastro e custódia. Memberships agora restringem papéis efetivos em cada requisição; revogação afeta sessões existentes, logout exige CSRF e logs não guardam query strings de credenciais. Cadastro/consulta de parcelas e lotes tem escopo organizacional e testes nas 27 UFs, com geometrias/áreas/hash canônico/autoria persistidos. Seed executado com papel de aplicação no banco separado de validação confirmou as organizações/personas demonstrativas.

O serviço de saldos usa Decimal, locks de linha em ordem estável e débito condicionado. Os handlers usam o mesmo append de `services/audit-events.ts` dentro da transação idempotente. Verificados rollback em falha de evento, volume decimal exato, concorrência 6+6 sobre saldo 10, corte 12/10 pendente idempotente, corte fora da vigência, datas invertidas e confirmações separadas. Recebimento 10/9,9 conserva a diferença em quarentena e abre R09; 10/0 não cria crédito. Transformação exige recebimento, persiste 10→3 e rejeita duplicidade/saída sem evento ou consumo repetido. Documentação em `auth-persistence.md`, `custody-persistence.md` e `api-contract.md`.

Migração `202611060005_regulatory_versions` aplicada em `foresttrace`, `foresttrace_test` e `foresttrace_migration_check_20261106`. O enum de cobertura aceita versões imutáveis, contexto/hash/autoria e perfis BR + 27 UFs. Motor/rotas/testes de aplicabilidade por fase/data/produto/modalidade/sistema estão implementados; ausência de perfil, lista vazia, versões inválidas e fontes conflitantes mantêm lacunas. Avaliações anteriores são preservadas e resumos atuais são invalidados por mudanças no contexto/catálogo. Resumo público do passaporte é minimizado e não promove evidência sintética. Perfis confirmados nos testes são isolados, sem valor normativo, e não foram importados do CSV.

Resultados finais: `npm test` passou com 158 testes em 16 arquivos; `npm run test:integration` passou com 65 testes em dez arquivos; `npm run typecheck` e `npm run build` passaram. `npm run docs:openapi` atualizou o contrato exportado. O seed foi verificado no banco separado, sem substituir a verificação completa exigida em 7.1. Não foram executados novos E2E nesta continuação.

Concluídos os critérios de 2.2, 2.4, 3.1, 3.3 e 3.4. A tarefa 2.6 permanece aberta por sua dependência do checklist 1.7 da rota, embora sua parte de software tenha sido implementada e testada. A tarefa 2.3 continua aberta para auditoria completa de validação das respostas. Os subagentes deixaram alterações parciais ao atingir o limite de créditos do workspace; a integração e os testes finais foram concluídos pelo agente principal.

## Banco de dados — verificação posterior com Docker disponível

Nesta continuação, Docker Desktop foi iniciado e `docker compose up -d db` confirmou PostgreSQL/PostGIS em execução. A migração aditiva `202611060004_database_guarantees` foi aplicada em `foresttrace` e `foresttrace_test`. `npm run db:migrate` também aplicou as seis migrações do zero no banco separado `foresttrace_migration_check_20261106`, preservado para inspeção. Nenhum banco foi apagado ou reinicializado.

Adicionados vínculos dos autores da expedição/recebimento, índices de consulta, validação PostGIS de novas geometrias e constraints de percurso, UF, vigência e cobertura normativa. Avaliação CONFIRMADA exige requisitos não vazios e nenhuma lacuna. Perfis normativos, avaliações, parâmetros de conversão e bundles são imutáveis para o papel de aplicação. Passaportes permitem UPDATE apenas na lista de grants; emissão grava conteúdo e checkpoints completos em um INSERT transacional com seu evento. Logs continuam aceitando identificadores desconhecidos de tentativas negadas.

`/health` consultou PostGIS pelo papel de aplicação e retornou 200 no teste HTTP integrado. Testes isolados também verificam 503 quando a dependência falha, sem expor detalhes da conexão. Verificados 119 testes unitários e 44 testes de integração em seis arquivos, incluindo rollback, chave fiscal duplicada, FKs, saldo negativo, disputa de duas reservas de 6 m³ sobre saldo 10, cadeia persistida de 10→3, grants e snapshots protegidos. A primeira tentativa das suítes encontrou contratos compilados desatualizados; os scripts agora os compilam antes dos testes. As contagens históricas abaixo correspondem às rodadas anteriores.

A constraint espacial usa NOT VALID para preservar declarações legadas inválidas, encontradas em fixtures anteriores com polígonos vazios. Ela rejeita novas inserções/atualizações inválidas; não atesta a validade das linhas antigas. Após revisão, o proprietário pode executar `ALTER TABLE plots VALIDATE CONSTRAINT plots_geometry_valid`. Nenhuma geometria foi reparada automaticamente. As fixtures ativas de integração foram corrigidas para polígonos válidos.

Concluídos os critérios de ambiente/banco das tarefas 1.2 e 2.1. A proteção normativa persistida é parte de 2.6; seleção por aplicabilidade, consulta autorizada e checklist AM→SP ainda exigem trabalho e a tarefa permanece aberta. As demais caixas não foram concluídas apenas pela presença de código ou por cobertura parcial da suíte.

Após o ajuste final de emissão do passaporte, `npm run typecheck`, `npm run build` e `git diff --check` passaram. Progresso confirmado pelo OpenSpec: 19/47 concluídas e 28 abertas.

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
