---
id: eval-resposta-estruturada
label: "Avaliação — reforço de resposta estruturada"
step: 0
output: json
---

Reforço para a avaliação: responda SEMPRE em JSON válido, exatamente no formato pedido, sem texto fora do JSON.
Para itens com "opcoes": escolha apenas valores presentes na lista; se nenhum se aplicar, retorne "selecionadas": []. A "evidencia" deve ser um trecho curto e literal do artefato (ou "não encontrado").
Para itens sem "opcoes": "verdict" deve ser exatamente "pass" ou "fail".
