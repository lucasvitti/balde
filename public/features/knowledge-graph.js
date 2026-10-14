export function createKnowledgeGraphFeature({
  icon,
  escapeHtml,
  permissionAttrs,
  state,
  renderShell,
  govStatusBadge,
  toast,
  refreshCommonsSilent,
  navigate,
  loadExploreCommonsConcept,
  openSkillInExplore
}) {
  let corpusCy = null; // live Cytoscape instance — NOT in state (non-serializable canvas island)

  const GRAPH_DEFAULT_OPTIONS = {
    layout: 'forca',
    colorBy: 'domain',
    sizeBy: 'aberturas',
    clusterBy: 'none',
    domains: [],
    hideCapsules: false,
    hideOrphans: false,
    q: ''
  };
  const GRAPH_DEFAULT_STYLE = {
    nodeBase: 18,
    sizeScale: 1,
    edgeOpacity: 0.55,
    edgeWidth: 1,
    labels: 'zoom',
    edgeLabels: false,
    labelSkills: true,
    labelCapsules: true,
    labelDomains: true
  };
  // Style presets: an options+style bundle applied at once (then tweakable). Persisted per-user.
  const GRAPH_PRESETS = {
    padrao: {
      options: { colorBy: 'domain', sizeBy: 'aberturas', clusterBy: 'none' },
      style: { ...GRAPH_DEFAULT_STYLE }
    },
    obsidian: {
      options: { colorBy: 'community', sizeBy: 'inDegree', clusterBy: 'none' },
      style: { nodeBase: 14, sizeScale: 1.3, edgeOpacity: 0.35, edgeWidth: 0.8, labels: 'zoom', edgeLabels: false }
    },
    governanca: {
      options: { colorBy: 'frescor', sizeBy: 'inDegree', clusterBy: 'none' },
      style: { nodeBase: 18, sizeScale: 1.1, edgeOpacity: 0.5, edgeWidth: 1, labels: 'sempre', edgeLabels: false }
    },
    dominios: {
      options: { colorBy: 'domain', sizeBy: 'aberturas', clusterBy: 'domain' },
      style: { nodeBase: 16, sizeScale: 1, edgeOpacity: 0.45, edgeWidth: 1, labels: 'zoom', edgeLabels: false }
    }
  };
  const GRAPH_PALETTE = [
    '#6b8afd',
    '#f2a65a',
    '#59c9a5',
    '#e46a8a',
    '#9b7ede',
    '#e3c33f',
    '#5ab3d6',
    '#e2795d',
    '#7fbf5a',
    '#c78ac1',
    '#8a8f98',
    '#d6a55c'
  ];
  // Node glyphs are inline SVG data-URIs: white strokes read over every palette color in both
  // themes (nodes are always saturated, never white). Body = the paths, viewBox 24x24.
  function svgNodeIcon(body, color = '#ffffff', stroke = 2.6) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
  }
  // O ícone É o nó: sem quadrado atrás, ele precisa carregar a COR do nó (que muda conforme o
  // "Colorir por"). Gerar o data-URI a cada avaliação de estilo seria caro com 300+ nós, então
  // memoriza por (categoria, cor) — na prática são poucas combinações.
  const graphIconCache = new Map();
  function graphCategoryIcon(categoria, color) {
    const def = capsuleCategoryDef(categoria);
    const ck = `${def.key}|${color}`;
    let uri = graphIconCache.get(ck);
    if (!uri) {
      uri = svgNodeIcon(def.icon || '', color, 2.2);
      graphIconCache.set(ck, uri);
    }
    return uri;
  }
  // Clock glyph drawn on temporal capsules (series episodes) — white strokes read on every
  // palette color in both themes (nodes are always saturated, never white).
  const GRAPH_CLOCK_ICON = svgNodeIcon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v4.5l3 2"/>', 2.6);
  // Ontologia do domínio: an open book replaces the category glyph — the vocabulary capsule
  // reads differently from ordinary capsules. Same icon-is-the-node treatment (tinted, cached).
  const GRAPH_ONTOLOGY_BODY =
    '<path d="M12 7c-1.7-1.5-3.9-2.2-6.5-2.2H3v13h2.5c2.6 0 4.8.7 6.5 2.2 1.7-1.5 3.9-2.2 6.5-2.2H21v-13h-2.5C15.9 4.8 13.7 5.5 12 7z"/><path d="M12 7v13"/>';
  function graphOntologyIcon(color) {
    const ck = `__onto|${color}`;
    let uri = graphIconCache.get(ck);
    if (!uri) {
      uri = svgNodeIcon(GRAPH_ONTOLOGY_BODY, color, 2.2);
      graphIconCache.set(ck, uri);
    }
    return uri;
  }
  // O vocabulário é GOVERNADO no servidor (Administração › Categorias) — a UI não tem lista fixa,
  // desenha o que vier de /api/capsule-categories. Os padrões abaixo só valem até a carga chegar.
  let capsuleCategoryList = [
    {
      key: 'dado',
      label: 'Ponto de dado',
      color: '#3b6fd4',
      hint: '',
      icon: '<rect x="4.5" y="12" width="4" height="7.5" rx="1"/><rect x="10" y="8" width="4" height="11.5" rx="1"/><rect x="15.5" y="4.5" width="4" height="15" rx="1"/>'
    }
  ];
  let capsuleCategoryDefault = 'dado';
  function capsuleCategoryDef(categoria) {
    const k = String(categoria || '');
    return (
      capsuleCategoryList.find((c) => c.key === k) ||
      capsuleCategoryList.find((c) => c.key === capsuleCategoryDefault) ||
      capsuleCategoryList[0] || { key: 'dado', label: 'Ponto de dado', color: '#3b6fd4', hint: '', icon: '' }
    );
  }
  function capsuleCategoryKey(categoria) {
    return capsuleCategoryDef(categoria).key;
  }
  async function loadCapsuleCategories() {
    try {
      const r = await fetch('/api/capsule-categories');
      const d = await r.json();
      if (d && d.ok && Array.isArray(d.categories) && d.categories.length) {
        capsuleCategoryList = d.categories;
        capsuleCategoryDefault = d.default || 'dado';
        graphIconCache.clear(); // cores/ícones podem ter mudado
      }
    } catch (error) {
      /* mantém o fallback */
    }
  }
  // Chip inline: ícone + rótulo, na cor da categoria. O SVG vem do vocabulário (já sanitizado
  // no servidor), então é interpolado como markup — nunca escapado, senão o desenho vira texto.
  function capsuleCategoryChip(categoria) {
    const c = capsuleCategoryDef(categoria);
    return `<span class="capsule-cat-chip" style="color:${escapeHtml(c.color)};border-color:${escapeHtml(c.color)}55;background:${escapeHtml(c.color)}14" title="${escapeHtml(c.hint || '')}">${capsuleCategoryGlyph(c)}${escapeHtml(c.label)}</span>`;
  }
  function capsuleCategoryGlyph(c) {
    return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${c.icon || ''}</svg>`;
  }
  // A RESERVED capsule at <domínio>/ontologia holds the domain's controlled vocabulary: a list
  // of canonical concepts, each with a definition and accepted synonyms. It's an ordinary
  // governed capsule (owner, cadence, ACL, git) — only the path is special. The server ALWAYS
  // feeds it to chat/MCP grounding; here the UI adds: a structured editor (round-trips the
  // conventional markdown below), badges on corpus lists, and a dedicated Mapa glyph.
  //
  // Markdown convention (context.md IS the source of truth — no sidecar database):
  //   # <título>
  //   <preâmbulo livre…>
  //   ## <termo canônico>
  //   <definição em prosa…>
  //   **Sinônimos:** a, b, c
  function isOntologyPath(path) {
    const parts = String(path || '').split('/');
    return parts.length === 2 && parts[1] === 'ontologia';
  }
  const ONTOLOGY_SYN_RE = /^\*\*Sin[oô]nimos:?\*\*:?\s*(.*)$/i;
  function parseOntologyMarkdown(md) {
    const text = String(md || '').replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    let title = '';
    let i = 0;
    while (i < lines.length && !lines[i].trim()) i++;
    if (i < lines.length && /^#\s+/.test(lines[i])) {
      title = lines[i].replace(/^#\s+/, '').trim();
      i++;
    }
    const preambleLines = [];
    while (i < lines.length && !/^##\s+/.test(lines[i])) {
      preambleLines.push(lines[i]);
      i++;
    }
    const concepts = [];
    let cur = null;
    for (; i < lines.length; i++) {
      const line = lines[i];
      if (/^##\s+/.test(line)) {
        if (cur) concepts.push(cur);
        cur = { termo: line.replace(/^##\s+/, '').trim(), definicao: '', sin: '' };
        continue;
      }
      if (!cur) continue;
      const syn = line.match(ONTOLOGY_SYN_RE);
      if (syn) {
        cur.sin = syn[1].trim();
        continue;
      }
      cur.definicao += (cur.definicao ? '\n' : '') + line;
    }
    if (cur) concepts.push(cur);
    for (const c of concepts) c.definicao = c.definicao.trim();
    return { title, preamble: preambleLines.join('\n').trim(), concepts };
  }
  function buildOntologyMarkdown(ed) {
    const parts = [`# ${(ed.title || `Ontologia do domínio ${ed.domain}`).trim()}`];
    if ((ed.preamble || '').trim()) parts.push((ed.preamble || '').trim());
    for (const c of ed.concepts) {
      const termo = String(c.termo || '').trim();
      if (!termo) continue;
      let section = `## ${termo}`;
      const def = String(c.definicao || '').trim();
      if (def) section += `\n${def}`;
      const sins = String(c.sin || '')
        .split(/[,;]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sins.length) section += `\n\n**Sinônimos:** ${sins.join(', ')}`;
      parts.push(section);
    }
    return `${parts.join('\n\n')}\n`;
  }
  function ontologyChip() {
    return `<span class="onto-chip" title="Ontologia do domínio — vocabulário canônico, sempre incluída no contexto do chat e do MCP">${icon('ontology')}ontologia</span>`;
  }

  // Ontologias page (own nav category): every governed domain × its ontology — state, concept
  // count, freshness — with open/create/edit actions. Replaces the old hub modal on Cápsulas.
  async function openOntologias() {
    state.ontologias = { loading: true, error: null, rows: [] };
    renderShell();
    try {
      const [domRes, commonsRes] = await Promise.all([fetch('/api/domains'), fetch('/api/commons')]);
      const dom = await domRes.json().catch(() => ({}));
      const com = await commonsRes.json().catch(() => ({}));
      const concepts = (com && com.concepts) || [];
      const byDomain = new Map(concepts.filter((c) => isOntologyPath(c.path)).map((c) => [c.path.split('/')[0], c]));
      const mine = new Set(dom.mine || []);
      const canManage = !!(com && com.canManage);
      const rows = await Promise.all(
        (dom.domains || []).map(async (d) => {
          const concept = byDomain.get(d) || null;
          const row = {
            domain: d,
            has: !!concept,
            canCreate: canManage && mine.has(d),
            canEdit: canManage,
            governance: (concept && concept.governance) || null,
            concepts: null,
            updated: null
          };
          if (concept) {
            try {
              const fr = await fetch(`/api/commons/file?path=${encodeURIComponent(`${d}/ontologia`)}`);
              const fd = await fr.json().catch(() => ({}));
              if (fd && fd.ok && !fd.tooLarge) {
                row.concepts = parseOntologyMarkdown(fd.content || '').concepts.length;
                row.updated = (fd.history && fd.history[0]) || null;
              }
            } catch (error) {
              /* count stays unknown */
            }
          }
          return row;
        })
      );
      state.ontologias = { loading: false, error: null, rows };
    } catch (error) {
      state.ontologias = { loading: false, error: error.message || 'Erro ao carregar domínios.', rows: [] };
    }
    renderShell();
  }
  function renderOntologiasView() {
    const st = state.ontologias || { loading: true, rows: [] };
    if (st.loading) return '<section class="panel"><div class="repo-empty">Carregando ontologias…</div></section>';
    if (st.error) return `<section class="panel"><div class="repo-empty">${escapeHtml(st.error)}</div></section>`;
    const defined = st.rows.filter((r) => r.has).length;
    const rows = st.rows
      .map(
        (r) => `
      <tr class="onto-page-row${r.has ? '' : ' is-missing'}">
        <td><span class="onto-page-domain">${icon(r.has ? 'ontology' : 'folder')}<strong>${escapeHtml(r.domain)}</strong></span></td>
        <td>${r.has ? `<span class="onto-hub-status has">${icon('check')}definida</span>` : '<span class="onto-hub-status">sem ontologia</span>'}</td>
        <td>${r.has ? (r.concepts != null ? `${r.concepts} conceito(s)` : '<span class="muted">—</span>') : '<span class="muted">—</span>'}</td>
        <td>${r.has && r.governance ? govStatusBadge(r.governance.status || 'never') : '<span class="muted">—</span>'}</td>
        <td class="onto-page-updated">${r.updated ? `${escapeHtml(r.updated.author || '')}${r.updated.date ? ` · ${escapeHtml(String(r.updated.date).slice(0, 10))}` : ''}` : '<span class="muted">—</span>'}</td>
        <td><span class="onto-page-actions">
          ${
            r.has
              ? `
            <button class="ghost-button small" data-action="ontologyOpen" data-domain="${escapeHtml(r.domain)}">${icon('folder')}Abrir</button>
            ${r.canEdit ? `<button class="ghost-button small" data-action="ontologyEdit" data-domain="${escapeHtml(r.domain)}">${icon('edit')}Editor</button>` : ''}
            ${r.canCreate ? `<button class="ghost-button small" data-action="ontologySuggestAi" data-domain="${escapeHtml(r.domain)}" ${r.busy ? 'disabled' : ''}>${icon('spark')}${r.busy ? 'Sugerindo…' : 'Sugerir com IA'}</button>` : ''}`
              : r.canCreate
                ? `
            <button class="ghost-button small" data-action="ontologyCreate" data-domain="${escapeHtml(r.domain)}" ${r.busy ? 'disabled' : permissionAttrs('curar')}>${icon('plus')}Criar</button>
            <button class="ghost-button small" data-action="ontologyCreateAi" data-domain="${escapeHtml(r.domain)}" ${r.busy ? 'disabled' : permissionAttrs('curar')}>${icon('spark')}${r.busy ? 'Gerando…' : 'Criar com IA'}</button>`
                : '<span class="muted">—</span>'
          }
        </span></td>
      </tr>`
      )
      .join('');
    return `
      <section class="panel">
        <div class="section-heading">
          <div><p class="eyebrow">Corpus · vocabulário controlado</p><h2>Ontologias</h2></div>
          <div class="section-heading-actions"><span class="readonly-tag">${defined}/${st.rows.length} domínio(s) com ontologia</span></div>
        </div>
        <p class="gov-counts">A ontologia de um domínio é uma cápsula reservada (<code>&lt;domínio&gt;/ontologia</code>) com os <strong>conceitos canônicos, definições e sinônimos aceitos</strong>. Ela é sempre incluída no contexto do chat e das chamadas de máquina (MCP/API) como definição básica do domínio — e é governada como qualquer cápsula (dono, cadência, ACL, git).</p>
        <div class="table-scroll">
          <table class="onto-page-table">
            <thead><tr><th>Domínio</th><th>Situação</th><th>Conceitos</th><th>Frescor</th><th>Última edição</th><th>Ações</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="6"><div class="repo-empty">Nenhum domínio no vocabulário.</div></td></tr>'}</tbody>
          </table>
        </div>
      </section>`;
  }

  // Editor: structured rows ↔ the conventional markdown, saved through the SAME endpoints the
  // capsule wizard uses (/api/commons/edit prefill → /api/commons/update). No new write surface.
  async function openOntologyEditor(domain) {
    const path = `${domain}/ontologia`;
    state.ontologyEditor = {
      domain,
      path,
      loading: true,
      saving: false,
      error: null,
      title: '',
      summary: '',
      preamble: '',
      concepts: []
    };
    renderShell();
    try {
      const res = await fetch(`/api/commons/edit?path=${encodeURIComponent(path)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Falha ao abrir (HTTP ${res.status}).`);
      const parsed = parseOntologyMarkdown(data.body || '');
      state.ontologyEditor = {
        domain,
        path,
        loading: false,
        saving: false,
        error: null,
        title: parsed.title || data.title || `Ontologia do domínio ${domain}`,
        summary: data.summary || '',
        preamble: parsed.preamble,
        concepts: parsed.concepts.length ? parsed.concepts : [{ termo: '', definicao: '', sin: '' }]
      };
    } catch (error) {
      state.ontologyEditor = {
        domain,
        path,
        loading: false,
        saving: false,
        error: error.message,
        title: '',
        summary: '',
        preamble: '',
        concepts: []
      };
    }
    renderShell();
  }
  // New-ontology editor: NOTHING is written until the human saves (Criar = empty rows;
  // Criar com IA = rows prefilled from the AI suggestion). Save posts /api/commons/new.
  const ONTOLOGY_DEFAULT_SUMMARY =
    'Vocabulário canônico do domínio: conceitos e sinônimos aceitos — sempre incluída no contexto do chat e do MCP.';
  function openOntologyEditorNew(domain, parsed = null, aiSuggested = false) {
    state.ontologyEditor = {
      domain,
      path: `${domain}/ontologia`,
      isNew: true,
      aiSuggested,
      loading: false,
      saving: false,
      error: null,
      title: (parsed && parsed.title) || `Ontologia do domínio ${domain}`,
      summary: ONTOLOGY_DEFAULT_SUMMARY,
      preamble: (parsed && parsed.preamble) || '',
      concepts:
        parsed && parsed.concepts && parsed.concepts.length ? parsed.concepts : [{ termo: '', definicao: '', sin: '' }]
    };
    renderShell();
  }
  // Additions for an EXISTING ontology: the AI proposes new concepts and extra synonyms;
  // they are MERGED into the loaded editor (marked for review) — the human saves or discards.
  function ontologyNormTerm(t) {
    return String(t || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();
  }
  function mergeOntologySuggestions(ed, parsed) {
    const byTerm = new Map(ed.concepts.map((c) => [ontologyNormTerm(c.termo), c]));
    let added = 0;
    let synMerged = 0;
    for (const s of parsed.concepts) {
      const key = ontologyNormTerm(s.termo);
      if (!key) continue;
      const existing = byTerm.get(key);
      if (existing) {
        const have = String(existing.sin || '')
          .split(/[,;]/)
          .map((x) => x.trim())
          .filter(Boolean);
        const haveNorm = new Set(have.map(ontologyNormTerm));
        const news = String(s.sin || '')
          .split(/[,;]/)
          .map((x) => x.trim())
          .filter((x) => x && !haveNorm.has(ontologyNormTerm(x)));
        if (news.length) {
          existing.sin = [...have, ...news].join(', ');
          existing.suggestedSyn = true;
          synMerged += 1;
        }
        // A definition on an existing term is deliberately IGNORED: additions never rewrite.
      } else {
        ed.concepts.push({ termo: s.termo, definicao: s.definicao || '', sin: s.sin || '', suggested: true });
        byTerm.set(key, ed.concepts[ed.concepts.length - 1]);
        added += 1;
      }
    }
    return { added, synMerged };
  }
  async function ontologySuggestAdditionsAi(domain) {
    const st = state.ontologias;
    const row = st && st.rows.find((r) => r.domain === domain);
    if (row) {
      row.busy = true;
      renderShell();
    }
    try {
      const res = await fetch('/api/ontology/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Falha ao gerar (HTTP ${res.status}).`);
      const parsed = parseOntologyMarkdown(data.markdown || '');
      if (!parsed.concepts.length) {
        toast('A IA não encontrou adições para esta ontologia.');
        return;
      }
      await openOntologyEditor(domain);
      const ed = state.ontologyEditor;
      if (!ed || ed.error) return; // editor load failed — its own error shows
      const { added, synMerged } = mergeOntologySuggestions(ed, parsed);
      if (!added && !synMerged) {
        toast('As sugestões da IA já estavam todas na ontologia.');
        renderShell();
        return;
      }
      ed.aiAdditions = { added, synMerged };
      toast(`${added} conceito(s) novo(s) · sinônimos em ${synMerged} conceito(s) — revise e salve.`);
      renderShell();
    } catch (error) {
      toast(error.message || 'Falha ao gerar a sugestão.');
    } finally {
      if (row) {
        row.busy = false;
        renderShell();
      }
    }
  }
  async function ontologyCreateAi(domain) {
    const st = state.ontologias;
    const row = st && st.rows.find((r) => r.domain === domain);
    if (row) {
      row.busy = true;
      renderShell();
    }
    try {
      const res = await fetch('/api/ontology/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Falha ao gerar (HTTP ${res.status}).`);
      const parsed = parseOntologyMarkdown(data.markdown || '');
      if (!parsed.concepts.length)
        throw new Error('A sugestão da IA veio sem conceitos — tente de novo ou crie manualmente.');
      toast(`Sugestão gerada com ${parsed.concepts.length} conceito(s) — revise antes de salvar.`);
      openOntologyEditorNew(domain, parsed, true);
    } catch (error) {
      toast(error.message || 'Falha ao gerar a sugestão.');
    } finally {
      if (row) {
        row.busy = false;
        renderShell();
      }
    }
  }
  function renderOntologyEditorModal() {
    const ed = state.ontologyEditor;
    const rows = (ed.concepts || [])
      .map(
        (c, i) => `
      <div class="onto-row${c.suggested ? ' is-suggested' : ''}">
        <div class="onto-row-head">
          <input class="onto-termo" data-onto-field="termo" data-i="${i}" value="${escapeHtml(c.termo)}" placeholder="Termo canônico (ex.: Reajuste)">
          ${c.suggested ? '<span class="onto-sug-chip" title="Conceito novo sugerido pela IA — revise antes de salvar">novo (IA)</span>' : c.suggestedSyn ? '<span class="onto-sug-chip" title="Sinônimos adicionados pela IA — revise antes de salvar">sinônimos (IA)</span>' : ''}
          <button class="icon-button" data-action="ontologyRemoveConcept" data-i="${i}" aria-label="Remover conceito" title="Remover conceito">${icon('x')}</button>
        </div>
        <textarea class="onto-def" data-onto-field="definicao" data-i="${i}" rows="2" placeholder="Definição do conceito, em prosa.">${escapeHtml(c.definicao)}</textarea>
        <input class="onto-sin" data-onto-field="sin" data-i="${i}" value="${escapeHtml(c.sin)}" placeholder="Sinônimos aceitos, separados por vírgula (ex.: reprecificação, reprice)">
      </div>`
      )
      .join('');
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal wide-modal onto-editor" role="dialog" aria-modal="true" aria-label="Editor de ontologia">
          <div class="modal-head">
            <h3>${icon('ontology')}Ontologia — <code>${escapeHtml(ed.domain)}</code></h3>
            <button class="icon-button" data-action="ontologyEditorClose" aria-label="Fechar">${icon('x')}</button>
          </div>
          ${
            ed.loading
              ? '<div class="repo-empty">Carregando…</div>'
              : ed.error
                ? `<div class="repo-empty">${escapeHtml(ed.error)}</div>`
                : `
          <p class="field-hint">Cada conceito vira uma seção da cápsula <code>commons/${escapeHtml(ed.path)}</code> — o texto continua legível como markdown e entra automaticamente no contexto do chat e do MCP deste domínio.</p>
          ${ed.isNew ? `<p class="field-hint onto-new-hint">${ed.aiSuggested ? `${icon('spark')}<strong>Sugestão gerada por IA</strong> a partir do material do domínio — revise, ajuste e remova o que não fizer sentido antes de salvar.` : `${icon('plus')}Nova ontologia — a cápsula só é criada quando você salvar.`}</p>` : ''}
          ${ed.aiAdditions ? `<p class="field-hint onto-new-hint">${icon('spark')}<strong>Adições sugeridas pela IA</strong> — ${ed.aiAdditions.added} conceito(s) novo(s) e sinônimos em ${ed.aiAdditions.synMerged} conceito(s), marcados abaixo. Revise, ajuste e remova o que não fizer sentido antes de salvar.</p>` : ''}
          <label class="onto-preamble-label">Preâmbulo <small>(opcional — texto de abertura da cápsula)</small>
            <textarea class="onto-preamble" data-onto-field="preamble" rows="2" placeholder="Contexto geral do vocabulário deste domínio.">${escapeHtml(ed.preamble)}</textarea>
          </label>
          <div class="onto-rows">${rows || '<div class="repo-empty">Nenhum conceito ainda.</div>'}</div>
          <div class="onto-editor-actions">
            <button class="ghost-button small" data-action="ontologyAddConcept">${icon('plus')}Adicionar conceito</button>
            <span class="onto-editor-spacer"></span>
            <button class="ghost-button small" data-action="ontologyEditorClose">Cancelar</button>
            <button class="primary-button small" data-action="ontologySave" ${ed.saving ? 'disabled' : permissionAttrs('curar')}>${ed.saving ? 'Salvando…' : ed.isNew ? 'Criar ontologia' : 'Salvar ontologia'}</button>
          </div>`
          }
        </section>
      </div>`;
  }
  function closeOntologyEditor() {
    state.ontologyEditor = null;
    renderShell();
  }
  function ontologyAddConcept() {
    const ed = state.ontologyEditor;
    if (!ed) return;
    ed.concepts.push({ termo: '', definicao: '', sin: '' });
    renderShell();
  }
  function ontologyRemoveConcept(i) {
    const ed = state.ontologyEditor;
    if (!ed || !ed.concepts[Number(i)]) return;
    ed.concepts.splice(Number(i), 1);
    renderShell();
  }
  async function saveOntology() {
    const ed = state.ontologyEditor;
    if (!ed || ed.saving) return;
    ed.saving = true;
    renderShell();
    try {
      const body = buildOntologyMarkdown(ed);
      if (!ed.concepts.some((c) => String(c.termo || '').trim()))
        throw new Error('Adicione ao menos um conceito com termo.');
      const res = ed.isNew
        ? await fetch('/api/commons/new', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              domain: ed.domain,
              concept: 'ontologia',
              title: ed.title,
              summary: ed.summary,
              body,
              categoria: capsuleCategoryDefault
            })
          })
        : await fetch('/api/commons/update', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            // title/summary echoed from the prefill: /api/commons/update deletes an omitted summary.
            body: JSON.stringify({ path: ed.path, title: ed.title, summary: ed.summary, body })
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `Falha ao salvar (HTTP ${res.status}).`);
      toast(ed.isNew ? `Ontologia do domínio ${ed.domain} criada.` : 'Ontologia salva.');
      state.ontologyEditor = null;
      state.commonsIndex = null;
      if (state.commons) state.commons.data = null;
      if (state.explore && state.explore.commonsFile && state.explore.commonsFile.path === ed.path)
        state.explore.commonsFile = null;
      renderShell();
      if (state.view === 'ontologias') await openOntologias();
      refreshCommonsSilent && refreshCommonsSilent();
    } catch (error) {
      ed.saving = false;
      ed.error = null;
      toast(error.message || 'Falha ao salvar a ontologia.');
      renderShell();
    }
  }
  // Open the ontology capsule in the corpus explorer (read view).
  async function openOntologyInExplorer(domain) {
    const path = `${domain}/ontologia`;
    await navigate('explore');
    if (state.explore) state.explore.navStack = [];
    await loadExploreCommonsConcept(path);
  }
  // Cápsula sem categoria gravada lê-se como 'dado' — o padrão histórico do corpus.

  // Glyphs desenhados sobre o nó no Mapa — traço branco, legível sobre qualquer cor da paleta.
  const GRAPH_STATUS_COLORS = {
    canonico: '#2f9e63',
    green: '#2f9e63',
    rascunho: '#d9a13b',
    'due-soon': '#e3c33f',
    overdue: '#d9534f',
    never: '#8a8f98',
    closed: '#5b7fa6'
  };
  const GRAPH_FRESCOR_COLORS = { verde: '#2f9e63', amarelo: '#e3c33f', vermelho: '#d9534f', neutro: '#8a8f98' };

  function ensureGraphState() {
    if (!state.graphView)
      state.graphView = {
        loading: false,
        error: null,
        data: null,
        selected: null,
        focus: null,
        stylePanel: false,
        preset: 'padrao',
        prefsLoaded: false,
        toolbarCollapsed: false
      };
    const g = state.graphView;
    g.options = { ...GRAPH_DEFAULT_OPTIONS, ...(g.options || {}) };
    if (!Array.isArray(g.options.domains)) g.options.domains = []; // pre-multiselect session state
    g.style = { ...GRAPH_DEFAULT_STYLE, ...(g.style || {}) };
    return g;
  }

  async function loadGraphPrefs() {
    const g = ensureGraphState();
    if (g.prefsLoaded) return;
    g.prefsLoaded = true;
    try {
      const res = await fetch('/api/me/prefs');
      const data = await res.json().catch(() => ({}));
      const gp = data && data.graph;
      if (gp && typeof gp === 'object') {
        const o = gp.options || {};
        for (const k of ['layout', 'colorBy', 'sizeBy', 'clusterBy']) if (typeof o[k] === 'string') g.options[k] = o[k];
        g.style = { ...GRAPH_DEFAULT_STYLE, ...(gp.style || {}) };
        if (typeof gp.preset === 'string' && GRAPH_PRESETS[gp.preset]) g.preset = gp.preset;
        g.toolbarCollapsed = Boolean(gp.toolbarCollapsed);
      }
    } catch (error) {
      /* defaults */
    }
  }

  let graphPrefsTimer = null;
  function saveGraphPrefsDebounced() {
    clearTimeout(graphPrefsTimer);
    graphPrefsTimer = setTimeout(() => {
      const g = state.graphView;
      if (!g) return;
      const { layout, colorBy, sizeBy, clusterBy } = g.options;
      fetch('/api/me/prefs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          graph: {
            options: { layout, colorBy, sizeBy, clusterBy },
            style: g.style,
            preset: g.preset,
            toolbarCollapsed: g.toolbarCollapsed
          }
        })
      }).catch(() => {});
    }, 600);
  }

  function destroyCorpusCy() {
    if (corpusCy) {
      try {
        corpusCy.destroy();
      } catch (error) {
        /* already gone */
      }
      corpusCy = null;
    }
  }

  async function openGraphView(force = false) {
    const g = ensureGraphState();
    state.view = 'graph';
    await loadGraphPrefs();
    if (!g.data || force) {
      g.loading = true;
      g.error = null;
      renderShell();
      try {
        const res = await fetch('/api/corpus/graph-full');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.ok) {
          g.error = data.error || `Falha ao carregar o grafo (HTTP ${res.status}).`;
          g.data = null;
        } else g.data = data;
      } catch (error) {
        g.error = error.message || 'Erro de rede.';
        g.data = null;
      }
      g.loading = false;
    }
    renderShell();
  }

  async function graphRefresh() {
    const g = ensureGraphState();
    g.loading = true;
    renderShell();
    try {
      await fetch('/api/corpus/graph-rebuild', { method: 'POST' });
    } catch (error) {
      /* the re-fetch below reports */
    }
    g.data = null;
    await openGraphView(true);
  }

  function renderGraphView() {
    const g = ensureGraphState();
    if (g.loading && !g.data)
      return '<section class="panel"><div class="repo-empty">Carregando o mapa de conhecimento…</div></section>';
    if (g.error) return `<section class="panel"><div class="repo-empty">${escapeHtml(g.error)}</div></section>`;
    if (!g.data) return '<section class="panel"><div class="repo-empty">Abrindo o mapa…</div></section>';
    const o = g.options;
    const domains = [...new Set((g.data.nodes || []).map((n) => n.domain).filter(Boolean))].sort();
    const sel = (name, val, opts) =>
      `<select data-graph-opt="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(v) === String(val) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const st = g.data.stats || {};
    return `
      <section class="graph-page">
        <div class="graph-toolbar ${g.toolbarCollapsed ? 'collapsed' : ''}">
          <button class="icon-button graph-collapse" data-action="graphToolbarToggle" aria-expanded="${!g.toolbarCollapsed}" title="${g.toolbarCollapsed ? 'Mostrar opções' : 'Recolher opções'}">${icon('chevron')}</button>
          <div class="graph-tools">
          <label>Arranjo ${sel('layout', o.layout, [
            ['forca', 'Força'],
            ['concentrico', 'Concêntrico'],
            ['circulo', 'Círculo'],
            ['grade', 'Grade'],
            ['arvore', 'Árvore']
          ])}</label>
          <label>Cor ${sel('colorBy', o.colorBy, [
            ['domain', 'Domínio'],
            ['kind', 'Tipo'],
            ['community', 'Comunidade'],
            ['status', 'Status'],
            ['frescor', 'Frescor']
          ])}</label>
          <label>Tamanho ${sel('sizeBy', o.sizeBy, [
            ['aberturas', 'Aberturas'],
            ['execucoes', 'Execuções'],
            ['inDegree', 'Referências recebidas'],
            ['outDegree', 'Referências feitas'],
            ['uniforme', 'Uniforme']
          ])}</label>
          <label>Agrupar ${sel('clusterBy', o.clusterBy, [
            ['none', 'não agrupar'],
            ['domain', 'por domínio'],
            ['community', 'por comunidade']
          ])}</label>
          <span class="graph-domsel">
            <button type="button" class="graph-domsel-btn" data-action="graphDomainsToggle">Domínio: <strong data-graph-domsel-label>${escapeHtml(graphDomainsLabel(o.domains))}</strong> ▾</button>
            <div class="graph-domsel-pop" data-graph-domsel-pop hidden>
              <label class="gds-item"><input type="checkbox" data-graph-domain-all ${o.domains.length ? '' : 'checked'}> todos</label>
              ${domains.map((d) => `<label class="gds-item"><input type="checkbox" data-graph-domain="${escapeHtml(d)}" ${o.domains.includes(d) ? 'checked' : ''}> ${escapeHtml(d)}</label>`).join('')}
            </div>
          </span>
          <label class="graph-check"><input type="checkbox" data-graph-opt="hideCapsules" ${o.hideCapsules ? 'checked' : ''}> ocultar cápsulas</label>
          <label class="graph-check"><input type="checkbox" data-graph-opt="hideOrphans" ${o.hideOrphans ? 'checked' : ''}> ocultar órfãos</label>
          <span class="graph-find">${icon('search')}<input data-graph-search value="${escapeHtml(o.q || '')}" placeholder="localizar nó…" aria-label="Localizar nó"></span>
          <button class="ghost-button small ${g.stylePanel ? 'active' : ''}" data-action="graphStyleToggle">${icon('edit')}Estilo</button>
          <button class="ghost-button small" data-action="graphRefresh">${icon('spark')}Atualizar</button>
          </div>
          ${g.focus ? `<span class="graph-focus-chip">Foco: <strong>${escapeHtml(corpusGraphNodeLabel(g.focus.id))}</strong> · ${g.focus.hops} salto(s)<button data-action="graphFocusExit" aria-label="Sair do foco" title="Sair do foco">✕</button></span>` : ''}
          <span class="graph-stats">${st.skills ?? 0} skills · ${st.capsules ?? 0} cápsulas · ${st.edges ?? 0} conexões</span>
        </div>
        <div class="graph-stage">
          <div id="corpus-cy" aria-label="Mapa de conhecimento"></div>
          ${g.stylePanel ? renderGraphStylePanel(g) : ''}
          <aside class="graph-card" id="graph-card">${graphCardHtml(null)}</aside>
        </div>
      </section>`;
  }

  function corpusGraphNodeLabel(id) {
    const g = state.graphView;
    const n = g && g.data && (g.data.nodes || []).find((x) => x.id === id);
    return (n && n.label) || id;
  }

  // The style editor: preset + sliders/selects, applied live via the cy API and auto-saved
  // to the user's profile (debounced). "Restaurar padrão" re-applies the padrao preset.
  function renderGraphStylePanel(g) {
    const s = g.style;
    const row = (label, control) => `<div class="gsp-row"><small>${label}</small>${control}</div>`;
    const presetOpts = [
      ['padrao', 'Padrão'],
      ['obsidian', 'Obsidian'],
      ['governanca', 'Heatmap de governança'],
      ['dominios', 'Mapa de domínios']
    ];
    return `
      <aside class="graph-style-panel">
        <div class="gsp-head"><strong>Estilo</strong><button class="icon-button" data-action="graphStyleToggle" aria-label="Fechar">${icon('x')}</button></div>
        ${row('Preset', `<select data-graph-preset>${presetOpts.map(([v, l]) => `<option value="${v}" ${g.preset === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${row('Tamanho base', `<input type="range" min="8" max="30" step="1" value="${s.nodeBase}" data-graph-style="nodeBase">`)}
        ${row('Escala por métrica', `<input type="range" min="0" max="2.5" step="0.1" value="${s.sizeScale}" data-graph-style="sizeScale">`)}
        ${row('Opacidade das arestas', `<input type="range" min="0.05" max="1" step="0.05" value="${s.edgeOpacity}" data-graph-style="edgeOpacity">`)}
        ${row('Espessura das arestas', `<input type="range" min="0.3" max="3" step="0.1" value="${s.edgeWidth}" data-graph-style="edgeWidth">`)}
        ${row(
          'Rótulos dos nós',
          `<select data-graph-style="labels">${[
            ['zoom', 'ao aproximar'],
            ['sempre', 'sempre'],
            ['nunca', 'nunca']
          ]
            .map(([v, l]) => `<option value="${v}" ${s.labels === v ? 'selected' : ''}>${l}</option>`)
            .join('')}</select>`
        )}
        ${row(
          'Mostrar rótulos de',
          `<span class="gsp-checks">
          <label><input type="checkbox" data-graph-style="labelSkills" ${s.labelSkills !== false ? 'checked' : ''}> skills</label>
          <label><input type="checkbox" data-graph-style="labelCapsules" ${s.labelCapsules !== false ? 'checked' : ''}> cápsulas</label>
          <label><input type="checkbox" data-graph-style="labelDomains" ${s.labelDomains !== false ? 'checked' : ''}> domínios</label>
        </span>`
        )}
        ${row('Nº de links nas arestas', `<input type="checkbox" data-graph-style="edgeLabels" ${s.edgeLabels ? 'checked' : ''}>`)}
        <button class="ghost-button small" data-action="graphStyleReset">Restaurar padrão</button>
        <p class="gsp-hint">Salvo automaticamente no seu perfil.</p>
      </aside>`;
  }

  function graphSetStyle(field, value) {
    const g = ensureGraphState();
    if (field === 'labels') g.style.labels = String(value);
    else if (field === 'edgeLabels' || field === 'labelSkills' || field === 'labelCapsules' || field === 'labelDomains')
      g.style[field] = Boolean(value);
    else g.style[field] = Number(value);
    saveGraphPrefsDebounced();
    if (!corpusCy) return;
    if (field === 'labels') {
      mountCorpusGraph();
      return;
    } // min-zoomed-font-size is a plain prop → remount
    corpusCy.style().update(); // sliders + edge labels are function mappers → live
  }

  function graphStyleToggle() {
    const g = ensureGraphState();
    g.stylePanel = !g.stylePanel;
    renderShell();
  }

  // Collapse/expand the settings bar — direct-DOM (a renderShell would remount the canvas and
  // re-randomize the layout). The collapsed state persists on the profile with the style prefs.
  function graphToolbarToggle() {
    const g = ensureGraphState();
    g.toolbarCollapsed = !g.toolbarCollapsed;
    const bar = document.querySelector('.graph-page .graph-toolbar');
    if (bar) {
      bar.classList.toggle('collapsed', g.toolbarCollapsed);
      const btn = bar.querySelector('.graph-collapse');
      if (btn) {
        btn.setAttribute('aria-expanded', String(!g.toolbarCollapsed));
        btn.title = g.toolbarCollapsed ? 'Mostrar opções' : 'Recolher opções';
      }
    }
    saveGraphPrefsDebounced();
  }

  function graphDomainsLabel(domains) {
    if (!domains.length) return 'todos';
    return domains.length === 1 ? domains[0] : `${domains.length} domínios`;
  }

  function graphDomainsToggle() {
    const pop = document.querySelector('[data-graph-domsel-pop]');
    if (pop) pop.hidden = !pop.hidden;
  }

  function graphDomainsApply() {
    const g = ensureGraphState();
    const label = document.querySelector('[data-graph-domsel-label]');
    if (label) label.textContent = graphDomainsLabel(g.options.domains);
    const all = document.querySelector('[data-graph-domain-all]');
    if (all) all.checked = g.options.domains.length === 0;
    graphApplyVisibility(true);
  }

  function graphDomainSet(domain, checked) {
    const g = ensureGraphState();
    const set = new Set(g.options.domains);
    if (checked) set.add(domain);
    else set.delete(domain);
    g.options.domains = [...set].sort();
    graphDomainsApply();
  }

  function graphDomainsClear() {
    const g = ensureGraphState();
    g.options.domains = [];
    document.querySelectorAll('[data-graph-domain]').forEach((el) => {
      el.checked = false;
    });
    graphDomainsApply();
  }

  function graphApplyPreset(name) {
    const g = ensureGraphState();
    const p = GRAPH_PRESETS[name];
    if (!p) return;
    g.preset = name;
    Object.assign(g.options, p.options);
    g.style = { ...GRAPH_DEFAULT_STYLE, ...p.style };
    saveGraphPrefsDebounced();
    renderShell(); // toolbar selects must reflect the preset → full re-render + remount
  }

  // Local-focus mode: show only the node's 1–2-hop neighborhood (composes with the other
  // filters). Double-tap a node toggles 1-hop focus; the card offers both depths.
  function graphFocusNode(id, hops) {
    const g = ensureGraphState();
    g.focus = { id, hops: Number(hops) === 2 ? 2 : 1 };
    renderShell();
  }

  function graphFocusExit() {
    const g = ensureGraphState();
    g.focus = null;
    renderShell();
  }

  function graphCardHtml(d) {
    if (!d) return ''; // no selection → the card collapses via :empty (hint retired)
    const isSkill = d.kind === 'skill';
    const row = (k, v) => `<div class="graph-card-row"><small>${k}</small><strong>${v}</strong></div>`;
    return `
      <h3 class="graph-card-title">${escapeHtml(d.label || d.id)}</h3>
      <code class="graph-card-id">${escapeHtml(d.id)}</code>
      ${row('Tipo', isSkill ? 'Skill' : d.ontologia ? 'Cápsula · ontologia do domínio' : d.serie ? 'Cápsula · episódio' : 'Cápsula')}
      ${!isSkill && d.serie ? row('Série', escapeHtml(`${d.serie}${d.periodo ? ` · ${d.periodo}` : ''}`)) : ''}
      ${d.domain ? row('Domínio', escapeHtml(d.domain)) : ''}
      ${!isSkill ? row('Categoria', capsuleCategoryChip(d.categoria)) : ''}
      ${row('Status', escapeHtml(String(d.status || '—')))}
      ${isSkill ? row('Selo', `${d.selo ?? 0}/100`) : ''}
      ${isSkill ? row('Frescor', escapeHtml(d.frescor || '—')) : ''}
      ${isSkill ? row('Aberturas (6m)', String(d.aberturas ?? 0)) : ''}
      ${isSkill ? row('Execuções (6m)', String(d.execucoes ?? 0)) : ''}
      ${row('Referências recebidas', String(d.inDegree ?? 0))}
      ${isSkill ? row('Referências feitas', String(d.outDegree ?? 0)) : ''}
      ${row('Comunidade', String(d.community ?? '—'))}
      ${!isSkill && d.summary ? `<p class="graph-card-summary">${escapeHtml(d.summary)}</p>` : ''}
      <div class="graph-card-actions">
        <button class="ghost-button small" data-action="graphFocusNode" data-id="${escapeHtml(d.id)}" data-hops="1">${icon('search')}Focar 1 salto</button>
        <button class="ghost-button small" data-action="graphFocusNode" data-id="${escapeHtml(d.id)}" data-hops="2">2 saltos</button>
      </div>
      <button class="primary-button small" data-action="graphOpenNode" data-id="${escapeHtml(d.id)}" data-kind="${d.kind}">${icon('folder')}Abrir no corpus</button>`;
  }

  function buildGraphColorMaps(nodes) {
    const catMap = (vals) => new Map(vals.map((v, i) => [v, GRAPH_PALETTE[i % GRAPH_PALETTE.length]]));
    const domains = [...new Set(nodes.map((n) => String(n.domain || '')).filter(Boolean))].sort();
    const communities = [...new Set(nodes.map((n) => String(n.community ?? '')))].sort((a, b) => Number(a) - Number(b));
    return { domain: catMap(domains), community: catMap(communities) };
  }

  function graphNodeColor(d, colorBy, maps) {
    if (colorBy === 'kind') return d.kind === 'capsule' ? '#f2a65a' : '#6b8afd';
    if (colorBy === 'status') return GRAPH_STATUS_COLORS[d.status] || '#8a8f98';
    if (colorBy === 'frescor') {
      return d.kind === 'capsule'
        ? GRAPH_STATUS_COLORS[d.status] || '#8a8f98'
        : GRAPH_FRESCOR_COLORS[d.frescor] || '#8a8f98';
    }
    if (colorBy === 'community') return maps.community.get(String(d.community ?? '')) || '#8a8f98';
    return maps.domain.get(String(d.domain || '')) || '#8a8f98';
  }

  function buildGraphSizeRanges(nodes) {
    const rangeOf = (field) => ({ max: Math.max(0, ...nodes.map((n) => Number(n[field]) || 0)) });
    return {
      aberturas: rangeOf('aberturas'),
      execucoes: rangeOf('execucoes'),
      inDegree: rangeOf('inDegree'),
      outDegree: rangeOf('outDegree')
    };
  }

  // Piso de legibilidade da cápsula: enquanto ela era um ponto, encolher fazia sentido. Agora o nó
  // É o ícone da categoria — abaixo de ~16px o glifo vira borrão. O `sizeBy` continua valendo ACIMA
  // do piso, então "mais referências = maior" se mantém; só não desce a ponto de não se ler.
  const GRAPH_CAPSULE_MIN_SIZE = 16;
  function graphNodeSize(d, sizeBy, ranges) {
    const s = (state.graphView && state.graphView.style) || GRAPH_DEFAULT_STYLE;
    const isCapsule = d.kind === 'capsule';
    const base = isCapsule ? Math.max(GRAPH_CAPSULE_MIN_SIZE, s.nodeBase) : s.nodeBase;
    const floor = (n) => (isCapsule ? Math.max(GRAPH_CAPSULE_MIN_SIZE, n) : n);
    if (sizeBy === 'uniforme' || !ranges[sizeBy] || !ranges[sizeBy].max) return floor(base);
    const v = Number(d[sizeBy]) || 0;
    return floor(Math.round(base * 0.6 + base * 1.5 * s.sizeScale * Math.sqrt(v / ranges[sizeBy].max)));
  }

  function graphForceLayoutName() {
    try {
      if (typeof cytoscape !== 'undefined' && typeof cytoscapeFcose !== 'undefined') return 'fcose';
    } catch (error) {
      /* fall through */
    }
    return 'cose';
  }

  // Canvas colors for both graphs, read per mount (theme flips re-render → remount → re-read).
  // Edges get DEDICATED grays: the `--line` token is a subtle border color that all but vanishes
  // against the surface on a canvas — especially in dark mode (#313742 on #1d2027).
  function graphThemeColors() {
    const css = getComputedStyle(document.documentElement);
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const v = (name, fb) => (css.getPropertyValue(name) || '').trim() || fb;
    return {
      dark,
      text: v('--ink', dark ? '#ececf0' : '#3a4048'),
      muted: v('--muted', dark ? '#9fa3ad' : '#6b7079'),
      surface: v('--surface', dark ? '#1d2027' : '#ffffff'),
      accent: v('--primary', '#be1549'),
      edge: dark ? '#7c8695' : '#9aa2ad'
    };
  }

  function graphLayoutOpts(name) {
    const map = {
      // packComponents + tile keep disconnected components (orphans, unlinked hulls) packed
      // together instead of flying apart; stronger gravity pulls each component tight.
      forca: {
        name: graphForceLayoutName(),
        animate: false,
        randomize: true,
        nodeRepulsion: 4500,
        idealEdgeLength: 75,
        packComponents: true,
        tile: true,
        gravity: 0.6,
        gravityRange: 2.5,
        gravityCompound: 1.5,
        gravityRangeCompound: 1.8,
        nestingFactor: 0.8
      },
      concentrico: {
        name: 'concentric',
        animate: false,
        minNodeSpacing: 18,
        concentric: (n) => n.degree(),
        levelWidth: () => 2
      },
      circulo: { name: 'circle', animate: false },
      grade: { name: 'grid', animate: false },
      arvore: { name: 'breadthfirst', animate: false, directed: true, spacingFactor: 1.2 }
    };
    return map[name] || map.forca;
  }

  function mountCorpusGraph() {
    const g = state.graphView;
    const el = document.getElementById('corpus-cy');
    if (!g || !g.data || !el || state.view !== 'graph') return;
    if (typeof cytoscape === 'undefined') {
      el.innerHTML = '<div class="repo-empty">Biblioteca do grafo não carregada (vendor/cytoscape.min.js).</div>';
      return;
    }
    destroyCorpusCy();
    const nodes = g.data.nodes || [];
    const edges = g.data.edges || [];
    const colorMaps = buildGraphColorMaps(nodes);
    const sizeRanges = buildGraphSizeRanges(nodes);
    const theme = graphThemeColors();
    const textColor = theme.text;
    const mutedColor = theme.muted;
    const lineColor = theme.edge;
    const accent = theme.accent;
    const styleOf = () => (state.graphView && state.graphView.style) || GRAPH_DEFAULT_STYLE;
    const nodeColor = (ele) => graphNodeColor(ele.data(), state.graphView.options.colorBy, colorMaps);
    const nodeSize = (ele) => graphNodeSize(ele.data(), state.graphView.options.sizeBy, sizeRanges);
    // Cluster hulls: compound parent nodes per domain/community (fcose lays compounds out
    // as visual "neighborhood boxes"). Skills/capsules keep their own styling inside.
    const clusterBy = g.options.clusterBy;
    const clusterValOf = (n) =>
      clusterBy === 'domain'
        ? n.domain || 'Sem domínio'
        : clusterBy === 'community'
          ? `Comunidade ${n.community}`
          : null;
    const parents = [];
    if (clusterBy !== 'none') {
      const seen = new Set();
      for (const n of nodes) {
        const v = clusterValOf(n);
        if (v != null && !seen.has(v)) {
          seen.add(v);
          parents.push({ group: 'nodes', data: { id: `cluster:${v}`, label: v, isCluster: 1 } });
        }
      }
    }
    const parentColor = (ele) => {
      const label = String(ele.data('label') || '');
      if (label.startsWith('Comunidade ')) return colorMaps.community.get(label.slice(11)) || '#8a8f98';
      return colorMaps.domain.get(label) || '#8a8f98';
    };
    corpusCy = window.cytoscape({
      container: el,
      elements: [
        ...parents,
        ...nodes.map((n) => ({
          group: 'nodes',
          data: { ...n, ...(clusterBy !== 'none' ? { parent: `cluster:${clusterValOf(n)}` } : {}) }
        })),
        ...edges.map((e, i) => ({
          group: 'edges',
          data: { id: `e${i}`, source: e.from, target: e.to, scope: e.scope, count: e.count }
        }))
      ],
      wheelSensitivity: 0.2,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': nodeColor,
            width: nodeSize,
            height: nodeSize,
            shape: (ele) => (ele.data('kind') === 'capsule' ? 'round-rectangle' : 'ellipse'),
            label: (ele) => {
              const s = styleOf();
              if (s.labels === 'nunca') return '';
              if ((ele.data('kind') === 'capsule' ? s.labelCapsules : s.labelSkills) === false) return '';
              return ele.data('label');
            },
            'font-size': 9,
            color: textColor,
            'min-zoomed-font-size': styleOf().labels === 'sempre' ? 0 : 8,
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-wrap': 'ellipsis',
            'text-max-width': 110
          }
        },
        {
          selector: 'node:parent',
          style: {
            'background-color': parentColor,
            'background-opacity': 0.07,
            'border-width': 1,
            'border-color': parentColor,
            'border-opacity': 0.55,
            shape: 'round-rectangle',
            label: (ele) => (styleOf().labelDomains === false ? '' : ele.data('label')),
            'font-size': 10,
            'font-weight': 700,
            color: mutedColor,
            'min-zoomed-font-size': 0,
            'text-valign': 'top',
            'text-halign': 'center',
            'text-margin-y': -3,
            padding: 16
          }
        },
        {
          selector: 'edge',
          style: {
            width: (ele) => Math.min(5, (0.8 + (Number(ele.data('count')) || 1) * 0.5) * styleOf().edgeWidth),
            'line-color': lineColor,
            'curve-style': 'straight',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': lineColor,
            'arrow-scale': 0.65,
            opacity: (ele) => styleOf().edgeOpacity,
            label: (ele) => (styleOf().edgeLabels ? String(ele.data('count') || '') : ''),
            'font-size': 8,
            color: mutedColor,
            'text-rotation': 'autorotate',
            'text-opacity': 0.85
          }
        },
        // Skill→skill references (scope=cross) read differently from skill→capsule: dashed line.
        { selector: 'edge[scope = "cross"]', style: { 'line-style': 'dashed', 'line-dash-pattern': [7, 4] } },
        // Cross-repo references (scope=xrepo): dotted — a link that crosses a balde boundary.
        { selector: 'edge[scope = "xrepo"]', style: { 'line-style': 'dotted' } },
        // O ÍCONE É O NÓ: nenhuma forma atrás. `background-opacity: 0` apaga o quadrado, e o glifo
        // — desenhado na cor do próprio nó — passa a ser a figura inteira. `contain` (em vez de
        // `none`) faz o cytoscape reescalar por nível de zoom em vez de zerar a textura; junto com
        // width/height intrínsecos no SVG, é o que impedia o ícone de sumir em certos zooms.
        {
          selector: 'node[kind = "capsule"][categoria]',
          style: {
            'background-opacity': 0,
            'background-image': (ele) => graphCategoryIcon(ele.data('categoria'), nodeColor(ele)),
            'background-fit': 'contain',
            'background-clip': 'none',
            'background-width': '128%',
            'background-height': '128%',
            'background-position-x': '50%',
            'background-position-y': '50%'
          }
        },
        // Ontologia do domínio: o livro aberto substitui o glifo da categoria.
        {
          selector: 'node[kind = "capsule"][ontologia = 1]',
          style: {
            'background-image': (ele) => graphOntologyIcon(nodeColor(ele))
          }
        },
        // Episódios de série: um anel na cor do nó. Sem quadrado, não há onde encaixar o relógio
        // sem cobrir o ícone — o anel diz "episódio" sem disputar os mesmos pixels.
        {
          selector: 'node[kind = "capsule"][temporal = 1]',
          style: {
            'border-width': 1.5,
            'border-color': nodeColor,
            'border-opacity': 0.5,
            'border-style': 'solid'
          }
        },
        // Deprecated artifacts (review overdue / expired capsule in use): faded fill + dashed red
        // ring — readable over every palette color and composable with the temporal clock glyph.
        {
          selector: 'node[deprecated = 1]',
          style: {
            'border-width': 3,
            'border-color': '#c92a2a',
            'border-style': 'dashed',
            'background-opacity': 0.45
          }
        },
        { selector: '.hidden', style: { display: 'none' } },
        { selector: '.faded', style: { opacity: 0.08, 'text-opacity': 0 } },
        { selector: 'node.hl', style: { 'border-width': 2, 'border-color': textColor } },
        { selector: 'node.match', style: { 'border-width': 3, 'border-color': accent } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': textColor } }
      ]
    });
    corpusCy.on('mouseover', 'node', (ev) => {
      const n = ev.target;
      if (n.isParent()) return; // hulls don't drive highlight
      corpusCy.elements().not(':parent').addClass('faded');
      n.closedNeighborhood().removeClass('faded');
      n.ancestors().removeClass('faded');
      n.addClass('hl');
    });
    corpusCy.on('mouseout', 'node', () => {
      corpusCy.elements().removeClass('faded');
      corpusCy.nodes().removeClass('hl');
    });
    corpusCy.on('tap', 'node', (ev) => {
      if (ev.target.isParent()) return; // hulls have no card
      const d = ev.target.data();
      state.graphView.selected = d.id;
      const card = document.getElementById('graph-card');
      if (card) card.innerHTML = graphCardHtml(d);
    });
    corpusCy.on('dbltap', 'node', (ev) => {
      if (ev.target.isParent()) return;
      const id = ev.target.id();
      const focus = state.graphView.focus;
      if (focus && focus.id === id) graphFocusExit();
      else graphFocusNode(id, 1);
    });
    corpusCy.on('tap', (ev) => {
      if (ev.target === corpusCy) {
        state.graphView.selected = null;
        const card = document.getElementById('graph-card');
        if (card) card.innerHTML = graphCardHtml(null);
      }
    });
    graphApplyVisibility(false);
    graphRunLayout();
    graphApplySearch();
  }

  function graphApplyVisibility(relayout = true) {
    if (!corpusCy) return;
    const o = state.graphView.options;
    // Local focus composes with the filters: only the focused node's 1–2-hop neighborhood stays.
    const focus = state.graphView.focus;
    let focusSet = null;
    if (focus && corpusCy.$id(focus.id).nonempty()) {
      let nb = corpusCy.$id(focus.id).closedNeighborhood();
      if (focus.hops === 2) nb = nb.closedNeighborhood();
      focusSet = new Set(nb.nodes().map((n) => n.id()));
    }
    corpusCy.batch(() => {
      corpusCy.nodes().forEach((n) => {
        if (n.isParent()) return; // hulls follow their children (below)
        const d = n.data();
        const hide =
          (o.domains.length && !o.domains.includes(d.domain)) ||
          (o.hideCapsules && d.kind === 'capsule') ||
          (o.hideOrphans && (d.inDegree || 0) + (d.outDegree || 0) === 0) ||
          (focusSet && !focusSet.has(n.id()));
        n.toggleClass('hidden', Boolean(hide));
      });
      corpusCy.nodes(':parent').forEach((p) => {
        p.toggleClass('hidden', p.children().not('.hidden').length === 0);
      });
      corpusCy.edges().forEach((e) => {
        e.toggleClass('hidden', e.source().hasClass('hidden') || e.target().hasClass('hidden'));
      });
    });
    if (relayout) graphRunLayout();
  }

  function graphRunLayout() {
    if (!corpusCy) return;
    const visible = corpusCy.elements().not('.hidden');
    const run = (opts) => {
      const lay = visible.layout(opts);
      lay.one('layoutstop', () => {
        try {
          corpusCy.fit(visible.nodes(), 40);
        } catch (error) {
          /* empty */
        }
      });
      lay.run();
    };
    try {
      run(graphLayoutOpts(state.graphView.options.layout));
    } catch (error) {
      run({ name: 'cose', animate: false });
    } // fcose chain broken → built-in force
  }

  function graphSetOption(name, value) {
    const g = ensureGraphState();
    g.options[name] = name === 'hideCapsules' || name === 'hideOrphans' ? Boolean(value) : value;
    if (['layout', 'colorBy', 'sizeBy', 'clusterBy'].includes(name)) saveGraphPrefsDebounced();
    if (!corpusCy) return;
    if (name === 'clusterBy') {
      mountCorpusGraph();
      return;
    } // parents change → rebuild elements
    if (name === 'layout') {
      graphRunLayout();
      return;
    }
    if (name === 'colorBy' || name === 'sizeBy') {
      corpusCy.style().update();
      return;
    }
    graphApplyVisibility(true); // hideCapsules / hideOrphans (domains flow via graphDomainSet)
  }

  let graphSearchTimer = null;
  function graphSearchInput(value) {
    ensureGraphState().options.q = value;
    clearTimeout(graphSearchTimer);
    graphSearchTimer = setTimeout(graphApplySearch, 200);
  }

  function graphApplySearch() {
    if (!corpusCy) return;
    const q = String(state.graphView.options.q || '')
      .trim()
      .toLowerCase();
    corpusCy.nodes().removeClass('match');
    if (!q) return;
    const matched = corpusCy
      .nodes()
      .filter((n) => !n.isParent() && `${n.data('label')} ${n.id()}`.toLowerCase().includes(q))
      .not('.hidden');
    matched.addClass('match');
    if (matched.length) {
      try {
        corpusCy.fit(matched, 70);
      } catch (error) {
        /* empty */
      }
    }
  }

  async function graphOpenNode(id, kind) {
    if (kind === 'capsule') {
      await navigate('explore');
      await loadExploreCommonsConcept(String(id).replace(/^commons\//, ''));
    } else {
      await openSkillInExplore(id);
    }
  }

  function capsuleCategories() {
    return capsuleCategoryList;
  }
  function defaultCapsuleCategory() {
    return capsuleCategoryDefault;
  }

  return {
    capsuleCategoryDef,
    capsuleCategoryKey,
    loadCapsuleCategories,
    capsuleCategoryChip,
    capsuleCategoryGlyph,
    isOntologyPath,
    parseOntologyMarkdown,
    ontologyChip,
    openOntologias,
    renderOntologiasView,
    openOntologyEditor,
    openOntologyEditorNew,
    ontologySuggestAdditionsAi,
    ontologyCreateAi,
    renderOntologyEditorModal,
    closeOntologyEditor,
    ontologyAddConcept,
    ontologyRemoveConcept,
    saveOntology,
    openOntologyInExplorer,
    destroyCorpusCy,
    openGraphView,
    graphRefresh,
    renderGraphView,
    graphSetStyle,
    graphStyleToggle,
    graphToolbarToggle,
    graphDomainsToggle,
    graphDomainSet,
    graphDomainsClear,
    graphApplyPreset,
    graphFocusNode,
    graphFocusExit,
    graphForceLayoutName,
    graphThemeColors,
    mountCorpusGraph,
    graphSetOption,
    graphSearchInput,
    graphOpenNode,
    capsuleCategories,
    defaultCapsuleCategory
  };
}
