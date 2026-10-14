---
section: "Entender o corpus"
section_order: 1
order: 5
---

# Avaliação e promoção

Como o Balde decide que um conhecimento está **bom o suficiente para valer oficialmente**. Esta página desce fundo na avaliação — o checklist obrigatório, os casos de uso, a rodada de IA, o aceite humano — e no portão que ela guarda: a promoção de **Blueprint** a **Canônica**.

## A ideia em um parágrafo

Toda skill e toda cápsula carregam **uma avaliação**: uma lista de itens verificáveis. Parte dos itens é **obrigatória** (o checklist definido pelos admins — vale para todo artefato); parte é **sua** (os casos de uso daquele artefato). Cada item é julgado em **dois passos**: a **IA** dá um veredito (aprovado/reprovado, com evidência) e um **humano** aceita ou rejeita. Uma skill só é publicada quando o portão passa. Máquina verifica, gente decide.

## Os dois tipos de item

**1. Obrigatórios — o checklist da casa.** Definidos pelos admins em **Administração › Checklist de qualidade**, aplicam-se a **todo** artefato (há itens para skills, para cápsulas, ou ambos). São o piso de qualidade — por padrão, coisas como:

- Descreve claramente o que é e para que serve.
- Declara o que faz e o que **não** faz / quando recusar.
- Não inventa números; recusa sem base; aponta as fontes.
- Conteúdo consistente em pt-BR.
- Sem credenciais ou dados sensíveis.
- Owner, versão e carimbo de revisão declarados.

Cada item do checklist tem um **modo**: **trava (gate)** — precisa passar para promover — ou **pontua o Selo** — influencia a nota de qualidade, mas não bloqueia. Você os vê em qualquer artefato na seção **Obrigatórios**; eles não são editáveis por artefato (a definição é global).

**2. Casos de uso — os testes daquele artefato.** O que **você** adiciona para verificar o comportamento específico: "resume em até 5 bullets", "recusa perguntas fora do escopo", "cita a fonte do número". Casos de uso **pontuam o Selo** — não travam a promoção. São eles que transformam a avaliação genérica numa verificação do seu caso real.

## Como criar um caso de uso

Nos assistentes de criação/edição (etapa **Avaliação**) ou em **Editar skill** — a aba Evals do explorador é somente leitura. Um caso de uso tem:

| Campo | Função |
|---|---|
| **Título** | O que o caso verifica — vira o nome do item. |
| **Prompt da IA** | A instrução de verificação (se vazio, a IA usa o título/pergunta). |
| **Rubrica** (opcional) | Uma lista de opções de resposta: a IA marca as aplicáveis; você define quais **exigir** (✓) e quais **proibir** (⊘), e o critério de aceite — exigir **todas** as ✓ ou **qualquer** ✓. Sem opções, a IA decide aprovado/reprovado direto. |
| **Caso de teste** (opcional) | Uma **pergunta** + a **resposta esperada** — a IA compara o comportamento do artefato com o esperado. Marque **é um caso de recusa** quando o correto é a skill se negar a responder. |

Sem inspiração? O botão **✨ Sugerir com IA** rascunha casos a partir do próprio conteúdo do artefato — revise e ajuste antes de salvar.

> Bons casos de uso são **objetivos e verificáveis**: "a resposta cita a fonte" se verifica; "a resposta é boa" não. Inclua sempre ao menos um **caso de recusa** — o comportamento fora do escopo é onde as skills mais erram.

## Como rodar a avaliação

![A aba Evals de uma skill: o checklist obrigatório com os vereditos pendentes, os botões de aceitar/rejeitar por item e o botão Rodar avaliação](assets/doc-skill-evals.png)

Na aba **Evals** (skill) ou **Avaliação** (cápsula):

1. **Rodar avaliação** — a IA julga todos os itens de uma vez (usa a **sua** chave de IA, de Configurações › Provedor de IA). Cada item recebe o veredito **aprovado/reprovado** e uma **evidência** — o trecho que justifica.
2. **Aceite humano** — para cada item, **✓ aceitar** ou **✕ rejeitar**. Aceitações já feitas são preservadas quando você roda de novo.
3. O resultado geral deriva sozinho: **aprovado** quando todos os itens passam; **reprovado** se algum falha ou foi rejeitado; **pendente** no meio do caminho.

Duas nuances que valem saber:

- **Aceite forçado**: um item que a IA reprovou pode ser aceito por um curador — destrava o portão, mas **reduz o Selo** (fica registrado que passou "no braço").
- **Rejeição humana manda**: um item rejeitado por um curador bloqueia, mesmo que a IA tenha aprovado.

## O portão — Blueprint → Canônica

Toda skill nasce **Blueprint**: utilizável para construir e testar, mas **fora da API e do consumo oficial**. Para publicar:

1. Abra a skill no corpus, aba **Evals**.
2. Clique **Promover para Canônico** — o Balde roda a avaliação e confere o portão.
3. **O portão**: cada item obrigatório em modo **trava (gate)** precisa estar **aprovado pela IA ou aceito por um curador**. Itens "pontua" e casos de uso não travam — contam para o Selo.
4. Passou → a skill vira **Canônica**: entra na API, no chat e nos consumidores externos. Não passou → a promoção é bloqueada com a lista do que falta; corrija e rode de novo.

A publicação é versionada: a versão anterior vai para o arquivo (**legado**) com possibilidade de rollback, a nova assume, e o número de versão incrementa. Só o que é Canônico aparece para consumidores — rascunhos nunca vazam.

**E as cápsulas?** Cápsulas não têm ciclo Blueprint/Canônica — nascem publicadas. A avaliação delas existe como **selo de qualidade** (ok · falhou · pendente · sem eval, visível na página Cápsulas e no detalhe), não como portão. Rode pelo botão **Eval** da tabela ou **Rodar eval (IA)** no detalhe.

## O Selo de qualidade

Além do portão (passa/não passa), cada skill tem um **Selo 0–100** — a régua fina da qualidade. A composição aparece na aba **Governança**: cobertura de **casos de uso**, **validação** (o resultado da avaliação), **governança** (owner, escopo, metadados), **clareza** e **frescor** — com desconto por **aceites forçados**. O portão decide *se* publica; o Selo mostra *quão bem* está.

## Onde cada coisa acontece — resumo

| Ação | Onde |
|---|---|
| Definir o checklist obrigatório | Administração › Checklist de qualidade (admins) |
| Criar/editar casos de uso | Assistente Criar/Editar (etapa Avaliação) |
| Rodar avaliação + aceitar itens | Aba Evals (skill) / Avaliação (cápsula) |
| Promover a Canônica | Aba Evals → Promover para Canônico |
| Ver o Selo e a composição | Aba Governança da skill |

## Para seguir

- **Governança e acesso** — quem pode avaliar, aceitar e promover.
- **Criação manual — Skills** — a etapa Avaliação dentro do assistente, campo a campo.
