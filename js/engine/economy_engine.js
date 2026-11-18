/**
 * js/engine/economy_engine.js
 * โมดูลคำนวณระบบเศรษฐกิจรายปี, ตลาดหุ้น/คริปโต, สลากกินแบ่งฯ/สลากออมสิน,
 * ร้านค้า (ซื้อสด/ผ่อน), สินทรัพย์, สินเชื่อเครดิตบูโร และโปรโตคอลจัดการเงินสดติดลบ
 */

import { db } from '../core/db.js';
import { calculateParentalSupport } from '../core/family_support.js';
import { applyStatEffects as applyCoreStatEffects } from '../core/stat_engine.js';
import { recalculateNetWorth, saveGame } from '../core/state.js';
import { adjustJobIncome, bonusMonths, computeIncomeTax, housingMode, inflationFactor, recordSocialSecurityYear, socialSecurityPayable, socialSecurityPension, socialSecurityUnemployment, splitLivingCost } from './money_realism_engine.js';
import {
  clampStat,
  checkRequirement,
  getPlayerFlagSet,
  weightedRandom,
  rollChance,
  randomFloat,
  formatCurrency
} from '../core/utils.js';

// ============================================================================
// Internal Helpers (จัดการเพิ่ม/ลบป้ายสถานะ และบวกค่า Stat อย่างปลอดภัย)
// ============================================================================

/**
 * ตัดสินว่าป้าย ID นี้ควรเก็บลง Array หมวดไหนใน state (talentTags / statuses / innateTraits / flags)
 * @param {object} state
 * @param {string} flagId
 */
function addFlagOrStatusToState(state, flagId) {
  if (!flagId || typeof flagId !== 'string') return;
  const activeSet = getPlayerFlagSet(state);
  if (activeSet.has(flagId)) return;

  const def = db.getTraitOrFlag(flagId);
  const group = def?.category_group;

  if (group === 'talent_tags' || flagId.startsWith('tag_')) {
    if (!state.talentTags.includes(flagId)) state.talentTags.push(flagId);
  } else if (group === 'health_and_mental_statuses' || flagId.startsWith('status_') || flagId === 'flag_depression') {
    if (!state.statuses.includes(flagId)) state.statuses.push(flagId);
  } else if (group === 'innate_traits' || flagId.startsWith('trait_')) {
    if (!state.innateTraits.includes(flagId)) state.innateTraits.push(flagId);
  } else {
    if (!state.flags.includes(flagId)) state.flags.push(flagId);
  }
}

/**
 * ลบป้ายสถานะออกจากทุกหมวดใน state
 * @param {object} state
 * @param {string} flagId
 */
function removeFlagOrStatusFromState(state, flagId) {
  if (!flagId) return;
  state.flags = (state.flags || []).filter((f) => f !== flagId);
  state.talentTags = (state.talentTags || []).filter((f) => f !== flagId);
  state.statuses = (state.statuses || []).filter((f) => f !== flagId);
  state.innateTraits = (state.innateTraits || []).filter((f) => f !== flagId);
}

/**
 * ประยุกต์ค่า stat_effects เข้าสู่ state.stats พร้อมจำกัดเพดานตามกฎเกม
 * @param {object} state
 * @param {Record<string, number>} effects
 */
function applyStatEffects(state, effects) {
  if (!effects || typeof effects !== 'object' || !state.stats) return;

  applyCoreStatEffects(state, effects);
}

/**
 * เพิ่มเงินเข้ากระเป๋าผู้เล่น (หากอายุ < 7 และยังไม่ทุบกระปุก จะหยอดเข้า piggyBank อัตโนมัติ)
 * @param {object} state
 * @param {number} amount
 */
function addMoneyRespectingPiggyBank(state, amount) {
  const val = Math.round(Number(amount || 0));
  if (val === 0) return;

  if (state.profile.age < 7 && !state.finance.hasPiggyBankSmashed && val > 0) {
    state.finance.piggyBank = Math.round(Number(state.finance.piggyBank || 0) + val);
  } else {
    state.finance.cash = Math.round(Number(state.finance.cash || 0) + val);
  }
}

/**
 * บันทึกเหตุการณ์ทางการเงินลงใน Life Feed (Tab 1)
 */
function pushEconomyLog(state, title, message, monthTh = 'มกราคม', type = 'economy') {
  if (!Array.isArray(state.turn?.lifeFeedLog)) return;
  state.turn.lifeFeedLog.push({
    age: state.profile.age,
    monthTh,
    type,
    title,
    message
  });
}

/**
 * ทอยตารางสลากกินแบ่งรัฐบาล / สลากออมสิน จาก Market_&_Investments.json
 * @param {object} state
 * @param {'item_government_lottery'|'inv_gsb_lottery_bond'} sourceType
 * @param {number} [ticketMultiplier=1] ตัวคูณจำนวนสิทธิ์ (กรณีถือสลากออมสินมูลค่าสูง)
 * @returns {object} ผลรางวัลที่ได้
 */
export function rollLuckyDrawTable(state, sourceType, ticketMultiplier = 1) {
  const table = (db.raw.market?.lottery_and_lucky_draw_table || []).filter((p) =>
    Array.isArray(p.applicable_to) ? p.applicable_to.includes(sourceType) : true
  );

  if (table.length === 0) {
    return { won: false, prizeId: 'prize_none', rewardCash: 0, titleTh: 'ไม่ถูกรางวัล', descriptionTh: '' };
  }

  const mults = getCombinedActionMultipliers(state);
  const luckyMult = Number(mults.lucky_draw_chance || 1.0);
  const meritVal = Math.max(0, Number(state.stats?.merit || 0));
  // จำกัดตัวคูณจำนวนหน่วยสลากออมสินเพื่อความสมดุล (สูงสุด 10 เท่าของโอกาสพื้นฐาน)
  const unitFactor = Math.min(10, Math.max(1, Number(ticketMultiplier || 1)));

  const weightedEntries = [];
  let nonNoneChanceSum = 0;

  for (const prize of table) {
    if (prize.prize_id === 'prize_none') continue;

    let weight = Number(prize.base_chance_percent || 0);
    if (prize.affected_by_lucky_multiplier) {
      weight *= luckyMult;
    }
    if (prize.merit_bonus_weight_per_10_merit) {
      const meritBlocks = Math.floor(meritVal / 10);
      weight += meritBlocks * Number(prize.merit_bonus_weight_per_10_merit);
    }
    weight *= unitFactor;

    nonNoneChanceSum += weight;
    weightedEntries.push({ prize, weight });
  }

  const noneEntry = table.find((p) => p.prize_id === 'prize_none');
  if (noneEntry) {
    const noneWeight = Math.max(5, 100 - nonNoneChanceSum);
    weightedEntries.push({ prize: noneEntry, weight: noneWeight });
  }

  const picked = weightedRandom(weightedEntries, 'weight')?.prize || noneEntry || table[0];
  const rewardCash = Math.round(Number(picked.reward_cash || 0));
  const won = picked.prize_id !== 'prize_none' && rewardCash > 0;

  // ประมวลผลรางวัลเข้าตัวละครทันที
  if (rewardCash > 0) {
    state.finance.cash = Math.round(Number(state.finance.cash || 0) + rewardCash);
  }
  if (picked.stat_effects) {
    applyStatEffects(state, picked.stat_effects);
  }
  for (const fg of picked.grants_flags || []) {
    addFlagOrStatusToState(state, fg);
  }

  return {
    won,
    prizeId: picked.prize_id,
    nameTh: picked.name_th,
    rewardCash,
    descriptionTh: picked.description_th
  };
}

// ============================================================================
// 1. ตัวคูณประสิทธิภาพรวมจากทุกป้ายสถานะของผู้เล่น
// ============================================================================

/**
 * คำนวณตัวคูณรวม (Action Multipliers) จากป้ายสถานะ พรสวรรค์ และโรคประจำตัวทั้งหมดของผู้เล่น
 * @param {object} state GameState ปัจจุบัน
 * @returns {{
 *   study_efficiency: number,
 *   work_efficiency: number,
 *   business_income: number,
 *   medical_cost: number,
 *   lucky_draw_chance: number,
 *   vehicle_maintenance_cost: number,
 *   loan_interest_rate: number
 * }}
 */
export function getCombinedActionMultipliers(state) {
  const combined = {
    study_efficiency: 1.0,
    work_efficiency: 1.0,
    business_income: 1.0,
    medical_cost: 1.0,
    lucky_draw_chance: 1.0,
    vehicle_maintenance_cost: 1.0,
    loan_interest_rate: 1.0
  };

  if (!state) return combined;

  const activeFlags = getPlayerFlagSet(state);
  for (const flagId of activeFlags) {
    const def = db.getTraitOrFlag(flagId);
    const mults = def?.action_multipliers;
    if (!mults || typeof mults !== 'object') continue;

    for (const key of Object.keys(combined)) {
      if (mults[key] !== undefined && Number.isFinite(Number(mults[key]))) {
        combined[key] *= Number(mults[key]);
      }
    }
  }

  // Bound compounded Trait/Status modifiers to avoid runaway economy and action odds.
  const bounds = {
    study_efficiency:[0.25,1.75],work_efficiency:[0.25,1.75],business_income:[0.25,2.0],
    medical_cost:[0,3.0],lucky_draw_chance:[0.5,2.5],vehicle_maintenance_cost:[0.25,2.5],loan_interest_rate:[0.25,2.5]
  };
  for (const key of Object.keys(combined)) {
    const [min,max] = bounds[key] || [0,3];
    combined[key] = Number(Math.min(max,Math.max(min,combined[key])).toFixed(4));
  }

  return combined;
}

// ============================================================================
// 2. พิธีทุบกระปุกออมสินลูกหมูเมื่ออายุครบ 7 ปีบริบูรณ์
// ============================================================================

/**
 * โอนเงินทั้งหมดจากกระปุกออมสินเข้าเงินสด/บัญชี พร้อมปลดล็อกบัญชีธนาคารและบัตรประชาชนเด็ก
 * @param {object} state GameState ปัจจุบัน
 * @returns {{ smashed: boolean, transferredAmount: number }}
 */
export function smashPiggyBankAtAge7(state) {
  if (!state || !state.finance) {
    return { smashed: false, transferredAmount: 0 };
  }

  const piggyAmount = Math.max(0, Math.round(Number(state.finance.piggyBank || 0)));

  state.finance.cash = Math.round(Number(state.finance.cash || 0) + piggyAmount);
  state.finance.piggyBank = 0;
  state.finance.hasPiggyBankSmashed = true;

  addFlagOrStatusToState(state, 'flag_bank_account');
  addFlagOrStatusToState(state, 'flag_thai_id_card');

  recalculateNetWorth(state);

  return {
    smashed: true,
    transferredAmount: piggyAmount
  };
}

// ============================================================================
// 3. ระบบคำนวณเศรษฐกิจ งบการเงิน ตลาดหุ้น และสินทรัพย์ประจำปี
// ============================================================================

/**
 * คำนวณเบี้ยยังชีพผู้สูงอายุขั้นบันไดรายปี (อายุ 60 ปีขึ้นไป)
 * @param {number} age
 * @returns {number}
 */
export function getElderAnnualAllowance(age) {
  if (age < 60) return 0;
  if (age >= 90) return 12000; // 1,000 บาท/เดือน
  if (age >= 80) return 9600;  // 800 บาท/เดือน
  if (age >= 70) return 8400;  // 700 บาท/เดือน
  return 7200;                 // 600 บาท/เดือน (60-69 ปี)
}

/**
 * คำนวณรายได้ต่อปีของอาชีพ 1 อาชีพ
 * @param {object} jobDef ข้อมูลอาชีพจาก db.getJob(jobId)
 * @param {object} state
 * @param {object} multipliers ผลลัพธ์จาก getCombinedActionMultipliers(state)
 * @param {boolean} [isMainCareer=true]
 * @returns {number}
 */
export function calculateJobAnnualIncome(jobDef, state, multipliers, isMainCareer = true) {
  if (!jobDef) return 0;

  const baseIncome = Number(jobDef.base_annual_salary_cash ?? jobDef.base_annual_income_cash ?? 0);
  if (baseIncome <= 0) return 0;

  const loc = db.getLocation(state.profile.currentLocationId);
  const locJobMult = jobDef.affected_by_location_multiplier
    ? Number(loc?.job_opportunity_multiplier ?? 1.0)
    : 1.0;

  const perfMult = jobDef.affected_by_business_multiplier
    ? Number(multipliers.business_income ?? 1.0)
    : Number(multipliers.work_efficiency ?? 1.0);

  const careerRankMult = isMainCareer
    ? Number(state.careerAndEdu?.salaryMultiplier ?? 1.0)
    : 1.0;

  return adjustJobIncome(state, jobDef, Math.round(baseIncome * locJobMult * perfMult * careerRankMult), isMainCareer);
}

/**
 * ประมวลผลเศรษฐกิจรายปี ตลาดหุ้น ดอกเบี้ยเงินกู้/ผ่อนสินค้า และบันทึกสลิปลง state.finance.lastAnnualSlip
 * @param {object} state GameState ปัจจุบัน
 * @returns {object} ข้อมูลสรุปสลิปประจำปี (lastAnnualSlip)
 */
export function processAnnualEconomyAndMarket(state) {
  if (!state || !state.finance) {
    throw new Error('[EconomyEngine] GameState ไม่ถูกต้อง');
  }

  const age = Number(state.profile.age || 0);
  const currentLoc = db.getLocation(state.profile.currentLocationId);
  const spawnClass = db.getClass(state.profile.spawnClassId);
  const activeFlags = getPlayerFlagSet(state);
  const multipliers = getCombinedActionMultipliers(state);

  // หากอายุครบ 7 ปีบริบูรณ์แต่ยังไม่ได้ทุบกระปุก ให้ทุบกระปุกโอนเข้าเงินสดอัตโนมัติ
  let piggySmashBonus = 0;
  if (age >= 7 && !state.finance.hasPiggyBankSmashed) {
    const res = smashPiggyBankAtAge7(state);
    piggySmashBonus = res.transferredAmount;
  }

  const startingCash = Number(state.finance.cash || 0);
  const startingPiggy = Number(state.finance.piggyBank || 0);

  const incomeItems = [];
  const expenseItems = [];
  const marketItems = [];
  let gsbLotteryResult = null;

  let totalCashIncome = 0;
  let totalPiggyIncome = 0;
  let totalCashExpense = 0;

  const recordIncome = (labelTh, amount, toPiggy = false, category = 'other') => {
    const val = Math.round(Number(amount || 0));
    if (val <= 0) return;
    if (toPiggy) {
      state.finance.piggyBank = Math.round(Number(state.finance.piggyBank || 0) + val);
      totalPiggyIncome += val;
      incomeItems.push({ labelTh: `${labelTh} (หยอดกระปุก 🐷)`, amount: val, wallet: 'piggyBank', category });
    } else {
      state.finance.cash = Math.round(Number(state.finance.cash || 0) + val);
      totalCashIncome += val;
      incomeItems.push({ labelTh, amount: val, wallet: 'cash', category });
    }
  };

  const recordExpense = (labelTh, amount, category = 'other') => {
    const val = Math.round(Math.abs(Number(amount || 0)));
    if (val <= 0) return;
    state.finance.cash = Math.round(Number(state.finance.cash || 0) - val);
    totalCashExpense += val;
    expenseItems.push({ labelTh, amount: -val, category });
  };

  // =========================================================================
  // [A] ฝั่งรายรับ (ANNUAL INCOMES)
  // =========================================================================

  // A1. Family support: separate age-appropriate pocket money from direct-paid care.
  let familySupport={cashAllowance:0,familyPaidSupport:0,familySupportCapacity:0,supportMultiplier:0,ageRate:0};
  if(age>=0&&age<=17){
    const baseSupport=Number(spawnClass?.parent_annual_support_age_0_to_17??state.finance.parentAnnualSupport??0);
    familySupport=calculateParentalSupport({state,age,baseAnnualSupport:baseSupport,gameConstants:db.getGameConstants()});
    state.finance.parentAnnualSupport=familySupport.cashAllowance;
    state.finance.parentPaidSupportAnnual=familySupport.familyPaidSupport;
    if(familySupport.cashAllowance>0){
      const toPiggy=age<7&&!state.finance.hasPiggyBankSmashed;
      recordIncome('เงินค่าขนมจากครอบครัว', familySupport.cashAllowance, toPiggy, 'family');
    }
  }else{
    state.finance.parentAnnualSupport=0;
    state.finance.parentPaidSupportAnnual=0;
  }

  // A2. รายได้จากอาชีพหลัก (mainJobId) และงานพาร์ทไทม์ (partTimeJobId เฉพาะกำลังเรียน)
  const isConscripted2Yrs = activeFlags.has('flag_conscript_soldier_2yrs') || Number(state.careerAndEdu?.conscriptionYearsLeft || 0) > 0;
  const isStudyingSchoolOrUni =
    Boolean(state.careerAndEdu?.activeStudy) ||
    activeFlags.has('flag_middle_school_student') ||
    activeFlags.has('flag_high_school_student') ||
    age < 18;

  const realism = Boolean(state.finance.realismV2);
  let mainJobDef = null;
  let mainIncomeAmt = 0;
  let ptIncomeAmt = 0;
  let ptJobDef = null;
  if (!isConscripted2Yrs && state.careerAndEdu?.mainJobId) {
    const mainJob = db.getJob(state.careerAndEdu.mainJobId);
    if (mainJob) {
      const mainIncome = calculateJobAnnualIncome(mainJob, state, multipliers, true);
      recordIncome(`รายได้หลัก: ${mainJob.name_th}`, mainIncome, false, 'employment');
      mainJobDef = mainJob; mainIncomeAmt = mainIncome;
      if (realism) {
        const months = bonusMonths(state, mainJob);
        if (months > 0) recordIncome(`โบนัสสิ้นปี (${months} เดือน)`, (mainIncome / 12) * months, false, 'bonus');
        if (mainJob.job_category === 'civil_service') recordIncome('สวัสดิการรักษาพยาบาลและค่าเล่าเรียนบุตรข้าราชการ', 8000 * inflationFactor(state, age), false, 'benefits');
      }
    }
  }

  if (!isConscripted2Yrs && state.careerAndEdu?.partTimeJobId) {
    const ptJob = db.getJob(state.careerAndEdu.partTimeJobId);
    // กฎเหล็ก: ถือพาร์ทไทม์ควบได้เฉพาะตอนกำลังเรียน (หรือกรณียังไม่มีอาชีพหลัก)
    if (ptJob && (isStudyingSchoolOrUni || !state.careerAndEdu?.mainJobId)) {
      const ptIncome = calculateJobAnnualIncome(ptJob, state, multipliers, false);
      recordIncome(`งานพาร์ทไทม์/เสริม: ${ptJob.name_th}`, ptIncome, false, 'employment');
      ptJobDef = ptJob; ptIncomeAmt = ptIncome;
    }
  }

  // A3. รายได้สุทธิจากคู่สมรส (กรณีจดทะเบียนสมรสแล้ว)
  const partner = state.relationships?.partner;
  if (partner && (partner.status === 'married' || activeFlags.has('flag_married_registered'))) {
    const partnerArch = db.indexes.partnerArchetypes.get(partner.archetypeId);
    const spouseNetContribution = Number(
      partner.netAnnualCashContribution ??
      partnerArch?.spouse_economy_after_marriage?.net_annual_cash_contribution ??
      0
    );
    if (spouseNetContribution > 0) {
      recordIncome(`รายได้ร่วมจากคู่สมรส (${partner.name})`, spouseNetContribution, false, 'family');
    } else if (spouseNetContribution < 0) {
      recordExpense(`ภาระค่าใช้จ่ายคู่สมรส (${partner.name})`, Math.abs(spouseNetContribution), 'family');
    }
  }

  // A4. รายได้ลูกกตัญญูส่งเสีย (หรือรายจ่ายกรณีลูกแหง่ Tier C ติดลบ)
  const childOutcomesList = db.raw.npcs?.child_graduation_and_legacy_outcomes || [];
  for (const child of state.relationships?.children || []) {
    if (!child.outcomeId) continue;
    const outDef = childOutcomesList.find((o) => o.outcome_id === child.outcomeId);
    const filialCash = Number(outDef?.annual_filial_support_cash || 0);
    if (filialCash > 0) {
      recordIncome(`เงินกตัญญูจากลูก (${child.name})`, filialCash, false, 'family');
    } else if (filialCash < 0) {
      recordExpense(`ลูกขอเงินใช้ (${child.name})`, Math.abs(filialCash), 'family');
    }
  }

  // A5. รายได้ค่าเช่าอสังหาริมทรัพย์ (Passive Rental Yield)
  for (const owned of state.finance.ownedAssets || []) {
    const itemDef = db.getShopItem(owned.itemId);
    const rentalYield = Number(itemDef?.annual_rental_yield_cash || 0);
    if (rentalYield > 0) {
      recordIncome(`ค่าเช่า/ผลผลิต: ${itemDef.name_th}`, rentalYield, false, 'assets');
    }
  }

  // A6. ดอกเบี้ยเงินฝากและเงินปันผลพอร์ตลงทุน (หักภาษี ณ ที่จ่าย 10% ยกเว้นบัญชีออมสิน & สลากออมสิน)
  const invRules = db.raw.market?.investment_rules_and_modifiers || {};
  const eliteDivBonus = activeFlags.has(invRules.elite_connection_flag || 'flag_elite_connection')
    ? Number(invRules.elite_dividend_bonus || 0.02)
    : 0;
  const dividendTaxRate = Number(invRules.dividend_withholding_tax_rate ?? 0.10);
  const taxExemptInstrumentIds = new Set(['inv_gsb_savings', 'inv_gsb_lottery_bond']);

  for (const [instId, holding] of Object.entries(state.finance.investments || {})) {
    const investedAmt = Number(holding?.amountCash || 0);
    if (investedAmt <= 0) continue;

    const instDef = db.getInstrument(instId);
    if (!instDef) continue;

    const baseDivRate = Number(instDef.base_annual_dividend_rate || 0);
    if (baseDivRate <= 0) continue;

    const effectiveDivRate = taxExemptInstrumentIds.has(instId)
      ? baseDivRate
      : baseDivRate + eliteDivBonus;

    const grossDividend = investedAmt * effectiveDivRate;
    const netDividend = taxExemptInstrumentIds.has(instId)
      ? Math.round(grossDividend)
      : Math.round(grossDividend * (1 - dividendTaxRate));

    if (netDividend > 0) {
      const toPiggy = age < 7 && !state.finance.hasPiggyBankSmashed;
      recordIncome(
        taxExemptInstrumentIds.has(instId)
          ? `ดอกเบี้ย: ${instDef.name_th}`
          : `เงินปันผลสุทธิ: ${instDef.name_th}`,
        netDividend,
        toPiggy,
        'investment'
      );
    }
  }

  // A7. สวัสดิการ เบี้ยยังชีพผู้สูงอายุ และป้ายสถานะที่มีผลต่อเงินรายปี (yearly_stat_effects.cash)
  // หมายเหตุ: ข้าม flag_student_loan_debt และ flag_informal_shark_debt หากมีสินเชื่อตัวจริงอยู่ใน activeLoans แล้ว เพื่อไม่ให้หักซ้ำซ้อน
  const activeLoanIds = new Set((state.finance.activeLoans || []).map((l) => l.loanId));

  for (const flagId of activeFlags) {
    if (flagId === 'flag_student_loan_debt' && activeLoanIds.has('loan_student_gys')) continue;
    if (flagId === 'flag_informal_shark_debt' && activeLoanIds.has('loan_informal_loan_shark')) continue;

    const flagDef = db.getTraitOrFlag(flagId);
    if (!flagDef?.yearly_stat_effects) continue;

    const cashEffect = Number(flagDef.yearly_stat_effects.cash || 0);
    if (cashEffect === 0) continue;

    const minAgeForCash = Number(flagDef.cash_effect_min_age ?? 0);
    if (age < minAgeForCash) continue;

    if (cashEffect > 0) {
      const toPiggy = age < 7 && !state.finance.hasPiggyBankSmashed;
      recordIncome(`สิทธิพิเศษ/ป้ายสถานะ: ${flagDef.name_th}`, cashEffect, toPiggy, 'benefits');
    } else {
      // กรณีเป็นค่าใช้จ่ายจากโรคประจำตัว ให้คูณตัวคูณค่ารักษาพยาบาล (medical_cost) เช่น บัตรทอง 0.0 หรือประกันเอกชน 0.5
      let adjustedCost = Math.abs(cashEffect);
      if (flagDef.category_group === 'health_and_mental_statuses') {
        adjustedCost = Math.round(adjustedCost * Number(multipliers.medical_cost ?? 1.0));
      }
      if (adjustedCost > 0) {
        recordExpense(`ภาระจากป้ายสถานะ: ${flagDef.name_th}`, adjustedCost, 'medical');
      }
    }
  }

  // เบี้ยยังชีพผู้สูงอายุขั้นบันได (อายุ 60+)
  if (activeFlags.has('flag_elder_allowance_active') || age >= 60) {
    const elderCash = getElderAnnualAllowance(age);
    if (elderCash > 0) {
      recordIncome(`เบี้ยยังชีพผู้สูงอายุ (วัย ${age} ปี)`, elderCash, false, 'benefits');
    }
    // บำนาญข้าราชการรายปี (กรณีมีสิทธิ์บำนาญข้าราชการและเกษียณแล้ว)
    if (age >= 60 && activeFlags.has('flag_gov_pension_right')) {
      recordIncome('เงินบำนาญข้าราชการประจำปี', 144000, false, 'retirement');
    }
  }

  if (realism) {
    const ssPension = socialSecurityPension(state);
    if (ssPension > 0) recordIncome('บำนาญชราภาพจากประกันสังคม', ssPension, false, 'retirement');
    const ssUnemp = socialSecurityUnemployment(state);
    if (ssUnemp > 0) { recordIncome('เงินทดแทนกรณีว่างงาน (ประกันสังคม)', ssUnemp, false, 'benefits'); state.finance.ssUnemploymentAge = age; }
  }

  // =========================================================================
  // [B] ฝั่งรายจ่าย (ANNUAL EXPENSES & DEBT SERVICE)
  // =========================================================================

  // B1. ค่าครองชีพพื้นฐานรายปี (เริ่มคิดตั้งแต่อายุ 18 ปีขึ้นไปตาม Core_Rules_&_Locations.json)
  const livingCostStartAge = Number(db.getGameConstants()?.living_cost_start_age ?? 18);
  const phaseInfo = db.getLifePhaseByAge(age);
  const baseLiving = age >= livingCostStartAge ? Number(phaseInfo?.baseAnnualLivingCost || 0) : 0;
  state.finance.baseAnnualLivingCost = baseLiving;

  if (baseLiving > 0) {
    const locColMult = Number(currentLoc?.cost_of_living_multiplier ?? 1.0);

    // ตัวคูณค่าครองชีพจากนิสัยการเงินของคู่สมรส
    let spouseLivingMult = 1.0;
    if (partner && (partner.status === 'married' || activeFlags.has('flag_married_registered')) && partner.financialTraitId) {
      const spTrait = db.indexes.spouseTraits.get(partner.financialTraitId);
      if (spTrait?.household_living_cost_multiplier) {
        spouseLivingMult = Number(spTrait.household_living_cost_multiplier);
      }
    }

    // ส่วนลดค่าที่พัก 20% หากมีบ้านของตัวเอง หรือเป็นคน กทม. แต่กำเนิดแล้วอาศัยอยู่ใน กทม.
    const hasHousingSaving =
      activeFlags.has('flag_has_own_home') ||
      (state.profile.currentLocationId === 'loc_bangkok' && activeFlags.has('flag_bkk_native'));
    const ownHome = activeFlags.has('flag_has_own_home');
    const housingDiscountMult = realism && ownHome ? 1.0 : hasHousingSaving ? 0.8 : 1.0;

    const finalLivingCost = Math.round(baseLiving * locColMult * spouseLivingMult * housingDiscountMult);
    if (realism) {
      const mode = housingMode(state, ownHome);
      state.finance.housingMode = mode;
      for (const line of splitLivingCost(state, finalLivingCost, { mode })) recordExpense(`${line.label} (${currentLoc?.name_th || 'ทั่วไป'})`, line.amount, line.id);
    } else recordExpense(
      `ค่าครองชีพประจำปี (${currentLoc?.name_th || 'ทั่วไป'}${hasHousingSaving ? ' - ประหยัดค่าเช่าบ้าน 20%' : ''})`,
      finalLivingCost,
      'living'
    );
  }

  // B1.5 ภาษีเงินได้และประกันสังคม (ตัวละครแบบสมจริง)
  if (realism) {
    const ssPaid = socialSecurityPayable(mainJobDef, mainIncomeAmt) + socialSecurityPayable(ptJobDef, ptIncomeAmt);
    const employmentIncome = incomeItems.filter((i) => i.category === 'employment' || i.category === 'bonus').reduce((a, i) => a + Number(i.amount || 0), 0);
    const married = partner && (partner.status === 'married' || activeFlags.has('flag_married_registered'));
    const kids = (state.relationships?.children || []).length;
    if (ssPaid > 0) { recordExpense('ประกันสังคม (หักจากเงินเดือน 5%)', ssPaid, 'social_security'); recordSocialSecurityYear(state, mainIncomeAmt + ptIncomeAmt); }
    const taxRes = computeIncomeTax(state, employmentIncome, { ssPaid, spouseNoIncome: Boolean(married && Number(partner?.netAnnualCashContribution || 0) <= 0), children: kids });
    if (taxRes.tax > 0) recordExpense(`ภาษีเงินได้บุคคลธรรมดา (เงินได้สุทธิ ${taxRes.taxable.toLocaleString('th-TH')} บาท)`, taxRes.tax, 'tax');
    state.finance.lastTaxReport = { age, employmentIncome: Math.round(employmentIncome), ...taxRes, ssPaid };
  }

  // B2. ค่ากิจกรรมพัฒนาการตามวัย, ค่าเทอมมหาวิทยาลัย และนโยบายเลี้ยงลูก
  if (state.careerAndEdu?.currentActivityId) {
    const actDef = db.getActivity(state.careerAndEdu.currentActivityId);
    if (actDef && age >= actDef.min_age && age <= actDef.max_age && Number(actDef.annual_cost_cash || 0) > 0) {
      recordExpense(`ค่ากิจกรรม: ${actDef.name_th}`, Number(actDef.annual_cost_cash), 'education');
    }
  }

  const activeStudy = state.careerAndEdu?.activeStudy;
  if (activeStudy && activeStudy.programId) {
    const progDef = db.getProgram(activeStudy.programId);
    const tuition = Number(activeStudy.annualTuition ?? progDef?.annual_tuition_cash ?? 0);
    if (tuition > 0) {
      if (activeStudy.useStudentLoan) {
        // ทบยอดค่าเทอมเข้าเงินต้นหนี้ กยศ. อัตโนมัติแทนการตัดเงินสด
        let gysLoan = (state.finance.activeLoans || []).find((l) => l.loanId === 'loan_student_gys');
        const gysDef = db.getLoanProduct('loan_student_gys');
        if (!gysLoan) {
          gysLoan = {
            loanId: 'loan_student_gys',
            principalRemaining: 0,
            annualRate: Number(gysDef?.annual_interest_rate ?? 0.01),
            missedYears: 0,
            takenAge: age
          };
          state.finance.activeLoans.push(gysLoan);
        }
        const maxGys = Number(gysDef?.max_principal_cash ?? 240000);
        const loanable = Math.max(0, Math.min(tuition, maxGys - gysLoan.principalRemaining));
        gysLoan.principalRemaining += loanable;
        addFlagOrStatusToState(state, 'flag_student_loan_debt');

        const outOfPocket = tuition - loanable;
        if (outOfPocket > 0) {
          recordExpense(`ค่าเทอมส่วนเกินวงเงิน กยศ. (${progDef?.name_th || ''})`, outOfPocket, 'education');
        }
      } else {
        recordExpense(`ค่าเทอม: ${progDef?.name_th || activeStudy.programId}`, tuition, 'education');
      }
    }
  }

  // ค่าใช้จ่ายเลี้ยงดูบุตรตามนโยบาย 4 ช่วงวัย
  const childPolicies = db.raw.npcs?.child_upbringing_policies || [];
  for (const child of state.relationships?.children || []) {
    const childAge = Number(child.age ?? 0);
    if (childAge > 21 || child.outcomeId) continue;

    const stageDef = childPolicies.find(
      (s) => childAge >= s.trigger_child_age && childAge < s.trigger_child_age + s.duration_years
    );
    if (!stageDef) continue;

    const chosenOpt =
      (stageDef.policy_options || []).find((o) => o.option_id === child.currentPolicyId) ||
      stageDef.policy_options?.[0];

    const childCost = Number(chosenOpt?.annual_auto_cost_cash || 0);
    if (childCost > 0) {
      recordExpense(`ค่าเลี้ยงดูบุตร (${child.name} - ${chosenOpt.name_th})`, childCost, 'family');
    }
  }

  // B3. หักค่างวดผ่อนสินค้า/รถ/บ้าน (installments)
  const remainingInstallments = [];
  for (const inst of state.finance.installments || []) {
    const payAmt = Math.round(Number(inst.annualPayment || 0));
    const itemDef = db.getShopItem(inst.itemId);
    if (payAmt > 0) {
      recordExpense(`ค่างวดผ่อน: ${itemDef?.name_th || inst.itemId}`, payAmt, 'installment');
    }
    const nextYears = Number(inst.yearsRemaining || 1) - 1;
    if (nextYears > 0) {
      remainingInstallments.push({ ...inst, yearsRemaining: nextYears });
    } else {
      pushEconomyLog(
        state,
        '🎉 ผ่อนชำระครบสัญญา!',
        `คุณผ่อนชำระ "${itemDef?.name_th || inst.itemId}" ครบทุกงวดเรียบร้อยแล้ว!`,
        'ธันวาคม'
      );
    }
  }
  state.finance.installments = remainingInstallments;

  // B4. หักชำระสินเชื่อคงค้าง (activeLoans) และอัปเดตประวัติเครดิตบูโร
  const creditRules = db.raw.loansCrisesEndings?.loan_products_and_credit_rules?.credit_bureau_mechanics || {};
  const goodCreditDiscount = activeFlags.has(creditRules.good_credit_flag || 'flag_credit_good')
    ? Number(creditRules.good_credit_interest_discount_multiplier ?? 0.8)
    : 1.0;

  let hadDueLoanThisYear = false;
  let paidAllDueLoansOnTime = true;
  const updatedLoans = [];

  for (const loan of state.finance.activeLoans || []) {
    const prod = db.getLoanProduct(loan.loanId);
    let principal = Math.round(Number(loan.principalRemaining || 0));
    if (principal <= 0) {
      if (prod?.grants_flag_while_active) {
        removeFlagOrStatusFromState(state, prod.grants_flag_while_active);
      }
      continue;
    }

    // หนี้ กยศ. ยังไม่ต้องจ่ายจนกว่าจะอายุครบ repayment_start_age (24 ปี)
    const repayStartAge = Number(prod?.repayment_start_age ?? 0);
    if (age < repayStartAge) {
      updatedLoans.push(loan);
      continue;
    }

    hadDueLoanThisYear = true;

    // คำนวณอัตราดอกเบี้ยรายปี
    const baseRate = Number(loan.annualRate ?? prod?.annual_interest_rate ?? 0.1);
    const effectiveRate = loan.loanId === 'loan_informal_loan_shark' || loan.loanId === 'loan_student_gys'
      ? baseRate
      : baseRate * goodCreditDiscount * Number(multipliers.loan_interest_rate ?? 1.0);

    const annualInterest = Math.round(principal * effectiveRate);
    let requiredInstallment = 0;

    if (loan.loanId === 'loan_informal_loan_shark') {
      // หนี้นอกระบบ: หักดอกเบี้ยโหดขั้นต่ำ 36,000 บาท หรือ 60% ของต้นคงเหลือ (ไม่ตัดเงินต้นจนกว่าผู้เล่นจะกดโปะเอง!)
      const minSharkInterest = Number(prod?.annual_minimum_interest_payment ?? 36000);
      requiredInstallment = Math.max(minSharkInterest, annualInterest);
      recordExpense(`ดอกเบี้ยหนี้นอกระบบรายปี (ยังไม่ตัดต้น)`, requiredInstallment, 'debt');
      updatedLoans.push({
        ...loan,
        principalRemaining: principal
      });
      continue;
    }

    if (loan.loanId === 'loan_student_gys') {
      const baseGysInstallment = Number(prod?.annual_base_installment_cash ?? 15000);
      requiredInstallment = Math.min(principal + annualInterest, baseGysInstallment + annualInterest);
    } else {
      const maxYears = Math.max(1, Number(prod?.max_repayment_years ?? 5));
      const principalPortion = Math.ceil(principal / maxYears);
      requiredInstallment = Math.min(principal + annualInterest, principalPortion + annualInterest);
    }

    // เช็กว่ามีเงินพอจ่ายค่างวดในระบบหรือไม่
    if (state.finance.cash >= requiredInstallment) {
      recordExpense(`ชำระหนี้: ${prod?.name_th || loan.loanId}`, requiredInstallment, 'debt');
      const principalPaid = Math.max(0, requiredInstallment - annualInterest);
      principal = Math.max(0, principal - principalPaid);
      loan.missedYears = 0;
      removeFlagOrStatusFromState(state, 'flag_loan_payment_overdue');
    } else {
      // ผิดนัดชำระหนี้! ดอกเบี้ยทบต้น
      paidAllDueLoansOnTime = false;
      loan.missedYears = Number(loan.missedYears || 0) + 1;
      principal += annualInterest;
      addFlagOrStatusToState(state, 'flag_loan_payment_overdue');

      // ค้างชำระครบเกณฑ์ (2 ปี) ติดแบล็กลิสต์บูโร และเช็กยึดรถค้ำประกัน
      const blacklistThreshold = Number(creditRules.missed_payments_to_trigger_blacklist ?? 2);
      if (loan.missedYears >= blacklistThreshold) {
        addFlagOrStatusToState(state, creditRules.blacklist_flag || 'flag_credit_blacklist');
        removeFlagOrStatusFromState(state, creditRules.good_credit_flag || 'flag_credit_good');

        if (prod?.collateral_seizure_on_default) {
          // ยึดรถค้ำประกันทันทีเพื่อเคลียร์หนี้จำนำทะเบียนรถ
          const vehicleIdx = (state.finance.ownedAssets || []).findIndex((a) => {
            const def = db.getShopItem(a.itemId);
            return def?.shop_category === 'vehicles_assets';
          });
          if (vehicleIdx !== -1) {
            const [seized] = state.finance.ownedAssets.splice(vehicleIdx, 1);
            syncAssetFlagsAfterRemoval(state, seized.itemId);
            pushEconomyLog(
              state,
              '🚨 ไฟแนนซ์มายึดรถค้ำประกัน!',
              `เนื่องจากค้างชำระสินเชื่อจำนำทะเบียนรถครบ ${blacklistThreshold} ปี รถของคุณจึงถูกยึดขายทอดตลาดทันที!`,
              'ตุลาคม',
              'crisis'
            );
          }
          principal = 0;
        }
      }
    }

    if (principal > 0) {
      if (prod?.grants_flag_while_active) {
        addFlagOrStatusToState(state, prod.grants_flag_while_active);
      }
      updatedLoans.push({
        ...loan,
        principalRemaining: principal
      });
    } else {
      if (prod?.grants_flag_while_active) {
        removeFlagOrStatusFromState(state, prod.grants_flag_while_active);
      }
      pushEconomyLog(
        state,
        '✨ ปิดบัญชีสินเชื่อสำเร็จ!',
        `คุณผ่อนชำระ "${prod?.name_th || loan.loanId}" จนหมดเกลี้ยงเป็นไทแก่ตัวแล้ว!`,
        'ธันวาคม'
      );
    }
  }
  state.finance.activeLoans = updatedLoans;

  // อัปเดตตัวนับเครดิตบูโร (จ่ายตรงเวลาครบ 3 ปีได้ป้ายเครดิตดีเยี่ยม / หลังปิดหนี้ครบ 3 ปีปลดแบล็กลิสต์)
  if (hadDueLoanThisYear && paidAllDueLoansOnTime) {
    state.statCounters.onTimeLoanPaymentStreakYears = Number(state.statCounters.onTimeLoanPaymentStreakYears || 0) + 1;
    const reqStreak = Number(creditRules.consecutive_on_time_years_for_good_credit ?? 3);
    if (
      state.statCounters.onTimeLoanPaymentStreakYears >= reqStreak &&
      !getPlayerFlagSet(state).has('flag_credit_blacklist')
    ) {
      addFlagOrStatusToState(state, creditRules.good_credit_flag || 'flag_credit_good');
    }
  } else if (!paidAllDueLoansOnTime) {
    state.statCounters.onTimeLoanPaymentStreakYears = 0;
  }

  if (getPlayerFlagSet(state).has('flag_credit_blacklist') && state.finance.activeLoans.length === 0) {
    state.statCounters.blacklistClearedCountdownYears =
      Number(state.statCounters.blacklistClearedCountdownYears || 0) + 1;
    const clearYears = Number(creditRules.years_after_full_payoff_to_clear_blacklist ?? 3);
    if (state.statCounters.blacklistClearedCountdownYears >= clearYears) {
      removeFlagOrStatusFromState(state, 'flag_credit_blacklist');
      state.statCounters.blacklistClearedCountdownYears = 0;
      pushEconomyLog(
        state,
        '💳 ล้างประวัติเครดิตบูโรสำเร็จ!',
        `ครบ ${clearYears} ปีหลังปิดหนี้ค้างชำระ ประวัติเครดิตบูโรของคุณกลับมาขาวสะอาดอีกครั้ง!`,
        'มกราคม'
      );
    }
  }

  // =========================================================================
  // [C] อัปเดตข่าวตลาดหุ้น มูลค่าพอร์ตลงทุน สลากออมสิน และค่าเสื่อมสินทรัพย์
  // =========================================================================

  // C1. สุ่มข่าวตลาดประจำปี 1 ข่าวตามน้ำหนัก spawn_weight
  const newsPool = db.raw.market?.market_news_events || [];
  const pickedNews = weightedRandom(newsPool, 'spawn_weight') || newsPool[0] || null;
  state.finance.currentMarketNewsId = pickedNews?.news_id || null;

  const hasFinLit = getPlayerFlagSet(state).has(invRules.financial_literacy_flag || 'flag_financial_literacy');
  const lossMitigationMult = Number(invRules.loss_mitigation_multiplier ?? 0.75);
  const hasCryptoNerd = getPlayerFlagSet(state).has(invRules.crypto_nerd_flag || 'tag_computer_nerd');
  const cryptoBonusReturn = Number(invRules.crypto_bonus_return ?? 0.05);

  // C2. ปรับมูลค่าพอร์ตการลงทุนตามข่าวเศรษฐกิจ
  for (const [instId, holding] of Object.entries(state.finance.investments || {})) {
    const currentAmt = Number(holding?.amountCash || 0);
    if (currentAmt <= 0) continue;

    const instDef = db.getInstrument(instId);
    if (!instDef) continue;

    let pctChange = 0;
    if (pickedNews?.asset_price_changes && instId in pickedNews.asset_price_changes) {
      pctChange = Number(pickedNews.asset_price_changes[instId]);
    } else if (instDef.min_annual_price_change !== 0 || instDef.max_annual_price_change !== 0) {
      pctChange = randomFloat(instDef.min_annual_price_change, instDef.max_annual_price_change, 4);
    }

    // โบนัสเด็กเนิร์ดคอมเทรดคริปโต +5%
    if (instId === 'inv_crypto_bitcoin' && hasCryptoNerd) {
      pctChange += cryptoBonusReturn;
    }

    // ความรู้ทางการเงินช่วยลดผลขาดทุนเหลือ 75% ของยอดติดลบ
    if (pctChange < 0 && hasFinLit) {
      pctChange *= lossMitigationMult;
    }

    pctChange = Math.min(
      Number(instDef.max_annual_price_change ?? 2.0),
      Math.max(Number(instDef.min_annual_price_change ?? -0.9), pctChange)
    );

    if (pctChange !== 0) {
      const deltaCash = Math.round(currentAmt * pctChange);
      holding.amountCash = Math.max(0, currentAmt + deltaCash);
      marketItems.push({
        instrumentId: instId,
        nameTh: instDef.name_th,
        pctChange: Number((pctChange * 100).toFixed(2)),
        deltaValue: deltaCash,
        newTotalValue: holding.amountCash
      });
    }
  }

  // C3. ลุ้นรางวัลสลากออมสินพิเศษประจำปี (หากถือครอง >= 500 บาท)
  const gsbBondAmt = Number(state.finance.investments?.inv_gsb_lottery_bond?.amountCash || 0);
  if (gsbBondAmt >= 500) {
    // ทุกๆ 5,000 บาท เพิ่มตัวคูณสิทธิ์ลุ้นรางวัล (สูงสุด 10 เท่าในฟังก์ชัน rollLuckyDrawTable)
    const bondUnits = Math.max(1, gsbBondAmt / 5000);
    gsbLotteryResult = rollLuckyDrawTable(state, 'inv_gsb_lottery_bond', bondUnits);
    if (gsbLotteryResult.won) {
      totalCashIncome += gsbLotteryResult.rewardCash;
      incomeItems.push({
        labelTh: `🎉 ถูกรางวัลสลากออมสิน (${gsbLotteryResult.nameTh})`,
        amount: gsbLotteryResult.rewardCash,
        wallet: 'cash'
      });
      pushEconomyLog(
        state,
        `🎰 สลากออมสินให้โชค! ${gsbLotteryResult.nameTh}`,
        `รับเงินรางวัล ${formatCurrency(gsbLotteryResult.rewardCash)} โอนเข้ากระเป๋าทันที!`,
        'กรกฎาคม'
      );
    }
  }

  // C4. ปรับมูลค่าสินทรัพย์ในครอบครอง (ค่าเสื่อมราคารถ/แก็ดเจ็ต หรือมูลค่าเพิ่มบ้าน/ที่ดิน)
  for (const asset of state.finance.ownedAssets || []) {
    const itemDef = db.getShopItem(asset.itemId);
    if (!itemDef) continue;

    let rate = Number(itemDef.annual_appreciation_rate ?? itemDef.annual_depreciation_rate ?? 0);
    // หัวช่าง (tag_young_mechanic) ช่วยลดค่าเสื่อม/ค่าบำรุงรักษายานพาหนะ
    if (rate < 0 && itemDef.shop_category === 'vehicles_assets') {
      rate *= Number(multipliers.vehicle_maintenance_cost ?? 1.0);
    }

    if (rate !== 0) {
      const nextVal = Math.round(Number(asset.currentValue || 0) * (1 + rate));
      // มูลค่าซากขั้นต่ำไม่ต่ำกว่า 10% ของราคาซื้อตั้งต้น
      const minFloor = Math.round(Number(asset.purchasePrice ?? itemDef.price_cash ?? 0) * 0.1);
      asset.currentValue = Math.max(minFloor, nextVal);
    }
  }

  // คำนวณความมั่งคั่งสุทธิปิดท้าย
  const updatedNetWorth = recalculateNetWorth(state);

  const incomeBreakdown = incomeItems.reduce((totals, item) => {
    const category = item.category || 'other';
    totals[category] = (totals[category] || 0) + Number(item.amount || 0);
    return totals;
  }, {});

  const expenseBreakdown = expenseItems.reduce((totals, item) => {
    const category = item.category || 'other';
    totals[category] = (totals[category] || 0) + Math.abs(Number(item.amount || 0));
    return totals;
  }, {});

  const annualSlip = {
    age,
    yearBE: state.profile.currentYearBE,
    piggySmashBonus,
    startingCash,
    endingCash: state.finance.cash,
    startingPiggy,
    endingPiggy: state.finance.piggyBank,
    totalCashIncome,
    totalPiggyIncome,
    totalCashExpense,
    familySupportCashAllowance: familySupport.cashAllowance,
    familyPaidSupportAnnual: familySupport.familyPaidSupport,
    familySupportMultiplier: familySupport.supportMultiplier,
    netCashFlow: totalCashIncome - totalCashExpense,
    incomeItems,
    incomeBreakdown,
    expenseItems,
    expenseBreakdown,
    marketHeadlineTh: pickedNews?.headline_th || null,
    marketDescriptionTh: pickedNews?.description_th || null,
    marketItems,
    gsbLotteryResult,
    netWorth: updatedNetWorth
  };

  state.finance.lastAnnualSlip = annualSlip;
  return annualSlip;
}

// ============================================================================
// 4. ระบบโปรโตคอลเมื่อเงินสดติดลบสิ้นปี (Negative Cash End-of-Year Protocol)
// ============================================================================

/**
 * ตรวจสอบและแก้ไขสภาวะเงินสดติดลบตามโปรโตคอล 3 ขั้นตอนใน 9_Loans_Crises_&_Endings.json
 * @param {object} state
 * @returns {{
 *   resolved: boolean,
 *   deficitAmount: number,
 *   autoActionsLog: string[],
 *   availableOptions: Array<object>
 * }}
 */
export function resolveNegativeCashProtocol(state) {
  const autoActionsLog = [];

  if (!state || Number(state.finance?.cash || 0) >= 0) {
    return {
      resolved: true,
      deficitAmount: 0,
      autoActionsLog,
      availableOptions: []
    };
  }

  // Step 1: ถอนเงินจากบัญชีออมทรัพย์ ธ.ออมสิน (inv_gsb_savings) มาโปะอัตโนมัติเท่าที่มี
  const gsbHolding = state.finance.investments?.inv_gsb_savings;
  const gsbBalance = Math.max(0, Math.round(Number(gsbHolding?.amountCash || 0)));

  if (gsbBalance > 0 && state.finance.cash < 0) {
    const needed = Math.abs(state.finance.cash);
    const withdrawAmt = Math.min(gsbBalance, needed);
    gsbHolding.amountCash = gsbBalance - withdrawAmt;
    if (gsbHolding.amountCash <= 0) {
      delete state.finance.investments.inv_gsb_savings;
    }
    state.finance.cash = Math.round(state.finance.cash + withdrawAmt);

    const msg = `🏦 ถอนเงินฝากออมทรัพย์ ธ.ออมสิน อัตโนมัติ ${formatCurrency(withdrawAmt)} มาช่วยพยุงสภาพคล่อง`;
    autoActionsLog.push(msg);
    pushEconomyLog(state, '🏦 ถอนเงินออมสินฉุกเฉินอัตโนมัติ', msg, 'ธันวาคม');
  }

  // Step 2: หากยังติดลบ เช็กเงินช่วยเหลือฉุกเฉินจากคุณแม่ (+10,000 ฿ โควตาทุกๆ 5 ปี เมื่อหัวใจเต็ม 5 ดวง)
  if (state.finance.cash < 0) {
    const motherNpc = (state.relationships?.npcs || []).find((n) => n.archetypeId === 'npc_arch_mother');
    const motherAlive = Boolean(motherNpc?.isAlive);
    const activeFlags = getPlayerFlagSet(state);
    const hasHearts5 = activeFlags.has('flag_parent_hearts_5') || Number(motherNpc?.relationship || 0) >= 100;
    const age = Number(state.profile.age || 0);
    const lastAidAge = Number(state.statCounters?.lastMotherAidAge ?? -99);

    if (motherAlive && hasHearts5 && age - lastAidAge >= 5) {
      const aidCash = Number(
        db.raw.loansCrisesEndings?.loan_products_and_credit_rules?.negative_cash_end_of_year_protocol
          ?.step_2_mother_emergency_aid_if_hearts_5?.aid_cash ?? 10000
      );
      state.finance.cash = Math.round(state.finance.cash + aidCash);
      state.statCounters.lastMotherAidAge = age;

      const msg = `🤱 คุณแม่เห็นคุณเงินช็อตจึงแอบโอนเงินเก็บก้นถุงช่วยเหลือฉุกเฉิน +${formatCurrency(aidCash)}!`;
      autoActionsLog.push(msg);
      pushEconomyLog(state, '🤱 น้ำใจจากคุณแม่ยามวิกฤต!', msg, 'ธันวาคม');
    }
  }

  recalculateNetWorth(state);

  if (state.finance.cash >= 0) {
    return {
      resolved: true,
      deficitAmount: 0,
      autoActionsLog,
      availableOptions: []
    };
  }

  // Step 3: ยังติดลบอยู่ -> สร้างตัวเลือกบังคับสำหรับแสดงใน Emergency Modal
  const deficitAmount = Math.abs(Math.round(state.finance.cash));
  const availableOptions = [];

  // ตัวเลือกที่ 1: ขายสินทรัพย์ที่ขายต่อได้ในราคาด่วน 80%
  const resellableList = (state.finance.ownedAssets || []).map((asset) => {
    const def = db.getShopItem(asset.itemId);
    const remainingInstallmentDebt = getRemainingInstallmentDebtForAsset(state, asset.itemId);
    const grossSale80 = Math.round(Number(asset.currentValue || 0) * 0.8);
    const netProceeds = Math.max(0, grossSale80 - remainingInstallmentDebt);
    return {
      instanceId: asset.instanceId,
      itemId: asset.itemId,
      nameTh: def?.name_th || asset.itemId,
      grossSale80,
      remainingInstallmentDebt,
      netProceeds
    };
  }).filter((item) => item.netProceeds > 0);

  if (resellableList.length > 0) {
    availableOptions.push({
      optionType: 'sell_resellable_asset_at_80_percent_value',
      labelTh: 'ขายทอดตลาดสินทรัพย์ด่วน (รับเงินสด 80% ของมูลค่าปัจจุบัน)',
      assets: resellableList
    });
  }

  // ตัวเลือกที่ 2: กู้สินเชื่อส่วนบุคคลธนาคาร (หากผ่านเกณฑ์และวงเงินเหลือพอ)
  const personalLoanCheck = canApplyForLoan(state, 'loan_personal_credit_card', deficitAmount);
  if (personalLoanCheck.eligible) {
    availableOptions.push({
      optionType: 'apply_personal_bank_loan_if_eligible',
      loanId: 'loan_personal_credit_card',
      borrowAmount: deficitAmount,
      labelTh: `กู้สินเชื่อส่วนบุคคลในระบบธนาคาร (+${formatCurrency(deficitAmount)} ดอกเบี้ย 18%/ปี)`
    });
  }

  // ตัวเลือกที่ 3 (การันตีมีเสมอ): บังคับกู้หนี้นอกระบบแก๊งหมวกกันน็อกมาโปะยอดติดลบให้เป็น 0
  availableOptions.push({
    optionType: 'forced_informal_shark_loan_to_cover_deficit',
    loanId: 'loan_informal_loan_shark',
    borrowAmount: deficitAmount,
    labelTh: `จำใจกู้นอกระบบแก๊งหมวกกันน็อกมาโปะหนี้ (+${formatCurrency(deficitAmount)} ดอกเบี้ยโหด 60%/ปี!)`
  });

  return {
    resolved: false,
    deficitAmount,
    autoActionsLog,
    availableOptions
  };
}

/**
 * ฟังก์ชันรับคำสั่งจาก UI Modal เพื่อดำเนินการแก้ไขเงินติดลบตามช้อยส์ที่ผู้เล่นเลือก
 * @param {object} state
 * @param {'sell_resellable_asset_at_80_percent_value'|'apply_personal_bank_loan_if_eligible'|'forced_informal_shark_loan_to_cover_deficit'} optionType
 * @param {object} [payload={}] เช่น { instanceId } สำหรับกรณีขายสินทรัพย์
 */
export function executeEmergencyDeficitOption(state, optionType, payload = {}) {
  if (!state || state.finance.cash >= 0) {
    return { success: true, resolved: true, deficitAmount: 0 };
  }

  const deficit = Math.abs(Math.round(state.finance.cash));

  if (optionType === 'sell_resellable_asset_at_80_percent_value') {
    const saleRes = sellOwnedAsset(state, payload.instanceId, 0.8);
    if (!saleRes.success) return saleRes;
  } else if (optionType === 'apply_personal_bank_loan_if_eligible') {
    const loanRes = applyForLoan(state, 'loan_personal_credit_card', deficit);
    if (!loanRes.success) return loanRes;
  } else if (optionType === 'forced_informal_shark_loan_to_cover_deficit') {
    const sharkRes = forceInformalSharkLoanToCoverDeficit(state);
    if (!sharkRes.success) return sharkRes;
  } else {
    return { success: false, message: 'รูปแบบตัวเลือกฉุกเฉินไม่ถูกต้อง' };
  }

  // ตรวจสอบซ้ำอีกครั้งว่าเงินหายติดลบหรือยัง (เผื่อขายของชิ้นเล็กแล้วยังโปะไม่ครบ)
  const nextCheck = resolveNegativeCashProtocol(state);
  saveGame(state);
  return {
    success: true,
    ...nextCheck
  };
}

/**
 * บังคับกู้นอกระบบมาโปะยอดเงินติดลบให้กลายเป็น 0 ทันที พร้อมติดป้าย flag_informal_shark_debt
 * @param {object} state
 */
export function forceInformalSharkLoanToCoverDeficit(state) {
  if (!state || state.finance.cash >= 0) {
    return { success: true, borrowedAmount: 0 };
  }

  const deficit = Math.abs(Math.round(state.finance.cash));
  const sharkDef = db.getLoanProduct('loan_informal_loan_shark');

  let existingShark = (state.finance.activeLoans || []).find(
    (l) => l.loanId === 'loan_informal_loan_shark'
  );

  if (existingShark) {
    existingShark.principalRemaining = Math.round(Number(existingShark.principalRemaining || 0) + deficit);
  } else {
    state.finance.activeLoans.push({
      loanId: 'loan_informal_loan_shark',
      principalRemaining: deficit,
      annualRate: Number(sharkDef?.annual_interest_rate ?? 0.6),
      missedYears: 0,
      takenAge: state.profile.age
    });
  }

  state.finance.cash = 0;
  addFlagOrStatusToState(state, 'flag_informal_shark_debt');
  applyStatEffects(state, { happiness: -8 });

  pushEconomyLog(
    state,
    '🚨 กู้เงินนอกระบบประทังชีวิต!',
    `คุณจำใจกู้เงินแก๊งหมวกกันน็อกจำนวน ${formatCurrency(deficit)} มาโปะบัญชีติดลบ ดอกเบี้ย 60% ต่อปี!`,
    'ธันวาคม',
    'crisis'
  );

  recalculateNetWorth(state);
  return { success: true, borrowedAmount: deficit };
}

// ============================================================================
// 5. ฟังก์ชัน Action สำหรับผู้เล่น: พอร์ตลงทุน, ร้านค้า, ขายสินทรัพย์, สินเชื่อ, ย้ายจังหวัด
// ============================================================================

/**
 * ซื้อหรือฝากเงินเข้าสินทรัพย์การลงทุนในแท็บที่ 4
 * @param {object} state
 * @param {string} instrumentId
 * @param {number} amountCash
 */
export function buyOrInvestInstrument(state, instrumentId, amountCash) {
  const instDef = db.getInstrument(instrumentId);
  if (!instDef) {
    return { success: false, message: 'ไม่พบข้อมูลสินทรัพย์การลงทุนนี้' };
  }

  const amount = Math.round(Number(amountCash || 0));
  if (amount <= 0) {
    return { success: false, message: 'กรุณาระบุจำนวนเงินที่ต้องการลงทุนให้มากกว่า 0 บาท' };
  }

  if (state.profile.age < Number(instDef.min_age || 0)) {
    return { success: false, message: `ต้องมีอายุอย่างน้อย ${instDef.min_age} ปีบริบูรณ์` };
  }

  if (!checkRequirement(null, instDef.req_flags || [], state)) {
    return { success: false, message: 'คุณยังไม่มีคุณสมบัติหรือใบอนุญาตเปิดพอร์ตครบตามเงื่อนไข' };
  }

  const existing = state.finance.investments?.[instrumentId];
  const minInv = Number(instDef.min_investment_cash || 0);
  if (!existing && amount < minInv) {
    return { success: false, message: `เงินลงทุนขั้นต่ำสำหรับรายการนี้คือ ${formatCurrency(minInv)}` };
  }

  if (Number(state.finance.cash || 0) < amount) {
    return { success: false, message: 'เงินสดในกระเป๋าไม่เพียงพอ' };
  }

  state.finance.cash = Math.round(state.finance.cash - amount);

  if (!state.finance.investments[instrumentId]) {
    state.finance.investments[instrumentId] = { amountCash: 0, costBasis: 0 };
  }
  state.finance.investments[instrumentId].amountCash = Math.round(
    Number(state.finance.investments[instrumentId].amountCash || 0) + amount
  );
  state.finance.investments[instrumentId].costBasis = Math.round(
    Number(state.finance.investments[instrumentId].costBasis || 0) + amount
  );

  for (const fg of instDef.grants_flags_on_hold || []) {
    addFlagOrStatusToState(state, fg);
  }
  for (const rf of instDef.removes_flags_on_hold || []) {
    removeFlagOrStatusFromState(state, rf);
  }
  if (instDef.stat_effects_on_invest) {
    applyStatEffects(state, instDef.stat_effects_on_invest);
  }

  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    message: `ลงทุนใน "${instDef.name_th}" จำนวน ${formatCurrency(amount)} สำเร็จ!`,
    holding: state.finance.investments[instrumentId]
  };
}

/**
 * ขายหรือถอนเงินออกจากสินทรัพย์การลงทุนในแท็บที่ 4
 * @param {object} state
 * @param {string} instrumentId
 * @param {number} amountCash จำนวนเงินที่ต้องการขาย/ถอน (หากส่งค่ามากกว่ายอดที่มี จะขายทั้งหมด)
 */
export function sellOrWithdrawInstrument(state, instrumentId, amountCash) {
  const instDef = db.getInstrument(instrumentId);
  const holding = state.finance.investments?.[instrumentId];

  if (!instDef || !holding || Number(holding.amountCash || 0) <= 0) {
    return { success: false, message: 'คุณไม่ได้ถือครองสินทรัพย์รายการนี้อยู่' };
  }

  const reqAmt = Math.round(Number(amountCash || 0));
  if (reqAmt <= 0) {
    return { success: false, message: 'กรุณาระบุจำนวนเงินที่ต้องการถอน/ขาย' };
  }

  const currentVal = Math.round(Number(holding.amountCash));
  const sellAmt = Math.min(currentVal, reqAmt);
  const ratioSold = sellAmt / currentVal;

  const capGainsTax = Number(db.raw.market?.investment_rules_and_modifiers?.capital_gains_tax_rate ?? 0.0);
  const netReceived = Math.round(sellAmt * (1 - capGainsTax));

  holding.amountCash = currentVal - sellAmt;
  holding.costBasis = Math.max(0, Math.round(Number(holding.costBasis || 0) * (1 - ratioSold)));

  if (holding.amountCash <= 0) {
    delete state.finance.investments[instrumentId];
    // หากขายกองทุน/สินทรัพย์จนเกลี้ยง ให้ถอดป้ายที่ผูกกับการถือครองออก
    for (const fg of instDef.grants_flags_on_hold || []) {
      removeFlagOrStatusFromState(state, fg);
    }
  }

  state.finance.cash = Math.round(Number(state.finance.cash || 0) + netReceived);
  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    soldAmount: sellAmt,
    netReceived,
    message: `ถอน/ขาย "${instDef.name_th}" รับเงินสด ${formatCurrency(netReceived)} สำเร็จ`
  };
}

/**
 * ซื้อสินค้า คอร์สเรียน ทริปสุขภาพ รถยนต์ หรืออสังหาริมทรัพย์จากร้านค้า (แท็บที่ 5)
 * @param {object} state
 * @param {string} itemId
 * @param {'cash'|'installment'} [paymentMode='cash']
 */
export function buyShopItem(state, itemId, paymentMode = 'cash') {
  const itemDef = db.getShopItem(itemId);
  if (!itemDef) {
    return { success: false, message: 'ไม่พบรายการสินค้านี้ในร้านค้า' };
  }

  const age = Number(state.profile.age || 0);
  const priceFactor = state.finance?.realismV2 ? inflationFactor(state, age) : 1;
  const cashPrice = Math.round(Number(itemDef.price_cash || 0) * priceFactor);
  if (age < Number(itemDef.min_age || 0) || age > Number(itemDef.max_age ?? 100)) {
    return {
      success: false,
      message: `สินค้านี้ซื้อได้เฉพาะช่วงอายุ ${itemDef.min_age} - ${itemDef.max_age ?? 100} ปีเท่านั้น`
    };
  }

  if (itemDef.is_one_time_purchase && (state.finance.purchasedOneTimeItems || []).includes(itemId)) {
    return { success: false, message: 'คุณเคยซื้อรายการนี้ไปแล้ว (จำกัดครั้งเดียวในชีวิต)' };
  }

  if (
    !checkRequirement(null, itemDef.req_flags || [], state, {
      forbiddenFlags: itemDef.forbidden_flags || []
    })
  ) {
    return { success: false, message: 'คุณยังมีคุณสมบัติไม่ครบ หรือติดเงื่อนไขต้องห้าม (เช่น ติดแบล็กลิสต์บูโร)' };
  }

  // กฎเหล็กแต้มเวลาว่าง: สินค้าสิ้นเปลือง/ทริปพักผ่อน/ทำบุญ ที่ซื้อซ้ำได้และไม่ใช่สินทรัพย์ขายต่อ ต้องหัก 1 แต้มเวลาว่าง!
  // (ยกเว้นสลากกินแบ่งรัฐบาล item_government_lottery ไม่เสียแต้มเวลาว่าง)
  const requiresFreeActionPoint =
    itemDef.is_one_time_purchase === false &&
    itemDef.is_resellable_asset === false &&
    itemId !== 'item_government_lottery';

  if (requiresFreeActionPoint && Number(state.turn?.freeActionPoints || 0) <= 0) {
    return {
      success: false,
      message: 'แต้มเวลาว่างปีนี้หมดแล้ว (0/3)! กดข้ามไปปีถัดไปเพื่อรีเซ็ตแต้มเวลาว่าง'
    };
  }

  // คำนวณยอดเงินที่ต้องจ่ายทันที (ใช้ได้ทั้งเงินสด หรือกรณีเด็กอายุ < 7 ใช้เงินจากกระปุกออมสินซื้อขนม/ของเล่นได้)
  const usePiggyWallet = age < 7 && !state.finance.hasPiggyBankSmashed;
  const availableMoney = usePiggyWallet
    ? Number(state.finance.piggyBank || 0)
    : Number(state.finance.cash || 0);

  let upfrontCost = cashPrice;
  const instOpt = itemDef.installment_option;

  if (paymentMode === 'installment') {
    if (!instOpt?.available) {
      return { success: false, message: 'สินค้ารายการนี้ไม่รองรับระบบผ่อนชำระ' };
    }
    if (getPlayerFlagSet(state).has('flag_credit_blacklist')) {
      return { success: false, message: 'ไม่สามารถผ่อนชำระได้เนื่องจากติดแบล็กลิสต์เครดิตบูโร' };
    }
    // เช็ก Feature Gate สำหรับการผ่อนบ้าน/คอนโด (ต้องอายุ 22+ และมีรายได้ประจำ)
    if (itemDef.shop_category === 'real_estate_assets') {
      const gate = db.getFeatureGate('gate_home_and_condo_mortgage');
      if (gate && !checkRequirement(null, gate.req_flags, state, { forbiddenFlags: gate.forbidden_flags, minAge: gate.min_age })) {
        return { success: false, message: gate.locked_message_th };
      }
    }
    upfrontCost = Math.round(Number(instOpt.down_payment || 0) * priceFactor);
  }

  if (availableMoney < upfrontCost) {
    return {
      success: false,
      message: `เงินไม่เพียงพอ (ต้องการ ${formatCurrency(upfrontCost)} แต่มีอยู่ ${formatCurrency(availableMoney)})`
    };
  }

  // หักเงินและแต้มเวลาว่าง
  if (usePiggyWallet) {
    state.finance.piggyBank = Math.round(state.finance.piggyBank - upfrontCost);
  } else {
    state.finance.cash = Math.round(state.finance.cash - upfrontCost);
  }

  if (requiresFreeActionPoint) {
    state.turn.freeActionPoints = Math.max(0, Number(state.turn.freeActionPoints || 0) - 1);
  }

  // บันทึกการผ่อนชำระรายปี (ถ้าเลือกผ่อน)
  let createdInstanceId = null;
  if (itemDef.is_resellable_asset) {
    createdInstanceId = `asset_${itemId}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    state.finance.ownedAssets.push({
      instanceId: createdInstanceId,
      itemId,
      currentValue: cashPrice,
      purchasePrice: cashPrice,
      purchaseAge: age
    });
  }

  if (paymentMode === 'installment' && instOpt?.available) {
    state.finance.installments.push({
      itemId,
      linkedAssetInstanceId: createdInstanceId,
      annualPayment: Math.round(Number(instOpt.annual_payment || 0) * priceFactor),
      yearsRemaining: Number(instOpt.duration_years || 1)
    });
  }

  if (itemDef.is_one_time_purchase && !state.finance.purchasedOneTimeItems.includes(itemId)) {
    state.finance.purchasedOneTimeItems.push(itemId);
  }

  // มอบ/ลบป้ายสถานะ
  for (const fg of itemDef.grants_flags || []) {
    addFlagOrStatusToState(state, fg);
  }
  for (const rf of itemDef.removes_flags || []) {
    removeFlagOrStatusFromState(state, rf);
  }

  // กรณีซื้อมอเตอร์ไซค์แต่ยังไม่มีใบขับขี่และยังไม่มีประกันอุบัติเหตุ ให้ติดป้ายเสี่ยงภัยอัตโนมัติ
  if (
    (itemDef.grants_flags || []).includes('flag_has_motorcycle') &&
    !getPlayerFlagSet(state).has('flag_insured_driver')
  ) {
    addFlagOrStatusToState(state, 'flag_uninsured_rider');
  }

  // สินทรัพย์ซื้อซ้ำได้หลายชิ้น แต่ให้โบนัสค่าสถานะจากการซื้อชนิดเดิมเพียงครั้งเดียวตลอดชีวิต
  // ป้องกันการซื้อ-ขาย/สะสมสินทรัพย์ชนิดเดิมเพื่อฟาร์ม Stat โดยไม่กระทบของสิ้นเปลืองและบริการที่ซื้อซ้ำ
  const isRepeatableResellableAsset =
    itemDef.is_resellable_asset === true && itemDef.is_one_time_purchase === false;
  if (!Array.isArray(state.finance.statRewardedRepeatableAssetTypes)) {
    state.finance.statRewardedRepeatableAssetTypes = [];
  }
  const shouldGrantPurchaseStats =
    !isRepeatableResellableAsset ||
    !state.finance.statRewardedRepeatableAssetTypes.includes(itemId);

  if (itemDef.stat_effects_on_buy && shouldGrantPurchaseStats) {
    applyStatEffects(state, itemDef.stat_effects_on_buy);
    if (isRepeatableResellableAsset) {
      state.finance.statRewardedRepeatableAssetTypes.push(itemId);
    }
  }

  // โบนัสหัวใจพ่อแม่ (parent_hearts_bonus โดย 1 ดวง = 20 คะแนนความสัมพันธ์)
  if (itemDef.parent_hearts_bonus) {
    const relBonus = Number(itemDef.parent_hearts_bonus) * 20;
    for (const npc of state.relationships?.npcs || []) {
      if ((npc.archetypeId === 'npc_arch_father' || npc.archetypeId === 'npc_arch_mother') && npc.isAlive) {
        npc.relationship = clampStat(Number(npc.relationship || 0) + relBonus, 0, 100);
        if (npc.relationship >= 100) {
          addFlagOrStatusToState(state, 'flag_parent_hearts_5');
        }
      }
    }
  }

  // กรณีซื้อแพ็กเกจแต่งงานโรงแรม -> อัปเดตสถานะคู่รักเป็น married ทันที
  if (itemId === 'item_luxury_wedding_package' && state.relationships?.partner) {
    state.relationships.partner.status = 'married';
  }

  // กรณีซื้อสลากกินแบ่งรัฐบาล -> ทอยผลลอตเตอรี่ทันที!
  let lotteryOutcome = null;
  if (itemDef.special_mechanic === 'trigger_lottery_lucky_draw_roll' || itemId === 'item_government_lottery') {
    lotteryOutcome = rollLuckyDrawTable(state, 'item_government_lottery', 1);
  }

  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    itemId,
    assetInstanceId: createdInstanceId,
    upfrontCost,
    lotteryOutcome,
    message: lotteryOutcome
      ? `ซื้อสลากกินแบ่งฯ สำเร็จ — ผลรางวัล: ${lotteryOutcome.nameTh}${lotteryOutcome.won ? ` (+${formatCurrency(lotteryOutcome.rewardCash)})` : ''}`
      : `ซื้อ "${itemDef.name_th}" สำเร็จ!`
  };
}

/**
 * คำนวณยอดหนี้ผ่อนคงเหลือที่ผูกอยู่กับสินทรัพย์ชิ้นนั้น
 */
function getRemainingInstallmentDebtForAsset(state, itemId, instanceId = null) {
  let debt = 0;
  for (const inst of state.finance?.installments || []) {
    const matched = instanceId
      ? inst.linkedAssetInstanceId === instanceId
      : inst.itemId === itemId;
    if (matched) {
      debt += Number(inst.annualPayment || 0) * Number(inst.yearsRemaining || 0);
    }
  }
  return Math.round(debt);
}

/**
 * ถอดป้ายสถานะของสินทรัพย์ออก เฉพาะกรณีที่ผู้เล่นไม่มีสินทรัพย์อื่นที่ให้ป้ายเดียวกันหลงเหลืออยู่เลย
 */
function syncAssetFlagsAfterRemoval(state, removedItemId) {
  const removedDef = db.getShopItem(removedItemId);
  if (!removedDef?.grants_flags?.length) return;

  // รวบรวมป้ายที่ยังได้รับจากสินทรัพย์ชิ้นอื่นๆ ที่ยังเหลืออยู่ในมือ
  const stillGrantedFlags = new Set();
  for (const remain of state.finance.ownedAssets || []) {
    const def = db.getShopItem(remain.itemId);
    for (const fg of def?.grants_flags || []) {
      stillGrantedFlags.add(fg);
    }
  }

  // ป้ายที่ไม่ใช่สถานะติดตัวถาวร (เช่น flag_has_car, flag_has_motorcycle, flag_has_own_home ฯลฯ) จะถูกลบออกถ้าไม่มีของชิ้นนั้นแล้ว
  const permanentFlagsNeverRemoveOnSell = new Set([
    'flag_credit_good',
    'tag_computer_nerd',
    'tag_young_merchant'
  ]);

  for (const fg of removedDef.grants_flags) {
    if (!stillGrantedFlags.has(fg) && !permanentFlagsNeverRemoveOnSell.has(fg)) {
      removeFlagOrStatusFromState(state, fg);
    }
  }
}

/**
 * ขายสินทรัพย์ที่ผู้เล่นเป็นเจ้าของเพื่อรับเงินสด (หากยังติดผ่อนอยู่จะหักยอดผ่อนคงเหลือก่อนอัตโนมัติ)
 * @param {object} state
 * @param {string} instanceId รหัสเฉพาะของสินทรัพย์ใน state.finance.ownedAssets
 * @param {number} [priceMultiplier=1.0] ตัวคูณราคาขาย (เช่น 1.0 ขายปกติ, 0.8 ขายด่วนตอนเงินติดลบ)
 */
export function sellOwnedAsset(state, instanceId, priceMultiplier = 1.0) {
  const assets = state.finance?.ownedAssets || [];
  const idx = assets.findIndex((a) => a.instanceId === instanceId);
  if (idx === -1) {
    return { success: false, message: 'ไม่พบสินทรัพย์ที่ต้องการขายในรายการครอบครอง' };
  }

  const asset = assets[idx];
  const itemDef = db.getShopItem(asset.itemId);
  const grossSalePrice = Math.round(Number(asset.currentValue || 0) * Number(priceMultiplier || 1.0));

  // ตรวจสอบค่างวดผ่อนที่ค้างอยู่กับสินทรัพย์ชิ้นนี้
  let settledInstallmentDebt = 0;
  const nextInstallments = [];
  let clearedOneInstallment = false;

  for (const inst of state.finance.installments || []) {
    const isLinked =
      (inst.linkedAssetInstanceId && inst.linkedAssetInstanceId === instanceId) ||
      (!clearedOneInstallment && !inst.linkedAssetInstanceId && inst.itemId === asset.itemId);

    if (isLinked) {
      settledInstallmentDebt += Number(inst.annualPayment || 0) * Number(inst.yearsRemaining || 0);
      clearedOneInstallment = true;
    } else {
      nextInstallments.push(inst);
    }
  }

  settledInstallmentDebt = Math.round(settledInstallmentDebt);
  const netCashReceived = grossSalePrice - settledInstallmentDebt;

  if (netCashReceived < 0 && Number(state.finance.cash || 0) + netCashReceived < 0 && priceMultiplier === 1.0) {
    return {
      success: false,
      message: `ราคาขาย (${formatCurrency(grossSalePrice)}) ต่ำกว่ายอดหนี้ผ่อนคงเหลือ (${formatCurrency(settledInstallmentDebt)}) เงินสดไม่พอปิดไฟแนนซ์!`
    };
  }

  // ลบออกจากรายการสินทรัพย์และอัปเดตคิวผ่อน
  assets.splice(idx, 1);
  state.finance.installments = nextInstallments;
  state.finance.cash = Math.round(Number(state.finance.cash || 0) + netCashReceived);

  // ซิงก์ป้ายสถานะของสินทรัพย์
  syncAssetFlagsAfterRemoval(state, asset.itemId);

  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    itemId: asset.itemId,
    grossSalePrice,
    settledInstallmentDebt,
    netCashReceived,
    message: `ขาย "${itemDef?.name_th || asset.itemId}" สำเร็จ รับเงินสุทธิ ${formatCurrency(netCashReceived)}`
  };
}

/**
 * ตรวจสอบสิทธิ์การขอกู้สินเชื่อแต่ละประเภท
 */
export function canApplyForLoan(state, loanId, requestedAmount) {
  const prod = db.getLoanProduct(loanId);
  if (!prod) {
    return { eligible: false, reason: 'ไม่พบผลิตภัณฑ์สินเชื่อนี้' };
  }

  const age = Number(state.profile.age || 0);
  if (age < Number(prod.min_age || 0) || age > Number(prod.max_age ?? 100)) {
    return { eligible: false, reason: `สินเชื่อนี้กำหนดอายุผู้กู้ ${prod.min_age} - ${prod.max_age} ปี` };
  }

  if (
    !checkRequirement(null, prod.req_flags || [], state, {
      reqAnyFlags: prod.req_any_flags || [],
      forbiddenFlags: prod.forbidden_flags || []
    })
  ) {
    return { eligible: false, reason: 'คุณสมบัติไม่ผ่านเกณฑ์อนุมัติสินเชื่อ หรือติดแบล็กลิสต์บูโร' };
  }

  const existing = (state.finance.activeLoans || []).find((l) => l.loanId === loanId);
  const currentPrincipal = Number(existing?.principalRemaining || 0);
  const maxPrincipal = Number(prod.max_principal_cash || 0);
  const remainingCreditLine = Math.max(0, maxPrincipal - currentPrincipal);

  const reqAmt = Math.round(Number(requestedAmount || 0));
  if (reqAmt <= 0 || reqAmt > remainingCreditLine) {
    return {
      eligible: false,
      reason: `วงเงินกู้คงเหลือไม่เพียงพอ (กู้เพิ่มได้สูงสุด ${formatCurrency(remainingCreditLine)})`,
      remainingCreditLine
    };
  }

  return { eligible: true, remainingCreditLine, product: prod };
}

/**
 * ยื่นกู้เงินจากสถาบันการเงินหรือหนี้นอกระบบ (แท็บที่ 4)
 * @param {object} state
 * @param {string} loanId
 * @param {number} amountCash
 */
export function applyForLoan(state, loanId, amountCash) {
  const amount = Math.round(Number(amountCash || 0));
  const check = canApplyForLoan(state, loanId, amount);
  if (!check.eligible) {
    return { success: false, message: check.reason };
  }

  const prod = check.product;
  let existing = (state.finance.activeLoans || []).find((l) => l.loanId === loanId);

  if (existing) {
    existing.principalRemaining = Math.round(Number(existing.principalRemaining || 0) + amount);
  } else {
    state.finance.activeLoans.push({
      loanId,
      principalRemaining: amount,
      annualRate: Number(prod.annual_interest_rate || 0),
      missedYears: 0,
      takenAge: state.profile.age
    });
  }

  state.finance.cash = Math.round(Number(state.finance.cash || 0) + amount);

  if (prod.grants_flag_while_active) {
    addFlagOrStatusToState(state, prod.grants_flag_while_active);
  }

  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    loanId,
    borrowedAmount: amount,
    message: `อนุมัติวงเงิน "${prod.name_th}" จำนวน ${formatCurrency(amount)} เรียบร้อยแล้ว`
  };
}

/**
 * ชำระคืนเงินต้นสินเชื่อก่อนกำหนด (โปะหนี้ในแท็บที่ 4)
 * @param {object} state
 * @param {string} loanId
 * @param {number} amountCash
 */
export function repayLoan(state, loanId, amountCash) {
  const loans = state.finance?.activeLoans || [];
  const idx = loans.findIndex((l) => l.loanId === loanId);
  if (idx === -1) {
    return { success: false, message: 'ไม่พบบัญชีหนี้สินรายการนี้' };
  }

  const loan = loans[idx];
  const prod = db.getLoanProduct(loanId);
  const reqPay = Math.round(Number(amountCash || 0));
  if (reqPay <= 0) {
    return { success: false, message: 'กรุณาระบุจำนวนเงินที่ต้องการชำระคืน' };
  }

  const payAmt = Math.min(reqPay, Math.round(Number(loan.principalRemaining || 0)));
  if (Number(state.finance.cash || 0) < payAmt) {
    return { success: false, message: 'เงินสดในกระเป๋าไม่พอชำระหนี้ตามจำนวนที่ระบุ' };
  }

  state.finance.cash = Math.round(state.finance.cash - payAmt);
  loan.principalRemaining = Math.max(0, Math.round(loan.principalRemaining - payAmt));
  loan.missedYears = 0;

  let isFullyPaid = false;
  if (loan.principalRemaining <= 0) {
    isFullyPaid = true;
    loans.splice(idx, 1);
    if (prod?.grants_flag_while_active) {
      removeFlagOrStatusFromState(state, prod.grants_flag_while_active);
    }
    if (loans.length === 0) {
      removeFlagOrStatusFromState(state, 'flag_loan_payment_overdue');
    }
  }

  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    paidAmount: payAmt,
    remainingPrincipal: isFullyPaid ? 0 : loan.principalRemaining,
    isFullyPaid,
    message: isFullyPaid
      ? `🎉 ปิดยอดหนี้ "${prod?.name_th || loanId}" ครบถ้วน 100% แล้ว!`
      : `โปะหนี้ "${prod?.name_th || loanId}" จำนวน ${formatCurrency(payAmt)} สำเร็จ (เหลือเงินต้น ${formatCurrency(loan.principalRemaining)})`
  };
}

/**
 * ย้ายถิ่นฐานไปยังจังหวัดใหม่ (ในแท็บที่ 5 ใช้ชีวิต)
 * @param {object} state
 * @param {string} targetLocationId รหัสจังหวัดปลายทางจาก 12 จังหวัด
 */
export function relocateProvince(state, targetLocationId) {
  const targetLoc = db.getLocation(targetLocationId);
  if (!targetLoc) {
    return { success: false, message: 'ไม่พบข้อมูลจังหวัดปลายทาง' };
  }

  if (state.profile.currentLocationId === targetLocationId) {
    return { success: false, message: `ปัจจุบันคุณอาศัยอยู่ที่จังหวัด${targetLoc.name_th}อยู่แล้ว` };
  }

  if (Number(state.profile.age || 0) < 18) {
    return { success: false, message: 'ต้องมีอายุครบ 18 ปีบริบูรณ์ขึ้นไปจึงจะย้ายจังหวัดด้วยตัวเองได้' };
  }

  if (getPlayerFlagSet(state).has('flag_conscript_soldier_2yrs')) {
    return { success: false, message: 'ไม่สามารถย้ายจังหวัดได้ขณะอยู่ในประจำการทหารกองเกิน' };
  }

  const relocationCost = Math.round(Number(targetLoc.relocation_cost || 0));
  if (Number(state.finance.cash || 0) < relocationCost) {
    return {
      success: false,
      message: `เงินสดไม่พอสำหรับค่าขนย้าย (${formatCurrency(relocationCost)})`
    };
  }

  const prevLoc = db.getLocation(state.profile.currentLocationId);
  state.finance.cash = Math.round(state.finance.cash - relocationCost);
  state.profile.currentLocationId = targetLocationId;

  // หากย้ายไปจังหวัดพื้นที่อากาศบริสุทธิ์ (tier === 'rural') ช่วยบรรเทาโรคปอดจากฝุ่น PM2.5 ตามเงื่อนไข cure_methods
  if (targetLoc.tier === 'rural') {
    removeFlagOrStatusFromState(state, 'status_pm25_lung_damage');
  }

  pushEconomyLog(
    state,
    `🚚 ย้ายภูมิลำเนาสู่ "${targetLoc.name_th}"`,
    `ย้ายจาก${prevLoc?.name_th || 'ถิ่นเดิม'}มาเริ่มต้นชีวิตใหม่ที่${targetLoc.name_th} (ค่าขนย้าย ${formatCurrency(relocationCost)})`
  );

  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    previousLocationId: prevLoc?.location_id || null,
    newLocationId: targetLocationId,
    costPaid: relocationCost,
    message: `ย้ายที่อยู่มายังจังหวัด "${targetLoc.name_th}" เรียบร้อยแล้ว!`
  };
}
