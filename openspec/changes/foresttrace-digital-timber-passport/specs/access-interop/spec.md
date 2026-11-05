# Spec Delta

## Purpose

Permitir consulta e integração por APIs abertas, protegendo documentos, identidades e geometrias sensíveis conforme o perfil autorizado.

## ADDED Requirements

### Requirement: Consulta pública minimizada
O endpoint público SHALL retornar DTO reduzido com ID, tipo de produto, espécie, região generalizada, etapas e status das evidências. SHALL omitir documentos fiscais completos, CPF, contatos, coordenadas sensíveis e nomes desnecessários tanto do JSON quanto do HTML e seus dados embutidos.

#### Scenario: Tentativa de obter anexo público
- **WHEN** uma pessoa usa token público para consultar documento privado ou geometria exata
- **THEN** o acesso é negado sem vazar conteúdo ou URL de armazenamento e a tentativa é registrada

### Requirement: Permissão por relação e função
Operações de escrita SHALL exigir autenticação de demo explícita ou perfil isolado. Compradores SHALL ver somente relações e anexos liberados; auditores/reguladores SHALL acessar dados completos apenas no escopo autorizado. R20 SHALL registrar tentativas negadas sem guardar credenciais.

#### Scenario: Comprador sem liberação
- **WHEN** um comprador autenticado consulta lote de outra relação comercial
- **THEN** recebe resposta de acesso negado sem dados privados, mesmo conhecendo o ID

#### Scenario: Ator sem permissão de auditor
- **WHEN** um operador comum tenta decidir um caso
- **THEN** a decisão é negada e o caso permanece inalterado

#### Scenario: Tentativa de autoavaliação diretamente pela API
- **WHEN** o autor da operação envia decisão para seu próprio alerta diretamente à API, mesmo com papel de auditor
- **THEN** recebe 403 com código SELF_REVIEW_NOT_ALLOWED, sem persistir decisão ou alterar o caso
- **AND** R20 registra a tentativa sem credenciais, e a interface apresenta o motivo do impedimento

### Requirement: Contrato HTTP aberto
A API SHALL expor contratos JSON em /api/v1, documentação OpenAPI em /docs e saúde em /health. Erros SHALL ter código, mensagem, campos opcionais e identificador de requisição sem stack trace ou segredo. IDs e enums SHALL ser estáveis para integração sem troca obrigatória de ERP.

#### Scenario: Payload inválido
- **WHEN** uma integração envia quantidade negativa ou enum desconhecido
- **THEN** recebe erro 422 consistente com o contrato sem alteração parcial de dados

### Requirement: Fluxo de oito etapas utilizável
A interface SHALL oferecer cadastro → origem/risco → corte/transporte → serraria → alertas → passaporte → pacote DDS → consulta/decisão, com mapa e timeline. SHALL usar português do Brasil, funcionar em tela móvel e oferecer exemplo carregável sem credenciais externas.

#### Scenario: Demonstração completa
- **WHEN** uma pessoa carrega um exemplo e percorre as oito etapas
- **THEN** navega por IDs relacionados, inspeciona o alerta e a revisão e abre o passaporte por QR sem depender de serviço pago

### Requirement: Inicialização local reproduzível
O projeto SHALL documentar instalação, .env, PostgreSQL, migrações, seed, execução e testes para Windows, macOS e Linux. Fixtures SHALL ser determinísticas e rotuladas; README SHALL descrever dependências locais e limites de autenticação, fontes e integridade.

#### Scenario: Máquina sem chave Whisp
- **WHEN** a equipe executa os comandos documentados com dependências instaladas e banco local
- **THEN** abre a interface, carrega A/B/C, consulta /health e /docs e identifica claramente a simulação

### Requirement: Cobertura nacional e pendências interoperáveis
Interface, API e exportação SHALL aceitar as 27 UFs e expor cobertura normativa por operação, pendências e fontes no detalhe permitido ao perfil. Histórico de rastreabilidade SHALL permanecer acessível quando houver pendência, sem indicar aprovação. A consulta pública SHALL resumir a lacuna sem revelar documentos ou dados sensíveis.

#### Scenario: Consulta de cadeia com destino fora da rota de demo
- **WHEN** o usuário consulta uma remessa para qualquer UF fora da rota validada, com requisito ainda não confirmado
- **THEN** vê os vínculos de origem/destino e a pendência pertinente na interface, API e exportação autorizadas
- **AND** o resumo público informa a existência da lacuna e o pacote permanece MISSING_EVIDENCE
