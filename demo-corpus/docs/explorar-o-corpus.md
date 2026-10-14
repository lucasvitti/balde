---
section: "Usar o conhecimento"
section_order: 2
order: 2
---

# Como explorar o corpus

O menu **Corpus** é a sala de leitura do Balde: todas as skills e cápsulas, navegáveis lado a lado, com a governança à vista. Tudo aqui é **somente leitura** (a fonte é o histórico versionado) — editar e criar têm telas próprias. Esta página percorre a tela inteira, aba por aba.

## A anatomia da tela

![A tela Corpus: a lista de skills e cápsulas agrupada por domínio à esquerda, e o detalhe da skill aberta — com todas as abas — à direita](assets/doc-explorar-skill.png)

## A lista — encontrar o artefato

- **Duas raízes recolhíveis**: **Skills** e **Cápsulas**, cada uma agrupada **por domínio** (o que não tem domínio cai em "Sem domínio").
- **Todos os domínios ▾** — filtra a lista a um domínio só.
- **＋ / －** — expande ou recolhe todos os grupos de uma vez.
- **Seus artefatos** — marca a caixa e a lista mostra só o que **você criou ou cura**. É o seu "meus artefatos".
- **Busca da lista** — filtra ao vivo por nome, id e resumo, abrindo os grupos que têm resultado.
- **Busca global** (topo da barra lateral) — encontra skills e cápsulas de qualquer tela e abre direto no item.

No topo direito: **Mapa do corpus** troca o painel de leitura pelo mini-mapa de vizinhanças (**Ver conteúdo** volta), e **Expandir** esconde a lista para maximizar a leitura (**Mostrar lista** volta).

## Lendo uma skill — as abas

Ao abrir uma skill, o cabeçalho traz as ações — **Colaborar** (propor conhecimento para a fila), **Editar skill** (para quem gerencia) e **Excluir/arquivar** (admins) — e as abas:

| Aba | O que mostra |
|---|---|
| **Visão geral** | O cartão de visita: **Objetivo** e **Escopo**, a faixa de fatos (domínio, versão, criação, buddy, owner e curadores), a mídia processada e três gráficos de uso — **Execuções**, **Usuários** e **Aberturas**. |
| **Governança** | O **Selo de qualidade** com a composição (casos de uso, validação, governança, clareza, frescor, aceites forçados), status, última revisão, versão, model tier — e as pendências, se houver. |
| **Relatório do agente** | A análise automática da skill: validação prévia, engajamento vs objetivo, consistência vs avaliação e as propostas de melhoria da IA (com diff antes/depois). Vazia? O botão **Analisar agora** gera. |
| **Feedbacks** | O termômetro do chat: o gráfico de vereditos (Bom/Fraco/Errado) e a fila do owner com as respostas marcadas — cada uma com a pergunta e a resposta em questão. |
| **Evals** | A avaliação completa — os itens obrigatórios, os casos de uso, vereditos da IA, aceites humanos e, num Blueprint, o botão **Promover para Canônico**. (Somente leitura aqui; os casos se editam em Editar skill.) |
| **Acessos** | Quem enxerga e quem cuida: pública ou restrita, owner, curadores e leitores. |
| **Arquivos** | A árvore de arquivos do pacote, com visualizador — markdown renderizado, JSON formatado. Os **anexos** (`files/`) aparecem aqui com botão de **download**. |
| **Grafo** | O grafo **da skill**: cada arquivo de contexto como nó, os links entre eles, os links quebrados, e a legenda por tipo (índice, schema, query, contexto, cápsula…). Clique num nó para ver o que ele referencia e quem o referencia. |
| **Linha do tempo** | As séries temporais vinculadas: os episódios em ordem (o mais recente em destaque) e as lacunas — "sem episódio em 2026-06" (veja **Cápsulas**). |
| **Curadoria** | A saúde de cada arquivo de contexto — frescor, cadência, avaliação — com as ações do curador, incluindo **promover um arquivo a cápsula** compartilhada. |
| **Histórico** | Os commits do artefato: quem mudou o quê, quando. |

## Lendo uma cápsula

Cápsulas usam a mesma moldura, com um conjunto enxuto de abas: **Visão geral** (o conteúdo renderizado + as imagens e tabelas descritas por IA + os **anexos** para download), **Governança** (frescor, cadência, avaliação, criador, owner, curadoria, o registro de aprovações — e os botões **Manter em dia** e **Rodar eval (IA)**), **Arquivos** (incluindo os anexos `files/`, com download), **Avaliação** e **Histórico**.

Para quem gerencia, o cabeçalho traz **Editar cápsula** (o assistente completo) e **Editar texto** (edição rápida do conteúdo, ali mesmo, com Ctrl+Enter para salvar) — além de **Abrir em nova aba** para leitura limpa.

## Colaborar — propor conhecimento

O botão **Colaborar** abre o modal **Contribuir com contexto**: escreva ou cole o conhecimento (uma transcrição, um e-mail, uma correção), anexe arquivos se quiser, e envie. A proposta entra na **fila de curadoria** da skill — um curador revisa, com apoio de IA, antes de qualquer coisa entrar no corpus. É o jeito certo de contribuir quando você não é curador: você propõe, a curadoria decide.

## Três roteiros prontos

- **"Preciso saber se posso confiar nesta skill"** — Governança (selo + frescor) → Evals (o que foi verificado) → Feedbacks (o que os usuários acham) → Histórico (quem mantém).
- **"Quero entender do que esta skill depende"** — Grafo (as conexões) → Linha do tempo (as séries) → Arquivos (o conteúdo em si).
- **"Achei um erro"** — Colaborar → descreva a correção → a fila entrega ao curador certo. (Ou, no chat, marque a resposta como **Errado** — vira feedback na mesma fila.)

## Baldes

Tudo nesta página opera dentro do **balde ativo** (o seletor na barra superior, quando você
é membro de mais de um). Um link qualificado `/@outro-balde/...` numa skill aparece como nó
externo roxo no grafo, ligado por aresta **pontilhada** — conteúdo só flui se você for membro
do balde alvo. Veja **Baldes (repos)**.

## Para seguir

- **Mapa de conhecimento** — a mesma informação, vista de cima.
- **Chat, plenárias e skills** — quando você quer perguntar em vez de navegar.
- **Governança e acesso** — o significado de cada sinal que aparece por aqui.
