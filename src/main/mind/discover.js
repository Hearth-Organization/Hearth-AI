'use strict';
// 0.7: her brain connects by itself (the owner, Nov 21, 2026: "All these connections need to be automatic and from now
// on i shouldnt need to connect any manuel setting or adresses or keys", and "Needs to be added to ithel as well").
//
// Ollama on this PC first. When it doesn't answer, she looks on his own Tailscale devices (`tailscale status --json`:
// online, signed in to the same Tailscale account) for a Hearth device that shares its chat (Hearth OS's AI list,
// docs/AI-SHARE.md in hearth-os: GET http://<its Tailscale address>:8189/v1/hearth/ai, a chat service run by Ollama),
// the Nvidia PC first, never one that's playing or paused. What she finds is used while it answers and is never saved:
// an Ollama address he set himself (Settings › Her brain) always wins. Only Tailscale addresses are ever asked, with a
// timeout and a size cap, and redirects are refused. In step with the Hearth AI Command Center 3.14.
const { execFile } = require('child_process');

const DEFAULT_OLLAMA = 'http://127.0.0.1:11434';
const PORT = 8189;
const MAX_ANSWER = 256 * 1024;

const isTailscaleV4 = (ip) => { const p = String(ip || '').split('.').map(Number); return p.length === 4 && p.every((x) => Number.isInteger(x) && x >= 0 && x < 256) && p[0] === 100 && p[1] >= 64 && p[1] <= 127; };
const hostOf = (u) => { try { return new URL(u).hostname; } catch (_) { return ''; } };
const isTailscaleHost = (h) => isTailscaleV4(h) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/i.test(String(h || ''));

// This PC and his other online devices on the same Tailscale account: [{ name, ip, self }].
function peersFrom(text) {
  let j;
  try { j = JSON.parse(text); } catch (_) { return []; }
  if (!j || typeof j !== 'object' || !j.Self) return [];
  const me = j.Self.UserID;
  const out = [];
  const seen = new Set();
  const add = (p, self) => {
    if (!p || typeof p !== 'object') return;
    const ip = (Array.isArray(p.TailscaleIPs) ? p.TailscaleIPs : []).find(isTailscaleV4);
    if (!ip || seen.has(ip)) return;
    if (!self && (p.Online !== true || me === undefined || p.UserID !== me)) return;
    seen.add(ip);
    out.push({ name: String(p.HostName || ip).slice(0, 63), ip, self: Boolean(self) });
  };
  add(j.Self, true);
  for (const p of Object.values(j.Peer && typeof j.Peer === 'object' ? j.Peer : {})) { if (out.length >= 16) break; add(p, false); }
  return out;
}

function peers(execFileImpl) {
  return new Promise((resolve) => {
    try {
      (execFileImpl || execFile)('tailscale', ['status', '--json'], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? [] : peersFrom(String(out || ''))));
    } catch (_) { resolve([]); }
  });
}

async function getJson(url, fetchImpl, timeoutMs) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await (fetchImpl || fetch)(url, { signal: ctl.signal, redirect: 'manual', headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const text = await r.text();
    if (text.length > MAX_ANSWER) return null;
    return JSON.parse(text);
  } catch (_) { return null; } finally { clearTimeout(t); }
}

// The chat a Hearth device shares, if it can be used now: { url, models, device, nvidia } or null.
function chatOf(dev) {
  if (!dev || typeof dev !== 'object' || dev.available === false || dev.gaming === true) return null;
  const svc = (Array.isArray(dev.services) ? dev.services : []).find((s) => s && s.kind === 'chat' && s.engine === 'ollama' && s.healthy !== false && typeof s.url === 'string');
  if (!svc || !isTailscaleHost(hostOf(svc.url))) return null;
  return { url: svc.url.replace(/\/+$/, ''), models: Array.isArray(svc.models) ? svc.models.filter((m) => typeof m === 'string').slice(0, 200) : [], device: String(dev.device || '').slice(0, 63), nvidia: Boolean(dev.gpu && dev.gpu.vendor === 'nvidia') };
}

// Hearth OS 1.18: the AI picked for Ithil in Hearth OS's Settings › AI (~/.config/nimbus/ai-uses.json, uses.ithil:
// {url, model, label}; written by Hearth OS, only read here). An online pick is left out: she has no key of yours.
function hearthPick(env) {
  const e = env || process.env;
  const f = e.HEARTH_AI_USES || require('path').join(e.HOME || require('os').homedir(), '.config', 'nimbus', 'ai-uses.json');
  try {
    const j = JSON.parse(require('fs').readFileSync(f, 'utf8'));
    const u = j && j.uses && j.uses.ithil;
    if (!u || typeof u !== 'object' || typeof u.url !== 'string' || !/^https?:\/\//.test(u.url)) return null;
    return { url: u.url.replace(/\/+$/, '').replace(/\/v1$/, ''), model: typeof u.model === 'string' ? u.model : '', label: String(u.label || 'your pick') };
  } catch (_) { return null; }
}

// Where her Ollama is: { url, source, device? }. o: { settings, fetchImpl, execFileImpl, list, env }.
async function findOllama(o) {
  const s = (o && o.settings) || {};
  const mine = String(s.ollamaUrl || '').trim().replace(/\/+$/, '');
  if (mine && mine !== DEFAULT_OLLAMA) return { url: mine, source: 'your setting' };
  const pick = hearthPick(o && o.env);
  if (pick && await getJson(pick.url + '/api/tags', o && o.fetchImpl, 3000)) return { url: pick.url, source: 'Hearth OS Settings › AI (' + pick.label + ')', model: pick.model || undefined };
  if (await getJson(DEFAULT_OLLAMA + '/api/tags', o && o.fetchImpl, 2000)) return { url: DEFAULT_OLLAMA, source: 'this PC' };
  const ps = (o && o.list) || await peers(o && o.execFileImpl);
  const answers = await Promise.all(ps.filter((p) => !p.self).map((p) => getJson('http://' + p.ip + ':' + PORT + '/v1/hearth/ai', o && o.fetchImpl, 3000)));
  const found = answers.map(chatOf).filter(Boolean).sort((a, b) => Number(b.nvidia) - Number(a.nvidia));
  if (found.length) return { url: found[0].url, source: 'your Hearth device ' + found[0].device, device: found[0].device, models: found[0].models };
  return { url: DEFAULT_OLLAMA, source: ps.length ? 'this PC (no Hearth device shares its chat)' : 'this PC (Tailscale isn\'t running)' };
}

module.exports = { findOllama, hearthPick, peersFrom, chatOf, isTailscaleV4, DEFAULT_OLLAMA, PORT };
