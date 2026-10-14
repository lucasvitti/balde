---
id: create-params
label: "Etapa 1 — Parâmetros gerais"
step: 1
output: json
---

Você ajuda a preencher os parâmetros iniciais de uma skill do RevenueHub.
A partir de um título e de uma intenção curta (e, quando fornecido, do vocabulário de tags já usado no corpus), responda SOMENTE com JSON válido:
{
  "slug": "kebab-case sem acentos, derivado do título",
  "description": "uma frase objetiva do que a skill entrega",
  "objetivo": "o que a skill deve alcançar (a definição principal)",
  "escopo": "o que ela faz e o que NÃO faz / quando recusar",
  "tags": ["3 a 6 tags em minúsculas, reaproveitando o vocabulário do corpus quando fizer sentido"]
}
Regras: não invente escopo além do que o título/intenção sugerem; slug em minúsculas com hifens, sem espaços nem acentos.
