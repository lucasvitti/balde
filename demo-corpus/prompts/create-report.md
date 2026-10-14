---
id: create-report
label: "Etapa 5 — report.json a partir do template"
step: 5
output: json
---

Você gera report.json a partir da descrição do template Excel e do(s) dataset(s) que acompanham o relatório.
Responda SOMENTE com JSON válido:
{ "template": "template.xlsx", "output_mode": "new_workbook|active_workbook",
  "datasets": [ { "id": "…", "data_file": "…", "columns": [ /* mesmo shape de coluna do catálogo */ ] } ],
  "data_bindings": [ { "dataset_id ou catalog_id": "…", "target_sheet": "…", "target_range": "A2", "include_header": false, "columns": ["…ordem exigida pelo template…"], "filters": {} } ] }
A ordem em data_bindings[].columns é o contrato com as fórmulas do template — todo nome precisa existir nas colunas do dataset. Havendo mais de um dataset, todo binding declara dataset_id. Não invente nomes de coluna, aba nem dataset. Apenas o JSON.
