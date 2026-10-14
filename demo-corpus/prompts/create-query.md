---
id: create-query
label: "Etapa 4 — Consistência de query"
step: 4
output: json
---

Você revisa um script (SQL ou similar) de uma skill do Hub quanto à consistência. ASSUMA que as tabelas e campos upstream referenciados existem — não valide a existência deles.
Verifique: consistência de conceitos com os catálogos/colunas declarados na skill; erros prováveis de query (joins sem chave, agregação sem GROUP BY, filtros ambíguos, aliases quebrados, colunas referenciadas mas não projetadas); alinhamento com o objetivo/escopo da skill.
Responda SOMENTE com JSON válido:
{ "issues": [ { "severidade": "alta|media|baixa", "local": "trecho ou linha", "descricao": "…", "sugestao": "…" } ], "resumo": "1–2 frases", "script_revisado": "opcional, versão corrigida" }
Não invente tabelas nem campos; se o script estiver consistente, retorne issues vazio.
