# Baldes (repos) — partições independentes do corpus

O corpus do Balde é organizado num **namespace de três níveis**, no estilo dos catálogos do
Databricks/Unity Catalog:

```
balde (repo)  /  domínio  /  artefato (skill ou cápsula)
```

Um **balde** é uma partição completamente independente: tem seus próprios domínios, skills,
cápsulas, vocabulário de domínios (`_domains.json`) e — o mais importante — seus **próprios
ledgers git** (`skills/.git` + `commons/.git`). Histórico, backup e propriedade nunca se
misturam entre baldes. O balde padrão é o **`corporate`** ("Corporativo"): todo o corpus
existente vive nele e nada muda para quem só usa esse.

## Trocar de balde

Quando você é membro de mais de um balde, aparece um **seletor na barra superior** (ao lado
do seu nome). Trocar salva a preferência na sua conta e recarrega o app — Corpus, Fila, Mapa,
chat e criação passam a operar no balde escolhido. Cada requisição também aceita o header
`X-Balde-Repo` (uso avançado/máquina).

## Quem vê o quê (membros)

Cada balde declara membros por **grupos do Authentik** e/ou por **e-mails**:

| Configuração | Quem acessa |
|---|---|
| grupos vazios **e** membros vazios | todos os usuários autenticados (ex.: `corporate`) |
| grupos preenchidos | quem está em pelo menos um dos grupos |
| membros preenchidos | os e-mails listados |
| ambos | quem casar com **qualquer um** dos dois |

Admins são membros de todos os baldes. Quem não é membro **não vê** o balde — nem na lista,
nem por header (404 honesto). Dentro do balde, as visibilidades de skill e cápsula
(`ACCESS.yml`) continuam valendo normalmente — o balde é o portão de fora, não substitui as
ACLs de dentro.

## Meu Balde (espaço pessoal)

Em **Configurações → Meu Balde**, qualquer usuário cria com um clique o seu balde pessoal
(`pessoal-<usuário>`): privado (membros = você), com **governança leve** e ledgers próprios.
Use-o como área de rascunho e notas — o caminho natural é maturar conhecimento no seu balde
e promover ao corporativo quando estiver pronto.

> Governança **leve** hoje é informativa (aparece no admin e na API); a aprovação direta sem
> Fila para baldes leves está no roadmap.

## Referências entre baldes

Uma skill pode referenciar conhecimento de OUTRO balde com um link qualificado:

```
[Glossário](/@corporate/commons/vendas/glossario)
```

Regras:

- **Referência ≠ concessão.** O conteúdo só flui se o LEITOR for membro do balde alvo **e**
  passar na ACL do artefato — senão o link existe mas resolve para nada (stub honesto).
- No chat, cápsulas `/@repo/commons/...` referenciadas pela skill são **inlinadas** no
  grounding (mesma regra de leitura). Nos grafos, arestas entre baldes aparecem
  **pontilhadas** (sólida = cápsula, tracejada = skill→skill, pontilhada = cruza balde).
- Cápsulas continuam **atômicas** em qualquer balde: nunca têm links de saída.
- Séries (Linha do tempo) não expandem entre baldes — um episódio referenciado inlina
  sozinho.

## Máquinas (API v1 / MCP / GPT)

Toda chamada `/api/v1` opera num balde: escolha com o header `X-Balde-Repo` ou o parâmetro
`?repo=` (padrão `corporate`; membership verificada contra o dono do token). `GET
/api/v1/repos` lista os seus. Nas integrações (`integrations/ai-tools`), defina `BALDE_REPO`
no `env` — a ferramenta `balde_list_repos` mostra ao agente quais existem.

## Administração

**Administração → Baldes**: criar (nome-slug permanente, título, grupos, membros, perfil de
governança) e editar. O nome nunca muda depois de criado — ele é o namespace. Arquivar/apagar
não existe de propósito: ledgers são história.
