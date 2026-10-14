---
section: "Ingestão de dados"
section_order: 4
order: 0.5
---

# Criação manual — Skills

O passo a passo completo do assistente de criação de skills, campo a campo. Antes, vale ter lido **Skills** (seção Entender o corpus) — aqui é o **como**; lá, o **porquê**.

**Quem pode:** qualquer usuário cria skills — quem cria vira o **owner**. (Restringir acesso e listar curadores acontece dentro do próprio assistente.)

## Por onde entrar

Menu **Criar** → cartão **Skill**. O assistente tem **6 etapas**, com a trilha à esquerda: **Geral & execução → SKILL.md → Arquivos & contexto → Governança & acesso → Avaliação → Revisão**. Clique numa etapa já visitada para voltar a ela.

## Etapa 1 — Geral & execução

![O assistente Criar skill na etapa Geral & execução: a trilha de 6 etapas e os campos de identidade da skill](assets/doc-criar-skill.png)

A identidade e o contrato da skill:

| Campo | Como preencher |
|---|---|
| **Título** (obrigatório) | O nome legível (ex.: "Resumo de Clientes"). |
| **Slug (id)** | Gerado do título; o Balde confere na hora se está **livre** ou **em uso**. Vira o endereço — e **não muda depois**. |
| **Descrição** | Uma linha de vitrine, exibida nas listagens. Não confundir com o objetivo: a descrição identifica, o objetivo instrui. |
| **Objetivo** (obrigatório) | O que o agente deve **entregar** ao rodar a skill — a meta operacional. É a instrução central. |
| **Escopo** | As fronteiras: o que faz, o que **não** faz e quando **recusar**. Evita que a skill extrapole. |
| **Domínio** (obrigatório) | A área, do vocabulário governado, filtrado pelos **domínios liberados para você** (lista branca de criação; admins veem todos — e mantêm tudo em Administração › Domínios, incl. a liberação por usuário). |
| **Subpasta** (opcional) | Organização extra dentro do domínio (ex.: `churn` ou `churn/mensal`). A tela mostra o caminho final: `skills/dominio/slug/`. |
| **Buddy (avatar, opcional)** | O personagem que dá cara à skill no chat. Sem opções? Crie um no menu AI Buddy. |

**Execução (opcional)** — um bloco recolhível para quem vai consumir a skill programaticamente (ex.: o RevenueHub no Excel): formato de saída (scalar · list · table · report), tipo de entrada (text · range · none), model tier (econômico · balanceado · avançado), temperature, max tokens e a marca **formula_safe** (permite o uso via `=Hub_Skill` na planilha). Se a skill é só para chat, pode ignorar — os padrões servem.

> Escolher **table** como saída habilita o contrato estruturado (`output_schema.json`), editável na etapa 2.

## Etapa 2 — SKILL.md

O coração: a **instrução da IA**. O corpo já vem pré-preenchido com um template no padrão da casa (`## Papel`, `## Como responder`, `## Regras inegociáveis`) — edite, cole o seu, ou envie um `.md` pronto (o cabeçalho de um arquivo enviado é descartado; os metadados vêm da etapa 1).

O truque desta etapa é o **vínculo**: digite **`[[`** para uma **cápsula** ou **`[[[`** para uma **skill** — o autocompletar lista as opções e o link entra pronto. Os botões **+ cápsula** e **+ skill** fazem o mesmo. É assim que a skill ganha contexto compartilhado sem copiar conteúdo (veja **Cápsulas**).

Boas instruções declaram: o papel, o formato da resposta, as regras invioláveis (não inventar números, citar fontes) e o comportamento de recusa.

## Etapa 3 — Arquivos & contexto

O material que fundamenta as respostas. Envie **arquivos soltos** ou uma **pasta inteira** (a estrutura interna é preservada) — e cada arquivo é alocado numa pasta com papel definido:

| Pasta | Para quê |
|---|---|
| `references/` | Definições, glossários, textos de negócio. |
| `analytics/` | Catálogos e dicionários de dados. |
| `query/` | SQL e scripts. |
| `img/` | Imagens — serão descritas por IA e as descrições viram contexto. |
| `data/` | Tabelas pequenas — idem. |

- **Sugerir pastas (IA)** classifica os arquivos enviados nas pastas certas — você ajusta no seletor de cada linha.
- O botão **cápsula** em cada arquivo marca-o para **virar cápsula compartilhada** na criação (e ser vinculado no SKILL.md automaticamente) — use nos materiais que outras skills também vão querer.
- A régua de orçamento mostra o limite: **20 MB por skill, 3 MB por arquivo**. Não é lugar de dataset — dados brutos ficam fora do corpus.

## Etapa 4 — Governança & acesso

Quem responde, quem enxerga:

- **Owner** — você (só admins reatribuem o dono).
- **Visibilidade** — **Pública** (todos os usuários do Balde) ou **Restrita** (só owner, curadores e leitores listados).
- **Curadores** — quem **edita a skill e decide a fila** dela. Adicione pessoas (por e-mail, com busca) ou **grupos** inteiros (criados em Administração › Grupos).
- **Leitores** — quem enxerga quando a skill é restrita.
- **Cadência de revisão** — semanal · mensal · trimestral · anual (ou herdar o padrão). **Você define; depois só admins mudam.**

O conjunto vira a política de acesso da skill (o `ACCESS.yml`) — os papéis e as regras estão em **Governança e acesso**.

## Etapa 5 — Avaliação

Idêntica à das cápsulas, com uma diferença que importa: nas skills, os itens **obrigatórios em modo trava são o portão da promoção** — a skill só vira Canônica quando eles passam.

- **Obrigatórios** — o checklist da casa (leitura; definidos pelos admins).
- **Casos de uso** — os testes específicos: título, prompt de verificação, rubrica opcional (opções a exigir/proibir) e caso de teste (pergunta + resposta esperada; marque **é um caso de recusa** para o comportamento fora do escopo).
- **✨ Sugerir com IA** — rascunha casos a partir do que você preencheu.

O modelo completo — vereditos da IA, aceite humano, aceite forçado — está em **Avaliação e promoção**.

## Etapa 6 — Revisão

Confira o resumo (título, domínio, caminho, objetivo, escopo, buddy, execução, arquivos, acesso, cadência, itens de avaliação) e clique **Criar Blueprint**.

A skill nasce **Blueprint**: existe, aparece no corpus, dá para testar no chat — mas fica **fora da API e do consumo oficial** até ser promovida.

> **Anexos (download)**: além do contexto, uma skill pode carregar **arquivos anexos** (`files/`, até 20 MB cada — PDFs, planilhas, zips) que as pessoas **baixam** na aba Arquivos; a IA não os lê. Por enquanto, anexar é pela API (`POST /api/v1/skills/{id}/files`, curador/admin) — veja **Conectar ChatGPT e Claude**.

## Depois de criar — o caminho até Canônica

1. Abra a skill no **Corpus** e teste-a no **Chat** (anexe-a como contexto).
2. Na aba **Evals**, clique **Rodar avaliação** — a IA julga o checklist e os seus casos; aceite ou rejeite cada item.
3. Tudo verde no portão? **Promover para Canônico**. A skill entra na API, no chat e nos consumidores externos, com versão incrementada e a anterior arquivada (rollback disponível).

## Editando depois

**Editar skill** (no Corpus) reabre o mesmo assistente. Três coisas são fixas — **slug, domínio e subpasta** (o endereço é a identidade) — todo o resto evolui, e cada salvamento é versionado no histórico. Na edição, a etapa Arquivos ganha o **Processar mídia (IA)** para gerar as descrições de `img/` e `data/` já salvos.

## Conhecimento chegando de fora

Quem **não** é curador da skill contribui pelo botão **Colaborar** (a proposta cai na fila de curadoria) — e assistentes de IA contribuem pela esteira de **cápsulas de importação** (veja a especificação nesta seção). O assistente de criação é para dar forma; a fila é como o conhecimento do time chega até ele.
