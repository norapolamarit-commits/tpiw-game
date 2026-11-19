import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyGameState, getState, mergeGameStateWithTemplate, setState } from '../js/core/state.js';
import { chooseRarity, isRandomEventEligible, nextSeededRandom, recordRandomEvent, selectRandomEvents } from '../js/engine/random_event_engine.js';
import { RANDOM_EVENT_TEMPLATES } from '../js/engine/random_event_templates.js';
import { ADDITIONAL_RANDOM_TEMPLATES } from '../js/engine/additional_random_templates.js';
import { createAiContext, maybeEnhanceRandomEventWithAi } from '../js/engine/ai_event_client.js';

test('seeded event draws reproduce after save and reload', () => {
  const state = createEmptyGameState();
  state.meta.runId = 'repeatable-run';
  const first = Array.from({ length: 5 }, () => nextSeededRandom(state));
  const second = mergeGameStateWithTemplate(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(Array.from({ length: 5 }, () => nextSeededRandom(state)), Array.from({ length: 5 }, () => nextSeededRandom(second)));
  assert.equal(first.length, 5);
});

test('rarity weights are sampled independently', () => {
  const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  let seed = 17;
  for (let i = 0; i < 10000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    counts[chooseRarity(() => seed / 0x100000000)]++;
  }
  assert.ok(Math.abs(counts.common / 10000 - 0.55) < 0.02);
  assert.ok(Math.abs(counts.legendary / 10000 - 0.05) < 0.01);
});

test('age, conditional requirements, cooldown, and duplicate selection apply', () => {
  const state = createEmptyGameState();
  state.profile.age = 10;
  const school = RANDOM_EVENT_TEMPLATES.find((event) => event.id === 'random_education_exam');
  assert.equal(isRandomEventEligible(school, state), false);
  state.profile.age = 15;
  assert.equal(isRandomEventEligible(school, state), true);
  recordRandomEvent(state, school, 'c1');
  assert.equal(isRandomEventEligible(school, state), false);
  state.profile.age = 18;
  assert.equal(isRandomEventEligible(school, state), true);
  assert.equal(isRandomEventEligible(school, state, new Set([school.id])), false);
  const career = RANDOM_EVENT_TEMPLATES.find((event) => event.id === 'random_career_offer');
  assert.equal(isRandomEventEligible(career, state), false);
  state.careerAndEdu.mainJobId = 'job_example';
  assert.equal(isRandomEventEligible(career, state), true);
});

test('trigger chance gates draws before rarity and selection', () => {
  const state = createEmptyGameState();
  state.profile.age = 20;
  state.meta.runId = 'trigger-test';
  assert.deepEqual(selectRandomEvents(state, RANDOM_EVENT_TEMPLATES, new Set(), { eventTriggerChance: 0, maxEventsPerTurn: 2, rarityWeights: { common: 55, uncommon: 25, rare: 15, legendary: 5 } }), []);
  const selected = selectRandomEvents(state, RANDOM_EVENT_TEMPLATES, new Set(), { eventTriggerChance: 1, maxEventsPerTurn: 2, rarityWeights: { common: 55, uncommon: 25, rare: 15, legendary: 5 } });
  assert.ok(selected.length >= 1 && selected.length <= 2);
  assert.equal(new Set(selected.map((event) => event.id)).size, selected.length);
});

test('random events prefer unseen stories and repeat only after the eligible pool is exhausted', () => {
  const state = createEmptyGameState();
  state.profile.age = 30;
  const templates = ['old', 'new'].map((id) => ({ id, category: 'daily_life', rarity: 'common', minAge: 5, maxAge: 100, cooldownTurns: 2, probabilityWeight: 1 }));
  const config = { eventTriggerChance: 1, maxEventsPerTurn: 1, extraEventChance: 0, rarityWeights: { common: 1 } };
  state.turn.randomEventHistory.push({ id: 'old', age: 20, category: 'daily_life' });
  assert.equal(selectRandomEvents(state, templates, new Set(), config)[0].id, 'new');
  state.turn.randomEventHistory.push({ id: 'new', age: 21, category: 'daily_life' });
  assert.ok(['old', 'new'].includes(selectRandomEvents(state, templates, new Set(), config)[0].id));
});

test('trigger and rarity frequencies follow separate configured weights', () => {
  const rarities = ['common', 'uncommon', 'rare', 'legendary'];
  const templates = rarities.map((rarity) => ({ id: rarity, category: rarity, rarity, minAge: 0, maxAge: 100, triggerConditions: [], probabilityWeight: 1 }));
  const config = { eventTriggerChance: 0.65, maxEventsPerTurn: 1, extraEventChance: 0, rarityWeights: { common: 55, uncommon: 25, rare: 15, legendary: 5 } };
  const counts = Object.fromEntries(rarities.map((rarity) => [rarity, 0]));
  let triggered = 0;
  for (let seed = 0; seed < 10000; seed++) {
    const state = createEmptyGameState();
    state.turn.randomEventSeed = seed;
    const [event] = selectRandomEvents(state, templates, new Set(), config);
    if (event) { triggered++; counts[event.rarity]++; }
  }
  assert.ok(Math.abs(triggered / 10000 - 0.65) < 0.02);
  for (const [rarity, weight] of Object.entries(config.rarityWeights)) {
    assert.ok(Math.abs(counts[rarity] / triggered - weight / 100) < 0.02, rarity);
  }
});

test('AI generation replaces only an untouched future card and keeps its rarity', async () => {
  const state = createEmptyGameState();
  state.profile.age = 20;
  state.turn.randomEventSeed = 0;
  state.turn.currentEventIndex = 0;
  state.turn.pendingEvents = [
    { event_id: 'existing', source_type: 'pool_event' },
    { event_id: 'fallback', source_type: 'random_event', rarity: 'rare', monthNum: 6, monthTh: 'มิถุนายน' }
  ];
  const originalStorage = globalThis.localStorage;
  const previousState = getState();
  globalThis.localStorage = { setItem() {} };
  setState(state);
  try {
    const card = {
      event_id: 'ai_test', source_type: 'random_event', aiGenerated: true,
      title_th: 'เพื่อนเก่ากลับมา', description_th: 'เพื่อนที่คุณเคยช่วยติดต่อกลับมา',
      choices: [
        { choice_id: 'c1', label_th: 'ตอบกลับ', stat_effects: { connections: 2 } },
        { choice_id: 'c2', label_th: 'ขอเวลาคิด', stat_effects: { happiness: 1 } }
      ]
    };
    assert.equal(maybeEnhanceRandomEventWithAi(state, (value) => value, { fetchImpl: async () => ({ ok: true, json: async () => ({ event: card, aiGenerated: true }) }) }), true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.turn.pendingEvents[1].event_id, 'ai_test');
    assert.equal(state.turn.pendingEvents[1].rarity, 'rare');
    assert.equal(state.turn.pendingEvents[1].monthTh, 'มิถุนายน');
  } finally {
    setState(previousState);
    globalThis.localStorage = originalStorage;
  }
});

test('a late AI response cannot overwrite a newer life', async () => {
  const previousState = getState();
  const originalStorage = globalThis.localStorage;
  let writes = 0;
  globalThis.localStorage = { setItem() { writes++; } };
  const oldLife = createEmptyGameState();
  oldLife.profile.age = 20;
  oldLife.turn.randomEventSeed = 0;
  oldLife.turn.pendingEvents = [
    { event_id: 'normal', source_type: 'pool_event' },
    { event_id: 'handcrafted', source_type: 'random_event', rarity: 'rare' }
  ];
  let resolveRequest;
  const pending = new Promise((resolve) => { resolveRequest = resolve; });
  const card = {
    event_id: 'ai_late', source_type: 'random_event', aiGenerated: true,
    title_th: 'จดหมายจากเพื่อน', description_th: 'เพื่อนเก่าติดต่อกลับมา',
    choices: [
      { choice_id: 'c1', label_th: 'ตอบกลับ', stat_effects: { connections: 2 } },
      { choice_id: 'c2', label_th: 'รอก่อน', stat_effects: { happiness: 1 } }
    ]
  };
  try {
    setState(oldLife);
    assert.equal(maybeEnhanceRandomEventWithAi(oldLife, (value) => value, { fetchImpl: () => pending }), true);
    setState(createEmptyGameState());
    resolveRequest({ ok: true, json: async () => ({ event: card, aiGenerated: true }) });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(oldLife.turn.pendingEvents[1].event_id, 'handcrafted');
    assert.equal(writes, 0);
  } finally {
    setState(previousState);
    globalThis.localStorage = originalStorage;
  }
});

test('AI context retains an old salient memory beyond the recent event window', () => {
  const state = createEmptyGameState();
  state.turn.randomEventHistory = [
    { id: 'old_help', age: 14, category: 'friendship', rarity: 'rare', choiceId: 'c1', futureStoryHooks: ['เพื่อนอาจติดต่อกลับมา'] },
    ...Array.from({ length: 30 }, (_, index) => ({ id: `recent_${index}`, age: 20 + index, category: 'daily_life', rarity: 'common', choiceId: 'c1' }))
  ];
  const context = createAiContext(state);
  assert.ok(context.memories.some((entry) => entry.id === 'old_help'));
  assert.ok(context.memories.length <= 20);
});

test('a later reunion requires the earlier helping choice', () => {
  const reunion = RANDOM_EVENT_TEMPLATES.find((event) => event.id === 'random_friend_returns');
  const state = createEmptyGameState();
  state.profile.age = 30;
  assert.equal(isRandomEventEligible(reunion, state), false);
  state.turn.randomEventHistory.push({ id: 'random_friend_help', age: 15, choiceId: 'c2', futureStoryHooks: [] });
  assert.equal(isRandomEventEligible(reunion, state), false);
  state.turn.randomEventHistory[0].choiceId = 'c1';
  state.turn.randomEventHistory[0].futureStoryHooks = ['เพื่อนที่เคยช่วยอาจติดต่อกลับมา'];
  assert.equal(isRandomEventEligible(reunion, state), true);
});

test('dating events respect the current relationship stage', () => {
  const event = ADDITIONAL_RANDOM_TEMPLATES.find((item) => item.category === 'romance');
  const state = createEmptyGameState();
  state.profile.age = 25;
  assert.equal(isRandomEventEligible(event, state), false);
  state.relationships.partner = { status: 'married' };
  assert.equal(isRandomEventEligible(event, state), false);
  state.relationships.partner.status = 'dating';
  assert.equal(isRandomEventEligible(event, state), true);
});
