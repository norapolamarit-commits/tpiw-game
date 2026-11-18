import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import { createEmptyGameState } from '../js/core/state.js';
import {
  breakUpWithPartner,
  changeChildUpbringingPolicy,
  designateHeirChild,
  discoverPotentialPartners,
  getHeartsCountFromScore,
  performRelationshipAction,
  processAnnualSocialAndFamilyProgression,
  startTalkingToPartner
} from '../js/engine/social_engine.js';

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

function createSocialState(age = 25) {
  const state = createEmptyGameState();
  state.profile.age = age;
  state.profile.currentYearBE = 2593;
  state.profile.gender = 'male';
  state.profile.firstName = 'ทดสอบ';
  state.profile.lastName = 'ใจดี';
  state.profile.spawnClassId = 'class_3';
  state.profile.currentClassId = 'class_3';
  state.finance.cash = 500_000;
  state.finance.piggyBank = 0;
  state.finance.investments = {};
  state.finance.ownedAssets = [];
  state.relationships.npcs = [];
  state.relationships.partner = null;
  state.relationships.children = [];
  state.relationships.designatedHeirId = null;
  state.turn.freeActionPoints = 3;
  state.turn.lifeFeedLog = [];
  return state;
}

function makePartner(overrides = {}) {
  return {
    id: 'partner_test',
    archetypeId: 'partner_highschool_sweetheart',
    name: 'คนรักทดสอบ',
    shortName: 'ทดสอบ',
    roleTitle: 'คนรัก',
    gender: 'female',
    age: 25,
    relationship: 100,
    status: 'dating',
    dowryCostCash: 50_000,
    netAnnualCashContribution: 80_000,
    financialTraitId: null,
    metAtAge: 20,
    ...overrides
  };
}

test('maps relationship scores to the expected heart count at boundaries', () => {
  assert.equal(getHeartsCountFromScore(-10), 0);
  assert.equal(getHeartsCountFromScore(19), 0);
  assert.equal(getHeartsCountFromScore(20), 1);
  assert.equal(getHeartsCountFromScore(99), 4);
  assert.equal(getHeartsCountFromScore(100), 5);
});

test('discovers age-eligible partner candidates and blocks discovery for underage, monkhood, or an existing partner', () => {
  const state = createSocialState(14);
  const tooYoung = discoverPotentialPartners(state);
  assert.equal(tooYoung.success, false);
  assert.equal(tooYoung.candidates.length, 0);

  state.profile.age = 20;
  state.flags.push('flag_monkhood_active');
  const monkhood = discoverPotentialPartners(state);
  assert.equal(monkhood.success, false);
  assert.match(monkhood.message, /สมณเพศ/);

  state.flags = [];
  const discovered = discoverPotentialPartners(state);
  assert.equal(discovered.success, true);
  assert.ok(discovered.candidates.length > 0);
  assert.ok(discovered.candidates.length <= 3);
  assert.equal(new Set(discovered.candidates.map((candidate) => candidate.archetypeId)).size, discovered.candidates.length);
  assert.equal(state.relationships.lastPartnerCandidates.length, discovered.candidates.length);

  state.relationships.partner = makePartner();
  const alreadyPartnered = discoverPotentialPartners(state);
  assert.equal(alreadyPartnered.success, false);
  assert.equal(alreadyPartnered.candidates.length, 0);
});

test('starts a valid talking-stage relationship and rejects invalid or duplicate candidates', () => {
  const state = createSocialState(20);
  const invalid = startTalkingToPartner(state, { name: 'ไม่มี archetype' });
  assert.equal(invalid.success, false);
  assert.equal(state.relationships.partner, null);

  const candidate = {
    candidateId: 'candidate_1',
    archetypeId: 'partner_highschool_sweetheart',
    name: 'พลอย',
    shortName: 'พลอย',
    gender: 'female',
    age: 20,
    dowryCostCash: 50_000
  };
  const started = startTalkingToPartner(state, candidate);
  assert.equal(started.success, true);
  assert.equal(state.relationships.partner.status, 'crush');
  assert.equal(state.relationships.partner.relationship, 25);

  const duplicate = startTalkingToPartner(state, candidate);
  assert.equal(duplicate.success, false);
  assert.equal(state.relationships.partner.name, 'พลอย');
});

test('every player identity can meet varied candidates without creating a second partner', () => {
  for (const identity of ['woman', 'man', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid']) {
    const state = createSocialState(25);
    state.profile.genderIdentity = identity;
    const candidates = discoverPotentialPartners(state).candidates;
    assert.ok(candidates.length > 0);
    assert.ok(candidates.some((candidate) => candidate.openToDating));
    assert.ok(candidates.every((candidate) => candidate.genderIdentity && !candidate.descriptionTh.includes('ค่าสินสอด')));
    const chosen = candidates.find((candidate) => candidate.openToDating);
    assert.equal(startTalkingToPartner(state, chosen.candidateId).success, true);
    assert.equal(startTalkingToPartner(state, chosen.candidateId).success, false);
  }
});

test('breaks up a non-married partner and clears relationship flags', () => {
  const state = createSocialState(21);
  state.relationships.partner = makePartner({ relationship: 75 });
  state.flags.push('flag_in_relationship', 'flag_partner_hearts_5');
  const happinessBefore = state.stats.happiness;

  const result = breakUpWithPartner(state);

  assert.equal(result.success, true);
  assert.equal(state.relationships.partner, null);
  assert.ok(!state.flags.includes('flag_in_relationship'));
  assert.ok(!state.flags.includes('flag_partner_hearts_5'));
  assert.equal(state.stats.happiness, happinessBefore - 6);
});

test('prevents informal breakup after marriage registration', () => {
  const state = createSocialState(25);
  state.relationships.partner = makePartner({ status: 'married' });
  state.flags.push('flag_married_registered');

  const result = breakUpWithPartner(state);

  assert.equal(result.success, false);
  assert.ok(state.relationships.partner);
  assert.ok(state.flags.includes('flag_married_registered'));
});

test('relationship activities require a living target and available action points', () => {
  const state = createSocialState(25);
  const noParent = performRelationshipAction(state, 'rel_act_talk_parents');
  assert.equal(noParent.success, false);
  assert.equal(state.turn.freeActionPoints, 3);

  state.relationships.npcs.push({
    id: 'father_1',
    archetypeId: 'npc_arch_father',
    name: 'คุณพ่อ',
    shortName: 'พ่อ',
    relationship: 80,
    isAlive: true
  });
  state.turn.freeActionPoints = 0;
  const noActionPoints = performRelationshipAction(state, 'rel_act_talk_parents');
  assert.equal(noActionPoints.success, false);
  assert.match(noActionPoints.message, /แต้มเวลาว่าง/);
  assert.equal(state.relationships.npcs[0].relationship, 80);
});

test('parent relationship activity increases living parents, applies stats, and consumes one action point', () => {
  const state = createSocialState(25);
  state.relationships.npcs.push(
    { id: 'father_1', archetypeId: 'npc_arch_father', name: 'พ่อ', shortName: 'พ่อ', relationship: 80, isAlive: true },
    { id: 'mother_1', archetypeId: 'npc_arch_mother', name: 'แม่', shortName: 'แม่', relationship: 85, isAlive: true }
  );
  const happinessBefore = state.stats.happiness;
  const meritBefore = state.stats.merit;

  const result = performRelationshipAction(state, 'rel_act_talk_parents');

  assert.equal(result.success, true);
  assert.equal(state.relationships.npcs[0].relationship, 85);
  assert.equal(state.relationships.npcs[1].relationship, 90);
  assert.equal(state.turn.freeActionPoints, 2);
  assert.equal(state.stats.happiness, happinessBefore + 2);
  assert.equal(state.stats.merit, meritBefore + 1);
  assert.ok(state.relationships.usedRelActionsThisYear.includes('rel_act_talk_parents'));
});

test('friendship activities grow one chosen friendship with a per-person yearly cooldown', () => {
  const state = createSocialState(25);
  state.relationships.npcs.push(
    { id: 'friend_1', archetypeId: 'npc_arch_primary_friend', name: 'เพื่อนหนึ่ง', relationship: 40, isAlive: true },
    { id: 'friend_2', archetypeId: 'npc_arch_primary_friend', name: 'เพื่อนสอง', relationship: 50, isAlive: true }
  );

  assert.equal(performRelationshipAction(state, 'rel_act_talk_friend').success, false);
  assert.equal(performRelationshipAction(state, 'rel_act_talk_friend', 'missing').success, false);
  const first = performRelationshipAction(state, 'rel_act_talk_friend', 'friend_1');
  assert.equal(first.success, true);
  assert.equal(state.relationships.npcs[0].relationship, 46);
  assert.equal(state.relationships.npcs[1].relationship, 50);
  assert.equal(performRelationshipAction(state, 'rel_act_talk_friend', 'friend_1').success, false);
  assert.equal(performRelationshipAction(state, 'rel_act_talk_friend', 'friend_2').success, true);
  assert.equal(state.relationships.npcs[1].relationship, 56);
});

test('annual social progression resets ordinary relationship-action cooldowns', () => {
  const state = createSocialState(25);
  state.relationships.npcs.push({
    id: 'friend_1',
    archetypeId: 'npc_arch_primary_friend',
    name: 'เพื่อน',
    shortName: 'เพื่อน',
    relationship: 50,
    isAlive: true
  });
  const first = performRelationshipAction(state, 'rel_act_mookata_party');
  assert.equal(first.success, true);
  const repeated = performRelationshipAction(state, 'rel_act_mookata_party');
  assert.equal(repeated.success, false);
  assert.match(repeated.message, /ทำกิจกรรมนี้ไปแล้ว/);

  processAnnualSocialAndFamilyProgression(state);
  assert.deepEqual(state.relationships.usedRelActionsThisYear, []);
  const nextYear = performRelationshipAction(state, 'rel_act_mookata_party');
  assert.equal(nextYear.success, true);
});

test('asking a qualified partner to become a couple advances status and grants relationship flags', () => {
  const state = createSocialState(20);
  state.relationships.partner = makePartner({ relationship: 60, status: 'crush' });

  const result = performRelationshipAction(state, 'rel_act_ask_to_be_couple');

  assert.equal(result.success, true);
  assert.equal(state.relationships.partner.status, 'dating');
  assert.equal(state.relationships.partner.relationship, 70);
  assert.ok(state.flags.includes('flag_in_relationship'));
  assert.equal(state.turn.freeActionPoints, 3);
});

test('marriage requires the ring, legal-age flag, full relationship, and sufficient dowry; then applies spouse traits', () => {
  const state = createSocialState(25);
  state.relationships.partner = makePartner({ relationship: 100, status: 'dating', dowryCostCash: 50_000 });
  state.flags.push('flag_sui_juris_20', 'flag_has_wedding_ring', 'flag_partner_hearts_5');
  assert.equal(performRelationshipAction(state, 'rel_act_propose_marriage').success, false, 'must propose first');
  const proposed = performRelationshipAction(state, 'rel_act_propose_engagement');
  assert.equal(proposed.success, true);
  assert.equal(state.relationships.partner.engaged, true);
  state.finance.cash = 10_000;

  const insufficientFunds = performRelationshipAction(state, 'rel_act_propose_marriage');
  assert.equal(insufficientFunds.success, false);
  assert.match(insufficientFunds.message, /เงินไม่พอ/);
  assert.equal(state.relationships.partner.status, 'dating');

  state.finance.cash = 200_000;
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    const married = performRelationshipAction(state, 'rel_act_propose_marriage');
    assert.equal(married.success, true);
    assert.equal(married.dowryPaid, 50_000);
    assert.equal(state.finance.cash, 150_000);
    assert.equal(state.relationships.partner.status, 'married');
    assert.equal(state.relationships.partner.financialTraitId, 'trait_spouse_saver');
    assert.ok(state.flags.includes('flag_married_registered'));
    assert.ok(state.flags.includes('flag_in_relationship'));
  } finally {
    Math.random = originalRandom;
  }
});

test('planning a child requires marriage readiness and creates the first child with a default upbringing policy', () => {
  const state = createSocialState(30);
  state.relationships.partner = makePartner({ status: 'married', relationship: 85 });
  state.flags.push('flag_married_registered', 'flag_ready_for_kids');
  const cashBefore = state.finance.cash;

  const result = performRelationshipAction(state, 'rel_act_plan_have_baby');

  assert.equal(result.success, true);
  assert.equal(state.relationships.children.length, 1);
  const child = state.relationships.children[0];
  assert.equal(child.age, 0);
  assert.equal(child.relationship, 85);
  assert.equal(child.currentPolicyId, 'pol_s1_public');
  assert.equal(state.relationships.designatedHeirId, child.id);
  assert.equal(state.finance.cash, cashBefore - 15_000);
  assert.ok(state.flags.includes('flag_has_child'));
});

test('child upbringing policy rejects unknown or wrong-stage options and accepts a valid current-stage option', () => {
  const state = createSocialState(35);
  state.relationships.children.push({
    id: 'child_1',
    name: 'น้องทดสอบ',
    shortName: 'ทดสอบ',
    age: 7,
    relationship: 70,
    successPoints: 2,
    currentPolicyId: 'pol_s1_public',
    outcomeId: null
  });

  const wrongStage = changeChildUpbringingPolicy(state, 'child_1', 'pol_s1_public');
  assert.equal(wrongStage.success, false);

  const valid = changeChildUpbringingPolicy(state, 'child_1', 'pol_s2_private_cram');
  assert.equal(valid.success, true);
  assert.equal(state.relationships.children[0].currentPolicyId, 'pol_s2_private_cram');

  const missing = changeChildUpbringingPolicy(state, 'missing_child', 'pol_s2_public');
  assert.equal(missing.success, false);
});

test('designates an existing child as heir and rejects an unknown child id', () => {
  const state = createSocialState(40);
  state.relationships.children.push({ id: 'child_1', name: 'น้องหนึ่ง' });

  const missing = designateHeirChild(state, 'missing_child');
  assert.equal(missing.success, false);
  assert.equal(state.relationships.designatedHeirId, null);

  const selected = designateHeirChild(state, 'child_1');
  assert.equal(selected.success, true);
  assert.equal(state.relationships.designatedHeirId, 'child_1');
});

test('annual family progression ages a spouse and child, applies spouse passives, and advances the child policy stage', () => {
  const state = createSocialState(36);
  state.relationships.partner = makePartner({
    status: 'married',
    age: 35,
    financialTraitId: 'trait_spouse_saver',
    relationship: 90
  });
  state.relationships.children.push({
    id: 'child_1',
    name: 'น้องหนึ่ง',
    shortName: 'หนึ่ง',
    age: 5,
    gender: 'male',
    relationship: 70,
    successPoints: 5,
    currentPolicyId: 'pol_s1_public',
    outcomeId: null
  });
  const happinessBefore = state.stats.happiness;

  processAnnualSocialAndFamilyProgression(state);

  assert.equal(state.relationships.partner.age, 36);
  assert.equal(state.relationships.children[0].age, 6);
  assert.equal(state.relationships.children[0].currentPolicyId, 'pol_s2_public');
  assert.equal(state.relationships.children[0].successPoints, 6);
  assert.equal(state.stats.happiness, happinessBefore + 1);
});

test('annual family progression evaluates an adult child once and reports the configured legacy outcome', () => {
  const state = createSocialState(50);
  state.relationships.children.push({
    id: 'child_legacy',
    name: 'น้องรุ่นต่อไป',
    shortName: 'รุ่นต่อไป',
    age: 21,
    gender: 'female',
    relationship: 80,
    successPoints: 80,
    currentPolicyId: 'pol_s4_university',
    outcomeId: null
  });
  const happinessBefore = state.stats.happiness;

  const report = processAnnualSocialAndFamilyProgression(state);

  assert.equal(state.relationships.children[0].age, 22);
  assert.equal(state.relationships.children[0].outcomeId, 'child_tier_s_elite');
  assert.equal(report.graduatedChildren.length, 1);
  assert.equal(report.graduatedChildren[0].childId, 'child_legacy');
  assert.equal(state.stats.happiness, happinessBefore + 4);

  const secondYear = processAnnualSocialAndFamilyProgression(state);
  assert.equal(secondYear.graduatedChildren.length, 0);
  assert.equal(state.relationships.children[0].age, 23);
});
