# Contratos de resposta e diagnóstico de proveniência

`packages/contracts/src/index.ts` mantém os contratos TypeBox de identificadores UUID, decimais textuais, proveniência, UFs, enums e payloads de operação. `responses.ts` acrescenta os contratos das respostas de sessão, documento, parcela, lote, corte confirmado ou pendente, remessa, transformação, passaporte e diagnóstico. Erros compartilham código, mensagem, request_id e campos opcionais.

Erros de geometria mantêm também `checks` estruturados com `rule_id`, enum de resultado e lista de mensagens. Assim, R01 retorna 422 com os campos e motivos originais; essa extensão é explícita e não permite propriedades arbitrárias nos erros ou diagnósticos.

O serviço `registerResponseContracts` é registrado antes das rotas. Ele publica os contratos de sucesso e os erros 4xx/5xx no OpenAPI e valida o JSON de resposta antes da serialização, inclusive datas e decimais de persistência. Resposta incompatível é substituída por 500 sem devolver valores privados ou detalhes da falha. Strings decimais continuam strings; entradas fora do contrato retornam 422. Contratos específicos, como os da calculadora, continuam aplicados.

`GET /openapi.json` expõe o contrato da aplicação e `/docs` oferece a consulta interativa. `npm run docs:openapi` exporta a versão do código atual para `docs/openapi.json`. Nenhuma chave de acesso é necessária para gerar esse arquivo; o comando não consulta o banco.

`GET /api/v1/origin-lots/{id}/evidence-diagnostic` retorna um diagnóstico privado de proveniência por campo e por documento. A variante `/evidence-diagnostic/export` entrega o mesmo JSON como anexo. As duas exigem sessão, membership vigente e lote pertencente à organização autenticada. IDs conhecidos de outras organizações retornam 404.

O diagnóstico preserva separadamente o rótulo da geometria, do direito de uso e das quantidades declaradas, das autorizações e das consultas de fontes. Geometria DADO_PUBLICO_IMPORTADO associada a autorização SIMULADA continua exibindo ambos os rótulos. Rótulos simples recebem apenas os metadados de autoria/data disponíveis no registro, com fonte detalhada não informada e confiança não avaliada; metadados fornecidos são preservados. Falta de proveniência é NAO_VERIFICADA.

O arquivo inclui o catálogo das fontes consultadas, com proprietário, cobertura, licença, campos, estado de integração e limitações, além de payload, resultado, hashes, horário UTC, HTTP e versão das consultas do lote. Referências a documentos são metadados autorizados; não incluem bytes, storage_key ou URL privada. Esse arquivo contém geometria exata e pertence ao fluxo privado. Não deve ser reutilizado como DTO público.

O diagnóstico permanece conservador: não conclui legalidade, propriedade, vigência de autorização ou aprovação normativa e não transforma uma consulta ausente em PASSOU. Perfis demonstrativos e evidências simuladas continuam identificados; a exportação não remove bloqueios de prontidão do passaporte.
