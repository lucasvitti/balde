---
section: "Entender o corpus"
section_order: 1
order: 4
---

# Governança e acesso

Governança, no Balde, responde três perguntas sobre cada pedaço de conhecimento: **quem pode ver**, **quem cuida** e **está em dia?**. Esta página cobre o modelo de acesso (público/restrito, papéis, grupos), o trabalho do curador e os sinais de saúde que todo artefato carrega.

## Quem pode ver — pública ou restrita

- **Todo artefato nasce público**: qualquer usuário do Balde enxerga. Restringir é uma escolha, não o padrão.
- **Um artefato restrito** declara quem enxerga: além do owner e dos admins, só os **curadores** e **leitores** listados — pessoas, ou (nas skills) grupos inteiros.
- A restrição vale em **todas as superfícies**: listas, detalhe, busca, chat, grafo, explorador, fila, API e MCP. Para quem não tem acesso, o artefato simplesmente **não existe** (a API devolve "não encontrado", sem revelar que há algo ali).
- **Cápsulas também têm visibilidade** — públicas por padrão, restritas quando declarado. Uma skill restrita cujo conhecimento vive em cápsulas deve tê-las igualmente restritas: a esteira de importação garante isso sozinha (a visibilidade é **única por manifesto**, herdada pela skill âncora e por todas as cápsulas dele); na criação manual, o assistente tem o campo Visibilidade na etapa Governança.

A visibilidade é definida na criação (etapa **Governança**/**Governança & acesso**) e alterada depois em **Editar skill** / **Editar cápsula**. Tecnicamente, a política vira um arquivo `ACCESS.yml` ao lado do artefato (`SKILL.md` ou `context.md`) — ausência do arquivo significa público. Nas cápsulas restritas, o criador e os stewards da governança (owner/curadores do `governance.json`) nunca perdem o próprio acesso.

## Os papéis

| Papel | Quem é | O que pode |
|---|---|---|
| **Admin** | Membro do grupo `Balde - Admins`. | Tudo: gerencia qualquer artefato, os domínios, os grupos, o checklist de qualidade e as configurações da plataforma. |
| **Curador global** | Membro do grupo `Balde - Curadores`. | Cura qualquer skill **pública** e as cápsulas **públicas**. Num artefato **restrito** (skill ou cápsula), só se estiver listado nele. |
| **Curador da skill** | Listado em Curadores na política da skill (pessoa ou grupo). | Edita a skill e decide a fila dela — aprova, recusa e mescla contribuições. |
| **Owner** | O dono declarado do artefato. | Responde pelo conteúdo; gerencia quando não há curadores listados. |
| **Leitor** | Listado em Leitores de uma skill restrita. | Enxerga e usa a skill; não edita. |

Dois detalhes práticos:

- **Quem cria uma skill é o owner dela** — só admins reatribuem o owner depois.
- **Criar cápsulas** é ação de admins e curadores globais (cápsulas afetam o corpus inteiro).

## Onde cada um pode criar — domínios liberados

Além de *quem vê*, a governança controla **onde cada usuário pode CRIAR**: uma lista branca de domínios por usuário, mantida pelos admins na aba **Administração › Domínios por usuário**.

- **Admins criam em qualquer domínio** — não precisam de liberação.
- Todos os demais (curadores incluídos) só criam skills e cápsulas **nos domínios liberados para eles**. O seletor de domínio dos assistentes mostra apenas esses.
- **Sem nenhum domínio liberado, o usuário não cria conteúdo** — o seletor aparece vazio, e a API recusa (403 na criação manual; erro `dominio-nao-autorizado` ao compilar uma cápsula de importação que crie algo fora da lista).
- A lista governa a **criação**. Editar conteúdo existente segue as regras de curadoria/ACL acima; updates via manifesto também não passam por ela.

## Grupos de acesso

Para não listar dez e-mails skill por skill, o Balde tem **grupos** reutilizáveis — Comercial, Jurídico, Diretoria… Admins os mantêm em **Administração › Grupos**; na hora de restringir uma skill, você atribui o grupo inteiro como curador ou leitor. Um grupo atualizado atualiza todas as skills que o usam.

## Escolhendo curadores — o conselho prático

Curador é quem **decide** sobre o conteúdo: revisa contribuições, mantém o frescor, roda avaliações e responde pela qualidade. Ao criar uma skill:

- Prefira **quem entende do assunto**, não quem tem cargo — a fila da skill vai parar na mão dessa pessoa.
- **Dois curadores** é um bom número: cobre férias e dá segunda opinião nas decisões da fila.
- Use **grupos** quando a responsabilidade é de uma área (ex.: o grupo Jurídico cura as skills jurídicas).
- O owner continua sendo o ponto final de atribuição — curadores operam, o owner responde.

## O trabalho do curador

O dia a dia da curadoria acontece em três lugares:

**A Fila** (menu Governança) — a caixa de entrada única. Chegam ali quatro tipos de item: **Aprovações** (rascunhos de skill esperando validação), **Contribuições** (conhecimento novo proposto por alguém, do chat ou da API), **Feedback** (respostas marcadas como erradas/fracas no chat, que viram propostas de correção) e **Cápsulas de importação** (manifestos prontos para aplicar). Cada item mostra o conteúdo, a análise prévia da IA e as ações — aprovar, recusar, ajustar, mesclar. **Nada entra no corpus sem passar por aqui.**

**A página Cápsulas** (menu Governança) — a tabela de saúde dos conceitos compartilhados: frescor, cadência, avaliação e quem usa cada um, com ações em lote (**Manter tudo em dia**, **Resumir tudo (IA)**).

![A página Cápsulas: a tabela de curadoria com frescor, cadência e avaliação por conceito, e as ações em lote no topo](assets/doc-capsulas-tabela.png)

**A aba Curadoria de cada skill** — a mesma visão de saúde, arquivo por arquivo, com a ação de promover arquivos reutilizáveis a cápsula.

## Frescor e cadência — o "está em dia?"

Todo artefato governado (skill, cápsula e cada arquivo de contexto) tem uma **cadência de revisão** e um **estado de frescor**:

| Cadência | Janela |
|---|---|
| semanal | 7 dias |
| mensal | 30 dias |
| trimestral | 91 dias (o padrão) |
| anual | 365 dias |

| Estado | Significado |
|---|---|
| **em dia** | Revisado dentro da janela. |
| **revisar em breve** | Últimos 15% da janela. |
| **auditoria vencida** | Passou do prazo. |
| **nunca revisado** | Nunca foi afirmado — conta como pendência desde o primeiro dia. |

Revisar custa um clique — **Em dia** / **Manter em dia** registra "conferi agora", com autoria e data. Não exige alterar o conteúdo: é a afirmação de que alguém olhou e está válido.

Duas regras que evitam bagunça:

- **A cadência trava.** Quem cria define a cadência; depois disso, **só admins mudam**. Isso impede que o prazo seja afrouxado para "resolver" uma pendência.
- **Tudo fica registrado.** Criações, edições, revisões, mudanças de cadência e avaliações entram num **registro de aprovações** por artefato (quem, quando, o quê) — visível na aba Governança, além do histórico git de cada arquivo.

## Onde ver a saúde do corpus

- **Visão geral** (menu Governança) — o painel executivo: maturidade, pendências e prioridades.
- **Mapa de conhecimento** — pinte os nós por **Frescor** ou **Status** e enxergue as áreas vencidas de uma vez.
- **Aba Governança** de cada skill — o selo de qualidade, sua composição e as pendências do artefato.

## Para seguir

- **Avaliação e promoção** — o portão de qualidade que decide o que vira Canônico.
- **Cápsulas** e **Skills** — o que exatamente está sendo governado.
