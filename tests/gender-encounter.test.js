import test from 'node:test';
import assert from 'node:assert/strict';
import {
  IDENTITIES, TONES, buildEncounter, buildTownMap, ensureEquality, resolveEncounter,
  spawnTownNpcs, summarizeEquality, TOWN_H, TOWN_W
} from '../js/engine/gender_encounter_engine.js';

const mkState = (age = 15, runId = 'run-1') => ({
  meta: { runId },
  profile: { age, name: 'ทดสอบ', currentLocationId: 'loc_1' },
  stats: { health: 50, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 },
  statCounters: {},
  turn: { lifeFeedLog: [] }
});

test('map is deterministic and sized correctly', () => {
  const a = buildTownMap(mkState());
  const b = buildTownMap(mkState());
  assert.equal(a.tiles.length, TOWN_H);
  assert.equal(a.tiles[0].length, TOWN_W);
  assert.deepEqual(a.tiles, b.tiles);
});

test('every identity appears among town npcs', () => {
  const npcs = spawnTownNpcs(mkState());
  const ids = new Set(npcs.map((n) => n.identity));
  for (const i of IDENTITIES) assert.ok(ids.has(i.id), i.id);
});

test('resolving encounters changes index within bounds and prevents repeats', () => {
  const s = mkState(25);
  const npc = spawnTownNpcs(s).find((n) => buildEncounter(s, n));
  assert.ok(npc);
  const r = resolveEncounter(s, npc, 'defend');
  assert.equal(r.success, true);
  assert.equal(s.equality.townIndex, 50 + TONES.defend.delta);
  assert.equal(resolveEncounter(s, npc, 'respect').success, false);
  assert.equal(summarizeEquality(s).total, 1);
});

test('disrespect lowers index and index stays clamped', () => {
  const s = mkState(25);
  ensureEquality(s).townIndex = 2;
  const npc = spawnTownNpcs(s).find((n) => buildEncounter(s, n));
  resolveEncounter(s, npc, 'disrespect');
  assert.equal(s.equality.townIndex, 0);
});

test('each identity has encounters across life stages', async () => {
  const { getEncounterScenario } = await import('../js/engine/gender_encounter_engine.js');
  for (const i of IDENTITIES) {
    const ids = new Set();
    for (const age of [8, 16, 30, 45, 65]) {
      const s = mkState(age);
      for (let k = 0; k < 40; k++) {
        const sc = getEncounterScenario(s, { id: `t${k}`, identity: i.id });
        if (sc) ids.add(sc.id);
      }
    }
    assert.ok(ids.size >= 4, `${i.id} has ${ids.size}`);
  }
});

test('analysis finds weak identities/contexts and adapts focus', async () => {
  const { analyzeEqualityBehavior, getFocus, FOCUS_IDENTITY_IDS } = await import('../js/engine/gender_encounter_engine.js');
  const s = mkState(20);
  const eq = ensureEquality(s);
  eq.history = [
    { scenarioId: 'enc_work_pay', context: 'work', identity: 'woman', tone: 'respect' },
    { scenarioId: 'enc_public_restroom', context: 'public', identity: 'trans_woman', tone: 'disrespect' },
    { scenarioId: 'enc_public_restroom', context: 'public', identity: 'trans_man', tone: 'ignore' },
    { scenarioId: 'enc_work_pay', context: 'work', identity: 'woman', tone: 'defend' }
  ];
  const a = analyzeEqualityBehavior(s);
  assert.deepEqual(a.weakContexts, ['public']);
  assert.ok(a.weakIdentities.includes('trans_woman'));
  assert.ok(a.strongIdentities.includes('woman'));
  eq.localAnalysis = a;
  assert.deepEqual(getFocus(eq).contexts, ['public']);
  assert.ok(a.focus.identities.every((i) => FOCUS_IDENTITY_IDS.includes(i)));
});

test('AI coaching is used when valid and falls back to local when not', async () => {
  const { runEqualityCoaching } = await import('../js/engine/equality_ai_client.js');
  const s = mkState(20);
  ensureEquality(s).history = ['respect', 'ignore', 'disrespect', 'defend'].map((tone, i) => ({ scenarioId: 'enc_work_pay', context: 'work', identity: 'woman', tone }));
  const good = async () => ({ ok: true, json: async () => ({ aiGenerated: true, coach: { coachingTh: 'คุณทำได้ดี ลองฝึกเรื่องที่ทำงานเพิ่ม', focusIdentities: ['nonbinary'], focusContexts: ['work'], nextScenarioIdeaTh: 'หัวหน้าเรียกชื่อผิด' } }) });
  assert.equal((await runEqualityCoaching(s, { fetchImpl: good })).source, 'ai');
  assert.deepEqual(s.equality.aiCoach.focus.identities, ['nonbinary']);
  const bad = async () => ({ ok: true, json: async () => ({ aiGenerated: true, coach: { coachingTh: 'x', focusIdentities: ['hack'], focusContexts: [] } }) });
  const s2 = mkState(20); ensureEquality(s2).history = ensureEquality(s).history;
  assert.equal((await runEqualityCoaching(s2, { fetchImpl: bad })).source, 'local');
  assert.equal((await runEqualityCoaching(mkState(20), { fetchImpl: good })).source, 'local');
});

test('every scenario has a comedy rewrite and uses it in the encounter', async () => {
  const { COMEDY } = await import('../js/engine/gender_encounter_comedy.js');
  const src = (await import('node:fs')).readFileSync(new URL('../js/engine/gender_encounter_engine.js', import.meta.url), 'utf8');
  const ids = [...src.matchAll(/^  \{ id: '(enc_[a-z0-9_]+)'/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 68);
  for (const id of ids) assert.ok(COMEDY[id], `missing comedy for ${id}`);
  const s = mkState(25);
  const npc = spawnTownNpcs(s).find((n) => buildEncounter(s, n));
  const enc = buildEncounter(s, npc);
  assert.equal(enc.title, COMEDY[enc.scenarioId][0]);
});

test('worldbox-style map has varied terrain, landmarks and a walkable start', async () => {
  const { walkable, TILE } = await import('../js/engine/gender_encounter_engine.js');
  const map = buildTownMap(mkState(16));
  const counts = {};
  for (const row of map.tiles) for (const t of row) counts[t] = (counts[t] || 0) + 1;
  for (const k of [TILE.GRASS, TILE.HOUSE, TILE.ROAD, TILE.SCHOOL, TILE.WORK, TILE.MARKET, TILE.TREE]) assert.ok(counts[k] > 0, `tile ${k}`);
  assert.ok((counts[TILE.WATER] || 0) + (counts[TILE.DEEP] || 0) > 20, 'water');
  assert.ok(walkable(map, map.homeX, map.homeY));
  const low = mkState(16); ensureEquality(low).townIndex = 10;
  const high = mkState(16); ensureEquality(high).townIndex = 90;
  const c = (m, k) => m.tiles.flat().filter((t) => t === k).length;
  assert.ok(c(buildTownMap(low), TILE.DRY) > 0);
  assert.ok(c(buildTownMap(high), TILE.PINK) > 0);
});

test('friendship bond adds a friend; kids spawn without orientation labels; classmates are diverse', async () => {
  const { addFriendFromEncounter, createClassmates, KID_IDENTITY_IDS, FRIEND_BOND_THRESHOLD } = await import('../js/engine/gender_encounter_engine.js');
  const kid = mkState(10);
  for (const n of spawnTownNpcs(kid)) assert.ok(KID_IDENTITY_IDS.includes(n.identity), n.identity);
  createClassmates(kid);
  const ids = new Set(kid.relationships.npcs.map((n) => n.genderIdentity));
  assert.ok(ids.size >= 4);
  const s = mkState(25); s.relationships = { npcs: [] };
  const npc = spawnTownNpcs(s).find((n) => buildEncounter(s, n));
  ensureEquality(s).relations[npc.id] = FRIEND_BOND_THRESHOLD;
  assert.ok(addFriendFromEncounter(s, npc));
  assert.equal(addFriendFromEncounter(s, npc), null);
});

test('start stages cover primary, lower and upper secondary with age-appropriate classmates', async () => {
  const { START_STAGES } = await import('../js/core/state.js');
  assert.deepEqual(START_STAGES.map((x) => x.age), [10, 13, 16, 0]);
  const { createClassmates } = await import('../js/engine/gender_encounter_engine.js');
  const kid = mkState(10); kid.relationships = { npcs: [] }; createClassmates(kid);
  assert.ok(!kid.relationships.npcs.some((n) => ['gay_man', 'lesbian', 'bisexual'].includes(n.genderIdentity)));
  const teen = mkState(16); teen.relationships = { npcs: [] }; createClassmates(teen);
  assert.ok(new Set(teen.relationships.npcs.map((n) => n.genderIdentity)).size >= 5);
});

test('English gender labels are spaced and phrased naturally in Thai sentences', async () => {
  const { fillWho } = await import('../js/engine/gender_encounter_engine.js');
  assert.equal(fillWho('เพื่อน ({who}) ถูกล้อ', 'Lesbian'), 'เพื่อน (Lesbian) ถูกล้อ');
  assert.equal(fillWho('{who} ถูกล้อ', 'Trans man'), 'เพื่อนคนนี้ (Trans man) ถูกล้อ');
  const src = (await import('node:fs')).readdirSync(new URL('../js/engine/', import.meta.url)).filter((f) => f.endsWith('.js'));
  for (const f of src) {
    const text = (await import('node:fs')).readFileSync(new URL(`../js/engine/${f}`, import.meta.url), 'utf8');
    assert.ok(!/[฀-๿](Trans woman|Trans man|Genderfluid|Non-binary|Lesbian|Bisexual)|(Trans woman|Trans man|Genderfluid|Non-binary|Lesbian|Bisexual)[฀-๿]/.test(text), `unspaced English label in ${f}`);
  }
});
