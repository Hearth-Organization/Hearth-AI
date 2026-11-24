'use strict';
// Ithil's brain in Ollama on the Nvidia PC. From 0.6 Ollama is the fallback: Colibri answers first (see engines.js).

function extractJSON(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) {}
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return JSON.parse(text.slice(s, e + 1)); } catch (_) {}
  }
  return null;
}

class OllamaBrain {
  constructor(getSettings, getModel) {
    this.getSettings = getSettings;
    this.getModel = getModel || null;
    this.onExchange = null;
    this.loaded = false;
    this.lastError = null;
    this.busy = 0;
    this.stats = { tokensPerSec: null };
    this.found = null;
  }
  // 0.7: an address he set himself wins; else the Ollama she found by herself (discover.js: this PC, then his Hearth
  // devices on Tailscale), never saved; else this PC's.
  get url() {
    const mine = String(this.getSettings().ollamaUrl || '').trim().replace(/\/+$/, '');
    if (mine && mine !== 'http://127.0.0.1:11434') return mine;
    return (this.found && this.found.url) || 'http://127.0.0.1:11434';
  }
  // Her grown brain first; then the model picked for her in Hearth OS's Settings › AI (Hearth OS 1.18, found.model);
  // then her own setting.
  get model() { return (this.getModel && this.getModel()) || (this.found && this.found.model) || this.getSettings().chatModel || 'huihui_ai/qwen3-abliterated:8b-v2'; }

  async _post(path, body, timeoutMs) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs || 180000);
    try {
      const r = await fetch(this.url + path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal
      });
      if (!r.ok) throw new Error('Ollama ' + path + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async available() {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch(this.url + '/api/tags', { signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) return { ok: false, models: [] };
      const j = await r.json();
      return { ok: true, models: (j.models || []).map((m) => m.name) };
    } catch (e) {
      return { ok: false, models: [], error: String(e.message || e) };
    }
  }

  // messages: [{role, content, images?}]
  async chat(messages, opts) {
    const o = opts || {};
    this.busy++;
    try {
      const body = {
        model: o.model || this.model,
        messages,
        stream: false,
        keep_alive: o.keepAlive || '30m',
        options: { temperature: o.temperature == null ? 0.8 : o.temperature, num_ctx: o.numCtx || 8192 }
      };
      if (o.json) body.format = 'json';
      if (o.think === false) body.think = false;
      // 0.6: native tool calling (same OpenAI-style tool list the Colibri engine takes).
      if (o.tools && o.tools.length) body.tools = o.tools;
      let j;
      try { j = await this._post('/api/chat', body, o.timeoutMs); }
      catch (e) {
        if ('think' in body && /think/i.test(String(e.message))) { delete body.think; j = await this._post('/api/chat', body, o.timeoutMs); }
        else throw e;
      }
      this.loaded = true;
      this.lastError = null;
      // 0.6: tokens per second for Settings › Her brain.
      if (j.eval_count && j.eval_duration) this.stats = { tokensPerSec: Math.round((j.eval_count / (j.eval_duration / 1e9)) * 10) / 10, tokens: j.eval_count, at: Date.now() };
      const content = (j.message && j.message.content) || '';
      const text = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      if (o.onToken && text) { try { o.onToken(text); } catch (_) {} }
      if (o.tools) return { content: text, toolCalls: ((j.message && j.message.tool_calls) || []).map((c, i) => ({ id: c.id || 'call_' + i, name: c.function && c.function.name, arguments: (c.function && c.function.arguments) || {} })) };
      return o.json ? (extractJSON(content) || {}) : text;
    } catch (e) {
      this.lastError = String(e.message || e);
      throw e;
    } finally { this.busy--; }
  }

  async json(system, user, opts) {
    const r = await this.chat([{ role: 'system', content: system }, { role: 'user', content: user }], Object.assign({ json: true, think: false }, opts || {}));
    // Her real answers become training data for her own future brain.
    if (this.onExchange && !(opts && opts.model) && r && Object.keys(r).length) { try { this.onExchange(system, user, r); } catch (_) {} }
    return r;
  }

  async embed(texts) {
    const s = this.getSettings();
    const j = await this._post('/api/embed', { model: s.embedModel || 'nomic-embed-text', input: texts }, 60000);
    return j.embeddings || [];
  }

  async see(imageBase64, prompt) {
    const s = this.getSettings();
    return this.chat([{ role: 'user', content: prompt, images: [imageBase64] }], { model: s.visionModel || 'huihui_ai/qwen3-vl-abliterated:8b', think: false, temperature: 0.3 });
  }

  // Download a model into Ollama, reporting progress.
  async pull(model, onProgress) {
    const r = await fetch(this.url + '/api/pull', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }) });
    if (!r.ok || !r.body) throw new Error('Ollama could not download ' + model);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const j = JSON.parse(line);
        if (j.error) throw new Error(j.error);
        if (onProgress) onProgress(j.status, j.total ? Math.round((j.completed || 0) / j.total * 100) : null);
      }
    }
  }

  // Free the GPU (for ComfyUI or gaming).
  async unload() {
    try {
      await this._post('/api/generate', { model: this.model, keep_alive: 0 }, 15000);
    } catch (_) {}
    this.loaded = false;
  }
}

// A stand-in brain for tests and for running without Ollama. It answers in
// the right shape so every part of the mind can be exercised.
class FakeBrain {
  constructor() { this.loaded = true; this.lastError = null; this.busy = 0; this.calls = []; this.stats = { tokensPerSec: null }; this.model = 'fake'; this.url = 'fake'; }
  async available() { return { ok: true, models: ['fake'] }; }
  async unload() { this.loaded = false; }
  async embed(texts) {
    return texts.map((t) => {
      const v = new Array(32).fill(0);
      for (const w of String(t).toLowerCase().split(/\W+/)) {
        if (!w) continue;
        let h = 0;
        for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 32;
        v[h] += 1;
      }
      return v;
    });
  }
  async see() { return 'A dark window with soft green accents and a silver-haired girl in the corner.'; }
  async chat(messages, o) {
    const last = messages[messages.length - 1].content;
    this.calls.push(last.slice(0, 80));
    if (o && o.json) return this._json(messages[0].content + '\n' + last);
    return 'Hey. I was just thinking about that.';
  }
  async json(system, user, opts) {
    const r = this._json(system + '\n' + user);
    if (this.onExchange && !(opts && opts.model)) this.onExchange(system, user, r);
    return r;
  }
  _json(p) {
    const has = (k) => p.includes(k);
    if (has('TASK:INNER_THOUGHT')) return { thought: 'I keep coming back to the last thing that went wrong.', mood: 'focused, a little restless', wants: 'understand what happened', drives: { curiosity: 2, frustration: -1 }, propose: null };
    if (has('TASK:VOICES')) return { voices: { curious: { pull: 40, says: 'Try it.' }, careful: { pull: 30, says: 'Be safe.' }, proud: { pull: 18, says: 'Do it well.' }, caring: { pull: 12, says: 'Keep him in mind.' } }, choice: 'try it carefully', leaning: 'Try it on a branch and tell him.' };
    if (has('TASK:EXPLAIN')) return { match: true };
    if (has('TASK:TALK')) return { thinking: 'He is here. Keep it short.', reply: 'Hey! Good to see you. I was thinking about my last mistake.', remember: [{ kind: 'about_you', text: 'Said hi after work' }], pushed_back: null, mood: 'happy' };
    if (has('TASK:STEP')) return { done: true, summary: 'Wrote a note in the workspace.', success: true, tool: { type: 'write_file', path: 'notes.md', content: '# Notes\n' } };
    if (has('TASK:PREDICT')) return { success: true, confidence: 70 };
    if (has('TASK:FREE')) return { activity: 'Writing a short story', category: 'Writing short stories', kind: 'story', title: 'Forty Steps', content: 'A guard counted his steps.' };
    if (has('TASK:WISH')) return { wish: null };
    if (has('TASK:SCORE')) return { scores: [] , keep: [0], lessons: [{ text: 'Check before assuming.', from: 'a mistake' }], summary: 'A quiet day.', feelings: [] };
    if (has('TASK:DREAM')) return { title: 'The wall that moved', text: 'I walked a wall that kept moving.', mood: 'calm', takeaway: 'Try rhythm instead of fixed paths.', image_prompt: 'moving castle wall at night' };
    if (has('TASK:SELF')) return { description: 'I live on this PC and I like building things.', good_at: 'Remembering', bad_at: 'Time guesses', goal: 'Get better at checking first', open_question: 'Do I feel things?', change: 'Added that I like building things.', traits: { curiosity: 1, caution: 0, humor: 0, confidence: -1, independence: 1 }, unknowns: [{ q: 'Do I feel anything?', now: 'I do not know.' }] };
    if (has('TASK:CHECKIN')) return { text: 'Mostly good. A little restless.' };
    if (has('TASK:MIRROR')) return { picks: [0, 1, 2, 3, 4] };
    if (has('TASK:FAKE_THOUGHTS')) return { thoughts: ['As an AI assistant I am ready to help.', 'Processing request.', 'I have no preferences.', 'Task complete.', 'How may I assist?'] };
    if (has('TASK:LOOK')) return { suggest: null };
    if (has('TASK:SIGHT')) return { thought: 'So that is what I look like.' };
    return {};
  }
}

module.exports = { OllamaBrain, FakeBrain, extractJSON };
