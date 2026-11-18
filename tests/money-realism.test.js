import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { DATA_MANIFEST, db } from '../js/core/db.js';
import { createEmptyGameState } from '../js/core/state.js';
import { buyShopItem, calculateJobAnnualIncome, getCombinedActionMultipliers, processAnnualEconomyAndMarket, sellOwnedAsset } from '../js/engine/economy_engine.js';
import {
  EXPENSE_SHARES, MIN_WAGE_ANNUAL, computeIncomeTax, housingMode, inflationFactor, inflationRateForAge, priceIndex,
  socialSecurityPension, socialSecurityUnemployment, splitLivingCost, tenureMultiplier
} from '../js/engine/money_realism_engine.js';

const storage = new Map();
globalThis.localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) };
const fixture = {};
for (const [key, filename] of Object.entries(DATA_MANIFEST)) fixture[key] = JSON.parse(await readFile(fileURLToPath(new URL(`../data/${filename}`, import.meta.url)), 'utf8'));
test.beforeEach(() => { storage.clear(); db.raw = structuredClone(fixture); db.buildIndexes(); db.isLoaded = true; });

const mk = (age, realism = true, jobId = null) => {
  const s = createEmptyGameState();
  s.meta.runId = 'mr1'; s.profile.age = age; s.profile.currentLocationId = 'loc_mr'; s.profile.currentClassId = 'class_3'; s.profile.spawnClassId = 'class_3';
  s.finance.cash = 100000; s.finance.realismV2 = realism; s.flags = []; s.turn.lifeFeedLog = [];
  s.careerAndEdu.mainJobId = jobId;
  db.indexes.locations.set('loc_mr', { location_id: 'loc_mr', name_th: 'ทดสอบ', job_opportunity_multiplier: 1, cost_of_living_multiplier: 1 });
  return s;
};

test('shop inflation applies only to opted-in saves and keeps resale based on paid price', () => {
  const item = [...Object.values(db.raw.shop).flat()].find((x) => x.is_resellable_asset && !x.req_flags?.length && Number(x.min_age || 0) <= 40 && Number(x.max_age ?? 100) >= 40);
  assert.ok(item);
  const old = mk(40, false); old.finance.cash = 1e9;
  const modern = mk(40, true); modern.finance.cash = 1e9;
  const a = buyShopItem(old, item.item_id);
  const b = buyShopItem(modern, item.item_id);
  assert.equal(a.success, true);
  assert.equal(b.success, true);
  assert.equal(a.upfrontCost, Number(item.price_cash));
  assert.equal(b.upfrontCost, Math.round(Number(item.price_cash) * inflationFactor(modern, 40)));
  assert.equal(modern.finance.ownedAssets.at(-1).purchasePrice, b.upfrontCost);
  assert.ok(sellOwnedAsset(modern, b.assetInstanceId).success);
  assert.ok(modern.finance.cash <= 1e9, 'buying then selling must not create cash');
  old.finance.realismV2 = true;
  assert.equal(buyShopItem(old, item.item_id).upfrontCost, b.upfrontCost);
});

test('inflation is deterministic, 0.5-5%, compounds, and is 1.0 up to the reference age', () => {
  const s = mk(40);
  for (let a = 1; a <= 80; a++) { const r = inflationRateForAge(s, a); assert.ok(r >= 0.005 && r <= 0.05); }
  assert.equal(inflationRateForAge(s, 30), inflationRateForAge(mk(40), 30));
  assert.equal(inflationFactor(s, 18), 1);
  assert.equal(inflationFactor(s, 10), 1);
  assert.ok(inflationFactor(s, 50) > inflationFactor(s, 30));
  assert.ok(priceIndex(s, 60) / priceIndex(s, 18) === inflationFactor(s, 60));
  assert.ok(inflationFactor(s, 58) > 1.4 && inflationFactor(s, 58) < 5, '40 years of inflation');
});

test('Thai progressive income tax brackets and deductions', () => {
  assert.equal(computeIncomeTax({}, 0).tax, 0);
  assert.equal(computeIncomeTax({}, 180000).tax, 0, 'low earners owe nothing');
  const mid = computeIncomeTax({}, 600000, { ssPaid: 9000 });
  assert.equal(mid.deductions, 100000 + 60000 + 9000);
  assert.equal(mid.taxable, 600000 - mid.deductions);
  const expected = (300000 - 150000) * 0.05 + (mid.taxable - 300000) * 0.10;
  assert.equal(mid.tax, Math.round(expected));
  const rich = computeIncomeTax({}, 3000000);
  assert.ok(rich.tax > 500000 && rich.tax < 3000000 * 0.35);
  assert.ok(computeIncomeTax({}, 600000, { spouseNoIncome: true, children: 2 }).tax < mid.tax, 'family allowances reduce tax');
});

test('living cost split sums to the total; renting costs more than living with parents or owning', () => {
  const s = mk(30);
  const total = 100000;
  const sum = (lines) => lines.reduce((a, l) => a + l.amount, 0);
  const rent = splitLivingCost(s, total, { mode: 'rent' });
  assert.ok(Math.abs(sum(rent) - total * inflationFactor(s, 30)) < EXPENSE_SHARES.length);
  assert.equal(rent.find((l) => l.id === 'housing').amount > 0, true);
  assert.equal(splitLivingCost(s, total, { mode: 'family' }).some((l) => l.id === 'housing'), false);
  assert.ok(sum(splitLivingCost(s, total, { mode: 'own' })) < sum(rent));
  assert.equal(housingMode(mk(20), false), 'family');
  assert.equal(housingMode(mk(25), false), 'rent');
  assert.equal(housingMode(mk(25), true), 'own');
});

test('wages: tenure grows pay (3%/yr up to 15), minimum wage floors a weak salary, part-time floor, old saves unaffected', () => {
  assert.equal(tenureMultiplier(0), 1);
  assert.ok(Math.abs(tenureMultiplier(10) - 1.3) < 1e-9);
  assert.ok(Math.abs(tenureMultiplier(40) - 1.45) < 1e-9);
  const job = { job_id: 'j', base_annual_salary_cash: 60000, job_category: 'corporate' };
  const mult = getCombinedActionMultipliers(mk(30));
  const young = mk(25, true); young.careerAndEdu.yearsInMainJob = 0;
  assert.ok(calculateJobAnnualIncome(job, young, mult, true) >= MIN_WAGE_ANNUAL * inflationFactor(young, 25) - 1);
  const senior = mk(25, true); senior.careerAndEdu.yearsInMainJob = 10;
  const strong = { ...job, base_annual_salary_cash: 400000 };
  assert.ok(calculateJobAnnualIncome(strong, senior, mult, true) > calculateJobAnnualIncome(strong, young, mult, true));
  const legacy = mk(25, false);
  assert.equal(calculateJobAnnualIncome(job, legacy, getCombinedActionMultipliers(legacy), true), 60000);
});

test('social security: pension needs 15+ years and age 55; unemployment benefit needs contributions and prior-year job', () => {
  const s = mk(60); s.finance.ssYears = 20; s.finance.ssAvgWage = 150000;
  assert.equal(socialSecurityPension(s), Math.round(150000 * (0.2 + 5 * 0.015)));
  s.finance.ssYears = 10; assert.equal(socialSecurityPension(s), 0);
  const u = mk(30); u.finance.ssYears = 3; u.finance.ssAvgWage = 120000; u.finance.ssLastYearAge = 29;
  assert.equal(socialSecurityUnemployment(u), 60000);
  u.finance.ssUnemploymentAge = 29; assert.equal(socialSecurityUnemployment(u), 0, 'once per 3 years');
  assert.equal(socialSecurityUnemployment(mk(30, false)), 0);
});

test('a realistic working year produces itemized costs, tax, social security and bonus; legacy mode stays unchanged', () => {
  const job = db.indexes.jobs.get('career_software_engineer');
  assert.ok(job);
  const s = mk(30, true, 'career_software_engineer'); s.careerAndEdu.yearsInMainJob = 5; s.finance.cash = 0;
  const slip = processAnnualEconomyAndMarket(s);
  const labels = slip.expenseItems.map((i) => i.labelTh).join('|');
  for (const word of ['ค่าเช่า', 'ค่าอาหาร', 'ค่าเดินทาง', 'ประกันสังคม']) assert.ok(labels.includes(word), word);
  assert.ok(slip.expenseBreakdown.housing > 0 && slip.expenseBreakdown.food > 0);
  assert.ok(slip.expenseBreakdown.social_security > 0 && slip.expenseBreakdown.social_security <= 9000);
  assert.ok(slip.incomeBreakdown.employment > 0);
  assert.equal(s.finance.ssYears, 1);
  assert.ok(s.finance.lastTaxReport.employmentIncome >= slip.incomeBreakdown.employment);
  const legacy = mk(30, false, 'career_software_engineer'); legacy.finance.cash = 0;
  const lslip = processAnnualEconomyAndMarket(legacy);
  assert.equal(lslip.expenseBreakdown.tax, undefined);
  assert.equal(lslip.expenseBreakdown.housing, undefined);
  assert.ok(lslip.expenseBreakdown.living > 0);
});

test('kids and young adults with no job and no home pay no rent', () => {
  const s = mk(20, true); s.finance.cash = 0;
  const slip = processAnnualEconomyAndMarket(s);
  assert.equal(slip.expenseBreakdown.housing, undefined);
  assert.ok(slip.expenseBreakdown.food > 0);
});
