# Spec Delta

## Purpose

Consultar e apresentar sinais ambientais associados à parcela com rastreabilidade de fonte, cobertura, incerteza e disponibilidade.

## ADDED Requirements

### Requirement: Consulta geoespacial rastreável
O sistema SHALL registrar fonte, geometria/versão, payload, resposta bruta, hashes, horário UTC, HTTP, versão do provedor e cobertura de cada consulta. SHALL distinguir sinal pós-31/12/2020, degradação e ausência de informação sem concluir legalidade.

#### Scenario: Resultado real disponível
- **WHEN** uma consulta autorizada ao Whisp conclui com sucesso
- **THEN** o resultado aparece como REAL_CONSULTADA com fonte, data, evidência preservada e limitações
- **AND** sinais ambientais são enviados à revisão contextual sem acusação automática

### Requirement: Falha e simulação explícitas
Sem chave, contrato confirmado ou acesso ao provedor, o sistema SHALL marcar SEM_INTEGRACAO_REAL, registrar motivo e permitir fixture com selo DADOS SIMULADOS. Indisponibilidade ou ausência de sinal SHALL produzir NAO_AVALIADO, nunca PASSOU por ausência de resposta.

#### Scenario: Execução local sem credenciais
- **WHEN** o operador avalia uma parcela sem chave Whisp
- **THEN** a interface continua funcional com fixture SIMULADA, motivo e aviso visíveis na interface, API e pacote
- **AND** a consulta real permanece não avaliada

#### Scenario: Erro do provedor
- **WHEN** a consulta retorna 401, 429, 500 ou excede o timeout
- **THEN** a falha é persistida sem chave exposta, as tentativas são limitadas e a interface informa o estado não avaliado

### Requirement: Jobs assíncronos e cache identificável
O sistema SHALL preservar identificador e estado de jobs aceitos pelo provedor, limitar polling e reutilizar cache apenas para geometria, opções e versão equivalentes. Resultado em cache SHALL manter a data original e a indicação de reutilização.

#### Scenario: Job ainda em execução
- **WHEN** um submit retorna HTTP 202 com job pendente
- **THEN** a avaliação permanece pendente até conclusão confirmada ou prazo excedido, sem tratar aceitação como evidência final

#### Scenario: Geometria alterada
- **WHEN** uma nova versão altera o hash da parcela
- **THEN** o resultado anterior não é atribuído à nova geometria como avaliação atual

### Requirement: Catálogo de fontes e ausências
O sistema SHALL catalogar dono, URL, autenticação, cobertura espacial/temporal, atualização, licença, campos, estado de integração, data, confiança e limitações. Consulta documental sem correspondência SHALL usar NAO_LOCALIZADO_NA_BASE_CONSULTADA.

#### Scenario: Autorização ausente na amostra
- **WHEN** uma autorização não é localizada na amostra Ibama consultada
- **THEN** a resposta informa a base, recorte e data, sem concluir inexistência da autorização ou ilegalidade
