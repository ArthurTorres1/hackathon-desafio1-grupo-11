# Contrato local da API

O contrato dos payloads está em `packages/contracts/src/index.ts`. A API publica OpenAPI em `/openapi.json` e a interface de consulta em `/docs`.

## Sessão e escopo

Em `DEMO_MODE=true`, `GET /api/v1/auth/personas` lista pessoas sintéticas e `POST /api/v1/auth/session` recebe `{user_id}`. A resposta define a sessão HTTP-only e retorna `csrf_token`. Escritas autenticadas exigem o cabeçalho `X-CSRF-Token`; a organização vem da sessão. Este mecanismo é exclusivamente demonstrativo.

`GET /api/v1/dashboard` retorna parcelas, lotes próprios ou sob custódia, remessas enviadas/recebidas, saldos, parâmetros de conversão, documentos da organização, casos e passaportes. Os documentos são metadados, sem caminho físico. Lotes recebidos aparecem para a serraria com seu saldo disponível.

## Documentos privados

- `POST /api/v1/documents`: recebe nome, tipo, `content_base64`, fonte, proveniência, escopo e visibilidade. Aceita até 10 MB de bytes; o limite HTTP é 15 MB. Retorna 201 com metadados e SHA-256 dos bytes originais. Chave fiscal repetida retorna 409/R17.
- `GET /api/v1/documents/{id}/download`: exige sessão da organização proprietária. IDs conhecidos de outra organização retornam 404; ausência de sessão retorna 401. O download é um anexo binário e verifica o hash antes de servir os bytes. Divergência retorna 409/R18; arquivo indisponível retorna 404.
- A autorização de um novo lote deve referenciar um documento acessível à organização da sessão.

`BUYER_RELEASED` registra a intenção de visibilidade. A organização proprietária concede acesso explicitamente por `POST /api/v1/documents/{id}/grants` com `{organization_id}` e revoga por `DELETE /api/v1/documents/{id}/grants/{organization_id}`. Comprador ou auditor de outra organização precisa desse grant para baixar o arquivo; conhecer o ID ou o token público não concede acesso. Criação e revogação são auditadas.

## Idempotência

Escritas autenticadas exigem `Idempotency-Key` com 1–200 caracteres ASCII imprimíveis sem espaços. A ausência retorna 422/`IDEMPOTENCY_KEY_REQUIRED`. Sessão de demonstração não exige a chave.

A chave é vinculada ao usuário e à operação; parâmetros de rota e corpo entram no hash canônico. Reenvio idêntico devolve o status e corpo originais. A mesma chave com outro conteúdo retorna 409/`R17`. Operação e resultado são persistidos na mesma transação: falha não confirma consumo, evento ou chave. A proteção cobre cadastro, documentos, corte, remessas, transformação, revisão, retificações e emissão de passaportes. Revogação de grants também exige chave.

As mutações idempotentes compartilham um lock transacional de domínio no PostgreSQL. Essa escolha serializa escritas no MVP local, incluindo requisições com chaves diferentes que disputam o mesmo saldo. Não é uma estratégia de escala horizontal de escrita.

## Avaliações Whisp

`POST /api/v1/lots/{id}/assess` recebe `{options?, refresh?, resume_query_id?, use_simulated_fixture?}`. A organização vem da sessão; apenas o operador proprietário do lote pode submeter. Exige CSRF e `Idempotency-Key`. A rota anterior `/api/v1/origin-lots/{id}/geospatial-assessments` permanece como alias.

A primeira submissão retorna **202** com `{source_query, assessment, check_status: "NAO_AVALIADO"}` após gravar uma confirmação durável. A consulta externa ocorre em processo, fora de transação de banco. O corpo inicial permanece igual em reenvios da mesma chave; consulte `GET /api/v1/lots/{id}/assessments` para obter o estado atual em `{source_queries, assessments, sources}`. O GET lê somente o banco e não chama o provedor. O alias GET anterior permanece disponível.

Sem `refresh`, resultado real compatível já concluído pode retornar **200**, `reused_cache: true` e `original_queried_at`; job compatível pendente retorna **202** sem novo submit. Geometria, versão da geometria, opções canonizadas, escopo e versão do contrato entram na seleção. Cache preserva data e evidência originais, sem garantia de atualidade. `refresh: true` solicita um novo trabalho explicitamente.

`resume_query_id` deve referenciar consulta pendente do mesmo lote/organização, com token e mesma geometria/opções/versão. A retomada cria novo registro vinculado ao anterior e faz somente GET de status no provedor. O submit é persistido assim que o token chega, sem polling externo automático; cada retomada faz uma consulta de status com retries limitados. O adapter também permite polling limitado a dois minutos para execução pelo script de diagnóstico.

`use_simulated_fixture: true` desativa o acesso externo e o cache real, registrando fixture `SIMULADA`. Sem configuração/chave, a consulta real permanece `NAO_AVALIADO`. Nenhuma falha, aceitação de job ou resultado recebido altera automaticamente a checagem para `PASSOU`: indicadores precisam de interpretação contextual. O payload privado preserva geometria/versão/procedência e opções; resultado guarda resposta, HTTP, hashes e horário sem segredo. Geometria sintética mantém o escopo demonstrativo.

Sem fila externa, uma queda do processo após o envio e antes de receber/persistir o token pode deixar a confirmação inicial pendente sem token. Reenvios não criam outro trabalho automaticamente: inspecione a consulta antes de decidir uma nova submissão explícita. Falhas de configuração/execução ficam registradas como não avaliadas quando o banco está acessível.

Detalhes e fontes: [Integração Whisp](whisp-integration.md).

## Custódia e transformação

`POST /api/v1/shipments` reserva o volume no remetente. `POST /api/v1/shipments/{id}/dispatch` confirma expedição pelo remetente; `POST /api/v1/shipments/{id}/receive` confirma recebimento pelo destinatário. As duas últimas rotas recebem `occurred_at`; recebimento também recebe `items: [{lot_id, volume_m3}]`, com cada lote uma única vez. Recebimento maior que o expedido é rejeitado sem crédito. Quantidade menor permanece divergente, com R09 e `RECEIVED_WITH_VARIANCE`.

`POST /api/v1/transformations` recebe organização, parâmetro de conversão, data, entradas, saídas, alocações, resíduos e perdas conforme o schema compartilhado. Consome o saldo na mesma transação dos produtos e do evento. Saídas + resíduos + perdas não podem exceder entradas. O parâmetro deve estar vigente; vigência sem término é aceita a partir da data inicial. R10 fica armazenada inclusive quando passa. Saída anômala ou de origem desconhecida fica em quarentena.

Exemplo da parte quantitativa da transformação 10→3:

```json
{
  "inputs": [{"lot_id": "UUID do lote recebido", "volume_m3": "10"}],
  "outputs": [{"client_ref": "SERR-001", "product": "serrado", "volume_m3": "3",
    "allocations": [{"origin_lot_id": "UUID da origem", "volume_m3": "3"}]}],
  "residue_m3": "7", "loss_m3": "0"
}
```

## Revisão humana

`POST /api/v1/audit-cases/{id}/decisions` recebe `{decision, comment, evidence_ids, conversion_exception_id?}`. Exige auditor na organização do caso. As decisões são `EM_ANALISE`, `RESOLVIDO_COM_EVIDENCIA`, `REJEITADO` ou `MANTIDO_PENDENTE`.

O autor da operação ou da versão avaliada recebe 403/`SELF_REVIEW_NOT_ALLOWED` em **qualquer decisão**, mesmo acumulando o papel de auditor ou abrindo nova sessão. A tentativa gera R20 no registro de acesso, sem cookies ou credenciais; nenhuma decisão ou alteração do caso é gravada. Autoria não identificável também impede decisão. Outro auditor da mesma organização pode revisar com justificativa e evidência acessível. Não há exceção administrativa à separação de autoria.

Resolução contextual preserva a checagem original. Para conflitos de saldo, recebimento, CRV ou origem, a resolução sem reavaliação retorna 422/`RULE_REASSESSMENT_REQUIRED`. Uma decisão interna não cria saldo autorizado.

`POST /api/v1/conversion-exceptions` registra parâmetro, documento de aprovação (`CRV_APPROVAL` ou `CONVERSION_EXCEPTION`), coeficiente, produto, espécie científica, autoridade, referência de aprovação, vigência e procedência. O documento precisa pertencer à organização e seus bytes precisam conferir com o hash. Exceções antigas sem escopo explícito não são aplicáveis.

Para resolver R10, informe `conversion_exception_id` e inclua o documento de aprovação em `evidence_ids`. A API confere organização, parâmetro, produto, espécie, aprovação e vigência na data da transformação. Reavalia o rendimento, preserva a checagem anterior e grava a nova checagem, decisão e compensação de quarentena atomicamente. Exceção fora de escopo/vencida, reavaliação que permanece em alerta e outros conflitos abertos não liberam saldo. Evidência sintética continua simulada.

## Retificações

`POST /api/v1/corrections` recebe `{entity_type, entity_id, expected_version, reason, changes, evidence_ids}`. O tipo pode ser `ORIGIN_LOT`, `SHIPMENT` ou `TRANSFORMATION`. Justificativa e documento de respaldo acessível com bytes/hash íntegros são obrigatórios. Somente a organização proprietária (remetente no caso de remessa) retifica o registro. Versão desatualizada retorna 409/`CORRECTION_VERSION_CONFLICT`.

Campos retificáveis:

- Origem: `species_common`, `species_scientific`, `right_of_use`, `valid_from`, `valid_until`, `authorized_volume_m3`.
- Remessa: `carrier`, `official_system`, `origin_state`, `destination_state`, `route_states`, `declared_at`, `dispatched_at`, `received_at`.
- Transformação: `occurred_at`, `residue_m3`, `loss_m3`.

Entradas, saídas, atribuições de origem, volume colhido e identidades dos custodiantes permanecem preservados. Volume autorizado não pode ficar abaixo do colhido; aumento exige autorização vinculada ao documento apresentado com volume e vigência suficientes. Resíduos/perdas não podem criar volume. Datas e UFs devem permanecer consistentes. Reservas ou transporte em curso exigem reconciliação prévia (`CORRECTION_RECONCILIATION_REQUIRED`).

A retificação guarda os dados anteriores e corrigidos, incrementa a versão, anexa evento compensatório e abre R19 para os registros e descendentes afetados. Saldos disponíveis afetados passam para quarentena sem novo crédito. Operações bloqueadas por R19 retornam 409. Decisão contextual isolada não resolve R19. Passaportes anteriores mantêm seu conteúdo histórico e passam a indicar revisão atual.

`GET /api/v1/corrections/{type}/{id}` retorna o histórico de versões acessível à organização autenticada.

## Passaporte e consulta pública

- `POST /api/v1/passports`: gera snapshot, token e `qr_data_url` de um produto da organização.
- `GET /api/v1/passports/{id}`: consulta privada.
- `POST /api/v1/passports/{id}/grants` com `{organization_id}` e `DELETE /api/v1/passports/{id}/grants/{organization_id}`: a organização proprietária concede/revoga acesso ao passaporte para comprador ou auditor de outra organização. O grant de passaporte não libera automaticamente seus documentos de suporte.
- `GET /api/v1/passports/{id}/bundle?format=JSON|HTML`: exportação privada.
- `GET /api/v1/passports/{id}/verify`: verifica hash do snapshot, cadeias e checkpoints dos ancestrais, metadados e bytes dos documentos de suporte. Links ausentes, ciclos, eventos alterados/removidos e documentos indisponíveis/adulterados impedem resultado válido. Mudança após emissão é informada separadamente da integridade histórica.
- `GET /api/v1/public/passports/{token}`: JSON público minimizado, sem sessão.
- `GET /p/{token}`: página da interface; disponível pela API após `npm run build` e `npm start`, ou pelo Vite em desenvolvimento.

O pacote demonstrativo permanece `MISSING_EVIDENCE`; cobertura normativa segue `PENDENTE_DE_VERIFICACAO`. Nenhuma rota é anunciada como validada. Hashes indicam consistência dos registros preservados, sem comprovar veracidade ou assinatura digital.

Consulta e exportação privadas filtram referências documentais sem grant e informam a quantidade de documentos retidos. A integridade é verificada sobre o snapshot original; uma visão filtrada não deve ser confundida com esse snapshot integral.

## Calculadora demonstrativa de aproveitamento

`POST /api/v1/calculations/forest-utilization` retorna um relatório isolado. Exige sessão, CSRF, `Idempotency-Key` e papel `OPERATOR` ou `AUDITOR`; comprador recebe 403. A chave é validada pelo envelope HTTP, mas não é persistida: repetir o cálculo não cria operações, saldo, eventos, autorizações nem alterações de passaporte.

Payload (todos os números medidos são strings com até seis casas decimais):

```json
{
  "area_total_ha": "120",
  "area_app_ha": "20",
  "area_effective_ha": "100",
  "extracted_log_volume_m3": "2100",
  "declared_sawn_volume_m3": "714",
  "management_profile_id": "DEMO_MECHANIZED_35Y_V1",
  "tree": { "dap_cm": "50", "commercial_height_m": "12" }
}
```

`tree` e `area_effective_ha` são opcionais. Ausência da área efetiva mantém a origem `NAO_AVALIADO`, com lacuna explícita; não se presume que total menos APP seja área explorável. Perfis do servidor: `DEMO_MECHANIZED_35Y_V1` (30 m³/ha, ciclo35) e `DEMO_NON_MECHANIZED_10Y_V1` (10 m³/ha, ciclo10). Ambos usam CRV demonstrativo0,35 e fator de forma0,70; não aceitam coeficiente, aprovação de exceção ou escopo REAL fornecidos pelo cliente. Exceções operacionais continuam no fluxo documental existente.

Resposta 200 direta: `assessment_scope=DEMONSTRATIVO`, `data_provenance=SIMULADA`, `label=DADOS SIMULADOS`, `readiness=MISSING_EVIDENCE`, `inputs`, `parameters`, `origin`, `mill`, `tree`, `gaps`, `formulas` e `units`. Parâmetros incluem ID, versão e fonte. Resultados por cálculo usam `PASSOU`, `ALERTA` ou `NAO_AVALIADO` somente sob o perfil; não indicam conformidade. Métricas são strings decimais arredondadas para exibição (até seis casas), ou `null` quando não avaliadas; decisões internas usam Decimal sem arredondamento prévio. O exemplo retorna intensidade21, aproveitamento70% e CRV34%. No exemplo60/10/50 ha, tora1850 e serrado1100 m³, retorna intensidade37, excesso350 e equivalente adicional1292,857143 m³.

O equivalente `max(0, serrado/CRV − entrada)` descreve quantidade adicional sob o coeficiente adotado, sem comprovar crime ou origem física. `residue_difference_m3` é apenas entrada menos serrado, podendo ser negativo em declaração incoerente; não é medição de serragem/perdas. Fonte, vigência e aplicabilidade estão delimitadas em [sources-and-limits.md](sources-and-limits.md).

Entradas negativas, não textuais, precisão excedida, perfil desconhecido, campos extras e áreas/denominadores incoerentes retornam422 com erro identificado e `request_id`. Falta de sessão retorna401; CSRF/papel inválido403. O schema da resposta é conferido explicitamente antes da serialização. `/openapi.json` publica os contratos e `docs/openapi.json` contém a exportação para revisão.

## Dependências e limites

A avaliação normativa completa e as integrações externas reais continuam pendentes, conforme [external-dependencies.md](external-dependencies.md). Correções de software não confirmam normas, autenticidade documental ou autorização oficial.
