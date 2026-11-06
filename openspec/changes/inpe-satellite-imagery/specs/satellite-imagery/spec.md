# Spec Delta

## Purpose

Permitir a consulta e visualização de imagens disponibilizadas pelo INPE para contextualizar a parcela florestal no cadastro e no rastreamento privado, preservando referências, datas e limites de interpretação.

## ADDED Requirements

### Requirement: Busca espacial e temporal de imagens
O sistema SHALL permitir ao usuário autenticado buscar cenas INPE por Polygon ou MultiPolygon WGS84 e intervalo temporal explícito, antes ou depois do cadastro. SHALL limitar a consulta, retornar cenas que intersectem a área e informar paginação e cobertura parcial.

#### Scenario: Busca no cadastro
- **WHEN** o usuário consulta uma geometria válida ainda não salva e um período válido
- **THEN** recebe cenas com identificador, coleção, footprint, data ou intervalo, disponibilidade de visualização e nuvens quando informadas
- **AND** a busca não cria automaticamente uma parcela

#### Scenario: Entrada inválida
- **WHEN** a geometria é inválida, o período é invertido ou os limites são excedidos
- **THEN** a API retorna 422 com motivo antes de consultar o provedor

#### Scenario: Mais resultados
- **WHEN** o provedor possui mais cenas que o limite de uma página
- **THEN** a interface permite solicitar a próxima página dentro dos mesmos filtros, sem prometer inventário completo

### Requirement: Imagem georreferenciada sobre a parcela
O sistema SHALL exibir composição RGB georreferenciada da cena selecionada com o contorno da parcela e legenda. SHALL permitir alternar o mapa-base e ajustar opacidade. Miniaturas sem georreferenciamento SHALL aparecer somente como prévias separadas.

#### Scenario: Cena visualizável
- **WHEN** uma cena possui assets compatíveis e o usuário a seleciona
- **THEN** a imagem aparece na localização correta com a parcela sobreposta, atribuição e data visíveis
- **AND** a interface informa que uma cena intersectante pode cobrir apenas parte da parcela

#### Scenario: Cena sem renderização compatível
- **WHEN** uma cena só possui miniatura ou assets não suportados
- **THEN** os metadados e eventual prévia continuam disponíveis com aviso de visualização indisponível, sem esticar a miniatura sobre a parcela

### Requirement: Data e qualidade identificáveis
O sistema SHALL distinguir instante de aquisição, intervalo de composição e horário de consulta. SHALL apresentar coleção, plataforma/sensor quando disponíveis, fonte, atribuição/licença e limitações, sem presumir tempo real ou ausência de nuvens quando faltarem metadados.

#### Scenario: Composição temporal ou nuvens desconhecidas
- **WHEN** o item representa um intervalo ou não informa percentual de nuvens
- **THEN** a interface mostra o intervalo e indica nuvens não informadas, sem inventar uma data única ou percentual zero

### Requirement: Referência privada vinculada à geometria
O sistema SHALL permitir salvar uma referência à cena selecionada em parcela própria, associando coleção/item, snapshot de metadados, fonte, consulta UTC, versão e hash da geometria e proveniência. A referência SHALL permitir reabrir a seleção sem garantir disponibilidade futura do arquivo remoto.

#### Scenario: Seleção durante o cadastro
- **WHEN** uma parcela é criada e há uma cena escolhida para o mesmo hash de geometria
- **THEN** a interface permite vinculá-la à parcela recém-criada
- **AND** falha no vínculo não desfaz nem duplica o cadastro e permite nova tentativa

#### Scenario: Alteração de geometria
- **WHEN** a geometria muda após uma consulta ou vínculo
- **THEN** a seleção anterior é identificada como pertencente à versão anterior e não é apresentada como imagem selecionada para a nova geometria

### Requirement: Consulta da origem durante o rastreamento
O sistema SHALL permitir abrir imagens da parcela associada ao lote de origem selecionado na consulta privada de rastreamento. SHALL preservar separação entre origens quando houver múltiplas parcelas e não atribuir uma cena a toda a cadeia por proximidade geográfica.

#### Scenario: Lote de origem selecionado
- **WHEN** o operador seleciona um lote acessível na etapa Origem & sinais
- **THEN** o mapa usa a parcela efetivamente associada ao lote e permite consultar cenas e referências da sua versão

### Requirement: Ausência e falha não bloqueiam o fluxo
O sistema SHALL distinguir SEM_IMAGENS, INDISPONIVEL e SEM_VISUALIZACAO de sucesso. SHALL manter cadastro, mapa-base e rastreamento utilizáveis em falhas, com nova tentativa explícita e sem simulação automática.

#### Scenario: Busca sem cenas
- **WHEN** uma resposta válida não contém cenas no período e área
- **THEN** mostra SEM_IMAGENS e permite alterar os filtros, sem concluir ausência de floresta ou legalidade

#### Scenario: Timeout ou limite do provedor
- **WHEN** o provedor retorna 429/5xx, payload inválido ou excede o timeout
- **THEN** mostra INDISPONIVEL após tentativas limitadas, mantém o formulário e não converte erro em busca vazia

### Requirement: Autorização e privacidade das imagens
O sistema SHALL restringir buscas, referências e renderização ao acesso autenticado autorizado, isolando organizações. SHALL manter geometria precisa, footprints consultados e referências privadas fora dos endpoints e pacotes públicos existentes.

#### Scenario: Parcela de outra organização
- **WHEN** um usuário tenta consultar, vincular ou renderizar uma referência de parcela de outra organização
- **THEN** recebe 404 sem metadados, imagem ou geometria da parcela

#### Scenario: Consulta pública
- **WHEN** um visitante consulta o passaporte público
- **THEN** a resposta continua minimizada e não inclui referências, URLs de imagens, identificadores de consultas ou geometrias privadas

### Requirement: Consultas externas limitadas e seguras
O sistema SHALL limitar tempo, tamanho, paginação, concorrência e área de consulta. SHALL aceitar apenas coleções e destinos aprovados no servidor, inclusive assets e redirecionamentos, sem funcionar como proxy de URLs arbitrárias.

#### Scenario: URL externa indevida
- **WHEN** um cliente ou resposta de catálogo indica um asset, paginação ou redirecionamento fora dos destinos aprovados
- **THEN** a requisição é rejeitada antes de acessar o destino e o motivo técnico é registrado sem segredos

### Requirement: Proveniência e cache explícitos
O sistema SHALL identificar cache com o horário original e preservar filtros, geometria/hash, resposta de metadados e seu hash por consulta persistida. SHALL distinguir consulta real sobre geometria sintética de operação com origem comprovada.

#### Scenario: Reutilização de resultado
- **WHEN** uma consulta equivalente usa cache ainda válido
- **THEN** exibe indicação de cache e consulta original sem alterar a data da imagem

#### Scenario: Demonstração com consulta real
- **WHEN** a API INPE retorna uma cena real para uma parcela sintética
- **THEN** apresenta fonte real e contexto sintético separadamente, mantendo o estado demonstrativo do pacote

### Requirement: Imagem não determina conformidade
A integração SHALL fornecer contexto visual sem alterar automaticamente avaliações Whisp, alertas, decisões humanas, saldo de madeira ou prontidão regulatória. SHALL informar que imagem disponível não comprova autorização, origem ou ausência de desmatamento.

#### Scenario: Cena vinculada com sucesso
- **WHEN** uma imagem real é vinculada a uma parcela
- **THEN** os estados de avaliação e prontidão permanecem iguais aos anteriores e o vínculo é registrado como referência visual privada
