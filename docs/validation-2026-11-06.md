# Validação das pendências técnicas — 06/11/2026

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
