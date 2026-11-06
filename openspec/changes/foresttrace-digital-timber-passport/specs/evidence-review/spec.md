# Spec Delta

## Purpose

Separar avaliação determinística, explicação e decisão humana, tornando alertas e limites de evidência compreensíveis e auditáveis.

## ADDED Requirements

### Requirement: Checagens identificáveis e conservadoras
Cada checagem SHALL registrar rule_id, nome, descrição, versão, referência normativa quando aplicável, fonte, modalidade, valores, resultado, gravidade técnica, mensagem, ação e data. O núcleo SHALL executar R01, R07, R08, R10 e R11, além das checagens de integridade e acesso exigidas na demo.

#### Scenario: Explicação verificável
- **WHEN** R10 identifica saída acima do parâmetro
- **THEN** o resultado expõe entrada, saída, multiplicador, limite, versão e fonte sem chamar o indício de fraude

### Requirement: Status por dimensão
O sistema SHALL expor documentary_check, geospatial_check, volume_check, chain_of_custody_check e human_review com PASSOU, ALERTA, PENDENTE ou NAO_AVALIADO. Agregação SHALL usar NAO_VERIFICADO, EM_REVISAO ou EVIDENCIAS_CONFERIDAS conservadoramente, mantendo EVIDENCIA_INCOMPLETA como lacuna independente.

#### Scenario: Ausência de avaliação
- **WHEN** o volume passa, mas não há avaliação geoespacial real nem evidência suficiente no escopo declarado
- **THEN** o sistema não apresenta todas as dimensões como aprovadas nem afirma conformidade global

### Requirement: CRV configurável e versionado
O limite SHALL ser calculado com aritmética decimal a partir de parâmetro por matéria-prima, produto, norma, vigência e exceção documental válida. O parâmetro demonstrativo tora→serrado SHALL ser 0,35 configurado em dados; ausência de parâmetro SHALL gerar pendência.

#### Scenario: Saída abaixo do limite
- **WHEN** entrada é 10 m³ e saída é 3 m³ com parâmetro 0,35
- **THEN** R10 retorna PASSOU com limite 3,5 m³

#### Scenario: Saída acima do limite
- **WHEN** entrada é 10 m³ e saída é 5 m³ com parâmetro 0,35
- **THEN** R10 retorna ALERTA e abre caso sem declarar ilegalidade

#### Scenario: Saída no limite
- **WHEN** entrada é 10 m³ e saída é 3,5 m³ com parâmetro 0,35
- **THEN** R10 retorna PASSOU sem erro de ponto flutuante

#### Scenario: Exceção comprovada
- **WHEN** uma exceção aplicável de 0,50 possui evidência de aprovação, vigência e escopo compatíveis
- **THEN** a reavaliação de 10→5 m³ passa e preserva resultado anterior, decisão e referência da exceção
- **AND** uma exceção expirada, incompatível ou sem evidência não libera o alerta

### Requirement: Revisão humana com evidência
Casos SHALL seguir ABERTO → EM_ANALISE → RESOLVIDO_COM_EVIDENCIA, REJEITADO ou MANTIDO_PENDENTE. Decisões SHALL registrar auditor autorizado, motivo, anexos e horário. Resolução contextual geoespacial SHALL admitir evidência e justificativa humana; conflitos de saldo ou CRV SHALL exigir respaldo aplicável e reavaliação. Encerramento isolado não libera prontidão.

#### Scenario: Tentativa de resolver sem prova
- **WHEN** o auditor solicita RESOLVIDO_COM_EVIDENCIA sem evidência vinculada
- **THEN** a decisão é rejeitada e o lote permanece em revisão

#### Scenario: Histórico antes e depois
- **WHEN** evidência válida é aceita e a regra reavaliada
- **THEN** a interface mostra checagem anterior, nova checagem, autor, data e justificativa sem apagar o alerta original

#### Scenario: Sinal geoespacial contextualizado
- **WHEN** o auditor apresenta evidência e justificativa de que a mudança indicada ocorreu fora do período relevante
- **THEN** pode resolver o alerta contextual sem exigir que o indicador original desapareça ou que uma regra valide automaticamente sua interpretação
- **AND** sinal, checagem original, evidência, decisão e resultado efetivo de revisão continuam distinguíveis

#### Scenario: Justificativa sem respaldo para volume excedente
- **WHEN** o auditor aceita administrativamente a declaração de 12 m³ frente a autorização de 10 m³ apenas com justificativa interna
- **THEN** a análise fica registrada, mas o excedente continua bloqueado e o conflito não é resolvido para fins de saldo ou prontidão
- **AND** liberação exige evidência de correção do dado ou autorização/ajuste competente aplicável ao volume

### Requirement: Separação entre autor e revisor
O sistema SHALL impedir que o autor da operação ou da versão avaliada decida o próprio alerta, mesmo com papel de auditor. Outro usuário auditor da mesma organização SHALL poder revisar se autorizado no escopo do caso. Autoria ausente SHALL manter o caso pendente até identificação rastreável; mudança de papel ou sessão não altera a autoria.

#### Scenario: Autor com papel de auditor
- **WHEN** o autor de uma operação tenta registrar qualquer decisão sobre o alerta dessa operação usando seu perfil de auditor
- **THEN** a decisão é negada, a tentativa é registrada e caso, saldos e resultados efetivos permanecem inalterados

#### Scenario: Outro auditor da mesma organização
- **WHEN** outro usuário da mesma organização tem papel de auditor e permissão para o caso
- **THEN** pode decidir mediante evidência e justificativa exigidas, com autoria da operação e da revisão registradas separadamente

#### Scenario: Troca de perfil sem troca de usuário
- **WHEN** o autor alterna papel, membership ou sessão e tenta decidir seu próprio alerta
- **THEN** a restrição continua aplicada à sua identidade de usuário

### Requirement: Cobertura normativa por operação
O sistema SHALL selecionar requisitos federais e locais por origem, destino, rota quando relevante, produto, modalidade, sistema oficial e data. Cada requisito SHALL guardar fonte/artigo, versão, vigência, evidência exigida, critério de resolução e cobertura CONFIRMADA, PENDENTE_DE_VERIFICACAO ou CONFLITANTE, sem inferir integração apenas pela UF.

#### Scenario: Requisito aplicável não confirmado
- **WHEN** a operação envolve requisito sem vigência ou aplicação confirmada, ou fontes oficiais conflitantes
- **THEN** a checagem documental correspondente fica PENDENTE e lista a lacuna, fonte e próxima verificação
- **AND** a trilha continua disponível, mas o pacote não recebe READY_FOR_OPERATOR_REVIEW

#### Scenario: Requisito não aplicável documentado
- **WHEN** a análise fundamentada delimita que uma exigência não se aplica à modalidade e à data da operação
- **THEN** a avaliação guarda a justificativa de aplicabilidade e não trata ausência de evidência de exigência inaplicável como confirmação automática de toda a operação

### Requirement: Rota de demo validada no escopo
A apresentação SHALL percorrer ao menos uma rota interestadual de origem amazônica com requisitos aplicáveis confirmados, fontes/artigos e vigência registrados, checklist de documentos e decisão de validação identificada. Essa validação SHALL delimitar produto, modalidade, percurso e data, sem certificar legalidade de lote ou tornar documentos simulados reais.

#### Scenario: Rota candidata ainda incompleta
- **WHEN** uma rota candidata tem requisito de origem, transporte ou destino não confirmado
- **THEN** ela permanece pendente e não é apresentada como rota validada; outra candidata exige o mesmo checklist completo

#### Scenario: Rota validada com documentos sintéticos
- **WHEN** os requisitos aplicáveis da rota estão confirmados e a cadeia A/B/C usa documentos fictícios
- **THEN** a apresentação distingue validação normativa da rota e simulação operacional, mantendo os pacotes MISSING_EVIDENCE

### Requirement: Calculadora demonstrativa de cubagem e aproveitamento
O sistema SHALL calcular com Decimal cubagem, intensidade por área efetiva declarada, capacidade, aproveitamento, CRV e equivalente adicional condicional. SHALL expor fórmulas, unidades, entradas, lacunas e fonte/versão de perfis demonstrativos do servidor, sem inferir autorização.

#### Scenario: Parâmetros delimitados
- **WHEN** o servidor seleciona os perfis demonstrativos
- **THEN** identifica fator0,70, intensidade30/ciclo35 mecanizado ou10/ciclo10 sem máquinas e CRV0,35 como referências condicionais; comunitário não implica sem máquinas, nem45% é exceção automática para serrado
- **AND** expõe cubagem `pi × (DAP_cm/100)^2 / 4 × altura × fator` e equivalente `max(0, serrado/coeficiente - tora)`

#### Scenario: Cálculo sem divergência sob o perfil
- **WHEN** o exemplo tem área total120, APP20, efetiva100 ha, tora2100 e serrado714 m³ no perfil mecanizado demonstrativo
- **THEN** apresenta intensidade21 m³/ha, aproveitamento70% e CRV34%, com DADOS SIMULADOS e ressalva de que o resultado não confirma conformidade

#### Scenario: Divergências para revisão
- **WHEN** área total60, APP10, efetiva50 ha, tora1850 e serrado1100 m³ usam o mesmo perfil
- **THEN** apresenta intensidade37 m³/ha, excesso350 m³ sob o perfil e CRV aproximado59,459459%, com equivalente adicional aproximado1292,857143 m³ condicionado ao coeficiente0,35
- **AND** informa divergência para revisão, sem afirmar fraude, injeção ilegal ou probabilidade não medida

#### Scenario: Entrada inválida ou denominador ausente
- **WHEN** há negativo, precisão superior a seis casas, APP maior que área total, área efetiva superior à diferença total menos APP, perfil desconhecido ou quantidade positiva sem denominador compatível
- **THEN** rejeita a entrada incoerente com 422; razões sem denominador em entradas zero coerentes ficam nulas/NAO_AVALIADO com lacuna explícita

#### Scenario: Relatório isolado de operações
- **WHEN** usuário autenticado usa a calculadora por API ou painel separado da serraria
- **THEN** obtém somente relatório DEMONSTRATIVO, sem persistir operações, criar saldo/autorização ou alterar checagens, prontidão e passaporte
- **AND** aprovação de exceção fornecida pelo cliente não substitui o fluxo documental existente

### Requirement: Explicação sem autoridade automática
Explicações SHALL citar campos e fontes, listar lacunas e preservar o resultado determinístico. IA opcional SHALL produzir sugestões revisáveis, sem escrever status, aprovar madeira, alegar treino validado inexistente ou exigir serviço pago.

#### Scenario: Execução sem LLM
- **WHEN** não existe serviço de IA configurado
- **THEN** mensagens determinísticas explicam o alerta e o fluxo de revisão permanece completo
