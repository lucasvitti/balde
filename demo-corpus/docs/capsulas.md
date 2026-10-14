---
section: "Entender o corpus"
section_order: 1
order: 1
---

# Cápsulas

Uma **cápsula** é a menor unidade de conhecimento do Balde: **um conceito, autocontido, que qualquer skill pode reutilizar**. Um glossário de vendas, o dicionário de um schema, as regras de um processo, o status semanal de um projeto — cada um é uma cápsula.

A ideia central é evitar a cópia. Sem cápsulas, dez skills que precisam do mesmo dicionário carregam dez cópias dele — e quando o dicionário muda, nove ficam desatualizadas em silêncio. Com cápsulas, as dez skills **apontam para o mesmo conceito**: atualizou a cápsula, todas enxergam a versão nova.

## O que uma cápsula é — e o que não é

**É:**

- **Um conceito, um endereço.** Toda cápsula vive em `dominio/conceito` (ex.: `vendas/glossario`) e é referenciada pelo link `/commons/dominio/conceito`. O endereço é a identidade: é assim que skills, o mapa e a API a encontram.
- **Atômica.** Uma cápsula é autocontida: o texto dela **não referencia outras cápsulas nem skills**. Quem relaciona conceitos é a skill que os organiza — a cápsula só se explica.
- **Governada.** Cada cápsula tem criador, dono, curadores, uma cadência de revisão e pode ter avaliação própria. Ela avisa quando está vencida.
- **Pública por padrão — restrita quando preciso.** Como as skills, cápsulas têm **visibilidade**: `pública` (qualquer usuário autenticado lê e referencia) ou `restrita` (visível **só** para curadores e leitores listados). Uma cápsula restrita some de todas as superfícies — lista, explorador, grafo, chat, API e MCP — para quem não está na lista.

**Não é:**

- **Não é uma skill.** A cápsula não instrui a IA a executar nada; ela é matéria-prima. A skill é quem tem objetivo, escopo e um prompt — e usa cápsulas como contexto.
- **Não é um documento desta seção.** Documentação explica a plataforma; cápsula alimenta as respostas da IA.
- **Não é um depósito de dados brutos.** Tabelas pequenas e imagens cabem (viram contexto, veja Mídia abaixo); um dataset inteiro, não.

## A anatomia de uma cápsula

Por baixo, cada cápsula é uma pasta com peças bem definidas:

| Peça | O que é |
|---|---|
| `context.md` | O conteúdo — o texto (markdown) que vira contexto quando uma skill a referencia. |
| `img/` | Imagens (gráficos, prints). Cada uma ganha uma **descrição gerada por IA** — e é a descrição que vira contexto. |
| `data/` | Tabelas pequenas (CSV/TSV). Também são descritas por IA e anexadas ao contexto como resumo + tabela. |
| `files/` | **Arquivos anexos** — PDFs, zips, planilhas, o que for (até 20 MB cada). São para **baixar**, não para a IA ler: nunca entram no contexto. |
| Governança | O registro do nó: criador, owner, curadores, cadência, última revisão e o histórico de aprovações. |
| Avaliação | Os critérios de qualidade e casos de uso do conceito (opcional — veja **Avaliação e promoção**). |

Tudo é versionado: cada alteração vira um registro no histórico, assinado por quem fez.

## Os campos que importam

Ao criar ou editar uma cápsula, estes são os campos e o que cada um significa (o passo a passo completo está em **Criação manual — Cápsulas**):

| Campo | O que é |
|---|---|
| **Domínio** | A área do conhecimento (`vendas`, `pricing`, `analytics`…). Vem de um vocabulário governado — admins mantêm a lista em Administração › Domínios. |
| **Conceito** | O nome-endereço dentro do domínio (ex.: `glossario`). Junto com o domínio, forma o id e o link — e **não muda depois de criado**. |
| **Título** | O nome legível, exibido nas listas. |
| **Resumo** | Uma frase sobre o que o conceito descreve — aparece nas listagens e ajuda a busca. |
| **Owner** | Quem responde pelo conteúdo. |
| **Curadores** | Quem gerencia o conceito junto com o owner. |
| **Visibilidade** | `Pública` (padrão) ou `Restrita`. Restrita esconde a cápsula de quem não estiver listado como curador ou **leitor** — em todas as superfícies. Quem cria permanece listado automaticamente. |
| **Leitores** | Só para cápsulas restritas: quem lê sem gerenciar (curadores já leem). |
| **Cadência** | De quanto em quanto tempo o conteúdo deve ser revisado: semanal, mensal, trimestral ou anual. Quem cria define; depois, só admins mudam. |
| **Série + Período** | Opcional — transformam a cápsula num **episódio** de uma série temporal (veja Linha do tempo abaixo). |

## Governança, em primeira olhada

Toda cápsula carrega um **estado de frescor**, derivado da cadência e da data da última revisão:

| Estado | Significado |
|---|---|
| **em dia** | Revisada dentro da janela da cadência. |
| **revisar em breve** | A janela está acabando. |
| **auditoria vencida** | Passou do prazo — precisa de atenção. |
| **nunca revisado** | Ainda não foi afirmada por ninguém. |

Manter uma cápsula saudável custa um clique: o botão **Em dia** registra "revisei agora". A página **Cápsulas** (menu Governança) mostra todas numa tabela — frescor, cadência, avaliação, quem usa — com ações em lote para o curador. Os detalhes de papéis e permissões estão em **Governança e acesso**; os de avaliação, em **Avaliação e promoção**.

![A página Cápsulas, com o frescor e a cadência de cada conceito compartilhado](assets/doc-capsulas-tabela.png)

## Linha do tempo — cápsulas como episódios

Conhecimento recorrente (fechamentos mensais, status semanal de projeto, comunicados) tem um truque próprio: a **série temporal**.

- Preencha **Série** (ex.: `projeto-a-status`) e **Período** em formato ISO — e o formato define a granularidade: `2026` (anual), `2026-07` (mensal), `2026-W31` (semanal), `2026-07-15` (diária).
- Cada cápsula com série + período vira um **episódio**. Uma skill que referencia **qualquer** episódio passa a enxergar a **série inteira**, do mais novo ao mais antigo.
- A skill ganha a aba **Linha do tempo**, que mostra os episódios em ordem e marca as **lacunas** (ex.: "sem episódio em 2026-06").
- No chat, a IA recebe o episódio **mais recente** por inteiro; os anteriores ficam disponíveis para consulta sob demanda.

É o padrão recomendado para todo conhecimento que se repete no tempo: um episódio novo por período, a série conta a história.

## Mídia que vira contexto

Imagens e tabelas anexadas a uma cápsula não ficam decorativas — a IA as **transforma em texto**:

- Cada imagem de `img/` ganha uma descrição objetiva (o que o gráfico mostra, tendências, números visíveis).
- Cada tabela de `data/` ganha um resumo (colunas, período, granularidade) e uma versão em markdown.

Essas descrições são anexadas ao conteúdo da cápsula em toda leitura — no chat, na API, na tela. O curador dispara a geração com **Processar mídia (IA)** (usa a chave de IA da própria conta). Limites: imagens até 5 MB; tabelas até 256 KB.

## Arquivos anexos — o que se baixa, não o que se lê

Além da mídia, uma cápsula pode carregar **arquivos anexos** (`files/`): o template em Excel, o PDF da política, o zip com o material de apoio — **qualquer formato, até 20 MB por arquivo**, versionado junto com o conceito.

A diferença para a mídia é o papel: mídia **vira contexto** (a IA lê as descrições); anexo é **entregável** — a pessoa (ou uma ferramenta) **baixa** o arquivo original. Anexos nunca entram no contexto da IA nem no grafo.

- **Onde aparecem** — na aba **Arquivos** da cápsula (com botão de download) e, para máquinas, em `media.files[]` na resposta da API, cada um com o link de download.
- **Como baixar** — um clique na interface; ou `GET /api/v1/commons/{id}/files/{nome}` com a chave pessoal. A visibilidade da cápsula vale também para os anexos.
- **Como anexar** — hoje, pela **API**: `POST /api/v1/commons/{id}/files` com a chave pessoal (exige ser curador/admin da cápsula). Detalhes em **Conectar ChatGPT e Claude**.

## Como criar

Três caminhos, todos para admins e curadores:

1. **Criar → Cápsula** — o assistente de 6 etapas (Geral → context.md → Mídia & dados → Governança → Avaliação → Revisão). O passo a passo campo a campo está em **Criação manual — Cápsulas**.
2. **Criar → Importar cápsula** — já tem o conteúdo num `.md`? Envie o arquivo e o mesmo assistente abre com título, conceito e resumo pré-preenchidos.
3. **Promover um arquivo de skill** — na aba **Curadoria** de uma skill, o botão **Cápsula** extrai um arquivo de contexto reutilizável para o acervo compartilhado e o religa na skill automaticamente.

Há ainda a esteira automática — a **cápsula de importação**, um manifesto JSON que o seu assistente de IA gera e o Balde valida e aplica via fila de curadoria. É outro objeto (transitório, não o conceito permanente): veja **Cápsulas de importação — especificação**, na seção Ingestão de dados.

## Onde as cápsulas aparecem

- **Cápsulas** (menu Governança) — a tabela de curadoria em massa.
- **Corpus** (menu Explorar) — navegação lado a lado com as skills, agrupadas por domínio, com abas de detalhe.
- **Grafo** — cada cápsula é um nó do mapa; as setas mostram quem a referencia.
- **Chat e API** — como contexto das skills que as vinculam.

Em todas essas superfícies vale a **visibilidade**: uma cápsula restrita só aparece para curadores/leitores listados (e admins) — para os demais ela simplesmente não existe. Uma skill restrita cujo conhecimento vive em cápsulas deve, portanto, ter cápsulas **igualmente restritas** — a esteira de importação faz isso sozinha (visibilidade única do manifesto, herdada pela skill e pelas cápsulas).

## Para seguir

- **Skills** — o outro artefato do corpus, e como ele organiza as cápsulas.
- **Criação manual — Cápsulas** — o passo a passo completo da interface.
- **Governança e acesso** — papéis, curadoria e o modelo de acesso.
- **Avaliação e promoção** — como a qualidade é verificada.
