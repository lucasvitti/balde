export function createMarkdownFeature({ escapeHtml, icon, skillPickerState, renderShell }) {
  function docImg(escapedAlt, escapedSrc) {
    const alt = String(escapedAlt || '').replace(/[`*]/g, '');
    const src = String(escapedSrc || '').trim();
    let finalSrc = '';
    if (/^data:image\//i.test(src)) finalSrc = src;
    else if (/^https?:\/\//i.test(src)) finalSrc = src;
    else if (/^[A-Za-z0-9][\w./-]*\.(?:png|jpe?g|gif|webp|bmp)$/i.test(src))
      finalSrc = `/api/docs/asset?path=${encodeURIComponent(src)}`;
    else return escapedAlt ? `[${escapedAlt}]` : '';
    return `<img class="doc-img" src="${finalSrc}" alt="${alt}" loading="lazy">`;
  }

  // Minimal, safe Markdown → HTML (escape first, then a small subset). Enough to
  // render SKILL.md like a README; not a full CommonMark implementation.
  // Chat SQL code blocks render raw first, then get formatted asynchronously and swapped
  // in place. Cached by SQL text so re-renders never re-hit the API. Any failure keeps
  // the original SQL — never breaks the message.
  const sqlFmtCache = new Map(); // raw SQL -> formatted (or the raw itself on failure)
  const sqlFmtInflight = new Set();

  function looksLikeSql(raw) {
    return /^\s*(with|select|insert\s+into|update\s+|delete\s+from|create\s+(table|view|or\s+replace|temp|temporary)|alter\s+table|merge\s+into|truncate\s+table|explain\b)/i.test(
      String(raw || '')
    );
  }

  // Emit one fenced code block. SQL blocks (lang===sql, or unlabelled but SQL-looking)
  // render from cache when available, else raw + a `data-sql-pending` marker for the async
  // formatter. Non-SQL blocks are untouched (never sent to a SQL formatter).
  function emitCodeBlockHtml(raw, lang, sqlFormat) {
    const isSql = sqlFormat && (lang === 'sql' || (!lang && looksLikeSql(raw)));
    if (!isSql) {
      return `<pre class="md-code"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}>${escapeHtml(raw)}</pre>`;
    }
    if (sqlFmtCache.has(raw)) {
      return `<pre class="md-code" data-lang="sql" data-sql-done="1">${escapeHtml(sqlFmtCache.get(raw))}</pre>`;
    }
    return `<pre class="md-code" data-lang="sql" data-sql-pending="1">${escapeHtml(raw)}</pre>`;
  }

  async function formatSqlViaApi(raw) {
    try {
      const res = await fetch('/api/tools/format-sql', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sql: raw })
      });
      const data = await res.json().catch(() => null);
      if (data && typeof data.formatted === 'string') {
        return data.formatted;
      }
    } catch (error) {
      /* fall through to original */
    }
    return raw; // graceful: identar down/slow → keep the original
  }

  function applySqlFormat(pre, formatted) {
    pre.textContent = formatted;
    pre.removeAttribute('data-sql-pending');
    pre.setAttribute('data-sql-done', '1');
  }

  // After a render, format any pending SQL blocks (dedup by SQL text + in-flight guard),
  // cache the result, and swap every block holding that SQL. Cheap no-op when none pending.
  function ensureSqlFormatted() {
    const pending = document.querySelectorAll('pre.md-code[data-sql-pending="1"]');
    if (!pending.length) {
      return;
    }
    const seen = new Set();
    pending.forEach((pre) => {
      const raw = pre.textContent;
      if (sqlFmtCache.has(raw)) {
        applySqlFormat(pre, sqlFmtCache.get(raw));
        return;
      }
      if (seen.has(raw) || sqlFmtInflight.has(raw)) {
        return;
      }
      seen.add(raw);
      sqlFmtInflight.add(raw);
      formatSqlViaApi(raw)
        .then((formatted) => {
          sqlFmtCache.set(raw, formatted);
          document.querySelectorAll('pre.md-code[data-sql-pending="1"]').forEach((p) => {
            if (p.textContent === raw) {
              applySqlFormat(p, formatted);
            }
          });
        })
        .finally(() => sqlFmtInflight.delete(raw));
    });
  }

  // Resolve a buddy `corpus:PATH` reference to the gated /corpus-file endpoint for the
  // current conversation. The buddy cites only the corpus path; the URL (carrying the
  // conversation id + the server-side access gate) is built here — the buddy never sees it.
  function corpusFileUrl(kind, id, ref, inlineImg) {
    return `/api/${kind}/corpus-file?id=${encodeURIComponent(id)}&ref=${encodeURIComponent(ref)}${inlineImg ? '&inline=1' : ''}`;
  }
  function corpusImg(escAlt, escRef, opts) {
    const alt = String(escAlt || '').replace(/[`*]/g, '');
    const view = corpusFileUrl(opts.corpusKind, opts.corpusId, escRef, false);
    const src = corpusFileUrl(opts.corpusKind, opts.corpusId, escRef, true);
    // Click → lightbox (expanded view + download), not a direct download.
    return `<span class="msg-att-img" data-action="viewImage" data-full="${src}" data-download="${view}" data-name="${alt}" title="${alt}" role="button" tabindex="0"><img class="msg-corpus-img" src="${src}" alt="${alt}" loading="lazy"></span>`;
  }
  // A corpus file the buddy offered. Viewable types (PDF/images) get a two-part chip:
  // the name opens it in a tab (view), the trailing button downloads. Everything else is
  // a plain download chip.
  function corpusFileLink(escTxt, escRef, opts) {
    const name = String(escTxt || 'arquivo');
    const dl = corpusFileUrl(opts.corpusKind, opts.corpusId, escRef, false);
    if (!/\.(pdf|png|jpe?g|gif|webp|bmp)$/i.test(String(escRef))) {
      return `<a class="msg-corpus-file" href="${dl}" download>${icon('download')}<span class="msg-att-name">${name}</span></a>`;
    }
    const view = corpusFileUrl(opts.corpusKind, opts.corpusId, escRef, true);
    return `<span class="msg-corpus-file has-view"><a class="corpus-file-view" href="${view}" target="_blank" rel="noopener" title="Visualizar">${icon('file')}<span class="msg-att-name">${name}</span></a><a class="corpus-file-dl" href="${dl}" download title="Baixar" aria-label="Baixar ${name}">${icon('download')}</a></span>`;
  }
  // Imperative overlay (like toasts): no state, no renderShell repaint; closes on
  // backdrop click, the X, or Escape.
  function lightboxEscHandler(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeImageLightbox();
    }
  }
  function closeImageLightbox() {
    const el = document.querySelector('.img-lightbox');
    if (el) {
      el.remove();
    }
    document.removeEventListener('keydown', lightboxEscHandler, true);
  }
  function openImageLightbox({ src, download, name }) {
    closeImageLightbox();
    const overlay = document.createElement('div');
    overlay.className = 'img-lightbox';
    overlay.innerHTML = `
      <div class="img-lightbox-panel" role="dialog" aria-modal="true" aria-label="${escapeHtml(name || 'Imagem')}">
        <div class="img-lightbox-bar">
          <span class="img-lightbox-name">${escapeHtml(name || 'Imagem')}</span>
          <a class="ghost-button small img-lightbox-dl" href="${escapeHtml(download || src)}" download>${icon('download')}Baixar</a>
          <button class="img-lightbox-close" type="button" data-lightbox-close aria-label="Fechar">${icon('x')}</button>
        </div>
        <div class="img-lightbox-body"><img src="${escapeHtml(src)}" alt="${escapeHtml(name || '')}"></div>
      </div>`;
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay || event.target.closest('[data-lightbox-close]')) {
        closeImageLightbox();
      }
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', lightboxEscHandler, true);
  }
  // Keyboard: Enter/Space on a focused image thumbnail opens it too.
  document.addEventListener('keydown', (event) => {
    // Skill picker: Enter takes the first suggestion, Escape closes.
    const spInput =
      event.target.closest && event.target.closest('[data-skill-picker-domain], [data-skill-picker-query]');
    if (spInput) {
      if (event.key === 'Escape') {
        event.preventDefault();
        skillPickerState().kind = null;
        renderShell();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const first = document.querySelector('.skill-picker-item');
        if (first) {
          first.click();
        }
        return;
      }
      return;
    }

    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    const t = event.target.closest && event.target.closest('[data-action="viewImage"]');
    if (t) {
      event.preventDefault();
      t.click();
    }
  });

  function renderMarkdownSafe(md, opts) {
    // When rendering a chat/plenária message (opts has corpusKind+corpusId), the buddy
    // may reference corpus files with `![](corpus:PATH)` / `[name](corpus:PATH)` — resolve
    // those to the gated /corpus-file endpoint (image inline, other files as a download chip)
    // BEFORE the generic image/link pass. Elsewhere (docs, SKILL.md) corpus refs pass through.
    const corpus = opts && opts.corpusKind && opts.corpusId ? opts : null;
    const sqlFormat = !!(opts && opts.sqlFormat); // auto-format SQL code blocks (chat)
    // corpusLinks (SKILL.md / capsule body): turn internal references — [label](/commons/…) and
    // [label](/…/SKILL.md) — into the label plus a chain button that opens that artifact in the explorer.
    const corpusLinks = !!(opts && opts.corpusLinks);
    const inline = (text) => {
      let s = escapeHtml(text);
      if (corpus) {
        s = s
          .replace(/!\[([^\]]*)\]\(corpus:([^)\s]+)\)/g, (_m, alt, ref) => corpusImg(alt, ref, corpus))
          .replace(/\[([^\]]+)\]\(corpus:([^)\s]+)\)/g, (_m, txt, ref) => corpusFileLink(txt, ref, corpus));
      }
      if (corpusLinks) {
        s = s.replace(
          /(?<!!)\[([^\]]+)\]\((\/commons\/[^)\s]+|\/[A-Za-z0-9._/-]+\/SKILL\.md)\)/g,
          (_m, label, href) =>
            `<span class="corpus-ref">${label}<button type="button" class="corpus-ref-open" data-action="exploreOpenRef" data-href="${href}" title="Abrir no corpus">${icon('link')}</button></span>`
        );
      }
      return s
        .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => docImg(alt, src))
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>');
    };
    const lines = String(md || '')
      .replace(/\r\n/g, '\n')
      .split('\n');
    const out = [];
    let inCode = false;
    let codeBuf = [];
    let codeLang = '';
    let inList = false;
    const closeList = () => {
      if (inList) {
        out.push('</ul>');
        inList = false;
      }
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^```/.test(line)) {
        if (inCode) {
          out.push(emitCodeBlockHtml(codeBuf.join('\n'), codeLang, sqlFormat));
          codeBuf = [];
          inCode = false;
          codeLang = '';
        } else {
          closeList();
          inCode = true;
          codeLang = (line.match(/^```\s*([a-zA-Z0-9_+#.-]*)/) || ['', ''])[1].toLowerCase();
        }
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        continue;
      }
      if (/^\s*<!--[\s\S]*-->\s*$/.test(line)) {
        continue;
      }
      // GFM pipe table: a header row immediately followed by a separator row (| --- | --- |).
      const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
      const isTableSep = (l) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
      if (isTableRow(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        closeList();
        const cells = (l) =>
          l
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split(/(?<!\\)\|/)
            .map((c) => c.trim().replace(/\\\|/g, '|'));
        const headers = cells(line);
        let j = i + 2;
        const rows = [];
        while (j < lines.length && isTableRow(lines[j]) && !isTableSep(lines[j])) {
          rows.push(cells(lines[j]));
          j += 1;
        }
        i = j - 1;
        const thead = `<thead><tr>${headers.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead>`;
        const tbody = `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
        out.push(`<table class="md-table">${thead}${tbody}</table>`);
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        closeList();
        const level = heading[1].length;
        out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }
      const item = line.match(/^\s*[-*]\s+(.*)$/);
      if (item) {
        if (!inList) {
          out.push('<ul>');
          inList = true;
        }
        out.push(`<li>${inline(item[1])}</li>`);
        continue;
      }
      if (/^\s*$/.test(line)) {
        closeList();
        continue;
      }
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
    if (inCode) {
      out.push(`<pre class="md-code">${escapeHtml(codeBuf.join('\n'))}</pre>`);
    }
    closeList();
    return out.join('\n');
  }

  return { ensureSqlFormatted, openImageLightbox, renderMarkdownSafe };
}
