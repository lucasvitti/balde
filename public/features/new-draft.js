export function createNewDraftFeature({
  state,
  escapeHtml,
  composeSkillIdClient,
  icon,
  loadDomainList,
  renderShell,
  provider,
  refresh,
  toast,
  openSkillInExplore,
  loadSkillMedia,
  pluralize
}) {
  function renderUploadModal() {
    const up = state.uploadModal;
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal wide-modal" role="dialog" aria-modal="true" aria-label="Importar skill">
          <h2>Importar skill (OKF)</h2>
          <p>Cole um <strong>SKILL.md</strong> com frontmatter OKF (<code>type · title · description</code>) e governança. Você entra como owner; a skill entra como Blueprint em <code>&lt;domínio&gt;/&lt;slug&gt;</code> e é versionada no git.</p>
          ${up.error ? `<div class="form-alert form-alert-error">${escapeHtml(up.error)}</div>` : ''}
          <div class="manual-form">
            <label>Domínio <span class="field-req">obrigatório</span>
              <select data-upload-field="domain">
                <option value="">— escolha um domínio —</option>
                ${((state.domainMine != null ? state.domainMine : state.domainList) || []).map((d) => `<option value="${escapeHtml(d)}" ${up.domain === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('')}
              </select>
            </label>
            <label>Subpasta (opcional)<input data-upload-field="subpath" value="${escapeHtml(up.subpath || '')}" placeholder="ex.: churn ou churn/mensal">
              <span class="field-hint">Sub-pastas livres sob o domínio. Resultado: <code>skills/${(() => {
                const p = composeSkillIdClient(up.domain, up.subpath, '');
                return p ? `${escapeHtml(p)}/&lt;slug&gt;` : '&lt;domínio&gt;/&lt;slug&gt;';
              })()}/</code></span>
            </label>
            <label>
              SKILL.md
              <textarea data-upload-field="content" rows="16" spellcheck="false" placeholder="---&#10;type: skill&#10;title: &quot;Minha Skill&quot;&#10;description: &quot;O que ela faz&quot;&#10;status: rascunho&#10;---&#10;## Papel&#10;Você é... Não invente números; recuse se faltar base.">${escapeHtml(up.content || '')}</textarea>
            </label>
          </div>
          <div class="row-actions">
            <button class="ghost-button" data-action="closeUpload">${icon('x')}Cancelar</button>
            <button class="primary-button" data-action="submitUpload" ${up.busy ? 'disabled' : ''}>${icon('upload')}${up.busy ? 'Enviando...' : 'Importar'}</button>
          </div>
        </section>
      </div>
    `;
  }

  function openUpload() {
    state.uploadModal = { content: '', domain: '', subpath: '', busy: false, error: null };
    if (!state.domainList) {
      loadDomainList();
    }
    renderShell();
  }

  function closeUpload() {
    state.uploadModal = null;
    renderShell();
  }

  async function submitUpload() {
    if (!state.uploadModal) {
      return;
    }
    const content = String(state.uploadModal.content || '').trim();
    if (!content.startsWith('---')) {
      state.uploadModal.error = 'Cole um SKILL.md com frontmatter (começando por ---).';
      renderShell();
      return;
    }
    const domain = String(state.uploadModal.domain || '').trim();
    if (!domain) {
      state.uploadModal.error = 'Escolha um domínio para a skill importada.';
      renderShell();
      return;
    }
    state.uploadModal.busy = true;
    state.uploadModal.error = null;
    renderShell();
    try {
      const res = await fetch('/api/skills/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ markdown: content, domain, subpath: String(state.uploadModal.subpath || '').trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        state.uploadModal.busy = false;
        state.uploadModal.error = data.error || `Falha ao importar (HTTP ${res.status}).`;
        renderShell();
        return;
      }
      state.uploadModal = null;
      await provider.reload();
      await refresh();
      toast(`Skill "${data.title || data.id}" importada.`, 'success');
      if (data.id) {
        await openSkillInExplore(data.id);
        loadSkillMedia(data.id);
      } else {
        renderShell();
      }
    } catch (error) {
      if (state.uploadModal) {
        state.uploadModal.busy = false;
        state.uploadModal.error = error.message || 'Erro de rede.';
      }
      renderShell();
    }
  }

  function renderNewSkillPage() {
    const d = state.draftModal;
    if (!d) {
      return '<section class="panel empty-state">Nenhum rascunho em edição.</section>';
    }
    const suggestions = corpusTagSuggestions(d.tags || [], 12);
    const fileList = (d.files || []).map((f) => escapeHtml(f.name)).join(', ');
    const hint = d.reading
      ? 'Lendo arquivos...'
      : fileList
        ? `Anexos: ${fileList}`
        : 'Opcional. Ex.: output_schema.json, exemplos, documentação. Um output_schema.json vira o resource da skill.';
    return `
      <section class="new-skill-page">
        <div class="new-skill-head">
          <button class="ghost-button" data-action="closeNewDraft" ${d.busy ? 'disabled' : ''}>${icon('rollback')}Voltar para skills</button>
        </div>
        <p class="new-skill-intro">O Balde gera um <strong>SKILL.md</strong> inicial (frontmatter OKF + governança) já com você como <strong>owner</strong>. A skill nasce como <strong>Blueprint</strong> e é versionada no git.</p>
          ${d.error ? `<div class="form-alert form-alert-error">${escapeHtml(d.error)}</div>` : ''}
          <div class="manual-form">
            <label>
              Título
              <input data-draft-field="title" value="${escapeHtml(d.title || '')}" placeholder="Ex.: Resumo de Reunião" ${d.busy ? 'disabled' : ''}>
            </label>
            <label>
              Descrição
              <textarea data-draft-field="description" rows="2" placeholder="Uma frase: o que a skill entrega." ${d.busy ? 'disabled' : ''}>${escapeHtml(d.description || '')}</textarea>
            </label>
            <div class="tag-field">
              <span class="tag-field-label">Tags</span>
              <div class="tag-input">
                ${(d.tags || []).map((t) => `<span class="tag-chip">${escapeHtml(t)}<button type="button" class="tag-chip-x" data-action="removeTag" data-tag="${escapeHtml(t)}" aria-label="Remover ${escapeHtml(t)}">×</button></span>`).join('')}
                <input class="tag-input-field" data-draft-tag-input value="${escapeHtml(d.tagDraft || '')}" placeholder="${d.tags && d.tags.length ? 'adicionar tag...' : 'reuniao, resumo...'}" ${d.busy ? 'disabled' : ''}>
              </div>
              ${suggestions.length ? `<div class="tag-suggest-row"><span class="tag-suggest-hint">Sugestões</span>${suggestions.map((t) => `<button type="button" class="tag-suggest" data-action="addTag" data-tag="${escapeHtml(t)}" ${d.busy ? 'disabled' : ''}>+ ${escapeHtml(t)}</button>`).join('')}</div>` : ''}
              <span class="field-hint">Enter ou vírgula adiciona. Clique numa sugestão para reaproveitar tags do corpus.</span>
            </div>
            <label>
              Objetivo <span class="field-req">obrigatório</span>
              <textarea data-draft-field="objetivo" rows="2" required aria-required="true" placeholder="O que a skill deve alcançar — é a definição principal (vai para a seção Papel do rascunho)." ${d.busy ? 'disabled' : ''}>${escapeHtml(d.objetivo || '')}</textarea>
            </label>
            <div class="draft-files-field">
              <span class="tag-field-label">Arquivos iniciais <span class="field-req field-req-soft">opcional</span></span>
              ${d.files && d.files.length ? `<div class="draft-file-chips">${(d.files || []).map((f) => `<span class="tag-chip">${icon('file')}${escapeHtml(f.name)}<button type="button" class="tag-chip-x" data-action="removeDraftFile" data-name="${escapeHtml(f.name)}" aria-label="Remover ${escapeHtml(f.name)}">×</button></span>`).join('')}</div>` : ''}
              <label class="draft-upload-row">
                <span class="field-hint">Enviar arquivo(s)</span>
                <input type="file" data-draft-file multiple ${d.busy ? 'disabled' : ''}>
              </label>
              <div class="draft-paste">
                <span class="field-hint">ou adicione um arquivo colando o conteúdo:</span>
                <input data-draft-field="pasteName" value="${escapeHtml(d.pasteName || '')}" placeholder="nome do arquivo (ex.: output_schema.json)" ${d.busy ? 'disabled' : ''}>
                <textarea data-draft-field="pasteContent" rows="4" placeholder="cole aqui o conteúdo do arquivo" ${d.busy ? 'disabled' : ''}>${escapeHtml(d.pasteContent || '')}</textarea>
                <button type="button" class="ghost-button small" data-action="addPastedFile" ${d.busy ? 'disabled' : ''}>${icon('check')}Adicionar arquivo</button>
              </div>
              <span class="field-hint">${hint}</span>
            </div>
          </div>
          <div class="row-actions">
            <button class="ghost-button" data-action="closeNewDraft" ${d.busy ? 'disabled' : ''}>${icon('x')}Cancelar</button>
            <button class="primary-button" data-action="submitNewDraft" ${d.busy || d.reading ? 'disabled' : ''}>${icon('edit')}${d.busy ? 'Criando...' : 'Criar Blueprint'}</button>
          </div>
      </section>
    `;
  }

  function openNewDraft() {
    state.draftModal = {
      title: '',
      description: '',
      tags: [],
      tagDraft: '',
      objetivo: '',
      files: [],
      pasteName: '',
      pasteContent: '',
      busy: false,
      reading: false,
      error: null
    };
    state.view = 'newSkill';
    renderShell();
  }

  // Uploaded + pasted starter files coexist; dedupe by name (newest wins).
  function mergeDraftFiles(existing, incoming) {
    const map = new Map((existing || []).map((f) => [f.name, f]));
    for (const f of incoming || []) {
      map.set(f.name, f);
    }
    return [...map.values()];
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(String(str));
    let binary = '';
    for (const b of bytes) {
      binary += String.fromCharCode(b);
    }
    return btoa(binary);
  }

  function base64ToUtf8(b64) {
    try {
      const binary = atob(String(b64 || ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    } catch (error) {
      return '';
    }
  }

  // Alternative to uploading a file: turn pasted text into a starter file.
  function addDraftPastedFile() {
    const d = state.draftModal;
    if (!d) {
      return;
    }
    const name = String(d.pasteName || '').trim();
    const content = String(d.pasteContent || '');
    if (!name) {
      d.error = 'Dê um nome ao arquivo (ex.: output_schema.json).';
      renderShell();
      return;
    }
    if (name.toLowerCase() === 'skill.md') {
      d.error = 'O SKILL.md é gerado automaticamente — use outro nome.';
      renderShell();
      return;
    }
    if (!content.trim()) {
      d.error = 'Cole o conteúdo do arquivo.';
      renderShell();
      return;
    }
    d.files = mergeDraftFiles(d.files, [{ name, base64: utf8ToBase64(content) }]);
    d.pasteName = '';
    d.pasteContent = '';
    d.error = null;
    renderShell();
  }

  function removeDraftFile(name) {
    const d = state.draftModal;
    if (!d) {
      return;
    }
    d.files = (d.files || []).filter((f) => f.name !== name);
    renderShell();
  }

  function closeNewDraft() {
    state.draftModal = null;
    if (state.view === 'newSkill') {
      state.view = 'skills';
    }
    renderShell();
  }

  function normalizeTag(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  // Domain slugs keep underscores (e.g. dados_vendas) to match commons ids — mirrors normalizeDomainServer.
  function normalizeDomain(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[-]+|[-]+$/g, '')
      .slice(0, 60);
  }

  // Suggestions = tags already in the loaded corpus, ranked by frequency, minus
  // the ones already picked. Reusing existing tags keeps the taxonomy consistent.
  function corpusTagSuggestions(selected, limit = 12) {
    const counts = new Map();
    for (const skill of state.skills || []) {
      for (const raw of skill.tags || []) {
        const tag = normalizeTag(raw);
        if (tag) {
          counts.set(tag, (counts.get(tag) || 0) + 1);
        }
      }
    }
    return [...counts.entries()]
      .filter(([tag]) => !selected.includes(tag))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([tag]) => tag);
  }

  function focusTagInput() {
    const el = document.querySelector('[data-draft-tag-input]');
    if (el) {
      el.focus();
    }
  }

  function addDraftTag(raw) {
    if (!state.draftModal) {
      return;
    }
    const tag = normalizeTag(raw);
    if (tag && !state.draftModal.tags.includes(tag)) {
      state.draftModal.tags.push(tag);
    }
    state.draftModal.tagDraft = '';
    renderShell();
    focusTagInput();
  }

  function removeDraftTag(tag) {
    if (!state.draftModal) {
      return;
    }
    state.draftModal.tags = state.draftModal.tags.filter((item) => item !== tag);
    renderShell();
    focusTagInput();
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo.'));
      reader.readAsDataURL(file);
    });
  }

  // Client-side pose optimization (piece 1): downscale to <= POSE_MAX_DIM px and
  // transcode to WebP so buddy avatars stay small. This keeps the server free of
  // image libraries (Docker untouched) — it only enforces a tight byte cap. Falls
  // back to the original bytes whenever the browser can't decode/encode the image.
  const POSE_MAX_DIM = 512;
  const POSE_WEBP_QUALITY = 0.82;

  async function optimizePoseImage(file) {
    const original = async () => {
      const dot = file.name.lastIndexOf('.');
      const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '.png';
      return { ext, base64: await readFileAsBase64(file), optimized: false };
    };
    // GIFs would lose their animation through a canvas — leave them untouched.
    if (/\.gif$/i.test(file.name) || file.type === 'image/gif') {
      return original();
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, POSE_MAX_DIM / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      if (bitmap.close) {
        bitmap.close();
      }
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', POSE_WEBP_QUALITY));
      if (!blob || !blob.size) {
        return original();
      }
      return { ext: '.webp', base64: await readFileAsBase64(blob), optimized: true };
    } catch (error) {
      return original();
    }
  }

  async function handleDraftFiles(fileList) {
    if (!state.draftModal) {
      return;
    }
    const files = Array.from(fileList || []);
    if (!files.length) {
      renderShell();
      return;
    }
    state.draftModal.reading = true;
    state.draftModal.error = null;
    renderShell();
    try {
      const read = [];
      for (const file of files) {
        read.push({ name: file.name, base64: await readFileAsBase64(file) });
      }
      if (state.draftModal) {
        state.draftModal.files = mergeDraftFiles(state.draftModal.files, read);
      }
    } catch (error) {
      if (state.draftModal) {
        state.draftModal.error = error.message || 'Falha ao ler arquivos.';
        state.draftModal.files = [];
      }
    }
    if (state.draftModal) {
      state.draftModal.reading = false;
    }
    renderShell();
  }

  async function submitNewDraft() {
    if (!state.draftModal) {
      return;
    }
    const d = state.draftModal;
    const title = String(d.title || '').trim();
    if (!title) {
      d.error = 'Informe um título para a skill.';
      renderShell();
      return;
    }
    const objetivo = String(d.objetivo || '').trim();
    if (!objetivo) {
      d.error = 'Informe o objetivo da skill — é a definição principal.';
      renderShell();
      const el = document.querySelector('[data-draft-field="objetivo"]');
      if (el) {
        el.focus();
      }
      return;
    }
    if (d.reading) {
      return;
    }
    const tags = [...(d.tags || [])];
    const leftover = normalizeTag(d.tagDraft);
    if (leftover && !tags.includes(leftover)) {
      tags.push(leftover);
    }
    d.busy = true;
    d.error = null;
    renderShell();
    try {
      const res = await fetch('/api/skills/new', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title,
          description: d.description,
          tags,
          objetivo,
          files: d.files || []
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        d.busy = false;
        d.error = data.error || `Falha ao criar Blueprint (HTTP ${res.status}).`;
        renderShell();
        return;
      }
      state.draftModal = null;
      await provider.reload();
      await refresh();
      const count = (data.files || []).length;
      const extra = count ? ` (+${pluralize(count, 'arquivo', 'arquivos')})` : '';
      toast(`Blueprint "${title}" criado${extra}.`, 'success');
      if (data.id) {
        await openSkillInExplore(data.id);
        loadSkillMedia(data.id);
      } else {
        renderShell();
      }
    } catch (error) {
      if (state.draftModal) {
        state.draftModal.busy = false;
        state.draftModal.error = error.message || 'Erro de rede.';
      }
      renderShell();
    }
  }

  return {
    renderUploadModal,
    openUpload,
    closeUpload,
    submitUpload,
    base64ToUtf8,
    addDraftPastedFile,
    removeDraftFile,
    normalizeDomain,
    addDraftTag,
    removeDraftTag,
    readFileAsBase64,
    optimizePoseImage,
    handleDraftFiles
  };
}
