import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import {
  SAVE_STORAGE_KEY,
  createNewCharacter,
  getState,
  setState,
  loadGame,
  hasSavedGame
} from '../js/core/state.js';
import { getCurrentPendingEvent } from '../js/engine/event_engine.js';
import {
  initializeFirstYearTurn,
  selectCurrentEventChoice,
  triggerPrimaryActionButton
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
  Math.random = () => 0.5;
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

test('full opening-life regression: create, initialize, resolve events, unlock actions, and restore save', () => {
  const state = createNewCharacter('class_3', 'loc_bangkok', 'male', 'ผู้เล่น Regression');
  state.stats.health = 90;
  state.stats.happiness = 90;
  state.stats.intelligence = 80;
  state.stats.connections = 80;

  const initialized = initializeFirstYearTurn(state);

  assert.equal(initialized.success, true);
  assert.ok(initialized.eventsCount > 0);
  assert.equal(state.turn.phase, 'EVENT_QUEUE');
  assert.equal(hasSavedGame(), true);

  let resolvedEvents = 0;
  let safetyCounter = 0;

  while (state.turn.phase === 'EVENT_QUEUE' && state.profile.isAlive) {
    safetyCounter += 1;
    assert.ok(safetyCounter <= 10, 'event queue should finish within the safety limit');

    const currentEvent = getCurrentPendingEvent(state);
    assert.ok(currentEvent, 'the active queue position should have an event');

    const availableChoice = currentEvent.choices.find(
      (choice) => !choice.isLocked && choice.choice_id !== '__system_no_available_choice__'
    );
    const fallbackChoice = currentEvent.choices.find(
      (choice) => choice.choice_id === '__system_no_available_choice__'
    );
    const selectedChoice = availableChoice || fallbackChoice;

    assert.ok(selectedChoice, 'each event should expose an available choice or neutral fallback');

    const choiceResult = selectCurrentEventChoice(selectedChoice.choice_id, state);
    assert.equal(choiceResult.success, true);
    resolvedEvents += 1;

    const advanceResult = triggerPrimaryActionButton(state);
    assert.ok(advanceResult.completedQueue || advanceResult.nextEvent, 'primary action should advance the event queue');
  }

  assert.ok(resolvedEvents > 0);
  assert.equal(state.profile.isAlive, true);
  assert.equal(state.turn.phase, 'FREE_ACTION');
  assert.equal(state.turn.areTabsLocked, false);
  assert.deepEqual(state.turn.pendingEvents, []);
  assert.equal(state.turn.awaitingEventAdvance, false);

  const savedProfile = structuredClone(state.profile);
  const savedStats = structuredClone(state.stats);
  const savedLog = structuredClone(state.turn.lifeFeedLog);

  assert.equal(storage.has(SAVE_STORAGE_KEY), true);
  setState(null);
  const restored = loadGame();

  assert.ok(restored);
  assert.equal(getState(), restored);
  assert.deepEqual(restored.profile, savedProfile);
  assert.deepEqual(restored.stats, savedStats);
  assert.deepEqual(restored.turn.lifeFeedLog, savedLog);
  assert.equal(restored.turn.phase, 'FREE_ACTION');
  assert.equal(restored.turn.areTabsLocked, false);
  assert.equal(restored.turn.freeActionPoints, state.turn.freeActionPoints);
});
