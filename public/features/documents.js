export function createDocumentsFeature({ state, renderShell, toast }) {
  function stripDocFrontmatter(md) {
    const s = String(md || '');
    if (!/^---\r?\n/.test(s)) return s;
    const m = s.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
    return m ? s.slice(m[0].length) : s;
  }
  async function openDocs() {
    const prev = state.docs;
    state.docs = {
      list: (prev && prev.list) || [],
      selectedPath: prev && prev.selectedPath,
      content: (prev && prev.content) || '',
      history: (prev && prev.history) || [],
      openSections: prev && prev.openSections instanceof Set ? prev.openSections : null,
      expanded: !!(prev && prev.expanded),
      prevSidebarCollapsed: !!(prev && prev.prevSidebarCollapsed),
      width: (prev && prev.width) || docsSavedWidth(),
      loading: true,
      error: null
    };
    renderShell();
    try {
      const res = await fetch('/api/docs');
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        state.docs = {
          list: [],
          selectedPath: null,
          content: '',
          history: [],
          loading: false,
          error: data.error || 'Falha ao carregar documentação.'
        };
        renderShell();
        return;
      }
      const list = data.docs || [];
      state.docs.list = list;
      state.docs.loading = false;
      const keep =
        state.docs.selectedPath && list.some((d) => d.path === state.docs.selectedPath)
          ? state.docs.selectedPath
          : null;
      const readme = list.find((d) => /(^|\/)readme\.md$/i.test(d.path));
      const target = keep || (readme ? readme.path : list[0] && list[0].path) || null;
      renderShell();
      if (target) await openDocFile(target);
    } catch (error) {
      state.docs = {
        list: [],
        selectedPath: null,
        content: '',
        history: [],
        loading: false,
        error: error.message || 'Erro de rede.'
      };
      renderShell();
    }
  }

  async function openDocFile(path) {
    if (!state.docs) return;
    state.docs.selectedPath = path;
    state.docs.historyOpen = false;
    if (state.docs.openSections instanceof Set) {
      const doc = (state.docs.list || []).find((x) => x.path === path);
      if (doc && doc.section && String(doc.section).trim()) state.docs.openSections.add(String(doc.section).trim());
    }
    state.docs.editing = false;
    state.docs.draft = '';
    state.docs.editError = null;
    state.docs.fileLoading = true;
    state.docs.fileError = null;
    renderShell();
    try {
      const res = await fetch(`/api/docs/file?path=${encodeURIComponent(path)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        state.docs.content = '';
        state.docs.history = [];
        state.docs.tooLarge = false;
        state.docs.fileError = data.error || 'Falha ao abrir documento.';
      } else {
        state.docs.content = data.tooLarge ? '' : data.content || '';
        state.docs.tooLarge = !!data.tooLarge;
        state.docs.history = data.history || [];
      }
    } catch (error) {
      state.docs.content = '';
      state.docs.history = [];
      state.docs.fileError = error.message || 'Erro de rede.';
    }
    state.docs.fileLoading = false;
    renderShell();
  }

  function focusDocEditor() {
    const ta = document.querySelector('[data-doc-editor]');
    if (ta) {
      ta.focus();
      const len = ta.value.length;
      try {
        ta.setSelectionRange(len, len);
      } catch {
        /* ignore */
      }
    }
  }

  // Admin: persist an edited document (PUT), commit on the server, refresh history + list.
  async function saveDoc() {
    const d = state.docs;
    if (!d || !d.selectedPath || d.saving) return;
    d.saving = true;
    d.editError = null;
    renderShell();
    try {
      const res = await fetch('/api/admin/docs/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: d.selectedPath, content: d.draft != null ? d.draft : d.content })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        d.saving = false;
        d.editError = data.error || 'Falha ao salvar.';
        renderShell();
        return;
      }
      d.content = data.content != null ? data.content : d.draft;
      d.history = data.history || d.history;
      d.editing = false;
      d.saving = false;
      d.draft = '';
      try {
        const lr = await fetch('/api/docs');
        const lj = await lr.json().catch(() => ({}));
        if (lj && lj.ok && Array.isArray(lj.docs)) d.list = lj.docs;
      } catch {
        /* keep current list */
      }
      renderShell();
    } catch (error) {
      d.saving = false;
      d.editError = error.message || 'Erro de rede.';
      renderShell();
    }
  }

  // Admin: create a new document (POST), then open it directly in edit mode.
  // Admin: upload an image to the docs corpus (assets/) and insert a Markdown reference at the cursor.
  async function uploadDocImage(file) {
    const d = state.docs;
    if (!d || !file) return;
    if (!/^image\//.test(file.type || '')) {
      d.editError = 'Selecione um arquivo de imagem.';
      renderShell();
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      d.editError = 'Imagem muito grande (máx. 8 MB).';
      renderShell();
      return;
    }
    d.uploadingImg = true;
    d.editError = null;
    renderShell();
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result || ''));
        fr.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
        fr.readAsDataURL(file);
      });
      const base64 = dataUrl.replace(/^data:[^;,]*;base64,/, '');
      const res = await fetch('/api/admin/docs/asset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, base64 })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        d.editError = data.error || 'Falha ao enviar imagem.';
        d.uploadingImg = false;
        renderShell();
        return;
      }
      const label = (file.name || 'imagem').replace(/\.[^.]+$/, '');
      const snippet = `![${label}](${data.path})`;
      const cur = d.draft != null ? d.draft : d.content || '';
      const caret = d.imgCaret;
      let pos = caret && typeof caret.start === 'number' ? caret.start : cur.length;
      let endPos = caret && typeof caret.end === 'number' ? caret.end : pos;
      pos = Math.min(Math.max(0, pos), cur.length);
      endPos = Math.min(Math.max(pos, endPos), cur.length);
      d.draft = cur.slice(0, pos) + snippet + cur.slice(endPos);
      const newCaret = pos + snippet.length;
      d.imgCaret = { start: newCaret, end: newCaret };
      d.uploadingImg = false;
      renderShell();
      const ta2 = document.querySelector('[data-doc-editor]');
      if (ta2) {
        ta2.focus();
        try {
          ta2.setSelectionRange(newCaret, newCaret);
        } catch (err) {
          /* ignore */
        }
      }
    } catch (error) {
      d.editError = error.message || 'Erro ao enviar imagem.';
      d.uploadingImg = false;
      renderShell();
    }
  }

  // Export the current document's content (frontmatter stripped) as a .txt download.
  function downloadDocTxt() {
    const d = state.docs;
    if (!d || !d.selectedPath) return;
    const selDoc = (d.list || []).find((x) => x.path === d.selectedPath);
    const text = stripDocFrontmatter(d.content || '');
    const raw = (selDoc && selDoc.title) || d.selectedPath.replace(/.*\//, '').replace(/\.md$/i, '') || 'documento';
    const base =
      raw
        .replace(/[\\/:*?"<>|]+/g, '-')
        .trim()
        .slice(0, 80) || 'documento';
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // All section names present in the docs list (excluding README), for expand/collapse-all.
  // Admin: convert the documentation into the docs skill (one capsule per page + spine) via the
  // capsule-import pipeline — the manifest lands in the Fila; approval applies it to the corpus.
  async function publishDocsSkill() {
    const d = state.docs;
    if (!d || d.publishingSkill) return;
    d.publishingSkill = true;
    renderShell();
    try {
      const res = await fetch('/api/admin/docs/publish-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        const first = data.errors && data.errors[0];
        toast(
          first ? `Conversão falhou: ${first.message}` : data.error || 'Falha ao converter a documentação.',
          'error'
        );
      } else if (data.unchanged) {
        toast(
          data.evalSeeded
            ? 'Documentação já sincronizada — avaliação-base da skill semeada.'
            : 'Documentação já sincronizada — nada mudou desde a última conversão.',
          'success'
        );
      } else {
        const skillWord = data.skillAction === 'create' ? 'skill criada' : 'skill atualizada';
        toast(
          `Enviado para a Fila: ${data.concepts} página(s) → cápsulas + ${skillWord}${data.evalSeeded ? ' (avaliação-base semeada)' : ''}. Aprove na Fila para aplicar.`,
          'success'
        );
        state.queuePendingCount = (state.queuePendingCount || 0) + 1;
      }
    } catch (error) {
      toast(error.message || 'Erro de rede na conversão.', 'error');
    }
    d.publishingSkill = false;
    renderShell();
  }

  function docsAllSectionNames() {
    const names = new Set();
    for (const doc of (state.docs && state.docs.list) || []) {
      if (/(^|\/)readme\.md$/i.test(doc.path)) continue;
      names.add((doc.section && String(doc.section).trim()) || 'Outros');
    }
    return names;
  }

  // Persisted docs-list width (px), clamped to the resize range. Survives sessions.
  function docsSavedWidth() {
    try {
      const w = Number(localStorage.getItem('balde-docs-width'));
      return w >= 180 && w <= 520 ? w : null;
    } catch (error) {
      return null;
    }
  }

  // Drag the docs-list ↔ content boundary to resize the list. Updates the CSS var live
  // (no re-render, so dragging stays smooth), then persists on release.
  function startDocsResize(event) {
    const view = document.querySelector('.docs-view');
    const handle = document.querySelector('[data-docs-resize]');
    if (!view) return;
    event.preventDefault();
    const startX = event.clientX;
    const startW = parseFloat(getComputedStyle(view).gridTemplateColumns) || (state.docs && state.docs.width) || 260;
    if (handle) handle.classList.add('is-dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMove = (ev) => {
      const w = Math.max(180, Math.min(520, Math.round(startW + (ev.clientX - startX))));
      view.style.setProperty('--docs-w', `${w}px`);
      if (state.docs) state.docs.width = w;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (handle) handle.classList.remove('is-dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (state.docs && state.docs.width) {
        try {
          localStorage.setItem('balde-docs-width', String(state.docs.width));
        } catch (error) {
          /* ignore */
        }
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  async function createDoc() {
    const d = state.docs;
    if (!d || d.createSaving) return;
    const rawName = (d.newPath || d.newTitle || '').trim();
    const base = rawName
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/\.md$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    if (!base) {
      d.createError = 'Informe um nome de arquivo.';
      renderShell();
      return;
    }
    const path = `${base}.md`;
    const title = (d.newTitle || base).trim();
    d.createSaving = true;
    d.createError = null;
    renderShell();
    try {
      const res = await fetch('/api/admin/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path,
          title,
          content: `---\nsection: ""\nsection_order: 1\norder: 1\ndownloadable: false\n---\n\n# ${title}\n\n`
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        d.createSaving = false;
        d.createError = data.error || 'Falha ao criar documento.';
        renderShell();
        return;
      }
      d.creating = false;
      d.createSaving = false;
      d.newPath = '';
      d.newTitle = '';
      try {
        const lr = await fetch('/api/docs');
        const lj = await lr.json().catch(() => ({}));
        if (lj && lj.ok && Array.isArray(lj.docs)) d.list = lj.docs;
      } catch {
        /* keep current list */
      }
      d.selectedPath = data.path;
      d.content = data.content || '';
      d.history = data.history || [];
      d.tooLarge = false;
      d.fileError = null;
      d.rawView = false;
      d.editing = true;
      d.draft = d.content;
      renderShell();
    } catch (error) {
      d.createSaving = false;
      d.createError = error.message || 'Erro de rede.';
      renderShell();
    }
  }

  return {
    stripDocFrontmatter,
    openDocs,
    openDocFile,
    focusDocEditor,
    saveDoc,
    uploadDocImage,
    downloadDocTxt,
    publishDocsSkill,
    docsAllSectionNames,
    startDocsResize,
    createDoc
  };
}
