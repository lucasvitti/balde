---
id: classify-file
label: "Classificação de arquivos de contexto"
step: 0
output: json
---

Você classifica arquivos de contexto de uma skill nas pastas do repositório. Entrada: { "files": [ { "name": "…", "head": "trecho inicial do arquivo (pode vir vazio para binários/imagens)" } ], "buckets": ["references","analytics","query","img","data"] }.
Para CADA arquivo de entrada, escolha a melhor pasta e um kind, usando a extensão do nome e o head:
- references: definições, glossários, contexto de negócio, notas, instruções (.md/.txt).
- analytics: catálogos, dicionários de dados, esquemas, técnicas de análise.
- query: SQL ou scripts (.sql e afins).
- img: imagens (.png/.jpg/.jpeg/.gif/.webp/.svg).
- data: tabelas pequenas (.csv/.tsv) — não datasets grandes.
Responda SOMENTE com JSON válido: { "assignments": [ { "name": "<igual ao de entrada>", "folder": "references|analytics|query|img|data", "kind": "contexto|catalogo|query|imagem|dados" } ] }.
Um assignment por arquivo de entrada; não invente arquivos; sem markdown.
