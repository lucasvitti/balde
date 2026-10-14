---
section: "Ingestão de dados"
section_order: 4
order: 0
---

# Criação manual — Cápsulas

O passo a passo completo para criar uma cápsula pela interface, campo a campo. Antes de começar, vale ter lido **Cápsulas** (seção Entender o corpus) — aqui o foco é o **como**; lá, o **porquê**.

**Quem pode:** admins e curadores (cápsulas são compartilhadas pelo corpus inteiro, então a criação é ato de curadoria). Sem permissão, o cartão aparece desabilitado.

## Por onde entrar

No menu **Criar**, a tela "O que você quer criar?" oferece três portas:

- **Cápsula** — o assistente em branco, coberto abaixo.
- **Importar cápsula** — já tem o conteúdo num arquivo `.md`? Envie o arquivo: o mesmo assistente abre com o conceito, o título e o resumo já preenchidos a partir dele. Revise o nome, escolha o domínio e siga o fluxo normal.
- Há ainda um terceiro caminho, a partir de uma skill: na aba **Curadoria**, o botão **Cápsula** ao lado de um arquivo de contexto o promove a cápsula compartilhada (pré-preenchendo o assistente) e o religa na skill.

O assistente tem **6 etapas**, com uma trilha à esquerda mostrando onde você está: **Geral → context.md → Mídia & dados → Governança → Avaliação → Revisão**. Dá para voltar a qualquer etapa já visitada clicando nela.

## Etapa 1 — Geral

![O assistente Criar cápsula na etapa Geral: a trilha de 6 etapas à esquerda e os campos Domínio, Conceito, Título e Resumo](assets/doc-criar-capsula.png)

A identidade da cápsula. O aviso do topo resume: o domínio + o conceito formam o id e o link.

| Campo | Como preencher |
|---|---|
| **Domínio** (obrigatório) | Escolha na lista — é o vocabulário governado, o mesmo das skills, filtrado pelos **domínios liberados para você** (lista branca de criação; admins veem todos). Falta um domínio? Um admin adiciona o domínio (Administração › Domínios) ou libera você nele (Domínios por usuário). |
| **Conceito** (obrigatório) | O nome-endereço dentro do domínio (ex.: `dicionario_dados`). Minúsculas, sem acentos; hífens e underscores valem. A tela mostra o link resultante: `/commons/dominio/conceito`. |
| **Título** (obrigatório) | O nome legível, exibido nas listas (ex.: "Dicionário do schema RD"). |
| **Resumo** | Uma frase: o que este conceito descreve. Aparece nas listagens e alimenta a busca — vale caprichar. |

> O par domínio/conceito é **definitivo**: depois de criada, a cápsula não muda de endereço (mover quebraria os links das skills que a usam).

## Etapa 2 — context.md

O conteúdo em si — o markdown que vira contexto quando uma skill referencia a cápsula.

- **Conteúdo (markdown)** — escreva ou cole. O botão **Usar template** gera um esqueleto a partir do título e do resumo (`## Definição` + `## Como usar`) para você não começar do zero.
- **Enviar context.md (opcional)** — se o texto já existe num arquivo, envie-o aqui.

Regra de ouro (o assistente a lembra): **cápsulas são atômicas** — o texto não pode referenciar outras cápsulas ou skills. Se você sentir necessidade de linkar outro conceito, o lugar dessa relação é a skill que organiza os dois.

## Etapa 3 — Mídia & dados

Anexos que **viram contexto**: imagens vão para `img/`, tabelas pequenas (CSV/TSV) para `data/`.

1. Selecione os arquivos em **Arquivos (imagens · csv/tsv)**.
2. Cada arquivo entra na lista com o caminho (editável), o tamanho e um campo **Descrição (vira contexto)**.
3. A descrição é o que a IA vai ler — escreva você mesmo, ou clique **IA** no arquivo (ou **Processar tudo com IA**) para gerar: para imagens, o que o gráfico mostra; para tabelas, colunas, período e números-chave.

Limites: imagens até 5 MB; tabelas até 256 KB. Formatos: PNG, JPG, GIF, WEBP, BMP, CSV, TSV. (Gerar descrições usa a sua chave de IA, de Configurações › Provedor de IA.)

> **E os outros formatos?** PDFs, planilhas e zips entram como **arquivos anexos** (`files/`, até 20 MB) — entregáveis para download, que a IA **não** lê. Por enquanto, anexar é pela API (`POST /api/v1/commons/{id}/files`, curador/admin); os anexos aparecem na aba Arquivos da cápsula com botão de download. Veja **Cápsulas** e **Conectar ChatGPT e Claude**.

## Etapa 4 — Governança

Quem cuida e com que frequência:

| Campo | Como preencher |
|---|---|
| **Owner** | O e-mail de quem responde pelo conteúdo. |
| **Curadores** | Quem gerencia o conceito junto — adicione e-mails (viram chips). |
| **Visibilidade** | **Pública** (padrão): qualquer usuário autenticado lê e referencia. **Restrita**: a cápsula some de todas as superfícies (lista, explorador, grafo, chat, API, MCP) para quem não estiver listado. |
| **Leitores** (só se restrita) | Quem lê sem gerenciar — adicione e-mails (viram chips). Curadores já leem; **você (criador) permanece listado automaticamente**, então a cápsula nunca fica inacessível para quem a governa. |
| **Cadência de revisão** | Semanal, mensal, trimestral ou anual — ou deixe **herdar o padrão das cápsulas**. Atenção: **você define uma vez; depois só admins mudam**. |
| **Série temporal** (opcional) | Para conhecimento recorrente: preencha **Série** (ex.: `fechamento`) e **Período** em ISO — `2026` (anual), `2026-07` (mensal), `2026-W31` (semanal), `2026-07-15` (diário). O formato do período define a granularidade, e episódios da mesma série aparecem na **Linha do tempo** das skills que os referenciam. |

## Etapa 5 — Avaliação

Como a cápsula será verificada (o modelo completo está em **Avaliação e promoção**):

- **Obrigatórios** — o checklist da casa, definido pelos admins. Aparece aqui para leitura; não é editável por artefato.
- **Casos de uso** — os testes específicos deste conceito. Em **＋ Adicionar**: título, prompt de verificação e, se quiser, uma rubrica de opções ou um caso de teste (pergunta + resposta esperada).
- **✨ Sugerir com IA** — rascunha casos a partir do conteúdo que você escreveu nas etapas anteriores. Revise antes de aceitar.

Para cápsulas a avaliação funciona como **selo de qualidade** (não bloqueia a criação) — mas nasce configurada e pronta para rodar.

## Etapa 6 — Revisão

O resumo final: id/link, título, resumo, tamanho do conteúdo, mídia, owner, curadores, **visibilidade**, cadência, série e itens de avaliação. Confira e clique **Criar cápsula**.

A cápsula nasce publicada: disponível para referência pelo link, listada na página **Cápsulas** e no **Corpus**, e visível no **Grafo** assim que a primeira skill a vincular. Se nasceu **restrita**, tudo isso vale apenas para os curadores/leitores listados — para os demais usuários ela não aparece em superfície nenhuma.

## Depois de criar

- **Vincular numa skill** — no editor da skill (corpo do SKILL.md), digite `[[` e escolha a cápsula (ou use **+ cápsula**). `[[[` lista skills.
- **Editar** — no Corpus, o botão **Editar cápsula** reabre o assistente (o id não muda; todo o resto sim). Para retoques rápidos no texto, **Editar texto** edita ali mesmo (Ctrl+Enter salva).
- **Processar mídia** — anexou arquivos sem descrição? **Processar mídia (IA)** gera depois.
- **Manter viva** — a cápsula entra no ciclo de frescor: quando vencer, aparece na página Cápsulas como pendência; o botão **Em dia** registra a revisão.

## Preferindo automatizar

Se o conhecimento chega em volume (atas semanais, comunicados, fechamentos), a esteira automática faz este fluxo por você: o seu assistente de IA gera um manifesto, o Balde valida e a fila aplica — veja **Cápsulas de importação — especificação**, nesta seção.
