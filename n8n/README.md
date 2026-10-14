# Notificações por e-mail via n8n

Dois workflows para o n8n (cloud) que entregam as notificações do Balde por e-mail. O servidor
faz todo o trabalho pesado — **monta os e-mails prontos (assunto + HTML, pt-BR)** e controla o
que já foi entregue; o n8n só busca, envia via SMTP e confirma.

| Workflow | Arquivo | Gatilho | O que faz |
|---|---|---|---|
| Balde — Digest diário | `balde-digest-diario.json` | todo dia 08:00 (America/Sao_Paulo) | `GET /api/v1/notify/digest` → um e-mail por usuário opt-in com pendências (fila, rascunhos, feedbacks) + uso 7d. Dias sem novidade não geram e-mail. |
| Balde — Notificações por item | `balde-notificacoes-por-item.json` | a cada 30 min | `GET /api/v1/notify/events` → um e-mail por destinatário agrupando os eventos novos (feedback Errado/Fraco, nova contribuição) → `POST /api/v1/notify/ack` marca como entregue. |
| Balde — Avisos de depreciação | `balde-avisos-depreciacao.json` | toda segunda 08:30 | `GET /api/v1/notify/deprecation` → um e-mail por curador listando skills depreciadas e cápsulas vencidas sob sua responsabilidade. **Obrigatório** — ignora as preferências de notificação (o curador precisa saber). Resumo idempotente do estado atual; sem ack. |

O usuário controla o que recebe em **Configurações → Notificações** (**ativadas por padrão**;
desmarcar desliga). Quem desativa para de receber imediatamente — o filtro é aplicado na hora
do envio.

## Setup (uma vez)

1. **Token do Balde**: no Balde, como admin, vá em **Configurações → Minhas chaves de API** e
   crie um token pessoal. Os endpoints `/api/v1/notify/*` só aceitam token de usuário do grupo
   **Balde - Admins** (eles expõem e-mails e pendências de todos).
2. **Credencial Header Auth** no n8n: *Credentials → New → Header Auth*, nome
   `Balde API (Header Auth)`:
   - Name: `Authorization`
   - Value: `Bearer <seu token>`
3. **Credencial SMTP**: use a sua já configurada do Gmail; o import referencia o nome
   `SMTP Gmail` — se a sua tem outro nome, é só reapontar no nó "Enviar e-mail".
4. **Importar**: *Workflows → Import from file* com cada JSON desta pasta.
5. Em cada workflow, abra o nó **Enviar e-mail** e troque `SEU_EMAIL@gmail.com` pelo remetente
   real (o mesmo e-mail da credencial SMTP do Gmail).
6. Rode uma vez manualmente (*Execute workflow*) para validar, depois **Activate** os dois.

## Confiabilidade

- **Entrega**: o ack só acontece depois do nó de e-mail; se o envio falhar, os eventos ficam
  pendentes e o próximo ciclo tenta de novo (na pior hipótese um destinatário recebe repetido —
  nunca silenciosamente perdido).
- **Execuções n8n**: ~48/dia do polling de 30 min + 1/dia do digest (≈1,5k/mês). Se o seu plano
  tiver folga e você quiser latência menor, baixe o intervalo no gatilho.
- **Eventos**: ficam em `queue/_notify-events.json` (volume persistente), com snapshot dos
  destinatários no momento do evento; eventos sem nenhum opt-in são auto-baixados.
