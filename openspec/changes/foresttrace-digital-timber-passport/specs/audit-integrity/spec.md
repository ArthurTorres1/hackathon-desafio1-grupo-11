# Spec Delta

## Purpose

Permitir a detecção de alterações em documentos, passaportes e eventos, preservando autoria e versões sem alegar inviolabilidade.

## ADDED Requirements

### Requirement: Eventos encadeados e atômicos
Cada mudança de domínio confirmada SHALL gerar evento com event_id, entidade, tipo, actor_id, timestamp UTC, payload canônico, previous_hash e event_hash. Persistência da mudança e do evento SHALL ser atômica. O histórico SHALL ser logicamente append-only e declarar os limites de um administrador único.

#### Scenario: Falha ao gravar evento
- **WHEN** o evento de uma transformação não pode ser persistido
- **THEN** a transformação e o consumo de saldo não são confirmados parcialmente

### Requirement: Hash de documento e conteúdo
O sistema SHALL guardar SHA-256 do documento bruto e do conteúdo canônico versionado do passaporte. A verificação SHALL recalcular hashes, validar ordem e vínculos de eventos e informar alterações ou evidência indisponível sem atribuir assinatura digital inexistente.

#### Scenario: Documento alterado
- **WHEN** bytes de documento armazenado divergem do hash registrado
- **THEN** a verificação acusa R18, identifica o documento e impede resultado de integridade válido

#### Scenario: Cadeia alterada
- **WHEN** payload, ordem ou vínculo anterior de um evento é modificado
- **THEN** o verificador detecta a divergência e identifica o primeiro elo inconsistente

### Requirement: Retificação versionada
Correções SHALL criar nova versão e evento de correção com referência ao registro anterior, motivo e autor. O sistema SHALL rejeitar edição ou exclusão direta do histórico pelas APIs de domínio e sinalizar R19 quando detectável.

#### Scenario: Correção de volume
- **WHEN** um operador autorizado retifica um volume declarado
- **THEN** a versão anterior continua consultável e os saldos e checagens são reavaliados por uma operação rastreável

### Requirement: Deduplicação observável
O sistema SHALL impedir duplicação silenciosa de documento fiscal por chave e de eventos por idempotência. Repetição idêntica SHALL devolver o resultado original; repetição da mesma chave com payload diferente SHALL gerar conflito sem novo consumo.

#### Scenario: Reenvio de expedição
- **WHEN** o cliente repete uma expedição com a mesma chave de idempotência e payload
- **THEN** recebe o resultado original e nenhum saldo ou evento é duplicado

#### Scenario: Documento fiscal reutilizado
- **WHEN** uma chave fiscal já registrada é submetida em operação incompatível
- **THEN** R17 informa a duplicidade e exige tratamento explícito antes de confirmar o novo registro
