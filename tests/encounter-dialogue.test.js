import test from 'node:test';
import assert from 'node:assert/strict';
import { FOLLOW_UP_ROUNDS, applyFollowUp, buildFollowUp, closingLine, pickFresh } from '../js/engine/encounter_dialogue_engine.js';
import { REACTIONS, QUESTIONS } from '../js/engine/dialogue_pools.js';
import { generateLocalScenario, requestAiDialogue, requestAiScenario, validateDialogueClient, validateScenarioClient } from '../js/engine/ai_content_client.js';
import { ensureEquality, getEncounterScenario, buildEncounter } from '../js/engine/gender_encounter_engine.js';
import { generateDialogue, generateScenario, validateDialogue, validateScenario, callStructured } from '../server/ai_content.js';

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const mk = (age = 20) => ({
  meta: { runId: 'd1' }, profile: { age, gender: 'male' }, stats: { health: 50, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 },
  statCounters: {}, relationships: { npcs: [] }, turn: { lifeFeedLog: [] }
});

test('dialogue lines never repeat until a pool is exhausted', () => {
  const s = mk();
  const seen = new Set();
  for (let i = 0; i < QUESTIONS.work.length; i++) {
    const t = pickFresh(s, QUESTIONS.work, `k${i}`, (x) => x.q);
    assert.ok(!seen.has(t.q), 'repeated before exhausted');
    seen.add(t.q);
  }
  assert.equal(seen.size, QUESTIONS.work.length);
  assert.ok(QUESTIONS.work.includes(pickFresh(s, QUESTIONS.work, 'again', (x) => x.q)), 'recycles after exhaustion');
});

test('a full dialogue has 2 follow-ups with fresh lines, 3 options each, and a closing', () => {
  const s = mk();
  const used = new Set();
  let prev = 'respect';
  for (let r = 1; r <= FOLLOW_UP_ROUNDS; r++) {
    const t = buildFollowUp(s, { context: 'school', prevTone: prev, seedKey: 'npc1|20', round: r });
    assert.equal(t.options.length, 3);
    assert.deepEqual(t.options.map((o) => o.id).sort(), ['bad', 'good', 'mid']);
    for (const line of [t.reaction, t.question, ...t.options.map((o) => o.label)]) { assert.ok(!used.has(line)); used.add(line); }
    prev = applyFollowUp(s, { relKey: 'npc1', identity: 'woman' }, 'good').tone;
  }
  assert.ok(s.equality.relations.npc1 >= 8);
  assert.equal(closingLine(s, ['good', 'good', 'good'], 'x').bucket, 'good');
  assert.equal(closingLine(s, ['bad', 'bad', 'mid'], 'y').bucket, 'bad');
  assert.ok(Object.values(REACTIONS).every((a) => a.length >= 8));
  for (const list of Object.values(QUESTIONS)) assert.ok(list.length >= 8 && list.every((x) => x.q && x.good && x.mid && x.bad));
});

test('rude follow-ups lower closeness and index; friend appears when bond is reached', () => {
  const s = mk();
  applyFollowUp(s, { relKey: 'n', identity: 'woman' }, 'bad');
  assert.equal(s.equality.townIndex, 48);
  assert.ok(s.equality.relations.n < 0);
  const s2 = mk();
  for (let i = 0; i < 3; i++) applyFollowUp(s2, { relKey: 'n2', identity: 'man', name: 'บอส' }, 'good');
  assert.equal(s2.relationships.npcs[0].name, 'บอส');
});

test('local scenario generator is valid, deterministic and feeds the encounter pool', () => {
  const s = mk(15);
  const a = generateLocalScenario(s), b = generateLocalScenario(s);
  assert.deepEqual(a, b);
  assert.ok(validateScenarioClient(a));
  ensureEquality(s).aiScenarios = [{ ...a, identities: ['nonbinary'], context: 'public', minAge: 6, maxAge: 90 }];
  let found = false;
  for (let k = 0; k < 40 && !found; k++) { const sc = getEncounterScenario(s, { id: `t${k}`, identity: 'nonbinary' }); if (sc.aiGenerated) found = true; }
  assert.ok(found, 'ai scenario can be picked');
});

test('client uses AI data when valid; falls back to local scenario otherwise', async () => {
  const good = { title: 'ที่ตลาดนัด: คุณลุงปากไว', text: 'ที่ตลาดนัด เพื่อน ({who}) ถูกลุงขายผักบอกว่าไม่เหมาะซื้อผักแบบนี้ ผักเองยังงงว่าทำไมต้องมีเพศ', lesson: 'ทุกคนซื้อของได้เหมือนกัน การเหมารวมไม่ช่วยให้ใครขายได้ดี', context: 'public', identities: ['nonbinary'], minAge: 10, maxAge: 40 };
  const f = async () => ({ ok: true, json: async () => ({ aiGenerated: true, data: good }) });
  const s = mk(20);
  const r = await requestAiScenario(s, { fetchImpl: f });
  assert.equal(r.source, 'ai');
  assert.equal(s.equality.aiScenarios[0].title, good.title);
  const bad = async () => ({ ok: true, json: async () => ({ aiGenerated: true, data: { ...good, text: 'ไม่มีตัวแทน who เลย แต่ยาวพอสมควรเพื่อทดสอบ' } }) });
  assert.equal((await requestAiScenario(mk(20), { fetchImpl: bad })).source, 'local');
  assert.equal((await requestAiScenario(mk(20), { fetchImpl: null })).source, 'local');
});

test('AI dialogue lines are merged into the pools and used in later turns', async () => {
  const d = { reactions: { defend: ['อีกฝ่ายตบมือรัวจนฝุ่นปลิว'], respect: ['อีกฝ่ายยิ้มจนตาหยี'], ignore: ['อีกฝ่ายถอนหายใจเบาๆ'], disrespect: ['อีกฝ่ายมองด้วยสายตาผิดหวัง'] }, questions: [{ q: 'ถ้าได้เลือกอาหารเย็นวันนี้ จะกินอะไรดี', good: 'กินข้าวผัดกะเพราไข่ดาว แล้วคุณล่ะ', mid: 'อะไรก็ได้', bad: 'ไม่อยากตอบ' }, { q: 'คุณชอบดูดาวไหม', good: 'ชอบเลย ไปดูด้วยกันไหม', mid: 'เฉยๆ', bad: 'น่าเบื่อจะตาย' }], closings: { good: ['อีกฝ่ายโบกมือลาอย่างอารมณ์ดี'], mid: ['อีกฝ่ายพยักหน้าลา'], bad: ['อีกฝ่ายเดินจากไปเงียบๆ'] } };
  assert.ok(validateDialogueClient(d));
  const s = mk(20);
  const r = await requestAiDialogue(s, { fetchImpl: async () => ({ ok: true, json: async () => ({ aiGenerated: true, data: d }) }) });
  assert.equal(r.source, 'ai');
  assert.ok(s.equality.aiLines.reactions.defend.includes('อีกฝ่ายตบมือรัวจนฝุ่นปลิว'));
  const ctx = r.context;
  assert.ok(s.equality.aiLines.questions[ctx].some((x) => x.q === 'คุณชอบดูดาวไหม' && x.good));
  assert.equal((await requestAiDialogue(mk(20), { fetchImpl: async () => ({ ok: false }) })).source, 'none');
});

test('server validates AI scenarios/dialogues and uses Pathumma form requests', async () => {
  const sc = { title: 'ที่ป้ายรถเมล์: ลุงนักตัดสิน', text: 'ที่ป้ายรถเมล์ เพื่อน ({who}) ถูกลุงบอกว่าไม่ควรนั่งเก้าอี้ตัวนี้ ทั้งที่เก้าอี้ไม่ได้เลือกเพศคนนั่ง', lesson: 'ที่นั่งสาธารณะเป็นของทุกคน การเหมารวมไม่ช่วยให้ใครสบายขึ้น', context: 'public', identities: ['trans_man'], minAge: 12, maxAge: 60 };
  assert.ok(validateScenario(sc));
  assert.throws(() => validateScenario({ ...sc, text: 'ข้อความนี้ยาวพอและมีคำว่าผิดปกติ แต่มีตัวแทน ({who}) อยู่ด้วยเช่นกัน' }));
  assert.throws(() => validateScenario({ ...sc, identities: ['x'] }));
  const scenarioFetch = async () => ({ ok: true, json: async () => ({ content: JSON.stringify(sc) }) });
  assert.deepEqual(await generateScenario({ age: 20, context: 'public', focusIdentities: [], weakContexts: [], recentTones: [] }, { fetchImpl: scenarioFetch, env: { PATHUMMA_API_KEY: 'k' } }), sc);
  const dlg = { reactions: { defend: ['อีกฝ่ายยิ้มกว้างมาก'], respect: ['อีกฝ่ายพยักหน้ารับ'], ignore: ['อีกฝ่ายถอนหายใจเบาๆ'], disrespect: ['อีกฝ่ายส่ายหน้าช้าๆ'] }, questions: [{ q: 'วันนี้คุณทำอะไรสนุกบ้าง', good: 'ไปเล่นบาสกับเพื่อนมา สนุกมาก', mid: 'ก็ธรรมดานะ', bad: 'ไม่อยากเล่า' }, { q: 'ชอบกินอะไรเป็นพิเศษไหม', good: 'ชอบกล้วยทอด แล้วคุณล่ะ', mid: 'กินได้ทุกอย่าง', bad: 'ไม่บอกหรอก' }], closings: { good: ['อีกฝ่ายโบกมือลาอย่างมีความสุข'], mid: ['อีกฝ่ายพยักหน้าลา'], bad: ['อีกฝ่ายเดินจากไปเงียบๆ'] } };
  assert.ok(validateDialogue(dlg));
  const env = { PATHUMMA_API_URL: 'https://x.test/c', PATHUMMA_API_KEY: 'k' };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: '<think>x</think>' + JSON.stringify(dlg) }) });
  assert.deepEqual(await callStructured({ schema: null, name: 'n', system: 's', user: 'u' }, { fetchImpl, env: { ...env, AI_PROVIDER: 'pathumma' } }), dlg);
  await assert.rejects(() => generateDialogue({ age: 20, context: 'public' }, { env: {} }));
});

import { questionTier } from '../js/engine/encounter_dialogue_engine.js';
import { GUARDED_QUESTIONS, WARM_QUESTIONS, CALLBACKS } from '../js/engine/dialogue_pools.js';

test('next turn adapts to the previous answer: references it, warms up after good, guards after bad', () => {
  const tiers = (tone) => { const c = { warm: 0, guarded: 0, context: 0 }; for (let i = 0; i < 200; i++) c[questionTier(tone, `k${i}`, 1)]++; return c; };
  const good = tiers('respect'), bad = tiers('disrespect'), mid = tiers('ignore');
  assert.ok(good.warm > good.context && good.guarded === 0);
  assert.ok(bad.guarded > bad.context && bad.warm === 0);
  assert.equal(mid.context, 200);
  const s = mk();
  const t = buildFollowUp(s, { context: 'public', prevTone: 'disrespect', prevLine: 'ไม่ว่างฟังหรอก', seedKey: 'a|1', round: 1 });
  assert.ok(t.callback.includes('ไม่ว่างฟังหรอก'));
  let guardedSeen = false;
  for (let i = 0; i < 12 && !guardedSeen; i++) { const x = buildFollowUp(mk(), { context: 'public', prevTone: 'disrespect', prevLine: 'x', seedKey: `z${i}`, round: 1 }); if (x.tier === 'guarded') { guardedSeen = GUARDED_QUESTIONS.some((g) => g.q === x.question); } }
  assert.ok(guardedSeen);
  const w = buildFollowUp(mk(), { context: 'work', prevTone: 'defend', prevLine: 'เดี๋ยวก่อน', seedKey: 'warm-seed-3', round: 1 });
  assert.ok(['warm', 'context'].includes(w.tier));
  assert.ok(WARM_QUESTIONS.length >= 6 && CALLBACKS.good.length >= 4 && CALLBACKS.bad.length >= 3);
});
