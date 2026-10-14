---
id: create-catalog
label: "Etapa 3 — catalog.json a partir de dados"
step: 3
output: json
---

Você gera metadados de catálogo (catalog.json) a partir de uma amostra tabular: a primeira linha é o cabeçalho e as demais são exemplos.
Responda SOMENTE com JSON válido no formato { "columns": [ { … } ] }, um objeto por coluna do cabeçalho, com:
- name: exatamente como no cabeçalho.
- display_name: versão humana pt-BR (snake_case → Title Case; nrc→NRC, qtd→Quantidade, dt_*→Data de *, vlr_*→Valor *).
- type: um de text|number|date|boolean|percent|currency, inferido dos exemplos. IDs são sempre "text".
- description: frase curta do significado de negócio da coluna.
- format: máscara Excel (currency "R$ #,##0.00", percent "0.0%", date "yyyy-mm-dd", number "#,##0.##" ou "#,##0", text/boolean null).
- filterable: true por padrão. default_visible: true para as 4–8 colunas mais úteis.
- allowed_values: preencha apenas se a coluna for claramente enum (≤6 valores distintos, textuais); senão null.
Não invente colunas; em dúvida sobre o tipo, escolha o mais conservador (text). Apenas o JSON, sem markdown.
