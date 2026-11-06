# Apresentação ForestTrace — roteiro pronto

## Mensagem central

O ForestTrace conecta evidências declaradas de uma parcela ao produto transformado. Registra quem informou cada dado, documentos associados, volumes, transferências de custódia, transformações, revisões humanas e um passaporte consultável. A demonstração usa dados sintéticos; o sistema organiza evidências e sinaliza lacunas, mas não atesta legalidade nem substitui sistemas oficiais.

## Sequência de slides

### 1. O problema — 30 segundos

**Na tela:** título “Da parcela ao produto: evidências conectadas” e uma linha simples: origem → custódia → transformação → produto.

**Fala:** “Ao longo da cadeia, informações sobre origem, documentos e volumes ficam separadas. Isso dificulta entender de onde veio um produto e o que ainda precisa ser verificado. O ForestTrace reúne esses registros numa trilha consultável.”

### 2. O que a plataforma registra — 40 segundos

**Na tela:** mostrar os oito passos da interface e destacar parcela, lote, remessa, transformação, revisão e passaporte.

**Fala:** “Cada etapa é registrada pela aplicação e persistida no banco. A parcela tem geometria e procedência declaradas. O lote associa documentos e volume. Remetente e destinatário confirmam partes diferentes do transporte. Na transformação, entradas, saídas e atribuições de origem ficam ligadas.”

### 3. Um sinal que merece revisão — 45 segundos

**Na tela:** cenário LT-204: 10 m³ de tora, 5 m³ de serrado; regra R10 e parâmetro demonstrativo 0,35.

**Fala:** “Neste exemplo, a saída declarada é 5 m³ a partir de 10 m³ de entrada. Ela diverge do parâmetro configurado para a demonstração e gera um alerta para revisão. O alerta explica a divergência entre os dados; não conclui fraude nem substitui a análise do contexto e das regras aplicáveis.”

### 4. Mistura e lacuna de origem — 40 segundos

**Na tela:** mostrar C com atribuições 1,8/1,2 m³ e UNKNOWN com 1,8 m³ conhecidos e 1,2 m³ desconhecidos.

**Fala:** “A mistura conhecida preserva as participações informadas de 60% e 40%. No outro exemplo, 60% do volume está atribuído e 40% continua explicitamente sem origem conhecida. A interface não distribui essa parte desconhecida entre as origens conhecidas.”

### 5. Revisão e passaporte — 45 segundos

**Na tela:** decisão pendente do auditor distinto; depois selecione um passaporte no passo **Pacote de evidências** e mostre a lista de documentos, a procedência e o início do hash. Abra também o trace/passaporte público e as opções de exportação.

**Fala:** “O autor da operação não decide o próprio alerta. Outro auditor registra comentário e evidência, mantendo este caso pendente. O trace percorre os vínculos de origem e transformação. O passaporte público reduz os dados exibidos; o pacote privado segue as permissões. Os hashes permitem conferir consistência dos registros preservados.”

### 6. Resultado e limites — 30 segundos

**Na tela:** três itens: “trilha consultável”, “lacunas visíveis”, “evidência simulada”.

**Fala:** “A demo mostra como organizar a trilha, preservar revisões e deixar lacunas visíveis. Os dados e documentos são simulados e todos os passaportes permanecem MISSING_EVIDENCE. A cobertura normativa, a rota AM–SP e a elegibilidade no evento não estão confirmadas. O produto não emite DDS nem certificação oficial.”

## Percurso ao vivo — 3 minutos

Use a instância empacotada indicada no [relatório do entregável](delivery-2026-11-06.md), com o seed aplicado. Selecione as personas **Produtor entregável**, **Recebedor entregável** e **Auditor entregável distinto**. Não é necessário criar novos registros durante a fala.

| Tempo | Ação | O que dizer |
|---|---|---|
| 0:00–0:20 | Abra a visão geral e a etapa de origem; mostre o contorno da parcela sintética. | “Esta geometria é uma declaração de demonstração, não prova propriedade ou autorização.” |
| 0:20–0:45 | Mostre lote, procedência SIMULADA e documento privado. | “O lote conecta volume e suporte documental, preservando a origem declarada dos dados.” |
| 0:45–1:10 | Mostre corte/remessa e os registros de expedição e recebimento. | “O remetente e o destinatário confirmam etapas distintas da custódia.” |
| 1:10–1:40 | Abra LT-204 e depois C/UNKNOWN na transformação ou trace. | “O sinal de rendimento fica para revisão; mistura e volume desconhecido permanecem explícitos.” |
| 1:40–2:10 | Troque para o auditor distinto e mostre a decisão pendente e evidência. | “A revisão é feita por outra pessoa e não apaga o sinal original.” |
| 2:10–2:40 | No passo Pacote de evidências, mostre os documentos de suporte e procedência SIMULADA; depois abra passaporte/trace e QR. | “O passaporte lista os documentos ligados à cadeia, com procedência e hash para conferir os bytes. O conteúdo segue simulado; o hash não autentica a declaração.” |
| 2:40–3:00 | Encerre na prontidão `MISSING_EVIDENCE`. | “A trilha está demonstrada; conformidade e autorização ainda exigem evidências e validação próprias.” |

## Preparação no dia

1. Inicie a instância descrita no README e abra `http://127.0.0.1:3001`.
2. Confirme que a tela carrega, que o login de demonstração funciona e que aparecem as personas acima.
3. Confirme a presença dos cenários A, LT-204, C e UNKNOWN e do passaporte de demonstração.
4. Abra antes da apresentação o link público de um passaporte e o trace privado correspondente; deixe-os em abas separadas para reduzir navegação.
5. Confira que o selo SIMULADA e `MISSING_EVIDENCE` estão visíveis. Mantenha uma captura de tela local como alternativa se a instância parar.
6. Não submeta consultas externas durante a apresentação. Uma consulta Whisp sobre a geometria sintética não transforma a demonstração em evidência de origem.

## Perguntas e respostas curtas

**Isso prova que a madeira é legal?** Não. A demo organiza declarações e evidências; não autentica documentos nem confirma autorização.

**O alerta confirma fraude?** Não. Ele identifica divergência sob um parâmetro demonstrativo e encaminha para revisão contextual.

**A rota AM–SP foi validada?** Não. Ela permanece candidata e pendente de checklist normativo.

**O passaporte é um DDS ou certificado?** Não. É um resumo digital da trilha e permanece `MISSING_EVIDENCE` nesta demonstração.

**Os dados são reais?** Não. Organizações, pessoas, documentos, lotes e geometrias da demo são sintéticos e identificados como simulados.

**O que falta para uso operacional?** Confirmar fontes e requisitos aplicáveis ao escopo real, obter documentos autênticos e evidências verificáveis, validar a rota e configurar identidade e integrações oficiais pertinentes.

## Evidências disponíveis

Os resultados técnicos e limites da execução estão em [delivery-2026-11-06.md](delivery-2026-11-06.md) e [validation-2026-11-06.md](validation-2026-11-06.md). Capturas e vídeos do ensaio automatizado estão em `test-results/ui-live` e `test-results/release`; eles registram a navegação do software, não uma apresentação com fala humana.
