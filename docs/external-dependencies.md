# Pendências externas do ForestTrace

Registro atualizado em 06/11/2026. Inclui confirmação do contrato publicado da Whisp e uma consulta externa autorizada sobre geometria sintética, documentada em `sources-and-limits.md`. Não representa confirmação normativa.

| Pendência | Estado registrado | Próxima ação e responsável | Evidência para encerramento | Efeito na entrega |
|---|---|---|---|---|
| Whisp: contrato, chave, cobertura e execução autorizada | Contrato publicado confirmado; chave local configurada; consulta concluída HTTP 200 sobre geometria sintética | Arthur e Adriano: conferir cobertura, períodos e interpretação das camadas no escopo da operação | Protocolo em `whisp-integration.md`; execução e hashes em `sources-and-limits.md`; resposta preservada em diretório privado | Adapter real disponível; a consulta sintética continua demonstrativa, sem validar origem ou liberar prontidão |
| Rota interestadual candidata AM → SP | PENDENTE DE VERIFICAÇÃO | David e Adriano: delimitar produto, modalidade, espécie, período, municípios e percurso; verificar origem, trânsito, transporte e destino | Checklist em `demo-route-validation.md` com fontes oficiais, artigos, vigência, requisitos, evidências, autoridade, revisores e data, sem item aplicável pendente/conflitante | Não anunciar rota validada nem prontidão regulatória |
| Requisitos locais nas 27 UFs | Inventário de pesquisa disponível; cobertura integral não confirmada | David e Adriano: confirmar os requisitos das operações efetivamente usadas | Regras versionadas com fonte, vigência e escopo aplicável; lacunas registradas | Cadastro e histórico nacionais continuam disponíveis; cobertura desconhecida bloqueia prontidão |
| CRV e exceções documentais | Fator 0,35 apenas demonstrativo; vigência e aplicabilidade pendentes | David: confirmar fontes vigentes, produto/modalidade e aprovação competente de eventuais exceções | Fonte oficial aplicável e documento de aprovação com escopo e período compatíveis | Testes demonstrativos não confirmam parâmetro normativo nem autorizam volume |
| Identificação taxonômica do exemplo | Associação entre nome comum e científico pendente de verificação | Equipe de dados, com David e Adriano: confirmar a espécie para a origem escolhida | Referência verificável e identificação compatível com o escopo da demo | Manter a espécie como exemplo sintético até confirmação |
| Elegibilidade no evento e combinação de frentes | PENDENTE DE CONFIRMAÇÃO | David: consultar regulamento e organização do evento | Regra ou resposta explícita registrada com data | Não presumir aprovação pela ausência de resposta |
| Licença de distribuição | MIT escolhida pelo responsável e registrada | Equipe: observar as condições próprias dos componentes e materiais de terceiros | Texto MIT completo em `License.md` | Código licenciado sob MIT; isso não altera as licenças das fontes de dados |

## Limites que permanecem após as correções de software

Idempotência, permissões comerciais, retificações, reavaliação por exceções e verificação de ancestrais/documentos são trabalho interno de implementação. Concluí-los não encerra as dependências externas acima.

Os dados operacionais e a geometria de demonstração são sintéticos. Pacotes demonstrativos ou apoiados em evidências simuladas continuam `MISSING_EVIDENCE`, mesmo com revisão concluída. Integração oficial DOF+/fiscal, envio de DDS e autenticação de produção permanecem fora do escopo do MVP.

## Referências locais

- [Fontes, procedência e limites](sources-and-limits.md)
- [Checklist da rota candidata](demo-route-validation.md)
- [Contrato da API](api-contract.md)
- [Guia local de integração Whisp](whisp-integration.md)
- [Matriz de pesquisa das 27 UFs](research/controle-florestal-27-ufs-2026-11-05.csv)

## Estado do OpenSpec antes desta rodada

Mudança: `foresttrace-digital-timber-passport`; schema: `spec-driven`.

Proposta, sete specs, design e tarefas estão com artefatos de planejamento concluídos. A implementação está `in-progress`, com **0/44 tarefas marcadas como concluídas**. O indicador `isComplete: true` de `openspec status` refere-se ao planejamento; não comprova implementação. Há código existente e alterações locais que precisam ser reconciliados com critérios e testes antes de fechar caixas.

Após a rodada Whisp de 06/11/2026: **6/44 tarefas marcadas**, sendo 1.5, 4.2 e 4.3 verificadas especificamente nesta rodada; 3.2, 5.1 e 5.8 foram marcadas por outras frentes. As caixas restantes precisam de verificação individual; o código existente não foi usado sozinho como prova de conclusão. Detalhes e resultados estão em `openspec/changes/foresttrace-digital-timber-passport/tasks.md`.
