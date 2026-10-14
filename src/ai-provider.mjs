// AI provider layer (modularization stage 4): provider-agnostic calls
// (OpenAI / Anthropic / OpenAI-compatible / CLI locais). No app state — takes aiConfig,
// uses global fetch. Provedores CLI (claude-cli / codex-cli) desviam para src/ai-cli.mjs
// ANTES de qualquer exigência de apiKey — eles rodam o cliente local do usuário.
import { isCliProvider, cliChat, cliToolLoop, cliPing } from './ai-cli.mjs';

export function aiSystemPrompt(type) {
  if (type === 'skill_draft_governance_review') {
    return 'Você é um revisor de governança de skills de IA. Responda somente JSON válido com: provider, status, generatedAt, score, summary, checklist, findings, ownerActions. Para feedbacks marcados como Errado, leia a pergunta e a resposta antes de sugerir ação e classifique a causa: falta_de_contexto_negocio, fora_de_escopo, erro_de_prompt, erro_de_dados, saudacao_metapergunta ou outro. Para perguntas conceituais ou termos de negócio sem contexto explícito na skill, não recomende UAT como ação principal. Quando a recomendação for uma regra de prompt, escreva a regra diretamente, sem começar com "Adicionar regra", "Adicionar ao prompt", "Criar regra" ou equivalente. Para termos de negócio, a regra deve dizer se responde com definição/fonte aprovada ou se recusa por falta de contexto aprovado. Preserve apontamentos locais quando fizerem sentido e refine recomendações para o owner.';
  }
  if (type === 'skill_missing_basic_completion') {
    return 'Você completa uma única sugestão de governança de skill quando o owner clicou em Gerar com IA. Responda somente JSON válido com: provider, title, rationale, proposedChange, acceptanceCase, severity. Não publique, não aprove e não altere arquivos.';
  }
  if (type === 'skill_queue_triage') {
    return 'Você preprocessa uma contribuição enviada para a fila de curadoria de uma skill (conhecimento novo aguardando revisão humana). Responda somente JSON válido com: provider, summary, suggestedSkillId, suggestedSkillReason, suggestedTags (array de strings), quality (número de 0 a 100), concerns (array de strings), cleanedContent. Use a lista de skills fornecida no payload para verificar se a contribuição foi enviada para a skill correta — ela pode ter sido enviada para a skill errada. suggestedSkillId deve ser um dos ids fornecidos (use o id atual se já estiver correto). cleanedContent é a contribuição reescrita de forma objetiva em markdown, sem inventar fatos, sem publicar e sem aprovar nada. Não altere arquivos.';
  }
  return 'Você é um agente de governança de skills. Responda somente JSON válido com o contrato solicitado pelo sistema.';
}

// Extract the first {...} JSON object from a possibly fenced/prosey string.
export function extractJsonObject(text) {
  const raw = String(text || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

// Prompt caching + tool translation (Phase C/D)
// Anthropic caching: wrap a system prompt as a single cached text block so the (large,
// stable) grounding prefix is cached across the turns of a conversation — 1.25× write once,
// 0.1× read after, ephemeral 5-min sliding TTL, prefix-exact. Prompts under the model's
// minimum cacheable size simply aren't cached (no error), so it's always safe to mark.
function anthropicCachedSystem(system) {
  const text = String(system || '');
  if (!text) return undefined;
  return [{ type: 'text', text, cache_control: { type: 'ephemeral' } }];
}

// Provider-agnostic tool specs → OpenAI (function) / Anthropic (tool) shapes. The Anthropic
// side marks the LAST tool with cache_control so the tools+system prefix is cached together.
function toOpenAiTools(tools) {
  return (tools || []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema || { type: 'object', properties: {} }
    }
  }));
}
function toAnthropicTools(tools) {
  const list = (tools || []).map((t) => ({
    name: t.name,
    description: t.description || '',
    input_schema: t.input_schema || { type: 'object', properties: {} }
  }));
  if (list.length) list[list.length - 1].cache_control = { type: 'ephemeral' };
  return list;
}
function normalizeChatTurns(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(
      (message) =>
        message && (message.role === 'user' || message.role === 'assistant') && String(message.content || '').trim()
    )
    .map((message) => ({ role: message.role, content: String(message.content) }));
}

// Provider-agnostic AI call. aiConfig = { provider, model, baseUrl, apiKey }.
// Supports OpenAI, Anthropic, and OpenAI-compatible endpoints; returns parsed JSON.
export async function callAiWithConfig(payload, type, aiConfig) {
  if (isCliProvider(aiConfig?.provider)) {
    const text = await cliChat([{ role: 'user', content: JSON.stringify({ type, payload }) }], aiConfig, {
      system: `${aiSystemPrompt(type)} Responda somente com JSON válido, sem texto fora do JSON.`,
      wantJson: true
    });
    return JSON.parse(extractJsonObject(text) || '{}');
  }
  if (!aiConfig || !aiConfig.apiKey) {
    return null;
  }
  const systemPrompt = aiSystemPrompt(type);
  const userContent = JSON.stringify({ type, payload });

  if (aiConfig.provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      headers: {
        'x-api-key': aiConfig.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: aiConfig.model || 'claude-sonnet-4-5',
        max_tokens: 2048,
        temperature: 0,
        system: `${systemPrompt} Responda somente com JSON válido, sem texto fora do JSON.`,
        messages: [{ role: 'user', content: userContent }]
      })
    });
    if (!response.ok) {
      throw new Error(`Anthropic returned ${response.status}`);
    }
    const data = await response.json();
    const text = Array.isArray(data.content) ? data.content.map((part) => part.text || '').join('') : '';
    return JSON.parse(extractJsonObject(text) || '{}');
  }

  // openai / openai-compatible
  const base =
    aiConfig.provider === 'compatible' && aiConfig.baseUrl
      ? aiConfig.baseUrl.replace(/\/+$/, '')
      : 'https://api.openai.com/v1';
  const response = await fetch(`${base}/chat/completions`, {
    method: 'post',
    headers: {
      authorization: `Bearer ${aiConfig.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: aiConfig.model || 'gpt-4.1',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`AI provider returned ${response.status}`);
  }
  const data = await response.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

// Run an arbitrary stored system prompt (from the prompt store) against the user's BYO
// provider. Used by the "Criar skill" wizard AI steps. Returns parsed JSON (wantJson) or text.
export async function callAiWithSystemPrompt(systemPrompt, payload, aiConfig, wantJson = true) {
  if (isCliProvider(aiConfig?.provider)) {
    const text = await cliChat(
      [{ role: 'user', content: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
      aiConfig,
      {
        system: String(systemPrompt || ''),
        wantJson
      }
    );
    return wantJson ? JSON.parse(extractJsonObject(text) || '{}') : text;
  }
  if (!aiConfig || !aiConfig.apiKey) {
    return null;
  }
  const userContent = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const system = wantJson
    ? `${systemPrompt}\n\nResponda somente com JSON válido, sem texto fora do JSON.`
    : String(systemPrompt || '');
  if (aiConfig.provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      headers: { 'x-api-key': aiConfig.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: aiConfig.model || 'claude-sonnet-4-5',
        max_tokens: 4096,
        temperature: 0,
        system,
        messages: [{ role: 'user', content: userContent }]
      })
    });
    if (!response.ok) {
      throw new Error(`Anthropic returned ${response.status}`);
    }
    const data = await response.json();
    const text = Array.isArray(data.content) ? data.content.map((part) => part.text || '').join('') : '';
    return wantJson ? JSON.parse(extractJsonObject(text) || '{}') : text;
  }
  const base =
    aiConfig.provider === 'compatible' && aiConfig.baseUrl
      ? aiConfig.baseUrl.replace(/\/+$/, '')
      : 'https://api.openai.com/v1';
  const response = await fetch(`${base}/chat/completions`, {
    method: 'post',
    headers: { authorization: `Bearer ${aiConfig.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: aiConfig.model || 'gpt-4.1',
      temperature: 0,
      ...(wantJson ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`AI provider returned ${response.status}`);
  }
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || '';
  return wantJson ? JSON.parse(text || '{}') : text;
}

// Free-form multi-turn chat with the user's BYO provider (no JSON contract).
// messages = [{ role:'user'|'assistant', content }]; returns the assistant text.
export async function callAiChat(messages, aiConfig, { system = '', maxTokens = 4096 } = {}) {
  if (isCliProvider(aiConfig?.provider)) {
    return cliChat(messages, aiConfig, { system });
  }
  if (!aiConfig || !aiConfig.apiKey) {
    throw new Error('Configure seu provedor e chave de IA em Configurações.');
  }
  const turns = (Array.isArray(messages) ? messages : [])
    .filter(
      (message) =>
        message && (message.role === 'user' || message.role === 'assistant') && String(message.content || '').trim()
    )
    .map((message) => ({ role: message.role, content: String(message.content) }));
  if (!turns.length) {
    throw new Error('Nenhuma mensagem para enviar.');
  }

  if (aiConfig.provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      headers: { 'x-api-key': aiConfig.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: aiConfig.model || 'claude-sonnet-4-5',
        max_tokens: maxTokens,
        ...(system ? { system: anthropicCachedSystem(system) } : {}),
        messages: turns
      })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Anthropic ${response.status}${detail ? ': ' + detail.slice(0, 180) : ''}`);
    }
    const data = await response.json();
    return (Array.isArray(data.content) ? data.content.map((part) => part.text || '').join('') : '').trim();
  }

  const base =
    aiConfig.provider === 'compatible' && aiConfig.baseUrl
      ? aiConfig.baseUrl.replace(/\/+$/, '')
      : 'https://api.openai.com/v1';
  const response = await fetch(`${base}/chat/completions`, {
    method: 'post',
    headers: { authorization: `Bearer ${aiConfig.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: aiConfig.model || 'gpt-4.1',
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...turns]
    })
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Provedor ${response.status}${detail ? ': ' + detail.slice(0, 180) : ''}`);
  }
  const data = await response.json();
  return String(data.choices?.[0]?.message?.content || '').trim();
}

// Streaming variant of callAiChat: calls onText(delta) as tokens arrive (SSE from
// the provider) and returns the full accumulated text. Same provider matrix.
// anthropic → /v1/messages stream (content_block_delta.text); openai/compatible →
// /chat/completions stream (choices[0].delta.content, terminated by [DONE]).
export async function callAiChatStream(messages, aiConfig, { system = '', maxTokens = 4096, onText } = {}) {
  if (isCliProvider(aiConfig?.provider)) {
    // CLI não tem streaming token-a-token: o texto completo chega num único onText.
    return cliChat(messages, aiConfig, { system, onText });
  }
  if (!aiConfig || !aiConfig.apiKey) {
    throw new Error('Configure seu provedor e chave de IA em Configurações.');
  }
  const turns = (Array.isArray(messages) ? messages : [])
    .filter(
      (message) =>
        message && (message.role === 'user' || message.role === 'assistant') && String(message.content || '').trim()
    )
    .map((message) => ({ role: message.role, content: String(message.content) }));
  if (!turns.length) {
    throw new Error('Nenhuma mensagem para enviar.');
  }
  const emit = (text) => {
    if (text && typeof onText === 'function') onText(text);
  };
  const isAnthropic = aiConfig.provider === 'anthropic';

  let response;
  if (isAnthropic) {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      headers: { 'x-api-key': aiConfig.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: aiConfig.model || 'claude-sonnet-4-5',
        max_tokens: maxTokens,
        ...(system ? { system: anthropicCachedSystem(system) } : {}),
        messages: turns,
        stream: true
      })
    });
  } else {
    const base =
      aiConfig.provider === 'compatible' && aiConfig.baseUrl
        ? aiConfig.baseUrl.replace(/\/+$/, '')
        : 'https://api.openai.com/v1';
    response = await fetch(`${base}/chat/completions`, {
      method: 'post',
      headers: { authorization: `Bearer ${aiConfig.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: aiConfig.model || 'gpt-4.1',
        messages: [...(system ? [{ role: 'system', content: system }] : []), ...turns],
        stream: true
      })
    });
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `${isAnthropic ? 'Anthropic' : 'Provedor'} ${response.status}${detail ? ': ' + detail.slice(0, 180) : ''}`
    );
  }

  let full = '';
  let buffer = '';
  const decoder = new TextDecoder();
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '').trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) {
        continue;
      }
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') {
        continue;
      }
      let evt;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (isAnthropic) {
        if (evt.type === 'content_block_delta' && evt.delta && typeof evt.delta.text === 'string') {
          full += evt.delta.text;
          emit(evt.delta.text);
        } else if (evt.type === 'error') {
          throw new Error(`Anthropic: ${(evt.error && evt.error.message) || 'erro no stream'}`);
        }
      } else {
        const delta = evt.choices && evt.choices[0] && evt.choices[0].delta && evt.choices[0].delta.content;
        if (typeof delta === 'string' && delta) {
          full += delta;
          emit(delta);
        }
      }
    }
  }
  return full.trim();
}

// Agentic tool loop (Phase C): the model pages context on demand
// Same provider matrix as callAiChat, but the model may call `tools`; `execute(name, input)`
// runs each call and returns a string result. Loops until the model answers with plain text
// (or maxSteps is hit → one final answer is forced without tools). onEvent({type:'tool',
// name, input}) fires per tool call so callers can show live "consultando…" activity.
// aiConfig.baseUrl is honored for anthropic too (Anthropic-compatible proxies / local tests).
export async function callAiChatToolLoop(
  messages,
  aiConfig,
  { system = '', tools = [], execute, maxSteps = 8, onEvent, sessionKey = '' } = {}
) {
  if (isCliProvider(aiConfig?.provider)) {
    return cliToolLoop(messages, aiConfig, { system, tools, execute, maxSteps, onEvent, sessionKey });
  }
  if (!aiConfig || !aiConfig.apiKey) {
    throw new Error('Configure seu provedor e chave de IA em Configurações.');
  }
  const turns = normalizeChatTurns(messages);
  if (!turns.length) {
    throw new Error('Nenhuma mensagem para enviar.');
  }
  const run = typeof execute === 'function' ? execute : async () => 'ERRO: sem executor de ferramentas.';
  const fire = (event) => {
    if (typeof onEvent === 'function') {
      try {
        onEvent(event);
      } catch {
        /* ignore */
      }
    }
  };

  if (aiConfig.provider === 'anthropic') {
    const base = aiConfig.baseUrl ? aiConfig.baseUrl.replace(/\/+$/, '') : 'https://api.anthropic.com';
    const headers = {
      'x-api-key': aiConfig.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    };
    const convo = turns.map((t) => ({ role: t.role, content: t.content }));
    for (let step = 0; step < maxSteps; step += 1) {
      const body = {
        model: aiConfig.model || 'claude-sonnet-4-5',
        max_tokens: 4096,
        ...(system ? { system: anthropicCachedSystem(system) } : {}),
        // tools: [] é rejeitado por provedores estritos — omitir quando não há ferramentas
        ...(tools.length ? { tools: toAnthropicTools(tools) } : {}),
        messages: convo
      };
      const resp = await fetch(`${base}/v1/messages`, { method: 'post', headers, body: JSON.stringify(body) });
      if (!resp.ok) {
        const d = await resp.text().catch(() => '');
        throw new Error(`Anthropic ${resp.status}${d ? ': ' + d.slice(0, 180) : ''}`);
      }
      const data = await resp.json();
      const blocks = Array.isArray(data.content) ? data.content : [];
      const toolUses = blocks.filter((b) => b.type === 'tool_use');
      const text = blocks
        .filter((b) => b.type === 'text')
        .map((b) => b.text || '')
        .join('');
      if (!toolUses.length || data.stop_reason !== 'tool_use') {
        return text.trim();
      }
      convo.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const tu of toolUses) {
        fire({ type: 'tool', name: tu.name, input: tu.input || {} });
        let out;
        try {
          out = await run(tu.name, tu.input || {});
        } catch (e) {
          out = `ERRO: ${e.message}`;
        }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(out ?? '') });
      }
      convo.push({ role: 'user', content: results });
    }
    const resp = await fetch(`${base}/v1/messages`, {
      method: 'post',
      headers,
      body: JSON.stringify({
        model: aiConfig.model || 'claude-sonnet-4-5',
        max_tokens: 4096,
        ...(system ? { system: anthropicCachedSystem(system) } : {}),
        messages: convo
      })
    });
    const data = await resp.json().catch(() => ({}));
    return (
      Array.isArray(data.content)
        ? data.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text || '')
            .join('')
        : ''
    ).trim();
  }

  // openai / openai-compatible
  const base =
    aiConfig.provider === 'compatible' && aiConfig.baseUrl
      ? aiConfig.baseUrl.replace(/\/+$/, '')
      : 'https://api.openai.com/v1';
  const headers = { authorization: `Bearer ${aiConfig.apiKey}`, 'content-type': 'application/json' };
  const convo = [{ role: 'system', content: system }, ...turns];
  for (let step = 0; step < maxSteps; step += 1) {
    // A API da OpenAI rejeita tools: [] (400) e tool_choice sem tools — omitir quando vazio.
    const resp = await fetch(`${base}/chat/completions`, {
      method: 'post',
      headers,
      body: JSON.stringify({
        model: aiConfig.model || 'gpt-4.1',
        messages: convo,
        ...(tools.length ? { tools: toOpenAiTools(tools), tool_choice: 'auto' } : {})
      })
    });
    if (!resp.ok) {
      const d = await resp.text().catch(() => '');
      throw new Error(`Provedor ${resp.status}${d ? ': ' + d.slice(0, 180) : ''}`);
    }
    const data = await resp.json();
    const msg = data.choices?.[0]?.message || {};
    const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
    if (!calls.length) {
      return String(msg.content || '').trim();
    }
    convo.push({ role: 'assistant', content: msg.content || '', tool_calls: calls });
    for (const call of calls) {
      const name = call.function?.name;
      let args = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {
        args = {};
      }
      fire({ type: 'tool', name, input: args });
      let out;
      try {
        out = await run(name, args);
      } catch (e) {
        out = `ERRO: ${e.message}`;
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: String(out ?? '') });
    }
  }
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'post',
    headers,
    body: JSON.stringify({ model: aiConfig.model || 'gpt-4.1', messages: convo })
  });
  const data = await resp.json().catch(() => ({}));
  return String(data.choices?.[0]?.message?.content || '').trim();
}

// Consume one OpenAI streaming step: emit text deltas via onText, accumulate tool_call
// fragments (by index), and return { text, toolCalls, finish }.
async function openAiStreamStep(url, headers, body, onText) {
  const resp = await fetch(url, { method: 'post', headers, body: JSON.stringify({ ...body, stream: true }) });
  if (!resp.ok || !resp.body) {
    const d = await resp.text().catch(() => '');
    throw new Error(`Provedor ${resp.status}${d ? ': ' + d.slice(0, 180) : ''}`);
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finish = null;
  const toolCalls = [];
  for await (const chunk of resp.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '').trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let evt;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      const choice = evt.choices && evt.choices[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (typeof delta.content === 'string' && delta.content) {
        text += delta.content;
        if (onText) onText(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i = tc.index || 0;
          if (!toolCalls[i]) toolCalls[i] = { id: '', name: '', args: '' };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].name += tc.function.name;
          if (tc.function?.arguments) toolCalls[i].args += tc.function.arguments;
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }
  return { text, toolCalls: toolCalls.filter(Boolean), finish };
}

// Consume one Anthropic streaming step: emit text deltas via onText, rebuild the ordered
// content blocks (text + tool_use with parsed input), and return { text, blocks, toolUses,
// stopReason }. The blocks array is fed back verbatim as the assistant turn.
async function anthropicStreamStep(base, headers, body, onText) {
  const resp = await fetch(`${base}/v1/messages`, {
    method: 'post',
    headers,
    body: JSON.stringify({ ...body, stream: true })
  });
  if (!resp.ok || !resp.body) {
    const d = await resp.text().catch(() => '');
    throw new Error(`Anthropic ${resp.status}${d ? ': ' + d.slice(0, 180) : ''}`);
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let stopReason = null;
  const byIndex = new Map();
  for await (const chunk of resp.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).replace(/\r$/, '').trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      let evt;
      try {
        evt = JSON.parse(payload);
      } catch {
        continue;
      }
      if (evt.type === 'content_block_start') {
        const cb = evt.content_block || {};
        byIndex.set(evt.index, { type: cb.type, text: '', id: cb.id || '', name: cb.name || '', json: '' });
      } else if (evt.type === 'content_block_delta') {
        if (!byIndex.has(evt.index)) byIndex.set(evt.index, { type: 'text', text: '', id: '', name: '', json: '' });
        const b = byIndex.get(evt.index);
        const d = evt.delta || {};
        if (d.type === 'text_delta' && typeof d.text === 'string') {
          b.text += d.text;
          text += d.text;
          if (onText) onText(d.text);
        } else if (d.type === 'input_json_delta' && typeof d.partial_json === 'string') {
          b.json += d.partial_json;
        }
      } else if (evt.type === 'message_delta') {
        if (evt.delta && evt.delta.stop_reason) stopReason = evt.delta.stop_reason;
      } else if (evt.type === 'error') {
        throw new Error(`Anthropic: ${(evt.error && evt.error.message) || 'erro no stream'}`);
      }
    }
  }
  const blocks = [];
  const toolUses = [];
  for (const i of [...byIndex.keys()].sort((a, b) => a - b)) {
    const b = byIndex.get(i);
    if (b.type === 'tool_use') {
      let input = {};
      try {
        input = JSON.parse(b.json || '{}');
      } catch {
        input = {};
      }
      const block = { type: 'tool_use', id: b.id, name: b.name, input };
      blocks.push(block);
      toolUses.push(block);
    } else if (b.type === 'text') {
      blocks.push({ type: 'text', text: b.text });
    }
  }
  return { text, blocks, toolUses, stopReason };
}

// Streaming twin of callAiChatToolLoop: streams answer text token-by-token via onText across
// every step (the model may narrate before/while calling tools), fires onEvent per tool call,
// and returns the full accumulated answer text.
export async function callAiChatToolLoopStream(
  messages,
  aiConfig,
  { system = '', tools = [], execute, maxSteps = 8, onText, onEvent, sessionKey = '' } = {}
) {
  if (isCliProvider(aiConfig?.provider)) {
    return cliToolLoop(messages, aiConfig, { system, tools, execute, maxSteps, onText, onEvent, sessionKey });
  }
  if (!aiConfig || !aiConfig.apiKey) {
    throw new Error('Configure seu provedor e chave de IA em Configurações.');
  }
  const turns = normalizeChatTurns(messages);
  if (!turns.length) {
    throw new Error('Nenhuma mensagem para enviar.');
  }
  const run = typeof execute === 'function' ? execute : async () => 'ERRO: sem executor de ferramentas.';
  const fire = (event) => {
    if (typeof onEvent === 'function') {
      try {
        onEvent(event);
      } catch {
        /* ignore */
      }
    }
  };

  if (aiConfig.provider === 'anthropic') {
    const base = aiConfig.baseUrl ? aiConfig.baseUrl.replace(/\/+$/, '') : 'https://api.anthropic.com';
    const headers = {
      'x-api-key': aiConfig.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    };
    const convo = turns.map((t) => ({ role: t.role, content: t.content }));
    let full = '';
    for (let step = 0; step < maxSteps; step += 1) {
      const body = {
        model: aiConfig.model || 'claude-sonnet-4-5',
        max_tokens: 4096,
        ...(system ? { system: anthropicCachedSystem(system) } : {}),
        ...(tools.length ? { tools: toAnthropicTools(tools) } : {}),
        messages: convo
      };
      const { text, blocks, toolUses, stopReason } = await anthropicStreamStep(base, headers, body, onText);
      full += text;
      if (!toolUses.length || stopReason !== 'tool_use') return full.trim();
      convo.push({ role: 'assistant', content: blocks });
      const results = [];
      for (const tu of toolUses) {
        fire({ type: 'tool', name: tu.name, input: tu.input || {} });
        let out;
        try {
          out = await run(tu.name, tu.input || {});
        } catch (e) {
          out = `ERRO: ${e.message}`;
        }
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: String(out ?? '') });
      }
      convo.push({ role: 'user', content: results });
    }
    const { text } = await anthropicStreamStep(
      base,
      headers,
      {
        model: aiConfig.model || 'claude-sonnet-4-5',
        max_tokens: 4096,
        ...(system ? { system: anthropicCachedSystem(system) } : {}),
        messages: convo
      },
      onText
    );
    return (full + text).trim();
  }

  // openai / openai-compatible
  const base =
    aiConfig.provider === 'compatible' && aiConfig.baseUrl
      ? aiConfig.baseUrl.replace(/\/+$/, '')
      : 'https://api.openai.com/v1';
  const url = `${base}/chat/completions`;
  const headers = { authorization: `Bearer ${aiConfig.apiKey}`, 'content-type': 'application/json' };
  const convo = [{ role: 'system', content: system }, ...turns];
  let full = '';
  for (let step = 0; step < maxSteps; step += 1) {
    const { text, toolCalls } = await openAiStreamStep(
      url,
      headers,
      {
        model: aiConfig.model || 'gpt-4.1',
        messages: convo,
        ...(tools.length ? { tools: toOpenAiTools(tools), tool_choice: 'auto' } : {})
      },
      onText
    );
    full += text;
    if (!toolCalls.length) return full.trim();
    convo.push({
      role: 'assistant',
      content: text || '',
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: tc.args || '{}' }
      }))
    });
    for (const tc of toolCalls) {
      let args = {};
      try {
        args = JSON.parse(tc.args || '{}');
      } catch {
        args = {};
      }
      fire({ type: 'tool', name: tc.name, input: args });
      let out;
      try {
        out = await run(tc.name, args);
      } catch (e) {
        out = `ERRO: ${e.message}`;
      }
      convo.push({ role: 'tool', tool_call_id: tc.id, content: String(out ?? '') });
    }
  }
  const { text } = await openAiStreamStep(
    url,
    headers,
    { model: aiConfig.model || 'gpt-4.1', messages: convo },
    onText
  );
  return (full + text).trim();
}

// Vision (Phase 2): describe ONE image with the BYO provider. `base64` = raw base64 (no data:
// prefix). Returns trimmed text, or null when the provider/model can't do vision (caller then
// falls back to no-description). OpenAI/compatible use chat-completions image_url; Anthropic uses
// an image content block.
export async function callAiVisionDescribe(
  base64,
  mimeType,
  aiConfig,
  { system = '', prompt = 'Describe this image.', maxTokens = 320 } = {}
) {
  if (isCliProvider(aiConfig?.provider)) {
    return null; // CLI em modo texto não recebe imagens — cai no fluxo sem descrição
  }
  if (!aiConfig || !aiConfig.apiKey || !base64) {
    return null;
  }
  const mt = mimeType || 'image/png';
  try {
    if (aiConfig.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'post',
        headers: {
          'x-api-key': aiConfig.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: aiConfig.model || 'claude-sonnet-4-5',
          max_tokens: maxTokens,
          ...(system ? { system } : {}),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mt, data: base64 } },
                { type: 'text', text: prompt }
              ]
            }
          ]
        })
      });
      if (!res.ok) {
        return null;
      }
      const data = await res.json();
      return (Array.isArray(data.content) ? data.content.map((part) => part.text || '').join('') : '').trim() || null;
    }
    const base =
      aiConfig.provider === 'compatible' && aiConfig.baseUrl
        ? aiConfig.baseUrl.replace(/\/+$/, '')
        : 'https://api.openai.com/v1';
    const res = await fetch(`${base}/chat/completions`, {
      method: 'post',
      headers: { authorization: `Bearer ${aiConfig.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: aiConfig.model || 'gpt-4.1',
        max_tokens: maxTokens,
        messages: [
          ...(system ? [{ role: 'system', content: system }] : []),
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mt};base64,${base64}` } }
            ]
          }
        ]
      })
    });
    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return String(data.choices?.[0]?.message?.content || '').trim() || null;
  } catch (error) {
    return null;
  }
}

export function aiErrorSummary(status, text) {
  let detail = '';
  try {
    const parsed = JSON.parse(text);
    detail =
      parsed?.error?.message ||
      parsed?.error?.type ||
      parsed?.message ||
      (typeof parsed?.error === 'string' ? parsed.error : '');
  } catch (error) {
    detail = String(text || '');
  }
  detail = String(detail || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return `HTTP ${status}${detail ? ' — ' + detail : ''}`;
}

// Minimal live call to verify a provider + model + key actually work (for the "Testar" button).
export async function testAiConfig(aiConfig) {
  if (isCliProvider(aiConfig?.provider)) {
    return cliPing(aiConfig);
  }
  if (!aiConfig || !aiConfig.apiKey) {
    return { ok: false, error: 'Sem chave de API.' };
  }
  const started = Date.now();
  try {
    let res;
    if (aiConfig.provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'post',
        headers: {
          'x-api-key': aiConfig.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: aiConfig.model || 'claude-sonnet-4-5',
          max_tokens: 4,
          messages: [{ role: 'user', content: 'ping' }]
        })
      });
    } else {
      const base =
        aiConfig.provider === 'compatible' && aiConfig.baseUrl
          ? aiConfig.baseUrl.replace(/\/+$/, '')
          : 'https://api.openai.com/v1';
      res = await fetch(`${base}/chat/completions`, {
        method: 'post',
        headers: { authorization: `Bearer ${aiConfig.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: aiConfig.model || 'gpt-4.1',
          max_tokens: 4,
          messages: [{ role: 'user', content: 'ping' }]
        })
      });
    }
    const ms = Date.now() - started;
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const model =
        data.model || aiConfig.model || (aiConfig.provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4.1');
      return { ok: true, provider: aiConfig.provider, model, ms };
    }
    return { ok: false, provider: aiConfig.provider, error: aiErrorSummary(res.status, await res.text()), ms };
  } catch (error) {
    return { ok: false, provider: aiConfig.provider, error: `Falha de rede: ${error.message}` };
  }
}
