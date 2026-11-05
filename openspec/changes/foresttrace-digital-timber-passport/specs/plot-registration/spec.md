# Spec Delta

## Purpose

Vincular organizações, parcelas e lotes de madeira a geometrias e documentos identificáveis, preservando declarações e limites da evidência.

## ADDED Requirements

### Requirement: Cadastro de parcela e lote
O sistema SHALL persistir organização responsável, país, UF, município, propriedade declarada, geometria com data/versão, espécie comum/científica, direito de uso, autorização, vigência e volume. SHALL gerar IDs distintos para parcela e lote de origem, sem apresentar UUID interno como GeoID da FAO.

#### Scenario: Cadastro recuperável
- **WHEN** um operador cadastra uma parcela válida e um lote com documento sintético
- **THEN** a consulta recupera os campos, IDs distintos, vínculos e documento marcado como sintético
- **AND** o registro não implica confirmação da autorização ou da propriedade

### Requirement: Cadastro nacional sem aprovação presumida
O sistema SHALL aceitar organizações, estabelecimentos e destinos nas 27 UFs, mantendo a prioridade das origens amazônicas. Ausência de confirmação normativa local SHALL permitir cadastro e preservação do histórico, expondo a pendência sem atribuir conformidade ou autorização.

#### Scenario: Destino com regra não confirmada
- **WHEN** um operador cadastra um destinatário em uma UF sem requisitos locais integralmente confirmados para a operação
- **THEN** o destinatário é persistido com UF e vínculo ao lote, e a lacuna normativa permanece visível
- **AND** cadastro bem-sucedido não altera checagens pendentes para PASSOU

### Requirement: Validação geoespacial
O sistema SHALL aceitar polígonos GeoJSON EPSG:4326, validar limites de coordenadas, fechamento de anéis e topologia, gerar hash canônico e área em hectares por cálculo geodésico ou projeção métrica adequada. SHALL mostrar contorno real no mapa e erros úteis, sem reparar silenciosamente geometria inválida.

#### Scenario: Polígono inválido
- **WHEN** coordenadas excedem limites, anel está aberto ou há autointerseção
- **THEN** o cadastro é rejeitado com erro de campo e R01, sem persistir parcela válida ou produzir aprovação

#### Scenario: Área calculada
- **WHEN** um polígono válido de área conhecida é cadastrado
- **THEN** a área em hectares corresponde à referência dentro da precisão declarada e o mapa usa seu contorno

### Requirement: Proveniência explícita dos dados
Cada dado e evidência SHALL expor fonte, informante, data, confiança e um rótulo: REAL_CONSULTADA, DADO_PUBLICO_IMPORTADO, DOCUMENTO_FORNECIDO, DECLARACAO_DO_USUARIO, SIMULADA, INDISPONIVEL ou NAO_VERIFICADA. Alterações SHALL preservar a versão anterior e a autoria.

#### Scenario: Dados reais e fictícios combinados
- **WHEN** uma geometria pública importada é associada a uma autorização fictícia
- **THEN** interface, API autorizada e exportação distinguem os dois rótulos sem promover a autorização a verificação real
