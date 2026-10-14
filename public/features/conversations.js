export function createConversationsFeature({
  state,
  setSidebarCollapsed,
  renderShell,
  toast,
  slugifyClient,
  icon,
  escapeHtml,
  BUDDY_POSE_VOCAB,
  BUDDY_SIZES,
  skillDomainOf,
  renderMarkdownSafe,
  currentAccessUser,
  queueWhen,
  pluralize,
  formatBytes,
  selectedSkill,
  fileToBase64,
  curatesActiveBalde,
  refreshQueueBadge
}) {
  function ensureChatState() {
    if (!state.chat) {
      state.chat = {
        list: [],
        currentId: null,
        current: null,
        input: '',
        sending: false,
        streaming: null,
        loading: false,
        error: null,
        buddyCache: {},
        ratings: {},
        renamingId: null,
        openType: 'chat',
        expanded: false,
        pendingSkillIds: []
      };
    }
    if (!state.chat.openType) {
      state.chat.openType = 'chat';
    }
    if (!Array.isArray(state.chat.pendingSkillIds)) {
      state.chat.pendingSkillIds = [];
    }
    return state.chat;
  }

  function scrollChatToBottom() {
    const el = document.querySelector('[data-chat-scroll]');
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
    // Code blocks / images can grow the content one frame after the first scroll,
    // leaving us short of the true bottom. Re-scroll once layout settles.
    requestAnimationFrame(() => {
      const e = document.querySelector('[data-chat-scroll]');
      if (e) {
        e.scrollTop = e.scrollHeight;
      }
    });
  }

  // Enter/leave chat focus mode: hide the conversation list and collapse the rail
  // (restored to its prior state on exit), mirroring the Explorar "Expandir".
  function chatToggleExpand() {
    const chat = ensureChatState();
    chat.expanded = !chat.expanded;
    if (chat.expanded) {
      chat.prevSidebarCollapsed = state.sidebarCollapsed;
      setSidebarCollapsed(true);
    } else {
      setSidebarCollapsed(Boolean(chat.prevSidebarCollapsed));
    }
    renderShell();
  }

  // Serialize a conversation to YAML (block scalars keep multi-line content
  // literal). `opts` carries plenária extras: joinKey, participants, defaultTitle.
  function chatToYaml(current, opts = {}) {
    const q = (value) => JSON.stringify(String(value == null ? '' : value));
    const lines = [];
    lines.push(`title: ${q(current.title || opts.defaultTitle || 'Conversa')}`);
    lines.push(`exported_at: ${q(new Date().toISOString())}`);
    if (opts.joinKey) {
      lines.push(`join_key: ${q(opts.joinKey)}`);
    }
    const participants = opts.participants || [];
    if (participants.length) {
      lines.push('participants:');
      participants.forEach((u) => lines.push(`  - ${q(u.name || u.email || '—')}`));
    }
    const ctx = current.skillIds || [];
    if (ctx.length) {
      lines.push('context:');
      ctx.forEach((id) => lines.push(`  - ${q(id)}`));
    } else {
      lines.push('context: []');
    }
    const msgs = current.messages || [];
    if (msgs.length) {
      lines.push('messages:');
      msgs.forEach((m) => {
        lines.push(`  - role: ${q(m.role === 'assistant' ? 'assistant' : 'user')}`);
        const author = m.author && (m.author.name || m.author.email);
        if (author) {
          lines.push(`    author: ${q(m.author.name || m.author.email)}`);
        }
        lines.push('    content: |');
        String(m.content == null ? '' : m.content)
          .split('\n')
          .forEach((ln) => lines.push(ln === '' ? '' : `      ${ln}`));
      });
    } else {
      lines.push('messages: []');
    }
    return `${lines.join('\n')}\n`;
  }

  function downloadTextFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportChatYaml() {
    const chat = ensureChatState();
    const current = chat.current;
    if (!current || !(current.messages && current.messages.length)) {
      toast('Nada para exportar nesta conversa.', 'warning');
      return;
    }
    const slug = slugifyClient(current.title || 'conversa') || 'conversa';
    downloadTextFile(`${slug}.yaml`, chatToYaml(current), 'text/yaml;charset=utf-8');
    toast('Conversa exportada (YAML).', 'success');
  }

  function exportPlenariaYaml() {
    const pl = ensurePlenariaState();
    const current = pl.current;
    if (!current || !(current.messages && current.messages.length)) {
      toast('Nada para exportar nesta plenária.', 'warning');
      return;
    }
    const slug = slugifyClient(current.title || 'plenaria') || 'plenaria';
    const yaml = chatToYaml(current, {
      defaultTitle: 'Plenária',
      joinKey: current.joinKey,
      participants: current.participants
    });
    downloadTextFile(`${slug}.yaml`, yaml, 'text/yaml;charset=utf-8');
    toast('Plenária exportada (YAML).', 'success');
  }
  // Typing "@" opens a menu: in 1:1 chat the skill's buddy; in a plenária any
  // participant plus the buddy. ↑/↓ browse, Tab/→/Enter accept, Esc closes. The
  // menu is managed imperatively so it never steals focus from the textarea.
  function mentionCandidates() {
    const chat = ensureChatState();
    const allSkills = state.skills || [];
    const out = [];
    const seen = new Set();
    const addBuddies = (conv, cache) => {
      ((conv && conv.skillIds) || []).forEach((sid) => {
        const skill = allSkills.find((e) => e.id === sid);
        if (!skill || !skill.buddyId) {
          return;
        }
        const name = (cache && cache[skill.buddyId] && cache[skill.buddyId].name) || skill.buddyId;
        const key = `b:${name.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ type: 'buddy', name });
        }
      });
    };
    if (chat.openType === 'plenaria') {
      const pl = ensurePlenariaState();
      const p = pl.current;
      ((p && p.participants) || []).forEach((u) => {
        const name = u.name || u.email || 'Participante';
        const key = `u:${name.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ type: 'user', name });
        }
      });
      addBuddies(p, pl.buddyCache);
    } else {
      addBuddies(chat.current, chat.buddyCache);
    }
    return out;
  }

  function mentionTextarea() {
    const m = state.mention;
    if (!m) {
      return null;
    }
    return document.querySelector(m.field === 'plenaria' ? '[data-plenaria-input]' : '[data-chat-input]');
  }

  function mentionDetect(textarea) {
    const pos = textarea.selectionStart;
    if (pos == null) {
      return null;
    }
    const before = textarea.value.slice(0, pos);
    const m = /(^|\s)@([^\s@]*)$/.exec(before);
    if (!m) {
      return null;
    }
    return { query: m[2], atIndex: pos - m[2].length - 1, cursor: pos };
  }

  // Re-evaluate the mention menu against the current caret position (called on input).
  function mentionSync(field, textarea) {
    const det = mentionDetect(textarea);
    if (!det) {
      mentionClose();
      return;
    }
    const q = det.query.toLowerCase();
    const items = mentionCandidates().filter((c) => c.name.toLowerCase().includes(q));
    if (!items.length) {
      mentionClose();
      return;
    }
    const prev = state.mention ? state.mention.active : 0;
    state.mention = {
      field,
      atIndex: det.atIndex,
      cursor: det.cursor,
      items,
      active: Math.min(prev, items.length - 1)
    };
    mentionRender(textarea);
  }

  function mentionRender(textarea) {
    const m = state.mention;
    const ta = textarea || mentionTextarea();
    if (!m || !ta) {
      mentionClose();
      return;
    }
    const composer = ta.closest('.chat-composer') || ta.parentElement;
    let menu = composer.querySelector('.mention-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'mention-menu';
      composer.appendChild(menu);
    }
    menu.innerHTML = m.items
      .map(
        (c, i) => `
      <button type="button" class="mention-item ${i === m.active ? 'active' : ''}" data-mention-index="${i}">
        ${icon(c.type === 'buddy' ? 'smiley' : 'users')}<span class="mention-name">${escapeHtml(c.name)}</span><small>${c.type === 'buddy' ? 'buddy' : 'participante'}</small>
      </button>`
      )
      .join('');
  }

  function mentionClose() {
    state.mention = null;
    document.querySelectorAll('.mention-menu').forEach((el) => el.remove());
  }

  function mentionMove(delta) {
    const m = state.mention;
    if (!m) {
      return;
    }
    m.active = (m.active + delta + m.items.length) % m.items.length;
    mentionRender();
  }

  function mentionAccept(index) {
    const m = state.mention;
    const ta = mentionTextarea();
    if (!m || !ta) {
      mentionClose();
      return;
    }
    if (index != null) {
      m.active = index;
    }
    const item = m.items[m.active];
    if (!item) {
      mentionClose();
      return;
    }
    const value = ta.value;
    const insert = `@${item.name} `;
    const next = value.slice(0, m.atIndex) + insert + value.slice(m.cursor);
    ta.value = next;
    const caret = m.atIndex + insert.length;
    try {
      ta.setSelectionRange(caret, caret);
    } catch (error) {
      /* ignore */
    }
    if (m.field === 'plenaria') {
      if (state.plenaria) {
        state.plenaria.input = next;
      }
    } else if (state.chat) {
      state.chat.input = next;
    }
    mentionClose();
    ta.focus();
  }

  // True while the menu element is actually in the DOM (state may linger after a
  // full re-render wipes the menu — gate keyboard handling on the element).
  function mentionMenuOpen() {
    return Boolean(state.mention) && Boolean(document.querySelector('.mention-menu'));
  }

  // Handle a keydown while the menu is open. Returns true if the key was consumed.
  function handleMentionKey(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      mentionMove(1);
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      mentionMove(-1);
      return true;
    }
    if (event.key === 'Tab' || event.key === 'ArrowRight' || event.key === 'Enter') {
      event.preventDefault();
      mentionAccept();
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      mentionClose();
      return true;
    }
    return false;
  }

  // Parse a fetch Response that is expected to be JSON, but degrade gracefully when
  // it isn't. An SSO-fronted deploy can return an HTML page to an API call — the
  // Authentik login page on an expired session, or an nginx 502/504 when a slow
  // non-streaming AI reply outlives proxy_read_timeout. Without this, res.json()
  // throws the opaque "Unexpected token '<', "<!doctype ..." error.
  async function readJsonResponse(res) {
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (error) {
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        throw new Error('Servidor indisponível ou tempo esgotado (resposta longa da IA). Tente novamente.');
      }
      if (/^\s*<(?:!doctype|html)/i.test(text)) {
        throw new Error('Sessão expirada ou resposta inesperada. Recarregue a página e faça login novamente.');
      }
      throw new Error(`Resposta inesperada do servidor (HTTP ${res.status}).`);
    }
  }

  async function openChat() {
    const chat = ensureChatState();
    chat.loading = true;
    chat.error = null;
    renderShell();
    const pl = ensurePlenariaState();
    try {
      const res = await fetch('/api/chats');
      const data = await readJsonResponse(res);
      chat.list = data.ok && data.chats ? data.chats : [];
      await openPlenarias();
      if (chat.currentId && !chat.list.some((entry) => entry.id === chat.currentId)) {
        chat.currentId = null;
        chat.current = null;
      }
      // Reconnect a plenária that was left open; otherwise fall back to a chat.
      if (chat.openType === 'plenaria' && pl.current && pl.list.some((e) => e.id === pl.currentId)) {
        plenariaConnect(pl.currentId);
      } else {
        chat.openType = 'chat';
        if (!chat.current && chat.list.length) {
          await loadChat(chat.list[0].id, false);
        }
      }
    } catch (error) {
      chat.error = error.message;
    }
    chat.loading = false;
    renderShell();
    scrollChatToBottom();
  }

  async function loadChat(id, render = true) {
    const chat = ensureChatState();
    try {
      const res = await fetch(`/api/chats/item?id=${encodeURIComponent(id)}`);
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao carregar a conversa.');
      }
      chat.currentId = id;
      chat.current = data.chat;
    } catch (error) {
      toast(error.message, 'warning');
    }
    if (render) {
      renderShell();
      scrollChatToBottom();
    }
  }

  function openChatItem(id) {
    plenariaDisconnect();
    ensureChatState().openType = 'chat';
    loadChat(id, true);
  }

  function syncChatListMeta() {
    const chat = state.chat;
    if (!chat || !chat.current) {
      return;
    }
    const meta = {
      id: chat.current.id,
      title: chat.current.title,
      skillIds: chat.current.skillIds || [],
      messageCount: (chat.current.messages || []).length,
      updatedAt: chat.current.updatedAt
    };
    const index = chat.list.findIndex((entry) => entry.id === meta.id);
    if (index >= 0) {
      chat.list[index] = meta;
    } else {
      chat.list.unshift(meta);
    }
    chat.list.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  async function newChat() {
    const chat = ensureChatState();
    // A brand-new conversation starts with a clean context: only skills explicitly staged
    // from the empty state ("+ skill" before the first message) seed it. It no longer
    // inherits the previously open chat's (or plenária's) skills.
    const skillIds = (chat.pendingSkillIds || []).slice();
    try {
      const res = await fetch('/api/chats', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillIds })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao criar conversa.');
      }
      plenariaDisconnect();
      chat.openType = 'chat';
      chat.current = data.chat;
      chat.currentId = data.chat.id;
      chat.input = '';
      chat.pendingSkillIds = []; // consumed into the new chat's context
      syncChatListMeta();
    } catch (error) {
      toast(error.message, 'warning');
    }
    renderShell();
  }

  async function sendChatMessage() {
    const chat = ensureChatState();
    const content = String(chat.input || '').trim();
    const attachments = pendingPayload(chat);
    if ((!content && !attachments.length) || chat.sending) {
      return;
    }
    if (!chat.current) {
      await newChat();
      if (!chat.current) {
        return;
      }
    }
    chat.sending = true;
    chat.streaming = ''; // in-progress assistant text; drives the live bubble
    chat.toolActivity = []; // paged mode: live "consultando…" tool calls for this turn
    chat.mode = null; // 'inline' | 'paged' (announced by the stream)
    chat.current.messages = [...(chat.current.messages || []), { role: 'user', content, at: new Date().toISOString() }];
    chat.input = '';
    chat.pending = []; // attachments ride in the POST; they render (with ids) after 'done'
    renderShell();
    scrollChatToBottom();

    // Update just the streaming bubble's text node (not a full re-render) so tokens
    // append smoothly without disturbing scroll or the composer.
    const paintStream = () => {
      const parsed = parseMoodStreaming(chat.streaming);
      const el = document.querySelector('[data-chat-streaming] .chat-stream-text');
      if (el) {
        el.textContent = parsed.text;
      }
      setChatBuddyPose(parsed.text ? parsed.mood || 'writing' : 'thinking');
      scrollChatToBottom();
    };

    // Repaint only the live tool-activity strip (paged mode) without disturbing the stream text.
    const paintTools = () => {
      const el = document.querySelector('[data-chat-streaming] [data-chat-tools]');
      if (el) {
        el.innerHTML = (chat.toolActivity || []).map(renderChatToolItem).join('');
      }
      scrollChatToBottom();
    };

    let gotTerminal = false;
    try {
      const res = await fetch('/api/chats/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: chat.currentId, content, attachments })
      });
      if (!res.ok || !res.body) {
        // gate failures (404/400/no-key) come back as JSON before the stream starts
        const data = await readJsonResponse(res);
        throw new Error(data.error || 'Falha ao enviar a mensagem.');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamDone = false;
      while (!streamDone) {
        const { value, done } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const dataLines = rawEvent
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim());
          if (!dataLines.length) {
            continue; // ": open" / ": hb" heartbeats carry no data
          }
          let evt;
          try {
            evt = JSON.parse(dataLines.join('\n'));
          } catch {
            continue;
          }
          if (evt.type === 'delta') {
            chat.streaming += evt.text || '';
            paintStream();
          } else if (evt.type === 'mode') {
            chat.mode = evt.mode || null;
          } else if (evt.type === 'tool') {
            chat.toolActivity = [...(chat.toolActivity || []), { name: evt.name, input: evt.input }];
            paintTools();
          } else if (evt.type === 'done') {
            if (evt.chat) {
              chat.current = evt.chat;
            }
            gotTerminal = true;
            streamDone = true;
          } else if (evt.type === 'error') {
            if (evt.chat) {
              chat.current = evt.chat;
            }
            gotTerminal = true;
            streamDone = true;
            toast(evt.error || 'Falha na IA.', 'warning');
          }
        }
      }
      if (!gotTerminal) {
        // connection ended without a done/error event — resync from the server
        await loadChat(chat.currentId, false);
      }
      syncChatListMeta();
    } catch (error) {
      toast(error.message, 'warning');
    }
    chat.sending = false;
    chat.streaming = null;
    renderShell();
    scrollChatToBottom();
  }

  async function setChatSkills(skillIds) {
    const chat = ensureChatState();
    if (!chat.current) {
      return;
    }
    try {
      const res = await fetch('/api/chats/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: chat.currentId, skillIds })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao atualizar contexto.');
      }
      chat.current = data.chat;
      syncChatListMeta();
    } catch (error) {
      toast(error.message, 'warning');
    }
    renderShell();
  }

  function addChatSkill(skillId) {
    const chat = ensureChatState();
    if (!skillId) {
      return;
    }
    if (!chat.current) {
      // No chat yet: stage it as pending context for the chat we'll create on send.
      if (!chat.pendingSkillIds.includes(skillId)) {
        chat.pendingSkillIds.push(skillId);
      }
      renderShell();
      return;
    }
    const ids = [...(chat.current.skillIds || [])];
    if (!ids.includes(skillId)) {
      ids.push(skillId);
    }
    setChatSkills(ids);
  }

  function removeChatSkill(skillId) {
    const chat = ensureChatState();
    if (!chat.current) {
      chat.pendingSkillIds = (chat.pendingSkillIds || []).filter((id) => id !== skillId);
      renderShell();
      return;
    }
    setChatSkills((chat.current.skillIds || []).filter((id) => id !== skillId));
  }

  async function deleteChat(id) {
    const chat = ensureChatState();
    try {
      await fetch('/api/chats/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      chat.list = chat.list.filter((entry) => entry.id !== id);
      if (chat.currentId === id) {
        chat.currentId = null;
        chat.current = null;
      }
      toast('Conversa excluída.', 'success');
    } catch (error) {
      toast(error.message, 'warning');
    }
    renderShell();
  }

  // Push one chat message into the curation queue (contribute modal, skill-picker mode).
  function pushChatToQueue(index) {
    const chat = state.chat;
    const message = chat?.current?.messages?.[index];
    if (!message) {
      return;
    }
    const defaultSkill =
      (chat.current.skillIds && chat.current.skillIds[0]) || (state.skills[0] && state.skills[0].id) || '';
    openContributeFromChat(parseMood(message.content).text, defaultSkill);
  }

  // Split a leading [mood] marker off an assistant reply. The model is asked to
  // prefix each reply with one of the fixed pose codes; we use it to animate the
  // buddy avatar and strip it from the shown text. Unknown markers pass through.
  function parseMood(text) {
    const s = String(text || '');
    const m = s.match(/^\s*\[([a-zA-Z]+)\]\s*/);
    if (m && BUDDY_POSE_VOCAB.includes(m[1].toLowerCase())) {
      return { mood: m[1].toLowerCase(), text: s.slice(m[0].length) };
    }
    return { mood: null, text: s };
  }

  // Streaming variant: while the leading marker is still arriving token-by-token
  // (e.g. "[hap"), hide it so it never flashes as raw text in the live bubble.
  function parseMoodStreaming(text) {
    const s = String(text || '');
    const done = parseMood(s);
    if (done.mood) {
      return done;
    }
    if (/^\s*\[[a-zA-Z]*$/.test(s)) {
      return { mood: null, text: '', pending: true };
    }
    return { mood: null, text: s };
  }

  // The buddy id for the current chat = first context skill (in order) that binds one.
  function chatPrimaryBuddyId(chat) {
    const allSkills = state.skills || [];
    const ids = (chat && chat.current && chat.current.skillIds) || [];
    for (const id of ids) {
      const skill = allSkills.find((entry) => entry.id === id);
      if (skill && skill.buddyId) {
        return skill.buddyId;
      }
    }
    return null;
  }

  // Lazily fetch + cache a buddy manifest (name + poses) for the chat avatar. Cache
  // entry is set synchronously to {loading} so a re-render never refetches.
  async function ensureChatBuddyLoaded(id) {
    const chat = ensureChatState();
    if (!id || chat.buddyCache[id]) {
      return;
    }
    chat.buddyCache[id] = { loading: true };
    try {
      const res = await fetch(`/api/buddies/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      chat.buddyCache[id] =
        res.ok && data.ok
          ? {
              id,
              name: data.name || id,
              default_pose: data.default_pose || 'idle',
              poses: Array.isArray(data.poses) ? data.poses : []
            }
          : { error: true };
    } catch (error) {
      chat.buddyCache[id] = { error: true };
    }
    if (state.view === 'chat') {
      renderShell();
    }
  }

  // Image URL for a pose, falling back to the buddy's default then whatever exists.
  function chatBuddyPoseUrl(buddy, want) {
    if (!buddy || !Array.isArray(buddy.poses) || !buddy.poses.length) {
      return null;
    }
    const byCode = (code) => buddy.poses.find((pose) => pose.code === code);
    const pick = byCode(want) || byCode(buddy.default_pose) || buddy.poses[0];
    return pick ? pick.url : null;
  }

  // Which pose to show given chat state: thinking while waiting, writing/mood while
  // streaming, else the last reply's mood (resting), else the buddy default.
  function chatComputePose(chat, buddy) {
    const fallback = (buddy && buddy.default_pose) || 'idle';
    if (chat.sending) {
      const visible = chat.streaming ? parseMoodStreaming(chat.streaming) : { mood: null, text: '' };
      if (visible.text) {
        return visible.mood || 'writing';
      }
      return 'thinking';
    }
    const messages = (chat.current && chat.current.messages) || [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant') {
        return parseMood(messages[i].content).mood || fallback;
      }
    }
    return fallback;
  }

  function chatBuddyStatusLabel(chat) {
    if (!chat.sending) {
      return '';
    }
    const visible = chat.streaming ? parseMoodStreaming(chat.streaming) : { text: '' };
    return visible.text ? 'escrevendo…' : 'pensando…';
  }

  // Imperatively swap the avatar image + status during streaming (no full re-render).
  function setChatBuddyPose(poseCode) {
    const chat = state.chat;
    if (!chat) {
      return;
    }
    const id = chatPrimaryBuddyId(chat);
    const buddy = id && chat.buddyCache[id];
    if (!buddy || buddy.loading || buddy.error) {
      return;
    }
    const url = chatBuddyPoseUrl(buddy, poseCode);
    const img = document.querySelector('[data-buddy-avatar] img');
    if (img && url && img.getAttribute('src') !== url) {
      img.src = url;
    }
    const status = document.querySelector('[data-buddy-status]');
    if (status) {
      status.textContent = chatBuddyStatusLabel(chat);
    }
  }

  // The floating buddy mascot (avatar + name + live status) that overlays the
  // bottom-right of the chat, above the composer. Empty string when the chat has
  // no buddy (no skill selected, or none binds one).
  function renderChatBuddyBar(chat) {
    if (state.buddySize === 'off') {
      return '';
    }
    const id = chatPrimaryBuddyId(chat);
    if (!id) {
      return '';
    }
    let buddy = chat.buddyCache[id];
    if (buddy === undefined) {
      ensureChatBuddyLoaded(id);
      buddy = chat.buddyCache[id];
    }
    if (!buddy || buddy.loading || buddy.error) {
      return '';
    }
    const url = chatBuddyPoseUrl(buddy, chatComputePose(chat, buddy));
    if (!url) {
      return '';
    }
    const status = chatBuddyStatusLabel(chat);
    const size = BUDDY_SIZES.includes(state.buddySize) ? state.buddySize : 'medium';
    return `
      <div class="chat-buddy chat-buddy--${size}" data-buddy-avatar>
        <small class="chat-buddy-status" data-buddy-status>${escapeHtml(status)}</small>
        <img src="${escapeHtml(url)}" alt="${escapeHtml(buddy.name)}" title="${escapeHtml(buddy.name)}">
      </div>`;
  }

  function renderChat() {
    const chat = ensureChatState();
    const pl = ensurePlenariaState();
    const isPlenaria = chat.openType === 'plenaria' && pl.current;
    return `
      <section class="chat-view ${chat.expanded ? 'is-expanded' : ''}">
        <aside class="chat-history">
          <div class="chat-history-actions">
            <button class="primary-button chat-new" data-action="newChat">${icon('edit')}Nova conversa</button>
            <button class="ghost-button small chat-new" data-action="newPlenaria">${icon('users')}Nova plenária</button>
            <button class="ghost-button small chat-new" data-action="toggleJoinPlenaria">${icon('key')}Entrar com chave</button>
          </div>
          ${
            pl.joinOpen
              ? `
            <div class="plenaria-join">
              <input class="chat-rename-input" data-plenaria-join-input value="${escapeHtml(pl.joinKey || '')}" placeholder="Chave da plenária" aria-label="Chave da plenária" maxlength="16" autocapitalize="characters">
              <button class="chat-list-icon" data-action="joinPlenaria" title="Entrar" ${pl.joining ? 'disabled' : ''}>${icon('check')}</button>
              <button class="chat-list-icon" data-action="toggleJoinPlenaria" title="Cancelar">${icon('x')}</button>
            </div>`
              : ''
          }
          <div class="chat-list">
            ${renderConvoList()}
          </div>
        </aside>
        <div class="chat-main">
          ${isPlenaria ? renderPlenariaMain() : renderChatMainInner(chat)}
        </div>
      </section>
    `;
  }

  // The 1:1 chat main pane (context + messages + composer + buddy). Unchanged
  // behaviour — just extracted so renderChat can branch to the plenária pane.
  // The corpus outgrew a plain <select> (hundreds of skills), so adding context is a small
  // combobox: an OPTIONAL domain filter (empty = every domain) plus a live name search over
  // the skills still addable to this conversation. Only one picker is open at a time.
  function skillPickerState() {
    if (!state.skillPicker) {
      state.skillPicker = { kind: null, domain: '', query: '' };
    }
    return state.skillPicker;
  }
  // Skills that can still be added to this conversation (kind = 'chats' | 'plenarias').
  function addableSkillsFor(kind) {
    const all = state.skills || [];
    let taken = [];
    if (kind === 'plenarias') {
      const pl = state.plenaria;
      taken = (pl && pl.current && pl.current.skillIds) || [];
    } else {
      const chat = state.chat;
      taken = chat && chat.current ? chat.current.skillIds || [] : (chat && chat.pendingSkillIds) || [];
    }
    return all.filter((s) => !taken.includes(s.id));
  }
  const pickerNorm = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  // The filtered suggestions. Rebuilt in place on every keystroke (never a full re-render,
  // so the input keeps focus and the caret).
  function renderSkillPickerOptions(kind) {
    const sp = skillPickerState();
    const dom = pickerNorm(sp.domain).trim();
    const q = pickerNorm(sp.query).trim();
    const matches = addableSkillsFor(kind).filter((s) => {
      if (dom && !pickerNorm(skillDomainOf(s)).includes(dom)) {
        return false;
      }
      if (!q) {
        return true;
      }
      return pickerNorm(`${s.nome} ${s.id}`).includes(q);
    });
    if (!matches.length) {
      return '<p class="skill-picker-empty">Nenhuma skill encontrada.</p>';
    }
    return (
      matches
        .slice(0, 60)
        .map(
          (s) => `
      <button type="button" class="skill-picker-item" data-action="pickSkill" data-kind="${kind}" data-id="${escapeHtml(s.id)}">
        <span class="skill-picker-name">${s.deprecated ? '⚠ ' : ''}${escapeHtml(s.nome)}${s.deprecated ? ' (depreciada)' : ''}</span>
        <small class="skill-picker-dom">${escapeHtml(skillDomainOf(s) || '—')}</small>
      </button>`
        )
        .join('') +
      (matches.length > 60 ? `<p class="skill-picker-empty">+${matches.length - 60} — refine a busca.</p>` : '')
    );
  }
  function renderSkillPicker(kind) {
    const sp = skillPickerState();
    const open = sp.kind === kind;
    const addable = addableSkillsFor(kind);
    if (!addable.length) {
      return '';
    }
    // The trigger stays in the context bar and the panel FLOATS over the conversation
    // (absolute, anchored to the trigger) — opening it must never reflow the chat.
    const trigger = `<button type="button" class="chat-context-add skill-picker-open${open ? ' is-open' : ''}" data-action="toggleSkillPicker" data-kind="${kind}" aria-expanded="${open}">+ skill</button>`;
    if (!open) {
      return `<span class="skill-picker-anchor">${trigger}</span>`;
    }
    // Domains that actually have an addable skill (no dead options), for the native
    // type-ahead on the optional domain field.
    const domains = [...new Set(addable.map(skillDomainOf).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return `
      <span class="skill-picker-anchor">
        ${trigger}
        <div class="skill-picker" data-skill-picker="${kind}">
          <div class="skill-picker-fields">
            <input class="skill-picker-input" data-skill-picker-domain="${kind}" list="skill-picker-domains-${kind}"
                   placeholder="Domínio (opcional)" value="${escapeHtml(sp.domain || '')}" aria-label="Filtrar por domínio">
            <datalist id="skill-picker-domains-${kind}">${domains.map((d) => `<option value="${escapeHtml(d)}"></option>`).join('')}</datalist>
            <input class="skill-picker-input" data-skill-picker-query="${kind}" placeholder="Buscar skill…"
                   value="${escapeHtml(sp.query || '')}" aria-label="Buscar skill pelo nome" autofocus>
            <button type="button" class="chat-list-icon" data-action="closeSkillPicker" title="Fechar">${icon('x')}</button>
          </div>
          <div class="skill-picker-list" data-skill-picker-list="${kind}">${renderSkillPickerOptions(kind)}</div>
        </div>
      </span>`;
  }

  function renderChatMainInner(chat) {
    const current = chat.current;
    const allSkills = state.skills || [];
    // With no chat open yet, the context bar is backed by a "pending" selection that
    // becomes the new chat's context on the first send (or on "Nova conversa").
    const contextIds = current ? current.skillIds || [] : chat.pendingSkillIds || [];
    const contextSkills = contextIds.map((id) => allSkills.find((skill) => skill.id === id)).filter(Boolean);
    const addable = allSkills.filter((skill) => !contextIds.includes(skill.id));
    return `
      <div class="chat-context">
        <span class="chat-context-label">${icon('lightbulb')}Contexto</span>
        ${
          contextSkills.length
            ? contextSkills
                .map(
                  (skill) =>
                    `<span class="tag-chip${skill.deprecated ? ' tag-chip-deprecated' : ''}" ${skill.deprecated ? `title="Skill depreciada: ${escapeHtml(((skill.deprecation || {}).reasons || []).join(' · ') || 'conteúdo possivelmente desatualizado')}"` : ''}>${skill.deprecated ? '⚠ ' : ''}${escapeHtml(skill.nome)}<button type="button" class="tag-chip-x" data-action="removeChatSkill" data-id="${skill.id}" aria-label="Remover ${escapeHtml(skill.nome)}">×</button></span>`
                )
                .join('')
            : `<span class="chat-context-none">nenhuma skill — a IA responde de forma geral${current ? '' : ' (escolha skills abaixo antes de perguntar)'}</span>`
        }
        ${renderSkillPicker('chats')}
        <div class="chat-actions">
          ${renderSkillFilesToggle('chats', current ? contextIds : [])}
          <button class="ghost-button small" data-action="chatScrollBottom" title="Ir para a última mensagem">${icon('chevron')}Ir ao final</button>
          <button class="ghost-button small" data-action="exportChat" title="Exportar a conversa em YAML">${icon('download')}Exportar</button>
          <button class="ghost-button small" data-action="chatToggleExpand" title="${chat.expanded ? 'Mostrar a lista de conversas' : 'Esconder a lista e maximizar o chat'}">${icon(chat.expanded ? 'menu' : 'expand')}${chat.expanded ? 'Mostrar lista' : 'Expandir'}</button>
        </div>
      </div>
      ${renderSkillFilesPanel('chats')}
      <div class="chat-messages" data-chat-scroll>
        ${
          current && current.messages && current.messages.length
            ? current.messages.map((message, index) => renderChatMessage(message, index)).join('')
            : '<div class="chat-welcome">Converse com suas skills. Escolha skills como <strong>contexto</strong> acima e pergunte — e avalie cada resposta com <strong>Bom / Fraco / Errado</strong> para registrar feedback na skill.<br><small>Requer seu provedor + chave de IA em Configurações.</small></div>'
        }
        ${chat.streaming != null ? `<div class="chat-msg assistant" data-chat-streaming><div class="chat-tools" data-chat-tools>${(chat.toolActivity || []).map(renderChatToolItem).join('')}</div><div class="chat-bubble"><span class="chat-stream-text">${escapeHtml(parseMoodStreaming(chat.streaming).text)}</span><span class="chat-caret" aria-hidden="true"></span></div></div>` : ''}
      </div>
      <div class="chat-composer">
        ${renderComposerAttach('chats')}
        <textarea data-chat-input rows="2" placeholder="Escreva sua mensagem…  (Enter envia · Shift+Enter quebra linha)" ${chat.sending ? 'disabled' : ''}>${escapeHtml(chat.input || '')}</textarea>
        <button class="primary-button" data-action="sendChat" ${chat.sending ? 'disabled' : ''}>${icon('send')}Enviar</button>
      </div>
      ${renderChatBuddyBar(chat)}
    `;
  }

  const CHAT_VERDICT_LABEL = { bom: 'Bom', fraco: 'Fraco', errado: 'Errado' };

  // Register an eval verdict (bom/fraco/errado) on an assistant answer against the
  // chat's context skill(s) → surfaces in the skill's curator feedback view.
  async function rateChatMessage(index, verdict) {
    const chat = ensureChatState();
    if (!chat.current) {
      return;
    }
    if (!(chat.current.skillIds && chat.current.skillIds.length)) {
      toast('Adicione uma skill como contexto para avaliar a resposta.', 'warning');
      return;
    }
    try {
      const res = await fetch('/api/chats/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: chat.currentId, index, verdict })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao registrar feedback.');
      }
      chat.ratings = chat.ratings || {};
      chat.ratings[index] = verdict;
      toast('Feedback registrado para a skill.', 'success');
      renderShell();
    } catch (error) {
      toast(error.message, 'warning');
    }
  }

  // Persist a renamed conversation title (inline edit in the chat list).
  async function saveChatRename(id) {
    const chat = ensureChatState();
    const input = document.querySelector('[data-chat-rename-input]');
    const title = input ? String(input.value || '').trim() : '';
    if (!title) {
      chat.renamingId = null;
      renderShell();
      return;
    }
    try {
      const res = await fetch('/api/chats/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, title })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao renomear a conversa.');
      }
      const entry = chat.list.find((item) => item.id === id);
      if (entry) {
        entry.title = (data.chat && data.chat.title) || title;
      }
      if (chat.current && chat.currentId === id) {
        chat.current.title = (data.chat && data.chat.title) || title;
      }
      chat.renamingId = null;
      renderShell();
    } catch (error) {
      toast(error.message, 'warning');
    }
  }

  // Wrap fenced code blocks (rendered as <pre class="md-code">) with a copy button
  // docked top-right. Used in the chat so snippets can be grabbed in one click.
  function withCopyButtons(html) {
    return String(html).replace(
      /<pre class="md-code"([^>]*)>([\s\S]*?)<\/pre>/g,
      (match, attrs, inner) =>
        `<div class="code-block"><button class="code-copy" type="button" data-action="copyCode" title="Copiar código" aria-label="Copiar código">${icon('copy')}<span class="code-copy-label">Copiar</span></button><pre class="md-code"${attrs}>${inner}</pre></div>`
    );
  }

  async function copyCode(button) {
    const block = button.closest('.code-block');
    const pre = block && block.querySelector('pre.md-code');
    if (!pre) {
      return;
    }
    try {
      await navigator.clipboard.writeText(pre.textContent);
      const label = button.querySelector('.code-copy-label');
      button.classList.add('is-copied');
      if (label) {
        label.textContent = 'Copiado';
      }
      setTimeout(() => {
        button.classList.remove('is-copied');
        if (label) {
          label.textContent = 'Copiar';
        }
      }, 1500);
    } catch (error) {
      toast('Não foi possível copiar.', 'warning');
    }
  }

  // Short human label for a live tool call (paged grounding): reading a file vs (re)indexing.
  function chatToolLabel(evt) {
    if (!evt) return 'consultando…';
    if (evt.name === 'read_context') {
      const p = evt.input && evt.input.path;
      return p ? `Lendo ${p}` : 'Lendo arquivo de contexto';
    }
    if (evt.name === 'list_context') return 'Indexando contexto disponível';
    if (evt.name === 'contribute_to_queue') {
      const s = evt.input && evt.input.skill_id;
      return `Enviando contribuição para a fila${s ? ` (${s})` : ''}…`;
    }
    return String(evt.name || 'ferramenta');
  }
  function renderChatToolItem(evt) {
    return `<span class="chat-tool-item"><span class="chat-tool-dot" aria-hidden="true"></span>${escapeHtml(chatToolLabel(evt))}</span>`;
  }

  // A "Fontes" source is a corpus path "<skill-id>/<rel>". Link it to the raw file
  // view so it opens in a new browser tab (behind the same SSO as the SPA).
  function sourceHref(source) {
    const s = String(source || '');
    // Skill ids can be folder-based (<domain>/<slug>), so resolve the skill/rel boundary against
    // the known catalog rather than splitting on the first slash (which would send skill=<domain>
    // and misroute the access check). Fall back to the first-slash split for anything not in the catalog.
    const skill = (state.skills || []).find((k) => s === k.id || s.startsWith(`${k.id}/`));
    if (skill) {
      const rel = s.slice(skill.id.length + 1);
      if (!rel) {
        return null;
      }
      return `/api/explore/file?skill=${encodeURIComponent(skill.id)}&path=${encodeURIComponent(rel)}&raw=1`;
    }
    const slash = s.indexOf('/');
    if (slash < 1) {
      return null;
    }
    return `/api/explore/file?skill=${encodeURIComponent(s.slice(0, slash))}&path=${encodeURIComponent(s.slice(slash + 1))}&raw=1`;
  }

  // The clickable "Fontes" block, shared by chat and plenária assistant messages.
  // Few sources render inline; more than 3 collapse into a <details> to save space.
  function renderSourcesBlock(sources) {
    if (!Array.isArray(sources) || !sources.length) {
      return '';
    }
    const chips = sources
      .map((s) => {
        const href = sourceHref(s);
        return href
          ? `<a class="chat-source-chip" href="${href}" target="_blank" rel="noopener" title="Abrir ${escapeHtml(s)} em nova aba">${escapeHtml(s)}</a>`
          : `<span class="chat-source-chip">${escapeHtml(s)}</span>`;
      })
      .join('');
    const label = `${icon('lightbulb')}Fontes`;
    const tip = 'Arquivos de contexto usados nesta resposta — clique para abrir';
    if (sources.length <= 3) {
      return `
        <div class="chat-sources" title="${tip}">
          <span class="chat-sources-label">${label}</span>
          ${chips}
        </div>`;
    }
    return `
        <details class="chat-sources chat-sources-collapsible" title="${tip}">
          <summary class="chat-sources-summary"><span class="chat-sources-label">${label}</span><span class="chat-sources-count">${sources.length} arquivos</span>${icon('chevron', 'chat-sources-caret')}</summary>
          <div class="chat-sources-chips">${chips}</div>
        </details>`;
  }

  // Provenance stamp for answers that ran AI-WRITTEN SQL (run_sql): a visible "não
  // governado" badge + the exact SQL, so a number from ad-hoc SQL is never mistaken
  // for a governed one. When the turn's final query was drafted to the curation
  // queue, the badge says so — approval turns it into a governed query/<slug>.sql.
  function renderAdhocSqlBlock(adhoc) {
    if (!Array.isArray(adhoc) || !adhoc.length) {
      return '';
    }
    const drafted = adhoc.find((a) => a.queueId);
    const runs = adhoc
      .map(
        (a, i) => `
        <div class="chat-adhoc-run">
          <span class="chat-adhoc-run-label">${escapeHtml(a.titulo || `consulta ${i + 1}`)}${a.queueId ? ' · rascunho na fila de curadoria' : ''}</span>
          <pre class="chat-adhoc-sql">${escapeHtml(a.sql || '')}</pre>
        </div>`
      )
      .join('');
    return `
        <details class="chat-sources chat-sources-collapsible chat-adhoc" title="Esta resposta usou SQL escrita pela IA (não governada) — confira as premissas antes de reusar o número">
          <summary class="chat-sources-summary"><span class="chat-adhoc-badge">${icon('alert')}SQL gerada por IA</span><span class="chat-sources-count">${adhoc.length === 1 ? '1 consulta' : `${adhoc.length} consultas`}${drafted ? ' · rascunho enviado ao curador' : ''}</span>${icon('chevron', 'chat-sources-caret')}</summary>
          <div class="chat-adhoc-body">${runs}${drafted && drafted.proposedPath ? `<p class="chat-adhoc-note">Se aprovada pelo curador, vira a query governada <code>${escapeHtml(drafted.proposedPath)}</code>.</p>` : ''}</div>
        </details>`;
  }

  function renderChatMessage(message, index) {
    const isUser = message.role === 'user';
    const shown = isUser ? message.content || '' : parseMood(message.content).text;
    const rated = state.chat && state.chat.ratings ? state.chat.ratings[index] : null;
    const sources = isUser ? '' : renderSourcesBlock(message.sources) + renderAdhocSqlBlock(message.adhocSql);
    const rateBar = isUser
      ? ''
      : `
        <div class="chat-msg-actions chat-rate">
          <span class="chat-rate-label">Avaliar:</span>
          ${['bom', 'fraco', 'errado'].map((v) => `<button class="chat-rate-btn rate-${v}${rated === v ? ' active' : ''}" data-action="rateChat" data-index="${index}" data-verdict="${v}"${rated ? ' disabled' : ''}>${CHAT_VERDICT_LABEL[v]}</button>`).join('')}
          ${rated ? `<span class="chat-rate-done">${icon('check')}registrado</span>` : ''}
        </div>`;
    return `
      <div class="chat-msg ${isUser ? 'user' : 'assistant'}">
        <div class="chat-bubble">${withCopyButtons(renderMarkdownSafe(shown, isUser ? { sqlFormat: true } : { corpusKind: 'chats', corpusId: state.chat && state.chat.currentId, sqlFormat: true }))}</div>${isUser ? renderMessageAttachments('chats', state.chat && state.chat.currentId, message.attachments) : ''}${sources}${rateBar}
      </div>
    `;
  }
  // Plenárias (client) — the multi-user twin of chat. Shares the chat shell (same
  // history sidebar + composer look), but each open room holds a live EventSource
  // so messages, buddy tokens, and presence arrive in real time. State lives in a
  // parallel `state.plenaria` slice so the working 1:1 chat path is untouched.
  function ensurePlenariaState() {
    if (!state.plenaria) {
      state.plenaria = {
        list: [],
        currentId: null,
        current: null,
        input: '',
        sending: false,
        askBuddy: false,
        streaming: null,
        buddyCache: {},
        ratings: {},
        es: null,
        online: [],
        joinOpen: false,
        joinKey: '',
        joining: false,
        renamingId: null,
        loading: false,
        error: null
      };
    }
    return state.plenaria;
  }

  function myEmailLower() {
    return String((currentAccessUser() && currentAccessUser().email) || '').toLowerCase();
  }

  async function openPlenarias() {
    const pl = ensurePlenariaState();
    try {
      const res = await fetch('/api/plenarias');
      const data = await readJsonResponse(res);
      pl.list = data.ok && data.plenarias ? data.plenarias : [];
    } catch (error) {
      // non-fatal: the chat list still renders without plenárias
    }
  }

  // One merged, type-badged list of the user's conversations (1:1 chats) and the
  // plenárias they belong to, most-recent first. Rename is inline per type.
  function renderConvoList() {
    const chat = ensureChatState();
    const pl = ensurePlenariaState();
    const entries = [
      ...chat.list.map((e) => ({ ...e, _kind: 'chat' })),
      ...pl.list.map((e) => ({ ...e, _kind: 'plenaria' }))
    ].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    if (!entries.length) {
      return '<p class="chat-empty-list">Nenhuma conversa ainda.</p>';
    }
    return entries
      .map((entry) => {
        if (entry._kind === 'plenaria') {
          const active = chat.openType === 'plenaria' && pl.currentId === entry.id;
          if (pl.renamingId === entry.id) {
            return `
            <div class="chat-list-item editing">
              <input class="chat-rename-input" data-plenaria-rename-input value="${escapeHtml(entry.title || '')}" aria-label="Novo nome da plenária" maxlength="120">
              <button class="chat-list-icon" data-action="savePlenariaRename" data-id="${entry.id}" title="Salvar">${icon('check')}</button>
              <button class="chat-list-icon" data-action="cancelPlenariaRename" title="Cancelar">${icon('x')}</button>
            </div>`;
          }
          return `
          <div class="chat-list-item ${active ? 'active' : ''}">
            <button class="chat-list-open" data-action="openPlenariaItem" data-id="${entry.id}">
              <strong><span class="convo-badge convo-badge-plenaria" title="Plenária">${icon('users')}</span>${escapeHtml(entry.title || 'Plenária')}</strong>
              <small>${escapeHtml(queueWhen(entry.updatedAt))} · ${pluralize(entry.participantCount || 0, 'participante', 'participantes')}</small>
            </button>
            ${entry.isOwner ? `<button class="chat-list-icon" data-action="renamePlenaria" data-id="${entry.id}" title="Renomear plenária">${icon('edit')}</button>` : ''}
            ${
              entry.isOwner
                ? `<button class="chat-list-del" data-action="deletePlenaria" data-id="${entry.id}" title="Excluir plenária">${icon('x')}</button>`
                : `<button class="chat-list-del" data-action="leavePlenaria" data-id="${entry.id}" title="Sair da plenária">${icon('logout')}</button>`
            }
          </div>`;
        }
        // chat entry (mirrors the original chat-list markup)
        const active = chat.openType !== 'plenaria' && entry.id === chat.currentId;
        if (chat.renamingId === entry.id) {
          return `
          <div class="chat-list-item editing">
            <input class="chat-rename-input" data-chat-rename-input value="${escapeHtml(entry.title || '')}" aria-label="Novo nome da conversa" maxlength="120">
            <button class="chat-list-icon" data-action="saveChatRename" data-id="${entry.id}" title="Salvar">${icon('check')}</button>
            <button class="chat-list-icon" data-action="cancelChatRename" title="Cancelar">${icon('x')}</button>
          </div>`;
        }
        return `
        <div class="chat-list-item ${active ? 'active' : ''}">
          <button class="chat-list-open" data-action="openChatItem" data-id="${entry.id}">
            <strong><span class="convo-badge convo-badge-chat" title="Conversa">${icon('chat')}</span>${escapeHtml(entry.title || 'Conversa')}</strong>
            <small>${escapeHtml(queueWhen(entry.updatedAt))} · ${pluralize(entry.messageCount || 0, 'mensagem', 'mensagens')}</small>
          </button>
          <button class="chat-list-icon" data-action="renameChat" data-id="${entry.id}" title="Renomear conversa">${icon('edit')}</button>
          <button class="chat-list-del" data-action="deleteChat" data-id="${entry.id}" title="Excluir conversa">${icon('x')}</button>
        </div>`;
      })
      .join('');
  }

  // Participant strip (name + live online dot; the organizer is flagged).
  function renderPlenariaPresence() {
    const pl = ensurePlenariaState();
    const p = pl.current;
    if (!p) return '';
    const online = new Set((pl.online || []).map((e) => String(e).toLowerCase()));
    const ownerEmail = String((p.owner && p.owner.email) || '').toLowerCase();
    const parts = p.participants || [];
    const chips = parts
      .map((u) => {
        const on = online.has(String(u.email || '').toLowerCase());
        const isOwner = String(u.email || '').toLowerCase() === ownerEmail;
        return `<span class="plenaria-chip${on ? ' online' : ''}" title="${escapeHtml(u.email || '')}${on ? ' · online' : ''}"><span class="plenaria-dot"></span>${escapeHtml(u.name || u.email || '—')}${isOwner ? `<span class="plenaria-owner-badge" title="organizador">${icon('key')}</span>` : ''}</span>`;
      })
      .join('');
    return `<span class="plenaria-parts-label">${icon('users')}${parts.length}</span>${chips}`;
  }

  function plenariaComputePose(pl, buddy) {
    const fallback = (buddy && buddy.default_pose) || 'idle';
    if (pl.streaming != null) {
      const visible = parseMoodStreaming(pl.streaming);
      return visible.text ? visible.mood || 'writing' : 'thinking';
    }
    const messages = (pl.current && pl.current.messages) || [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'assistant') {
        return parseMood(messages[i].content).mood || fallback;
      }
    }
    return fallback;
  }

  function plenariaBuddyStatus(pl) {
    if (pl.streaming == null) return '';
    return parseMoodStreaming(pl.streaming).text ? 'escrevendo…' : 'pensando…';
  }

  async function ensurePlenariaBuddyLoaded(id) {
    const pl = ensurePlenariaState();
    if (!id || pl.buddyCache[id]) return;
    pl.buddyCache[id] = { loading: true };
    try {
      const res = await fetch(`/api/buddies/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
      const data = await res.json().catch(() => ({}));
      pl.buddyCache[id] =
        res.ok && data.ok
          ? {
              id,
              name: data.name || id,
              default_pose: data.default_pose || 'idle',
              poses: Array.isArray(data.poses) ? data.poses : []
            }
          : { error: true };
    } catch (error) {
      pl.buddyCache[id] = { error: true };
    }
    if (state.view === 'chat' && ensureChatState().openType === 'plenaria') {
      renderShell();
    }
  }

  function setPlenariaBuddyPose(poseCode) {
    const pl = state.plenaria;
    if (!pl) return;
    const id = chatPrimaryBuddyId(pl);
    const buddy = id && pl.buddyCache[id];
    if (!buddy || buddy.loading || buddy.error) return;
    const url = chatBuddyPoseUrl(buddy, poseCode);
    const img = document.querySelector('[data-buddy-avatar] img');
    if (img && url && img.getAttribute('src') !== url) {
      img.src = url;
    }
    const status = document.querySelector('[data-buddy-status]');
    if (status) {
      status.textContent = plenariaBuddyStatus(pl);
    }
  }

  function renderPlenariaBuddyBar() {
    if (state.buddySize === 'off') return '';
    const pl = ensurePlenariaState();
    const id = chatPrimaryBuddyId(pl);
    if (!id) return '';
    let buddy = pl.buddyCache[id];
    if (buddy === undefined) {
      ensurePlenariaBuddyLoaded(id);
      buddy = pl.buddyCache[id];
    }
    if (!buddy || buddy.loading || buddy.error) return '';
    const url = chatBuddyPoseUrl(buddy, plenariaComputePose(pl, buddy));
    if (!url) return '';
    const size = BUDDY_SIZES.includes(state.buddySize) ? state.buddySize : 'medium';
    return `
      <div class="chat-buddy chat-buddy--${size}" data-buddy-avatar>
        <small class="chat-buddy-status" data-buddy-status>${escapeHtml(plenariaBuddyStatus(pl))}</small>
        <img src="${escapeHtml(url)}" alt="${escapeHtml(buddy.name)}" title="${escapeHtml(buddy.name)}">
      </div>`;
  }

  function renderPlenariaMessage(message, index) {
    const pl = ensurePlenariaState();
    if (message.role === 'assistant') {
      const shown = parseMood(message.content).text;
      const rated = pl.ratings ? pl.ratings[index] : null;
      const rateBar = `
        <div class="chat-msg-actions chat-rate">
          <span class="chat-rate-label">Avaliar:</span>
          ${['bom', 'fraco', 'errado'].map((v) => `<button class="chat-rate-btn rate-${v}${rated === v ? ' active' : ''}" data-action="ratePlenaria" data-index="${index}" data-verdict="${v}"${rated ? ' disabled' : ''}>${CHAT_VERDICT_LABEL[v]}</button>`).join('')}
          ${rated ? `<span class="chat-rate-done">${icon('check')}registrado</span>` : ''}
        </div>`;
      return `<div class="chat-msg assistant"><div class="chat-bubble">${withCopyButtons(renderMarkdownSafe(shown, { corpusKind: 'plenarias', corpusId: pl.currentId, sqlFormat: true }))}</div>${renderSourcesBlock(message.sources)}${renderAdhocSqlBlock(message.adhocSql)}${rateBar}</div>`;
    }
    const author = message.author || {};
    const mine = myEmailLower() && String(author.email || '').toLowerCase() === myEmailLower();
    const name = author.name || author.email || 'Participante';
    return `
      <div class="chat-msg ${mine ? 'user' : 'peer'}">
        ${mine ? '' : `<span class="chat-msg-author">${escapeHtml(name)}</span>`}
        <div class="chat-bubble">${withCopyButtons(renderMarkdownSafe(message.content || '', { sqlFormat: true }))}</div>${renderMessageAttachments('plenarias', pl.currentId, message.attachments)}
      </div>`;
  }

  function renderPlenariaMain() {
    const pl = ensurePlenariaState();
    const p = pl.current;
    if (!p) {
      return '<div class="chat-welcome">Selecione ou crie uma plenária.</div>';
    }
    const allSkills = state.skills || [];
    const contextIds = p.skillIds || [];
    const contextSkills = contextIds.map((id) => allSkills.find((s) => s.id === id)).filter(Boolean);
    const addable = allSkills.filter((s) => !contextIds.includes(s.id));
    const isOwner = !!p.isOwner;
    const chat = ensureChatState();
    return `
      <div class="plenaria-bar">
        <div class="plenaria-parts" data-plenaria-presence>${renderPlenariaPresence()}</div>
        ${
          isOwner
            ? `
          <div class="plenaria-key" title="Compartilhe esta chave para outras pessoas entrarem">
            <span class="plenaria-key-label">${icon('key')}Chave</span>
            <code class="plenaria-key-code" data-plenaria-key>${escapeHtml(p.joinKey || '')}</code>
            <button class="chat-list-icon" data-action="copyPlenariaKey" title="Copiar chave">${icon('copy')}</button>
            <button class="chat-list-icon" data-action="regeneratePlenariaKey" data-id="${p.id}" title="Gerar nova chave">${icon('spark')}</button>
          </div>`
            : `
          <button class="ghost-button small plenaria-leave" data-action="leavePlenaria" data-id="${p.id}">${icon('logout')}Sair da plenária</button>`
        }
      </div>
      <div class="chat-context">
        <span class="chat-context-label">${icon('lightbulb')}Contexto</span>
        ${
          contextSkills.length
            ? contextSkills
                .map(
                  (skill) =>
                    `<span class="tag-chip">${escapeHtml(skill.nome)}${isOwner ? `<button type="button" class="tag-chip-x" data-action="removePlenariaSkill" data-id="${skill.id}" aria-label="Remover ${escapeHtml(skill.nome)}">×</button>` : ''}</span>`
                )
                .join('')
            : '<span class="chat-context-none">nenhuma skill — o buddy responde de forma geral</span>'
        }
        ${isOwner ? renderSkillPicker('plenarias') : ''}
        <div class="chat-actions">
          ${renderSkillFilesToggle('plenarias', contextIds)}
          <button class="ghost-button small" data-action="chatScrollBottom" title="Ir para a última mensagem">${icon('chevron')}Ir ao final</button>
          <button class="ghost-button small" data-action="exportPlenaria" title="Exportar a plenária em YAML">${icon('download')}Exportar</button>
          <button class="ghost-button small" data-action="chatToggleExpand" title="${chat.expanded ? 'Mostrar a lista de conversas' : 'Esconder a lista e maximizar o chat'}">${icon(chat.expanded ? 'menu' : 'expand')}${chat.expanded ? 'Mostrar lista' : 'Expandir'}</button>
        </div>
      </div>
      ${renderSkillFilesPanel('plenarias')}
      <div class="chat-messages" data-chat-scroll>
        ${
          p.messages && p.messages.length
            ? p.messages.map((message, index) => renderPlenariaMessage(message, index)).join('')
            : '<div class="chat-welcome">Plenária aberta. Converse com o grupo — ligue <strong>Perguntar ao buddy</strong> (ou mencione o nome do buddy) para chamar a IA.</div>'
        }
        ${pl.streaming != null ? `<div class="chat-msg assistant" data-plenaria-streaming><div class="chat-bubble"><span class="chat-stream-text">${escapeHtml(parseMoodStreaming(pl.streaming).text)}</span><span class="chat-caret" aria-hidden="true"></span></div></div>` : ''}
      </div>
      <div class="chat-composer plenaria-composer">
        <label class="plenaria-ask ${pl.askBuddy ? 'on' : ''}" title="Ligado: sua mensagem também pergunta ao buddy. Você também pode mencionar o nome do buddy ou @buddy.">
          <input type="checkbox" data-plenaria-ask-toggle ${pl.askBuddy ? 'checked' : ''}>
          ${icon('smiley')}Perguntar ao buddy
        </label>
        ${renderComposerAttach('plenarias')}
        <textarea data-plenaria-input rows="2" placeholder="Fale com a plenária…  (Enter envia · Shift+Enter quebra linha)" ${pl.sending ? 'disabled' : ''}>${escapeHtml(pl.input || '')}</textarea>
        <button class="primary-button" data-action="sendPlenaria" ${pl.sending ? 'disabled' : ''}>${icon('send')}Enviar</button>
      </div>
      ${renderPlenariaBuddyBar()}
    `;
  }
  function plenariaDisconnect() {
    const pl = state.plenaria;
    if (pl && pl.es) {
      try {
        pl.es.close();
      } catch (error) {
        /* ignore */
      }
      pl.es = null;
    }
  }

  function plenariaConnect(id) {
    plenariaDisconnect();
    const pl = ensurePlenariaState();
    let es;
    try {
      es = new EventSource(`/api/plenarias/stream?id=${encodeURIComponent(id)}`);
    } catch (error) {
      return;
    }
    pl.es = es;
    let opened = false;
    es.onopen = () => {
      // Fires on every (re)connect. The first open is the initial connect (data is
      // already fresh from openPlenariaItem). Any SUBSEQUENT open is a reconnect —
      // after a network blip, a laptop sleep, or a server redeploy — so refetch the
      // room to backfill whatever was sent during the gap.
      if (opened && pl.currentId === id) {
        resyncPlenaria(id);
      }
      opened = true;
    };
    es.onmessage = (ev) => {
      let evt;
      try {
        evt = JSON.parse(ev.data);
      } catch (error) {
        return;
      }
      // Ignore stale events from a room we've since navigated away from.
      if (pl.currentId !== id) return;
      handlePlenariaEvent(evt);
    };
    es.onerror = () => {
      /* EventSource auto-reconnects; onopen resyncs on reopen */
    };
  }

  // Refetch the room after a reconnect and take server truth (also drops any stale
  // in-progress streaming bubble). Silent on failure — the live channel is still up,
  // so the next event or a manual action reconciles.
  async function resyncPlenaria(id) {
    const pl = ensurePlenariaState();
    try {
      const res = await fetch(`/api/plenarias/item?id=${encodeURIComponent(id)}`);
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok || pl.currentId !== id) {
        return;
      }
      pl.current = data.plenaria;
      pl.online = data.plenaria.online || [];
      pl.streaming = null;
      renderShellKeepingComposer();
      scrollChatToBottom();
    } catch (error) {
      /* keep the live channel open; do not disrupt the view */
    }
  }

  // Re-render the shell without losing what the user is typing (or their caret).
  function renderShellKeepingComposer() {
    const el = document.activeElement;
    const isComposer = el && el.matches && el.matches('[data-plenaria-input]');
    const caret = isComposer ? el.selectionStart : null;
    renderShell();
    if (isComposer) {
      const again = document.querySelector('[data-plenaria-input]');
      if (again) {
        again.focus();
        if (caret != null) {
          try {
            again.setSelectionRange(caret, caret);
          } catch (error) {
            /* ignore */
          }
        }
      }
    }
  }

  function paintPlenariaStream() {
    const pl = ensurePlenariaState();
    const parsed = parseMoodStreaming(pl.streaming);
    const el = document.querySelector('[data-plenaria-streaming] .chat-stream-text');
    if (el) {
      el.textContent = parsed.text;
    }
    setPlenariaBuddyPose(parsed.text ? parsed.mood || 'writing' : 'thinking');
    scrollChatToBottom();
  }

  function handlePlenariaEvent(evt) {
    const pl = ensurePlenariaState();
    if (!pl.current) return;
    switch (evt.type) {
      case 'presence': {
        pl.online = evt.online || [];
        const strip = document.querySelector('[data-plenaria-presence]');
        if (strip) {
          strip.innerHTML = renderPlenariaPresence();
        } else {
          renderShellKeepingComposer();
        }
        break;
      }
      case 'joined':
      case 'left': {
        if (evt.participants) {
          pl.current.participants = evt.participants;
        }
        const strip = document.querySelector('[data-plenaria-presence]');
        if (strip) {
          strip.innerHTML = renderPlenariaPresence();
        } else {
          renderShellKeepingComposer();
        }
        break;
      }
      case 'message': {
        pl.current.messages = [...(pl.current.messages || []), evt.message];
        renderShellKeepingComposer();
        scrollChatToBottom();
        break;
      }
      case 'meta': {
        pl.current.title = evt.title;
        const entry = pl.list.find((x) => x.id === pl.currentId);
        if (entry) {
          entry.title = evt.title;
        }
        renderShellKeepingComposer();
        break;
      }
      case 'skills': {
        pl.current.skillIds = evt.skillIds || [];
        renderShellKeepingComposer();
        break;
      }
      case 'buddy-start': {
        pl.streaming = '';
        renderShellKeepingComposer();
        scrollChatToBottom();
        break;
      }
      case 'buddy-delta': {
        pl.streaming = (pl.streaming || '') + (evt.text || '');
        paintPlenariaStream();
        break;
      }
      case 'buddy-done': {
        pl.streaming = null;
        if (evt.message) {
          pl.current.messages = [...(pl.current.messages || []), evt.message];
        }
        renderShellKeepingComposer();
        scrollChatToBottom();
        break;
      }
      case 'buddy-error': {
        pl.streaming = null;
        toast(evt.error || 'Falha na IA.', 'warning');
        renderShellKeepingComposer();
        break;
      }
      case 'notice': {
        toast(evt.text || '', 'default');
        break;
      }
      case 'deleted': {
        toast('Plenária encerrada pelo organizador.', 'warning');
        const goneId = pl.currentId;
        plenariaDisconnect();
        pl.current = null;
        pl.currentId = null;
        pl.list = pl.list.filter((x) => x.id !== goneId);
        ensureChatState().openType = 'chat';
        renderShell();
        break;
      }
      default:
        break;
    }
  }
  async function newPlenaria() {
    const chat = ensureChatState();
    const pl = ensurePlenariaState();
    const skillIds =
      (chat.openType === 'plenaria' ? pl.current && pl.current.skillIds : chat.current && chat.current.skillIds) || [];
    try {
      const res = await fetch('/api/plenarias', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillIds })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao criar plenária.');
      }
      pl.current = data.plenaria;
      pl.currentId = data.plenaria.id;
      pl.ratings = {};
      pl.input = '';
      pl.online = data.plenaria.online || [];
      pl.list = [
        {
          id: data.plenaria.id,
          type: 'plenaria',
          title: data.plenaria.title,
          skillIds: data.plenaria.skillIds,
          participantCount: (data.plenaria.participants || []).length,
          messageCount: 0,
          isOwner: true,
          updatedAt: data.plenaria.updatedAt
        },
        ...pl.list.filter((x) => x.id !== data.plenaria.id)
      ];
      chat.openType = 'plenaria';
      renderShell();
      plenariaConnect(pl.currentId);
      toast('Plenária criada. Compartilhe a chave para outras pessoas entrarem.', 'success');
    } catch (error) {
      toast(error.message, 'warning');
    }
  }

  function toggleJoinPlenaria() {
    const pl = ensurePlenariaState();
    pl.joinOpen = !pl.joinOpen;
    if (!pl.joinOpen) {
      pl.joinKey = '';
    }
    renderShell();
    if (pl.joinOpen) {
      const input = document.querySelector('[data-plenaria-join-input]');
      if (input) {
        input.focus();
      }
    }
  }

  async function joinPlenaria() {
    const pl = ensurePlenariaState();
    const key = String(pl.joinKey || '').trim();
    if (!key || pl.joining) {
      return;
    }
    pl.joining = true;
    try {
      const res = await fetch('/api/plenarias/join', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao entrar na plenária.');
      }
      pl.current = data.plenaria;
      pl.currentId = data.plenaria.id;
      pl.ratings = {};
      pl.input = '';
      pl.online = data.plenaria.online || [];
      pl.joinOpen = false;
      pl.joinKey = '';
      if (!pl.list.some((x) => x.id === data.plenaria.id)) {
        pl.list = [
          {
            id: data.plenaria.id,
            type: 'plenaria',
            title: data.plenaria.title,
            skillIds: data.plenaria.skillIds,
            participantCount: (data.plenaria.participants || []).length,
            messageCount: (data.plenaria.messages || []).length,
            isOwner: !!data.plenaria.isOwner,
            updatedAt: data.plenaria.updatedAt
          },
          ...pl.list
        ];
      }
      ensureChatState().openType = 'plenaria';
      renderShell();
      plenariaConnect(pl.currentId);
      scrollChatToBottom();
    } catch (error) {
      toast(error.message, 'warning');
    }
    pl.joining = false;
  }

  async function openPlenariaItem(id) {
    const pl = ensurePlenariaState();
    try {
      const res = await fetch(`/api/plenarias/item?id=${encodeURIComponent(id)}`);
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao abrir a plenária.');
      }
      pl.current = data.plenaria;
      pl.currentId = id;
      pl.ratings = {};
      pl.input = '';
      pl.streaming = null;
      pl.online = data.plenaria.online || [];
      ensureChatState().openType = 'plenaria';
      renderShell();
      scrollChatToBottom();
      plenariaConnect(id);
    } catch (error) {
      toast(error.message, 'warning');
    }
  }

  async function sendPlenariaMessage() {
    const pl = ensurePlenariaState();
    const content = String(pl.input || '').trim();
    const attachments = pendingPayload(pl);
    if ((!content && !attachments.length) || pl.sending || !pl.current) {
      return;
    }
    pl.sending = true;
    const askBuddy = !!pl.askBuddy;
    pl.input = '';
    pl.pending = [];
    // The message (with attachments) renders when its echo arrives on the live
    // channel — server is the single source of truth for ordering — so just clear here.
    renderShellKeepingComposer();
    try {
      const res = await fetch('/api/plenarias/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: pl.currentId, content, askBuddy, attachments })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao enviar a mensagem.');
      }
    } catch (error) {
      pl.input = content; // restore the unsent text + attachments so nothing is lost
      pl.pending = attachments.map((a) => ({ ...a, isImage: /^image\//.test(a.mime || ''), size: 0 }));
      toast(error.message, 'warning');
    }
    pl.sending = false;
    renderShellKeepingComposer();
  }

  function togglePlenariaAskBuddy(checked) {
    const pl = ensurePlenariaState();
    pl.askBuddy = !!checked;
    const label = document.querySelector('.plenaria-ask');
    if (label) {
      label.classList.toggle('on', pl.askBuddy);
    }
  }

  async function ratePlenariaMessage(index, verdict) {
    const pl = ensurePlenariaState();
    if (!pl.current) {
      return;
    }
    if (!(pl.current.skillIds && pl.current.skillIds.length)) {
      toast('Adicione uma skill como contexto para avaliar a resposta.', 'warning');
      return;
    }
    try {
      const res = await fetch('/api/plenarias/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: pl.currentId, index, verdict })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao registrar feedback.');
      }
      pl.ratings = pl.ratings || {};
      pl.ratings[index] = verdict;
      toast('Feedback registrado para a skill.', 'success');
      renderShellKeepingComposer();
    } catch (error) {
      toast(error.message, 'warning');
    }
  }

  function addPlenariaSkill(skillId) {
    const pl = state.plenaria;
    if (!pl || !pl.current || !skillId) {
      return;
    }
    const ids = [...(pl.current.skillIds || [])];
    if (!ids.includes(skillId)) {
      ids.push(skillId);
    }
    setPlenariaSkills(ids);
  }

  function removePlenariaSkill(skillId) {
    const pl = state.plenaria;
    if (!pl || !pl.current) {
      return;
    }
    setPlenariaSkills((pl.current.skillIds || []).filter((id) => id !== skillId));
  }

  async function setPlenariaSkills(skillIds) {
    const pl = ensurePlenariaState();
    if (!pl.current) {
      return;
    }
    try {
      const res = await fetch('/api/plenarias/skills', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: pl.currentId, skillIds })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao atualizar contexto.');
      }
      pl.current = data.plenaria;
      renderShellKeepingComposer();
    } catch (error) {
      toast(error.message, 'warning');
    }
  }

  async function copyPlenariaKey() {
    const pl = state.plenaria;
    const key = pl && pl.current && pl.current.joinKey;
    if (!key) {
      return;
    }
    try {
      await navigator.clipboard.writeText(key);
      toast('Chave copiada.', 'success');
    } catch (error) {
      toast('Não foi possível copiar a chave.', 'warning');
    }
  }

  async function regeneratePlenariaKey(id) {
    const pl = ensurePlenariaState();
    if (!confirm('Gerar uma nova chave? A chave atual deixará de funcionar.')) {
      return;
    }
    try {
      const res = await fetch('/api/plenarias/regenerate-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao gerar nova chave.');
      }
      if (pl.current && pl.currentId === id) {
        pl.current.joinKey = data.joinKey;
      }
      renderShellKeepingComposer();
      toast('Nova chave gerada.', 'success');
    } catch (error) {
      toast(error.message, 'warning');
    }
  }

  async function leavePlenaria(id) {
    const pl = ensurePlenariaState();
    if (!confirm('Sair desta plenária? Você precisará da chave para voltar.')) {
      return;
    }
    try {
      const res = await fetch('/api/plenarias/leave', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao sair da plenária.');
      }
      pl.list = pl.list.filter((x) => x.id !== id);
      if (pl.currentId === id) {
        plenariaDisconnect();
        pl.current = null;
        pl.currentId = null;
        ensureChatState().openType = 'chat';
      }
      renderShell();
      toast('Você saiu da plenária.', 'default');
    } catch (error) {
      toast(error.message, 'warning');
    }
  }

  async function deletePlenaria(id) {
    const pl = ensurePlenariaState();
    if (!confirm('Excluir esta plenária para todos os participantes? Esta ação não pode ser desfeita.')) {
      return;
    }
    try {
      const res = await fetch('/api/plenarias/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao excluir a plenária.');
      }
      pl.list = pl.list.filter((x) => x.id !== id);
      if (pl.currentId === id) {
        plenariaDisconnect();
        pl.current = null;
        pl.currentId = null;
        ensureChatState().openType = 'chat';
      }
      renderShell();
      toast('Plenária excluída.', 'success');
    } catch (error) {
      toast(error.message, 'warning');
    }
  }

  async function savePlenariaRename(id) {
    const pl = ensurePlenariaState();
    const input = document.querySelector('[data-plenaria-rename-input]');
    const title = input ? String(input.value || '').trim() : '';
    if (!title) {
      pl.renamingId = null;
      renderShell();
      return;
    }
    try {
      const res = await fetch('/api/plenarias/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, title })
      });
      const data = await readJsonResponse(res);
      if (!res.ok || !data.ok) {
        throw new Error(data.error || 'Falha ao renomear a plenária.');
      }
      const entry = pl.list.find((x) => x.id === id);
      if (entry) {
        entry.title = (data.plenaria && data.plenaria.title) || title;
      }
      if (pl.current && pl.currentId === id) {
        pl.current.title = (data.plenaria && data.plenaria.title) || title;
      }
      pl.renamingId = null;
      renderShell();
    } catch (error) {
      toast(error.message, 'warning');
    }
  }
  // Conversation files (client) — paste/attach images + files on chat & plenária
  // messages (uploaded with the message, downloaded via gated endpoints), plus a
  // panel listing the context skills' downloadable files. `kind` = 'chats'|
  // 'plenarias' (matches the API path); state = state.chat | state.plenaria.
  function convoStateFor(kind) {
    return kind === 'plenarias' ? ensurePlenariaState() : ensureChatState();
  }
  function rerenderConvo(kind) {
    if (kind === 'plenarias') {
      renderShellKeepingComposer();
    } else {
      renderShell();
    }
  }

  // Read a File into the {name, mime, contentBase64} shape the upload endpoints want.
  function fileToAttachment(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read'));
      reader.onload = () => {
        const b64 = String(reader.result || '').split(',')[1] || '';
        resolve({
          name: file.name || 'arquivo',
          mime: file.type || 'application/octet-stream',
          size: file.size || 0,
          contentBase64: b64,
          isImage: /^image\//.test(file.type || '')
        });
      };
      reader.readAsDataURL(file);
    });
  }

  const ATTACH_CLIENT_MAX = 15 * 1024 * 1024;
  async function addPendingFiles(kind, fileList) {
    const convo = convoStateFor(kind);
    const files = [...(fileList || [])];
    if (!files.length) {
      return;
    }
    convo.pending = convo.pending || [];
    for (const f of files) {
      if (convo.pending.length >= 10) {
        toast('Máximo 10 anexos por mensagem.', 'warning');
        break;
      }
      if (f.size > ATTACH_CLIENT_MAX) {
        toast(`"${f.name}" excede 15 MB.`, 'warning');
        continue;
      }
      try {
        convo.pending.push(await fileToAttachment(f));
      } catch (error) {
        toast(`Falha ao ler "${f.name}".`, 'warning');
      }
    }
    rerenderConvo(kind);
  }
  function removePendingAttachment(kind, idx) {
    const convo = convoStateFor(kind);
    if (convo.pending && idx >= 0 && idx < convo.pending.length) {
      convo.pending.splice(idx, 1);
      rerenderConvo(kind);
    }
  }
  // Strip client-only fields before sending.
  function pendingPayload(convo) {
    return (convo.pending || []).map((a) => ({ name: a.name, mime: a.mime, contentBase64: a.contentBase64 }));
  }

  // Composer: pending chips + attach button + hidden file input.
  function renderComposerAttach(kind) {
    const convo = convoStateFor(kind);
    const pend = convo.pending || [];
    const chips = pend.length
      ? `<div class="composer-attachments">${pend
          .map(
            (a, i) => `
      <span class="pending-att">${a.isImage ? `<img class="pending-att-thumb" src="data:${escapeHtml(a.mime)};base64,${a.contentBase64}" alt="">` : `<span class="pending-att-ic">${icon('file')}</span>`}<span class="pending-att-name">${escapeHtml(a.name)}</span><button type="button" class="pending-att-x" data-action="removePending" data-kind="${kind}" data-idx="${i}" aria-label="Remover anexo">×</button></span>`
          )
          .join('')}</div>`
      : '';
    return `${chips}
      <button type="button" class="composer-attach" data-action="attachFile" data-kind="${kind}" title="Anexar imagem ou arquivo">${icon('upload')}</button>
      <input type="file" data-file-input="${kind}" multiple hidden>`;
  }

  // In-message attachments: images inline (click → full), other files as download chips.
  function renderMessageAttachments(kind, convoId, attachments) {
    if (!Array.isArray(attachments) || !attachments.length || !convoId) {
      return '';
    }
    const base = `/api/${kind}/file`;
    return `<div class="msg-attachments">${attachments
      .map((a) => {
        const dl = `${base}?id=${encodeURIComponent(convoId)}&file=${encodeURIComponent(a.id)}`;
        if (/^image\//.test(a.mime || '')) {
          return `<span class="msg-att-img" data-action="viewImage" data-full="${dl}&inline=1" data-download="${dl}" data-name="${escapeHtml(a.name)}" title="${escapeHtml(a.name)}" role="button" tabindex="0"><img src="${dl}&inline=1" alt="${escapeHtml(a.name)}" loading="lazy"></span>`;
        }
        return `<a class="msg-att-file" href="${dl}" download><span class="msg-att-ic">${icon('download')}</span><span class="msg-att-name">${escapeHtml(a.name)}</span><span class="msg-att-size">${formatBytes(a.size || 0)}</span></a>`;
      })
      .join('')}</div>`;
  }

  // Skill-files panel: the context skills' downloadable files (server gates per-actor).
  async function toggleSkillFiles(kind) {
    const convo = convoStateFor(kind);
    convo.skillFiles = convo.skillFiles || { open: false };
    convo.skillFiles.open = !convo.skillFiles.open;
    rerenderConvo(kind);
    if (convo.skillFiles.open && !convo.skillFiles.data) {
      await loadSkillFiles(kind);
    }
  }
  async function loadSkillFiles(kind) {
    const convo = convoStateFor(kind);
    const id = convo.currentId;
    if (!id) {
      return;
    }
    convo.skillFiles = { open: true, loading: true, data: null };
    rerenderConvo(kind);
    try {
      const res = await fetch(`/api/${kind}/skill-files?id=${encodeURIComponent(id)}`);
      const data = await readJsonResponse(res);
      convo.skillFiles = { open: true, loading: false, data: data.ok && data.skills ? data.skills : [] };
    } catch (error) {
      convo.skillFiles = { open: true, loading: false, data: [], error: true };
    }
    rerenderConvo(kind);
  }
  function renderSkillFilesToggle(kind, skillIds) {
    if (!Array.isArray(skillIds) || !skillIds.length) {
      return '';
    }
    const convo = convoStateFor(kind);
    const open = !!(convo.skillFiles && convo.skillFiles.open);
    return `<button type="button" class="skill-files-btn ${open ? 'active' : ''}" data-action="toggleSkillFiles" data-kind="${kind}" title="Arquivos das skills de contexto">${icon('folder')}Arquivos${open ? ' ▾' : ''}</button>`;
  }
  function renderSkillFilesPanel(kind) {
    const convo = convoStateFor(kind);
    const sf = convo.skillFiles;
    if (!sf || !sf.open) {
      return '';
    }
    if (sf.loading) {
      return '<div class="skill-files-panel">Carregando arquivos…</div>';
    }
    const groups = sf.data || [];
    if (!groups.length) {
      return '<div class="skill-files-panel skill-files-empty">Nenhum arquivo acessível nas skills de contexto.</div>';
    }
    const base = `/api/${kind}/skill-file`;
    const cid = convo.currentId;
    return `<div class="skill-files-panel">${groups
      .map(
        (g) => `
      <div class="sf-group">
        <div class="sf-skill">${icon('lightbulb')}${escapeHtml(g.skillName)}</div>
        ${(g.files || [])
          .map((f) => {
            const href = `${base}?id=${encodeURIComponent(cid)}&skill=${encodeURIComponent(g.skillId)}&path=${encodeURIComponent(f.path)}`;
            // Assets show just the file name (the files/ prefix becomes the "anexo" tag).
            const shown = f.asset ? String(f.path).replace(/^files\//, '') : f.path;
            const label = `<span class="sf-file-name">${escapeHtml(shown)}${f.asset ? '<em class="sf-file-tag">anexo</em>' : ''}</span><small>${formatBytes(f.size || 0)}</small>`;
            // Viewable (PDF/image) → name opens in a tab + a separate download button; else download.
            return f.viewable
              ? `<span class="sf-file has-view"><a class="sf-file-open" href="${href}&inline=1" target="_blank" rel="noopener" title="Visualizar">${icon('file')}${label}</a><a class="sf-file-dl" href="${href}" download title="Baixar" aria-label="Baixar">${icon('download')}</a></span>`
              : `<a class="sf-file" href="${href}" download>${icon('download')}${label}</a>`;
          })
          .join('')}
      </div>`
      )
      .join('')}</div>`;
  }

  function openContributeFromChat(content, defaultSkillId) {
    const skillId = defaultSkillId || (state.skills[0] && state.skills[0].id) || '';
    state.contribute = {
      pickSkill: true,
      source: 'chat',
      skillId,
      skillName: null,
      title: '',
      content: String(content || ''),
      tags: '',
      files: [],
      reading: false,
      busy: false,
      error: null
    };
    renderShell();
  }

  function openContribute(id) {
    const skill = (state.skills || []).find((entry) => entry.id === id) || selectedSkill();
    const skillId = id || skill?.id;
    if (!skillId) {
      toast('Selecione uma skill para contribuir.', 'warning');
      return;
    }
    state.contribute = {
      skillId,
      skillName: skill?.nome || skillId,
      title: '',
      content: '',
      tags: '',
      files: [],
      reading: false,
      busy: false,
      error: null
    };
    renderShell();
  }

  function closeContribute() {
    state.contribute = null;
    renderShell();
  }

  // Read picked files into {name, mime, contentBase64} for the JSON submit (reuses fileToBase64).
  async function handleContributeFiles(fileList) {
    if (!state.contribute) {
      return;
    }
    const list = Array.from(fileList || []);
    if (!list.length) {
      return;
    }
    state.contribute.reading = true;
    state.contribute.error = null;
    renderShell();
    try {
      const read = await Promise.all(list.map(fileToBase64));
      state.contribute.files = read.map((file) => ({
        name: file.name,
        mime: file.type,
        contentBase64: file.base64,
        bytes: file.size
      }));
    } catch (error) {
      state.contribute.error = error.message || 'Falha ao ler arquivos.';
      state.contribute.files = [];
    }
    state.contribute.reading = false;
    renderShell();
  }

  async function submitContribute() {
    if (!state.contribute) {
      return;
    }
    const contribute = state.contribute;
    const content = String(contribute.content || '').trim();
    const files = contribute.files || [];
    if (!content && !files.length) {
      contribute.error = 'Escreva um texto ou anexe ao menos um arquivo.';
      renderShell();
      return;
    }
    contribute.busy = true;
    contribute.error = null;
    renderShell();
    try {
      const tags = String(contribute.tags || '')
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
      const res = await fetch('/api/queue/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          skillId: contribute.skillId,
          title: contribute.title,
          content,
          tags,
          source: contribute.source || 'web',
          files: files.map((file) => ({ name: file.name, mime: file.mime, contentBase64: file.contentBase64 }))
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        contribute.busy = false;
        contribute.error = data.error || `Falha ao enviar (HTTP ${res.status}).`;
        renderShell();
        return;
      }
      state.contribute = null;
      if (curatesActiveBalde()) {
        await refreshQueueBadge();
      }
      toast('Contribuição enviada para a fila de curadoria.', 'success');
      renderShell();
    } catch (error) {
      if (state.contribute) {
        state.contribute.busy = false;
        state.contribute.error = error.message || 'Erro de rede.';
      }
      renderShell();
    }
  }

  function renderContributeModal() {
    const contribute = state.contribute;
    return `
      <div class="modal-backdrop" role="presentation">
        <section class="modal" role="dialog" aria-modal="true" aria-label="Contribuir com a skill">
          <h2>Contribuir com contexto</h2>
          <p>${
            contribute.pickSkill
              ? 'Envie este conteúdo para a <strong>fila de curadoria</strong>. Escolha a skill de destino; um curador revisa (com apoio de IA) antes de mesclar.'
              : `Envie novo contexto para <strong>${escapeHtml(contribute.skillName)}</strong>. Ele entra na <strong>fila de curadoria</strong>: um curador revisa (com apoio de IA) antes de mesclar. Se a skill estiver errada, o curador reatribui.`
          }</p>
          ${contribute.error ? `<div class="form-alert form-alert-error">${escapeHtml(contribute.error)}</div>` : ''}
          <div class="manual-form">
            ${contribute.pickSkill ? `<label>Skill de destino<select data-contribute-field="skillId" ${contribute.busy ? 'disabled' : ''}>${(state.skills || []).map((skill) => `<option value="${skill.id}" ${skill.id === contribute.skillId ? 'selected' : ''}>${escapeHtml(skill.nome)}</option>`).join('')}</select></label>` : ''}
            <label>Título (opcional)<input data-contribute-field="title" value="${escapeHtml(contribute.title || '')}" placeholder="Resumo curto" ${contribute.busy ? 'disabled' : ''}></label>
            <label>Conteúdo<textarea data-contribute-field="content" rows="10" placeholder="Cole ou escreva o novo contexto: transcrição de reunião, e-mail, nota… (markdown)." ${contribute.busy ? 'disabled' : ''}>${escapeHtml(contribute.content || '')}</textarea></label>
            <label>Arquivos (opcional)<input type="file" multiple data-contribute-files ${contribute.busy || contribute.reading ? 'disabled' : ''}></label>
            ${contribute.reading ? '<p class="queue-hint">Lendo arquivos…</p>' : ''}
            ${contribute.files && contribute.files.length ? `<div class="queue-ai-tags">${contribute.files.map((file) => `<span class="tag-chip tag-chip-static">${icon('file')}${escapeHtml(file.name)} · ${formatBytes(file.bytes)}</span>`).join('')}</div>` : ''}
            <label>Tags (opcional, separadas por vírgula)<input data-contribute-field="tags" value="${escapeHtml(contribute.tags || '')}" placeholder="ex.: pricing, sql" ${contribute.busy ? 'disabled' : ''}></label>
          </div>
          <div class="row-actions">
            <button class="ghost-button" data-action="closeContribute">${icon('x')}Cancelar</button>
            <button class="primary-button" data-action="submitContribute" ${contribute.busy ? 'disabled' : ''}>${icon('inbox')}${contribute.busy ? 'Enviando...' : 'Enviar para a fila'}</button>
          </div>
        </section>
      </div>
    `;
  }

  return {
    ensureChatState,
    scrollChatToBottom,
    chatToggleExpand,
    exportChatYaml,
    exportPlenariaYaml,
    mentionSync,
    mentionClose,
    mentionAccept,
    mentionMenuOpen,
    handleMentionKey,
    readJsonResponse,
    openChat,
    openChatItem,
    newChat,
    sendChatMessage,
    addChatSkill,
    removeChatSkill,
    deleteChat,
    renderChat,
    skillPickerState,
    renderSkillPickerOptions,
    rateChatMessage,
    saveChatRename,
    copyCode,
    ensurePlenariaState,
    plenariaDisconnect,
    newPlenaria,
    toggleJoinPlenaria,
    joinPlenaria,
    openPlenariaItem,
    sendPlenariaMessage,
    togglePlenariaAskBuddy,
    ratePlenariaMessage,
    addPlenariaSkill,
    removePlenariaSkill,
    copyPlenariaKey,
    regeneratePlenariaKey,
    leavePlenaria,
    deletePlenaria,
    savePlenariaRename,
    addPendingFiles,
    removePendingAttachment,
    toggleSkillFiles,
    openContribute,
    closeContribute,
    handleContributeFiles,
    submitContribute,
    renderContributeModal
  };
}
