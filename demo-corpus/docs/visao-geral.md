---
section: "Entender o corpus"
section_order: 2
order: 1
---

# Visão geral — o que é a Balde

A **Balde de conhecimento** é uma plataforma para **guardar, governar e reutilizar conhecimento** como se fossem arquivos — não linhas soltas num banco de dados nem páginas perdidas num wiki. A ideia cabe numa frase:

> **Conhecimento é um monte de arquivos versionados em git, com uma camada de governança por cima.**

Esta página é a porta de entrada, em linguagem simples. Para navegar na prática, veja **Como explorar o corpus**; para o modelo técnico completo, veja **OKF e a arquitetura da Balde**; para conversar com o conhecimento, veja **Chat, plenárias e skills**.

## Por que arquivos, e não um banco de dados

Tratar conhecimento como arquivos dá três coisas de graça:

- **Histórico** — cada alteração é um commit git, assinado por quem escreveu. Dá para ver o que mudou, quando e por quê, e voltar atrás.
- **Portabilidade** — o corpus é git-clonável, renderiza no GitHub e monta em qualquer filesystem. Sem SDK, sem runtime obrigatório: tire a Balde da frente e ainda sobra uma pasta de markdown legível.
- **Sem aprisionamento** — a governança vive em arquivos-irmãos ao lado do conteúdo. É uma camada **por cima** do formato, não uma jaula dentro dele.

## OKF, em linguagem simples

A Balde segue o **OKF — Open Knowledge Format** (Google Cloud, 2026), um padrão que representa conhecimento como **uma pasta de arquivos markdown**. As regras que importam:

- Cada arquivo é **um conceito**. O **caminho do arquivo é a identidade** do conceito.
- Conceitos se referenciam por **links markdown normais** — a pasta inteira vira um **grafo** de conhecimento.
- **Links quebrados são tolerados** (viram "pendentes", nunca travam nada).
- Quase nada é obrigatório: um pouco de frontmatter YAML no topo e o resto é texto.

A Balde é, de forma precisa, **"OKF + governança"**: o OKF dá o formato (arquivos + grafo); a Balde acrescenta o que arquivos soltos não têm — dono, cadência de revisão, avaliações, controle de acesso e uma API para máquinas.

## As duas vizinhanças: skills e commons

O corpus tem dois bairros, ambos versionados em git e lidos ao vivo:

### Skill — uma capacidade governada

Uma **skill** é um pacote de conhecimento operacional — o que responde uma pergunta ou executa uma tarefa. Ela alimenta tanto a fórmula `=Hub_Skill` do RevenueHub quanto o chat da própria Balde. Suas partes:

- **`SKILL.md`** — a espinha: um cabeçalho (frontmatter) com metadados + governança, e um corpo que é a **instrução** (o *system prompt*) da skill.
- **Arquivos de contexto** — o material que fundamenta a resposta, organizado por pasta: `references/` (definições, glossários), `query/` (SQL/scripts), `analytics/` (catálogos de dados).
- **Mídia** — `img/` (imagens) e `data/` (tabelas pequenas); a IA transforma cada uma em texto que **vira contexto**.
- **Governança** — `governance.json` (o registro de dono, curadores, cadência, evals, aprovações) e `ACCESS.yml` (quem enxerga e quem cura).

### Commons — conceitos compartilhados

O **commons** é o bairro compartilhado (`/commons/…`) onde vivem os conceitos que **muitas skills usam** — dicionários de schema, glossários, definições de tabela-base. Em vez de cada skill copiar o mesmo dicionário, todas **apontam para o mesmo conceito**. Cada conceito do commons é uma **pasta** com identidade `<domínio>/<conceito>`:

- **`context.md`** — o conteúdo do conceito.
- **governança própria** — o mesmo registro de dono/cadência/evals de qualquer nó.
- **mídia** — `img/` e `data/`, iguais aos de uma skill.

## Como tudo se conecta

Skills linkam para o commons e umas para as outras — o resultado é **um único grafo de conhecimento**. Um dicionário no commons pode ser referenciado por dez skills; a Balde inverte essas ligações para mostrar "usado por N skills" e desenhar o **Mapa do corpus**.

Quem consome esse conhecimento:

- **O add-in RevenueHub** (Excel/PowerPoint), pela API de máquinas.
- **Assistentes externos** — ChatGPT e Claude — ligados pela sua chave pessoal (veja **Conectar ChatGPT e Claude**).
- **O chat da própria Balde**, que lê o corpus do mesmo jeito que um agente externo.

## Governança, em uma olhada

O pulo do gato da Balde: **a unidade de governança é o nó**, não só a skill. A skill, cada conceito de contexto e cada conceito do commons são governados pelo **mesmo primitivo**. Todo nó carrega:

- **Dono e curadores** — quem responde por ele e quem pode editá-lo.
- **Cadência e frescor** — de quanto em quanto tempo precisa ser revisado (semanal, mensal, trimestral, anual) e o estado atual: **em dia**, **a vencer**, **vencido** ou **nunca revisado**.
- **Evals** (opcional) — critérios objetivos que a IA verifica.
- **Trilha de auditoria** — o histórico git + as aprovações registradas.

E o acesso: **sem `ACCESS.yml`, a skill é pública**; com ele, você restringe a leitura e a curadoria a pessoas e grupos. O portão vale em todas as superfícies — lista, detalhe, API e fila.

## Por onde seguir

- **Como explorar o corpus** — navegar skills e commons, ler, filtrar e ver o grafo.
- **OKF e a arquitetura da Balde** — o modelo técnico completo: formato, estrutura de cada artefato, nós governados, acesso, ciclo de vida e a API para máquinas.
- **Chat, plenárias e skills** — conversar com o conhecimento, sozinho ou em grupo, e contribuir de volta.
