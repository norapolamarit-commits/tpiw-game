import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import { createEmptyGameState, recalculateNetWorth } from '../js/core/state.js';
import {
  buyOrInvestInstrument,
  processAnnualEconomyAndMarket,
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

function createInvestmentState(age = 25) {
  const state = createEmptyGameState();
  state.profile.age = age;
  state.profile.currentYearBE = 2593;
  state.profile.spawnClassId = 'class_1';
  state.profile.currentClassId = 'class_1';
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

function setSingleMarketNews(assetPriceChanges = {}) {
  db.raw.market.market_news_events = [{
    news_id: 'test_controlled_market_news',
    headline_th: 'ข่าวตลาดจำลองสำหรับทดสอบ',
    description_th: 'เหตุการณ์ตลาดที่กำหนดผลตอบแทนไว้แน่นอน',
    spawn_weight: 1,
    asset_price_changes: assetPriceChanges
  }];
}

test('enforces age, account requirements, minimum investment, and available-cash rules', () => {
  const state = createInvestmentState(19);
  state.flags.push('flag_bank_account');

  const tooYoung = buyOrInvestInstrument(state, 'inv_set_index_stock', 5_000);
  assert.equal(tooYoung.success, false);
  assert.match(tooYoung.message, /อายุอย่างน้อย 20/);

  state.profile.age = 25;
  const missingRequirements = buyOrInvestInstrument(state, 'inv_set_index_stock', 5_000);
  assert.equal(missingRequirements.success, false);
  assert.match(missingRequirements.message, /คุณสมบัติหรือใบอนุญาต/);

  state.flags.push('flag_smartphone', 'flag_investment_account');
  const belowMinimum = buyOrInvestInstrument(state, 'inv_set_index_stock', 500);
  assert.equal(belowMinimum.success, false);
  assert.match(belowMinimum.message, /เงินลงทุนขั้นต่ำ/);

  state.finance.cash = 500;
  const insufficientCash = buyOrInvestInstrument(state, 'inv_set_index_stock', 1_000);
  assert.equal(insufficientCash.success, false);
  assert.match(insufficientCash.message, /เงินสดในกระเป๋าไม่เพียงพอ/);
  assert.deepEqual(state.finance.investments, {});
});

test('buys and adds to an eligible savings holding while preserving total net worth', () => {
  const state = createInvestmentState();
  state.flags.push('flag_bank_account');
  const initialNetWorth = recalculateNetWorth(state);

  const firstBuy = buyOrInvestInstrument(state, 'inv_gsb_savings', 10_000);
  assert.equal(firstBuy.success, true);
  assert.equal(state.finance.cash, 990_000);
  assert.deepEqual(state.finance.investments.inv_gsb_savings, {
    amountCash: 10_000,
    costBasis: 10_000
  });
  assert.equal(state.finance.netWorth, initialNetWorth);

  const secondBuy = buyOrInvestInstrument(state, 'inv_gsb_savings', 5_000);
  assert.equal(secondBuy.success, true);
  assert.equal(state.finance.cash, 985_000);
  assert.deepEqual(state.finance.investments.inv_gsb_savings, {
    amountCash: 15_000,
    costBasis: 15_000
  });
  assert.equal(state.finance.netWorth, initialNetWorth);
});

test('partial and full instrument withdrawals reduce cost basis proportionally and update net worth', () => {
  const state = createInvestmentState();
  state.flags.push('flag_bank_account');
  assert.equal(buyOrInvestInstrument(state, 'inv_gsb_savings', 10_000).success, true);

  const partial = sellOrWithdrawInstrument(state, 'inv_gsb_savings', 4_000);
  assert.equal(partial.success, true);
  assert.equal(partial.soldAmount, 4_000);
  assert.equal(partial.netReceived, 4_000);
  assert.equal(state.finance.cash, 994_000);
  assert.deepEqual(state.finance.investments.inv_gsb_savings, {
    amountCash: 6_000,
    costBasis: 6_000
  });
  assert.equal(state.finance.netWorth, 1_000_000);

  const full = sellOrWithdrawInstrument(state, 'inv_gsb_savings', 99_000);
  assert.equal(full.success, true);
  assert.equal(full.soldAmount, 6_000);
  assert.equal(full.netReceived, 6_000);
  assert.equal(state.finance.cash, 1_000_000);
  assert.equal(Object.hasOwn(state.finance.investments, 'inv_gsb_savings'), false);
  assert.equal(state.finance.netWorth, 1_000_000);
});

test('pays annual dividends with withholding tax and the elite-connection bonus, while exempting GSB products', () => {
  const state = createInvestmentState();
  state.flags.push('flag_elite_connection');
  state.finance.investments = {
    inv_gsb_savings: { amountCash: 10_000, costBasis: 10_000 },
    inv_gsb_lottery_bond: { amountCash: 10_000, costBasis: 10_000 },
    inv_thai_gov_bond: { amountCash: 10_000, costBasis: 10_000 }
  };
  setSingleMarketNews({
    inv_gsb_savings: 0,
    inv_gsb_lottery_bond: 0,
    inv_thai_gov_bond: 0
  });

  const originalRandom = Math.random;
  let slip;
  try {
    Math.random = () => 0.999; // Force the no-prize outcome; this test covers dividends, not lottery variance.
    slip = processAnnualEconomyAndMarket(state);
  } finally {
    Math.random = originalRandom;
  }
  const savingsInterest = slip.incomeItems.find((item) => item.labelTh.includes('ธนาคารออมสิน'));
  const lotteryInterest = slip.incomeItems.find((item) => item.labelTh.includes('สลากออมสิน'));
  const bondDividend = slip.incomeItems.find((item) => item.labelTh.includes('เงินปันผลสุทธิ') && item.labelTh.includes('พันธบัตร'));

  assert.equal(savingsInterest?.amount, 150);
  assert.equal(lotteryInterest?.amount, 50);
  // 10,000 x (3.5% base + 2% elite bonus) x 90% after withholding tax.
  assert.equal(bondDividend?.amount, 495);
  assert.equal(slip.totalCashIncome, 695);
});

test('applies deterministic market news, financial-literacy loss mitigation, and crypto-nerd return bonus', () => {
  const state = createInvestmentState();
  state.flags.push('flag_financial_literacy');
  state.talentTags.push('tag_computer_nerd');
  state.finance.investments = {
    inv_set_index_stock: { amountCash: 10_000, costBasis: 10_000 },
    inv_crypto_bitcoin: { amountCash: 10_000, costBasis: 10_000 }
  };
  setSingleMarketNews({
    inv_set_index_stock: -0.2,
    inv_crypto_bitcoin: 0.1
  });

  const slip = processAnnualEconomyAndMarket(state);
  const stockMove = slip.marketItems.find((item) => item.instrumentId === 'inv_set_index_stock');
  const cryptoMove = slip.marketItems.find((item) => item.instrumentId === 'inv_crypto_bitcoin');

  assert.equal(state.finance.currentMarketNewsId, 'test_controlled_market_news');
  assert.equal(stockMove.pctChange, -15);
  assert.equal(stockMove.deltaValue, -1_500);
  assert.equal(stockMove.newTotalValue, 8_500);
  assert.equal(cryptoMove.pctChange, 15);
  assert.equal(cryptoMove.deltaValue, 1_500);
  assert.equal(cryptoMove.newTotalValue, 11_500);
  assert.equal(slip.netWorth, recalculateNetWorth(state));
});

test('awards a deterministic annual GSB lottery-bond prize once and reconciles the annual cash flow', () => {
  const state = createInvestmentState();
  state.finance.cash = 100_000;
  state.finance.investments = {
    inv_gsb_lottery_bond: { amountCash: 5_000, costBasis: 5_000 }
  };
  setSingleMarketNews({ inv_gsb_lottery_bond: 0 });
  db.raw.market.lottery_and_lucky_draw_table = [{
    prize_id: 'test_gsb_prize',
    name_th: 'รางวัลทดสอบ',
    applicable_to: ['inv_gsb_lottery_bond'],
    base_chance_percent: 100,
    affected_by_lucky_multiplier: false,
    reward_cash: 2_000,
    grants_flags: [],
    stat_effects: {},
    description_th: 'รางวัลสำหรับทดสอบระบบ'
  }];

  const originalRandom = Math.random;
  let slip;
  try {
    Math.random = () => 0;
    slip = processAnnualEconomyAndMarket(state);
  } finally {
    Math.random = originalRandom;
  }

  assert.equal(slip.gsbLotteryResult.won, true);
  assert.equal(slip.gsbLotteryResult.prizeId, 'test_gsb_prize');
  assert.equal(slip.gsbLotteryResult.rewardCash, 2_000);
  assert.ok(slip.incomeItems.some((item) => item.amount === 2_000 && item.labelTh.includes('รางวัล')));
  assert.equal(
    state.finance.cash - slip.startingCash,
    slip.incomeItems.filter((item) => item.wallet === 'cash').reduce((sum, item) => sum + item.amount, 0)
      - slip.totalCashExpense
  );
  assert.equal(slip.netWorth, recalculateNetWorth(state));
});
