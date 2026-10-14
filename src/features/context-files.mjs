import { TEXT_CONTEXT_EXTS, CONTEXT_FILE_MAX_BYTES } from '../policy/chat-policy.mjs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomBytes } from 'node:crypto';
import { skillsRoot, plenariasRoot, commonsRoot, BUDDY_POSES } from '../config.mjs';
import { pathExists } from '../fs-utils.mjs';

export function createContextFilesFeature({
  loadSkillConsumerContext,
  userChatsDir,
  QUEUE_MAX_FILES,
  decodeQueueFile,
  QUEUE_MAX_TOTAL_FILE_BYTES,
  loadSkillsFromDisk,
  resolveCorpusNodeFull,
  listAssetFiles,
  canReadSkillActor,
  sendJson,
  mediaMimeFor,
  commonsConceptOfPath,
  canReadCommonsActor,
  isGovernancePath
}) {
  const ATTACH_IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|bmp)$/i;
  function isImageMime(mime) {
    return ATTACH_IMAGE_MIME.test(String(mime || ''));
  }
  // Types a browser renders in a tab, so a corpus/skill file can be VIEWED instead of only
  // downloaded (?inline=1). Anything else always goes out as an attachment.
  const INLINE_VIEW_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.pdf']);
  function canInlineView(name) {
    return INLINE_VIEW_EXTS.has(extname(String(name || '')).toLowerCase());
  }
  function newAttachmentId() {
    return `f-${randomBytes(6).toString('hex')}`;
  }

  // Where a conversation's uploaded files live (sibling of the room/chat record).
  function chatFilesDir(actor, chatId) {
    const dir = userChatsDir(actor);
    return dir ? join(dir, `${chatId}-files`) : null;
  }
  function plenariaFilesDir(id) {
    return join(plenariasRoot, `${id}-files`);
  }

  // Decode + store one message's attachments into `dir`; returns the metadata to
  // embed in the message. `decodeQueueFile` enforces a safe name + the 15 MB cap.
  async function storeMessageAttachments(dir, attachments) {
    const incoming = Array.isArray(attachments) ? attachments : [];
    if (!incoming.length) {
      return [];
    }
    if (!dir) {
      throw new Error('Destino de anexo indisponível.');
    }
    if (incoming.length > QUEUE_MAX_FILES) {
      throw new Error(`Máximo ${QUEUE_MAX_FILES} anexos por mensagem.`);
    }
    await mkdir(dir, { recursive: true });
    const metas = [];
    let total = 0;
    for (const file of incoming) {
      const { name, mime, buf } = decodeQueueFile(file);
      total += buf.length;
      if (total > QUEUE_MAX_TOTAL_FILE_BYTES) {
        throw new Error(`Total de anexos excede ${Math.round(QUEUE_MAX_TOTAL_FILE_BYTES / (1024 * 1024))} MB.`);
      }
      const id = newAttachmentId();
      await writeFile(join(dir, `${id}__${name}`), buf);
      metas.push({ id, name, mime, size: buf.length });
    }
    return metas;
  }

  // Locate a stored attachment's bytes by id within `dir` (id is the safe prefix).
  async function findMessageAttachment(dir, fileId) {
    if (!dir || !/^f-[a-f0-9]+$/.test(String(fileId || ''))) {
      return null;
    }
    if (!(await pathExists(dir))) {
      return null;
    }
    for (const entry of await readdir(dir)) {
      if (entry.startsWith(`${fileId}__`)) {
        return { full: join(dir, entry) };
      }
    }
    return null;
  }

  // The attachment's metadata (name + mime) as recorded in the conversation JSON.
  function findAttachmentMeta(messages, fileId) {
    for (const m of messages || []) {
      for (const a of m.attachments || []) {
        if (a.id === fileId) {
          return a;
        }
      }
    }
    return null;
  }

  // Best-effort removal of a conversation's whole files folder (on delete).
  async function removeConversationFiles(dir) {
    try {
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    } catch (error) {
      /* ignore */
    }
  }

  // Enumerate a skill's downloadable files: everything under its context/ folder
  // (recursively) plus SKILL.md. Returns resolved absolute paths so downloads only
  // ever serve files we listed here — no raw path handling, no traversal surface.
  // A skill's downloadable files = its ACTUAL context files (text + binaries/images),
  // exactly as the buddy sees them via discoverSkillContextFiles / list_context — files
  // live in arbitrary subfolders (analytics/…, references/…) listed in context-index.json,
  // NOT a fixed context/img/data layout. `rel` is skill-relative; full is resolved the same
  // way read_context resolves (draft-aware for text; resolveCorpusNodeFull otherwise).
  async function listSkillFiles(skillId) {
    const all = await loadSkillsFromDisk();
    const skill = all.find((s) => s.id === skillId);
    if (!skill) {
      return [];
    }
    let discovered = { textFiles: [], skipped: [] };
    try {
      discovered = await discoverSkillContextFiles(skill);
    } catch (error) {
      discovered = { textFiles: [], skipped: [] };
    }
    const out = [];
    const seen = new Set();
    const push = (rel, size, full) => {
      if (rel && full && !seen.has(rel)) {
        seen.add(rel);
        out.push({ path: rel, size: size || 0, full });
      }
    };
    for (const f of discovered.textFiles) {
      push(f.rel, f.bytes, f.full || (await resolveCorpusNodeFull(`${skillId}/${f.rel}`)));
    }
    for (const f of discovered.skipped || []) {
      push(f.rel, f.bytes, await resolveCorpusNodeFull(`${skillId}/${f.rel}`));
    }
    // SKILL.md (the spine), if present on disk.
    const mdFull = await resolveCorpusNodeFull(`${skillId}/SKILL.md`);
    if (mdFull && (await pathExists(mdFull))) {
      let sz = 0;
      try {
        sz = (await stat(mdFull)).size;
      } catch (error) {
        sz = 0;
      }
      push('SKILL.md', sz, mdFull);
    }
    // Downloadable file-assets (the files/ sidecar — PDFs, planilhas, zips). Deliberately
    // OUTSIDE context discovery (files/ is in CONTEXT_EXCLUDE_SEGMENTS, so their bytes never
    // enter a prompt), but they ARE offerable: list them so the chat can view/download them.
    const filesDir = join((await loadSkillConsumerContext(skillId)).sourceDir, 'files');
    for (const name of await listAssetFiles(filesDir)) {
      let sz = 0;
      try {
        sz = (await stat(join(filesDir, name))).size;
      } catch (error) {
        sz = 0;
      }
      push(`files/${name}`, sz, join(filesDir, name));
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  // Group the context skills' files by skill — but ONLY skills the actor may read.
  async function conversationSkillFiles(skillIds, actor) {
    const ids = Array.isArray(skillIds) ? skillIds : [];
    if (!ids.length) {
      return [];
    }
    const all = await loadSkillsFromDisk();
    const out = [];
    for (const sid of ids) {
      if (!(await canReadSkillActor(sid, actor))) {
        continue;
      }
      const skill = all.find((s) => s.id === sid);
      if (!skill) {
        continue;
      }
      const files = await listSkillFiles(sid);
      out.push({
        skillId: sid,
        skillName: skill.nome || sid,
        files: files.map((f) => ({
          path: f.path,
          size: f.size,
          image: /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.path),
          viewable: canInlineView(f.path), // images + PDFs open in a tab; others download
          asset: f.path.startsWith('files/') // the files/ sidecar (anexo), not a context file
        }))
      });
    }
    return out;
  }

  // Serve bytes for download (attachment) or inline (?inline=1, for in-bubble images).
  async function serveFileBytes(res, full, name, mime, inline) {
    const buf = await readFile(full);
    const safe = String(name || 'arquivo').replace(/[^\w.\- ]+/g, '_');
    res.writeHead(200, {
      'content-type': mime || 'application/octet-stream',
      'content-disposition': inline ? 'inline' : `attachment; filename="${safe}"`,
      'cache-control': 'no-store'
    });
    res.end(buf);
  }

  // Serve one context-skill file for a conversation. Gates: the skill must be in
  // THIS conversation's context, the actor must be allowed to read it, and the
  // requested path must be one listSkillFiles() enumerated (no raw path handling).
  async function serveContextSkillFile(res, url, actor, contextSkillIds) {
    const sid = String(url.searchParams.get('skill') || '');
    const path = String(url.searchParams.get('path') || '');
    if (!(Array.isArray(contextSkillIds) && contextSkillIds.includes(sid))) {
      sendJson(res, 403, { ok: false, error: 'Skill fora do contexto desta conversa.' });
      return;
    }
    if (!(await canReadSkillActor(sid, actor))) {
      sendJson(res, 403, { ok: false, error: 'Sem acesso aos arquivos desta skill.' });
      return;
    }
    const file = (await listSkillFiles(sid)).find((f) => f.path === path);
    if (!file || !file.full || !(await pathExists(file.full))) {
      sendJson(res, 404, { ok: false, error: 'Arquivo não encontrado.' });
      return;
    }
    const name = path.split('/').pop() || 'arquivo';
    const inline = url.searchParams.get('inline') === '1' && canInlineView(name); // images + PDFs
    const mime = inline ? mediaMimeFor(name) : 'application/octet-stream';
    await serveFileBytes(res, file.full, name, mime, inline);
  }

  // Serve a corpus file the BUDDY referenced in its answer (buddy-presents-to-user).
  // ref = "<skill-id>/<relpath>" (skill context/img/data/SKILL.md) or "commons/<path>"
  // (a commons concept's img|data|context.md). Gates: skill → in-context + canReadSkillActor;
  // commons → per-capsule ACL (canReadCommonsActor on the owning concept; root-level files
  // like README.md stay shared). Only ever serves files listSkillFiles enumerated (skills)
  // or resolved under commonsRoot() — no raw path handling beyond the strict ref regex.
  async function serveCorpusRef(res, url, actor, contextSkillIds) {
    const raw = String(url.searchParams.get('ref') || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');
    const wantInline = url.searchParams.get('inline') === '1';
    if (!raw || raw.includes('..') || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(raw)) {
      sendJson(res, 400, { ok: false, error: 'Referência inválida.' });
      return;
    }
    const serve = async (full, name) => {
      const inline = wantInline && canInlineView(name); // images + PDFs can be viewed in a tab
      await serveFileBytes(res, full, name, inline ? mediaMimeFor(name) : 'application/octet-stream', inline);
    };

    // Commons branch — shared by default, but a RESTRICTED capsule's files require read
    // access on the owning concept (same 404 as not-found: existence never leaks).
    if (raw === 'commons' || raw.startsWith('commons/')) {
      const rel = raw.replace(/^commons\/?/, '');
      let full = join(commonsRoot(), rel);
      // rel is already regex-validated (no `..`); this normalized-prefix check is
      // defense-in-depth and separator-agnostic (Windows join → `\`, Linux → `/`).
      if (!normalize(full).startsWith(normalize(commonsRoot())) || !rel) {
        sendJson(res, 404, { ok: false, error: 'Arquivo do commons não encontrado.' });
        return;
      }
      if (!(await pathExists(full))) {
        // Tolerate a model ref that dropped ONE concept segment (a common slip:
        // `commons/<dominio>/img/x.png` for `commons/<dominio>/<conceito>/img/x.png`).
        // Resolve only when exactly ONE direct child matches — never guess between two.
        full = null;
        const m = rel.match(/^(?:(.+)\/)?(img|data)\/([^/]+)$/);
        if (m) {
          const prefixDir = m[1] ? join(commonsRoot(), m[1]) : commonsRoot();
          const hits = [];
          try {
            for (const e of await readdir(prefixDir, { withFileTypes: true })) {
              if (!e.isDirectory()) continue;
              const cand = join(prefixDir, e.name, m[2], m[3]);
              if (await pathExists(cand)) hits.push(cand);
            }
          } catch (error) {
            /* prefix dir missing → no hits */
          }
          if (hits.length === 1) {
            full = hits[0];
          }
        }
        if (!full) {
          sendJson(res, 404, { ok: false, error: 'Arquivo do commons não encontrado.' });
          return;
        }
      }
      let st = null;
      try {
        st = await stat(full);
      } catch (error) {
        st = null;
      }
      if (!st || st.isDirectory()) {
        sendJson(res, 404, { ok: false, error: 'Arquivo do commons não encontrado.' });
        return;
      }
      const relFromRoot = normalize(full)
        .slice(normalize(commonsRoot()).length)
        .replace(/^[\\/]+/, '')
        .replace(/\\/g, '/');
      const owningConcept = await commonsConceptOfPath(relFromRoot.split('/').slice(0, -1).join('/'));
      if (owningConcept && !(await canReadCommonsActor(owningConcept, actor))) {
        sendJson(res, 404, { ok: false, error: 'Arquivo do commons não encontrado.' });
        return;
      }
      await serve(full, rel.split('/').pop() || 'arquivo');
      return;
    }

    // Skill branch — a context skill the actor can read; path must be one we enumerate.
    // Skill ids can contain '/' (e.g. "reuniao/resumo-reuniao"), so match the LONGEST
    // context-skill-id that prefixes the ref rather than splitting on the first slash.
    const ctx = Array.isArray(contextSkillIds) ? contextSkillIds : [];
    let skillId =
      ctx.filter((sid) => raw === sid || raw.startsWith(sid + '/')).sort((a, b) => b.length - a.length)[0] || null;
    let rel;
    if (skillId) {
      rel = raw === skillId ? 'SKILL.md' : raw.slice(skillId.length + 1);
    } else if (ctx.length === 1) {
      skillId = ctx[0];
      rel = raw; // tolerate a skill-relative ref when there's a single context skill
    } else {
      sendJson(res, 403, { ok: false, error: 'Skill fora do contexto desta conversa.' });
      return;
    }
    if (!(await canReadSkillActor(skillId, actor))) {
      sendJson(res, 403, { ok: false, error: 'Sem acesso aos arquivos desta skill.' });
      return;
    }
    const file = (await listSkillFiles(skillId)).find((f) => f.path === rel);
    if (!file || !file.full || !(await pathExists(file.full))) {
      sendJson(res, 404, { ok: false, error: 'Arquivo não encontrado.' });
      return;
    }
    await serve(file.full, rel.split('/').pop() || 'arquivo');
  }

  // Persona + mood-marker protocol appended to the system prompt when a buddy is in
  // play. The buddy seeds tone (temperament) and the [mood] marker drives the avatar
  // pose in the UI (stripped from the shown text). Mirrors the RevenueHub Skill Hub.
  function buddyPromptSuffix(buddy) {
    const name = buddy.name || buddy.id;
    const persona =
      buddy.temperament && buddy.temperament.trim()
        ? `\n\nNesta conversa você incorpora o buddy **${name}**. O texto a seguir é o TEMPERAMENTO dele — a personalidade que dá cor ao SEU jeito de falar (tom, humor, escolha de palavras), e não à tarefa: ${buddy.temperament.trim()}\nTrate o temperamento como tempero da ENTREGA, não como objetivo. O QUE você responde continua sempre prestativo, correto, completo e claro; o temperamento muda só COMO você diz. Deixe a personalidade transparecer com naturalidade e MODERAÇÃO — principalmente na abertura, em comentários laterais e no fraseado —, sem despejar o traço mais forte em toda frase e sem jamais fazer a pessoa se sentir atacada ou mal atendida. Em perguntas sérias, sensíveis ou complexas, segure o exagero e priorize ajudar bem. Nunca anuncie que está atuando como um personagem.`
        : `\n\nNesta conversa você é acompanhado pelo buddy **${name}**.`;
    const moods = BUDDY_POSES.map((mood) => `[${mood}]`).join(' ');
    const protocol = `\n\nComece SEMPRE a resposta com um marcador de humor entre colchetes, escolhido desta lista fixa: ${moods}. Escolha o que combina com o conteúdo — por exemplo [happy] boas notícias, [eureka] ao resolver algo, [thinking] ao raciocinar, [question] quando precisa de esclarecimento, [sad] ao informar uma limitação, [celebrating] em um marco, [wave] ao cumprimentar. A interface usa esse marcador para animar o avatar e o remove do texto exibido — coloque-o exatamente no início, sozinho, e não o mencione no restante da resposta.`;
    return persona + protocol;
  }

  function formatBytesServer(n) {
    const b = Number(n) || 0;
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
    return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Browser-side renderer for the standalone file-view page. Runs ONLY in the
  // served page (never in Node — we just serialize it via .toString()). Compact
  // markdown → HTML so a "Fontes" link opens formatted, like the corpus explorer.
  // Browser markdown→HTML renderer WITH GFM tables. Embedded via .toString() into
  // the standalone file pages; never runs in Node. Self-contained (esc/inl inside).
  function mdToHtmlBrowser(src) {
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function inl(s) {
      return esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }
    function cols(line) {
      return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map(function (c) {
          return c.trim();
        });
    }
    // Normalize CRLF/CR first: a trailing \r left by split('\n') defeats the $-anchored line
    // regexes (headings, fenced-code close, hr, table separator) while inline/list regexes
    // survive — so a Windows-authored capsule showed raw #/## headings but rendered its bold.
    var L = String(src).replace(/\r\n?/g, '\n').split('\n'),
      o = '',
      i = 0;
    while (i < L.length) {
      var ln = L[i];
      var f = /^```(\w*)\s*$/.exec(ln);
      if (f) {
        var c = [];
        i++;
        while (i < L.length && !/^```\s*$/.test(L[i])) {
          c.push(L[i]);
          i++;
        }
        i++;
        o += '<pre class="code"><code>' + esc(c.join('\n')) + '</code></pre>';
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < L.length && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(L[i + 1])) {
        var head = cols(ln);
        i += 2;
        var rows = [];
        while (i < L.length && /^\s*\|.*\|\s*$/.test(L[i])) {
          rows.push(cols(L[i]));
          i++;
        }
        o +=
          '<table><thead><tr>' +
          head
            .map(function (x) {
              return '<th>' + inl(x) + '</th>';
            })
            .join('') +
          '</tr></thead><tbody>' +
          rows
            .map(function (r) {
              return (
                '<tr>' +
                r
                  .map(function (x) {
                    return '<td>' + inl(x) + '</td>';
                  })
                  .join('') +
                '</tr>'
              );
            })
            .join('') +
          '</tbody></table>';
        continue;
      }
      var h = /^(#{1,6})\s+(.*)$/.exec(ln);
      if (h) {
        var lv = h[1].length;
        o += '<h' + lv + '>' + inl(h[2]) + '</h' + lv + '>';
        i++;
        continue;
      }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) {
        o += '<hr>';
        i++;
        continue;
      }
      if (/^\s*[-*]\s+/.test(ln)) {
        o += '<ul>';
        while (i < L.length && /^\s*[-*]\s+/.test(L[i])) {
          o += '<li>' + inl(L[i].replace(/^\s*[-*]\s+/, '')) + '</li>';
          i++;
        }
        o += '</ul>';
        continue;
      }
      if (/^\s*\d+\.\s+/.test(ln)) {
        o += '<ol>';
        while (i < L.length && /^\s*\d+\.\s+/.test(L[i])) {
          o += '<li>' + inl(L[i].replace(/^\s*\d+\.\s+/, '')) + '</li>';
          i++;
        }
        o += '</ol>';
        continue;
      }
      if (/^\s*$/.test(ln)) {
        i++;
        continue;
      }
      var p = [ln];
      i++;
      while (
        i < L.length &&
        !/^\s*$/.test(L[i]) &&
        !/^#{1,6}\s/.test(L[i]) &&
        !/^```/.test(L[i]) &&
        !/^\s*[-*]\s+/.test(L[i]) &&
        !/^\s*\d+\.\s+/.test(L[i]) &&
        !/^\s*\|.*\|\s*$/.test(L[i])
      ) {
        p.push(L[i]);
        i++;
      }
      o += '<p>' + p.map(inl).join('<br>') + '</p>';
    }
    return o;
  }

  // Shared CSS for the standalone file pages (view + edit), including table styles.
  function fileViewCss() {
    return (
      ':root{color-scheme:light dark;--bg:#f7f8f8;--surface:#fff;--surface2:#f1f3f3;--ink:#230c18;--muted:#5f5860;--line:#e1e4e3;--primary:#be1549;--code-bg:#1f2430;--code-ink:#e5e7eb}' +
      '@media(prefers-color-scheme:dark){:root{--bg:#14161b;--surface:#1d2027;--surface2:#262a33;--ink:#ececf0;--muted:#9fa3ad;--line:#313742;--primary:#e5487a}}' +
      '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Aptos,"Segoe UI",Arial,sans-serif;line-height:1.55}' +
      '.fv-head{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:10px 20px;background:var(--surface);border-bottom:1px solid var(--line)}' +
      '.fv-path{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--muted);word-break:break-all}' +
      '.fv-btn{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:8px;padding:6px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer}' +
      '.fv-btn.primary{background:var(--primary);border-color:var(--primary);color:#fff}.fv-btn:disabled{opacity:.5;cursor:default}' +
      '.fv-status{font-size:12px;color:var(--muted)}' +
      '.fv-review-banner{max-width:960px;margin:14px auto 0;padding:10px 16px;background:var(--surface2);border:1px solid var(--line);border-left:3px solid var(--primary);border-radius:8px;font-size:13px;color:var(--ink)}' +
      '.fv-review-banner.done{border-left-color:#2e9e5b}' +
      '.fv-doc{max-width:960px;margin:0 auto;padding:26px 24px 80px}' +
      '.fv-doc h1,.fv-doc h2,.fv-doc h3,.fv-doc h4{line-height:1.25;margin:1.4em 0 .5em}' +
      '.fv-doc h1{font-size:1.6rem}.fv-doc h2{font-size:1.3rem;border-bottom:1px solid var(--line);padding-bottom:.2em}.fv-doc h3{font-size:1.1rem}' +
      '.fv-doc p{margin:.7em 0}.fv-doc ul,.fv-doc ol{margin:.6em 0;padding-left:1.4em}.fv-doc li{margin:.2em 0}' +
      '.fv-doc a{color:var(--primary)}.fv-doc hr{border:0;border-top:1px solid var(--line);margin:1.6em 0}' +
      '.fv-doc code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;background:var(--surface);border:1px solid var(--line);border-radius:4px;padding:.05em .35em}' +
      '.fv-doc pre.code{background:var(--code-bg);color:var(--code-ink);border-radius:8px;padding:14px 16px;overflow-x:auto}' +
      '.fv-doc pre.code code{background:none;border:0;padding:0;color:inherit;white-space:pre;font-size:.85rem;line-height:1.5}' +
      '.fv-doc table{border-collapse:collapse;margin:1em 0;font-size:.9rem;display:block;max-width:100%;overflow-x:auto}' +
      '.fv-doc th,.fv-doc td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top;white-space:nowrap}' +
      '.fv-doc th{background:var(--surface2);font-weight:700}' +
      '.fv-doc tbody tr:nth-child(even){background:var(--surface)}' +
      'textarea.fv-edit{width:100%;min-height:72vh;border:1px solid var(--line);border-radius:8px;padding:14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5;background:var(--surface);color:var(--ink);resize:vertical}' +
      '.fv-media{padding-top:0}.fv-media hr{border:0;border-top:1px dashed var(--line);margin:0 0 1.2em}' +
      '.fv-imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px;margin:.6em 0 1.2em}' +
      '.fv-img{margin:0;border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--surface2)}' +
      '.fv-img img{display:block;width:100%;height:170px;object-fit:contain;background:var(--surface);border-bottom:1px solid var(--line)}' +
      '.fv-img figcaption{padding:8px 10px;font-size:12px;display:flex;flex-direction:column;gap:3px}.fv-img figcaption strong{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}.fv-img figcaption span{color:var(--muted)}' +
      '.fv-data{margin:.6em 0 1.2em}.fv-data h4{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9rem;margin:.8em 0 .4em}.muted{color:var(--muted)}'
    );
  }

  // View bootstrap for a read-only file page (Fontes links). Runs in the browser.
  function fileViewBoot({ window, document }) {
    var raw = window.__FV_RAW__ || '';
    var isMd = document.documentElement.getAttribute('data-md') === '1';
    function esc(s) {
      return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    document.getElementById('doc').innerHTML = isMd
      ? mdToHtmlBrowser(raw)
      : '<pre class="code"><code>' + esc(raw) + '</code></pre>';
  }

  // A self-contained HTML page rendering one corpus file (markdown formatted, with
  // tables). Inline CSS + inlined renderer — independent of the SPA on purpose.
  function fileViewPage(relPath, content) {
    const safe = (s) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const isMd = /\.(md|markdown)$/i.test(relPath);
    const title = relPath.split('/').pop() || 'arquivo';
    const embedded = JSON.stringify(content).replace(/</g, '\\u003c');
    return `<!doctype html>
  <html lang="pt-BR" data-md="${isMd ? '1' : '0'}">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safe(title)}</title>
  <style>${fileViewCss()}</style></head>
  <body>
  <header class="fv-head"><span class="fv-path">${safe(relPath)}</span></header>
  <main class="fv-doc" id="doc"></main>
  <script>window.__FV_RAW__=${embedded};
  ${mdToHtmlBrowser.toString()}
  ${fileViewBoot.toString()}
  fileViewBoot({ window, document });</script>
  </body></html>`;
  }

  // View/edit bootstrap for the commons concept page. Runs in the browser: renders
  // the markdown (with tables); curators/admins can toggle Editar → textarea → Salvar
  // (POST /api/commons/file). Roomy full-page replacement for the cramped modal.
  function commonsFileBoot({ window, document, location }) {
    var PATH = window.__CF_PATH__;
    var content = window.__CF_RAW__ || '';
    var editing = false;
    var doc = document.getElementById('doc');
    var editBtn = document.getElementById('editBtn');
    var cancelBtn = document.getElementById('cancelBtn');
    var status = document.getElementById('status');
    function render() {
      if (editing) {
        doc.innerHTML = '<textarea class="fv-edit" id="ta" spellcheck="false"></textarea>';
        var ta = document.getElementById('ta');
        ta.value = content;
        ta.focus();
        if (editBtn) {
          editBtn.textContent = 'Salvar';
          editBtn.classList.add('primary');
        }
        if (cancelBtn) {
          cancelBtn.style.display = '';
        }
      } else {
        doc.innerHTML = mdToHtmlBrowser(content);
        if (editBtn) {
          editBtn.textContent = 'Editar';
          editBtn.classList.remove('primary');
        }
        if (cancelBtn) {
          cancelBtn.style.display = 'none';
        }
      }
    }
    if (editBtn) {
      editBtn.addEventListener('click', function () {
        if (!editing) {
          editing = true;
          render();
          return;
        }
        var val = document.getElementById('ta').value;
        status.textContent = 'Salvando…';
        editBtn.disabled = true;
        cancelBtn.disabled = true;
        fetch('/api/commons/file', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: PATH, content: val })
        })
          .then(function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d };
            });
          })
          .then(function (res) {
            if (!res.ok || !res.d.ok) {
              throw new Error(res.d.error || 'Falha ao salvar.');
            }
            content = val;
            editing = false;
            render();
            status.textContent = 'Salvo ✓';
            setTimeout(function () {
              status.textContent = '';
            }, 2500);
          })
          .catch(function (e) {
            status.textContent = 'Erro: ' + e.message;
          })
          .then(function () {
            editBtn.disabled = false;
            cancelBtn.disabled = false;
          });
      });
      cancelBtn.addEventListener('click', function () {
        editing = false;
        render();
        status.textContent = '';
      });
    }
    var mediaBtn = document.getElementById('mediaBtn');
    if (mediaBtn) {
      mediaBtn.addEventListener('click', function () {
        mediaBtn.disabled = true;
        if (status) {
          status.textContent = 'Processando mídia…';
        }
        fetch('/api/commons/process-media', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: PATH })
        })
          .then(function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d };
            });
          })
          .then(function (res) {
            if (!res.ok || !res.d.ok) {
              throw new Error(res.d.error || 'Falha ao processar.');
            }
            if (status) {
              status.textContent = 'Processado ✓';
            }
            setTimeout(function () {
              location.reload();
            }, 700);
          })
          .catch(function (e) {
            if (status) {
              status.textContent = 'Erro: ' + e.message;
            }
            mediaBtn.disabled = false;
          });
      });
    }
    var validarBtn = document.getElementById('validarBtn');
    if (validarBtn) {
      validarBtn.addEventListener('click', function () {
        validarBtn.disabled = true;
        if (status) {
          status.textContent = 'Validando…';
        }
        fetch('/api/commons/govern/review', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: PATH })
        })
          .then(function (r) {
            return r.json().then(function (d) {
              return { ok: r.ok, d: d };
            });
          })
          .then(function (res) {
            if (!res.ok || !res.d.ok) {
              throw new Error(res.d.error || 'Falha ao validar.');
            }
            validarBtn.textContent = 'Revisado ✓';
            if (status) {
              status.textContent = '';
            }
            var b = document.getElementById('reviewBanner');
            if (b) {
              b.innerHTML = 'Cápsula marcada como <strong>revisada</strong> ✓. Fechando a aba…';
              b.className = 'fv-review-banner done';
            }
            setTimeout(function () {
              window.close();
              // Fallback: some browsers refuse to close a tab they did not themselves open.
              setTimeout(function () {
                if (b) {
                  b.innerHTML = 'Cápsula marcada como <strong>revisada</strong> ✓. Você pode fechar esta aba.';
                }
              }, 400);
            }, 500);
          })
          .catch(function (e) {
            validarBtn.disabled = false;
            if (status) {
              status.textContent = 'Erro: ' + e.message;
            }
          });
      });
    }
    render();
  }

  // Phase 2: server-rendered media section for the new-tab concept page. A non-editable block
  // below the doc — real <img> (via /api/commons/img) + data tables via mdToHtmlBrowser (reused
  // server-side). Editing only touches #doc (context.md), so media is never part of the save.
  function mediaHtmlForPage(rel, media) {
    const safe = (s) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const imgs = (media && media.images) || [];
    const dats = (media && media.data) || [];
    if (!imgs.length && !dats.length) return '';
    let out = '<section class="fv-doc fv-media" id="media"><hr><h2>Mídia (IA)</h2>';
    if (imgs.length) {
      out += '<h3>Imagens</h3><div class="fv-imgs">';
      for (const m of imgs)
        out += `<figure class="fv-img"><img src="/api/commons/img?path=${encodeURIComponent(rel)}&name=${encodeURIComponent(m.name)}" alt="${safe(m.name)}"><figcaption><strong>${safe(m.name)}</strong>${m.description ? `<span>${safe(m.description)}</span>` : '<span class="muted">sem descrição — processe a mídia</span>'}</figcaption></figure>`;
      out += '</div>';
    }
    if (dats.length) {
      out += '<h3>Dados</h3>';
      for (const m of dats)
        out += `<div class="fv-data"><h4>${safe(m.name)}</h4>${m.description ? `<p>${safe(m.description)}</p>` : ''}${m.markdown ? mdToHtmlBrowser(m.markdown) : ''}</div>`;
    }
    return `${out}</section>`;
  }

  // Self-contained view/edit page for a commons concept file (opened in a new tab).
  function commonsFilePage(rel, content, canEdit, media, reviewMode) {
    const safe = (s) =>
      String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const title = rel.split('/').pop() || 'conceito';
    const embedded = JSON.stringify(content).replace(/</g, '\\u003c');
    // Review flow: the dashboard's "Revisar" opens this page with ?review=1 and a Validar button,
    // so a steward must actually see the content before the capsule is marked reviewed.
    const reviewBtn =
      reviewMode && canEdit
        ? '<button class="fv-btn primary" id="validarBtn">Validar (marcar como revisado)</button>'
        : '';
    const controls = canEdit
      ? reviewBtn +
        '<button class="fv-btn" id="mediaBtn">Processar mídia (IA)</button><button class="fv-btn" id="cancelBtn" style="display:none">Cancelar</button><span class="fv-status" id="status"></span><button class="fv-btn" id="editBtn">Editar</button>'
      : '';
    const banner = reviewMode
      ? canEdit
        ? '<div class="fv-review-banner" id="reviewBanner">Revise o conteúdo desta cápsula e clique em <strong>Validar</strong> para marcar como revisado.</div>'
        : '<div class="fv-review-banner">Você não tem permissão para revisar esta cápsula.</div>'
      : '';
    return `<!doctype html>
  <html lang="pt-BR">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safe(title)} · Commons</title>
  <style>${fileViewCss()}</style></head>
  <body>
  <header class="fv-head"><span class="fv-path">${safe('commons/' + rel)}</span>${controls}</header>
  ${banner}
  <main class="fv-doc" id="doc"></main>
  ${mediaHtmlForPage(rel, media)}
  <script>window.__CF_PATH__=${JSON.stringify(rel).replace(/</g, '\\u003c')};window.__CF_RAW__=${embedded};
  ${mdToHtmlBrowser.toString()}
  ${commonsFileBoot.toString()}
  commonsFileBoot({ window, document, location });</script>
  </body></html>`;
  }

  // Fence longer than any backtick run inside the content, so a markdown context file
  // with its own ``` fences can't break out of the block it's wrapped in.
  function safeFence(content) {
    const runs = String(content).match(/`+/g);
    const longest = runs ? Math.max(...runs.map((s) => s.length)) : 0;
    return '`'.repeat(Math.max(3, longest + 1));
  }

  function contextFenceLang(rel) {
    return (
      {
        '.sql': 'sql',
        '.json': 'json',
        '.md': 'markdown',
        '.markdown': 'markdown',
        '.csv': 'csv',
        '.tsv': 'tsv',
        '.yml': 'yaml',
        '.yaml': 'yaml',
        '.toml': 'toml',
        '.xml': 'xml',
        '.html': 'html',
        '.htm': 'html',
        '.js': 'js',
        '.mjs': 'js',
        '.ts': 'ts',
        '.py': 'python',
        '.r': 'r'
      }[extname(rel).toLowerCase()] || ''
    );
  }

  // Fill order for the context budget: the output contract and curated context first,
  // raw data dumps last. Lower number = included earlier.
  function contextFilePriority(rel) {
    const p = rel.replace(/\\/g, '/').toLowerCase();
    if (p === 'output_schema.json') return 0;
    if (p.startsWith('references/') || p.startsWith('reference/')) return 1;
    if (p.startsWith('query/')) return 2;
    if (p.startsWith('analytics/')) return 3;
    if (p === 'eval/cases.json' || p.startsWith('eval/')) return 4;
    return 5;
  }

  // Discover a skill's usable text context files WITHOUT reading their content — the shared
  // exclusion/text/size truth for both the inline bundler (readSkillTextContext) and the
  // paging manifest (skillContextManifest). Draft copy wins over source (mirrors SKILL.md
  // resolution). Governance machinery is excluded; binaries and oversized files land in
  // `skipped`. Returns text files as {rel, bytes, full} (full = absolute path to read later).
  async function discoverSkillContextFiles(skill) {
    const facts = skill.artifactFacts || {};
    const sourceDir = facts.sourceFolder || facts.folder || join(skillsRoot(), skill.id);
    const draftDir = facts.draftFolder || null;
    const rels = Array.isArray(facts.files) ? facts.files : [];
    const textFiles = [];
    const skipped = [];
    for (const rel of rels) {
      const norm = rel.replace(/\\/g, '/');
      // SKILL.md (already the spine) and governance machinery (legado/logs/canonico/rascunho/
      // suggestions/metadata/…) are never context.
      if (isGovernancePath(norm)) {
        continue;
      }
      // Resolve the actual path with the ORIGINAL rel (keeps the OS separator); prefer the
      // draft copy when it exists, else the canonical source.
      let full = null;
      if (draftDir && (await pathExists(join(draftDir, rel)))) {
        full = join(draftDir, rel);
      } else if (await pathExists(join(sourceDir, rel))) {
        full = join(sourceDir, rel);
      }
      if (!full) {
        continue;
      }
      let bytes = 0;
      try {
        bytes = (await stat(full)).size;
      } catch (error) {
        bytes = 0;
      }
      if (!TEXT_CONTEXT_EXTS.has(extname(norm).toLowerCase())) {
        skipped.push({ rel: norm, bytes, reason: 'binário (sem versão em texto)' });
        continue;
      }
      if (bytes > CONTEXT_FILE_MAX_BYTES) {
        skipped.push({ rel: norm, bytes, reason: `muito grande (> ${Math.round(CONTEXT_FILE_MAX_BYTES / 1024)} KB)` });
        continue;
      }
      textFiles.push({ rel: norm, bytes, full });
    }
    textFiles.sort((a, b) => contextFilePriority(a.rel) - contextFilePriority(b.rel) || a.rel.localeCompare(b.rel));
    skipped.sort((a, b) => a.rel.localeCompare(b.rel));
    return { textFiles, skipped };
  }

  // Read a skill's text context files from disk (full content). Returns inlinable text files
  // (priority-ordered) plus a manifest of files skipped and why. SKILL.md is excluded —
  // callers already have it as skill.sourceText.
  async function readSkillTextContext(skill) {
    const { textFiles: discovered, skipped } = await discoverSkillContextFiles(skill);
    const textFiles = [];
    for (const file of discovered) {
      let content = '';
      try {
        content = await readFile(file.full, 'utf8');
      } catch (error) {
        skipped.push({ rel: file.rel, bytes: file.bytes, reason: 'ilegível' });
        continue;
      }
      textFiles.push({ rel: file.rel, bytes: file.bytes, content });
    }
    return { textFiles, skipped };
  }

  // Classify a context file by its location (drives the manifest `kind`, mirrors the wizard's
  // Catálogo / Additional Context sections).
  function contextKind(rel) {
    const p = rel.replace(/\\/g, '/').toLowerCase();
    if (p === 'output_schema.json') return 'schema';
    if (p.startsWith('references/') || p.startsWith('reference/')) return 'contexto';
    if (p.startsWith('query/')) return 'query';
    if (p.startsWith('analytics/')) return 'catalogo';
    if (p === 'eval/cases.json' || p.startsWith('eval/')) return 'eval';
    return 'outro';
  }

  // Deterministic, zero-key one-line summary from a file's head (heuristic tier — an AI
  // overlay at ingest is a later enhancement). First markdown heading / SQL lead comment /
  // JSON top keys / delimited header / first non-empty line.
  function heuristicSummary(rel, head) {
    const ext = extname(rel).toLowerCase();
    const lines = String(head).split(/\r?\n/);
    const firstNonEmpty = () => (lines.find((l) => l.trim()) || '').trim().slice(0, 200);
    if (ext === '.md' || ext === '.markdown') {
      const heading = lines.find((l) => /^#{1,6}\s+/.test(l.trim()));
      return heading
        ? heading
            .trim()
            .replace(/^#{1,6}\s+/, '')
            .slice(0, 200)
        : firstNonEmpty();
    }
    if (ext === '.sql') {
      const comment = lines.find((l) => /^\s*--\s*\S/.test(l));
      return comment
        ? comment
            .replace(/^\s*--\s?/, '')
            .trim()
            .slice(0, 200)
        : firstNonEmpty();
    }
    if (ext === '.json') {
      try {
        const obj = JSON.parse(head);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          return 'JSON: ' + Object.keys(obj).slice(0, 10).join(', ');
        }
      } catch (error) {
        /* head is truncated or not an object — fall through */
      }
      return 'arquivo JSON';
    }
    if (ext === '.csv' || ext === '.tsv') {
      const header = firstNonEmpty();
      return header ? 'colunas: ' + header : 'arquivo tabular';
    }
    return firstNonEmpty();
  }

  // Resolve one markdown-link target to a bundle-relative path, OKF-style. `/x` = from the
  // skill (bundle) root; `x` / `./x` / `../x` = relative to the linking file's directory.
  // External URLs (scheme:, //, mailto:) and empty/anchor-only targets return null.
  function resolveContextLink(target, sourceRel) {
    let t = String(target || '').trim();
    if (!t) return null;
    t = t.split(/\s+/)[0].replace(/#.*$/, '').trim(); // drop optional "title" and #anchor
    if (!t || t.startsWith('#')) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//')) return null; // external scheme / protocol-relative
    const rel = t.startsWith('/')
      ? t.slice(1)
      : `${sourceRel.includes('/') ? sourceRel.slice(0, sourceRel.lastIndexOf('/')) : ''}/${t}`.replace(/^\//, '');
    const parts = [];
    for (const seg of rel.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        parts.pop();
        continue;
      }
      parts.push(seg);
    }
    return parts.join('/');
  }

  return {
    isImageMime,
    chatFilesDir,
    plenariaFilesDir,
    storeMessageAttachments,
    findMessageAttachment,
    findAttachmentMeta,
    removeConversationFiles,
    conversationSkillFiles,
    serveFileBytes,
    serveContextSkillFile,
    serveCorpusRef,
    buddyPromptSuffix,
    formatBytesServer,
    fileViewPage,
    commonsFilePage,
    safeFence,
    contextFenceLang,
    discoverSkillContextFiles,
    readSkillTextContext,
    contextKind,
    heuristicSummary,
    resolveContextLink
  };
}
