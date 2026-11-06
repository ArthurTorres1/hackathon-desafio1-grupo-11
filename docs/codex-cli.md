# IA via Codex CLI local

Todas as chamadas de IA do ForestTrace devem usar `runCodex` em `apps/api/src/services/codex-cli.ts`, executado no backend TypeScript. O navegador chama o backend quando um recurso de IA for integrado à interface. Não adicionar chamadas diretas a APIs de LLM ou provedores alternativos.

O projeto atualmente explica regras por templates. O adaptador e o comando demonstrativo estão disponíveis; nenhuma tela chama IA automaticamente. Whisp é uma consulta geoespacial e continua com sua integração própria.

## Apresentação

Na máquina da apresentação, instale o Codex CLI e autentique a conta que executará o backend:

```sh
codex --version
codex login
npm run demo:ai
```

No PowerShell, use `npm.cmd run demo:ai`. O comando calcula R10 para 10 m³ de entrada e 5 m³ de saída, com coeficiente demonstrativo 0,35. Em seguida, chama o CLI pelo TypeScript e imprime a checagem original junto à sugestão de explicação. Não depende do banco nem altera registros. Execute antes do ensaio para confirmar autenticação, conectividade e acesso ao modelo.

O CLI roda localmente, mas a inferência depende do serviço e da conexão usados pela conta Codex. Não é execução offline do modelo. A aplicação não exige `OPENAI_API_KEY`; utiliza a autenticação já configurada no CLI. O acesso e os limites da conta precisam estar disponíveis na apresentação.

## Configuração

| Variável | Uso |
|---|---|
| `CODEX_CLI_PATH` | Opcional: caminho absoluto para o executável nativo ou `bin/codex.js`. No Windows, o adaptador procura também a instalação npm no PATH. Não usar `.cmd`/`.ps1`. |
| `CODEX_MODEL` | Opcional: modelo habilitado na conta. Vazio preserva a seleção do CLI. |
| `CODEX_TIMEOUT_MS` | Prazo de execução, padrão 120000 ms, máximo 600000 ms. |

O adaptador executa `codex exec` com sandbox de leitura, sessão efêmera e diretório temporário exclusivo. Envia instrução e contexto via stdin, sem shell. Usa `--output-schema` e `--output-last-message` e valida o JSON novamente com TypeBox antes de devolvê-lo. Os arquivos temporários são removidos ao terminar. Não registra prompt, stderr ou credenciais em erros retornados.

Respostas são sugestões para revisão humana. Resultados determinísticos, saldos e decisões não são escritos pela IA. O chamador deve fornecer somente o contexto autorizado necessário. Falhas de instalação, autenticação, conexão, timeout ou resposta inválida são explícitas; não existe fallback para outro LLM. As mensagens determinísticas existentes continuam disponíveis.

O adaptador usa a configuração e autenticação da instalação local do Codex; utilize uma configuração adequada para a demo. O contêiner atual não inclui o CLI nem a sessão autenticada: execute esse fluxo no host da apresentação.

Referência: [documentação oficial OpenAI sobre execução não interativa](https://developers.openai.com/codex/noninteractive).
