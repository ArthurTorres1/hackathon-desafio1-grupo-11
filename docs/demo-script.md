# Roteiro de demonstração ForestTrace

## Estado desta execução

Este roteiro descreve as telas implementadas na SPA e os endpoints locais previstos. A integração completa depende do banco/API estar disponível e dos cadastros sintéticos retornados pelo serviço. Nenhuma rota interestadual foi declarada validada; AM→SP continua candidata pendente de verificação. Os dados usados na demonstração são sintéticos, e o passaporte permanece `MISSING_EVIDENCE` quando inclui suporte simulado.

## Percurso sugerido (3 minutos)

1. **Cadastro da origem (30 s):** entre com um perfil de demonstração. Mostre o formulário GeoJSON e carregue o polígono numérico explicitamente sintético. Explique que o mapa mostra somente o contorno declarado; ele não prova propriedade, licença ou legalidade.
2. **Origem e sinais (35 s):** selecione uma UF e mostre o aviso de cobertura pendente. Se houver uma parcela retornada pela API, anexe um documento de demonstração como privado e rotulado `SIMULADA`, e registre o lote com seus volumes declarados. No painel Whisp, selecione um lote próprio e consulte; recarregue o histórico local e retome o job se necessário. O modo **Usar apenas simulação local** não chama o provedor. Resultado externo `REAL_CONSULTADA` sobre geometria sintética continua demonstrativo e exige revisão contextual; o cache preserva a data original.
3. **Corte e transporte (30 s):** use o lote retornado pela API, registre datas e volume de corte e crie remessa com organizações remetente e destinatária distintas. Mostre qualquer erro de saldo ou permissão como resposta da API; não o apresente como operação concluída.
4. **Transformação (30 s):** selecione entradas e um parâmetro de conversão retornados pela API, informe a saída e atribua volumes explicitamente por origem. A parcela desconhecida deve continuar explícita; não normalize as frações conhecidas para esconder a lacuna.
5. **Revisão humana (30 s):** mostre o caso retornado pela API. Uma decisão requer comentário e evidência privada. O autor da operação não pode revisar sua própria versão; a API é a autoridade final dessa restrição.
6. **Passaporte e pacote (35 s):** gere o passaporte de um produto retornado pela API, abra o link público, confira a minimização de dados e tente exportar JSON ou HTML. Explique que a cadeia de hashes comprova integridade dos registros, não a veracidade das informações. O escopo demonstrativo permanece `MISSING_EVIDENCE`.
7. **Consulta e encerramento (20 s):** consulte o token pela rota pública e mostre as limitações e o estado de evidências. A rota AM→SP, regras locais e documentos sintéticos seguem pendentes de validação independente.

## Antes de apresentar

### Conferência dos arquivos de exemplo (06/11/2026)

Executado `npm test -- apps/api/tests/domain/demo-fixtures.test.ts`: seis testes passaram, conferindo schema decimal/UF, espécies comum/científica, cronologia, reconciliação e atribuições. Esta conferência lê os JSONs; não executa seed nem fluxo de navegador/banco.

| Arquivo em `data/fixtures` | Resultado observado |
|---|---|
| `demo_valid.json` | A: 10 m³ de tora → 3 m³ de serrado; 7 m³ de diferença declarada; R10 PASSOU sob parâmetro demonstrativo 0,35. |
| `demo_anomaly.json` | B/LT-204: 10 → 5 m³; R10 ALERTA sob o mesmo parâmetro; declaração preservada para revisão. |
| `demo_mixed_origin.json` | C: entradas 6 + 4 = 10 m³ → 3 m³; atribuições medidas 1,8/1,2 m³ = 60%/40%, sem inferir mistura física. |
| `demo_unknown_origin.json` | Variante: 60% atribuído e 40% explicitamente desconhecido; R11 mantém a lacuna. |

Todos os arquivos permanecem `DADOS SIMULADOS`, `DEMONSTRATIVO` e `MISSING_EVIDENCE`. Datas são sintéticas e não definem, por si, o período da rota normativa a validar. Rótulos de origem são referências de fixture, não identificadores oficiais. O seed precisa de sua própria verificação (tarefa 7.1).

- Confirmar que a API e o banco locais respondem e que os perfis de demonstração, parcelas, lotes, parâmetros e casos aparecem na interface.
- Se um endpoint falhar, apresentar a mensagem observada e seguir somente para uma etapa cujo dado exista; não substituir a falha por resultado fictício.
- Não usar dados pessoais, coordenadas reais ou documentos oficiais no ambiente sintético.
- Não chamar o pacote de DDS enviado ou aprovado e não afirmar validação normativa para AM→SP ou para as 27 UFs.
