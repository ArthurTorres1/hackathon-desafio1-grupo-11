# Spec Delta

## Purpose

Compartilhar a trilha de evidências do produto por passaporte verificável e pacote exportável, com visibilidade adequada e limites explícitos.

## ADDED Requirements

### Requirement: Passaporte versionado com QR
O sistema SHALL gerar passport_id distinto do lote, versão, data, token público e QR para /p/{public_token}. O conteúdo SHALL incluir produto, espécies, região, origens e frações, eventos, checagens, documentos citados, revisões, nível de garantia e hash, respeitando permissões.

#### Scenario: Leitura pública do cenário A
- **WHEN** uma pessoa abre o QR do passaporte de 10 m³ de tora transformados em 3 m³ de serrado
- **THEN** consulta o produto e volta pela timeline até a origem generalizada, com rótulos reais/sintéticos e a ressalva de auditoria e due diligence
- **AND** não recebe afirmação de certificação oficial ou assinatura digital inexistente

### Requirement: Histórico e estado atual distinguíveis
O passaporte SHALL preservar snapshots versionados e informar mudanças posteriores relevantes. Caso novo alerta afete um passaporte emitido, a consulta SHALL expor o estado atual e a necessidade de revisão sem reescrever o snapshot anterior.

#### Scenario: Alerta posterior à emissão
- **WHEN** uma verificação detecta documento alterado após a emissão
- **THEN** a consulta pública não continua mostrando apenas a prontidão histórica e distingue a versão emitida da revisão atual

### Requirement: Pacote de evidências para revisão do operador
O sistema SHALL exportar JSON e HTML imprimível com geometrias permitidas, períodos, espécies, quantidades, países, fornecedores, compradores, checagens, documentos e decisões. SHALL incluir versão, proveniência, lacunas e orientação de guarda prevista por cinco anos sem alegar garantia de retenção já cumprida.

#### Scenario: Exportação autorizada
- **WHEN** um operador autorizado solicita o pacote
- **THEN** recebe os formatos JSON e HTML com apenas evidências acessíveis ao seu perfil e a lista de lacunas relevantes

### Requirement: Prontidão conservadora
O pacote SHALL usar READY_FOR_OPERATOR_REVIEW apenas com evidências de suporte não simuladas suficientes no escopo, origens atribuídas, requisitos aplicáveis confirmados e nenhum conflito crítico pendente. Pacote demonstrativo ou com evidência de suporte simulada SHALL permanecer MISSING_EVIDENCE. Prontidão SHALL significar preparação para revisão, nunca aprovação EUDR.

#### Scenario: Alerta aberto ou origem desconhecida
- **WHEN** há R10 sem resolução comprovada ou qualquer fração de origem desconhecida
- **THEN** o pacote fica MISSING_EVIDENCE e informa os bloqueios

#### Scenario: Escopo demonstrativo completo
- **WHEN** todas as checagens exigidas da demo passam sobre evidências sintéticas identificadas
- **THEN** o pacote permanece MISSING_EVIDENCE, com selo de simulação e motivo explícito, mesmo após resolver os alertas demonstrativos
- **AND** as checagens demonstrativas concluídas continuam visíveis sem promover prontidão

#### Scenario: Evidência simulada em pacote rotulado como real
- **WHEN** um pacote REAL depende de autorização, documento, origem ou avaliação simulada, ainda que outros dados sejam reais
- **THEN** ele permanece MISSING_EVIDENCE; mudar apenas o rótulo de escopo não remove o bloqueio

#### Scenario: Cobertura normativa incompleta
- **WHEN** um requisito aplicável à origem, ao transporte ou ao destino não está confirmado
- **THEN** o pacote permanece MISSING_EVIDENCE e identifica a pendência normativa e o escopo afetado

#### Scenario: Evidências reais suficientes no escopo
- **WHEN** o pacote REAL tem evidências de suporte não simuladas suficientes, cobertura confirmada, origens atribuídas e conflitos resolvidos com respaldo aplicável
- **THEN** pode receber READY_FOR_OPERATOR_REVIEW, sujeito à decisão do operador e às ressalvas de auditoria

### Requirement: Referência DDS legítima
O sistema SHALL aceitar DDS_REFERENCE somente como referência fornecida por operador autorizado, com origem e data. A aplicação SHALL exportar evidências sem enviar declaração oficial; qualquer exemplo de envio SHALL ser rotulado como simulado.

#### Scenario: Demo sem envio oficial
- **WHEN** o cenário demonstrativo não contém referência legítima
- **THEN** DDS_REFERENCE permanece ausente e nenhum número oficial é inventado

### Requirement: Indicadores reproduzíveis
O sistema SHALL calcular cobertura de origens por eventos e volumes, checagens com fonte/evidência, conflitos e tempo de geração a partir dos registros. Checklist documental SHALL distinguir preenchido de pendente sem afirmar redução de fraude, desmatamento ou trabalho não medida.

#### Scenario: Mistura parcialmente rastreada
- **WHEN** 60% do volume possui parcela conhecida e 40% possui origem desconhecida
- **THEN** o indicador apresenta 60% rastreado com numerador/denominador verificáveis e mantém a lacuna explícita
