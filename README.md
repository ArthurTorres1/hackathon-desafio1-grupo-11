# ForestTrace

Passaporte digital de evidências da madeira, da parcela ao produto. Correlaciona documentos, quantidades e sinais geoespaciais e preserva decisões humanas no histórico. Complementa DOF+/Sinaflor; não emite certificação oficial nem declaração DDS.

## Ambiente local

Requisitos: Node.js 22.12 ou superior, npm 10 ou superior e Docker Desktop com contêineres Linux. Ambiente de desenvolvimento: Node 22.13.1 e npm 11.9.0. PostgreSQL 17/PostGIS é provisionado pelo Compose na porta local 5433.

Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm.cmd ci
docker compose up -d db
npm.cmd run db:generate
npm.cmd run db:migrate
npm.cmd run seed:demo
npm.cmd run dev
```

macOS ou Linux:

```sh
cp .env.example .env
npm ci
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run seed:demo
npm run dev
```

Crie `.env` apenas na primeira instalação; preserve sua configuração depois. As senhas de exemplo são exclusivas do banco local descartável. `DATABASE_URL` usa o papel de aplicação e `DIRECT_URL` usa o proprietário para migrações. Alterar variáveis depois da criação do volume não altera usuários e senhas já existentes.

- Interface de desenvolvimento: http://localhost:5173
- API: http://localhost:3000/api/v1
- Saúde: http://localhost:3000/health
- Contrato interativo: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/openapi.json

Para servir o build da interface pela API:

```sh
npm run build
npm start
```

## Verificação

Resultados desta rodada e limites da cobertura: [docs/validation-2026-11-06.md](docs/validation-2026-11-06.md).

```sh
npm run typecheck
npm test
npm run db:prepare-test
npm run test:integration
npm run test:e2e:install
npm run test:e2e
npm run build
npm run verify:chain
```

No PowerShell, use `npm.cmd` se a política local bloquear `npm.ps1`. Testes de integração usam `TEST_DATABASE_URL`, com o banco separado `foresttrace_test`. Não aponte essa variável para banco com dados reais. Resultados devem ser reportados após a execução; a presença dos scripts não comprova sua execução.

## Organização

| Caminho | Responsabilidade |
|---|---|
| `apps/api` | Fastify, Prisma, regras de domínio e PostgreSQL |
| `apps/web` | React, Tailwind CSS e mapa Leaflet |
| `packages/contracts` | Schemas compartilhados TypeBox, IDs e enums |
| `data/fixtures` | Cenários A/B/C e variante desconhecida |
| `docs/research` | Fontes oficiais e lacunas das 27 UFs |
| `openspec/changes/foresttrace-digital-timber-passport` | Requisitos, desenho e tarefas |

## Dados e limites

As pendências que dependem de provedores, validação normativa ou decisão da equipe estão em [docs/external-dependencies.md](docs/external-dependencies.md). O comportamento das rotas está em [docs/api-contract.md](docs/api-contract.md).

Os exemplos têm dados sintéticos identificados como `SIMULADA`. Pacotes demonstrativos permanecem `MISSING_EVIDENCE` mesmo após checagens ou revisão. LT-204 declara 5 m³ de serrado de 10 m³ de tora, gerando alerta frente ao parâmetro demonstrativo de 0,35, configurado em dados.

Cadastro e rastreabilidade abrangem as 27 UFs; requisito local não confirmado gera pendência. A pesquisa nacional não comprova cobertura normativa integral. AM→SP é rota candidata e só poderá ser anunciada como validada quando seu checklist estiver concluído.

Whisp é opcional e a chave fica no servidor, fora do git. Sem contrato confirmado, chave ou acesso, a avaliação real fica não avaliada e a fixture recebe o selo **DADOS SIMULADOS**. Não há integração oficial DOF+/SEFAZ nem envio de DDS nesta demo.

O passo **Origem & sinais** permite consultar a Whisp para um lote próprio, acompanhar o histórico local e retomar jobs pendentes. Configure o servidor conforme [Integração Whisp](docs/whisp-integration.md). Para verificar o acesso com o polígono sintético do projeto, execute `npm exec -- tsx scripts/assess-whisp.ts`; a evidência fica em `data/private/`, fora do Git. Uma consulta externa real sobre dados sintéticos continua demonstrativa.

O autor de uma operação não decide seu próprio alerta. Outro auditor autorizado da mesma organização pode revisar com evidências e justificativa. Contas locais são personas sintéticas; não representam autenticação de produção.

Documentos e backups privados pertencem a `data/private` e `data/backups`, ignorados pelo git. O passaporte público deve omitir CPF, contatos, notas integrais e coordenadas sensíveis. SHA-256 e eventos encadeados detectam alteração em relação aos registros preservados, sem assinatura forte ou garantia contra reescrita por administrador.

## Contêiner da aplicação

Após preparar banco, migrações e demo:

```sh
docker compose --profile app up --build -d app
```

O perfil expõe somente uma porta local. Publicação requer identidade, segredos, permissões e verificação público/privado. Não use credenciais locais em ambiente público.

## Licença

O código é distribuído sob a [licença MIT](License.md). Dados e componentes de terceiros mantêm suas próprias licenças.
