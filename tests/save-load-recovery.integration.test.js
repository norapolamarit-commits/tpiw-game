import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import {
  SAVE_STORAGE_KEY,
  META_STORAGE_KEY,
  createEmptyGameState,
  getState,
  setState,
  saveGame,
  loadGame,
  hasSavedGame,
  clearSavedGame,
  saveMetaState,
  loadMetaState,
  createDefaultMetaState
} from '../js/core/state.js';

const originalLocalStorage = globalThis.localStorage;
const originalDbRaw = db.raw;
const originalDbIsLoaded = db.isLoaded;
const originalIndexEntries = Object.fromEntries(
  Object.entries(db.indexes).map(([key, map]) => [key, new Map(map)])
);
const originalState = getState();
const storage = new Map();
let storageFailure = { get: false, set: false, remove: false };

globalThis.localStorage = {
  getItem(key) {
    if (storageFailure.get) throw new Error('storage read blocked');
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    if (storageFailure.set) throw new Error('storage quota exceeded');
    storage.set(key, String(value));
  },
  removeItem(key) {
    if (storageFailure.remove) throw new Error('storage remove blocked');
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
  storageFailure = { get: false, set: false, remove: false };
  db.raw = structuredClone(fixtureData);
  db.buildIndexes();
  db.isLoaded = true;
  setState(null);
});

test.after(() => {
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

test('round-trips the complete gameplay state across a fresh load', () => {
  const state = createEmptyGameState();
  state.profile.name = 'ผู้เล่นบันทึกเกม';
  state.profile.age = 28;
  state.profile.currentYearBE = 2596;
  state.profile.currentLocationId = 'loc_chiang_mai';
  state.profile.currentClassId = 'class_3';
  state.stats = {
    health: 61, happiness: 44, intelligence: 78,
    connections: 52, merit: 13, appearance: 67
  };
  state.statCounters.zeroHappinessStreakYears = 1;
  state.finance.cash = 12500;
  state.finance.piggyBank = 450;
  state.finance.investments = {
    fund_test: { amountCash: 3200, costBasis: 3000 }
  };
  state.finance.ownedAssets = [
    { instanceId: 'asset-1', itemId: 'item_test', currentValue: 7000, purchaseAge: 25 }
  ];
  state.finance.activeLoans = [
    { loanId: 'loan_test', principalRemaining: 2100, annualRate: 0.05, missedYears: 0 }
  ];
  state.finance.installments = [
    { itemId: 'item_installment', annualPayment: 500, yearsRemaining: 2 }
  ];
  state.careerAndEdu.activeStudy = {
    programId: 'program_test', yearsCompleted: 2, durationYears: 4,
    annualTuition: 18000, useStudentLoan: true
  };
  state.careerAndEdu.completedDegrees = ['degree_test'];
  state.careerAndEdu.licenses = ['license_test'];
  state.careerAndEdu.mainJobId = 'job_test';
  state.innateTraits = ['trait_quick_learner'];
  state.talentTags = ['tag_computer_nerd'];
  state.flags = ['flag_test'];
  state.statuses = ['status_test'];
  state.relationships.npcs = [
    { id: 'npc_friend', name: 'เพื่อนทดสอบ', relationship: 73, isAlive: true }
  ];
  state.relationships.partner = {
    id: 'partner_test', name: 'คนรักทดสอบ', relationship: 81, status: 'dating'
  };
  state.relationships.children = [
    { id: 'child_test', age: 2, relationship: 90, successPoints: 4 }
  ];
  state.relationships.designatedHeirId = 'child_test';
  state.turn.phase = 'FREE_ACTION';
  state.turn.freeActionPoints = 1;
  state.turn.maxFreeActionPoints = 3;
  state.turn.triggeredEventIdsThisLife = ['evt_old_1', 'evt_old_2'];
  state.turn.lifeFeedLog = [
    { yearBE: 2595, type: 'milestone', text: 'บันทึกเหตุการณ์ทดสอบ' }
  ];

  setState(state);
  assert.equal(saveGame(), true);
  const stored = JSON.parse(storage.get(SAVE_STORAGE_KEY));
  assert.equal(stored.finance.netWorth, 20050);

  setState(null);
  const restored = loadGame();

  assert.ok(restored);
  assert.equal(getState(), restored);
  assert.equal(restored.profile.name, state.profile.name);
  assert.equal(restored.profile.currentYearBE, 2596);
  assert.deepEqual(restored.stats, state.stats);
  assert.deepEqual(restored.statCounters, state.statCounters);
  assert.deepEqual(restored.finance, state.finance);
  assert.deepEqual(restored.careerAndEdu, state.careerAndEdu);
  assert.deepEqual(restored.innateTraits, state.innateTraits);
  assert.deepEqual(restored.talentTags, state.talentTags);
  assert.deepEqual(restored.flags, state.flags);
  assert.deepEqual(restored.statuses, state.statuses);
  assert.deepEqual(restored.relationships, state.relationships);
  assert.deepEqual(restored.turn, state.turn);
  assert.ok(restored.meta.updatedAt);
});

test('resumes an in-progress event without changing its queue position or pending outcome', () => {
  const state = createEmptyGameState();
  state.profile.age = 16;
  state.turn.phase = 'EVENT_QUEUE';
  state.turn.pendingEvents = [
    { eventId: 'evt_first', month: 2, status: 'resolved' },
    { eventId: 'evt_current', month: 6, status: 'awaiting_advance' },
    { eventId: 'evt_next', month: 10, status: 'pending' }
  ];
  state.turn.currentEventIndex = 1;
  state.turn.awaitingEventAdvance = true;
  state.turn.lastChoiceOutcome = {
    eventId: 'evt_current',
    choiceId: 'choice_b',
    success: true,
    statChanges: { happiness: -4, intelligence: 3 },
    cashChange: -250
  };
  state.turn.lastEventCategory = 'education';

  assert.equal(saveGame(state), true);
  setState(null);
  const restored = loadGame();

  assert.equal(restored.turn.phase, 'EVENT_QUEUE');
  assert.equal(restored.turn.currentEventIndex, 1);
  assert.equal(restored.turn.awaitingEventAdvance, true);
  assert.equal(restored.turn.pendingEvents[1].eventId, 'evt_current');
  assert.equal(restored.turn.pendingEvents[2].eventId, 'evt_next');
  assert.deepEqual(restored.turn.lastChoiceOutcome, state.turn.lastChoiceOutcome);
  assert.equal(restored.turn.lastEventCategory, 'education');
});

test('normalizes a partially damaged save while preserving valid progress', () => {
  storage.set(SAVE_STORAGE_KEY, JSON.stringify({
    meta: { schemaVersion: '1.1.0', runId: 'partial-save' },
    profile: { name: 'ข้อมูลบางส่วน', age: 19 },
    finance: { cash: 850, investments: null, ownedAssets: 'broken' },
    relationships: { children: null },
    turn: { phase: 'FREE_ACTION', pendingEvents: {}, lifeFeedLog: null },
    flags: null
  }));

  const restored = loadGame();

  assert.equal(restored.meta.runId, 'partial-save');
  assert.equal(restored.profile.name, 'ข้อมูลบางส่วน');
  assert.equal(restored.finance.cash, 850);
  assert.deepEqual(restored.finance.investments, {});
  assert.deepEqual(restored.finance.ownedAssets, []);
  assert.deepEqual(restored.relationships.children, []);
  assert.deepEqual(restored.turn.pendingEvents, []);
  assert.deepEqual(restored.turn.lifeFeedLog, []);
  assert.deepEqual(restored.flags, []);
});

test('returns no active game for malformed JSON without deleting the original save data', () => {
  storage.set(SAVE_STORAGE_KEY, '{not valid json');
  setState(createEmptyGameState());

  assert.equal(loadGame(), null);
  assert.equal(getState(), null);
  assert.equal(hasSavedGame(), true);
  assert.equal(storage.get(SAVE_STORAGE_KEY), '{not valid json');
});

test('does not overwrite a save created by a newer unsupported game schema', () => {
  const futureSave = JSON.stringify({
    meta: { schemaVersion: '9.0.0', runId: 'future-run' },
    profile: { age: 45 }
  });
  storage.set(SAVE_STORAGE_KEY, futureSave);

  assert.equal(loadGame(), null);
  assert.equal(storage.get(SAVE_STORAGE_KEY), futureSave);
  assert.equal(getState(), null);
});

test('keeps cross-life MetaState separate from clearing the current life save', () => {
  const meta = {
    ...createDefaultMetaState(),
    karmaBankMerit: 240,
    totalLivesPlayed: 3,
    unlockedEndings: ['ending_test'],
    hallOfFame: [{ name: 'รุ่นก่อน', age: 88 }]
  };
  const state = createEmptyGameState();

  assert.equal(saveMetaState(meta), true);
  assert.equal(saveGame(state), true);
  assert.equal(hasSavedGame(), true);

  assert.equal(clearSavedGame(), true);
  assert.equal(getState(), null);
  assert.equal(hasSavedGame(), false);
  assert.deepEqual(loadMetaState(), meta);
  assert.equal(storage.has(META_STORAGE_KEY), true);
  assert.equal(storage.has(SAVE_STORAGE_KEY), false);
});

test('fills missing MetaState fields with defaults and recovers from malformed MetaState', () => {
  storage.set(META_STORAGE_KEY, JSON.stringify({ karmaBankMerit: 75 }));
  assert.deepEqual(loadMetaState(), {
    ...createDefaultMetaState(),
    karmaBankMerit: 75
  });

  storage.set(META_STORAGE_KEY, '{broken');
  assert.deepEqual(loadMetaState(), createDefaultMetaState());
});

test('handles unavailable localStorage without throwing from save/load helpers', () => {
  const state = createEmptyGameState();
  storageFailure = { get: true, set: true, remove: true };

  assert.equal(saveGame(state), false);
  assert.equal(loadGame(), null);
  assert.equal(hasSavedGame(), false);
  assert.equal(clearSavedGame(), false);
  assert.equal(saveMetaState(createDefaultMetaState()), false);
  assert.deepEqual(loadMetaState(), createDefaultMetaState());
});

test('returns null when no game save exists and false when asked to save an empty state', () => {
  assert.equal(loadGame(), null);
  assert.equal(saveGame(null), false);
  assert.equal(hasSavedGame(), false);
});
