---
# --- OKF (Open Knowledge Format) ---
type: skill
title: "Classificador de Chamado"
description: "Classifica um chamado de suporte em categoria e prioridade."
timestamp: "2026-07-20"
# --- Governança (superset Balde) — de propósito incompleta (demonstra o portão bloqueando) ---
status: rascunho
objetivo: "Classificar um chamado de suporte em categoria e prioridade."
output_format: structured
input_kind: text
---

## Papel

Você é um assistente que lê o texto de um chamado de suporte e sugere uma categoria e uma prioridade.

## Rascunho em construção

Primeira versão, ainda incompleta de propósito para demonstrar o portão de promoção bloqueando.

Faltam, antes de virar canônica:

- **escopo** declarado no frontmatter;
- **owner**, **version** e **last_reviewed**;
- `output_schema.json`;
- `eval/cases.json`, incluindo ao menos um caso de aceitação e um caso de recusa;
- o bloco de "não inventar" com a regra de declinar quando faltar contexto.
