# Proposal

## Why

Documentos, volumes e sinais geoespaciais da madeira estão dispersos, dificultando reconstruir a proveniência e explicar inconsistências. O ForestTrace demonstrará, na janela de 48 horas do hackathon, uma trilha de evidências da parcela ao produto, complementar ao DOF+/Sinaflor, sem certificar legalidade ou substituir a decisão humana.

## What Changes

- Criar o fluxo de oito etapas: cadastro → origem e risco → corte/transporte → serraria → revisão → passaporte → pacote DDS → consulta e decisão.
- Suportar cadastro e rastreabilidade nas 27 UFs, com origem amazônica prioritária. Requisito aplicável ainda não confirmado gera pendência visível, sem impedir registrar fatos declarados nem promover o pacote a pronto. A demo percorre uma rota interestadual com requisitos integralmente validados no escopo escolhido antes da apresentação; AM→SP é candidata, ainda não validada.
- Entregar cadastro GeoJSON, avaliação geoespacial real quando disponível ou simulação explícita, custódia, saldo transacional e transformação com CRV configurável.
- Preservar origens e quantidades em misturas; origem desconhecida impede prontidão, sem tolerância inventada.
- Aplicar regras determinísticas e status por dimensão; decisões humanas exigem justificativa, evidência e reavaliação. IA explicativa é opcional e não altera status.
- Separar autor e revisor: o usuário que registrou a operação ou a versão em análise não decide seu próprio alerta, mesmo acumulando papel de auditor. Outro auditor autorizado da mesma organização pode revisar dentro de seu escopo.
- Permitir resolução contextual de alerta geoespacial por auditor com evidência e justificativa, preservando o sinal original. Corte acima do saldo fica como tentativa pendente, sem consumo confirmado; revisão interna não cria saldo oficial autorizado.
- Gerar passaporte versionado, QR, API pública reduzida, exportação JSON/HTML e verificação de integridade por SHA-256 e eventos encadeados.
- Manter todo pacote demonstrativo ou com evidência de suporte simulada em MISSING_EVIDENCE, mesmo após aprovação das checagens demonstrativas. Validar a rota normativa não torna reais os documentos sintéticos da demo.
- Demonstrar os cenários A (10→3 m³), B (LT-204: 10→5 m³ com alerta) e C (60%/40% e variante desconhecida), com testes críticos e dados sintéticos identificados.
- Usar a stack final solicitada: TypeScript, React/Tailwind CSS, PostgreSQL e OpenAPI. O backend será Node.js/TypeScript; a arquitetura Python/SQLite do contexto será adaptada mantendo as regras do produto.
- Rodar localmente sem credenciais externas; Docker Compose proverá PostgreSQL. Sem deploy obrigatório, LLM pago, envio oficial de DDS ou acesso restrito presumido.

## Capabilities

### Refinamento aprovado: cálculo de aproveitamento

Adicionar calculadora demonstrativa em TypeScript para cubagem de árvore, intensidade por área efetiva e CRV industrial, com aritmética decimal, perfis versionados escolhidos no servidor e parâmetros/fonte/limitações visíveis. O relatório identifica divergências para revisão humana e volume adicional equivalente sob o coeficiente adotado; não comprova fraude nem madeira ilegal. Não cria saldo, autorização, checagem operacional ou passaporte e não altera sua prontidão. WHISP e MIT permanecem conforme os requisitos existentes.

### New Capabilities

- `plot-registration`: organizações, parcelas, geometrias, lotes de origem, autorizações e proveniência dos dados.
- `geospatial-evidence`: consultas geoespaciais rastreáveis, fontes, cache e fallback explícito.
- `custody-provenance`: corte, remessa, recebimento, transformação, venda, saldos e mistura de origens.
- `evidence-review`: regras versionadas por jurisdição/operação/vigência, cobertura normativa explícita, status independentes, casos e decisões humanas.
- `audit-integrity`: documentos e eventos versionados, deduplicação e verificação de hashes.
- `digital-passport`: passaporte, QR, histórico, pacote de evidências e indicadores demonstráveis.
- `access-interop`: perfis, privacidade, APIs abertas, interface e execução local.

### Modified Capabilities

Nenhuma. `openspec list --specs --json` retornou inventário vazio; o projeto contém apenas README inicial, licença vazia e configuração OpenSpec sem contexto específico.

O levantamento posterior em `docs/research/controle-florestal-27-ufs-2026-11-05.csv` contém fontes e lacunas das 27 UFs, sem atestar cobertura normativa integral ou integração executada. Ele alimenta a seleção e validação da rota da demo.

## Impact

Serão adicionados `apps/api`, `apps/web`, `packages/contracts`, migrações PostgreSQL, fixtures, scripts, testes e documentação. As APIs `/api/v1`, `/p/{public_token}`, `/health` e `/docs` constituirão o contrato de integração. Bibliotecas propostas: Fastify, schemas TypeBox, Prisma, decimal.js, React/Vite, Tailwind CSS e Leaflet; versões serão fixadas na implementação.

Whisp é dependência externa condicional; não há credenciais nem integração executada. Ibama e XML NF-e autorizado são P1; DOF+ oficial, assinatura forte, ML treinado e autenticação de produção ficam fora do MVP. Regras normativas serão identificadas por fonte/versão; vigência, datas EUDR e pontos pendentes não serão promovidos a afirmações jurídicas sem confirmação. Licença e elegibilidade no evento permanecem decisões da equipe.
