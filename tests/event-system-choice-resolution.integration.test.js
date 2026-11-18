import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import { createEmptyGameState, getState, setState } from '../js/core/state.js';
import {
  buildAnnualEventQueue,
  getCurrentPendingEvent,
  isEventEligible,
  normalizeEventCard,
  ensureAnnualEventMinimum
} from '../js/engine/event_engine.js';
import {
  selectCurrentEventChoice,
  proceedAfterEventOutcome,
  checkStatThresholdsAndDeath
} from '../js/engine/turn_manager.js';

const originalLocalStorage = globalThis.localStorage;
const originalMathRandom = Math.random;
const originalDbRaw = db.raw;
const originalDbIsLoaded = db.isLoaded;
const originalIndexEntries = Object.fromEntries(
  Object.entries(db.indexes).map(([key, map]) => [key, new Map(map)])
);
const originalState = getState();
const storage = new Map();

globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  }
};

const fixtureData = {};
for (const [key, filename] of Object.entries(DATA_MANIFEST)) {
  const filePath = fileURLToPath(new URL(`../data/${filename}`, import.meta.url));
  fixtureData[key] = JSON.parse(await readFile(filePath, 'utf8'));
}

test.beforeEach(() => {
  storage.clear();
  Math.random = originalMathRandom;
  db.raw = structuredClone(fixtureData);
  db.buildIndexes();
  db.isLoaded = true;
  setState(null);
});

test.after(() => {
  Math.random = originalMathRandom;
  db.raw = originalDbRaw;
  db.isLoaded = originalDbIsLoaded;
  for (const [key, map] of Object.entries(db.indexes)) {
    map.clear();
    for (const [entryKey, value] of originalIndexEntries[key]) {
      map.set(entryKey, value);
    }
  }
  setState(originalState);
  if (originalLocalStorage === undefined) {
    delete globalThis.localStorage;
  } else {
    globalThis.localStorage = originalLocalStorage;
  }
});

function createEventState(age = 25) {
  const state = createEmptyGameState();
  state.profile.age = age;
  state.profile.isAlive = true;
  state.profile.currentClassId = 'class_3';
  state.profile.spawnClassId = 'class_3';
  state.profile.currentLocationId = 'loc_bangkok';
  state.stats = {
    health: 70,
    happiness: 60,
    intelligence: 55,
    connections: 50,
    merit: 20,
    appearance: 55
  };
  state.finance.cash = 1000;
  state.finance.piggyBank = 300;
  state.turn.phase = 'EVENT_QUEUE';
  state.turn.areTabsLocked = true;
  state.turn.pendingEvents = [];
  state.turn.currentEventIndex = 0;
  state.turn.awaitingEventAdvance = false;
  state.turn.triggeredEventIdsThisLife = [];
  state.turn.lifeFeedLog = [];
  return state;
}

function queueOneEvent(state, eventOverrides = {}, choices = []) {
  state.turn.pendingEvents = [{
    event_id: 'evt_test_choice_resolution',
    source_type: 'pool_event',
    category: 'general',
    min_age: 0,
    max_age: 100,
    title_th: 'เหตุการณ์ทดสอบ',
    description_th: 'ใช้ทดสอบการประมวลผลตัวเลือก',
    monthNum: 1,
    monthTh: 'มกราคม',
    req_flags: [],
    forbidden_flags: [],
    ...eventOverrides,
    choices
  }];
  state.turn.currentEventIndex = 0;
  state.turn.phase = 'EVENT_QUEUE';
  state.turn.areTabsLocked = true;
  state.turn.awaitingEventAdvance = false;
}

test('every authored event pool record contains at least three choices', () => {
  for (const [key, data] of Object.entries(fixtureData)) {
    if (!Array.isArray(data?.events)) continue;
    for (const event of data.events) {
      assert.ok(
        event.choices.length >= 3,
        `${key}/${event.event_id} should have at least three choices`
      );
    }
  }
});

test('normalized system-generated events are supplemented to three choices', () => {
  const event = normalizeEventCard({
    event_id: 'evt_test_minimum_choices',
    title_th: 'เหตุการณ์ทดสอบ',
    description_th: 'ทดสอบเติมตัวเลือกของการ์ดที่สร้างจากระบบ',
    category: 'general',
    choices: [
      { choice_id: 'c1', label_th: 'ทางเลือกหนึ่ง', stat_effects: { happiness: 2 } },
      { choice_id: 'c2', label_th: 'ทางเลือกสอง', stat_effects: { health: 2 } }
    ]
  });

  assert.equal(event.choices.length, 3);
  assert.equal(event.choices[2].isLocked, undefined);
  assert.deepEqual(event.choices[2].req_flags, []);
});

test('legacy in-progress saves receive one supplemental event only during restore repair', () => {
  const state = createEventState(25);
  queueOneEvent(state, {}, [{
    choice_id: 'choice_legacy',
    label_th: 'ตัวเลือกจากเซฟเดิม',
    req_stats: {},
    req_flags: [],
    stat_effects: { happiness: 1 }
  }]);

  assert.equal(state.turn.pendingEvents.length, 1);
  assert.equal(ensureAnnualEventMinimum(state), true);
  assert.equal(state.turn.pendingEvents.length, 2);
  assert.equal(ensureAnnualEventMinimum(state), false);
  assert.equal(state.turn.pendingEvents.length, 2);
  assert.equal(state.turn.pendingEvents[0].event_id, 'evt_test_choice_resolution');
});

test('legacy age-zero saves do not receive a supplemental event', () => {
  const state = createEventState(0);
  queueOneEvent(state, {}, [{
    choice_id: 'choice_newborn_legacy',
    label_th: 'ตัวเลือกวัยแรกเกิด',
    req_stats: {},
    req_flags: [],
    stat_effects: {}
  }]);

  assert.equal(ensureAnnualEventMinimum(state), false);
  assert.equal(state.turn.pendingEvents.length, 1);
});

test('annual event queue contains at least two events from age one onward, while age zero is exempt', () => {
  const firstYear = createEventState(0);
  const infantQueue = buildAnnualEventQueue(firstYear);
  assert.ok(infantQueue.length >= 1);
  assert.equal(infantQueue.some((event) => event.event_id === 'evt_annual_minimum_0'), false);

  const ageOne = createEventState(1);
  const ageOneQueue = buildAnnualEventQueue(ageOne);
  assert.ok(ageOneQueue.length >= 2, `expected at least two events, received ${ageOneQueue.length}`);
});

test('stat threshold rewards are applied once when a threshold flag becomes active', () => {
  const state = createEventState(25);
  state.stats.health = 100;
  state.stats.happiness = 60;
  state.stats.appearance = 55;

  const first = checkStatThresholdsAndDeath(state);
  assert.equal(state.stats.happiness, 60);
  assert.equal(state.stats.appearance, 55);
  assert.ok(state.statCounters.statGainRemainders.happiness > 0);
  assert.ok(state.statCounters.statGainRemainders.appearance > 0);
  assert.ok(first.grantedThresholdFlags.includes('flag_iron_body'));

  const second = checkStatThresholdsAndDeath(state);
  assert.equal(state.stats.happiness, 60);
  assert.equal(state.stats.appearance, 55);
  assert.equal(second.grantedThresholdFlags.includes('flag_iron_body'), false);
});

test('zero-happiness streak advances at most once per age and depression penalty is not repeated by threshold checks', () => {
  const state = createEventState(25);
  state.stats.happiness = 0;

  checkStatThresholdsAndDeath(state);
  checkStatThresholdsAndDeath(state);
  assert.equal(state.statCounters.zeroHappinessStreakYears, 1);
  assert.equal(state.stats.health, 70);
  assert.equal(state.stats.intelligence, 55);

  state.profile.age = 26;
  const secondYear = checkStatThresholdsAndDeath(state);
  assert.equal(state.statCounters.zeroHappinessStreakYears, 2);
  assert.ok(state.flags.includes('flag_depression') || state.statuses.includes('flag_depression'));
  assert.equal(state.stats.health, 65);
  assert.equal(state.stats.intelligence, 53);
  assert.ok(secondYear.grantedThresholdFlags.includes('flag_depression'));

  checkStatThresholdsAndDeath(state);
  assert.equal(state.stats.health, 65);
  assert.equal(state.stats.intelligence, 53);
});

test('builds a non-empty annual event queue with unique IDs and chronological Thai months', () => {
  const state = createEventState(25);
  Math.random = () => 0.37;

  const queue = buildAnnualEventQueue(state);

  assert.ok(queue.length > 0);
  assert.equal(new Set(queue.map((event) => event.event_id)).size, queue.length);
  assert.ok(queue.every((event) => event.event_id));
  assert.ok(queue.every((event) => event.monthNum >= 1 && event.monthNum <= 12));
  assert.deepEqual(
    queue.map((event) => event.monthNum),
    [...queue.map((event) => event.monthNum)].sort((a, b) => a - b)
  );
  assert.equal(state.turn.currentEventIndex, 0);
  assert.equal(state.turn.phase, 'EVENT_QUEUE');
  assert.equal(state.turn.areTabsLocked, true);
});

test('newborn event pool selection is limited to the life-phase bucket', () => {
  const state = createEventState(2);
  Math.random = () => 0.41;

  const queue = buildAnnualEventQueue(state);

  const poolEvents = queue.filter((event) => event.source_type === 'pool_event');
  assert.ok(poolEvents.length > 0);
  assert.ok(poolEvents.every((event) => event.pool_bucket === 'life_phase'));
});

test('event eligibility enforces age, class, location, job, and prior-trigger restrictions', () => {
  const state = createEventState(25);
  state.careerAndEdu.mainJobId = null;

  const base = {
    event_id: 'evt_eligibility_test',
    trigger_age: 25,
    allowed_classes: ['class_3'],
    req_location_id: 'loc_bangkok',
    req_flags: [],
    forbidden_flags: []
  };

  assert.equal(isEventEligible(base, state), true);
  assert.equal(isEventEligible({ ...base, trigger_age: 30 }, state), false);
  assert.equal(isEventEligible({ ...base, allowed_classes: ['class_1'] }, state), false);
  assert.equal(isEventEligible({ ...base, req_location_id: 'loc_chiang_mai' }, state), false);
  assert.equal(isEventEligible({ ...base, req_job_id: 'job_nonexistent' }, state), false);

  state.turn.triggeredEventIdsThisLife.push(base.event_id);
  assert.equal(isEventEligible(base, state), false);
  assert.equal(isEventEligible(base, state, { ignoreTriggeredHistory: true }), true);
});

test('choice applies stat effects, grants flags, records life feed, and marks the event as triggered', () => {
  const state = createEventState();
  queueOneEvent(state, {}, [{
    choice_id: 'choice_apply_effects',
    label_th: 'เลือกผลลัพธ์ทดสอบ',
    req_stats: {},
    req_flags: [],
    stat_effects: { happiness: 8, intelligence: 4, cash: 500 },
    grants_flags: ['flag_event_test_reward'],
    removes_flags: []
  }]);

  const result = selectCurrentEventChoice('choice_apply_effects', state);

  assert.equal(result.success, true);
  assert.equal(state.stats.happiness, 63);
  assert.equal(state.stats.intelligence, 56);
  assert.equal(state.finance.cash, 1500);
  assert.ok(state.flags.includes('flag_event_test_reward'));
  assert.ok(state.turn.triggeredEventIdsThisLife.includes('evt_test_choice_resolution'));
  assert.equal(state.turn.lifeFeedLog.length, 1);
  assert.equal(state.turn.awaitingEventAdvance, true);
});

test('cash rewards for a child under seven are deposited into the piggy bank', () => {
  const state = createEventState(5);
  queueOneEvent(state, {}, [{
    choice_id: 'choice_piggy_reward',
    label_th: 'เก็บเงินรับขวัญ',
    req_stats: {},
    req_flags: [],
    stat_effects: { cash: 750 },
    grants_flags: [],
    removes_flags: []
  }]);

  const result = selectCurrentEventChoice('choice_piggy_reward', state);

  assert.equal(result.success, true);
  assert.equal(state.finance.piggyBank, 1050);
  assert.equal(state.finance.cash, 1000);
  assert.equal(result.statDeltas.piggyBank, 750);
});

test('locked choices cannot be selected and a neutral system fallback is offered', () => {
  const state = createEventState();
  queueOneEvent(state, {}, [{
    choice_id: 'choice_locked',
    label_th: 'ตัวเลือกที่ต้องมีสมองสูง',
    req_stats: { intelligence: 99 },
    req_flags: [],
    stat_effects: { happiness: 20 },
    grants_flags: [],
    removes_flags: []
  }]);

  const current = getCurrentPendingEvent(state);
  assert.equal(current.choices[0].isLocked, true);
  assert.equal(current.choices.at(-1).choice_id, '__system_no_available_choice__');

  const result = selectCurrentEventChoice('choice_locked', state);
  assert.equal(result.success, false);
  assert.equal(state.stats.happiness, 60);

  const fallback = selectCurrentEventChoice('__system_no_available_choice__', state);
  assert.equal(fallback.success, true);
  assert.equal(state.stats.happiness, 60);
});

test('RNG choice applies the success branch when the deterministic roll succeeds', () => {
  const state = createEventState();
  queueOneEvent(state, {}, [{
    choice_id: 'choice_rng',
    label_th: 'ลองเสี่ยงโชค',
    req_stats: {},
    req_flags: [],
    rng_mechanic: {
      success_chance_percent: 40,
      fail_stat_effects: { happiness: -7 },
      fail_outcome_text_th: 'ผลทดสอบไม่สำเร็จ'
    },
    stat_effects: { happiness: 12 },
    grants_flags: ['flag_rng_success'],
    removes_flags: []
  }]);
  Math.random = () => 0;

  const result = selectCurrentEventChoice('choice_rng', state);

  assert.equal(result.success, true);
  assert.equal(result.rngRollInfo.isSuccess, true);
  assert.equal(state.stats.happiness, 64);
  assert.ok(state.flags.includes('flag_rng_success'));
});

test('RNG choice applies the failure branch when the deterministic roll fails', () => {
  const state = createEventState();
  queueOneEvent(state, {}, [{
    choice_id: 'choice_rng',
    label_th: 'ลองเสี่ยงโชค',
    req_stats: {},
    req_flags: [],
    rng_mechanic: {
      success_chance_percent: 40,
      fail_stat_effects: { happiness: -7 },
      fail_grants_flags: ['flag_rng_failure'],
      fail_outcome_text_th: 'ผลทดสอบไม่สำเร็จ'
    },
    stat_effects: { happiness: 12 },
    grants_flags: ['flag_rng_success'],
    removes_flags: []
  }]);
  Math.random = () => 0.99;

  const result = selectCurrentEventChoice('choice_rng', state);

  assert.equal(result.success, true);
  assert.equal(result.rngRollInfo.isSuccess, false);
  assert.equal(state.stats.happiness, 53);
  assert.ok(state.flags.includes('flag_rng_failure'));
  assert.equal(state.flags.includes('flag_rng_success'), false);
});

test('relationship event updates only the matching living NPC and clamps relationship values', () => {
  const state = createEventState();
  state.relationships.npcs = [{
    id: 'npc_test_parent',
    archetypeId: 'npc_arch_father',
    name: 'คุณพ่อทดสอบ',
    isAlive: true,
    relationship: 98
  }];
  queueOneEvent(state, { target_npc_archetype: 'npc_arch_father' }, [{
    choice_id: 'choice_relationship',
    label_th: 'ใช้เวลาด้วยกัน',
    req_stats: {},
    req_flags: [],
    relationship_change: 8,
    stat_effects: {},
    grants_flags: [],
    removes_flags: []
  }]);

  const result = selectCurrentEventChoice('choice_relationship', state);

  assert.equal(result.success, true);
  assert.equal(state.relationships.npcs[0].relationship, 100);
  assert.equal(result.relationshipUpdate.delta, 2);
  assert.ok(state.flags.includes('flag_parent_hearts_5'));
});

test('event queue advances to the next event and clears itself when complete', () => {
  const state = createEventState();
  const first = {
    event_id: 'evt_queue_first',
    source_type: 'pool_event',
    category: 'general',
    min_age: 0,
    max_age: 100,
    title_th: 'ใบแรก',
    monthNum: 1,
    monthTh: 'มกราคม',
    choices: []
  };
  const second = {
    ...first,
    event_id: 'evt_queue_second',
    title_th: 'ใบที่สอง',
    monthNum: 2,
    monthTh: 'กุมภาพันธ์'
  };
  state.turn.pendingEvents = [first, second];
  state.turn.currentEventIndex = 0;
  state.turn.phase = 'EVENT_QUEUE';
  state.turn.awaitingEventAdvance = true;

  const next = proceedAfterEventOutcome(state);
  assert.equal(next.completedQueue, false);
  assert.equal(next.nextEvent.event_id, 'evt_queue_second');

  state.turn.awaitingEventAdvance = true;
  const done = proceedAfterEventOutcome(state);
  assert.equal(done.completedQueue, true);
  assert.equal(state.turn.phase, 'FREE_ACTION');
  assert.equal(state.turn.areTabsLocked, false);
  assert.deepEqual(state.turn.pendingEvents, []);
});
