import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import {
  SAVE_STORAGE_KEY,
  createEmptyGameState
} from '../js/core/state.js';
import {
  acknowledgeAnnualSlipAndStartEvents,
  startNextYearTurn
} from '../js/engine/turn_manager.js';

const originalLocalStorage = globalThis.localStorage;
const originalDbRaw = db.raw;
const originalDbIsLoaded = db.isLoaded;
const originalIndexEntries = Object.fromEntries(
  Object.entries(db.indexes).map(([key, map]) => [key, new Map(map)])
);
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

  if (originalLocalStorage === undefined) {
    delete globalThis.localStorage;
  } else {
    globalThis.localStorage = originalLocalStorage;
  }
});

function createPipelineState(age = 24) {
  const state = createEmptyGameState();

  state.profile.age = age;
  state.profile.currentYearBE = 2568 + age;
  state.profile.lifePhaseId = 'phase_4_young_adult';
  state.profile.currentClassId = 'class_3';
  state.profile.spawnClassId = 'class_3';
  state.profile.currentLocationId = 'loc_pipeline_test';
  state.profile.isAlive = true;

  state.stats = {
    health: 70,
    happiness: 65,
    intelligence: 60,
    connections: 55,
    merit: 50,
    appearance: 60
  };

  state.finance.cash = 10_000_000;
  state.finance.piggyBank = 0;
  state.finance.hasPiggyBankSmashed = true;
  state.finance.investments = {};
  state.finance.ownedAssets = [];
  state.finance.installments = [];
  state.finance.activeLoans = [];

  state.careerAndEdu.currentActivityId = null;
  state.careerAndEdu.conscriptionYearsLeft = 1;
  state.careerAndEdu.mainJobId = null;
  state.careerAndEdu.partTimeJobId = null;

  state.flags = ['flag_conscript_soldier_1yr', 'test_yearly_passive'];
  state.relationships.usedRelActionsThisYear = ['rel_action_used_last_year'];
  state.relationships.partner = {
    id: 'partner-pipeline-test',
    name: 'คู่ทดสอบ',
    age: 30,
    relationship: 80,
    status: 'dating',
    archetypeId: 'partner_arch_test'
  };

  state.turn.phase = 'FREE_ACTION';
  state.turn.areTabsLocked = false;
  state.turn.freeActionPoints = 0;
  state.turn.maxFreeActionPoints = 3;
  state.turn.pendingEvents = [];
  state.turn.currentEventIndex = 0;

  db.indexes.locations.set('loc_pipeline_test', {
    location_id: 'loc_pipeline_test',
    name_th: 'จังหวัดทดสอบ',
    cost_of_living_multiplier: 1,
    yearly_passive_effects: { health: 2 }
  });
  db.indexes.traitsAndFlags.set('test_yearly_passive', {
    id: 'test_yearly_passive',
    category_group: 'financial_and_legal_flags',
    yearly_stat_effects: { intelligence: 3 }
  });

  return state;
}

test('runs the annual pipeline and applies social, career, economy, passive, and event updates', () => {
  const state = createPipelineState(24);
  const startingCash = state.finance.cash;
  const startingYear = state.profile.currentYearBE;

  const result = startNextYearTurn(state);

  assert.equal(result.success, true);
  assert.equal(result.phase, 'YEAR_SUMMARY');
  assert.equal(result.age, 25);
  assert.equal(state.profile.age, 25);
  assert.equal(state.profile.currentYearBE, startingYear + 1);
  assert.equal(state.turn.phase, 'YEAR_SUMMARY');
  assert.equal(state.turn.areTabsLocked, true);

  // Step 1: age/year and free-action points are reset for the new year.
  assert.equal(state.turn.maxFreeActionPoints, 3);
  assert.equal(state.turn.freeActionPoints, 3);

  // Step 2: social action quota resets and partner ages by one year.
  assert.deepEqual(state.relationships.usedRelActionsThisYear, []);
  assert.equal(state.relationships.partner.age, 31);

  // Step 3: conscription reaches zero and the service flag is removed.
  assert.equal(result.careerEduReport.dischargedFromMilitary, true);
  assert.equal(state.careerAndEdu.conscriptionYearsLeft, 0);
  assert.equal(state.flags.includes('flag_conscript_soldier_1yr'), false);

  // Step 4: annual economy produces a slip and accounts for living expenses.
  assert.ok(result.annualSlip);
  assert.equal(state.finance.lastAnnualSlip, result.annualSlip);
  assert.ok(result.annualSlip.totalCashExpense > 0);
  assert.equal(result.annualSlip.startingCash, startingCash);
  assert.equal(result.annualSlip.endingCash, state.finance.cash);

  // Step 5: location and flag passives are applied before threshold checks.
  assert.equal(state.stats.health, 70, 'small positive health passives are retained as fractional progress');
  assert.equal(state.stats.intelligence, 61, 'positive intelligence passives use diminishing returns');

  // Step 7: the new year's event queue is generated and the annual summary is saved.
  assert.ok(Array.isArray(state.turn.pendingEvents));
  assert.ok(state.turn.pendingEvents.length >= 1);
  assert.equal(state.turn.currentEventIndex, 0);
  assert.equal(storage.has(SAVE_STORAGE_KEY), true);
});

test('ends the life at the configured maximum age without opening a new event queue', () => {
  const state = createPipelineState(99);
  state.flags = [];
  state.relationships.partner = null;
  state.careerAndEdu.conscriptionYearsLeft = 0;

  const result = startNextYearTurn(state);

  assert.equal(result.success, true);
  assert.equal(result.phase, 'ENDED');
  assert.equal(state.profile.age, 100);
  assert.equal(state.profile.isAlive, false);
  assert.equal(state.turn.phase, 'ENDED');
  assert.equal(state.turn.areTabsLocked, true);
  assert.deepEqual(state.turn.pendingEvents, []);
  assert.equal(state.turn.endingFinalized, true);
  assert.ok(result.endingReport);
});

test('routes a cash deficit created by annual expenses into emergency debt after acknowledging the annual slip', () => {
  const state = createPipelineState(24);
  state.finance.cash = 1;
  state.flags = [];
  state.relationships.partner = null;
  state.careerAndEdu.conscriptionYearsLeft = 0;

  const annualResult = startNextYearTurn(state);

  assert.equal(annualResult.success, true);
  assert.equal(annualResult.phase, 'YEAR_SUMMARY');
  assert.ok(state.finance.cash < 0);
  assert.equal(state.turn.phase, 'YEAR_SUMMARY');
  assert.equal(state.turn.pendingEmergencyDebt.resolved, false);

  const acknowledgement = acknowledgeAnnualSlipAndStartEvents(state);

  assert.equal(acknowledgement.success, true);
  assert.equal(acknowledgement.phase, 'EMERGENCY_DEBT');
  assert.equal(state.turn.phase, 'EMERGENCY_DEBT');
  assert.equal(state.turn.areTabsLocked, true);
  assert.equal(state.profile.age, 25);
});

test('blocks the annual pipeline before aging when an existing cash deficit cannot be resolved', () => {
  const state = createPipelineState(24);
  state.finance.cash = -1000;
  state.finance.investments = {};
  state.relationships.npcs = [];
  state.flags = [];

  const result = startNextYearTurn(state);

  assert.equal(result.success, false);
  assert.equal(result.phase, 'EMERGENCY_DEBT');
  assert.equal(state.profile.age, 24);
  assert.equal(state.turn.phase, 'EMERGENCY_DEBT');
  assert.equal(state.turn.areTabsLocked, true);
});
