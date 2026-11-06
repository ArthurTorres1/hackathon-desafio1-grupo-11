# Requisitos normativos versionados

A migração `202611060005_regulatory_versions` introduz o enum PostgreSQL RegulatoryCoverage, o contexto/hash/autoria de avaliações, unicidade de versão e vínculo `supersedes_id` entre requisitos. As jurisdições aceitas são BR para o nível federal e as 27 UFs. O papel da aplicação insere versões; não atualiza ou apaga requisitos/avaliações existentes. Contextos antigos sem hash ficam pendentes até nova avaliação.

O catálogo não é preenchido automaticamente a partir do CSV de pesquisa. Inclusão administrativa de um requisito exige fonte/artigo, versão, vigência, produto, modalidade, sistema, evidências exigidas e critério de resolução. A infraestrutura de versionamento não confirma o conteúdo jurídico informado. Não há rota pública ou formulário de aprovação normativa.

`GET /api/v1/regulatory/requirements?jurisdiction=AM&phase=ORIGIN` consulta o catálogo com sessão e papel efetivo OPERATOR, AUDITOR ou REGULATOR. Filtros são opcionais, BR é aceito e sigla inválida retorna 422. Compradores não consultam o catálogo.

`POST /api/v1/regulatory/assessments` exige sessão, CSRF e Idempotency-Key. Exemplo:

```json
{
  "entity_type": "ORIGIN_LOT",
  "entity_id": "UUID_DO_LOTE",
  "modality": "MODALIDADE_DECLARADA",
  "occurred_on": "2026-11-06"
}
```

Tipos: ORIGIN_LOT, SHIPMENT e TRANSFORMATION. O escopo é da organização da origem/transformação ou dos participantes da remessa. A aplicação deriva as UFs e os produtos dos registros persistidos. Origem usa sistemas das autorizações e permite data declarada; remessa usa sistema e data de expedição/criação persistidos; transformação usa sua data e sistema declarado opcional, com NAO_VERIFICADO na ausência. Modalidade é uma declaração de contexto, não aprovação. Cada avaliação grava contexto, hash, autoria, versão, requisitos selecionados, lacunas, checagem e evento na mesma transação.

O motor exige perfis federais e locais para as fases relevantes, filtra por data/produto/modalidade/sistema e preserva o histórico de versões. Sucessor substitui predecessores apenas no mesmo escopo/fonte/artigo; cadeia inválida vira pendência. Ausência de perfil, lista vazia de evidências ou cobertura não confirmada resulta em PENDENTE_DE_VERIFICACAO. Fonte conflitante e versões sobrepostas sem sucessão resultam em CONFLITANTE. Cobertura CONFIRMADA seleciona exigências, mas deixa sua conferência documental NAO_AVALIADO.

`GET /api/v1/regulatory/assessments/{entity_type}/{entity_id}` consulta o histórico autorizado e um resumo atual. Conhecer o UUID de outra organização não concede acesso, mesmo com papel de auditor. Uma mudança de versão/contexto da operação ou do catálogo invalida a cobertura atual até nova avaliação, sem reescrever a avaliação anterior.

O resumo público do passaporte contém apenas `coverage`, `gap_count` e `pending_phases`. Não inclui autores, fontes anotadas, documentos, IDs de requisitos ou percurso. A cobertura atual agrega origens, remessas e transformações ancestrais. Pendência/conflito mantém MISSING_EVIDENCE; nem cobertura confirmada remove os bloqueios de documentos insuficientes ou simulados. O bundle JSON também traz o resumo atual separado do snapshot histórico.

Testes de perfis confirmados usam exclusivamente modalidade isolada e URLs example.invalid em foresttrace_test. Não são publicados como regras reais. A rota AM→SP e sua verificação de fonte/artigo/vigência continuam pendentes; a conclusão do software não satisfaz essa verificação externa.
