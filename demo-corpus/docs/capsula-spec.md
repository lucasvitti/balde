---
section: "Ingestão de dados"
section_order: 4
order: 1
downloadable: true
---

# Cápsulas de importação — especificação

Uma **cápsula de importação** é um arquivo JSON que entrega conhecimento **pronto para entrar na Balde**: os conceitos (cápsulas do commons), a skill que os organiza, os vínculos entre eles e a governança (dono, curadores, cadência, critérios de avaliação) — tudo num único manifesto.

A ideia: **você monta sua própria esteira de ingestão com o SEU assistente de IA** (ChatGPT, Claude, o que preferir). Dê a ele este documento + o material bruto (uma transcrição de reunião, um e-mail, uma nota de release) e peça um manifesto. Depois **compile** na Balde: o compilador valida tudo e devolve erros e avisos **legíveis por máquina** — devolva o relatório ao assistente, corrija, repita, até `ok: true`.

> **Estado atual:** o ciclo completo está no ar — **compile**, **submit** e os **três arquétipos**, incluindo `skill.action: "create"` (uma skill nova inteira + suas cápsulas num único manifesto). Uma cápsula limpa vira **um item na fila de curadoria**; a **aprovação aplica** (recompilada contra o corpus atual antes de gravar). Nada entra no corpus sem revisão humana.

## O ciclo

```
material bruto ──▶ seu assistente de IA + esta spec ──▶ manifesto JSON
                                                            │
                                        ┌───────────────────▼───────────┐
                                        │  POST /api/capsule/compile     │
                                        │  → { ok, errors, warnings,     │
                                        │      plan }                    │
                                        └───────────────────┬───────────┘
                            erros? volta ao assistente ◀────┘ ok: true
                                                            │
                                        POST /api/capsule/submit
                                                            ▼
                                       fila de curadoria ──▶ aprovação = deploy
```

## Endpoints

| Endpoint | Autenticação | Função |
|---|---|---|
| `POST /api/capsule/compile` | sessão SSO (app) | compila o manifesto; devolve `{ok, repo, errors, warnings, plan}` |
| `POST /api/v1/capsule/compile` | `Authorization: Bearer <token pessoal>` | o mesmo, para máquinas/assistentes |
| `POST /api/capsule/submit` | sessão SSO (app) | compile + envia para a fila; devolve `{ok, submitted, queueId, plan, warnings}` |
| `POST /api/v1/capsule/submit` | Bearer | o mesmo, para máquinas (exige poder LER a skill âncora) |
| `GET /api/v1/capsule/spec` | Bearer | este documento, em markdown cru (para alimentar o assistente) |
| `GET /api/v1/capsule/categories` | Bearer | o vocabulário de **tipos de cápsula** do balde (`{key, label, hint}` + o padrão) — escolha a `categoria` de cada cápsula nova daqui |

Compilar e submeter são **abertos a todos** os usuários autenticados. Compilar **nunca grava nada**; submeter grava apenas o item na fila — o corpus só muda quando um curador da skill âncora **aprova** (o botão "Aprovar e aplicar" recompila contra o corpus atual e aplica: cápsulas + governança + vínculos no SKILL.md, tudo versionado em git). Se o corpus mudou e a cápsula não compila mais, a aprovação falha com os erros novos e o item continua pendente.

O compilador também respeita **quem você é**: um `update` (ou `references`) mirando uma skill ou cápsula **restrita** que você não pode ler é reportado como inexistente — mesma mensagem do não-existir, sem vazar que o id está ocupado. E criar num domínio exige que ele esteja liberado para você (`dominio-nao-autorizado`).

### Balde de destino (ambiente)

Toda compilação roda dentro de **UM balde** (repo — a partição de topo do corpus; veja **Baldes**), e é nele que a aprovação vai gravar. O balde ativo vem **da conexão, nunca do manifesto**:

- **No app** — o seletor de balde no topo.
- **Máquinas (`/api/v1`)** — o parâmetro `?repo=` ou o cabeçalho `X-Balde-Repo`; sem eles, o balde padrão (`corporate`).
- **MCP (balde-knowledge)** — a configuração `BALDE_REPO` da conexão (campo *Balde (repo)* na instalação).

O relatório de compilação **sempre ecoa o alvo**: o campo `repo` da resposta e a **primeira linha do plano** (`balde: <nome>`) — mostre-os ao usuário antes de submeter. O manifesto continua **portátil** (o mesmo arquivo compila em qualquer balde), mas pode fixar o destino como **asserção**: declare `"repo": "<nome>"` no topo e a compilação falha com `repo-divergente` se o balde ativo for outro — o cinto de segurança para esteiras recorrentes.

## O manifesto

Um único objeto JSON. Visão geral dos blocos:

| Bloco | Obrigatório? | O que declara |
|---|---|---|
| `format` | sim | sempre `"balde-capsule/1"` |
| `title` | não | rótulo da cápsula (aparece na fila de curadoria) |
| `repo` | não | **asserção** do balde de destino: se declarado, deve ser igual ao balde ativo da compilação (senão `repo-divergente`) — veja *Balde de destino* acima |
| `visibility` | não | **UMA visibilidade para o manifesto inteiro**: `"public"` ou `"restricted"` — herdada pela skill âncora **e por todas as cápsulas** de `concepts` (veja *Visibilidade única* abaixo) |
| `curators` / `readers` | não | listas de e-mails da política de acesso quando `visibility: "restricted"` **sem** bloco `skill` (com bloco `skill`, use `skill.curators`/`skill.readers`) |
| `skill` | não | a **skill âncora** — criada (`create`) ou existente (`update`); é nela que os vínculos entram |
| `concepts` | não | as cápsulas do commons a criar/atualizar |
| `references` | não | cápsulas **já existentes** para vincular na skill âncora |

Pelo menos um de `skill` · `concepts` · `references` precisa existir. Três arquétipos:

- **Skill + cápsulas de uma vez** — `skill.action: "create"` + `concepts`: nasce a vizinhança inteira (ex.: um processo com uma cápsula por fase).
- **Cápsulas numa skill existente** — `skill.action: "update"` + `concepts`: o caso "notas da reunião semanal" — novos episódios + vínculo no SKILL.md.
- **Só cápsulas** — apenas `concepts`, sem bloco `skill` (nada é vinculado).

### Visibilidade única

Skills **e cápsulas** têm visibilidade `public` (padrão) ou `restricted` — uma cápsula restrita some de **todas** as superfícies (lista, explorador, grafo, chat, `/api/v1`, MCP) para quem não estiver listado como curador/leitor. No manifesto a visibilidade é declarada **UMA vez** — no topo (`visibility`) ou em `skill.visibility` (o mesmo valor; divergência é o erro `visibilidade-conflitante`) — e é **herdada pela skill âncora e por todas as cápsulas de `concepts`**:

- **Ausente** → nada muda: `create` nasce **pública**; `update` **preserva** a política atual de cada nó.
- **`"restricted"`** → a skill e cada cápsula do manifesto ganham `ACCESS.yml` com curadores = `skill.curators` (∪ `curators` do topo ∪ `skill.owner`) e leitores = `skill.readers` (∪ `readers` do topo). O curador que aprovar fica sempre listado — nenhum nó nasce trancado.
- **`"public"`** → a skill e cada cápsula do manifesto ficam explicitamente públicas (útil para reabrir um conjunto restrito).
- Cápsulas em `references` (já existentes, só vinculadas) **não** têm a política alterada.
- O campo `visibility` **por cápsula** não existe — se vier, é ignorado com o aviso `visibilidade-por-capsula-ignorada`.

### Exemplo completo (episódio semanal numa skill existente)

```
{
  "format": "balde-capsule/1",
  "title": "Projeto A — status semanal 2026-W33",
  "skill": { "action": "update", "id": "pricing/pricing-processo-e-governanca" },
  "concepts": [
    {
      "action": "create",
      "id": "pricing/projeto-a-status-2026-w33",
      "title": "Projeto A — status 2026-W33",
      "summary": "Datas novas, status geral e bloqueios da semana W33.",
      "body": "# Projeto A — status 2026-W33\n\n## Datas\n- Go-live adiado para 2026-09-15.\n\n## Bloqueios\n- Aguardando parecer jurídico.",
      "serie": "projeto-a-status",
      "periodo": "2026-W33",
      "cadence": "weekly",
      "curators": ["ana@exemplo.com"]
    }
  ]
}
```

### Exemplo mínimo (skill nova + duas cápsulas)

```
{
  "format": "balde-capsule/1",
  "skill": {
    "action": "create",
    "domain": "pricing",
    "slug": "reajuste-anual",
    "title": "Reajuste anual",
    "objetivo": "Orienta o processo de reajuste anual de preços.",
    "body": "## Papel\n\nVocê guia o processo de reajuste anual...",
    "owner": "ana@exemplo.com"
  },
  "concepts": [
    { "action": "create", "id": "pricing/reajuste-calendario", "title": "Calendário do reajuste", "body": "# Calendário\n..." },
    { "action": "create", "id": "pricing/reajuste-regras", "title": "Regras do reajuste", "body": "# Regras\n..." }
  ],
  "references": ["pricing/tracker-pricing"]
}
```

## O bloco `skill` (a âncora)

| Campo | `create` | `update` | Notas |
|---|---|---|---|
| `action` | `"create"` | `"update"` | obrigatório no bloco |
| `id` | opcional (`"<domínio>/<slug>"`) | **obrigatório** | id completo da skill |
| `domain` + `slug` | obrigatórios (se não houver `id`) | — | o domínio vem do **vocabulário governado** |
| `title` | **obrigatório** | ignorado | |
| `objetivo` | **obrigatório** | ignorado | para que a skill serve |
| `description`, `escopo` | opcionais | ignorados | |
| `body` | recomendado (senão template) | opcional — **substitui** o corpo do SKILL.md | markdown; o *system prompt* da skill |
| `owner`, `curators`, `readers` | opcionais — viram `ACCESS.yml` | usados quando a visibilidade única redeclara a política | e-mails |
| `visibility` | `"public"` (padrão) ou `"restricted"` | **aplicada** — é a visibilidade ÚNICA do manifesto | prefira declará-la no topo do manifesto |
| `cadence`, `evalCriteria` | opcionais — semeiam a governança (cadência travada pelo criador) | ignorados | governança inicial |

Em `create`, a aprovação cria a skill inteira: `SKILL.md` (frontmatter + corpo, com os vínculos já inseridos) + `ACCESS.yml` + `governance.json`. Em `update`, aplica: substituição do corpo (se `body` vier) + os **vínculos** de `concepts`/`references`; metadados e governança de skill existente continuam sendo geridos pela edição da skill no app.

## Um item de `concepts` (uma cápsula do commons)

| Campo | Obrigatório? | Regras |
|---|---|---|
| `action` | sim | `"create"` ou `"update"` — o compilador confere contra o corpus (existe ⇄ não existe) |
| `id` | sim | **exatamente 2 segmentos** `"<domínio>/<conceito>"`, já normalizados (minúsculas, sem acentos; hífens e underscores). O domínio deve estar no vocabulário governado |
| `title` | em `create` | nome legível |
| `summary` | não | uma frase (vira o resumo de governança) |
| `body` | em `create` | o markdown do `context.md`. **Cápsulas são atômicas** — proibido link absoluto `](/...)` para outros nós do corpus; relações ficam no SKILL.md da âncora. Máx. 512 KB |
| `serie` | não | agrupa episódios de uma **série temporal** (escopo = o domínio); slug (`fechamento`, `projeto-a-status`) |
| `periodo` | não | ISO — **o formato é a granularidade**: `2026` anual · `2026-07` mensal · `2026-W31` semanal · `2026-07-15` diário. `serie` + `periodo` = um episódio da Linha do tempo |
| `owner`, `curators` | não | e-mails |
| `cadence` | não | `weekly` · `monthly` · `quarterly` · `yearly` (vazio = herda o padrão) |
| `categoria` | recomendado em `create` | o **TIPO** da cápsula, uma chave do vocabulário governado do balde — padrões: `dado` (ponto de dado fechado) · `reuniao` (resumo de reunião) · `decisao` (histórico de decisão) · `tarefas` (lista de tarefas); admins podem estender, então leia a lista viva (`GET /api/v1/capsule/categories` / `balde_capsule_categories`). Omitido, um `create` nasce como `dado` (aviso `categoria-ausente`). **Se o tipo não estiver claro pelo material, pergunte ao usuário final antes de submeter** |
| `evalCriteria` | não | lista de critérios objetivos que a IA checa |
| `link` | não | `true` (padrão) vincula a cápsula no SKILL.md da âncora; `false` não vincula |
| `media` | não | lista de `{ "path": "img/x.png" ou "data/x.csv", "base64": "..." }` — máx. 3 MB por arquivo; as descrições de IA são geradas depois, no app |

## `references`

Ids de cápsulas **já existentes** (`"<domínio>/<conceito>"`) para vincular no SKILL.md da âncora sem tocar no conteúdo delas. Exige o bloco `skill`.

## A resposta do compilador

```
{
  "ok": false,
  "repo": "corporate",
  "errors":   [ { "code": "conceito-ja-existe", "path": "concepts[0].id", "message": "..." } ],
  "warnings": [ { "code": "usuario-desconhecido", "path": "concepts[0].curators[0]", "message": "..." } ],
  "plan":     [ "balde: corporate", "atualiza a skill pricing/...", "cria a cápsula pricing/... (série ... · 2026-W33; mais recente hoje: 2026-W32)", "vincula 1 cápsula(s) no SKILL.md de ..." ]
}
```

- **`repo`** ecoa o balde ativo — **onde** a aprovação vai gravar (também é a primeira linha do plano). Confira antes de submeter.
- **`errors`** bloqueiam (`ok: false`). Corrija e recompile.
- **`warnings`** não bloqueiam — mas leia: normalização de série, período duplicado, usuário fora do roster.
- **`plan`** é o preview do deploy — exatamente o que a aprovação na fila fará (na próxima fase). Episódios mostram o período **mais recente hoje** da série, para o assistente conferir a continuidade.

### Códigos de erro

| Código | Significado |
|---|---|
| `formato-invalido` | JSON inválido, `format` errado ou bloco com o tipo errado |
| `capsula-vazia` | manifesto sem `skill`, `concepts` e `references` |
| `acao-invalida` | `action` fora de `create`/`update` |
| `id-invalido` | id fora do formato/normalização (a mensagem sugere o id normalizado) |
| `dominio-desconhecido` | domínio fora do vocabulário governado (um admin adiciona em Administração › Domínios) |
| `dominio-nao-autorizado` | o manifesto **cria** uma skill/cápsula num domínio que não está liberado para você (lista branca por usuário — peça a um admin em Administração › Domínios por usuário) |
| `repo-divergente` | o manifesto declara `"repo"` e ele não bate com o balde ativo da compilação — troque o balde da conexão ou corrija o campo |
| `repo-invalido` | `"repo"` fora do formato de nome de balde (minúsculas/dígitos/hífens) |
| `skill-inexistente` / `skill-ja-existe` | `update` sem alvo / `create` sobre id ocupado. Uma skill restrita que você **não pode ler** também responde `skill-inexistente` |
| `conceito-inexistente` / `conceito-ja-existe` | idem, para cápsulas (restrita ilegível ⇒ `conceito-inexistente`) |
| `id-duplicado` | a mesma cápsula duas vezes no manifesto |
| `campo-obrigatorio` | falta `title`/`objetivo`/`body` num `create` |
| `capsula-nao-atomica` | o `body` referencia outro nó do corpus com link absoluto — remova; a relação vai no SKILL.md |
| `periodo-invalido` / `serie-invalida` / `cadencia-invalida` / `visibilidade-invalida` / `email-invalido` | valor fora do formato |
| `visibilidade-conflitante` | `visibility` (topo) e `skill.visibility` divergem — o manifesto tem UMA visibilidade |
| `categoria-invalida` | `categoria` fora do vocabulário governado do balde — liste os tipos em `GET /api/v1/capsule/categories` |
| `conteudo-grande` / `midia-grande` / `midia-vazia` / `midia-caminho-invalido` | limites de tamanho e caminhos de mídia |
| `referencia-inexistente` | `references` aponta para cápsula que não existe — ou restrita que você não pode ler |
| `vinculo-sem-skill` | `link: true` ou `references` sem o bloco `skill` |

### Códigos de aviso

| Código | Significado |
|---|---|
| `usuario-desconhecido` | e-mail fora do roster (quem nunca entrou na Balde) — confira a grafia |
| `categoria-ausente` | cápsula nova sem `categoria` — nasceria como o tipo padrão. Declare o tipo; **pergunte ao usuário final quando o material não deixar claro** |
| `serie-normalizada` | a série será gravada na forma normalizada indicada |
| `periodo-sem-serie` | período sem série não forma episódio |
| `periodo-duplicado` | a série já tem episódio nesse período |
| `granularidade-mista` | período com granularidade diferente da série (quebra os marcadores de lacuna) |
| `limite-de-vinculos` | o SKILL.md passaria de 24 cápsulas vinculadas |
| `referencia-redundante` / `atualizacao-vazia` | referência já coberta / update sem mudanças |
| `visibilidade-por-capsula-ignorada` | `concepts[i].visibility` não existe — a visibilidade é única por manifesto |

## Arquivos anexados a uma cápsula (sidecar `files/`)

Além das mídias de contexto (`img/` + `data/`), uma cápsula pode carregar **arquivos para download** — PDFs, zips, `.docx`/`.xlsx` — no sidecar **`files/`** (`commons/<domínio>/<conceito>/files/<nome>`, versionado em git ao lado do `context.md`). Diferente de `img/` e `data/`, o `files/` é **não-contexto**: nunca entra no prompt de IA, no grafo do corpus nem na indexação — é só um anexo baixável. Limite de **20 MB por arquivo**.

Os arquivos aparecem em **`media.files[]`** (`{ name, size, url }`) na leitura da cápsula (app, `GET /api/v1/commons/{path}` e `balde_read_commons`), ao lado de `media.images[]` e `media.data[]`.

| Endpoint | Autenticação | Função |
|---|---|---|
| `GET /api/commons/file-asset?path=<cápsula>&name=<arquivo>` | sessão SSO (app) | baixa um anexo (respeita a **leitura** da cápsula; 404 se restrita e sem acesso) |
| `GET /api/v1/commons/{path}/files/{name}` | `Authorization: Bearer <token pessoal>` | o mesmo, para máquinas/assistentes |
| `POST /api/v1/commons/{path}/files` | Bearer | anexa um arquivo — corpo JSON `{ name, base64 }`, máx. 20 MB; exige **gerência** (curador/admin) da cápsula. Devolve `{ ok, name, size, url }` |

O upload **não faz parte do manifesto** de importação: os anexos entram por uma chamada `POST` própria (ou pela ferramenta de cliente `uploadCommonsFileAsset`), depois que a cápsula existe. Cada upload é gravado no `files/` e versionado em git.

O mesmo recurso existe, **idêntico, para skills**: o sidecar **`files/`** de uma skill (`skills/<id>/files/<nome>`, versionado em git ao lado do `SKILL.md`) carrega anexos baixáveis, não-contexto, com o mesmo limite de **20 MB por arquivo**. Aparecem em **`media.files[]`** (`{ name, size, url }`) na leitura da skill (app, `GET /api/v1/skills/{id}` e `balde_get_skill`).

| Endpoint | Autenticação | Função |
|---|---|---|
| `GET /api/skills/{id}/file?name=<arquivo>` | sessão SSO (app) | baixa um anexo (respeita a **leitura** da skill; 404 se restrita e sem acesso) |
| `GET /api/v1/skills/{id}/files/{name}` | `Authorization: Bearer <token pessoal>` | o mesmo, para máquinas/assistentes |
| `POST /api/v1/skills/{id}/files` | Bearer | anexa um arquivo — corpo JSON `{ name, base64 }`, máx. 20 MB; exige **gerência** (curador/admin) da skill. Devolve `{ ok, name, size, url }` |

Como no commons, o upload de skill entra por `POST` próprio (ou pela ferramenta de cliente `uploadSkillFileAsset`), depois que a skill existe; cada upload é gravado no `files/` e versionado em git.

## Ferramentas MCP no seu assistente

Quem conecta o Claude (ou outro cliente MCP) pelo servidor **balde-knowledge** (veja **Conectar ChatGPT e Claude**) ganha o ciclo inteiro como ferramentas nativas — sem montar chamadas HTTP:

| Ferramenta | Faz |
|---|---|
| `balde_capsule_spec` | busca esta spec (chame ANTES de gerar um manifesto) |
| `balde_capsule_categories` | lista os **tipos de cápsula** do balde (key, label, hint) — defina a `categoria` de cada cápsula nova; pergunte ao usuário se o tipo não estiver claro |
| `balde_compile_capsule` | compila o manifesto — itere até `ok: true` (não grava nada) |
| `balde_submit_capsule` | envia a cápsula limpa para a fila (após sua confirmação) |

As ferramentas de leitura (`balde_list_skills`, `balde_list_commons`, `balde_read_commons`…) dão ao assistente o contexto do corpus — skills, cápsulas existentes, séries e períodos. **A leitura respeita a visibilidade**: skills e cápsulas restritas só aparecem (e só servem conteúdo) quando o dono da chave está listado como curador/leitor. No ChatGPT, o GPT Action (schema OpenAPI do Balde) expõe as mesmas operações (`getCapsuleSpec`, `compileCapsule`, `submitCapsule`).

## Receita para o seu assistente de IA

1. Busque esta spec (`balde_capsule_spec`, ou `GET /api/v1/capsule/spec` com sua chave pessoal) — ou cole este documento no chat.
2. Contexto do corpus: `balde_list_commons` / `GET /api/v1/commons` lista as cápsulas existentes com `serie`/`periodo` (para achar o próximo período e evitar colisões); `balde_list_skills` lista as skills; `balde_capsule_categories` / `GET /api/v1/capsule/categories` lista os **tipos de cápsula** — defina a `categoria` de cada cápsula nova e **pergunte ao usuário final quando o material não deixar o tipo claro**.
3. Peça: "gere um manifesto balde-capsule/1 a partir deste material" + o material bruto.
4. Compile (`balde_compile_capsule` / `POST /api/v1/capsule/compile`); se `ok: false`, corrija com os `errors` e repita.
5. Com `ok: true`, submeta (`balde_submit_capsule` / `POST /api/v1/capsule/submit`) — a resposta traz o `queueId`; um curador da skill âncora revisa o plano de deploy na Fila e aprova (a aprovação aplica ao corpus).

## Exemplo de chamada

```
curl -s -X POST https://balde.example.com/api/v1/capsule/compile \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "content-type: application/json" \
  --data @capsula.json
```

Para gerar sua chave pessoal e conectar o assistente, veja **Conectar ChatGPT e Claude** (seção *Comece por aqui*).
