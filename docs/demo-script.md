# Roteiro de demonstração ForestTrace

## Estado desta execução

Este roteiro descreve as telas implementadas na SPA e os endpoints locais previstos. A integração completa depende do banco/API estar disponível e dos cadastros sintéticos retornados pelo serviço. Nenhuma rota interestadual foi declarada validada; AM→SP continua candidata pendente de verificação. Os dados usados na demonstração são sintéticos, e o passaporte permanece `MISSING_EVIDENCE` quando inclui suporte simulado.

## Percurso sugerido (3 minutos)

1. **Cadastro da origem (30 s):** entre com um perfil de demonstração. Mostre o formulário GeoJSON e carregue o polígono numérico explicitamente sintético. Explique que o mapa mostra somente o contorno declarado; ele não prova propriedade, licença ou legalidade.
2. **Origem e sinais (35 s):** selecione uma UF e mostre o aviso de cobertura pendente. Se houver uma parcela retornada pela API, anexe um documento de demonstração como privado e rotulado `SIMULADA`, e registre o lote com seus volumes declarados. O simulador Whisp não envia consulta externa nem apresenta resultado como verificado.
3. **Corte e transporte (30 s):** use o lote retornado pela API, registre datas e volume de corte e crie remessa com organizações remetente e destinatária distintas. Mostre qualquer erro de saldo ou permissão como resposta da API; não o apresente como operação concluída.
4. **Transformação (30 s):** selecione entradas e um parâmetro de conversão retornados pela API, informe a saída e atribua volumes explicitamente por origem. A parcela desconhecida deve continuar explícita; não normalize as frações conhecidas para esconder a lacuna.
5. **Revisão humana (30 s):** mostre o caso retornado pela API. Uma decisão requer comentário e evidência privada. O autor da operação não pode revisar sua própria versão; a API é a autoridade final dessa restrição.
6. **Passaporte e pacote (35 s):** gere o passaporte de um produto retornado pela API, abra o link público, confira a minimização de dados e tente exportar JSON ou HTML. Explique que a cadeia de hashes comprova integridade dos registros, não a veracidade das informações. O escopo demonstrativo permanece `MISSING_EVIDENCE`.
7. **Consulta e encerramento (20 s):** consulte o token pela rota pública e mostre as limitações e o estado de evidências. A rota AM→SP, regras locais e documentos sintéticos seguem pendentes de validação independente.

## Antes de apresentar

- Confirmar que a API e o banco locais respondem e que os perfis de demonstração, parcelas, lotes, parâmetros e casos aparecem na interface.
- Se um endpoint falhar, apresentar a mensagem observada e seguir somente para uma etapa cujo dado exista; não substituir a falha por resultado fictício.
- Não usar dados pessoais, coordenadas reais ou documentos oficiais no ambiente sintético.
- Não chamar o pacote de DDS enviado ou aprovado e não afirmar validação normativa para AM→SP ou para as 27 UFs.
