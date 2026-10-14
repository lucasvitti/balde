---
section: "Entender o corpus"
section_order: 1
order: 3
---

# O padrão OKF

O corpus do Balde segue o **OKF — Open Knowledge Format**, um padrão aberto publicado pelo **Google Cloud em junho de 2026** para representar o conhecimento que sistemas de IA consomem. Esta página conta o que é o padrão, por que o adotamos e como o Balde o estende.

## De onde veio

Antes de virar padrão, o OKF foi uma prática. Times que trabalhavam com IA foram convergindo para o mesmo formato caseiro: uma pasta de arquivos de texto (markdown), um conceito por arquivo, links comuns entre eles — o chamado padrão "LLM wiki", popularizado por Andrej Karpathy. Funcionava porque é o formato que humanos **e** modelos leem com a mesma facilidade.

Em 12 de junho de 2026 o Google Cloud formalizou a prática como especificação — o OKF v0.1 — com uma promessa central de **portabilidade**: um acervo escrito por uma ferramenta pode ser lido por qualquer outra, sem tradução, sem SDK, sem runtime obrigatório.

## As regras do padrão

O OKF é deliberadamente pequeno. O que ele define:

- **Conhecimento é um diretório de arquivos markdown.** Nada de banco de dados proprietário: arquivos numa pasta.
- **Cada arquivo é um conceito; o caminho é a identidade.** `vendas/glossario` é ao mesmo tempo onde o conceito mora e como ele é citado.
- **Links comuns formam o grafo.** Conceitos se referenciam por links markdown normais — sem sintaxe nova. A pasta inteira vira uma rede navegável.
- **Links quebrados são tolerados.** Um link para algo que não existe é sinalizado como pendente — nunca derruba nada.
- **Quase nada é obrigatório.** Um pouco de metadados no topo do arquivo (título, descrição, data); o resto é texto.
- **Nomes reservados mínimos.** Um `index.md` como porta de entrada e um `log.md` como diário de mudanças, ambos opcionais.

O efeito prático: um acervo OKF renderiza no GitHub, versiona em git, monta em qualquer sistema de arquivos e sobrevive à ferramenta que o criou.

## Como o Balde aplica o padrão

O mapeamento é direto:

| No OKF | No Balde |
|---|---|
| Um conceito = um arquivo | Uma **cápsula** (o conteúdo dela) ou um arquivo de contexto de uma skill. |
| A porta de entrada (`index.md`) | O **`SKILL.md`** — o nó raiz de cada skill. |
| O diário (`log.md`) | O **histórico git** + os registros de mudança de cada artefato. |
| Links markdown | Os vínculos skill → cápsula e skill → skill que desenham o **Mapa de conhecimento**. |
| Metadados no topo | O cabeçalho do `SKILL.md`: `type`, `title`, `description`, `timestamp`, `resource`. |
| Tolerância a links quebrados | Links pendentes são contados e listados na aba Grafo — nunca bloqueiam. |

E a API para máquinas fala o formato nativamente: a listagem de skills se declara `okf/0.1`, e qualquer consumidor que entenda OKF entende o Balde.

### Namespace de três níveis

Acima do domínio existe o **balde (repo)** — uma partição independente do corpus com ledgers
git próprios: `balde / domínio / artefato`. Links dentro do mesmo balde não mudam; um link
que cruza a fronteira é qualificado: `/@corporate/commons/vendas/glossario`. A leitura entre
baldes é mediada por membership (referência ≠ concessão). Detalhes em **Baldes (repos)**.

## O que o Balde acrescenta — "OKF + governança"

O OKF resolve o **formato**; de propósito, não diz nada sobre confiança — quem responde pelo conteúdo, o que está vencido, o que foi verificado. Essa é a camada do Balde:

- **Nós governados** — toda skill, cápsula e arquivo de contexto tem dono, curadores, cadência de revisão e estado de frescor (veja **Governança e acesso**).
- **Avaliação com portão** — um checklist obrigatório + casos de uso, avaliados por IA e aceitos por humanos; nada vira Canônico sem passar (veja **Avaliação e promoção**).
- **Curadoria de entrada** — contribuições e importações passam por uma fila revisada por humanos.
- **Acesso** — skills e cápsulas podem ser restritas a pessoas (skills também a grupos); a política vale em todas as superfícies.

O ponto importante: a governança vive em **arquivos-irmãos ao lado do conteúdo** — nunca dentro dele. Tire o Balde da frente e o que sobra continua sendo um acervo OKF válido: uma pasta de markdown legível, com histórico git. Formato aberto na base, governança por cima — sem aprisionamento.

## Fontes

- Google Cloud — anúncio do Open Knowledge Format (OKF) v0.1, junho de 2026.
- MarkTechPost — "Google Cloud Introduces Open Knowledge Format (OKF)": https://www.marktechpost.com/2026/06/16/google-cloud-introduces-open-knowledge-format-okf-a-vendor-neutral-markdown-spec-for-giving-ai-agents-curated-context/
- GitBook — "What is OKF? Understanding Google's Open Knowledge Format": https://www.gitbook.com/blog/what-is-okf-open-knowledge-format
- MindStudio — "What Is the Open Knowledge Format (OKF)?": https://www.mindstudio.ai/blog/what-is-open-knowledge-format-okf-google-ai-knowledge-bases
- Andrej Karpathy — o gist "LLM wiki", o padrão de comunidade que o OKF formalizou.

## Para seguir

- **Cápsulas** e **Skills** — os dois artefatos que o padrão dá forma.
- **Governança e acesso** — a camada que o Balde acrescenta ao formato.
