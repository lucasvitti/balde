---
section: "Usar o conhecimento"
section_order: 2
order: 4
---

# Chat, plenárias e skills

Além de navegar o corpus, você pode **conversar** com ele. O Balde tem dois modos de conversa — o **chat** (1:1 com a IA, fundamentado nas skills) e as **plenárias** (salas multiusuário com um buddy) — mais o laço de **feedback e contribuição** que devolve conhecimento para a curadoria.

## Chat — conversar com as skills

O menu **Chat** abre uma conversa 1:1 com a IA. O que a torna diferente de um chat genérico: ela é **fundamentada nas skills** que você anexa como contexto.

- **Escolher o contexto** — anexe uma ou mais skills à conversa. A IA passa a responder **ancorada** no conteúdo delas (o `SKILL.md` + os arquivos de contexto + a mídia já virada texto).
- **Como a skill é lida** — skills pequenas entram inteiras no contexto; skills grandes são **paginadas**: a IA recebe o `SKILL.md` + um manifesto e **lê os arquivos sob demanda**, seguindo os links de que precisa (a mesma divulgação progressiva da API). No fim, a resposta mostra os **chips "Fontes"** — os arquivos de fato consultados.
- **BYO key** — a IA roda com a **sua** chave de provedor (configurada em Configurações → Provedor de IA), cifrada em repouso. O navegador nunca vê a chave.
- **Exportar** — dá para exportar a conversa em YAML.

## Buddies — a persona da conversa

Um **buddy** é um avatar com personalidade (temperamento + protocolo de humor) que dá cara à conversa. Quando você anexa skills ao chat, o buddy é escolhido assim: a **primeira skill de contexto (na ordem em que foi adicionada) que tiver um buddy resolvível** define a persona e o avatar; as outras skills continuam fundamentando a resposta, mas não trocam a persona.

Buddies são geridos no menu **AI Buddy** (biblioteca com grupos recolhíveis). Cada buddy tem um conjunto de poses; o Balde escolhe a pose conforme o estado da conversa. O tamanho do avatar sobre o chat (ou desligá-lo) é preferência sua, em **Configurações → Aparência**.

## Plenárias — conversa em grupo

Uma **plenária** é o segundo tipo de conversa: uma **sala multiusuário** com um buddy de IA, ao vivo. Serve para discutir um tema em equipe com o conhecimento do corpus à mão.

- **Entrar** — quem cria a sala recebe uma **chave de acesso** curta e compartilhável; os demais entram com essa chave. A sala é aberta a quem tem a chave (ou ao dono).
- **Falar com o buddy** — por padrão as mensagens são só entre pessoas. Para trazer a IA, marque **"Perguntar ao buddy"** no compositor, ou **mencione o buddy** (`@nome` ou o nome dele na frase). A resposta do buddy é transmitida para a **sala inteira**, ao vivo.
- **Presença e autoria** — a sala mostra quem está online; cada mensagem é atribuída ao autor (as suas à direita, as dos colegas à esquerda com o nome). O buddy enxerga o histórico com os nomes de quem falou.
- **Controles do dono** — copiar/regenerar a chave, renomear e apagar a sala; participantes podem sair.
- **Ao vivo** — a sala usa um canal de eventos (SSE); mensagens enviadas durante uma queda ou um redeploy são recuperadas ao reconectar.

## Feedback e curadoria

Toda conversa alimenta a governança do corpus:

- **Avaliar respostas** — cada resposta da IA pode ser marcada como **bom / fraco / errado**. Isso vira **feedback do curador** da(s) skill(s) em contexto (visível na aba **Feedbacks** da skill).
- **Contribuir conhecimento** — a partir do chat você pode **enviar** uma mensagem para a **fila de contribuição** de uma skill. O item é pré-processado por IA e **curado por um humano** antes de entrar no corpus. Nada vira canônico sem revisão.

Esse é o laço que fecha o Balde: as conversas não só **consomem** o conhecimento — elas geram sinais (feedback) e propostas (contribuições) que **melhoram** o conhecimento.

## Levar o Balde para o seu assistente

Você não precisa abrir a aplicação web para usar o corpus. Com a **sua chave pessoal**, dá para ligar **ChatGPT** e **Claude** direto ao Balde — o assistente passa a **puxar** skills e contexto e a **enviar** contribuições, pela mesma API de máquinas (`/api/v1`) que o RevenueHub usa. O passo a passo está em **Conectar ChatGPT e Claude** (nesta seção).

## Resumo

| Modo | Quem participa | Buddy | Quando usar |
|---|---|---|---|
| **Chat** | você + a IA | sim (da 1ª skill com buddy) | consultar e trabalhar 1:1 sobre uma ou mais skills |
| **Plenária** | várias pessoas + a IA | sim | discutir em equipe com o buddy à disposição |
| **Assistente externo** | você, no ChatGPT/Claude | — | usar o corpus sem abrir o Balde |

Para entender o que a IA lê por baixo (inline vs paginado, mídia como contexto), veja **Skills** e **Cápsulas**, na seção Entender o corpus.
