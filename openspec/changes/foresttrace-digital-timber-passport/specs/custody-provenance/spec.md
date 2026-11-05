# Spec Delta

## Purpose

Reconstruir os movimentos e as transformações da madeira preservando volumes, participantes e ancestrais até as parcelas identificadas.

## ADDED Requirements

### Requirement: Corte e custódia confirmada
O sistema SHALL registrar corte com período, lote, espécie, volume e evidências; remessas SHALL distinguir criação, expedição e recebimento, com autores e horários próprios. Corte fora da autorização, expedição anterior ao corte e divergência de recebimento SHALL produzir checagem e pendência explícitas.

#### Scenario: Recebimento consistente
- **WHEN** o remetente expede 10 m³ e o destinatário confirma 10 m³ em momento posterior
- **THEN** a timeline mostra HARVEST_RECORDED, SHIPMENT_CREATED, SHIPMENT_DISPATCHED e SHIPMENT_RECEIVED com confirmações separadas

#### Scenario: Recebimento divergente
- **WHEN** o destinatário declara 9,9 m³ de uma remessa de 10 m³ com tolerância padrão zero
- **THEN** R09 apresenta a diferença e impede representar a remessa como integralmente reconciliada
- **AND** alteração da tolerância exige configuração versionada e autoria

### Requirement: Saldo sem consumo duplicado
O sistema SHALL usar volumes decimais exatos, impedir quantidade negativa e consumo superior ao saldo autorizado ou disponível e reservar/consumir cada quantidade uma única vez. Operação rejeitada SHALL preservar saldo e histórico consistentes; lotes de saída SHALL ter evento de criação.

#### Scenario: Disputa pelo mesmo saldo
- **WHEN** duas expedições concorrentes tentam consumir 6 m³ cada de um saldo de 10 m³
- **THEN** no máximo uma é confirmada e a outra recebe conflito com R08 sem saldo negativo

#### Scenario: Corte excede autorização
- **WHEN** um corte supera o saldo autorizado remanescente
- **THEN** R07 preserva a tentativa como declaração pendente de revisão e informa o saldo disponível, sem confirmar corte ou movimentar saldo
- **AND** a revisão interna não aumenta o limite autorizado sem evidência de correção ou de autorização/ajuste competente aplicável

### Requirement: Histórico nacional com lacunas explícitas
O sistema SHALL preservar remessas e fatos declarados entre quaisquer UFs, mesmo com requisito local pendente. SHALL identificar origem, destino, percurso informado, sistema/documento, natureza declarada ou confirmada e pendências, respeitando saldo e permissões. Captura de histórico SHALL ser independente de aprovação normativa.

#### Scenario: Movimento declarado para destino com cobertura pendente
- **WHEN** um operador informa recebimento em uma UF cujo requisito aplicável ainda não foi confirmado
- **THEN** a trilha preserva remetente, destinatário, volume e confirmação do destinatário como informação declarada, com pendência normativa visível
- **AND** o registro não representa aprovação regulatória nem libera pacote pronto

### Requirement: Transformação multientrada e multissaída
O sistema SHALL aceitar múltiplas entradas, produtos de saída e resíduos com quantidades atribuídas, operador, data e regra de conversão. SHALL registrar saída declarada acima do CRV como anomalia para revisão, mantendo o bloqueio de prontidão, sem apagar a declaração ou criar estoque livremente disponível.

#### Scenario: Declaração anômala preservada
- **WHEN** LT-204 consome 10 m³ e declara 5 m³ de serrado com parâmetro 0,35
- **THEN** a declaração, entradas e saídas ficam visíveis, R10 abre caso e a saída fica em pendência
- **AND** nenhum consumo posterior é liberado silenciosamente pelo volume contestado

### Requirement: Ancestrais e frações medidas
O sistema SHALL preservar todas as origens em cada saída por quantidade atribuída e fração calculada, sem inventar participação. Origens desconhecidas SHALL permanecer explícitas, gerar R11 e EVIDENCIA_INCOMPLETA e impedir pacote pronto, independentemente da fração.

#### Scenario: Mistura conhecida
- **WHEN** uma saída recebe atribuições medidas de 1,8 m³ da origem A e 1,2 m³ da origem B
- **THEN** grafo, mapa, passaporte e exportação mostram 60%/40%, ambas as parcelas e seus ancestrais

#### Scenario: Pequena fração desconhecida
- **WHEN** qualquer quantidade positiva da mistura não possui origem atribuída
- **THEN** essa quantidade não é redistribuída entre as origens conhecidas e o pacote fica MISSING_EVIDENCE

### Requirement: Venda com pendência visível
O sistema SHALL registrar vendedor, comprador, produto, volume e referência fiscal sintética ou legitimamente fornecida. Alerta aberto SHALL impedir venda normal; registro excepcional de declaração comercial SHALL exigir ciência explícita da pendência e não liberar saldo contestado ou pacote pronto.

#### Scenario: Tentativa de vender lote em revisão
- **WHEN** um operador tenta registrar venda normal de um lote com alerta aberto
- **THEN** recebe conflito indicando o caso; uma declaração com ciência da pendência permanece marcada EM_REVISAO na API e interface
