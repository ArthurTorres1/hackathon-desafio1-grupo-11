# Integração Whisp

Contrato pesquisado em 06/11/2026 nas fontes oficiais abaixo. Esta pesquisa confirma o protocolo publicado; uma execução autorizada e seu resultado devem ser registrados separadamente. O código consultado pertence ao branch `main` de `forestdatapartnership/whisp-app`; não foi possível fixar o SHA do commit nesta consulta. Isso não comprova que a versão publicada no serviço seja idêntica ao branch.

## Acesso e configuração do servidor

A conta e a chave são gerenciadas no [site oficial](https://whisp.openforis.org/login). A chave da API é enviada no header `X-API-KEY` tanto na submissão quanto no polling. Tokens de SSO não substituem a chave da API. A documentação interativa está em [Whisp API](https://whisp.openforis.org/api/docs).

As variáveis são exclusivas do servidor:

```dotenv
WHISP_API_KEY=
WHISP_CONTRACT_CONFIRMED=true
WHISP_SUBMIT_URL=https://whisp.openforis.org/api/submit/geojson
WHISP_POLL_URL_TEMPLATE=https://whisp.openforis.org/api/status/{job_id}
WHISP_INFO_URL=https://whisp.openforis.org/
```

Preencha `WHISP_API_KEY` somente no `.env` local ignorado pelo Git ou no gerenciador de segredos do ambiente. O exemplo acima deliberadamente não contém credencial. Não use prefixos que exponham a variável ao frontend. A flag de contrato permite ativar o adapter; ela não comprova a validade da chave nem a conclusão de qualquer avaliação.

Os caminhos acima combinam a origem pública da Whisp com o prefixo `/api` e os routers publicados pelo fornecedor. Consulte a documentação do ambiente antes de usar um serviço alternativo.

## Submissão

`POST /api/submit/geojson`, com `Content-Type: application/json` e `X-API-KEY`. O corpo contém GeoJSON na raiz; `analysisOptions` acompanha a coleção. Não há um wrapper `{ geometry, options }` no contrato oficial.

Exemplo sintético de formato, sem evidência sobre um imóvel real:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {},
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[-60.01, -3.01], [-60.0, -3.01], [-60.0, -3.0], [-60.01, -3.0], [-60.01, -3.01]]]
      }
    }
  ],
  "analysisOptions": {
    "nationalCodes": ["br"],
    "unitType": "ha",
    "async": true,
    "geometryAuditTrail": false
  }
}
```

As coordenadas devem estar em WGS84/EPSG:4326. As opções publicadas também incluem `externalIdColumn`, que deve corresponder a uma propriedade presente nas features. Limites de tamanho, quantidade de geometrias e tempo de análise são configuráveis no serviço; o endpoint público `GET /api/config` informa a configuração. A inclusão de `br` solicita os indicadores nacionais disponíveis e não atesta cobertura normativa brasileira.

## Respostas e retomada

O fornecedor publica o envelope `{ code, message, data }`. Erros podem omitir `data` e incluir `cause` ou `context`.

| HTTP / `code` | Tratamento |
|---|---|
| `202` / `analysis_queued` | `data.token` identifica o job; `data.statusUrl` indica o polling |
| `202` / `analysis_processing` | Job em processamento; preservar token e consultar novamente |
| `200` / `analysis_completed` | `data` contém o resultado GeoJSON `FeatureCollection` |
| `200` / `analysis_cancelled` | Término sem resultado de análise concluída |
| `401` / `auth_missing_api_key` ou `auth_invalid_api_key` | Corrigir configuração/autorização; não repetir automaticamente |
| `429` / `auth_rate_limit_exceeded` ou `analysis_too_many_concurrent` | Aguardar antes de nova tentativa |
| `408` / `analysis_timeout` | Análise não concluída |
| `404` / `analysis_job_not_found` | Job ou resultado indisponível |
| `500` / `analysis_error` | Falha da análise; não interpretar como ausência de alerta |

Para retomar, use `GET /api/status/{token}` com a mesma autenticação. Use a URL de polling configurada no servidor, com token codificado; não encaminhe a chave para uma URL arbitrária recebida em uma resposta. O token corresponde a uma análise, que pode conter múltiplas features.

O código oficial usa limite padrão de 30 requisições por minuto por chave, sujeito à configuração da conta. Adote espera entre consultas e respeite `Retry-After` quando presente. Um polling curto que ainda retorne `202` deve manter o job pendente e permitir retomada.

O router publicado cria um token novo por submissão; não há garantia de idempotência por `Idempotency-Key` nas fontes consultadas. Após timeout, falha de rede ou resposta incerta de um `POST`, não submeta o mesmo trabalho novamente de forma automática. Retome pelo token quando ele estiver disponível.

## Evidência e limites

O ForestTrace expõe `POST /api/v1/lots/{id}/assess` e `GET /api/v1/lots/{id}/assessments`; o contrato local completo está em [api-contract.md](api-contract.md). A submissão retorna confirmação durável 202 e executa o acesso externo em processo, sem manter transação do banco durante a chamada. O histórico GET é exclusivamente local. `resume_query_id` faz um GET autenticado de status, preservando o token para outra retomada se ainda pendente. `use_simulated_fixture: true` registra somente simulação local.

O adapter limita chamadas a 15 segundos e uma tentativa de polling a dois minutos. Aplica até duas repetições com backoff/`Retry-After` em 429 e nas falhas transitórias de GET; POST incerto não é repetido. O cache compara geometria/versão, opções canonizadas, escopo e a versão do contrato `whisp-app-contract-2026-11-06`. Esse identificador descreve o contrato local; a versão efetiva do motor e as datas das camadas devem ser conferidas nos metadados preservados do resultado, sem garantia de atualidade do cache.

Uma consulta autorizada concluiu com HTTP 200 em 06/11/2026; registro de horários e hashes em [sources-and-limits.md](sources-and-limits.md). O script `npm exec -- tsx scripts/assess-whisp.ts` usa o polígono sintético do projeto e guarda evidência em `data/private/whisp-synthetic-assessment.json`. Reexecutá-lo reutiliza a evidência concluída ou retoma job; `--refresh` é a opção explícita para uma nova submissão. Sem token após falha, o script não reenvia automaticamente.

Persistir o resultado recebido, data, geometria/opções ou seus hashes e o token é necessário porque os arquivos de resultado do fornecedor são temporários. Preserve a distinção entre resultado externo real, fixture simulada e serviço indisponível. Não registre a chave em payloads de evidência, respostas da API, logs ou testes.

Uma consulta real sobre geometria sintética continua sendo uma demonstração e não comprova a origem de madeira. Os indicadores Whisp não determinam legalidade, autorização de volume, ausência de embargo nem prontidão regulatória. A confirmação do contrato não encerra a validação de cobertura e aplicabilidade à operação.

## Fontes oficiais consultadas

- [README do Whisp App: acesso, endpoints, configuração e resultados temporários](https://github.com/forestdatapartnership/whisp-app).
- [Inicialização da API: prefixo e autenticação](https://github.com/forestdatapartnership/whisp-app/blob/main/api/src/main.py).
- [Schemas públicos: corpo e exemplos de resposta](https://github.com/forestdatapartnership/whisp-app/blob/main/api/src/schemas.py).
- [Router de submissão: criação de token e processamento do corpo](https://github.com/forestdatapartnership/whisp-app/blob/main/api/src/submit/router.py).
- [Opções internas de análise](https://github.com/forestdatapartnership/whisp-app/blob/main/api/src/submit/schemas.py).
- [Router de status: polling autenticado e retorno do resultado](https://github.com/forestdatapartnership/whisp-app/blob/main/api/src/status/router.py).
- [Códigos e status HTTP](https://github.com/forestdatapartnership/whisp-app/blob/main/api/src/codes.py).
- [Autenticação e limite padrão por chave](https://github.com/forestdatapartnership/whisp-app/blob/main/api/src/auth/api_key.py).
- [Construção do envelope de resposta](https://github.com/forestdatapartnership/whisp-app/blob/main/api/src/responses.py).
