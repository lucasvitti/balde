---
section: "Usar o conhecimento"
section_order: 2
order: 3
---

# Configurações e preferências

O que dá para ajustar na **sua** conta — o provedor de IA, as chaves de acesso, o tema, o comportamento do buddy — e, para admins, onde ficam os controles da plataforma.

## Configurações → Provedor de IA

O Balde funciona no modelo **BYO key** ("traga sua chave"): a IA do chat, das avaliações e do processamento de mídia roda com a **sua** chave de provedor, não com uma chave coletiva. Configure uma vez:

1. **Provedor** — OpenAI (GPT), Anthropic (Claude) ou um endpoint OpenAI-compatível (com Base URL própria).
2. **Modelo** — o modelo a usar (há um padrão sensato por provedor).
3. **Chave de API** — cole a sua. **Testar chave** confirma a conexão; **Salvar** guarda.

A chave é **cifrada em repouso no servidor** e nunca chega ao navegador — depois de salva, a tela mostra apenas "definida ••••". Sem chave configurada, o chat e os recursos de IA avisam e não rodam.

Abaixo do formulário há um **cartão de diagnóstico** — app, sessão, configuração de IA, conexão servidor→provedor — com um botão **Copiar relatório** para colar no suporte quando algo não funcionar.

## Configurações → Minhas chaves de API

As chaves **pessoais de máquina** — o que o ChatGPT, o Claude (MCP) e o add-in do Excel usam para falar com o Balde em seu nome:

- **Criar nova chave** gera uma chave revelada **uma única vez** — copie na hora (dá para adicionar um rótulo, ex.: "MCP no notebook").
- A chave herda a **sua** visibilidade (enxerga o que você enxerga), só funciona com a sua conta ativa, e pode ser **revogada** a qualquer momento nesta tela.

O passo a passo de uso está em **Conectar ChatGPT e Claude**.

## Configurações → Aparência

- **Tema** — Claro, Escuro ou Sistema (segue o seu sistema operacional). Fica salvo no seu perfil e vale em qualquer dispositivo.
- **Buddy do chat** — o tamanho do avatar que aparece sobre o chat: Pequeno, Médio, Grande — ou **Desligado**, para não exibir.

## AI Buddy — a biblioteca de avatares

O menu **AI Buddy** guarda os personagens que dão cara às conversas (veja o papel deles em **Chat, plenárias e skills**). A biblioteca lista os buddies em grupos recolhíveis; cada um tem seu conjunto de poses, e o detalhe mostra o **temperamento**, as skills que o usam e o histórico.

Quem gerencia um buddy pode **Editar**:

| Campo | O que faz |
|---|---|
| **Nome / Descrição** | Identificação na biblioteca. |
| **Temperamento (regular)** | O tom de conversa do buddy — humor, jeito, estilo. É persona: **não altera** a execução das skills. |
| **Temperamento por tema** | Um tom alternativo quando um tema sazonal está ativo. |
| **Grupo** | O agrupamento na biblioteca (ex.: Comercial, RH). |
| **Tema deste buddy** | Seguir o tema global, ficar fixo no regular, ou fixar um tema. |
| **Pose padrão** | A pose exibida quando não há emoção específica. |

Para **criar** um buddy novo (gerar as poses com IA a partir de uma foto), siga a trilha **AI Buddies** desta documentação — o processo, o prompt e os exemplos estão lá.

## Administração (só admins)

O menu **Administração** concentra os controles da plataforma:

| Aba | O que controla |
|---|---|
| **API** | As APIs expostas da plataforma e o painel de uso. |
| **Prompts do sistema** | Os prompts internos que a IA usa (análise, sugestões, descrições de mídia) — editáveis. |
| **Domínios** | O **vocabulário governado** de domínios que organiza skills e cápsulas. É aqui que se adiciona uma área nova. |
| **Grupos** | Os grupos de acesso reutilizáveis (veja **Governança e acesso**). |
| **Checklist de qualidade** | Os itens obrigatórios da avaliação — o que trava a promoção e o que pontua o Selo (veja **Avaliação e promoção**). |
| **Pontuação** | Os pesos do Selo de qualidade. |

## Para seguir

- **Conectar ChatGPT e Claude** — usar as suas chaves de API na prática.
- **Chat, plenárias e skills** — onde o provedor de IA e o buddy entram em cena.
