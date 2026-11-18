import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import {
  SAVE_STORAGE_KEY,
  createEmptyGameState,
  createNewCharacter,
  getState,
  setState,
  hasSavedGame,
  loadGame
} from '../js/core/state.js';
import {
  getMaxFreeActionPointsForAge,
  initializeFirstYearTurn,
  getPrimaryActionButtonSpec
} from '../js/engine/turn_manager.js';

const originalLocalStorage = globalThis.localStorage;
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

test('creates a newborn with the requested profile, origin, family, and starting finances', () => {
  const state = createNewCharacter('class_3', 'loc_bangkok', 'female', 'น้องทดสอบ', {
    purchasedTraitIds: ['trait_quick_learner']
  });
  const birthClass = db.getClass('class_3');

  assert.equal(state.profile.name, 'น้องทดสอบ');
  assert.equal(state.profile.gender, 'female');
  assert.equal(state.profile.titlePrefix, 'ด.ญ.');
  assert.equal(state.profile.age, 0);
  assert.equal(state.profile.lifePhaseId, 'phase_1_infant');
  assert.equal(state.profile.spawnClassId, 'class_3');
  assert.equal(state.profile.currentClassId, 'class_3');
  assert.equal(state.profile.birthLocationId, 'loc_bangkok');
  assert.equal(state.profile.currentLocationId, 'loc_bangkok');
  assert.equal(state.profile.isAlive, true);
  assert.deepEqual(state.innateTraits, ['trait_quick_learner']);
  assert.equal(state.finance.parentAnnualSupport,0,'newborns do not receive pocket money');
  assert.equal(state.finance.parentPaidSupportAnnual,Math.round(Number(birthClass.parent_annual_support_age_0_to_17||0)*0.93));
  assert.equal(state.finance.piggyBank,Math.round(Number(birthClass.parent_annual_support_age_0_to_17||0)*0.93*0.05));
  assert.equal(state.profile.lifePathId,'life_path_balanced');
  assert.equal(state.finance.cash, 0);
  assert.equal(state.relationships.npcs.length, 2);
  assert.deepEqual(state.relationships.npcs.map((npc) => npc.id).sort(), ['npc_father', 'npc_mother']);
  assert.equal(getState(), state);
  assert.equal(hasSavedGame(), true);
  assert.ok(state.turn.lifeFeedLog.some((entry) => entry.type === 'birth'));
});

test('falls back to valid database class and location when unknown IDs are supplied', () => {
  const state = createNewCharacter('class_does_not_exist', 'loc_does_not_exist', 'male', 'ผู้เล่นทดสอบ');

  assert.ok(db.getClass(state.profile.spawnClassId));
  assert.ok(db.getLocation(state.profile.birthLocationId));
  assert.equal(state.profile.gender, 'male');
});

test('silver-spoon rebirth trait restricts a random birth class to the upper social classes', () => {
  const state = createNewCharacter(null, 'loc_bangkok', 'male', 'ผู้เล่นทดสอบ', {
    purchasedTraitIds: ['trait_silver_spoon']
  });

  assert.ok(['class_4', 'class_5'].includes(state.profile.spawnClassId));
  assert.ok(state.innateTraits.includes('trait_silver_spoon'));
});

test('initializes the first-year event queue and age-appropriate action points for a newborn', () => {
  const state = createNewCharacter('class_3', 'loc_bangkok', 'male', 'ทดสอบเริ่มเกม');
  const result = initializeFirstYearTurn(state);

  assert.equal(result.success, true);
  assert.equal(result.age, 0);
  assert.equal(result.eventsCount, state.turn.pendingEvents.length);
  assert.ok(result.eventsCount > 0);
  assert.ok(result.currentEvent);
  assert.equal(state.turn.currentEventIndex, 0);
  assert.equal(state.turn.awaitingEventAdvance, false);
  assert.equal(state.turn.maxFreeActionPoints, 2);
  assert.equal(state.turn.freeActionPoints, 2);
  assert.equal(getMaxFreeActionPointsForAge(0), 2);
  assert.equal(getPrimaryActionButtonSpec(state).phase, state.turn.phase);
  assert.equal(storage.has(SAVE_STORAGE_KEY), true);
});

test('initializes an adult heir with three free-action points and a first event queue', () => {
  const state = createEmptyGameState();
  state.profile.age = 18;
  state.profile.lifePhaseId = 'phase_4_young_adult';
  state.profile.isAlive = true;
  state.profile.currentLocationId = 'loc_bangkok';
  state.turn.phase = 'FREE_ACTION';

  const result = initializeFirstYearTurn(state);

  assert.equal(result.success, true);
  assert.equal(result.age, 18);
  assert.equal(state.turn.maxFreeActionPoints, 3);
  assert.equal(state.turn.freeActionPoints, 3);
  assert.ok(result.eventsCount > 0);
  assert.ok(result.currentEvent);
});

test('saves and reloads a newly initialized life without losing its opening event queue', () => {
  const state = createNewCharacter('class_2', 'loc_chiang_mai', 'female', 'ชีวิตใหม่');
  initializeFirstYearTurn(state);
  const savedQueue = structuredClone(state.turn.pendingEvents);

  setState(null);
  const restored = loadGame();

  assert.ok(restored);
  assert.equal(restored.profile.name, 'ชีวิตใหม่');
  assert.equal(restored.profile.age, 0);
  assert.deepEqual(restored.turn.pendingEvents, savedQueue);
  assert.equal(restored.turn.currentEventIndex, 0);
  assert.equal(restored.turn.maxFreeActionPoints, 2);
});
