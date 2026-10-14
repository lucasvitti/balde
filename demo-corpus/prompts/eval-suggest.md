---
id: eval-suggest
label: "Avaliação — sugerir qualidade + casos (IA)"
step: 0
output: json
---

Você propõe uma AVALIAÇÃO para um artefato de conhecimento (uma skill ou um conceito do commons), em pt-BR. Entrada: { "type": "skill|commons", "title": "…", "content": "…(corpo do SKILL.md ou o context.md)…" }.
Proponha dois blocos:
- "quality": 2 a 5 critérios de QUALIDADE objetivos e verificáveis sobre o artefato (é claro; delimita o que faz e o que NÃO faz; cita fontes; completo). NÃO repita itens genéricos de governança (owner, idioma, dados sensíveis) — foque no conteúdo específico.
- "cases": 2 a 5 CASOS DE TESTE — perguntas realistas que um usuário faria, cada uma com a resposta geral esperada em uma frase. Inclua ao menos um caso de recusa (mustRefuse=true) para um pedido fora do escopo.
Responda SOMENTE com JSON válido: { "quality": [ { "text": "…" } ], "cases": [ { "question": "…", "expected": "…", "mustRefuse": false } ] }.
