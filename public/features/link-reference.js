export function createLinkReferenceFeature({ state, icon, escapeHtml }) {
  function linkrefTextarea() {
    const m = state.linkref;
    if (!m) return null;
    if (m.field === 'cwBody') return document.querySelector('[data-cw-field="body"]');
    if (m.field === 'mergeBody') return document.querySelector('[data-merge-edit]');
    return document.querySelector('[data-wizard-field="body"]');
  }
  function linkrefDetect(textarea) {
    const pos = textarea.selectionStart;
    if (pos == null) return null;
    const before = textarea.value.slice(0, pos);
    const m = /(\[\[\[?)([^\]\n[]*)$/.exec(before); // "[[" (cápsula) or "[[[" (skill), then non-] [ newline chars
    if (!m) return null;
    const brackets = m[1].length; // 2 → capsule, 3 → skill
    return { query: m[2], atIndex: pos - m[2].length - brackets, brackets, cursor: pos };
  }
  // The skill-body picker: "[[" → capsules (the common case), "[[[" → skills (cross-skill references).
  // Capsules stay atomic (their own body has no [[). Skills exclude the one being edited (no
  // self-reference). A skill link targets its root node (/<id>/SKILL.md); a capsule its folder
  // (/commons/<path>).
  function linkrefCandidates(brackets) {
    if (brackets === 3) {
      const editingId = (state.wizard && state.wizard.editId) || (state.mergeWizard && state.mergeWizard.skillId);
      return (state.skills || [])
        .filter((s) => s.id !== editingId)
        .map((s) => ({ kind: 'skill', key: s.id, title: s.nome || s.id, sub: `/${s.id}`, link: `/${s.id}/SKILL.md` }));
    }
    return (state.commonsIndex || []).map((c) => ({
      kind: 'commons',
      key: c.path,
      title: c.title || c.path.split('/').pop(),
      sub: `/commons/${c.path}`,
      link: `/commons/${c.path}`
    }));
  }
  function linkrefSync(field, textarea) {
    const det = linkrefDetect(textarea);
    if (!det) {
      linkrefClose();
      return;
    }
    const q = det.query.toLowerCase();
    const items = linkrefCandidates(det.brackets)
      .filter((c) => c.key.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
      .slice(0, 8);
    if (!items.length) {
      linkrefClose();
      return;
    }
    const prev = state.linkref ? state.linkref.active : 0;
    state.linkref = {
      field,
      atIndex: det.atIndex,
      cursor: det.cursor,
      items,
      active: Math.min(prev, items.length - 1)
    };
    linkrefRender(textarea);
  }
  function linkrefRender(textarea) {
    const m = state.linkref;
    const ta = textarea || linkrefTextarea();
    if (!m || !ta) {
      linkrefClose();
      return;
    }
    const host = ta.closest('label') || ta.parentElement;
    if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';
    let menu = host.querySelector('.linkref-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'linkref-menu';
      host.appendChild(menu);
    }
    menu.innerHTML = m.items
      .map(
        (c, i) =>
          `<button type="button" class="linkref-item ${i === m.active ? 'active' : ''}" data-linkref-index="${i}">${icon(c.kind === 'skill' ? 'lightbulb' : 'library')}<span class="linkref-name">${escapeHtml(c.title)}</span><small>${escapeHtml(c.sub)}</small></button>`
      )
      .join('');
  }
  function linkrefClose() {
    state.linkref = null;
    document.querySelectorAll('.linkref-menu').forEach((el) => el.remove());
  }
  function linkrefMove(delta) {
    const m = state.linkref;
    if (!m) return;
    m.active = (m.active + delta + m.items.length) % m.items.length;
    linkrefRender();
  }
  function linkrefAccept(index) {
    const m = state.linkref;
    const ta = linkrefTextarea();
    if (!m || !ta) {
      linkrefClose();
      return;
    }
    if (index != null) m.active = index;
    const item = m.items[m.active];
    if (!item) {
      linkrefClose();
      return;
    }
    const label = item.title;
    const insert = `[${label}](${item.link})`;
    const value = ta.value;
    const next = value.slice(0, m.atIndex) + insert + value.slice(m.cursor);
    ta.value = next;
    const caret = m.atIndex + insert.length;
    try {
      ta.setSelectionRange(caret, caret);
    } catch (error) {
      /* ignore */
    }
    if (m.field === 'cwBody') {
      if (state.commonsWizard) state.commonsWizard.form.body = next;
    } else if (m.field === 'mergeBody') {
      const w = state.mergeWizard,
        c = w && w.changes[w.fileIdx];
      if (c) c.curatorContent = next;
    } else if (state.wizard) state.wizard.form.body = next;
    linkrefClose();
    ta.focus();
  }
  function linkrefMenuOpen() {
    return Boolean(state.linkref) && Boolean(document.querySelector('.linkref-menu'));
  }
  function handleLinkrefKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      linkrefMove(1);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      linkrefMove(-1);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      linkrefAccept();
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      linkrefClose();
      return true;
    }
    return false;
  }

  return { linkrefSync, linkrefClose, linkrefAccept, linkrefMenuOpen, handleLinkrefKey };
}
