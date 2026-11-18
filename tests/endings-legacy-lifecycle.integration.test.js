import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import {
  META_STORAGE_KEY,
  createEmptyGameState,
  getState,
  setState,
  hasSavedGame
} from '../js/core/state.js';
import {
  determineDeathCause,
  evaluateEndingArchetype,
  finalizeLifeAndCalculateKarmicBalance,
  finishAndReturnToLobby,
  startNextGenerationAsChild,
  writeWillAndTestament
} from '../js/engine/ending_engine.js';

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

function createEndingState(age = 70) {
  const state = createEmptyGameState();
  state.meta.runId = 'ending-test-run';
  state.meta.generationNumber = 1;
  state.profile.name = 'ทดสอบ ใจดี';
  state.profile.firstName = 'ทดสอบ';
  state.profile.lastName = 'ใจดี';
  state.profile.nickname = 'ทดสอบ';
  state.profile.titlePrefix = 'นาย';
  state.profile.gender = 'male';
  state.profile.age = age;
  state.profile.currentYearBE = 2600;
  state.profile.birthYearBE = 2600 - age;
  state.profile.spawnClassId = 'class_3';
  state.profile.currentClassId = 'class_3';
  state.profile.currentLocationId = 'loc_bangkok';
  state.profile.isAlive = true;
  state.stats = {
    health: 70,
    happiness: 75,
    intelligence: 60,
    connections: 50,
    merit: 20,
    appearance: 55
  };
  state.finance.cash = 2_500_000;
  state.finance.piggyBank = 0;
  state.finance.investments = {};
  state.finance.ownedAssets = [];
  state.finance.activeLoans = [];
  state.finance.installments = [];
  state.relationships.npcs = [];
  state.relationships.partner = null;
  state.relationships.children = [];
  state.relationships.designatedHeirId = null;
  state.flags = [];
  state.statuses = [];
  state.talentTags = [];
  state.innateTraits = [];
  state.turn.phase = 'FREE_ACTION';
  state.turn.endingFinalized = false;
  state.turn.finalEndingReport = null;
  state.turn.lifeFeedLog = [];
  return state;
}

function makeChild(overrides = {}) {
  return {
    id: 'child_1',
    name: 'น้องทดสอบ (นาย ทดสอบ ใจดี)',
    shortName: 'ทดสอบ',
    firstName: 'ทดสอบ',
    lastName: 'ใจดี',
    nickname: 'ทดสอบ',
    gender: 'male',
    age: 20,
    relationship: 80,
    successPoints: 55,
    currentPolicyId: 'pol_s4_public',
    outcomeId: 'child_tier_a_professional',
    ...overrides
  };
}

test('does not assign a death cause while the player is alive and below the age limit', () => {
  const state = createEndingState(65);
  assert.equal(determineDeathCause(state), null);
});

test('selects the configured specific death cause and formats the obituary', () => {
  const state = createEndingState(35);
  state.profile.isAlive = false;
  state.stats.health = 0;
  state.turn.lastEventCategory = 'road_accident';

  const result = determineDeathCause(state);

  assert.equal(result.deathId, 'death_road_accident');
  assert.equal(result.isPrematureDeath, true);
  assert.match(result.obituaryTextTh, /ทดสอบ ใจดี/);
  assert.match(result.obituaryTextTh, /35/);
});

test('uses the centenarian death cause at age 100 and above', () => {
  const state = createEndingState(100);
  state.profile.isAlive = false;

  const result = determineDeathCause(state);

  assert.equal(result.deathId, 'death_natural_centenarian');
});

test('ranks the centenarian legend above other eligible ending tiers', () => {
  const state = createEndingState(100);
  state.finance.cash = 10_000_000;
  state.stats.merit = 250;

  const ending = evaluateEndingArchetype(state);

  assert.equal(ending.endingId, 'end_01_centenarian_legend');
  assert.equal(ending.rank, 'SSR');
  assert.ok(ending.bonusMeritReward > 0);
});

test('uses the debt ending when net worth is negative or a credit-risk flag is active', () => {
  const state = createEndingState(55);
  state.finance.cash = 1000;
  state.finance.activeLoans = [{ principalRemaining: 5000 }];

  assert.equal(evaluateEndingArchetype(state).endingId, 'end_08_drowned_in_debt');

  state.finance.cash = 100_000;
  state.finance.activeLoans = [];
  state.flags.push('flag_credit_blacklist');
  assert.equal(evaluateEndingArchetype(state).endingId, 'end_08_drowned_in_debt');
});

test('writes a will only when eligible, charges the lawyer fee once, and validates the heir', () => {
  const state = createEndingState(59);
  state.relationships.children.push(makeChild());

  const tooYoung = writeWillAndTestament(state);
  assert.equal(tooYoung.success, false);
  assert.equal(state.finance.cash, 2_500_000);

  state.flags.push('flag_will_unlocked');
  const invalidHeir = writeWillAndTestament(state, { designatedHeirId: 'missing_child' });
  assert.equal(invalidHeir.success, false);
  assert.equal(state.finance.cash, 2_500_000);

  const written = writeWillAndTestament(state, { designatedHeirId: 'child_1' });
  assert.equal(written.success, true);
  assert.equal(written.feePaid, 2000);
  assert.equal(state.finance.cash, 2_498_000);
  assert.equal(state.relationships.designatedHeirId, 'child_1');
  assert.ok(state.flags.includes('flag_has_written_will'));

  const amended = writeWillAndTestament(state, { designatedHeirId: 'child_1' });
  assert.equal(amended.success, true);
  assert.equal(amended.feePaid, 0);
  assert.equal(state.finance.cash, 2_498_000);
});

test('waives the will registration fee for a player with the lawyer license', () => {
  const state = createEndingState(60);
  state.flags.push('flag_lawyer_license');

  const result = writeWillAndTestament(state);

  assert.equal(result.success, true);
  assert.equal(result.feePaid, 0);
  assert.equal(state.finance.cash, 2_500_000);
});

test('finalizes a life, records merit conversion and hall-of-fame data, and is idempotent', () => {
  const state = createEndingState(70);
  state.profile.isAlive = false;
  state.flags.push('flag_filial_child', 'flag_philanthropist_donor');
  state.relationships.children.push(makeChild());
  state.relationships.designatedHeirId = 'child_1';

  const report = finalizeLifeAndCalculateKarmicBalance(state);
  const metaAfterFirst = JSON.parse(storage.get(META_STORAGE_KEY));

  assert.equal(state.profile.isAlive, false);
  assert.equal(state.turn.phase, 'ENDED');
  assert.equal(state.turn.areTabsLocked, true);
  assert.equal(state.turn.endingFinalized, true);
  assert.equal(report.summaryProfile.finalAge, 70);
  assert.equal(report.summaryProfile.childrenCount, 1);
  assert.equal(report.inheritanceSummary.canContinueAsChild, true);
  assert.equal(report.inheritanceSummary.hasValidWill, false);
  assert.equal(report.inheritanceSummary.taxRatePercent, 10);
  assert.equal(metaAfterFirst.totalLivesPlayed, 1);
  assert.equal(metaAfterFirst.hallOfFame.length, 1);
  assert.ok(metaAfterFirst.karmaBankMerit > 0);

  const secondReport = finalizeLifeAndCalculateKarmicBalance(state);
  const metaAfterSecond = JSON.parse(storage.get(META_STORAGE_KEY));

  assert.strictEqual(secondReport, report);
  assert.equal(metaAfterSecond.totalLivesPlayed, 1);
  assert.equal(metaAfterSecond.karmaBankMerit, metaAfterFirst.karmaBankMerit);
  assert.equal(metaAfterSecond.hallOfFame.length, 1);
});

test('keeps the latest 20 lives in the hall of fame and records unlocked endings only once', () => {
  const state = createEndingState(70);
  const priorHall = Array.from({ length: 20 }, (_, i) => ({ runId: `old_${i}` }));
  storage.set(META_STORAGE_KEY, JSON.stringify({
    version: '1.0.0',
    karmaBankMerit: 5,
    totalLivesPlayed: 20,
    unlockedEndings: ['end_07_ordinary_survivor'],
    hallOfFame: priorHall
  }));

  finalizeLifeAndCalculateKarmicBalance(state);
  const meta = JSON.parse(storage.get(META_STORAGE_KEY));

  assert.equal(meta.totalLivesPlayed, 21);
  assert.equal(meta.hallOfFame.length, 20);
  assert.equal(meta.hallOfFame[0].runId, 'ending-test-run');
  assert.equal(meta.unlockedEndings.filter(id => id === 'end_07_ordinary_survivor').length, 1);
});

test('starts the selected heir with the correct post-tax inheritance and generation identity', () => {
  const previous = createEndingState(80);
  previous.profile.name = 'คุณพ่อ ใจดี';
  previous.profile.lastName = 'ใจดี';
  previous.profile.currentYearBE = 2600;
  previous.finance.cash = 100_000;
  previous.relationships.children.push(makeChild({
    id: 'heir_a',
    age: 20,
    firstName: 'ลูก',
    lastName: 'ใจดี',
    nickname: 'ต้น',
    shortName: 'ต้น',
    outcomeId: 'child_tier_a_professional'
  }));
  previous.relationships.designatedHeirId = 'heir_a';
  previous.turn.endingFinalized = true;
  previous.turn.phase = 'ENDED';

  const result = startNextGenerationAsChild(previous, 'heir_a');

  assert.equal(result.success, true);
  assert.equal(result.generationNumber, 2);
  assert.equal(result.taxDeducted, 10_000);
  assert.equal(result.inheritedCash, 90_000);
  assert.equal(result.newState.profile.age, 18);
  assert.equal(result.newState.profile.firstName, 'ลูก');
  assert.equal(result.newState.profile.lastName, 'ใจดี');
  assert.equal(result.newState.profile.isAlive, true);
  assert.equal(result.newState.finance.cash, 90_000);
  assert.equal(result.newState.meta.generationNumber, 2);
  assert.equal(result.newState.turn.phase, 'FREE_ACTION');
  assert.ok(result.newState.flags.includes('flag_edu_high_school_grad'));
  assert.ok(result.newState.relationships.npcs.some(npc => npc.id === 'npc_late_player_parent'));
});

test('waives inheritance tax when a valid will exists and gives the designated heir the configured 70 percent share', () => {
  const previous = createEndingState(80);
  previous.finance.cash = 1_000_000;
  previous.flags.push('flag_has_written_will');
  previous.relationships.children.push(
    makeChild({ id: 'heir_a', firstName: 'คนแรก', outcomeId: 'child_tier_a_professional' }),
    makeChild({ id: 'heir_b', firstName: 'คนที่สอง', outcomeId: 'child_tier_b_average' })
  );
  previous.relationships.designatedHeirId = 'heir_a';
  previous.turn.endingFinalized = true;

  const result = startNextGenerationAsChild(previous, 'heir_a');

  assert.equal(result.taxDeducted, 0);
  assert.equal(result.inheritedCash, 700_000);
  assert.equal(result.newState.finance.cash, 700_000);
});

test('rejects legacy continuation when there are no children', () => {
  const previous = createEndingState(80);
  previous.turn.endingFinalized = true;

  const result = startNextGenerationAsChild(previous);

  assert.equal(result.success, false);
  assert.match(result.message, /ไม่มีทายาท/);
});

test('returns to the lobby by clearing the active save while preserving the accumulated meta record', () => {
  const state = createEndingState(70);
  state.turn.endingFinalized = true;
  state.turn.finalEndingReport = { summaryProfile: { finalAge: 70 } };
  storage.set('thai_life_sim_save_v1', JSON.stringify(state));
  storage.set(META_STORAGE_KEY, JSON.stringify({
    version: '1.0.0',
    karmaBankMerit: 123,
    totalLivesPlayed: 4,
    unlockedEndings: ['end_07_ordinary_survivor'],
    hallOfFame: []
  }));

  const result = finishAndReturnToLobby(state);

  assert.equal(result.success, true);
  assert.equal(result.karmaBankMerit, 123);
  assert.equal(result.totalLivesPlayed, 4);
  assert.equal(hasSavedGame(), false);
  assert.equal(storage.has(META_STORAGE_KEY), true);
});
