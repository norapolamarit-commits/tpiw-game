import test from 'node:test';
import assert from 'node:assert/strict';

import { db } from '../js/core/db.js';
import { createEmptyGameState } from '../js/core/state.js';
import {
  acknowledgeAnnualSlipAndStartEvents,
  getPrimaryActionButtonSpec,
  proceedAfterEventOutcome,
  selectCurrentEventChoice,
  startNextYearTurn,
  triggerPrimaryActionButton
} from '../js/engine/turn_manager.js';

const originalLocalStorage = globalThis.localStorage;
const originalDbRaw = db.raw;
const originalClasses = db.indexes.classes;
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

test.beforeEach(() => {
  storage.clear();
  db.raw = {
    coreRules: {
      game_constants: {
        max_age: 100
      }
    }
  };
  db.indexes.classes = new Map();
});

test.after(() => {
  db.raw = originalDbRaw;
  db.indexes.classes = originalClasses;

  if (originalLocalStorage === undefined) {
    delete globalThis.localStorage;
  } else {
    globalThis.localStorage = originalLocalStorage;
  }
});

function createEventQueueState() {
  const state = createEmptyGameState();
  state.profile.age = 25;
  state.profile.isAlive = true;
  state.stats = {
    health: 70,
    happiness: 60,
    intelligence: 55,
    connections: 50,
    merit: 20,
    appearance: 55
  };
  state.turn.phase = 'YEAR_SUMMARY';
  state.turn.areTabsLocked = true;
  state.turn.pendingEvents = [{
    event_id: 'test_event_turn_flow_01',
    trigger_age: 25,
    category: 'general',
    title_th: 'เหตุการณ์ทดสอบ',
    description_th: 'ใช้ตรวจสอบการเปลี่ยนผ่านของคิวเหตุการณ์',
    monthNum: 1,
    monthTh: 'มกราคม',
    req_flags: [],
    forbidden_flags: [],
    choices: [{
      choice_id: 'choice_continue',
      label_th: 'เลือกดำเนินการ',
      req_stats: {},
      req_flags: [],
      grants_flags: [],
      removes_flags: [],
      stat_effects: { happiness: 5 }
    }]
  }, {
    event_id: 'test_event_turn_flow_02',
    trigger_age: 25,
    category: 'general',
    title_th: 'เหตุการณ์ทดสอบใบที่สอง',
    description_th: 'ใช้ตรวจสอบว่าระบบแสดงเหตุการณ์ใบถัดไปก่อนปลดล็อกช่วงอิสระ',
    monthNum: 2,
    monthTh: 'กุมภาพันธ์',
    req_flags: [],
    forbidden_flags: [],
    choices: [{
      choice_id: 'choice_continue_second',
      label_th: 'เลือกดำเนินการต่อ',
      req_stats: {},
      req_flags: [],
      grants_flags: [],
      removes_flags: [],
      stat_effects: { happiness: 1 }
    }]
  }];
  state.turn.currentEventIndex = 0;
  state.turn.awaitingEventAdvance = false;
  return state;
}

test('acknowledging the annual summary opens the first queued event', () => {
  const state = createEventQueueState();

  const result = acknowledgeAnnualSlipAndStartEvents(state);

  assert.equal(result.success, true);
  assert.equal(result.phase, 'EVENT_QUEUE');
  assert.equal(result.currentEvent.event_id, 'test_event_turn_flow_01');
  assert.equal(state.turn.phase, 'EVENT_QUEUE');
  assert.equal(state.turn.areTabsLocked, true);
});

test('event choices advance through the annual queue before free action', () => {
  const state = createEventQueueState();
  acknowledgeAnnualSlipAndStartEvents(state);

  const firstChoice = selectCurrentEventChoice('choice_continue', state);

  assert.equal(firstChoice.success, true);
  assert.equal(state.stats.happiness, 62);
  assert.equal(state.turn.awaitingEventAdvance, true);
  assert.equal(state.turn.phase, 'EVENT_QUEUE');
  assert.equal(state.turn.triggeredEventIdsThisLife.includes('test_event_turn_flow_01'), true);

  const duplicateChoice = selectCurrentEventChoice('choice_continue', state);
  assert.equal(duplicateChoice.success, false);
  assert.equal(state.stats.happiness, 62);

  const actionSpec = getPrimaryActionButtonSpec(state);
  assert.equal(actionSpec.actionType, 'NEXT_EVENT');
  assert.equal(actionSpec.disabled, false);

  const advanceToSecondEvent = triggerPrimaryActionButton(state);
  assert.equal(advanceToSecondEvent.completedQueue, false);
  assert.equal(state.turn.phase, 'EVENT_QUEUE');
  assert.equal(state.turn.currentEventIndex, 1);
  assert.equal(state.turn.awaitingEventAdvance, false);

  const secondChoice = selectCurrentEventChoice('choice_continue_second', state);
  assert.equal(secondChoice.success, true);
  assert.equal(state.turn.awaitingEventAdvance, true);

  const finalActionSpec = getPrimaryActionButtonSpec(state);
  assert.equal(finalActionSpec.actionType, 'UNLOCK_FREE_ACTION');
  assert.equal(finalActionSpec.disabled, false);

  const advanceResult = triggerPrimaryActionButton(state);
  assert.equal(advanceResult.completedQueue, true);
  assert.equal(state.turn.phase, 'FREE_ACTION');
  assert.equal(state.turn.areTabsLocked, false);
  assert.deepEqual(state.turn.pendingEvents, []);
  assert.equal(state.turn.awaitingEventAdvance, false);
});

test('annual summary with no queued events goes directly to free action', () => {
  const state = createEventQueueState();
  state.turn.pendingEvents = [];

  const result = acknowledgeAnnualSlipAndStartEvents(state);

  assert.equal(result.success, true);
  assert.equal(result.phase, 'FREE_ACTION');
  assert.equal(state.turn.areTabsLocked, false);
  assert.equal(getPrimaryActionButtonSpec(state).actionType, 'NEXT_YEAR');
});

test('next-year processing is blocked until the player reaches free action', () => {
  const state = createEventQueueState();
  const originalAge = state.profile.age;

  for (const phase of ['YEAR_SUMMARY', 'EVENT_QUEUE', 'EMERGENCY_DEBT']) {
    state.turn.phase = phase;
    const result = startNextYearTurn(state);

    assert.equal(result.success, false);
    assert.equal(result.phase, phase);
    assert.equal(state.profile.age, originalAge);
  }
});

test('invalid event choice does not mutate player stats or advance the queue', () => {
  const state = createEventQueueState();
  acknowledgeAnnualSlipAndStartEvents(state);

  const result = selectCurrentEventChoice('missing_choice', state);

  assert.equal(result.success, false);
  assert.equal(state.stats.happiness, 60);
  assert.equal(state.turn.currentEventIndex, 0);
  assert.equal(state.turn.awaitingEventAdvance, false);
});
