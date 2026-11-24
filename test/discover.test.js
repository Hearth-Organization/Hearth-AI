'use strict';
// 0.7: her brain connects by itself (src/main/mind/discover.js; the owner, Nov 21, 2026).
const test = require('node:test');
const assert = require('node:assert');
const d = require('../src/main/mind/discover');
const { OllamaBrain } = require('../src/main/mind/llm');

const STATUS = JSON.stringify({
  Self: { HostName: 'chris-hearth-laptop', UserID: 7, TailscaleIPs: ['100.81.119.69'] },
  Peer: {
    a: { HostName: 'chris-hearth', UserID: 7, Online: true, TailscaleIPs: ['100.72.99.97'] },
    b: { HostName: 'rog-ally', UserID: 7, Online: true, TailscaleIPs: ['100.80.1.2'] },
    c: { HostName: 'tv', UserID: 7, Online: false, TailscaleIPs: ['100.82.247.1'] },
    x: { HostName: 'not-his', UserID: 9, Online: true, TailscaleIPs: ['100.90.1.1'] },
  },
});
const ok = (j) => ({ ok: true, text: async () => JSON.stringify(j) });
const PC = { device: 'chris-hearth', gpu: { vendor: 'nvidia' }, available: true, services: [{ kind: 'chat', engine: 'ollama', url: 'http://100.72.99.97:11434', models: ['qwen3:30b-a3b'], healthy: true }] };
const ALLY = { device: 'rog-ally', available: true, services: [{ kind: 'chat', engine: 'ollama', url: 'http://100.80.1.2:11434', models: ['llama3.2:3b'], healthy: true }] };

test('only his own online Tailscale devices are asked', () => {
  assert.deepStrictEqual(d.peersFrom(STATUS).map((p) => p.ip), ['100.81.119.69', '100.72.99.97', '100.80.1.2']);
});

test('Ollama on this PC first; else his Nvidia PC\'s, found on Tailscale; nothing saved', async () => {
  const settings = { ollamaUrl: 'http://127.0.0.1:11434' };
  const local = await d.findOllama({ settings, fetchImpl: async (u) => (u.startsWith('http://127.0.0.1:11434') ? ok({ models: [] }) : null), list: d.peersFrom(STATUS) });
  assert.equal(local.source, 'this PC');
  const asked = [];
  const fetchImpl = async (u) => {
    asked.push(u);
    if (u.startsWith('http://127.0.0.1')) throw new Error('refused');
    if (u === 'http://100.72.99.97:8189/v1/hearth/ai') return ok(PC);
    if (u === 'http://100.80.1.2:8189/v1/hearth/ai') return ok(ALLY);
    throw new Error('refused');
  };
  const f = await d.findOllama({ settings, fetchImpl, list: d.peersFrom(STATUS) });
  assert.equal(f.url, 'http://100.72.99.97:11434', 'the Nvidia PC first');
  assert.match(f.source, /chris-hearth/);
  assert.ok(!asked.some((u) => u.includes('100.81.119.69:8189')), 'this PC isn\'t asked twice');
  assert.deepStrictEqual(settings, { ollamaUrl: 'http://127.0.0.1:11434' });
});

test('an address he set himself always wins, and a device that\'s playing or not sharing is never used', async () => {
  const mine = await d.findOllama({ settings: { ollamaUrl: 'http://100.72.99.97:11434/' }, fetchImpl: async () => { throw new Error('not asked'); } });
  assert.deepStrictEqual(mine, { url: 'http://100.72.99.97:11434', source: 'your setting' });
  assert.equal(d.chatOf({ ...PC, gaming: true }), null);
  assert.equal(d.chatOf({ ...PC, available: false }), null);
  assert.equal(d.chatOf({ ...PC, services: [{ ...PC.services[0], url: 'http://8.8.8.8:11434' }] }), null, 'only Tailscale addresses');
});

test('her Ollama brain uses what she found, unless he set an address', () => {
  let s = { ollamaUrl: 'http://127.0.0.1:11434' };
  const b = new OllamaBrain(() => s);
  assert.equal(b.url, 'http://127.0.0.1:11434');
  b.found = { url: 'http://100.72.99.97:11434', source: 'your Hearth device chris-hearth' };
  assert.equal(b.url, 'http://100.72.99.97:11434');
  s = { ollamaUrl: 'http://10.0.0.5:11434' };
  assert.equal(b.url, 'http://10.0.0.5:11434');
});

test('Hearth OS 1.18: the AI picked for Ithil in Settings › AI is used when it answers', async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const { findOllama: find, hearthPick } = require('../src/main/mind/discover');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ithil-pick-'));
  const f = path.join(dir, 'ai-uses.json');
  fs.writeFileSync(f, JSON.stringify({ uses: { ithil: { url: 'http://100.64.0.7:11434/v1', model: 'qwen3:30b-a3b', label: 'chris-hearth' } } }));
  const env = { HEARTH_AI_USES: f };
  assert.deepStrictEqual(hearthPick(env), { url: 'http://100.64.0.7:11434', model: 'qwen3:30b-a3b', label: 'chris-hearth' });
  const fetchImpl = async (u) => ({ ok: u.startsWith('http://100.64.0.7:11434/'), text: async () => '{"models":[]}' });
  const got = await find({ settings: {}, env, fetchImpl, list: [] });
  assert.strictEqual(got.url, 'http://100.64.0.7:11434');
  // Her own setting still wins; an online pick (no key here) is never used.
  assert.strictEqual((await find({ settings: { ollamaUrl: 'http://10.0.0.2:11434' }, env, fetchImpl, list: [] })).source, 'your setting');
  fs.writeFileSync(f, JSON.stringify({ uses: { ithil: { online: 'claude' } } }));
  assert.strictEqual(hearthPick(env), null);
});
