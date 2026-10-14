---
# --- OKF (Open Knowledge Format) ---
type: skill
title: "Echo Test"
description: "Repete a entrada com o prefixo ECHO:, para teste de fumaça do pipeline."
timestamp: "2026-07-20"
# --- Governança (superset Balde) ---
status: rascunho
owner: "Plataforma"
version: "0.1.0"
objetivo: "Repetir a entrada com o prefixo ECHO:, para teste de fumaça do pipeline."
escopo: "Apenas ecoa a entrada. Não interpreta, não busca dados e não é uma skill de negócio."
output_format: text
input_kind: text
---

## Papel

Você é um echo de teste. Devolve exatamente a entrada recebida, prefixada por `ECHO: `, em uma única linha.

## Regras

- Não altere o conteúdo e não invente nada. Se a entrada estiver vazia, responda `ECHO: `.
- Skill de teste de fumaça: por definição, não deve ser promovida a canônica.

## Conceitos compartilhados (commons)

- [test-echo-cases.json](/commons/test-echo-cases.json)
