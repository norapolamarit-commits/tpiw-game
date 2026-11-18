/**
 * js/engine/money_realism_engine.js
 * ระบบเงินสมจริง (เปิดใช้เมื่อ state.finance.realismV2 = true ซึ่งตัวละครใหม่จะเปิดให้อัตโนมัติ):
 *  - เงินเฟ้อรายปี (ประมาณ 2-3%) กับค่าครองชีพและค่าจ้าง
 *  - เงินเดือนโตตามอายุงาน + ค่าแรงขั้นต่ำ + โบนัสสิ้นปี + สวัสดิการ
 *  - ภาษีเงินได้บุคคลธรรมดาแบบขั้นบันได (ตามอัตราไทย) + ประกันสังคม (ชราภาพ/ว่างงาน)
 *  - ค่าใช้จ่ายแยกรายการ: ค่าเช่า/ที่อยู่ อาหาร เดินทาง สาธารณูปโภค สุขภาพ (อยู่บ้านพ่อแม่ไม่เสียค่าเช่า)
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { hashString } from './gender_encounter_engine.js';

export const REFERENCE_AGE = 18; // ราคาในไฟล์ข้อมูลถือเป็นราคาปัจจุบันตอนอายุ 18
export const MIN_WAGE_ANNUAL = 120000; // ประมาณวันละ 330-400 บาท x 300 วัน (ราคาอ้างอิง)
export const PART_TIME_FLOOR = 36000;
export const SS_WAGE_CAP = 180000; // ฐานเงินเดือนสูงสุด 15,000 บาท/เดือน
export const SS_RATE = 0.05;
export const TAX_BRACKETS = [
  [150000, 0], [300000, 0.05], [500000, 0.10], [750000, 0.15], [1000000, 0.20], [2000000, 0.25], [5000000, 0.30], [Infinity, 0.35]
];
export const EXPENSE_SHARES = [
  { id: 'housing', label: 'ค่าเช่า/ที่อยู่อาศัย', share: 0.38 },
  { id: 'food', label: 'ค่าอาหาร', share: 0.30 },
  { id: 'transport', label: 'ค่าเดินทาง', share: 0.10 },
  { id: 'utilities', label: 'น้ำ ไฟ อินเทอร์เน็ต โทรศัพท์', share: 0.10 },
  { id: 'health_living', label: 'ค่าสุขภาพและของใช้จำเป็น', share: 0.06 },
  { id: 'leisure', label: 'ค่าพักผ่อนและสังคม', share: 0.06 }
];

const isOn = (state) => Boolean(state?.finance?.realismV2);

/** อัตราเงินเฟ้อของปีหนึ่ง (0.5% ถึง 5.0% เฉลี่ยราว 2.5%) คงที่ตามเซฟ */
export function inflationRateForAge(state, age) {
  const h = hashString(`${state.meta?.runId || 'x'}|infl|${age}`) % 1000;
  return 0.005 + (h / 1000) * 0.045;
}

/** ดัชนีราคาสะสมตั้งแต่เกิด */
export function priceIndex(state, age) {
  let idx = 1;
  for (let a = 1; a <= age; a++) idx *= 1 + inflationRateForAge(state, a);
  return idx;
}

/** ตัวคูณเงินเฟ้อเทียบราคาอ้างอิง (อายุ 18): ก่อนอายุ 18 = 1.0 */
export function inflationFactor(state, age) {
  if (age <= REFERENCE_AGE) return 1;
  return priceIndex(state, age) / priceIndex(state, REFERENCE_AGE);
}

export function tenureMultiplier(yearsInJob) {
  return 1 + 0.03 * Math.min(Math.max(0, Number(yearsInJob || 0)), 15);
}

/** ปรับรายได้งานตามเงินเฟ้อ อายุงาน และค่าแรงขั้นต่ำ (ใช้ใน calculateJobAnnualIncome) */
export function adjustJobIncome(state, jobDef, baseIncome, isMainCareer) {
  if (!isOn(state)) return baseIncome;
  const age = Number(state.profile?.age || 0);
  const factor = inflationFactor(state, age);
  const isBusiness = Boolean(jobDef.affected_by_business_multiplier);
  let income = baseIncome * factor;
  if (isMainCareer && !isBusiness) income *= tenureMultiplier(state.careerAndEdu?.yearsInMainJob);
  const floor = isMainCareer && !isBusiness && jobDef.job_category !== 'part_time_gig' ? MIN_WAGE_ANNUAL * factor : jobDef.job_category === 'part_time_gig' ? PART_TIME_FLOOR * factor : 0;
  return Math.round(Math.max(income, floor));
}

/** โบนัสสิ้นปี (เดือนเงินเดือน) ขึ้นกับผลประกอบการของบริษัทในปีนั้นและระดับตำแหน่ง */
export function bonusMonths(state, jobDef) {
  if (!isOn(state) || !jobDef || jobDef.affected_by_business_multiplier || jobDef.job_category === 'part_time_gig') return 0;
  const age = Number(state.profile?.age || 0);
  const table = jobDef.job_category === 'civil_service' ? [0.5, 0.75, 1, 1] : [0, 0.5, 1, 1.5, 2, 3];
  const base = table[hashString(`${state.meta?.runId || 'x'}|bonus|${age}`) % table.length];
  const rankBoost = Number(state.careerAndEdu?.salaryMultiplier || 1) >= 1.3 ? 0.5 : 0;
  return base + (base > 0 ? rankBoost : 0);
}

/** ภาษีเงินได้บุคคลธรรมดา (ปีละครั้ง) พร้อมค่าลดหย่อนมาตรฐานของไทย */
export function computeIncomeTax(state, grossEmployment, { ssPaid = 0, spouseNoIncome = false, children = 0 } = {}) {
  if (grossEmployment <= 0) return { tax: 0, taxable: 0, deductions: 0 };
  const expenseDeduction = Math.min(grossEmployment * 0.5, 100000);
  const personal = 60000;
  const spouse = spouseNoIncome ? 60000 : 0;
  const kids = Math.min(children, 3) * 30000;
  const deductions = expenseDeduction + personal + spouse + kids + ssPaid;
  const taxable = Math.max(0, grossEmployment - deductions);
  let tax = 0; let prev = 0;
  for (const [cap, rate] of TAX_BRACKETS) {
    if (taxable > prev) tax += (Math.min(taxable, cap) - prev) * rate;
    prev = cap;
    if (taxable <= cap) break;
  }
  return { tax: Math.round(tax), taxable: Math.round(taxable), deductions: Math.round(deductions) };
}

export const socialSecurityPayable = (jobDef, income) => (jobDef && jobDef.job_category && ['corporate', 'part_time_gig'].includes(jobDef.job_category) && !jobDef.affected_by_business_multiplier ? Math.round(Math.min(income, SS_WAGE_CAP * 1.0) * SS_RATE) : 0);

/** บำนาญชราภาพประกันสังคม: อายุ 55 ปีขึ้นไป ส่งสมทบครบ 15 ปี (20% ของค่าจ้างเฉลี่ย + 1.5% ต่อปีที่เกิน 15 ปี) */
export function socialSecurityPension(state) {
  const f = state.finance || {};
  const age = Number(state.profile?.age || 0);
  if (!isOn(state) || age < 55 || Number(f.ssYears || 0) < 15) return 0;
  const years = Number(f.ssYears);
  return Math.round(Number(f.ssAvgWage || 0) * (0.2 + Math.max(0, years - 15) * 0.015));
}

/** เงินทดแทนกรณีว่างงาน: 50% ของค่าจ้างเฉลี่ย ปีละไม่เกินหนึ่งครั้งในทุก 3 ปี ถ้าเคยส่งสมทบ */
export function socialSecurityUnemployment(state) {
  const f = state.finance || {};
  const age = Number(state.profile?.age || 0);
  if (!isOn(state) || age < 20 || age >= 60 || state.careerAndEdu?.mainJobId || Number(f.ssYears || 0) < 1.5) return 0;
  if (Number.isFinite(f.ssUnemploymentAge) && age - f.ssUnemploymentAge < 3) return 0;
  if (f.ssLastYearAge !== age - 1) return 0;
  return Math.round(Number(f.ssAvgWage || 0) * 0.5);
}

export function recordSocialSecurityYear(state, income) {
  const f = state.finance;
  const age = Number(state.profile?.age || 0);
  f.ssYears = Number(f.ssYears || 0) + 1;
  f.ssAvgWage = Math.round(((Number(f.ssAvgWage || 0) * (f.ssYears - 1)) + Math.min(income, SS_WAGE_CAP)) / f.ssYears);
  f.ssLastYearAge = age;
}

/** รูปแบบที่อยู่: อยู่บ้านพ่อแม่ (ไม่เสียค่าเช่า) / เช่า / บ้านตัวเอง */
export function housingMode(state, hasOwnHome) {
  if (hasOwnHome) return 'own';
  const age = Number(state.profile?.age || 0);
  return age < 23 && !state.careerAndEdu?.mainJobId && !state.relationships?.partner ? 'family' : 'rent';
}

/** แยกค่าครองชีพรายปีเป็นหมวดย่อย (รวมแล้วเท่ายอดเดิม) */
export function splitLivingCost(state, total, { mode, ownHome = false }) {
  const age = Number(state.profile?.age || 0);
  const f = inflationFactor(state, age);
  const lines = EXPENSE_SHARES.map((s) => {
    let amount = total * s.share;
    if (s.id === 'housing') {
      if (mode === 'family') amount = 0;
      else if (mode === 'own') amount *= 0.25; // ค่าซ่อมบำรุง ภาษีที่ดิน ส่วนกลาง
    }
    if (s.id === 'food' && mode === 'family') amount *= 0.7;
    return { id: s.id, label: s.id === 'housing' && mode === 'own' ? 'ค่าบำรุงรักษาบ้านและภาษีที่ดิน' : s.label, amount: Math.round(amount * f) };
  }).filter((l) => l.amount > 0);
  return lines;
}
