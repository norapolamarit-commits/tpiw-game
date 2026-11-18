import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import { calculateParentalSupport } from '../js/core/family_support.js';
import {
  createEmptyGameState,
  recalculateNetWorth
} from '../js/core/state.js';
import {
  calculateJobAnnualIncome,
  processAnnualEconomyAndMarket,
  forceInformalSharkLoanToCoverDeficit,
  getCombinedActionMultipliers,
  getElderAnnualAllowance,
  resolveNegativeCashProtocol,
  buyOrInvestInstrument,
  sellOrWithdrawInstrument
} from '../js/engine/economy_engine.js';

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

function createEconomyState(age = 25) {
  const state = createEmptyGameState();
  state.profile.age = age;
  state.profile.currentLocationId = 'loc_economy_test';
  state.profile.currentClassId = 'class_3';
  state.finance.cash = 10_000;
  state.finance.piggyBank = 0;
  state.finance.investments = {};
  state.finance.ownedAssets = [];
  state.finance.activeLoans = [];
  state.finance.installments = [];
  state.flags = [];
  state.statuses = [];
  state.talentTags = [];
  state.innateTraits = [];
  state.turn.lifeFeedLog = [];
  db.indexes.locations.set('loc_economy_test', {
    location_id: 'loc_economy_test',
    name_th: 'จังหวัดทดสอบ',
    job_opportunity_multiplier: 1.2,
    cost_of_living_multiplier: 1
  });
  return state;
}

test('calculates elder allowance at every age-band boundary', () => {
  assert.equal(getElderAnnualAllowance(59), 0);
  assert.equal(getElderAnnualAllowance(60), 7200);
  assert.equal(getElderAnnualAllowance(69), 7200);
  assert.equal(getElderAnnualAllowance(70), 8400);
  assert.equal(getElderAnnualAllowance(79), 8400);
  assert.equal(getElderAnnualAllowance(80), 9600);
  assert.equal(getElderAnnualAllowance(89), 9600);
  assert.equal(getElderAnnualAllowance(90), 12000);
  assert.equal(getElderAnnualAllowance(100), 12000);
});

test('calculates real job income with location, business, and main-career multipliers', () => {
  const state = createEconomyState();
  state.careerAndEdu.salaryMultiplier = 1.1;
  state.flags = ['test_business_income_bonus'];
  db.indexes.traitsAndFlags.set('test_business_income_bonus', {
    id: 'test_business_income_bonus',
    category_group: 'financial_and_legal_flags',
    action_multipliers: { business_income: 1.5 }
  });

  const job = db.getJob('own_street_food_vendor');
  assert.ok(job, 'the referenced career should exist in the real job database');

  const mainCareerIncome = calculateJobAnnualIncome(
    job, state, getCombinedActionMultipliers(state), true
  );
  const sideCareerIncome = calculateJobAnnualIncome(
    job, state, getCombinedActionMultipliers(state), false
  );

  assert.equal(mainCareerIncome, 475200);
  assert.equal(sideCareerIncome, 432000);
  assert.equal(calculateJobAnnualIncome(null, state, {}, true), 0);
});

test('rejects investment when age, eligibility, minimum amount, or cash requirements fail', () => {
  const state = createEconomyState(6);

  const tooYoung = buyOrInvestInstrument(state, 'inv_gsb_savings', 1000);
  assert.equal(tooYoung.success, false);
  assert.match(tooYoung.message, /อายุอย่างน้อย/);

  state.profile.age = 25;
  const noAccount = buyOrInvestInstrument(state, 'inv_gsb_savings', 1000);
  assert.equal(noAccount.success, false);
  assert.match(noAccount.message, /คุณสมบัติ/);

  state.flags.push('flag_bank_account');
  const belowMinimum = buyOrInvestInstrument(state, 'inv_gsb_savings', 50);
  assert.equal(belowMinimum.success, false);
  assert.match(belowMinimum.message, /ขั้นต่ำ/);

  state.finance.cash = 80;
  const insufficientCash = buyOrInvestInstrument(state, 'inv_gsb_savings', 100);
  assert.equal(insufficientCash.success, false);
  assert.match(insufficientCash.message, /ไม่เพียงพอ/);
  assert.equal(state.finance.cash, 80);
});

test('buys and partially or fully withdraws a real savings instrument without losing net worth', () => {
  const state = createEconomyState();
  state.flags.push('flag_bank_account');
  const initialNetWorth = recalculateNetWorth(state);

  const purchase = buyOrInvestInstrument(state, 'inv_gsb_savings', 1000);
  assert.equal(purchase.success, true);
  assert.equal(state.finance.cash, 9000);
  assert.equal(state.finance.investments.inv_gsb_savings.amountCash, 1000);
  assert.equal(state.finance.investments.inv_gsb_savings.costBasis, 1000);
  assert.equal(state.finance.netWorth, initialNetWorth);

  const partialSale = sellOrWithdrawInstrument(state, 'inv_gsb_savings', 400);
  assert.equal(partialSale.success, true);
  assert.equal(partialSale.soldAmount, 400);
  assert.equal(partialSale.netReceived, 400);
  assert.equal(state.finance.cash, 9400);
  assert.equal(state.finance.investments.inv_gsb_savings.amountCash, 600);
  assert.equal(state.finance.investments.inv_gsb_savings.costBasis, 600);
  assert.equal(state.finance.netWorth, initialNetWorth);

  const fullSale = sellOrWithdrawInstrument(state, 'inv_gsb_savings', 9999);
  assert.equal(fullSale.success, true);
  assert.equal(state.finance.cash, 10000);
  assert.equal(Object.hasOwn(state.finance.investments, 'inv_gsb_savings'), false);
  assert.equal(state.finance.netWorth, initialNetWorth);
});

test('rejects invalid investment withdrawals without mutating the holding', () => {
  const state = createEconomyState();
  state.finance.investments.inv_gsb_savings = { amountCash: 500, costBasis: 500 };

  assert.equal(sellOrWithdrawInstrument(state, 'missing_instrument', 100).success, false);
  assert.equal(sellOrWithdrawInstrument(state, 'inv_gsb_savings', 0).success, false);
  assert.equal(state.finance.investments.inv_gsb_savings.amountCash, 500);
  assert.equal(state.finance.cash, 10000);
});

test('uses available GSB savings to reduce a negative cash balance before offering emergency options', () => {
  const state = createEconomyState();
  state.finance.cash = -500;
  state.finance.investments.inv_gsb_savings = { amountCash: 300, costBasis: 300 };

  const result = resolveNegativeCashProtocol(state);

  assert.equal(result.resolved, false);
  assert.equal(result.deficitAmount, 200);
  assert.equal(state.finance.cash, -200);
  assert.equal(Object.hasOwn(state.finance.investments, 'inv_gsb_savings'), false);
  assert.ok(result.availableOptions.some(
    (option) => option.optionType === 'forced_informal_shark_loan_to_cover_deficit'
  ));
});

test('covers a cash deficit with the forced loan and records the matching debt and status', () => {
  const state = createEconomyState();
  state.finance.cash = -2500;
  const happinessBefore = state.stats.happiness;

  const result = forceInformalSharkLoanToCoverDeficit(state);

  assert.equal(result.success, true);
  assert.equal(result.borrowedAmount, 2500);
  assert.equal(state.finance.cash, 0);
  assert.equal(state.finance.activeLoans.length, 1);
  assert.equal(state.finance.activeLoans[0].loanId, 'loan_informal_loan_shark');
  assert.equal(state.finance.activeLoans[0].principalRemaining, 2500);
  assert.ok(state.flags.includes('flag_informal_shark_debt'));
  assert.equal(state.stats.happiness, happinessBefore - 8);
  assert.equal(state.finance.netWorth, -2500);
});

test('adds a new deficit to an existing informal loan instead of duplicating the loan record', () => {
  const state = createEconomyState();
  state.finance.cash = -700;
  state.finance.activeLoans = [{
    loanId: 'loan_informal_loan_shark',
    principalRemaining: 1300,
    annualRate: 0.6,
    missedYears: 0
  }];

  const result = forceInformalSharkLoanToCoverDeficit(state);

  assert.equal(result.borrowedAmount, 700);
  assert.equal(state.finance.activeLoans.length, 1);
  assert.equal(state.finance.activeLoans[0].principalRemaining, 2000);
  assert.equal(state.finance.cash, 0);
});


test('baseline lifetime cash-flow scenarios use configured family support, careers, and living costs', () => {
  const rules = db.getGameConstants();
  const location = db.getLocation('loc_chiangmai');

  function project(classId, careerId) {
    const familyClass = db.getClass(classId);
    const career = db.getJob(careerId);
    const state = createEconomyState(0);
    state.profile.currentLocationId = 'loc_chiangmai';
    state.profile.spawnClassId = classId;
    state.profile.currentClassId = classId;
    state.relationships.npcs = [];
    state.flags = [...(familyClass.starting_flags || [])];
    const classMultipliers = getCombinedActionMultipliers(state);
    const familyCapacity = Number(familyClass.parent_annual_support_age_0_to_17 || 0);
    let cash = Math.round(familyCapacity * Number(rules.initial_birth_gift_rate ?? 0.05));
    let lifetimeIncome = cash;
    let lifetimeLivingCost = 0;
    let yearsWithCareer = 0;

    for (let age = 0; age <= 65; age += 1) {
      if (age <= 17) {
        const support = calculateParentalSupport({
          state,
          age,
          baseAnnualSupport: familyCapacity,
          gameConstants: rules
        });
        cash += support.cashAllowance;
        lifetimeIncome += support.cashAllowance;
      }

      if (age >= 18) {
        const phase = db.getLifePhaseByAge(age);
        const livingCost = Math.round(Number(phase?.baseAnnualLivingCost || 0) * Number(location.cost_of_living_multiplier || 1));
        cash -= livingCost;
        lifetimeLivingCost += livingCost;

        if (career && age >= Number(career.min_age || 0) && age <= Number(career.retirement_age ?? 65)) {
          const income = calculateJobAnnualIncome(career, {
            profile: { currentLocationId: 'loc_chiangmai' },
            careerAndEdu: { salaryMultiplier: 1 }
          }, classMultipliers, true);
          cash += income;
          lifetimeIncome += income;
          yearsWithCareer += 1;
        }

        for (const flagId of state.flags) {
          const flag = db.getTraitOrFlag(flagId);
          const minAge = Number(flag?.cash_effect_min_age ?? 0);
          const flagCash = Number(flag?.yearly_stat_effects?.cash || 0);
          if (age >= minAge && flagCash > 0) {
            cash += flagCash;
            lifetimeIncome += flagCash;
          }
        }

        const elderAllowance = getElderAnnualAllowance(age);
        cash += elderAllowance;
        lifetimeIncome += elderAllowance;
      }
    }

    return { cash, lifetimeIncome, lifetimeLivingCost, yearsWithCareer, initialGift: Math.round(familyCapacity * Number(rules.initial_birth_gift_rate ?? 0.05)) };
  }

  const scenarios = [
    { classId: 'class_1', careerId: 'job_daily_construction' },
    { classId: 'class_2', careerId: 'career_factory_technician' },
    { classId: 'class_3', careerId: 'career_junior_office' },
    { classId: 'class_4', careerId: 'career_creative_marketer' },
    { classId: 'class_5', careerId: 'career_c_level_ceo' }
  ].map((x) => ({ ...x, result: project(x.classId, x.careerId) }));

  assert.deepEqual(scenarios.map(x => x.result.initialGift), [60, 300, 1200, 6000, 30000]);
  assert.ok(scenarios.every(x => x.result.lifetimeLivingCost === 4_536_000));
  assert.ok(scenarios.every(x => x.result.yearsWithCareer > 0));
  assert.ok(scenarios[0].result.cash < 0, 'low-income construction path falls short of baseline adult living costs');
  assert.ok(scenarios[1].result.cash > scenarios[0].result.cash);
  assert.ok(scenarios[2].result.cash > scenarios[1].result.cash);
  assert.ok(scenarios[3].result.cash > scenarios[2].result.cash);
  assert.ok(scenarios[4].result.cash > scenarios[3].result.cash);
  assert.equal(scenarios[4].result.yearsWithCareer, 31);
});


test('location × career × social-class simulation compares opportunity gains with living costs', () => {
  const locationIds = [
    'loc_mae_hong_son',
    'loc_chiangmai',
    'loc_chonburi',
    'loc_bangkok',
    'loc_phuket'
  ];
  const scenarios = [
    { classId: 'class_1', careerId: 'job_daily_construction' },
    { classId: 'class_2', careerId: 'career_factory_technician' },
    { classId: 'class_3', careerId: 'career_junior_office' },
    { classId: 'class_4', careerId: 'career_creative_marketer' },
    { classId: 'class_5', careerId: 'career_c_level_ceo' }
  ];

  function project(locationId, classId, careerId) {
    const location = db.getLocation(locationId);
    const familyClass = db.getClass(classId);
    const career = db.getJob(careerId);
    assert.ok(location, `location ${locationId} should exist`);
    assert.ok(familyClass, `class ${classId} should exist`);
    assert.ok(career, `career ${careerId} should exist`);

    const state = createEconomyState(0);
    state.profile.currentLocationId = locationId;
    state.profile.spawnClassId = classId;
    state.profile.currentClassId = classId;
    state.flags = [...(familyClass.starting_flags || [])];
    const multipliers = getCombinedActionMultipliers(state);
    let careerIncome = 0;
    let livingCost = 0;
    let careerYears = 0;

    for (let age = 18; age <= 65; age += 1) {
      const phase = db.getLifePhaseByAge(age);
      livingCost += Math.round(
        Number(phase?.baseAnnualLivingCost || 0) *
        Number(location.cost_of_living_multiplier || 1)
      );

      if (age >= Number(career.min_age || 0) &&
          age <= Number(career.retirement_age ?? 65)) {
        careerIncome += calculateJobAnnualIncome(career, {
          profile: { currentLocationId: locationId },
          careerAndEdu: { salaryMultiplier: 1 }
        }, multipliers, true);
        careerYears += 1;
      }
    }

    return {
      careerIncome,
      livingCost,
      careerYears,
      netBeforeOtherIncome: careerIncome - livingCost
    };
  }

  const results = scenarios.flatMap((scenario) =>
    locationIds.map((locationId) => ({
      ...scenario,
      locationId,
      result: project(locationId, scenario.classId, scenario.careerId)
    }))
  );

  for (const scenario of scenarios) {
    const rows = results.filter((row) => row.classId === scenario.classId);
    const baseline = rows.find((row) => row.locationId === 'loc_chiangmai').result;
    assert.ok(baseline.careerYears > 0);
    assert.ok(rows.every((row) => row.result.careerYears === baseline.careerYears));

    for (const row of rows) {
      const location = db.getLocation(row.locationId);
      assert.equal(
        row.result.livingCost,
        Math.round(4_536_000 * Number(location.cost_of_living_multiplier || 1))
      );
      assert.ok(Number.isFinite(row.result.netBeforeOtherIncome));
    }
  }

  const bangkok = db.getLocation('loc_bangkok');
  const phuket = db.getLocation('loc_phuket');
  const rural = db.getLocation('loc_mae_hong_son');
  assert.equal(bangkok.job_opportunity_multiplier, 1.4);
  assert.equal(bangkok.cost_of_living_multiplier, 1.5);
  assert.equal(phuket.job_opportunity_multiplier, 1.3);
  assert.equal(phuket.cost_of_living_multiplier, 1.5);
  assert.equal(rural.job_opportunity_multiplier, 0.6);
  assert.equal(rural.cost_of_living_multiplier, 0.6);

  const constructionBangkok = results.find(
    (row) => row.classId === 'class_1' && row.locationId === 'loc_bangkok'
  ).result;
  const constructionRural = results.find(
    (row) => row.classId === 'class_1' && row.locationId === 'loc_mae_hong_son'
  ).result;
  assert.ok(
    constructionBangkok.careerIncome > constructionRural.careerIncome,
    'location-sensitive entry-level work should earn more in a higher-opportunity city'
  );
  assert.ok(
    constructionBangkok.livingCost > constructionRural.livingCost,
    'the same city also raises lifetime living costs'
  );

  const governmentIndependent = db.getJob('gov_civil_officer');
  assert.equal(governmentIndependent.affected_by_location_multiplier, false);
  const governmentState = createEconomyState(25);
  governmentState.profile.currentLocationId = 'loc_bangkok';
  const bangkokGovernmentIncome = calculateJobAnnualIncome(
    governmentIndependent,
    { profile: { currentLocationId: 'loc_bangkok' }, careerAndEdu: { salaryMultiplier: 1 } },
    getCombinedActionMultipliers(governmentState),
    true
  );
  governmentState.profile.currentLocationId = 'loc_mae_hong_son';
  const ruralGovernmentIncome = calculateJobAnnualIncome(
    governmentIndependent,
    { profile: { currentLocationId: 'loc_mae_hong_son' }, careerAndEdu: { salaryMultiplier: 1 } },
    getCombinedActionMultipliers(governmentState),
    true
  );
  assert.equal(
    bangkokGovernmentIncome,
    ruralGovernmentIncome,
    'government salary should remain location-independent as configured'
  );
});


test('annual cash-flow slip applies location living costs, housing discount, installments, and loan repayment', () => {
  const state = createEconomyState(25);
  state.profile.currentLocationId = 'loc_bangkok';
  state.profile.spawnClassId = 'class_3';
  state.profile.currentClassId = 'class_3';
  state.finance.cash = 1_000_000;
  state.finance.hasPiggyBankSmashed = true;
  state.careerAndEdu.mainJobId = 'career_junior_office';
  state.careerAndEdu.salaryMultiplier = 1;
  state.finance.installments = [{
    itemId: 'test_home_installment',
    annualPayment: 12000,
    yearsRemaining: 2
  }];
  state.finance.activeLoans = [{
    loanId: 'loan_student_gys',
    principalRemaining: 30000,
    annualRate: 0.01,
    missedYears: 0
  }];

  const slip = processAnnualEconomyAndMarket(state);
  const livingExpense = slip.expenseItems.find((item) => item.labelTh.includes('ค่าครองชีพประจำปี'));
  const installmentExpense = slip.expenseItems.find((item) => item.labelTh.includes('ค่างวดผ่อน'));
  const gysExpense = slip.expenseItems.find((item) => item.labelTh.includes('ชำระหนี้'));

  assert.ok(livingExpense);
  assert.equal(livingExpense.amount, -126000);
  assert.ok(installmentExpense);
  assert.equal(installmentExpense.amount, -12000);
  assert.ok(gysExpense);
  assert.equal(gysExpense.amount, -15300);
  assert.equal(state.finance.installments.length, 1);
  assert.equal(state.finance.installments[0].yearsRemaining, 1);
  assert.equal(state.finance.activeLoans[0].principalRemaining, 30000 - 15000);
});

test('annual living-cost engine applies its documented 20 percent housing discount', () => {
  const state = createEconomyState(25);
  state.profile.currentLocationId = 'loc_bangkok';
  state.finance.cash = 500000;
  state.finance.hasPiggyBankSmashed = true;
  state.flags.push('flag_has_own_home');

  const slip = processAnnualEconomyAndMarket(state);
  const livingExpense = slip.expenseItems.find((item) => item.labelTh.includes('ค่าครองชีพประจำปี'));

  assert.ok(livingExpense);
  assert.equal(livingExpense.amount, -100800);
});


test('annual slip exposes categorized expense totals without changing cash-flow totals', () => {
  const state = createEconomyState(25);
  state.profile.currentLocationId = 'loc_bangkok';
  state.finance.cash = 500000;
  state.finance.hasPiggyBankSmashed = true;
  state.flags.push('flag_has_own_home');
  state.finance.installments = [{
    itemId: 'test_home_installment',
    annualPayment: 12000,
    yearsRemaining: 1
  }];

  const slip = processAnnualEconomyAndMarket(state);
  const categorizedTotal = Object.values(slip.expenseBreakdown)
    .reduce((sum, amount) => sum + amount, 0);

  assert.equal(slip.expenseBreakdown.living, 100800);
  assert.equal(slip.expenseBreakdown.installment, 12000);
  assert.equal(categorizedTotal, slip.totalCashExpense);
  assert.equal(
    slip.expenseItems.reduce((sum, item) => sum + Math.abs(item.amount), 0),
    slip.totalCashExpense
  );
  assert.ok(slip.expenseItems.every((item) =>
    ['living', 'education', 'family', 'medical', 'installment', 'debt', 'other'].includes(item.category)
  ));
});


test('annual slip categorizes income and reconciles cash plus piggy-bank totals', () => {
  const state = createEconomyState(25);
  state.profile.currentLocationId = 'loc_bangkok';
  state.finance.cash = 500000;
  state.finance.hasPiggyBankSmashed = true;
  state.flags.push('flag_trust_fund');

  const slip = processAnnualEconomyAndMarket(state);
  const categorizedTotal = Object.values(slip.incomeBreakdown)
    .reduce((sum, amount) => sum + amount, 0);
  const itemTotal = slip.incomeItems
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);

  assert.equal(categorizedTotal, itemTotal);
  assert.equal(categorizedTotal, slip.totalCashIncome + slip.totalPiggyIncome);
  assert.ok(slip.incomeItems.every((item) =>
    ['employment', 'family', 'assets', 'investment', 'benefits', 'retirement', 'other'].includes(item.category)
  ));
  assert.ok(slip.incomeBreakdown.family > 0 || slip.incomeBreakdown.benefits > 0);
});
