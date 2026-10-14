---
section: "Usar o conhecimento"
section_order: 2
order: 1
---

# Mapa de conhecimento

O menu **Grafo** abre o **Mapa de conhecimento**: o corpus inteiro desenhado como uma rede — cada skill e cada cápsula é um nó, cada referência é uma seta. É a visão de helicóptero: onde o conhecimento se concentra, o que conecta o quê, o que está órfão e o que está vencido.

![O Mapa de conhecimento: skills e cápsulas como nós, referências como setas, e a barra de controles no topo](assets/doc-mapa-conhecimento.png)

## O que você está vendo

- **Nós** — skills (elipses) e cápsulas (retângulos arredondados).
- **Setas** — as referências: skill → cápsula e skill → skill. Quanto mais grossa a seta, mais links entre os dois nós.
- **A régua no topo** resume: `N skills · N cápsulas · N conexões`.

## Os controles

Quatro seletores mudam a leitura do mapa:

| Controle | Opções | Para quê |
|---|---|---|
| **Arranjo** | Força · Concêntrico · Círculo · Grade · Árvore | O desenho da rede. **Força** (padrão) aproxima o que se conecta; **Árvore** ajuda a ver hierarquias; **Grade** organiza para varrer com os olhos. |
| **Cor** | Domínio · Tipo · Comunidade · Status · Frescor | O que a cor codifica. **Domínio** pinta por área; **Frescor** transforma o mapa num raio-X de governança (o vencido salta aos olhos); **Status** separa Blueprint de Canônica; **Comunidade** usa agrupamentos detectados automaticamente pela estrutura de conexões. |
| **Tamanho** | Aberturas · Execuções · Referências recebidas · Referências feitas · Uniforme | O que o tamanho do nó representa. **Aberturas/Execuções** mostram uso real (últimos meses); **Referências recebidas** revela os hubs — os conceitos de que todo mundo depende. |
| **Agrupar** | não agrupar · por domínio · por comunidade | Desenha contornos ao redor dos grupos — o mapa vira um mapa de territórios. |

E os filtros da barra:

- **Domínio: todos ▾** — restringe o mapa a um ou mais domínios.
- **ocultar cápsulas** — só as skills e suas relações.
- **ocultar órfãos** — esconde nós sem nenhuma conexão.
- **localizar nó…** — busca e centraliza um nó pelo nome.
- **Atualizar** — reconstrói o mapa com o estado mais recente do corpus.

## Interagindo

- **Passe o mouse** sobre um nó: a vizinhança dele acende, o resto esmaece.
- **Clique** num nó: abre o cartão lateral com os fatos — tipo, domínio, status, selo, frescor, aberturas e execuções recentes, referências feitas e recebidas.
- No cartão, **Focar 1 salto / 2 saltos** isola o nó e sua vizinhança (o chip `Foco: … · N salto(s)` no topo desfaz). **Duplo clique** no nó faz o mesmo atalho.
- **Abrir no corpus** salta do mapa para a página do artefato, com todas as abas.

## O painel Estilo

O botão **Estilo** abre os ajustes finos: presets prontos (**Padrão**, **Obsidian**, **Heatmap de governança**, **Mapa de domínios**), tamanho base dos nós, escala da métrica, opacidade e espessura das setas, quando mostrar os rótulos (ao aproximar · sempre · nunca) e o número de links nas setas. Tudo é salvo automaticamente no seu perfil — o mapa abre do seu jeito.

## Três leituras que valem fazer

1. **Raio-X de governança** — Cor: Frescor + Tamanho: Referências recebidas. Um hub vencido (nó grande, cor de atraso) é a sua prioridade de curadoria: muita coisa depende de algo desatualizado.
2. **Mapa de territórios** — Cor: Domínio + Agrupar: por domínio. Mostra o equilíbrio do corpus e as pontes entre áreas.
3. **O que importa de verdade** — Tamanho: Execuções, ocultar órfãos. O conhecimento que o time realmente usa, sem o ruído.

## O mapa dentro do Corpus

Há um segundo mapa, mais compacto, dentro de **Corpus**: o botão **Mapa do corpus** troca o painel de leitura por uma visão de vizinhanças — as skills e o conjunto das cápsulas, com o tamanho proporcional ao número de conceitos. Clique numa skill para abri-la; o botão **Ver conteúdo** volta à leitura. É o atalho de orientação sem sair da navegação.

## Para seguir

- **Como explorar o corpus** — a navegação detalhada, aba por aba.
- **Governança e acesso** — o que os sinais de frescor e status significam.
