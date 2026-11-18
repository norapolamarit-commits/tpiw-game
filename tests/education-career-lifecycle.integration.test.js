import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import { createEmptyGameState, recalculateNetWorth } from '../js/core/state.js';
import {
  applyForJob,
  dropOutHigherEducation,
  enrollHigherEducation,
  getAvailableLicenses,
  getCategorizedJobsForUI,
  processAnnualCareerAndStudyProgression,
  requestPromotionOrRaise,
  takeLicenseExam,
  workOvertimeAction
} from '../js/engine/career_edu_engine.js';

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

function createCareerState(age = 25) {
  const state = createEmptyGameState();
  state.profile.age = age;
  state.profile.currentYearBE = 2593;
  state.profile.currentLocationId = 'loc_bangkok';
  state.profile.spawnClassId = 'class_3';
  state.profile.currentClassId = 'class_3';
  state.finance.cash = 500_000;
  state.finance.piggyBank = 0;
  state.finance.investments = {};
  state.finance.ownedAssets = [];
  state.finance.activeLoans = [];
  state.finance.installments = [];
  state.careerAndEdu.currentActivityId = null;
  state.careerAndEdu.activeStudy = null;
  state.careerAndEdu.completedDegrees = [];
  state.careerAndEdu.mainJobId = null;
  state.careerAndEdu.partTimeJobId = null;
  state.careerAndEdu.yearsInMainJob = 0;
  state.careerAndEdu.salaryMultiplier = 1;
  state.careerAndEdu.otUsedThisYear = 0;
  state.careerAndEdu.requestedRaiseThisYear = false;
  state.careerAndEdu.licenses = [];
  state.careerAndEdu.conscriptionYearsLeft = 0;
  state.stats = {
    health: 80,
    happiness: 70,
    intelligence: 70,
    connections: 60,
    merit: 0,
    appearance: 50
  };
  state.flags = [];
  state.statuses = [];
  state.talentTags = [];
  state.innateTraits = [];
  state.turn.freeActionPoints = 3;
  state.turn.lifeFeedLog = [];
  return state;
}

test('rejects higher-education enrollment when age, entry requirements, or military status do not qualify', () => {
  const state = createCareerState(17);
  state.flags.push('flag_track_arts');

  const tooYoung = enrollHigherEducation(state, 'edu_deg_business');
  assert.equal(tooYoung.success, false);
  assert.match(tooYoung.message, /อายุ/);
  assert.equal(state.careerAndEdu.activeStudy, null);

  state.profile.age = 20;
  state.stats.intelligence = 20;
  const missingStats = enrollHigherEducation(state, 'edu_deg_business');
  assert.equal(missingStats.success, false);
  assert.match(missingStats.message, /สมอง/);

  state.stats.intelligence = 70;
  state.careerAndEdu.conscriptionYearsLeft = 1;
  const conscripted = enrollHigherEducation(state, 'edu_deg_business');
  assert.equal(conscripted.success, false);
  assert.match(conscripted.message, /ทหาร/);
  assert.equal(state.careerAndEdu.activeStudy, null);
});

test('enrolls in a qualified degree and moves a study-compatible current job into the part-time slot', () => {
  const state = createCareerState(20);
  state.flags.push('flag_track_arts', 'flag_regular_income');
  state.careerAndEdu.mainJobId = 'job_pt_convenience_store';
  state.careerAndEdu.yearsInMainJob = 2;
  const cashBefore = state.finance.cash;

  const result = enrollHigherEducation(state, 'edu_deg_business');

  assert.equal(result.success, true);
  assert.equal(state.careerAndEdu.activeStudy.programId, 'edu_deg_business');
  assert.equal(state.careerAndEdu.activeStudy.durationYears, 4);
  assert.equal(state.careerAndEdu.activeStudy.annualTuition, 30_000);
  assert.equal(state.careerAndEdu.mainJobId, null);
  assert.equal(state.careerAndEdu.partTimeJobId, 'job_pt_convenience_store');
  assert.equal(state.finance.cash, cashBefore);
});

test('enforces student-loan eligibility and credit restrictions before enrolling', () => {
  const state = createCareerState(20);
  state.flags.push('flag_track_arts');
  const cashBefore = state.finance.cash;

  const noEligibility = enrollHigherEducation(state, 'edu_deg_business', true);
  assert.equal(noEligibility.success, false);
  assert.match(noEligibility.message, /สิทธิ์กู้/);
  assert.equal(state.careerAndEdu.activeStudy, null);

  state.flags.push('flag_student_loan_eligible', 'flag_credit_blacklist');
  const blacklisted = enrollHigherEducation(state, 'edu_deg_business', true);
  assert.equal(blacklisted.success, false);
  assert.match(blacklisted.message, /แบล็กลิสต์/);
  assert.equal(state.careerAndEdu.activeStudy, null);

  state.flags = state.flags.filter((flag) => flag !== 'flag_credit_blacklist');
  const enrolled = enrollHigherEducation(state, 'edu_deg_business', true);
  assert.equal(enrolled.success, true);
  assert.equal(state.careerAndEdu.activeStudy.useStudentLoan, true);
  assert.ok(state.flags.includes('flag_student_loan_debt'));
  assert.equal(state.finance.cash, cashBefore);
});

test('graduates on the configured final study year, grants degree flags, and promotes the remaining part-time job', () => {
  const state = createCareerState(22);
  state.careerAndEdu.activeStudy = {
    programId: 'edu_deg_business',
    yearsCompleted: 3,
    durationYears: 4,
    annualTuition: 30_000,
    useStudentLoan: false
  };
  state.careerAndEdu.partTimeJobId = 'job_pt_convenience_store';
  const intelligenceBefore = state.stats.intelligence;

  const report = processAnnualCareerAndStudyProgression(state);

  assert.equal(report.graduatedProgramId, 'edu_deg_business');
  assert.equal(state.careerAndEdu.activeStudy, null);
  assert.ok(state.careerAndEdu.completedDegrees.includes('edu_deg_business'));
  assert.ok(state.flags.includes('flag_bachelor_degree'));
  assert.ok(state.flags.includes('flag_deg_business'));
  assert.ok(state.flags.includes('flag_financial_literacy'));
  assert.equal(state.careerAndEdu.mainJobId, 'job_pt_convenience_store');
  assert.equal(state.careerAndEdu.partTimeJobId, null);
  assert.equal(state.careerAndEdu.yearsInMainJob, 1);
  assert.ok(state.stats.intelligence > intelligenceBefore);
});

test('drops out of higher education and promotes an existing part-time job to the main job slot', () => {
  const state = createCareerState(21);
  state.careerAndEdu.activeStudy = {
    programId: 'edu_deg_business',
    yearsCompleted: 2,
    durationYears: 4,
    annualTuition: 30_000,
    useStudentLoan: false
  };
  state.careerAndEdu.partTimeJobId = 'job_pt_convenience_store';
  const happinessBefore = state.stats.happiness;

  const result = dropOutHigherEducation(state);

  assert.equal(result.success, true);
  assert.equal(state.careerAndEdu.activeStudy, null);
  assert.equal(state.careerAndEdu.mainJobId, 'job_pt_convenience_store');
  assert.equal(state.careerAndEdu.partTimeJobId, null);
  assert.equal(state.careerAndEdu.yearsInMainJob, 0);
  assert.equal(state.stats.happiness, happinessBefore - 2);
});

test('issues a license only when age, stats, prerequisites, and fee are satisfied', () => {
  const state = createCareerState(14);
  state.flags.push('flag_thai_id_card');

  const tooYoung = takeLicenseExam(state, 'lic_motorcycle');
  assert.equal(tooYoung.success, false);
  assert.match(tooYoung.message, /อายุครบ 15/);

  state.profile.age = 15;
  state.finance.cash = 100;
  const insufficientCash = takeLicenseExam(state, 'lic_motorcycle');
  assert.equal(insufficientCash.success, false);
  assert.match(insufficientCash.message, /เงินสดไม่พอ/);

  state.finance.cash = 1_000;
  const passed = takeLicenseExam(state, 'lic_motorcycle');
  assert.equal(passed.success, true);
  assert.equal(passed.costPaid, 200);
  assert.equal(state.finance.cash, 800);
  assert.ok(state.careerAndEdu.licenses.includes('lic_motorcycle'));
  assert.ok(state.flags.includes('flag_motor_license'));

  const duplicate = takeLicenseExam(state, 'lic_motorcycle');
  assert.equal(duplicate.success, false);
  assert.match(duplicate.message, /อยู่แล้ว/);

  const licenseCard = getAvailableLicenses(state).find((license) => license.license_id === 'lic_motorcycle');
  assert.equal(licenseCard.isOwned, true);
  assert.equal(licenseCard.isLocked, true);
});

test('applies for an eligible professional job and enforces one main job plus conscription restrictions', () => {
  const state = createCareerState(21);
  state.flags.push('flag_bachelor_degree');

  const categories = getCategorizedJobsForUI(state);
  const juniorOffice = categories.corporate.find((job) => job.job_id === 'career_junior_office');
  assert.equal(juniorOffice.isLocked, false);

  const applied = applyForJob(state, 'career_junior_office');
  assert.equal(applied.success, true);
  assert.equal(applied.slot, 'main');
  assert.equal(state.careerAndEdu.mainJobId, 'career_junior_office');
  assert.ok(state.flags.includes('flag_regular_income'));
  assert.equal(state.careerAndEdu.salaryMultiplier, 1);

  const duplicate = applyForJob(state, 'career_junior_office');
  assert.equal(duplicate.success, false);

  state.careerAndEdu.conscriptionYearsLeft = 1;
  const whileConscripted = applyForJob(state, 'career_senior_manager');
  assert.equal(whileConscripted.success, false);
  assert.match(whileConscripted.message, /ทหาร/);
  assert.equal(state.careerAndEdu.mainJobId, 'career_junior_office');
});

test('sports careers appear in the work tab and can be taken as a main job', () => {
  const state = createCareerState(22);
  const ids = ['career_football_player', 'career_basketball_player', 'career_seven_light_football_player'];
  const cards = getCategorizedJobsForUI(state).corporate;
  for (const id of ids) assert.equal(cards.some((job) => job.job_id === id && !job.isLocked), true);

  const result = applyForJob(state, 'career_seven_light_football_player');
  assert.equal(result.success, true);
  assert.equal(state.careerAndEdu.mainJobId, 'career_seven_light_football_player');
});

test('allows only a study-compatible part-time job while enrolled and rejects full-time careers', () => {
  const state = createCareerState(17);
  state.careerAndEdu.activeStudy = {
    programId: 'edu_deg_business',
    yearsCompleted: 0,
    durationYears: 4,
    annualTuition: 30_000,
    useStudentLoan: false
  };
  state.flags.push('flag_legal_youth_worker');

  const fullTime = applyForJob(state, 'career_junior_office');
  assert.equal(fullTime.success, false);
  assert.match(fullTime.message, /กำลังศึกษาอยู่/);

  const partTime = applyForJob(state, 'job_pt_convenience_store');
  assert.equal(partTime.success, true);
  assert.equal(partTime.slot, 'part_time');
  assert.equal(state.careerAndEdu.mainJobId, null);
  assert.equal(state.careerAndEdu.partTimeJobId, 'job_pt_convenience_store');
});

test('resets annual career action limits and retires a civil servant while preserving pension entitlement', () => {
  const state = createCareerState(60);
  state.careerAndEdu.mainJobId = 'gov_civil_officer';
  state.careerAndEdu.yearsInMainJob = 12;
  state.careerAndEdu.salaryMultiplier = 1.5;
  state.careerAndEdu.otUsedThisYear = 1;
  state.careerAndEdu.requestedRaiseThisYear = true;
  state.flags.push('flag_regular_income', 'flag_gov_pension_right', 'flag_welfare_card');

  const report = processAnnualCareerAndStudyProgression(state);

  assert.equal(report.retiredJobId, 'gov_civil_officer');
  assert.equal(state.careerAndEdu.mainJobId, null);
  assert.equal(state.careerAndEdu.yearsInMainJob, 0);
  assert.equal(state.careerAndEdu.salaryMultiplier, 1);
  assert.equal(state.careerAndEdu.otUsedThisYear, 0);
  assert.equal(state.careerAndEdu.requestedRaiseThisYear, false);
  assert.equal(state.flags.includes('flag_regular_income'), false);
  assert.equal(state.flags.includes('flag_welfare_card'), false);
  assert.equal(state.flags.includes('flag_gov_pension_right'), true);
});

test('limits promotion requests and overtime to one use per year while consuming action points', () => {
  const state = createCareerState(28);
  state.careerAndEdu.mainJobId = 'career_junior_office';
  state.careerAndEdu.yearsInMainJob = 2;
  state.turn.freeActionPoints = 3;
  const originalRandom = Math.random;

  try {
    Math.random = () => 0;
    const raise = requestPromotionOrRaise(state);
    assert.equal(raise.success, true);
    assert.equal(raise.raised, true);
    assert.equal(raise.newSalaryMultiplier, 1.1);
    assert.equal(state.turn.freeActionPoints, 2);

    const duplicateRaise = requestPromotionOrRaise(state);
    assert.equal(duplicateRaise.success, false);

    const overtime = workOvertimeAction(state);
    assert.equal(overtime.success, true);
    assert.ok(overtime.otBonusCash > 0);
    assert.equal(state.turn.freeActionPoints, 1);
    assert.equal(state.careerAndEdu.otUsedThisYear, 1);

    const duplicateOvertime = workOvertimeAction(state);
    assert.equal(duplicateOvertime.success, false);
  } finally {
    Math.random = originalRandom;
  }

  assert.ok(state.finance.cash > 500_000);
  assert.equal(state.finance.netWorth, recalculateNetWorth(state));
});
