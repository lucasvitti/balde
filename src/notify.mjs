// Notifications: per-item event store + e-mail rendering (pt-BR), consumed by the n8n flows
// via /api/v1/notify/* (admin-token gated). The server renders the FINAL e-mails (subject +
// inline-styled HTML) so n8n stays a dumb pipe: fetch → send via SMTP → ack.
//
// Storage: corpusRoot/notify/events.json — o buffer de entrega é da INSTÂNCIA (um pipe de
// e-mail para todos os baldes), então não segue a fila por-balde; o corpus root é o volume
// persistente no prod. (Legado: queue/_notify-events.json — migrado no boot pelo server.)
// Events carry a recipient snapshot (`to`) taken at emit time; delivery-time filtering
// re-checks each recipient's CURRENT opt-in, so opting out stops e-mails immediately.
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { corpusRoot } from './config.mjs';

const NOTIFY_DIR = join(corpusRoot, 'notify');
const EVENTS_PATH = join(NOTIFY_DIR, 'events.json');
const MAX_EVENTS = 400; // hard cap — this is a delivery buffer, not an archive
const DELIVERED_TTL_MS = 30 * 86400000;
let chain = Promise.resolve(); // single process: serialize read-modify-writes

async function readEvents() {
  try {
    const parsed = JSON.parse(await readFile(EVENTS_PATH, 'utf8'));
    return Array.isArray(parsed.events) ? parsed.events : [];
  } catch (error) {
    return [];
  }
}
async function writeEvents(events) {
  await mkdir(NOTIFY_DIR, { recursive: true });
  await writeFile(EVENTS_PATH, `${JSON.stringify({ version: 1, events }, null, 2)}\n`, 'utf8');
}

export function notifyEventId() {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Fire-and-forget append (callers must never fail a user request over telemetry).
export function appendNotifyEvent(event) {
  chain = chain
    .then(async () => {
      const events = await readEvents();
      events.push(event);
      const cutoff = Date.now() - DELIVERED_TTL_MS;
      const kept = events
        .filter((e) => !(e.delivered && Date.parse(e.deliveredAt || e.ts || 0) < cutoff))
        .slice(-MAX_EVENTS);
      await writeEvents(kept);
    })
    .catch(() => {});
  return chain;
}

export async function listUndeliveredEvents() {
  return (await readEvents()).filter((e) => !e.delivered);
}

export function ackNotifyEvents(ids) {
  const set = new Set((Array.isArray(ids) ? ids : []).map(String));
  chain = chain
    .then(async () => {
      if (!set.size) return;
      const events = await readEvents();
      const now = new Date().toISOString();
      for (const e of events) {
        if (set.has(String(e.id))) {
          e.delivered = true;
          e.deliveredAt = now;
        }
      }
      await writeEvents(events);
    })
    .catch(() => {});
  return chain;
}

// E-mail rendering (pt-BR, inline styles, e-mail-client-safe)
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function trunc(value, n) {
  const s = String(value || '');
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function emailLayout(title, bodyHtml, baseUrl) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:0;background:#f4f5f7;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;font-family:'Segoe UI',Arial,sans-serif;color:#1f2430;">
    <div style="background:#ffffff;border:1px solid #e3e6ec;border-radius:12px;overflow:hidden;">
      <div style="background:#12151c;color:#ffffff;padding:16px 22px;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.75;">Balde de conhecimento</div>
        <div style="font-size:19px;font-weight:700;margin-top:2px;">${esc(title)}</div>
      </div>
      <div style="padding:20px 22px;font-size:14px;line-height:1.55;">${bodyHtml}</div>
      <div style="padding:14px 22px;border-top:1px solid #e3e6ec;font-size:12px;color:#6a7181;">
        <a href="${esc(baseUrl)}" style="color:#d6336c;text-decoration:none;font-weight:600;">Abrir o Balde</a>
        · Você recebe este e-mail porque ativou notificações em <strong>Configurações → Notificações</strong>. Desative lá quando quiser.
      </div>
    </div>
  </div></body></html>`;
}

function sectionHtml(heading, inner) {
  return `<div style="margin:0 0 16px;">
    <div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:#6a7181;margin-bottom:6px;">${esc(heading)}</div>
    ${inner}
  </div>`;
}
function listHtml(rows) {
  return `<ul style="margin:0;padding-left:18px;">${rows.join('')}</ul>`;
}
function li(html) {
  return `<li style="margin:2px 0;">${html}</li>`;
}
function pill(text, color) {
  return `<span style="display:inline-block;padding:1px 8px;border-radius:999px;background:${color};color:#ffffff;font-size:11px;font-weight:700;">${esc(text)}</span>`;
}

const VERDICT_COLORS = { errado: '#c92a2a', fraco: '#e8890c', bom: '#2b8a3e' };

// digest: { name, pendingContribs:[{title,skillId}], pendingCount, drafts:[{id,nome}], feedbacks:[{skillId,nome,count}],
//          feedbackTotal, usage7d:{total, top:[{skillId,count}]} }
export function buildDigestEmail(digest, baseUrl) {
  const parts = [];
  const firstName = String(digest.name || '').split(' ')[0] || 'olá';
  parts.push(`<p style="margin:0 0 14px;">Bom dia, <strong>${esc(firstName)}</strong> — o resumo do seu Balde:</p>`);
  if (digest.pendingCount > 0) {
    const rows = digest.pendingContribs.map((c) =>
      li(`${esc(trunc(c.title, 70))} <code style="font-size:12px;color:#6a7181;">${esc(c.skillId)}</code>`)
    );
    if (digest.pendingCount > digest.pendingContribs.length)
      rows.push(li(`<em>… e mais ${digest.pendingCount - digest.pendingContribs.length}</em>`));
    parts.push(sectionHtml(`Fila — ${digest.pendingCount} contribuição(ões) pendente(s)`, listHtml(rows)));
  }
  if (digest.drafts.length > 0) {
    parts.push(
      sectionHtml(
        `Aprovações — ${digest.drafts.length} rascunho(s) aguardando promoção`,
        listHtml(
          digest.drafts
            .slice(0, 5)
            .map((d) => li(`${esc(d.nome)} <code style="font-size:12px;color:#6a7181;">${esc(d.id)}</code>`))
        )
      )
    );
  }
  if (digest.feedbackTotal > 0) {
    parts.push(
      sectionHtml(
        `Feedbacks pendentes — ${digest.feedbackTotal}`,
        listHtml(
          digest.feedbacks
            .slice(0, 5)
            .map((f) => li(`<strong>${esc(f.nome)}</strong>: ${f.count} feedback(s) a revisar`))
        )
      )
    );
  }
  if (digest.usage7d && digest.usage7d.total > 0) {
    const top = (digest.usage7d.top || []).map((t) =>
      li(`<code style="font-size:12px;">${esc(t.skillId)}</code> — ${t.count} uso(s)`)
    );
    parts.push(
      sectionHtml(
        `Uso das suas skills — ${digest.usage7d.total} uso(s) nos últimos 7 dias`,
        top.length ? listHtml(top) : ''
      )
    );
  }
  const pendings = (digest.pendingCount || 0) + digest.drafts.length + (digest.feedbackTotal || 0);
  const subject =
    pendings > 0 ? `Balde — ${pendings} pendência(s) esperando por você` : 'Balde — resumo diário das suas skills';
  return { subject, html: emailLayout('Resumo diário', parts.join(''), baseUrl) };
}

// Deprecation warning: MANDATORY (sent regardless of notify prefs) — a steward must know their
// artifact went stale. One e-mail per steward, listing every deprecated skill/expired capsule
// they answer for; idempotent state-of-the-world summary (no ack — n8n sends on its schedule).
export function buildDeprecationEmail(name, items, baseUrl) {
  const firstName = String(name || '').split(' ')[0] || 'olá';
  const blocks = items
    .map(
      (it) => `
    <div style="border:1px solid #f1c8c8;border-left:4px solid #c92a2a;border-radius:10px;padding:12px 14px;margin:0 0 10px;background:#fff8f8;">
      <div style="margin-bottom:4px;">${pill(it.kind === 'capsule' ? 'Cápsula vencida' : 'Skill depreciada', '#c92a2a')} <strong style="margin-left:6px;">${esc(it.label)}</strong> <code style="font-size:12px;color:#6a7181;">${esc(it.id)}</code></div>
      ${(it.reasons || []).length ? `<ul style="margin:4px 0 0;padding-left:18px;font-size:13px;color:#3d4453;">${it.reasons.map((r) => li(esc(r))).join('')}</ul>` : ''}
    </div>`
    )
    .join('');
  const body = `<p style="margin:0 0 10px;">Olá, <strong>${esc(firstName)}</strong> — artefatos sob sua curadoria estão <strong>depreciados</strong> e precisam de revisão:</p>
    ${blocks}
    <p style="margin:8px 0 0;font-size:13px;">Revise o conteúdo e marque como revisado (skills: aba Curadoria · cápsulas: página Cápsulas). Enquanto isso, o Balde avisa quem consumir esses artefatos que o conteúdo pode estar desatualizado.</p>
    <p style="margin:8px 0 0;font-size:12px;color:#6a7181;">Este aviso é obrigatório — ele não segue as preferências de notificação.</p>`;
  const subject =
    items.length === 1
      ? `Balde — ${items[0].kind === 'capsule' ? 'cápsula vencida' : 'skill depreciada'}: ${items[0].label}`
      : `Balde — ${items.length} artefato(s) depreciado(s) sob sua curadoria`;
  return { subject, html: emailLayout('Depreciação — ação necessária', body, baseUrl) };
}

// events (one e-mail per recipient, all their pending events batched)
export function buildEventsEmail(name, events, baseUrl) {
  const firstName = String(name || '').split(' ')[0] || 'olá';
  const blocks = events
    .map((ev) => {
      if (ev.type === 'feedback') {
        const color = VERDICT_COLORS[ev.verdict] || '#6a7181';
        return `<div style="border:1px solid #e3e6ec;border-radius:10px;padding:12px 14px;margin:0 0 10px;">
        <div style="margin-bottom:6px;">${pill(`Feedback ${esc(ev.verdict)}`, color)} <strong style="margin-left:6px;">${esc(ev.skillName || ev.skillId)}</strong></div>
        <div style="font-size:13px;color:#3d4453;">por <strong>${esc(ev.actorName || ev.actorEmail || 'usuário')}</strong>${ev.actorEmail && ev.actorName ? ` (${esc(ev.actorEmail)})` : ''}</div>
        ${ev.question ? `<div style="font-size:13px;margin-top:6px;"><span style="color:#6a7181;">Pergunta:</span> ${esc(trunc(ev.question, 180))}</div>` : ''}
        ${ev.answer ? `<div style="font-size:13px;margin-top:2px;"><span style="color:#6a7181;">Resposta marcada:</span> ${esc(trunc(ev.answer, 180))}</div>` : ''}
      </div>`;
      }
      if (ev.type === 'contribution') {
        return `<div style="border:1px solid #e3e6ec;border-radius:10px;padding:12px 14px;margin:0 0 10px;">
        <div style="margin-bottom:6px;">${pill('Nova contribuição', '#1864ab')} <strong style="margin-left:6px;">${esc(ev.skillName || ev.skillId)}</strong></div>
        <div style="font-size:13px;color:#3d4453;">de <strong>${esc(ev.actorName || ev.actorEmail || 'anônimo')}</strong> · via ${esc(ev.source || 'web')}</div>
        <div style="font-size:13px;margin-top:6px;">${esc(trunc(ev.title || '', 120))}</div>
      </div>`;
      }
      return '';
    })
    .join('');
  const body = `<p style="margin:0 0 14px;">Olá, <strong>${esc(firstName)}</strong> — atividade nova nas skills que você cuida:</p>${blocks}
    <p style="margin:6px 0 0;font-size:13px;">Revise na <strong>Fila</strong> do Balde.</p>`;
  const subject =
    events.length === 1
      ? events[0].type === 'feedback'
        ? `Balde — feedback ${events[0].verdict} em ${events[0].skillName || events[0].skillId}`
        : `Balde — nova contribuição em ${events[0].skillName || events[0].skillId}`
      : `Balde — ${events.length} novidades nas suas skills`;
  return { subject, html: emailLayout('Atividade nas suas skills', body, baseUrl) };
}
