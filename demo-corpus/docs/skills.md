---
section: "Entender o corpus"
section_order: 1
order: 2
---

# Skills

Uma **skill** é um pacote de conhecimento operacional: **o que a IA precisa saber para executar bem uma tarefa do time**. Resumir uma reunião no formato da casa, explicar o churn mensal, revisar uma query no padrão — cada capacidade dessas é uma skill.

Se a cápsula é a matéria-prima (um conceito), a skill é a **composição**: ela junta a instrução (como agir), o contexto (o que saber) e a governança (quem responde, como se avalia) numa unidade com endereço, versão e histórico.

## O que uma skill é — e o que não é

**É:**

- **Uma instrução com contexto.** O coração é o `SKILL.md`: um cabeçalho de metadados + um corpo que é a **instrução da IA** (papel, como responder, regras). Ao redor dele, arquivos de contexto e cápsulas vinculadas fundamentam a resposta.
- **Um artefato governado.** Toda skill tem owner, curadores, cadência de revisão, avaliação e um ciclo de vida: nasce **Blueprint** (rascunho) e só vira **Canônica** quando a avaliação passa.
- **Consumível por vários canais.** A mesma skill alimenta o chat do Balde, o add-in RevenueHub no Excel e assistentes externos (ChatGPT/Claude) pela API.

**Não é:**

- **Não é um chat prompt solto.** A skill declara objetivo, escopo e limites — e carrega o contexto que sustenta a resposta. É reutilizável e auditável, não uma mensagem improvisada.
- **Não é um repositório de arquivos.** Os arquivos existem **a serviço da instrução**; dados brutos e datasets ficam de fora.
- **Não é documentação.** Documentação (esta seção) explica a plataforma às pessoas; a skill instrui a IA.

## As partes de uma skill

| Parte | Função |
|---|---|
| **`SKILL.md`** | A espinha: metadados + governança no cabeçalho, e a instrução (o *system prompt*) no corpo. |
| **Arquivos de contexto** | O material que fundamenta a resposta, organizado por pasta: `references/` (definições, textos de negócio), `query/` (SQL e scripts), `analytics/` (catálogos e dicionários de dados). |
| **Cápsulas vinculadas** | Conceitos compartilhados que a skill referencia por link — sem copiar (veja **Cápsulas**). |
| **Mídia** | `img/` e `data/` — imagens e tabelas pequenas que a IA descreve em texto; as descrições viram contexto. |
| **Arquivos anexos** | `files/` — entregáveis para **download** (PDFs, planilhas, zips; até 20 MB cada). Não viram contexto: a pessoa baixa o original, na aba Arquivos ou pela API. |
| **Avaliação** | O checklist obrigatório + os casos de uso da skill (veja **Avaliação e promoção**). |
| **Governança** | Registro de owner, curadores, cadência, revisões e aprovações — mantido pela plataforma. |

## Endereço e domínio

Toda skill vive em `dominio/slug` (ex.: `pricing/reajuste-anual`), com subpastas opcionais no meio (`pricing/churn/mensal-b2c`). O **domínio** vem do mesmo vocabulário governado das cápsulas — a lista oficial de áreas que os admins mantêm em Administração › Domínios. É o domínio que organiza as listas, o mapa e os filtros.

O endereço é a identidade: depois de criada, o slug e o domínio da skill **não mudam**.

## Como skills e cápsulas se conectam

No corpo do `SKILL.md`, um link markdown comum — `/commons/vendas/glossario` — vincula a cápsula à skill. Na prática você não digita isso: no editor, **`[[` abre um autocompletar de cápsulas** (e **`[[[` de skills**) e insere o link pronto.

O vínculo faz três coisas:

- **Leva o conteúdo à IA.** Ao usar a skill, cada cápsula vinculada entra como contexto (com sua mídia já descrita em texto).
- **Constrói o grafo.** As referências viram as setas do **Mapa de conhecimento** — e a cápsula passa a mostrar "usado por N skills".
- **Liga séries temporais.** Vincular um episódio de uma série (ex.: o status de uma semana) dá à skill a **Linha do tempo** da série inteira, com o episódio mais recente em destaque.

Uma skill pode vincular até 24 cápsulas. Links quebrados não travam nada — ficam marcados como pendentes até alguém corrigir.

## O formato por baixo — OKF, em uma nota

O corpus segue o **OKF (Open Knowledge Format)**, um padrão aberto do Google para representar conhecimento como arquivos de texto interligados. Para o dia a dia, o que importa: cada conceito é um arquivo, o caminho é a identidade, links comuns formam o grafo — e por isso o corpus é portátil, versionável e legível fora do Balde. A história completa do padrão (e o que o Balde acrescenta a ele) está em **O padrão OKF**.

## Governança, em primeira olhada

Os mesmos sinais das cápsulas valem para a skill — e para cada arquivo de contexto dela:

| Sinal | O que diz |
|---|---|
| **Status** | **Blueprint** (em construção, fora da API) ou **Canônica** (publicada — é o que os consumidores enxergam). |
| **Frescor** | em dia · revisar em breve · auditoria vencida · nunca revisado — derivado da cadência de revisão. |
| **Avaliação** | aprovado · reprovado · pendente — o resultado do checklist + casos de uso. |
| **Selo de qualidade** | Uma nota 0–100 que resume casos de uso, validação, governança, clareza e frescor. |
| **Versão** | SemVer (`1.2.0`), incrementada a cada publicação; versões antigas ficam arquivadas com rollback. |

Quem pode ver e quem pode editar é política por skill — pública por padrão, restrita quando declarado (veja **Governança e acesso**). A promoção Blueprint → Canônica é bloqueada até a avaliação passar (veja **Avaliação e promoção**).

## Como a IA lê uma skill

Do jeito que couber melhor no contexto do modelo:

- **Skill pequena** — entra inteira: instrução + contexto + cápsulas.
- **Skill grande** — entra a instrução + um **índice** dos arquivos (nome, tipo, tamanho, resumo), e a IA **lê os arquivos sob demanda**, seguindo os links de que precisa. No fim, a resposta lista as **Fontes** de fato consultadas.

A troca é automática por tamanho; o criador pode forçar um modo ou outro. É isso que deixa skills grandes utilizáveis sem estourar o contexto — e cada resposta, rastreável.

## Referência técnica — a pasta de uma skill

Para quem quer ver o disco (todo o resto desta página não exige isto):

```
skills/<domínio>/<slug>/
├── SKILL.md                  ← metadados + instrução. A espinha.
├── references/*.md            definições, glossários, contexto de negócio
├── query/*.sql                SQL e scripts
├── analytics/*                catálogos e dicionários de dados
├── output_schema.json         contrato de saída (quando a saída é estruturada)
├── img/  + descrições IA      imagens que viram contexto
├── data/ + descrições IA      tabelas pequenas que viram contexto
├── files/                     anexos para download (PDF, zip, xlsx…) — nunca viram contexto
├── eval/cases.json            a avaliação (checklist + casos de uso)
├── ACCESS.yml                 política de acesso (ausente = pública)
├── governance.json            registro de governança de todos os nós da skill
├── canonico/                  o snapshot publicado (a versão que a API serve)
├── legado/<carimbo>/          versões anteriores, para rollback
└── logs/                      registros de mudança e revisões
```

O cabeçalho do `SKILL.md` traz os campos do padrão OKF (`type`, `title`, `description`, `timestamp`, `resource`) mais a governança do Balde (`owner`, `status`, `version`, `objetivo`, `escopo`) e, opcionalmente, os parâmetros de execução para consumo programático (`output_shape`, `input_kind`, `model_tier`, `max_tokens`, `temperature`, `formula_safe`) e o `buddy_id` do avatar. Nada disso se edita à mão no dia a dia — o assistente **Criar** preenche tudo.

> Nota histórica: versões antigas do Balde guardavam também catálogos e relatórios como artefatos próprios. Hoje **todo artefato do corpus é uma skill de conhecimento** — catálogos e relatórios vivem do lado do RevenueHub e apenas referenciam skills daqui.

## Para seguir

- **Criação manual — Skills** — o assistente de criação, campo a campo.
- **Cápsulas** — a unidade compartilhada que as skills reutilizam.
- **Avaliação e promoção** — o caminho Blueprint → Canônica.
- **Como explorar o corpus** — onde ler tudo isso na interface.
