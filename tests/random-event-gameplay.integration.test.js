import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DATA_MANIFEST, db } from '../js/core/db.js';
import { createEmptyGameState, loadGame, mergeGameStateWithTemplate, saveGame } from '../js/core/state.js';
import { buildAnnualEventQueue, isEventEligible, normalizeEventCard, selectEventChoice } from '../js/engine/event_engine.js';
import { renderTab1LifeFeed } from '../js/ui/tab1_life_feed.js';
import { renderTab3Relationships } from '../js/ui/tab3_relationships.js';
import { GENDER_DIVERSE_ENCOUNTERS, toLegacyEventCard } from '../js/engine/random_event_templates.js';
import { discoverPotentialPartners, startTalkingToPartner } from '../js/engine/social_engine.js';

const raw = {};
for (const [key, filename] of Object.entries(DATA_MANIFEST)) {
  raw[key] = JSON.parse(await readFile(new URL(`../data/${filename}`, import.meta.url)));
}

test('a seeded random card enters the real queue, applies consequences, and survives save/load', () => {
  const previousRaw = db.raw;
  const previousLoaded = db.isLoaded;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem() {}, getItem() { return null; } };
  try {
    db.raw = raw;
    db.buildIndexes();
    db.isLoaded = true;
    const state = createEmptyGameState();
    state.profile.age = 20;
    state.turn.randomEventSeed = 0;
    const queue = buildAnnualEventQueue(state);
    const index = queue.findIndex((card) => card.source_type === 'random_event');
    assert.ok(index >= 0);
    state.turn.currentEventIndex = index;
    state.turn.phase = 'EVENT_QUEUE';
    const card = queue[index];
    const before = structuredClone(state.stats);
    const outcome = selectEventChoice(state, card.choices[0].choice_id);
    assert.equal(outcome.success, true);
    assert.equal(state.turn.randomEventHistory.at(-1).id, card.event_id);
    assert.notDeepEqual(state.stats, before);
    const restored = mergeGameStateWithTemplate(JSON.parse(JSON.stringify(state)));
    assert.deepEqual(restored.turn.randomEventHistory, state.turn.randomEventHistory);
    const html = renderTab1LifeFeed(restored, { onRefresh() {} }).html;
    assert.match(html, /ประวัติเหตุการณ์สุ่ม/);
  } finally {
    db.raw = previousRaw;
    db.isLoaded = previousLoaded;
    globalThis.localStorage = previousStorage;
  }
});

test('partner discovery offers distinct gender identities and preserves the selected identity', () => {
  const previousRaw = db.raw;
  const previousLoaded = db.isLoaded;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem() {}, getItem() { return null; } };
  try {
    db.raw = raw;
    db.buildIndexes();
    db.isLoaded = true;
    const state = createEmptyGameState();
    state.profile.age = 25;
    const result = discoverPotentialPartners(state);
    assert.equal(result.success, true);
    assert.equal(new Set(result.candidates.map((candidate) => candidate.genderIdentity)).size, result.candidates.length);
    const selected = result.candidates[0];
    assert.equal(startTalkingToPartner(state, selected.candidateId).success, true);
    assert.equal(state.relationships.partner.genderIdentity, selected.genderIdentity);
  } finally {
    db.raw = previousRaw;
    db.isLoaded = previousLoaded;
    globalThis.localStorage = previousStorage;
  }
});

test('real save and load retain random history, narrative hooks, and RNG seed', () => {
  const previousStorage = globalThis.localStorage;
  const storage = new Map();
  globalThis.localStorage = { getItem(key) { return storage.get(key) || null; }, setItem(key, value) { storage.set(key, value); } };
  try {
    const state = createEmptyGameState();
    state.turn.randomEventSeed = 12345;
    state.turn.randomEventHistory.push({ id: 'old_help', age: 14, category: 'friendship', rarity: 'rare', choiceId: 'c1', futureStoryHooks: ['เพื่อนอาจติดต่อกลับมา'] });
    assert.equal(saveGame(state), true);
    const restored = loadGame();
    assert.equal(restored.turn.randomEventSeed, 12345);
    assert.deepEqual(restored.turn.randomEventHistory, state.turn.randomEventHistory);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});

test('queued AI events become ineligible if a referenced NPC dies before the card appears', () => {
  const state = createEmptyGameState();
  state.profile.age = 30;
  state.relationships.npcs.push({ id: 'npc_old_friend', name: 'มิน', isAlive: false });
  const card = { event_id: 'ai_old_friend', source_type: 'random_event', min_age: 30, max_age: 30, referencedNpcIds: ['npc_old_friend'], choices: [] };
  assert.equal(isEventEligible(card, state), false);
});

test('meeting a person of another gender adds a living NPC only when the player chooses to connect', () => {
  const previousRaw = db.raw;
  const previousLoaded = db.isLoaded;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem() {}, getItem() { return null; } };
  try {
    db.raw = raw;
    db.buildIndexes();
    db.isLoaded = true;
    const template = GENDER_DIVERSE_ENCOUNTERS.find((event) => event.id === 'random_meet_nonbinary');
    const makeState = () => {
      const state = createEmptyGameState();
      state.profile.age = 20;
      state.turn.phase = 'EVENT_QUEUE';
      state.turn.pendingEvents = [normalizeEventCard(toLegacyEventCard(template))];
      return state;
    };
    const connected = makeState();
    assert.equal(selectEventChoice(connected, 'c1').success, true);
    const npc = connected.relationships.npcs.find((person) => person.id === `npc_${template.id}`);
    assert.equal(npc.genderIdentity, 'nonbinary');
    assert.equal(npc.isAlive, true);
    assert.match(renderTab3Relationships(connected, { onRefresh() {} }).html, /Non-binary/);
    const passed = makeState();
    assert.equal(selectEventChoice(passed, 'c2').success, true);
    assert.equal(passed.relationships.npcs.length, 0);
  } finally {
    db.raw = previousRaw;
    db.isLoaded = previousLoaded;
    globalThis.localStorage = previousStorage;
  }
});
