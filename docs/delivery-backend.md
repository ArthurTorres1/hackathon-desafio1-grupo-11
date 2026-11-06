# Entrega persistida: misturas, revisão, venda e pacote

As rotas usam a sessão, memberships efetivas, CSRF e `Idempotency-Key` já definidos pelo contrato. Dados demonstrativos continuam MISSING_EVIDENCE. Nenhum endpoint transmite DDS ou valida juridicamente um documento fiscal.

## Mistura e rastreabilidade privada

`GET /api/v1/product-lots/{id}/trace` exige organização proprietária ou custodiante e perfil OPERATOR/AUDITOR/REGULATOR. Retorna produto, atribuições documentais medidas, parcelas exatas autorizadas, origens, transformações, remessas e métricas. Os campos `known_volume_m3`, `unknown_volume_m3`, `total_volume_m3` e `tracked_fraction` são strings decimais; `generated_at` e `duration_ms` tornam a geração observável. O numerador conhecido e o denominador total ficam explícitos. Atribuição documental não comprova mistura física.

Transformações multientrada/multissaída validam o total de saídas/resíduos/perdas, a soma exata das atribuições por saída e a capacidade total atribuída a cada origem em todas as saídas, sem repetir o consumo da entrada. O produto deve corresponder ao parâmetro CRV, inclusive nas entradas intermediárias. Toda fração desconhecida positiva permanece desconhecida e gera R11/quarentena, sem redistribuição entre origens conhecidas. Passaportes também verificam proveniência desconhecida/incompleta em produtos ancestrais; snapshots novos vinculam hashes das atribuições persistidas para detectar alteração posterior.

## Caso e revisão contextual

`GET /api/v1/audit-cases/{id}` é restrito à organização do caso. Retorna `original_check`, `effective_check`, decisões e metadados de evidências próprias ou explicitamente liberadas. A checagem ALERTA original nunca sofre UPDATE. Uma resolução contextual válida de checagem geoespacial é apresentada com `original_status: ALERTA`, `status: PASSOU` na visão efetiva e `contextual_resolution` identificada.

A decisão registra, no evento transacional, hash da operação, geometria, consulta-fonte e hashes das evidências. Mudança de contexto, geometria, versão, fonte, metadados, bytes ou revogação de acesso invalida o efeito da resolução, preservando a decisão histórica. Bytes ausentes/divergentes rejeitam a resolução; mero texto não substitui evidência. O autor e o revisor são identidades distintas. O acesso a evidências respeita grants explícitos, inclusive entre organizações.

R07/R08/R09/R10/R11/R19 continuam exigindo reconciliação ou reavaliação apropriada; justificativa contextual não cria saldo. Exceção CRV só libera quarentena com aprovação documental válida para parâmetro/produto/espécie/vigência. MANTIDO_PENDENTE e REJEITADO são decisões preservadas que não apagam o alerta. A revisão humana produz uma checagem própria; agregação conservadora considera todas as checagens correntes, de forma que um PASSOU não oculta PENDENTE de outro ancestral.

## Venda

`POST /api/v1/sales` recebe o contrato existente:

```json
{
  "seller_organization_id": "UUID da organização autenticada",
  "buyer_organization_id": "UUID de outra organização cadastrada",
  "product_lot_id": "UUID do produto próprio",
  "volume_m3": "1",
  "fiscal_document_id": "UUID do documento fiscal acessível",
  "occurred_at": "2026-11-06T15:00:00.000Z",
  "acknowledge_pending": false
}
```

Venda normal bloqueia alertas efetivos, casos pendentes, origem desconhecida e atribuições incompletas em qualquer ancestral; exige saldo disponível e data posterior à transformação. Documento fiscal deve ter bytes íntegros e tipo NFE/NF_E/INVOICE/SALE_INVOICE. Sucesso CONFIRMED consome saldo uma única vez e grava movimento/evento atomicamente. Reenvio com mesma chave reproduz o resultado sem novo consumo; mudança do corpo retorna R17.

`acknowledge_pending: true` registra declaração comercial EM_REVISAO com ciência explícita. Não consome, reserva nem libera volume em quarentena. O volume declarado não pode superar o produto. Documento sintético é devolvido como `simulated: true` e mantém sua proveniência. `GET /api/v1/sales` retorna somente vendas em que a organização é vendedora ou compradora; conhecer IDs não concede acesso a anexos.

## Pacote JSON/HTML

`GET /api/v1/passports/{id}/bundle?format=JSON` ou `HTML` preserva o snapshot e diferencia estado atual. O pacote contém evidências permitidas, períodos, espécies, quantidades, organizações, documentos, decisões próprias, checklist do snapshot, lacunas, versão, hashes, tempo de geração e orientação de guarda por cinco anos sem alegar retenção cumprida. `dds_reference_status: NAO_FORNECIDA` não inventa referência oficial.

Grant de passaporte não concede acesso automático a documentos nem geometria exata. O pacote filtra referências não autorizadas e registra quantidades de evidências omitidas; evidência documental omitida bloqueia prontidão da visualização. Somente a organização proprietária com perfil autorizado recebe geometria exata e detalhes da cadeia; destinatários externos recebem o conteúdo minimizado e os documentos explicitamente permitidos. HTML escapa os dados e possui estilo de impressão.

Pacote DEMONSTRATIVO ou REAL dependente de qualquer evidência simulada permanece MISSING_EVIDENCE, inclusive após revisão contextual/CRV. Estado READY_FOR_OPERATOR_REVIEW significa somente preparação para revisão humana e exige todas as dimensões, cobertura e evidências suficientes; o caso suficiente é testado isoladamente em domínio, sem publicar fixtures como dados reais. Nenhuma norma nova ou rota foi confirmada por esta implementação.

## Verificação

`apps/api/tests/integration/delivery-backend.test.ts` cobre mistura 60/40 com duas saídas, soma inválida/rollback, fração desconhecida 0,000001, relabel REAL sem bypass, venda bloqueada de saída 10→5, declaração sem movimento, venda normal idempotente, revisão contextual com sinal original preservado e invalidação por geometria/bytes, JSON/HTML/checklist e DTO público seguro. `apps/api/tests/domain/delivery-readiness.test.ts` cobre conjunto isolado suficiente e bloqueios de simulação/pendência/alerta/origem/cobertura, além da agregação conservadora por dimensão.
