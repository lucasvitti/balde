---
section: "Usar o conhecimento"
section_order: 2
order: 5
downloadable: true
---

# Conectar ChatGPT e Claude à Balde

Você pode transformar a Balde num **canal de conhecimento dentro do seu assistente de IA** — o **Claude** (Desktop, Code ou conectores) e o **ChatGPT** (via GPT personalizado). O assistente passa a **puxar** skills e seu contexto do corpus e a **enviar** contribuições para a fila de curadoria, sem abrir a aplicação web. Tudo com a **sua chave pessoal**, que fica guardada no cliente e **nunca é vista pelo modelo**.

A base é a API de máquinas da Balde (`/api/v1`) — a mesma que o add-in do Excel/RevenueHub consome. Uma única chave pessoal serve para todos os canais.

## O que o assistente ganha — ferramentas de *pull* e *push*

| Ferramenta | Tipo | O que faz |
|---|---|---|
| `balde_list_repos` | pull | Lista os **repos (baldes)** que a sua chave pode ler — partições independentes do corpus (ex.: `corporate` vs um espaço pessoal). Toda ferramenta opera dentro de **um** repo: defina `BALDE_REPO` no `env` da integração (sem definir = `corporate`). |
| `balde_list_skills` | pull | Lista as skills canônicas (id, título, descrição, domínio, versão). Chame primeiro. |
| `balde_get_skill` | pull | Baixa uma skill: objetivo, escopo, evals e o `SKILL.md` completo (+ contexto embutido, se pequena). |
| `balde_list_skill_context` | pull | Manifesto do contexto de uma skill grande (caminho, tamanho, tipo, resumo, links) — sem baixar o conteúdo. |
| `balde_read_skill_context` | pull | Baixa **um** arquivo de contexto sob demanda, seguindo os links do grafo (divulgação progressiva). |
| `balde_list_commons` | pull | Lista as **cápsulas** compartilhadas do commons — caminho, resumo, quem referencia, série/período. |
| `balde_read_commons` | pull | Baixa **uma** cápsula (o conteúdo já inclui as descrições de mídia geradas por IA). |
| `balde_run_query` | executar | **Executa** uma query governada da skill (arquivo `.sql` versionado — nunca SQL do modelo) num sandbox DuckDB efêmero sobre os datasets governados; devolve colunas/linhas reais. |
| `balde_inspect_dataset` | executar | Perfila **um** dataset da skill (`.csv`/`.parquet` em `analytics/` ou `data/`): schema, contagem de linhas e perfil por coluna — sem escrever SQL. |
| `balde_contribute_context` | push | Envia novo contexto (notas, exemplos, correções) para a **fila de curadoria** de uma skill existente. |
| `balde_capsule_spec` | cápsulas | Busca a **spec das cápsulas de importação** (`balde-capsule/1`) — o contrato para gerar manifestos. |
| `balde_compile_capsule` | cápsulas | **Compila** um manifesto de cápsula sem gravar nada — erros legíveis por máquina; itere até `ok: true`. |
| `balde_submit_capsule` | cápsulas | Envia a cápsula limpa para a **fila de curadoria** — a aprovação do curador aplica ao corpus. |

O **pull** é leitura do corpus. O **executar** roda **conhecimento executável**: só arquivos `.sql` versionados que já vivem na skill, num sandbox travado (sem rede, sem filesystem) que carrega apenas os datasets que a sua chave pode ler. O **push** (`balde_contribute_context`) e as **cápsulas** (`balde_submit_capsule`) **não alteram nada diretamente** — criam um item na fila que um **curador humano** revisa; no caso da cápsula, a aprovação **aplica** o plano de deploy. Só skills **canônicas** aparecem; rascunhos nunca são expostos. A leitura respeita a **visibilidade**: skills e cápsulas **restritas** só aparecem (e só servem conteúdo) quando o dono da chave está listado como curador/leitor. O ciclo completo de cápsulas está em **Cápsulas de importação — especificação** (seção *Ingestão de dados*).

## Passo 1 — Gere sua chave de acesso pessoal

1. No menu lateral da Balde, abra **Configurações**.
2. Na aba **Minhas chaves de API**, clique em **Criar nova chave** (dê um rótulo, ex.: "MCP no notebook").
3. **Copie a chave na hora** — ela é revelada uma única vez. Guarde-a com segurança.

A chave é **pessoal** (Bearer): herda a sua visibilidade, só funciona enquanto a sua conta estiver **ativa** e no grupo de usuários da API (`Balde - Usuários`), e pode ser **revogada** por você a qualquer momento na mesma tela. A chave compartilhada antiga foi **aposentada** — a API aceita apenas chaves pessoais.

Nos passos seguintes, essa chave é o valor de **`BALDE_API_KEY`**. O endereço da Balde (`BALDE_BASE_URL`) já aponta para produção por padrão — você não precisa defini-lo.

## Conectar o Claude (MCP)

A Balde traz um **servidor MCP** (`balde-knowledge`) que aparece nativamente no **Claude Desktop**, no **Claude Code** e nos conectores do Claude.ai. Ele roda na sua máquina e fala com a `/api/v1` usando a sua chave.

**Pré-requisitos:** Node 18+ e os arquivos de integração (`integrations/ai-tools/`) na sua máquina.

**Claude Desktop** — adicione ao arquivo `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "balde-knowledge": {
      "command": "node",
      "args": ["/caminho/absoluto/para/integrations/ai-tools/mcp-server.mjs"],
      "env": {
        "BALDE_BASE_URL": "https://balde.example.com",
        "BALDE_API_KEY": "sua-chave-pessoal"
      }
    }
  }
}
```

**Claude Code** — um comando só:

```bash
claude mcp add balde-knowledge --env BALDE_API_KEY=sua-chave-pessoal -- node /caminho/absoluto/para/integrations/ai-tools/mcp-server.mjs
```

Reinicie o Claude e as treze ferramentas `balde_*` aparecem. A chave fica no `env` do cliente — **o modelo nunca a vê**. No Windows, dentro do JSON, escreva o caminho com barras duplas (ex.: `C:\\Users\\voce\\...\\mcp-server.mjs`).

## Conectar o ChatGPT (GPT personalizado)

Para o ChatGPT, a integração **é a própria especificação OpenAPI** — nenhum código deste pacote roda:

1. No **criador de GPTs** (Configure → **Actions**), clique em **Create new action**.
2. Em **Schema**, cole o conteúdo de `integrations/ai-tools/openapi.json` (o servidor já está apontado para produção).
3. Em **Authentication**, escolha **API Key**, tipo **Bearer**, e cole a **sua chave pessoal**.
4. Salve. O GPT passa a chamar a `/api/v1` da Balde diretamente — listar skills, puxar contexto e enviar contribuições.

## Arquivos anexos pela API

Skills e cápsulas podem carregar **anexos** (`files/`): PDFs, planilhas, zips — qualquer formato, até **20 MB** por arquivo. A API serve e recebe esses arquivos com a mesma chave pessoal:

| Chamada | O que faz |
|---|---|
| `GET /api/v1/skills/{id}` · `GET /api/v1/commons/{id}` | A resposta lista os anexos em `media.files[]` — nome, tamanho e a URL de download de cada um. |
| `GET /api/v1/skills/{id}/files/{nome}` | Baixa um anexo de skill. |
| `GET /api/v1/commons/{id}/files/{nome}` | Baixa um anexo de cápsula. |
| `POST /api/v1/skills/{id}/files` · `POST /api/v1/commons/{id}/files` | **Anexa** um arquivo (`{ "name": "...", "base64": "..." }`) — exige ser **curador/admin** do artefato. |

A visibilidade do artefato vale também para os anexos: numa skill ou cápsula restrita, quem não tem acesso recebe 404. Anexos são **entregáveis para download** — nunca entram no contexto da IA (para conteúdo que a IA deve ler, use o corpo e a mídia descrita).

## Segurança

A mesma chave pessoal serve para MCP, GPT Action e o add-in do Excel. Ela é **estreita por desenho**: pode **ler skills canônicas** e **enfileirar contribuições**, mas **não pode alterar uma skill** — toda contribuição espera um curador humano. Ela fica no `env`/configuração do cliente, **nunca vai para o modelo**, só funciona com a conta ativa e no grupo certo, e é revogável a qualquer momento em **Configurações → Minhas chaves de API**.

## Para desenvolvedores

Além do Claude e do ChatGPT, o mesmo pacote expõe as ferramentas para chamadas via **SDK da OpenAI** (function calling) e da **Anthropic** (Messages API, tool use). Veja `integrations/ai-tools/README.md` e `examples/smoke.mjs` no repositório para um teste de leitura rápido:

```bash
BALDE_API_KEY=sua-chave-pessoal node examples/smoke.mjs
```

## Referências

- `integrations/ai-tools/README.md` — o guia técnico completo dos quatro canais (Claude/MCP, OpenAI, Anthropic, ChatGPT).
- `integrations/ai-tools/openapi.json` — a especificação para o GPT Action do ChatGPT.
- **Skills**, **Cápsulas** e **Governança e acesso** (seção Entender o corpus) — o que essas ferramentas leem e a fila de curadoria que alimentam.
