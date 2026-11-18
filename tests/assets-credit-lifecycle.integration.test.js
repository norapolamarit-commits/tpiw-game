import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import { createEmptyGameState } from '../js/core/state.js';
import {
  buyShopItem,
  processAnnualEconomyAndMarket,
  getCombinedActionMultipliers,
  repayLoan,
  sellOwnedAsset
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

function createCreditState(age = 25) {
  const state = createEmptyGameState();
  state.profile.age = age;
  state.profile.currentYearBE = 2593;
  state.profile.currentLocationId = 'loc_bangkok';
  state.finance.cash = 1_000_000;
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
  return state;
}

test('buys an installment vehicle and processes its annual payment and depreciation', () => {
  const state = createCreditState();
  state.flags.push('flag_motor_license');
  const purchase = buyShopItem(state, 'asset_new_motorcycle', 'installment');

  assert.equal(purchase.success, true);
  assert.equal(purchase.upfrontCost, 10_000);
  assert.equal(state.finance.cash, 990_000);
  assert.equal(state.finance.ownedAssets.length, 1);
  assert.equal(state.finance.ownedAssets[0].currentValue, 60_000);
  assert.equal(state.finance.installments.length, 1);
  assert.equal(state.finance.installments[0].annualPayment, 18_000);
  assert.equal(state.finance.installments[0].yearsRemaining, 3);
  assert.ok(state.flags.includes('flag_has_motorcycle'));

  const slip = processAnnualEconomyAndMarket(state);

  assert.equal(state.finance.ownedAssets[0].currentValue, 52_800);
  assert.equal(state.finance.installments[0].yearsRemaining, 2);
  assert.ok(slip.expenseItems.some(
    (item) => item.labelTh.includes('ค่างวดผ่อน') && item.amount === -18_000
  ));
  assert.ok(slip.netWorth < 52_800 + state.finance.cash);
});

test('selling a financed asset settles its linked remaining installments exactly once', () => {
  const state = createCreditState();
  state.flags.push('flag_motor_license');
  const purchase = buyShopItem(state, 'asset_new_motorcycle', 'installment');
  const assetId = purchase.assetInstanceId;

  const sale = sellOwnedAsset(state, assetId, 1);

  assert.equal(sale.success, true);
  assert.equal(sale.grossSalePrice, 60_000);
  assert.equal(sale.settledInstallmentDebt, 54_000);
  assert.equal(sale.netCashReceived, 6_000);
  assert.equal(state.finance.cash, 996_000);
  assert.equal(state.finance.ownedAssets.length, 0);
  assert.equal(state.finance.installments.length, 0);
  assert.equal(state.flags.includes('flag_has_motorcycle'), false);
});

test('pays a scheduled personal-loan installment and reduces principal by the principal portion', () => {
  const state = createCreditState();
  state.finance.activeLoans = [{
    loanId: 'loan_personal_credit_card',
    principalRemaining: 10_000,
    annualRate: 0.18,
    missedYears: 0,
    takenAge: 24
  }];
  state.flags.push('flag_personal_loan_active');

  const slip = processAnnualEconomyAndMarket(state);

  // 10,000 principal / 5 years + 18% annual interest = 3,800.
  assert.equal(state.finance.activeLoans[0].principalRemaining, 8_000);
  assert.equal(state.finance.activeLoans[0].missedYears, 0);
  assert.ok(slip.expenseItems.some(
    (item) => item.labelTh.includes('ชำระหนี้') && item.amount === -3_800
  ));
  assert.equal(state.statCounters.onTimeLoanPaymentStreakYears, 1);
});

test('two consecutive missed personal-loan payments compound interest and trigger credit blacklist', () => {
  const state = createCreditState();
  state.finance.cash = 0;
  state.finance.activeLoans = [{
    loanId: 'loan_personal_credit_card',
    principalRemaining: 10_000,
    annualRate: 0.18,
    missedYears: 0,
    takenAge: 24
  }];
  state.flags.push('flag_personal_loan_active', 'flag_credit_good');

  const firstRateMultiplier = getCombinedActionMultipliers(state).loan_interest_rate;
  const firstInterest = Math.round(10_000 * 0.18 * firstRateMultiplier * 0.8);
  processAnnualEconomyAndMarket(state);
  const principalAfterFirstDefault = 10_000 + firstInterest;
  assert.equal(state.finance.activeLoans[0].principalRemaining, principalAfterFirstDefault);
  assert.equal(state.finance.activeLoans[0].missedYears, 1);
  assert.ok(state.flags.includes('flag_loan_payment_overdue'));
  assert.equal(state.statCounters.onTimeLoanPaymentStreakYears, 0);

  state.profile.age = 26;
  const secondRateMultiplier = getCombinedActionMultipliers(state).loan_interest_rate;
  const secondInterest = Math.round(principalAfterFirstDefault * 0.18 * secondRateMultiplier * 0.8);
  processAnnualEconomyAndMarket(state);

  assert.equal(
    state.finance.activeLoans[0].principalRemaining,
    principalAfterFirstDefault + secondInterest
  );
  assert.equal(state.finance.activeLoans[0].missedYears, 2);
  assert.ok(state.flags.includes('flag_credit_blacklist'));
  assert.ok(state.flags.includes('flag_loan_payment_overdue'));
  assert.equal(state.flags.includes('flag_credit_good'), false);
});

test('allows partial and full early repayment and clears the active-loan flag after payoff', () => {
  const state = createCreditState();
  state.finance.cash = 20_000;
  state.finance.activeLoans = [{
    loanId: 'loan_personal_credit_card',
    principalRemaining: 5_000,
    annualRate: 0.18,
    missedYears: 1,
    takenAge: 24
  }];
  state.flags.push('flag_personal_loan_active', 'flag_loan_payment_overdue');

  const partial = repayLoan(state, 'loan_personal_credit_card', 2_000);
  assert.equal(partial.success, true);
  assert.equal(partial.paidAmount, 2_000);
  assert.equal(partial.remainingPrincipal, 3_000);
  assert.equal(state.finance.cash, 18_000);
  assert.equal(state.finance.activeLoans[0].missedYears, 0);

  const full = repayLoan(state, 'loan_personal_credit_card', 9_000);
  assert.equal(full.success, true);
  assert.equal(full.paidAmount, 3_000);
  assert.equal(full.remainingPrincipal, 0);
  assert.equal(full.isFullyPaid, true);
  assert.equal(state.finance.cash, 15_000);
  assert.equal(state.finance.activeLoans.length, 0);
  assert.equal(state.flags.includes('flag_personal_loan_active'), false);
  assert.equal(state.flags.includes('flag_loan_payment_overdue'), false);
});
