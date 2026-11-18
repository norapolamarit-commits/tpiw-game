/**
 * js/engine/career_edu_engine.js
 * โมดูลจัดการระบบกิจกรรมพัฒนาการตามวัย การเรียนระดับอุดมศึกษา (ป.ตรี / ปวส.)
 * การสอบใบอนุญาตวิชาชีพ ระบบสมัครงานตามกฎเหล็ก 1 อาชีพ การกดทำโอที (OT) การขอขึ้นเงินเดือน
 * และการคำนวณพัฒนาการด้านการเรียน/อาชีพเมื่อข้ามปี
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100% ใช้รหัส iconKey สำหรับเรนเดอร์ Inline SVG เท่านั้น
 */

import { db } from '../core/db.js';
import { recalculateNetWorth, saveGame } from '../core/state.js';
import { applyStatEffects as applyCoreStatEffects } from '../core/stat_engine.js';
import {
  clampStat,
  checkRequirement,
  getPlayerFlagSet,
  getPlayerStatValue,
  rollChance,
  formatCurrency
} from '../core/utils.js';
import { getCombinedActionMultipliers, calculateJobAnnualIncome } from './economy_engine.js';
import { collectAnnualPassiveStatEffects } from '../core/annual_passive_stats.js';
import { stripEmojis } from './event_engine.js';

// ============================================================================
// Internal Helpers (การจัดการป้ายสถานะ สเตตัส เงินกระเป๋า และบันทึก Life Feed)
// ============================================================================

const STAT_LABELS_TH = {
  health: 'สุขภาพ',
  happiness: 'ความสุข',
  intelligence: 'สมอง',
  connections: 'เส้นสาย',
  merit: 'แต้มบุญ',
  appearance: 'บุคลิกหน้าตา'
};

/**
 * เพิ่มป้ายสถานะลงใน Array หมวดที่ถูกต้องของ state
 * @param {object} state
 * @param {string} flagId
 */
function addFlagOrStatus(state, flagId) {
  if (!flagId || typeof flagId !== 'string') return;
  const active = getPlayerFlagSet(state);
  if (active.has(flagId)) return;

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
function removeFlagOrStatus(state, flagId) {
  if (!flagId) return;
  state.flags = (state.flags || []).filter((f) => f !== flagId);
  state.talentTags = (state.talentTags || []).filter((f) => f !== flagId);
  state.statuses = (state.statuses || []).filter((f) => f !== flagId);
  state.innateTraits = (state.innateTraits || []).filter((f) => f !== flagId);
}

/**
 * ปรับค่าสถานะลงใน state.stats โดยรองรับการคูณ study_efficiency กับค่า intelligence ที่เป็นบวก
 * @param {object} state
 * @param {Record<string, number>} effects
 * @param {number} [studyEfficiencyMult=1.0]
 * @returns {Record<string, number>} ส่วนต่างจริงที่เปลี่ยนแปลง
 */
function applyCareerEduStatEffects(state, effects, studyEfficiencyMult = 1.0) {
  const deltas = {
    health: 0,
    happiness: 0,
    intelligence: 0,
    connections: 0,
    merit: 0,
    appearance: 0
  };

  if (!effects || typeof effects !== 'object' || !state.stats) return deltas;

  const resolvedDeltas = applyCoreStatEffects(state, effects, {
    studyEfficiencyMultiplier: studyEfficiencyMult
  });
  for (const key of ['health', 'happiness', 'intelligence', 'connections', 'appearance', 'merit']) {
    deltas[key] = resolvedDeltas[key] || 0;
  }

  return deltas;
}

/**
 * บันทึกเหตุการณ์ด้านการเรียน/การทำงานลงใน Life Feed แบบไร้ Emoji พร้อมแนบ iconKey
 */
function pushCareerEduLog(state, title, message, iconKey = 'work', monthTh = 'พฤษภาคม', type = 'career_edu') {
  if (!Array.isArray(state.turn?.lifeFeedLog)) return;
  state.turn.lifeFeedLog.push({
    age: state.profile.age,
    monthTh,
    type,
    iconKey,
    title: stripEmojis(title),
    message: stripEmojis(message)
  });
}

/**
 * ดึงยอดเงินที่ใช้จ่ายได้จริงตามช่วงวัย (ก่อนอายุ 7 ปีที่ยังไม่ทุบกระปุกจะดูจาก piggyBank + cash)
 */
function getAvailableSpendingBalance(state) {
  const age = Number(state.profile.age || 0);
  if (age < 7 && !state.finance.hasPiggyBankSmashed) {
    return Number(state.finance.piggyBank || 0) + Number(state.finance.cash || 0);
  }
  return Number(state.finance.cash || 0);
}

/**
 * ตรวจสอบว่าผู้เล่นกำลังอยู่ในสถานะนักเรียน/นักศึกษาหรือไม่
 * @param {object} state
 * @returns {boolean}
 */
export function isPlayerCurrentlyStudying(state) {
  if (!state) return false;
  const age = Number(state.profile?.age || 0);
  const activeFlags = getPlayerFlagSet(state);

  if (state.careerAndEdu?.activeStudy) return true;
  if (activeFlags.has('flag_middle_school_student') || activeFlags.has('flag_high_school_student')) {
    return true;
  }
  // อายุต่ำกว่า 18 ปีที่ไม่ได้ดรอปเรียนออกมาทำงานเต็มตัวถือว่าอยู่ในวัยเรียน
  if (age < 18 && !activeFlags.has('flag_dropout_worker')) {
    return true;
  }
  return false;
}

/**
 * ตรวจสอบว่าผู้เล่นกำลังติดภารกิจทหารเกณฑ์อยู่หรือไม่
 */
function isPlayerConscripted(state) {
  const activeFlags = getPlayerFlagSet(state);
  return (
    Number(state.careerAndEdu?.conscriptionYearsLeft || 0) > 0 ||
    activeFlags.has('flag_conscript_soldier_2yrs') ||
    activeFlags.has('flag_conscript_soldier_1yr')
  );
}

/**
 * สร้างข้อความอธิบายสาเหตุที่ตัวเลือกถูกล็อก (ไร้ Emoji)
 */
function buildRequirementLockReasonTh(reqStats, reqAllFlags, reqAnyFlags, forbiddenFlags, state) {
  const reasons = [];
  const activeFlags = getPlayerFlagSet(state);

  if (reqStats && typeof reqStats === 'object') {
    for (const [statKey, minVal] of Object.entries(reqStats)) {
      const curVal = getPlayerStatValue(state, statKey);
      if (curVal < Number(minVal)) {
        const label =
          statKey === 'connections'
            ? db.getConnectionsLabelByAge(state.profile.age)
            : (STAT_LABELS_TH[statKey] || statKey);
        reasons.push(`ต้องการ${label} ${minVal}+ (มี ${curVal})`);
      }
    }
  }

  for (const f of reqAllFlags || []) {
    if (!activeFlags.has(f)) {
      const def = db.getTraitOrFlag(f);
      reasons.push(`ต้องมี [${stripEmojis(def?.name_th || f)}]`);
    }
  }

  if (Array.isArray(reqAnyFlags) && reqAnyFlags.length > 0) {
    const hasAny = reqAnyFlags.some((f) => activeFlags.has(f));
    if (!hasAny) {
      const names = reqAnyFlags.map((f) => stripEmojis(db.getTraitOrFlag(f)?.name_th || f));
      reasons.push(`ต้องมีอย่างน้อย 1 อย่าง: ${names.join(' / ')}`);
    }
  }

  for (const fb of forbiddenFlags || []) {
    if (activeFlags.has(fb)) {
      const def = db.getTraitOrFlag(fb);
      reasons.push(`ติดสถานะต้องห้าม [${stripEmojis(def?.name_th || fb)}]`);
    }
  }

  return reasons.join(' , ');
}

/**
 * ถอดป้ายสถานะชั่วคราวที่ได้รับจากการทำงาน (grants_flags_while_employed) อย่างปลอดภัย
 * โดยไม่เผลอลบป้ายที่เป็นสมบัติติดตัวถาวรจากชนชั้นต้นกำเนิดหรือสินทรัพย์อื่นที่ถืออยู่
 */
function safelyRemoveEmploymentFlags(state, quittingJobDef) {
  if (!quittingJobDef?.grants_flags_while_employed?.length) return;

  const protectedFlags = new Set();

  // 1. ป้ายที่ได้จากชนชั้นกำเนิด (เช่น เกิด class_1 มีบัตรสวัสดิการอยู่แล้ว หรือเกิด class_4 มีธุรกิจที่บ้านอยู่แล้ว)
  const spawnCls = db.getClass(state.profile.spawnClassId);
  for (const f of spawnCls?.starting_flags || []) {
    protectedFlags.add(f);
  }

  // 2. ป้ายที่ได้จากสินทรัพย์ในครอบครอง (เช่น หอพักปล่อยเช่าให้ flag_regular_income หรือรถหรูให้ flag_elite_connection)
  for (const asset of state.finance?.ownedAssets || []) {
    const itemDef = db.getShopItem(asset.itemId);
    for (const f of itemDef?.grants_flags || []) {
      protectedFlags.add(f);
    }
  }

  // 3. ป้ายที่ได้จากการสมรสกับคู่ครอง (เช่น คู่สมรสข้าราชการให้ flag_welfare_card / หมอให้ flag_private_hospital_access)
  if (state.relationships?.partner?.status === 'married') {
    const partArch = db.indexes.partnerArchetypes.get(state.relationships.partner.archetypeId);
    for (const f of partArch?.grants_flags_on_marriage || []) {
      protectedFlags.add(f);
    }
  }

  // 4. ป้ายจากงานอีกช่องที่ยังทำอยู่ (ถ้ามี)
  const otherJobIds = [state.careerAndEdu?.mainJobId, state.careerAndEdu?.partTimeJobId].filter(
    (id) => id && id !== quittingJobDef.job_id
  );
  for (const otherId of otherJobIds) {
    const otherJob = db.getJob(otherId);
    for (const f of otherJob?.grants_flags_while_employed || []) {
      protectedFlags.add(f);
    }
  }

  // หมายเหตุ: สิทธิ์บำนาญข้าราชการ (flag_gov_pension_right) หากทำงานจนเกษียณอายุ 60 ปี จะไม่ถูกลบออก
  const isRetiringAt60Plus = Number(state.profile.age || 0) >= Number(quittingJobDef.retirement_age ?? 60);

  for (const empFlag of quittingJobDef.grants_flags_while_employed) {
    if (empFlag === 'flag_gov_pension_right' && isRetiringAt60Plus) continue;
    if (empFlag === 'flag_tax_evasion_risk') continue; // ความเสี่ยงภาษีย้อนหลังยังคงอยู่จนกว่าจะซื้อกองทุนลดหย่อนหรือเคลียร์สรรพากร
    if (!protectedFlags.has(empFlag)) {
      removeFlagOrStatus(state, empFlag);
    }
  }
}

// ============================================================================
// 1. ระบบตั้งค่ากิจกรรมพัฒนาการตามวัย (Age Progression Activities)
// ============================================================================

/**
 * ดึงรายการกิจกรรมตามวัยที่ตรงกับช่วงอายุปัจจุบัน พร้อมสถานะปลดล็อกสำหรับแสดงบน UI
 * @param {object} state
 * @returns {Array<object>}
 */
export function getAvailableActivities(state) {
  const age = Number(state?.profile?.age ?? 0);
  const allActivities = db.raw.eduJobs?.age_progression_activities || [];
  const availableMoney = getAvailableSpendingBalance(state);

  return allActivities
    .filter((act) => age >= Number(act.min_age || 0) && age <= Number(act.max_age ?? 100))
    .map((act) => {
      const meetsReq = checkRequirement(act.req_stats || {}, [], state, {
        reqAnyFlags: act.req_any_flags || []
      });
      const cost = Number(act.annual_cost_cash || 0);
      const canAfford = cost <= 0 || availableMoney >= cost;
      const isSelected = state.careerAndEdu?.currentActivityId === act.activity_id;

      let lockReasonTh = '';
      if (!meetsReq) {
        lockReasonTh = buildRequirementLockReasonTh(act.req_stats, [], act.req_any_flags, [], state);
      } else if (!canAfford) {
        lockReasonTh = `ต้องมีเงินสำรองอย่างน้อย ${formatCurrency(cost)} สำหรับค่าใช้จ่ายรายปี`;
      }

      return {
        ...act,
        name_th: stripEmojis(act.name_th),
        description_th: stripEmojis(act.description_th),
        iconKey: age >= 60 ? 'heart_pulse' : (cost > 0 ? 'school' : 'book'),
        isSelected,
        isLocked: !meetsReq || !canAfford,
        lockIconKey: !meetsReq || !canAfford ? 'lock' : null,
        lockReasonTh
      };
    });
}

/**
 * เลือกโหมดกิจกรรมพัฒนาการประจำปี (Stance ไม่เสียแต้มเวลาว่าง และยังไม่หักเงินทันที แต่เช็กเงินสำรองเบื้องต้น)
 * @param {object} state
 * @param {string} activityId
 */
export function selectAgeActivity(state, activityId) {
  const actDef = db.getActivity(activityId);
  if (!actDef) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลกิจกรรมที่เลือก' };
  }

  const age = Number(state.profile.age || 0);
  if (age < Number(actDef.min_age || 0) || age > Number(actDef.max_age ?? 100)) {
    return {
      success: false,
      iconKey: 'lock',
      message: `กิจกรรมนี้สำหรับช่วงอายุ ${actDef.min_age} - ${actDef.max_age} ปีเท่านั้น`
    };
  }

  if (
    !checkRequirement(actDef.req_stats || {}, [], state, {
      reqAnyFlags: actDef.req_any_flags || []
    })
  ) {
    const reason = buildRequirementLockReasonTh(actDef.req_stats, [], actDef.req_any_flags, [], state);
    return {
      success: false,
      iconKey: 'lock',
      message: reason || 'คุณยังมีคุณสมบัติไม่ตรงตามเงื่อนไขของกิจกรรมนี้'
    };
  }

  const cost = Number(actDef.annual_cost_cash || 0);
  const availableMoney = getAvailableSpendingBalance(state);
  if (cost > 0 && availableMoney < cost) {
    return {
      success: false,
      iconKey: 'coin',
      message: `เงินในกระเป๋า/กระปุกไม่เพียงพอสำหรับค่ากิจกรรมรายปี (${formatCurrency(cost)})`
    };
  }

  state.careerAndEdu.currentActivityId = activityId;

  for (const rf of actDef.removes_flags || []) {
    removeFlagOrStatus(state, rf);
  }
  for (const gf of actDef.grants_flags || []) {
    addFlagOrStatus(state, gf);
  }

  saveGame(state);

  return {
    success: true,
    iconKey: 'check',
    activityId,
    message: `ตั้งค่ากิจวัตรประจำปีเป็น "${stripEmojis(actDef.name_th)}" เรียบร้อยแล้ว`
  };
}

// ============================================================================
// 2. ระบบสมัครเรียนระดับอุดมศึกษา (ป.ตรี / ปวส.)
// ============================================================================

/**
 * ดึงรายการหลักสูตรอุดมศึกษาทั้งหมดพร้อมสถานะเงื่อนไขสำหรับแสดงบน UI
 * @param {object} state
 * @returns {Array<object>}
 */
export function getAvailableEducationPrograms(state) {
  const age = Number(state?.profile?.age ?? 0);
  const programs = db.raw.eduJobs?.higher_education_programs || [];
  const activeFlags = getPlayerFlagSet(state);
  const conscripted = isPlayerConscripted(state);
  const completedSet = new Set(state.careerAndEdu?.completedDegrees || []);

  return programs.filter((prog) => {
    const completed = completedSet.has(prog.program_id);
    const enrolled = state.careerAndEdu?.activeStudy?.programId === prog.program_id;
    const inAge = age >= Number(prog.min_age || 18) && age <= Number(prog.max_age ?? 100);
    const meetsReq = checkRequirement(prog.req_stats || {}, [], state, { reqAnyFlags: prog.req_any_flags || [] });
    return completed || enrolled || (inAge && meetsReq && !conscripted && !state.careerAndEdu?.activeStudy);
  }).map((prog) => {
    const alreadyGraduated = completedSet.has(prog.program_id);
    const isCurrentlyEnrolled = state.careerAndEdu?.activeStudy?.programId === prog.program_id;
    const hasOtherActiveStudy = Boolean(state.careerAndEdu?.activeStudy) && !isCurrentlyEnrolled;
    const inAgeRange = age >= Number(prog.min_age || 18) && age <= Number(prog.max_age ?? 100);
    const meetsStatsAndFlags = checkRequirement(prog.req_stats || {}, [], state, {
      reqAnyFlags: prog.req_any_flags || []
    });

    const canUseStudentLoan =
      Boolean(prog.student_loan_available) &&
      activeFlags.has('flag_student_loan_eligible') &&
      !activeFlags.has('flag_credit_blacklist');

    const canPayCashFirstYear = Number(state.finance?.cash || 0) >= Number(prog.annual_tuition_cash || 0);

    let lockReasonTh = '';
    if (alreadyGraduated) {
      lockReasonTh = 'สำเร็จการศึกษาหลักสูตรนี้แล้ว';
    } else if (conscripted) {
      lockReasonTh = 'ไม่สามารถสมัครเรียนได้ขณะอยู่ในประจำการทหารกองเกิน';
    } else if (hasOtherActiveStudy) {
      lockReasonTh = 'กำลังศึกษาอยู่ในหลักสูตรอื่น (ห้ามเรียนซ้อน)';
    } else if (!inAgeRange) {
      lockReasonTh = `เปิดรับสมัครเฉพาะอายุ ${prog.min_age} - ${prog.max_age} ปี`;
    } else if (!meetsStatsAndFlags) {
      lockReasonTh = buildRequirementLockReasonTh(prog.req_stats, [], prog.req_any_flags, [], state);
    }

    const isLocked =
      alreadyGraduated || conscripted || hasOtherActiveStudy || !inAgeRange || !meetsStatsAndFlags;

    return {
      ...prog,
      name_th: stripEmojis(prog.name_th),
      description_th: stripEmojis(prog.description_th),
      iconKey: 'school',
      alreadyGraduated,
      isCurrentlyEnrolled,
      canUseStudentLoan,
      canPayCashFirstYear,
      isLocked,
      lockIconKey: isLocked ? 'lock' : null,
      lockReasonTh
    };
  });
}

/**
 * สมัครเข้าเรียนระดับอุดมศึกษา (ป.ตรี / ปวส.)
 * กฎเหล็ก: หากถืออาชีพหลัก (mainJobId) อยู่ จะทำการลาออกจากงานหลักอัตโนมัติ (เรียนเต็มเวลาทำควบได้เฉพาะพาร์ทไทม์)
 *
 * @param {object} state
 * @param {string} programId
 * @param {boolean} [useStudentLoan=false]
 */
export function enrollHigherEducation(state, programId, useStudentLoan = false) {
  const prog = db.getProgram(programId);
  if (!prog) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบหลักสูตรการศึกษาที่ระบุ' };
  }

  const age = Number(state.profile.age || 0);
  if (age < Number(prog.min_age || 18) || age > Number(prog.max_age ?? 100)) {
    return {
      success: false,
      iconKey: 'lock',
      message: `หลักสูตรนี้รับสมัครเฉพาะผู้มีอายุ ${prog.min_age} - ${prog.max_age} ปี`
    };
  }

  if (state.careerAndEdu.activeStudy) {
    return {
      success: false,
      iconKey: 'lock',
      message: 'คุณกำลังศึกษาอยู่ในหลักสูตรอื่น ต้องเรียนให้จบหรือดรอปเรียนก่อน'
    };
  }

  if ((state.careerAndEdu.completedDegrees || []).includes(programId)) {
    return { success: false, iconKey: 'check', message: 'คุณเรียนจบหลักสูตรนี้ไปแล้ว' };
  }

  if (isPlayerConscripted(state)) {
    return {
      success: false,
      iconKey: 'lock',
      message: 'ไม่สามารถลงทะเบียนเรียนได้ขณะรับราชการทหารกองประจำการ'
    };
  }

  if (
    !checkRequirement(prog.req_stats || {}, [], state, {
      reqAnyFlags: prog.req_any_flags || []
    })
  ) {
    const reason = buildRequirementLockReasonTh(prog.req_stats, [], prog.req_any_flags, [], state);
    return {
      success: false,
      iconKey: 'lock',
      message: reason || 'คะแนนหรือวุฒิสายการเรียนของคุณไม่ผ่านเกณฑ์คัดเลือกเข้าคณะนี้'
    };
  }

  const activeFlags = getPlayerFlagSet(state);
  const annualTuition = Number(prog.annual_tuition_cash || 0);

  if (useStudentLoan) {
    if (!prog.student_loan_available) {
      return { success: false, iconKey: 'lock', message: 'หลักสูตรนี้ไม่เข้าร่วมกองทุนกู้ยืม กยศ.' };
    }
    if (!activeFlags.has('flag_student_loan_eligible')) {
      return { success: false, iconKey: 'lock', message: 'คุณไม่มีป้ายสิทธิ์กู้ กยศ. (ต้องเลือกชำระค่าเทอมด้วยเงินสด)' };
    }
    if (activeFlags.has('flag_credit_blacklist')) {
      return { success: false, iconKey: 'lock', message: 'ไม่สามารถยื่นกู้ กยศ. ได้เนื่องจากติดแบล็กลิสต์เครดิตบูโร' };
    }
  } else {
    if (Number(state.finance.cash || 0) < annualTuition) {
      return {
        success: false,
        iconKey: 'coin',
        message: `เงินสดไม่เพียงพอสำรองค่าเทอมปีแรก (${formatCurrency(annualTuition)})`
      };
    }
  }

  // กฎเหล็กอาชีพขณะเรียน: หากมีอาชีพหลัก (mainJobId) ต้องลาออกอัตโนมัติ (หรือถ้านั้นเป็นงานพาร์ทไทม์ที่ทำตอนเรียนได้ ให้ย้ายไปช่อง partTimeJobId)
  let autoQuitNote = '';
  if (state.careerAndEdu.mainJobId) {
    const prevMainJob = db.getJob(state.careerAndEdu.mainJobId);
    if (
      prevMainJob &&
      prevMainJob.job_category === 'part_time_gig' &&
      prevMainJob.can_do_while_studying &&
      !state.careerAndEdu.partTimeJobId
    ) {
      state.careerAndEdu.partTimeJobId = prevMainJob.job_id;
      state.careerAndEdu.mainJobId = null;
      state.careerAndEdu.yearsInMainJob = 0;
      state.careerAndEdu.salaryMultiplier = 1.0;
      autoQuitNote = ` (ย้าย "${stripEmojis(prevMainJob.name_th)}" ไปเป็นงานพาร์ทไทม์ระหว่างเรียน)`;
    } else {
      safelyRemoveEmploymentFlags(state, prevMainJob);
      state.careerAndEdu.mainJobId = null;
      state.careerAndEdu.yearsInMainJob = 0;
      state.careerAndEdu.salaryMultiplier = 1.0;
      autoQuitNote = prevMainJob ? ` (ลาออกจากงานประจำ "${stripEmojis(prevMainJob.name_th)}" เพื่อมาเรียนเต็มเวลา)` : '';
    }
  }

  // หากมีพาร์ทไทม์ที่ไม่รองรับการทำควบคู่กับการเรียน ให้ถอดออกด้วย
  if (state.careerAndEdu.partTimeJobId) {
    const ptDef = db.getJob(state.careerAndEdu.partTimeJobId);
    if (ptDef && !ptDef.can_do_while_studying) {
      safelyRemoveEmploymentFlags(state, ptDef);
      state.careerAndEdu.partTimeJobId = null;
    }
  }

  state.careerAndEdu.activeStudy = {
    programId,
    yearsCompleted: 0,
    durationYears: Number(prog.duration_years || 4),
    annualTuition,
    useStudentLoan: Boolean(useStudentLoan)
  };

  if (useStudentLoan) {
    addFlagOrStatus(state, 'flag_student_loan_debt');
  }

  const cleanProgName = stripEmojis(prog.name_th);
  pushCareerEduLog(
    state,
    `เข้าศึกษาต่อ: ${cleanProgName}`,
    `ลงทะเบียนเป็นนักศึกษาใหม่หลักสูตร ${prog.duration_years} ปี (${useStudentLoan ? 'ใช้สิทธิ์กู้ กยศ.' : `ค่าเทอม ${formatCurrency(annualTuition)}/ปี`})${autoQuitNote}`,
    'school',
    'มิถุนายน'
  );

  saveGame(state);

  return {
    success: true,
    iconKey: 'school',
    programId,
    activeStudy: state.careerAndEdu.activeStudy,
    message: `สมัครเข้าเรียน "${cleanProgName}" สำเร็จ!${autoQuitNote}`
  };
}

/**
 * ลาออกกลางคัน / ดรอปเรียนจากหลักสูตรอุดมศึกษาปัจจุบัน
 * @param {object} state
 */
export function dropOutHigherEducation(state) {
  const study = state.careerAndEdu?.activeStudy;
  if (!study) {
    return { success: false, iconKey: 'info', message: 'ปัจจุบันคุณไม่ได้กำลังศึกษาอยู่ในระดับอุดมศึกษา' };
  }

  const prog = db.getProgram(study.programId);
  const progName = stripEmojis(prog?.name_th || study.programId);

  state.careerAndEdu.activeStudy = null;
  applyCareerEduStatEffects(state, { happiness: -2 });

  // หากถือพาร์ทไทม์อยู่และไม่มีอาชีพหลัก ให้ย้ายพาร์ทไทม์ขึ้นมาเป็นอาชีพหลักตามกฎ 1 อาชีพเมื่อพ้นสภาพนักศึกษา
  if (state.careerAndEdu.partTimeJobId && !state.careerAndEdu.mainJobId) {
    state.careerAndEdu.mainJobId = state.careerAndEdu.partTimeJobId;
    state.careerAndEdu.partTimeJobId = null;
    state.careerAndEdu.yearsInMainJob = 0;
    state.careerAndEdu.salaryMultiplier = 1.0;
  }

  pushCareerEduLog(
    state,
    `ดรอปเรียนกลางคัน: ${progName}`,
    `ตัดสินใจลาออกจากการศึกษาชั้นปีที่ ${Number(study.yearsCompleted || 0) + 1} เพื่อออกมาลุยเส้นทางชีวิตด้านอื่น`,
    'alert',
    'ตุลาคม'
  );

  saveGame(state);

  return {
    success: true,
    iconKey: 'info',
    message: `ทำเรื่องลาออกจาก "${progName}" เรียบร้อยแล้ว`
  };
}

// ============================================================================
// 3. ระบบสอบใบอนุญาตและตั๋ววิชาชีพ (Licenses & Permits)
// ============================================================================

/**
 * ดึงรายการใบอนุญาตและตั๋ววิชาชีพทั้งหมดทั้ง 12 รายการพร้อมสถานะปลดล็อก
 * @param {object} state
 * @returns {Array<object>}
 */
export function getAvailableLicenses(state) {
  const age = Number(state?.profile?.age ?? 0);
  const allLicenses = db.raw.milestones?.licenses_and_permits || [];
  const ownedSet = new Set(state.careerAndEdu?.licenses || []);
  const activeFlags = getPlayerFlagSet(state);

  return allLicenses
    .filter((lic) => {
      const allFlagsAlreadyOwned =
        Array.isArray(lic.grants_flags) &&
        lic.grants_flags.length > 0 &&
        lic.grants_flags.every((flag) => activeFlags.has(flag));
      const isOwned = ownedSet.has(lic.license_id) || allFlagsAlreadyOwned;
      const inAge = age >= Number(lic.min_age || 15) && age <= Number(lic.max_age ?? 100);
      const meetsReq = checkRequirement(lic.req_stats || {}, lic.req_flags || [], state);
      // Owned permits remain visible; future or unqualified permits are not exposed yet.
      return isOwned || (inAge && meetsReq);
    })
    .map((lic) => {
      const allFlagsAlreadyOwned =
        Array.isArray(lic.grants_flags) &&
        lic.grants_flags.length > 0 &&
        lic.grants_flags.every((flag) => activeFlags.has(flag));
      const isOwned = ownedSet.has(lic.license_id) || allFlagsAlreadyOwned;
      const inAge = age >= Number(lic.min_age || 15) && age <= Number(lic.max_age ?? 100);
      const meetsReq = checkRequirement(lic.req_stats || {}, lic.req_flags || [], state);
      const cost = Number(lic.cost_cash || 0);
      const canAfford = Number(state.finance?.cash || 0) >= cost;
      const lockReasonTh = isOwned
        ? 'ได้รับใบอนุญาต/ขึ้นทะเบียนเรียบร้อยแล้ว'
        : !inAge
          ? `ต้องมีอายุครบ ${lic.min_age} ปีบริบูรณ์ขึ้นไป`
          : !meetsReq
            ? buildRequirementLockReasonTh(lic.req_stats, lic.req_flags, [], [], state)
            : !canAfford
              ? `เงินสดไม่พอชำระค่าธรรมเนียม (${formatCurrency(cost)})`
              : '';
      const isLocked = isOwned || !inAge || !meetsReq || !canAfford;

      return {
        ...lic,
        name_th: stripEmojis(lic.name_th),
        unlocks_description_th: stripEmojis(lic.unlocks_description_th),
        iconKey: isOwned ? 'check' : 'id_card',
        isOwned,
        isLocked,
        lockIconKey: isLocked && !isOwned ? 'lock' : null,
        lockReasonTh
      };
    });
}

/**
 * สมัครสอบและรับใบอนุญาต/ตั๋ววิชาชีพ (หักค่าธรรมเนียมทันที ไม่เสียแต้มเวลาว่าง)
 * @param {object} state
 * @param {string} licenseId
 */
export function takeLicenseExam(state, licenseId) {
  const lic = db.getLicense(licenseId);
  if (!lic) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลใบอนุญาตที่ระบุ' };
  }

  const activeFlags = getPlayerFlagSet(state);
  const alreadyHasAllFlags =
    Array.isArray(lic.grants_flags) &&
    lic.grants_flags.length > 0 &&
    lic.grants_flags.every((f) => activeFlags.has(f));

  if ((state.careerAndEdu.licenses || []).includes(licenseId) || alreadyHasAllFlags) {
    return { success: false, iconKey: 'check', message: 'คุณได้รับใบอนุญาตรายการนี้อยู่แล้ว' };
  }

  const age = Number(state.profile.age || 0);
  if (age < Number(lic.min_age || 15)) {
    return {
      success: false,
      iconKey: 'lock',
      message: `ต้องมีอายุครบ ${lic.min_age} ปีบริบูรณ์จึงจะสมัครสอบได้`
    };
  }

  if (!checkRequirement(lic.req_stats || {}, lic.req_flags || [], state)) {
    const reason = buildRequirementLockReasonTh(lic.req_stats, lic.req_flags, [], [], state);
    return {
      success: false,
      iconKey: 'lock',
      message: reason || 'คุณสมบัติหรือวุฒิการศึกษายังไม่ครบตามเกณฑ์สอบใบอนุญาต'
    };
  }

  const cost = Math.round(Number(lic.cost_cash || 0));
  if (Number(state.finance.cash || 0) < cost) {
    return {
      success: false,
      iconKey: 'coin',
      message: `เงินสดไม่พอสำหรับค่าธรรมเนียมสอบ (${formatCurrency(cost)})`
    };
  }

  state.finance.cash = Math.round(state.finance.cash - cost);
  if (!state.careerAndEdu.licenses.includes(licenseId)) {
    state.careerAndEdu.licenses.push(licenseId);
  }

  for (const gf of lic.grants_flags || []) {
    addFlagOrStatus(state, gf);
  }

  // หากสอบใบขับขี่มอเตอร์ไซค์/รถยนต์ผ่าน และมีประกันอุบัติเหตุอยู่แล้ว ช่วยล้างป้ายเสี่ยงภัยไร้ประกัน
  const updatedFlags = getPlayerFlagSet(state);
  if (
    (updatedFlags.has('flag_motor_license') || updatedFlags.has('flag_car_license')) &&
    updatedFlags.has('flag_insured_driver')
  ) {
    removeFlagOrStatus(state, 'flag_uninsured_rider');
  }

  const statDeltas = applyCareerEduStatEffects(state, lic.stat_effects || {});
  const cleanName = stripEmojis(lic.name_th);

  pushCareerEduLog(
    state,
    `สอบผ่านใบอนุญาต: ${cleanName}`,
    `${stripEmojis(lic.unlocks_description_th)} (ค่าธรรมเนียม ${formatCurrency(cost)})`,
    'trophy',
    'เมษายน'
  );

  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    iconKey: 'trophy',
    licenseId,
    costPaid: cost,
    grantsFlags: lic.grants_flags || [],
    statDeltas,
    message: `สอบผ่านและได้รับ "${cleanName}" เรียบร้อยแล้ว!`
  };
}

// ============================================================================
// 4. ระบบสมัครงาน & กฎเหล็กถือครอง 1 อาชีพ (Career & Job System)
// ============================================================================

/**
 * ตรวจสอบ Feature Gate เฉพาะทางจาก Milestones_&_Licenses.json สำหรับอาชีพที่เกี่ยวข้อง
 * @param {object} jobDef
 * @param {object} state
 * @returns {{ passed: boolean, lockedMessageTh: string }}
 */
function checkJobFeatureGate(jobDef, state) {
  let gateId = null;

  if (jobDef.job_id === 'job_gig_food_rider') {
    gateId = 'gate_rider_delivery_job';
  } else if (jobDef.job_id === 'job_freelance_coder_graphic' || jobDef.job_id === 'job_esports_streamer') {
    // หมายเหตุ: สตรีมเมอร์ใน Education_&_Jobs เช็ก req_any_flags (flag_pro_streamer_gear / flag_luxury_gadget) จึงผูก Gate เฉพาะงานฟรีแลนซ์ไอทีที่บังคับคอมฯ
    if (jobDef.job_id === 'job_freelance_coder_graphic') {
      gateId = 'gate_it_freelance_and_streaming';
    }
  } else if (jobDef.job_id === 'own_street_food_vendor' || jobDef.job_id === 'own_cafe_and_restaurant') {
    gateId = 'gate_sme_business_startup';
  }

  if (!gateId) return { passed: true, lockedMessageTh: '' };

  const gate = db.getFeatureGate(gateId);
  if (!gate) return { passed: true, lockedMessageTh: '' };

  const passed = checkRequirement(null, gate.req_flags || [], state, {
    forbiddenFlags: gate.forbidden_flags || [],
    minAge: gate.min_age
  });

  return {
    passed,
    lockedMessageTh: passed ? '' : stripEmojis(gate.locked_message_th || '')
  };
}

/**
 * ประเมินคุณสมบัติของผู้เล่นสำหรับอาชีพ 1 อาชีพ
 */
function evaluateJobEligibility(jobDef, state) {
  const age = Number(state?.profile?.age ?? 0);
  const studying = isPlayerCurrentlyStudying(state);
  const conscripted = isPlayerConscripted(state);
  const maxAgeLimit = Number(jobDef.max_age ?? jobDef.retirement_age ?? 100);
  const minAgeLimit = Number(jobDef.min_age ?? 15);

  const isCurrentMain = state.careerAndEdu?.mainJobId === jobDef.job_id;
  const isCurrentPartTime = state.careerAndEdu?.partTimeJobId === jobDef.job_id;
  const isEmployedHere = isCurrentMain || isCurrentPartTime;

  // 1. ตรวจสอบ Feature Gate ก่อน
  const gateCheck = checkJobFeatureGate(jobDef, state);
  if (!gateCheck.passed) {
    return {
      eligible: false,
      isEmployedHere,
      targetSlot: studying ? 'part_time' : 'main',
      lockReasonTh: gateCheck.lockedMessageTh
    };
  }

  // 2. ตรวจสอบสถานะทหารเกณฑ์
  if (conscripted) {
    return {
      eligible: false,
      isEmployedHere,
      targetSlot: 'main',
      lockReasonTh: 'ไม่สามารถสมัครงานได้ขณะอยู่ในประจำการทหารกองเกิน'
    };
  }

  // 3. กฎเหล็กขณะกำลังเรียน: ทำได้เฉพาะงานพาร์ทไทม์ที่มี can_do_while_studying === true เท่านั้น
  if (studying) {
    if (jobDef.job_category !== 'part_time_gig' || !jobDef.can_do_while_studying) {
      return {
        eligible: false,
        isEmployedHere,
        targetSlot: 'part_time',
        lockReasonTh: 'กำลังศึกษาอยู่ สามารถทำควบได้เฉพาะงานพาร์ทไทม์ที่รองรับวัยเรียนเท่านั้น'
      };
    }
  }

  // 4. ตรวจสอบเกณฑ์อายุ (สำหรับสมัครใหม่ต้องอายุน้อยกว่าอายุเกษียณ)
  const ageTooYoung = age < minAgeLimit;
  const ageTooOld = jobDef.retirement_age !== undefined ? age >= maxAgeLimit : age > maxAgeLimit;
  if (ageTooYoung || ageTooOld) {
    return {
      eligible: false,
      isEmployedHere,
      targetSlot: studying ? 'part_time' : 'main',
      lockReasonTh: `เปิดรับช่วงอายุ ${minAgeLimit} - ${jobDef.retirement_age ? maxAgeLimit - 1 : maxAgeLimit} ปี`
    };
  }

  // 5. ตรวจสอบสเตตัสและป้ายบังคับ (req_stats, req_all_flags, req_any_flags, forbidden_flags)
  const meetsReq = checkRequirement(jobDef.req_stats || {}, jobDef.req_all_flags || [], state, {
    reqAnyFlags: jobDef.req_any_flags || [],
    forbiddenFlags: jobDef.forbidden_flags || []
  });

  if (!meetsReq) {
    const reason = buildRequirementLockReasonTh(
      jobDef.req_stats,
      jobDef.req_all_flags,
      jobDef.req_any_flags,
      jobDef.forbidden_flags,
      state
    );
    return {
      eligible: false,
      isEmployedHere,
      targetSlot: studying ? 'part_time' : 'main',
      lockReasonTh: reason || 'คุณสมบัติหรือใบประกอบวิชาชีพยังไม่ครบตามเกณฑ์'
    };
  }

  return {
    eligible: true,
    isEmployedHere,
    targetSlot: studying ? 'part_time' : 'main',
    lockReasonTh: ''
  };
}

/**
 * ดึงข้อมูลอาชีพทั้งหมดแยกตาม 4 หมวดหมู่พร้อมคำนวณรายได้จริงตามตัวคูณจังหวัด/สกิล สำหรับเรนเดอร์ในแท็บที่ 2
 * @param {object} state
 */
export function getCategorizedJobsForUI(state) {
  const multipliers = getCombinedActionMultipliers(state);
  const categories = {
    part_time_gig: [],
    corporate: [],
    civil_service: [],
    business: []
  };

  for (const jobDef of db.indexes.jobs.values()) {
    const check = evaluateJobEligibility(jobDef, state);
    const isCurrentMain = state.careerAndEdu?.mainJobId === jobDef.job_id;
    const estimatedAnnualIncome = calculateJobAnnualIncome(
      jobDef,
      state,
      multipliers,
      isCurrentMain
    );

    const cardObj = {
      ...jobDef,
      name_th: stripEmojis(jobDef.name_th),
      description_th: stripEmojis(jobDef.description_th),
      iconKey:
        jobDef.job_category === 'civil_service'
          ? 'shield'
          : jobDef.job_category === 'business'
            ? 'shop'
            : 'work',
      estimatedAnnualIncome,
      estimatedMonthlyIncome: Math.round(estimatedAnnualIncome / 12),
      isEmployedHere: check.isEmployedHere,
      targetSlot: check.targetSlot,
      isLocked: !check.eligible && !check.isEmployedHere,
      lockIconKey: !check.eligible && !check.isEmployedHere ? 'lock' : null,
      lockReasonTh: check.lockReasonTh
    };

    if (categories[jobDef.job_category] && (check.eligible || check.isEmployedHere)) {
      categories[jobDef.job_category].push(cardObj);
    }
  }

  return categories;
}

/**
 * สมัครเข้าทำงานตามกฎเหล็กถือครอง 1 อาชีพ (ยกเว้นขณะกำลังเรียนถือพาร์ทไทม์ในช่อง partTimeJobId ได้ 1 งาน)
 * @param {object} state
 * @param {string} jobId
 */
export function applyForJob(state, jobId) {
  const jobDef = db.getJob(jobId);
  if (!jobDef) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลอาชีพที่ระบุ' };
  }

  if (state.careerAndEdu.mainJobId === jobId || state.careerAndEdu.partTimeJobId === jobId) {
    return { success: false, iconKey: 'info', message: 'ปัจจุบันคุณทำงานในอาชีพนี้อยู่แล้ว' };
  }

  const check = evaluateJobEligibility(jobDef, state);
  if (!check.eligible) {
    return {
      success: false,
      iconKey: 'lock',
      message: check.lockReasonTh || 'คุณยังไม่ผ่านเกณฑ์การรับสมัครของอาชีพนี้'
    };
  }

  const cleanNewJobName = stripEmojis(jobDef.name_th);

  // กรณีที่ 1: ผู้เล่นกำลังเรียนอยู่ -> เก็บลงช่อง partTimeJobId เท่านั้น
  if (check.targetSlot === 'part_time') {
    if (state.careerAndEdu.partTimeJobId) {
      const oldPt = db.getJob(state.careerAndEdu.partTimeJobId);
      safelyRemoveEmploymentFlags(state, oldPt);
    }

    state.careerAndEdu.partTimeJobId = jobId;
    for (const gf of jobDef.grants_flags_while_employed || []) {
      addFlagOrStatus(state, gf);
    }

    pushCareerEduLog(
      state,
      `เริ่มงานพาร์ทไทม์: ${cleanNewJobName}`,
      `ทำงานพาร์ทไทม์ควบคู่กับการเรียนเพื่อหารายได้เสริมด้วยตัวเอง`,
      'work',
      'มิถุนายน'
    );

    saveGame(state);
    return {
      success: true,
      iconKey: 'work',
      slot: 'part_time',
      jobId,
      message: `เริ่มทำงานพาร์ทไทม์ "${cleanNewJobName}" ควบคู่กับการเรียนสำเร็จ!`
    };
  }

  // กรณีที่ 2: ผู้เล่นไม่ได้เรียนแล้ว -> กฎเหล็กถือครองได้เพียง 1 อาชีพใน mainJobId (ล้างทั้ง mainJobId เดิมและ partTimeJobId เดิมทันที!)
  if (state.careerAndEdu.mainJobId) {
    const oldMain = db.getJob(state.careerAndEdu.mainJobId);
    safelyRemoveEmploymentFlags(state, oldMain);
  }
  if (state.careerAndEdu.partTimeJobId) {
    const oldPt = db.getJob(state.careerAndEdu.partTimeJobId);
    safelyRemoveEmploymentFlags(state, oldPt);
    state.careerAndEdu.partTimeJobId = null;
  }

  state.careerAndEdu.mainJobId = jobId;
  state.careerAndEdu.yearsInMainJob = 0;
  state.careerAndEdu.salaryMultiplier = 1.0;
  state.careerAndEdu.otUsedThisYear = 0;
  state.careerAndEdu.requestedRaiseThisYear = false;

  for (const gf of jobDef.grants_flags_while_employed || []) {
    addFlagOrStatus(state, gf);
  }

  const multipliers = getCombinedActionMultipliers(state);
  const annualPay = calculateJobAnnualIncome(jobDef, state, multipliers, true);

  pushCareerEduLog(
    state,
    `เริ่มงานใหม่: ${cleanNewJobName}`,
    `เข้าทำงานในตำแหน่ง "${cleanNewJobName}" รายได้ประเมิน ${formatCurrency(annualPay)}/ปี`,
    'work',
    'มิถุนายน'
  );

  saveGame(state);

  return {
    success: true,
    iconKey: 'work',
    slot: 'main',
    jobId,
    estimatedAnnualIncome: annualPay,
    message: `เข้าทำงาน "${cleanNewJobName}" เรียบร้อยแล้ว!`
  };
}

/**
 * ลาออกจากงานปัจจุบัน
 * @param {object} state
 * @param {'main'|'part_time'} [slot='main']
 */
export function quitJob(state, slot = 'main') {
  const targetId = slot === 'part_time' ? state.careerAndEdu?.partTimeJobId : state.careerAndEdu?.mainJobId;
  if (!targetId) {
    return { success: false, iconKey: 'info', message: 'คุณไม่ได้ถือครองอาชีพในช่องนี้อยู่' };
  }

  const jobDef = db.getJob(targetId);
  const cleanName = stripEmojis(jobDef?.name_th || targetId);

  if (slot === 'part_time') {
    state.careerAndEdu.partTimeJobId = null;
  } else {
    state.careerAndEdu.mainJobId = null;
    state.careerAndEdu.yearsInMainJob = 0;
    state.careerAndEdu.salaryMultiplier = 1.0;
    state.careerAndEdu.otUsedThisYear = 0;
    state.careerAndEdu.requestedRaiseThisYear = false;
  }

  safelyRemoveEmploymentFlags(state, jobDef);

  pushCareerEduLog(
    state,
    `ลาออกจากงาน: ${cleanName}`,
    `ยื่นใบลาออกจาก "${cleanName}" เพื่อพักผ่อนหรือเตรียมตัวสู่เส้นทางใหม่`,
    'info',
    'กันยายน'
  );

  saveGame(state);

  return {
    success: true,
    iconKey: 'check',
    quitJobId: targetId,
    message: `ลาออกจาก "${cleanName}" เรียบร้อยแล้ว`
  };
}

// ============================================================================
// 5. ปุ่ม Action พิเศษในแท็บทำงาน (ใช้แต้มเวลาว่าง 1 แต้ม: ทำโอที OT & ขอขึ้นเงินเดือน)
// ============================================================================

/**
 * ลุยทำโอที / รับจ๊อบเสริมพิเศษประจำปี (ใช้ freeActionPoints 1 แต้ม, จำกัดปีละ 1 ครั้ง)
 * รับเงินสดทันที 15% ของรายได้ต่อปีของอาชีพที่ทำอยู่ แลกกับสุขภาพ -4 และความสุข -2
 * @param {object} state
 */
export function workOvertimeAction(state) {
  const activeJobId = state.careerAndEdu?.mainJobId || state.careerAndEdu?.partTimeJobId;
  const isMain = Boolean(state.careerAndEdu?.mainJobId);

  if (!activeJobId) {
    return { success: false, iconKey: 'lock', message: 'ต้องมีอาชีพหรืองานพาร์ทไทม์ทำอยู่ก่อนจึงจะทำโอทีได้' };
  }

  if (isPlayerConscripted(state)) {
    return { success: false, iconKey: 'lock', message: 'ไม่สามารถรับงานโอทีได้ขณะอยู่ในประจำการทหาร' };
  }

  if (Number(state.careerAndEdu.otUsedThisYear || 0) >= 1) {
    return { success: false, iconKey: 'lock', message: 'คุณลุยทำโอทีโควตาของปีนี้ไปแล้ว (จำกัดปีละ 1 ครั้ง)' };
  }

  if (Number(state.turn?.freeActionPoints || 0) < 1) {
    return { success: false, iconKey: 'lock', message: 'แต้มเวลาว่างไม่เพียงพอ (ต้องการ 1 แต้มเวลาว่าง)' };
  }

  const jobDef = db.getJob(activeJobId);
  if (!jobDef) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลอาชีพปัจจุบัน' };
  }

  const multipliers = getCombinedActionMultipliers(state);
  const annualIncome = calculateJobAnnualIncome(jobDef, state, multipliers, isMain);
  const otBonusCash = Math.max(1000, Math.round(annualIncome * 0.15));

  state.turn.freeActionPoints = Math.max(0, Number(state.turn.freeActionPoints || 0) - 1);
  state.careerAndEdu.otUsedThisYear = 1;
  state.finance.cash = Math.round(Number(state.finance.cash || 0) + otBonusCash);

  const statDeltas = applyCareerEduStatEffects(state, { health: -4, happiness: -2 });

  // หากอายุ >= 35 ปี มีโอกาส 25% ที่การโหมทำโอทีจะทำให้ติดสถานะออฟฟิศซินโดรมเรื้อรัง
  let triggeredOfficeSyndrome = false;
  if (
    Number(state.profile.age || 0) >= 35 &&
    !getPlayerFlagSet(state).has('status_office_syndrome') &&
    rollChance(25)
  ) {
    addFlagOrStatus(state, 'status_office_syndrome');
    triggeredOfficeSyndrome = true;
  }

  // ตรวจสอบกรณีโหมงานหนักจนสุขภาพแตะ 0
  if (Number(state.stats.health || 0) <= 0) {
    state.stats.health = 0;
    state.profile.isAlive = false;
    state.profile.deathCauseId = Number(state.profile.age || 0) >= 70
      ? 'death_natural_old_age'
      : 'death_cardiovascular_overwork';
    state.turn.phase = 'ENDED';
    state.turn.areTabsLocked = true;
  }

  const cleanJobName = stripEmojis(jobDef.name_th);
  const syndromeNote = triggeredOfficeSyndrome ? ' (ร่างกายประท้วงจนเริ่มติดสถานะออฟฟิศซินโดรมเรื้อรัง!)' : '';

  pushCareerEduLog(
    state,
    `ลุยทำโอทีพิเศษ: ${cleanJobName}`,
    `โหมงานล่วงเวลารับเงินพิเศษ +${formatCurrency(otBonusCash)} แลกกับความเหนื่อยล้า${syndromeNote}`,
    triggeredOfficeSyndrome ? 'alert' : 'coin',
    'พฤศจิกายน'
  );

  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    iconKey: triggeredOfficeSyndrome ? 'alert' : 'coin',
    otBonusCash,
    statDeltas,
    triggeredOfficeSyndrome,
    isPlayerDead: !state.profile.isAlive,
    message: `ทำโอทีสำเร็จ! รับเงินสด +${formatCurrency(otBonusCash)} (สุขภาพ -4, ความสุข -2)${syndromeNote}`
  };
}

/**
 * เจรจาขอประเมินเลื่อนขั้น / ขอขึ้นเงินเดือนประจำปี (ใช้ freeActionPoints 1 แต้ม)
 * เงื่อนไข: ต้องมี mainJobId, อายุงานในตำแหน่งนี้ >= 2 ปี และยังไม่เคยขอในปีนี้
 * @param {object} state
 */
export function requestPromotionOrRaise(state) {
  const mainJobId = state.careerAndEdu?.mainJobId;
  if (!mainJobId) {
    return { success: false, iconKey: 'lock', message: 'ต้องมีอาชีพหลักประจำอยู่จึงจะเจรจาขอขึ้นเงินเดือนได้' };
  }

  if (Number(state.careerAndEdu.yearsInMainJob || 0) < 2) {
    return {
      success: false,
      iconKey: 'lock',
      message: `ต้องมีอายุงานในตำแหน่งนี้อย่างน้อย 2 ปีขึ้นไป (ปัจจุบัน ${state.careerAndEdu.yearsInMainJob || 0} ปี)`
    };
  }

  if (state.careerAndEdu.requestedRaiseThisYear) {
    return { success: false, iconKey: 'lock', message: 'ปีนี้คุณได้ยื่นเจรจาขอปรับฐานเงินเดือนไปแล้ว' };
  }

  if (Number(state.careerAndEdu.salaryMultiplier || 1.0) >= 2.0) {
    return { success: false, iconKey: 'trophy', message: 'ฐานเงินเดือนของคุณชนเพดานสูงสุดของสายงานนี้แล้ว (2.0 เท่า)' };
  }

  if (Number(state.turn?.freeActionPoints || 0) < 1) {
    return { success: false, iconKey: 'lock', message: 'แต้มเวลาว่างไม่เพียงพอ (ต้องการ 1 แต้มเวลาว่าง)' };
  }

  state.turn.freeActionPoints = Math.max(0, Number(state.turn.freeActionPoints || 0) - 1);
  state.careerAndEdu.requestedRaiseThisYear = true;

  const intel = getPlayerStatValue(state, 'intelligence');
  const conn = getPlayerStatValue(state, 'connections');
  const rawChance = 25 + intel * 0.35 + conn * 0.35;
  const successChance = clampStat(Math.round(rawChance), 15, 85);

  const isSuccess = rollChance(successChance);
  const jobDef = db.getJob(mainJobId);
  const cleanJobName = stripEmojis(jobDef?.name_th || mainJobId);

  if (isSuccess) {
    const prevMult = Number(state.careerAndEdu.salaryMultiplier || 1.0);
    const nextMult = Math.min(2.0, Number((prevMult + 0.10).toFixed(2)));
    state.careerAndEdu.salaryMultiplier = nextMult;

    const statDeltas = applyCareerEduStatEffects(state, { happiness: 5, connections: 2 });

    pushCareerEduLog(
      state,
      `เลื่อนขั้น/ขึ้นเงินเดือนสำเร็จ! (${cleanJobName})`,
      `ผลประเมินผลงานโดดเด่น ได้รับอนุมัติปรับตัวคูณรายได้ขึ้นเป็น ${Math.round(nextMult * 100)}% ของฐานปกติ`,
      'trophy',
      'ธันวาคม'
    );

    saveGame(state);

    return {
      success: true,
      raised: true,
      iconKey: 'trophy',
      successChance,
      newSalaryMultiplier: nextMult,
      statDeltas,
      message: `เจรจาสำเร็จ! (โอกาส ${successChance}%) ปรับฐานรายได้ขึ้นเป็น ${nextMult.toFixed(2)}x พร้อมความสุข +5`
    };
  }

  const statDeltas = applyCareerEduStatEffects(state, { happiness: -2 });

  pushCareerEduLog(
    state,
    `ชวดปรับขึ้นเงินเดือนพิเศษ (${cleanJobName})`,
    `ผู้บริหารแจ้งว่างบประมาณปีนี้จำกัด ขอให้รอรอบประเมินปีถัดไป`,
    'info',
    'ธันวาคม'
  );

  saveGame(state);

  return {
    success: true,
    raised: false,
    iconKey: 'info',
    successChance,
    newSalaryMultiplier: state.careerAndEdu.salaryMultiplier,
    statDeltas,
    message: `ยังไม่ผ่านการอนุมัติขึ้นเงินเดือนในรอบนี้ (โอกาสสำเร็จ ${successChance}%) ความสุข -2`
  };
}

// ============================================================================
// 6. ประมวลผลความก้าวหน้าด้านการเรียน กิจกรรม และอาชีพเมื่อข้ามปี (เรียกโดย turn_manager.js)
// ============================================================================

/**
 * คำนวณผลลัพธ์ประจำปีของกิจกรรมตามวัย การเรียนมหาวิทยาลัย ทหารเกณฑ์ อายุงาน โรคจากการทำงาน และการเกษียณอายุ
 * @param {object} state GameState ปัจจุบัน (หลังจากบวกอายุ +1 ปีแล้ว)
 * @returns {object} รายงานสรุปการเปลี่ยนแปลงประจำปี
 */
export function processAnnualCareerAndStudyProgression(state, options = {}) {
  if (!state?.careerAndEdu) return {};

  const age = Number(state.profile.age || 0);
  const multipliers = getCombinedActionMultipliers(state);
  const studyMult = Number(multipliers.study_efficiency ?? 1.0);
  const applyRecurringEffects = (effects, efficiency = 1.0) => {
    if (!options.deferAnnualPassives) return applyCareerEduStatEffects(state, effects, efficiency);
    const adjusted = { ...(effects || {}) };
    const intelligence = Number(adjusted.intelligence || 0);
    if (intelligence > 0 && efficiency !== 1.0) {
      adjusted.intelligence = intelligence * efficiency;
    }
    collectAnnualPassiveStatEffects(state, adjusted);
    return adjusted;
  };

  const report = {
    dischargedFromMilitary: false,
    graduatedProgramId: null,
    retiredJobId: null,
    triggeredOccupationalIllness: null,
    activityAutoCleared: false
  };

  // 1. รีเซ็ตโควตาการทำโอทีและการขอขึ้นเงินเดือนประจำปี
  state.careerAndEdu.otUsedThisYear = 0;
  state.careerAndEdu.requestedRaiseThisYear = false;

  // 2. อัปเดตระยะเวลารับราชการทหารกองประจำการ (กรณีติดใบแดง 2 ปี หรือสมัครใจ 1 ปี)
  if (Number(state.careerAndEdu.conscriptionYearsLeft || 0) > 0) {
    state.careerAndEdu.conscriptionYearsLeft -= 1;
    if (state.careerAndEdu.conscriptionYearsLeft <= 0) {
      state.careerAndEdu.conscriptionYearsLeft = 0;
      removeFlagOrStatus(state, 'flag_conscript_soldier_2yrs');
      removeFlagOrStatus(state, 'flag_conscript_soldier_1yr');
      report.dischargedFromMilitary = true;

      pushCareerEduLog(
        state,
        'ปลดประจำการทหารกองเกิน!',
        'รับใช้ชาติครบกำหนดปลดเป็นทหารกองหนุน พร้อมกลับเข้าสู่ตลาดแรงงานและการศึกษาอย่างเต็มตัว',
        'shield',
        'เมษายน'
      );
    }
  }

  // 3. ประมวลผลกิจกรรมพัฒนาการตามวัย (currentActivityId)
  if (state.careerAndEdu.currentActivityId) {
    const actDef = db.getActivity(state.careerAndEdu.currentActivityId);
    if (actDef && age >= Number(actDef.min_age || 0) && age <= Number(actDef.max_age ?? 100)) {
      applyRecurringEffects(actDef.yearly_stat_effects || {}, studyMult);
      for (const rf of actDef.removes_flags || []) {
        removeFlagOrStatus(state, rf);
      }
      for (const gf of actDef.grants_flags || []) {
        addFlagOrStatus(state, gf);
      }
    } else {
      // เมื่ออายุพ้นช่วงของกิจกรรมเดิมแล้ว ให้ล้างออกหรือสลับเป็นกิจกรรมพื้นฐานฟรีของช่วงวัยใหม่ให้อัตโนมัติ
      state.careerAndEdu.currentActivityId = null;
      report.activityAutoCleared = true;

      const defaultNextActivity = (db.raw.eduJobs?.age_progression_activities || []).find(
        (a) =>
          age >= a.min_age &&
          age <= a.max_age &&
          Number(a.annual_cost_cash || 0) === 0 &&
          checkRequirement(a.req_stats || {}, [], state, { reqAnyFlags: a.req_any_flags || [] })
      );
      if (defaultNextActivity) {
        state.careerAndEdu.currentActivityId = defaultNextActivity.activity_id;
      }
    }
  }

  // 4. ประมวลผลความก้าวหน้าการเรียนมหาวิทยาลัย / ปวส. (activeStudy)
  const study = state.careerAndEdu.activeStudy;
  if (study && study.programId) {
    const progDef = db.getProgram(study.programId);
    if (progDef) {
      applyRecurringEffects(progDef.yearly_stat_effects || {}, studyMult);
    }

    study.yearsCompleted = Number(study.yearsCompleted || 0) + 1;

    if (study.yearsCompleted >= Number(study.durationYears || 4)) {
      // สำเร็จการศึกษา!
      const gradProgramId = study.programId;
      report.graduatedProgramId = gradProgramId;

      if (!state.careerAndEdu.completedDegrees.includes(gradProgramId)) {
        state.careerAndEdu.completedDegrees.push(gradProgramId);
      }

      for (const gradFlag of progDef?.grants_flags_on_grad || []) {
        addFlagOrStatus(state, gradFlag);
      }

      state.careerAndEdu.activeStudy = null;

      // เมื่อเรียนจบและไม่มีงานหลัก แต่มีงานพาร์ทไทม์ทำค้างอยู่ ให้เลื่อนพาร์ทไทม์ขึ้นมาเป็น mainJobId ชั่วคราวเพื่อไม่ให้รายได้สะดุด
      let promotedPtNote = '';
      if (state.careerAndEdu.partTimeJobId && !state.careerAndEdu.mainJobId) {
        const ptJob = db.getJob(state.careerAndEdu.partTimeJobId);
        state.careerAndEdu.mainJobId = state.careerAndEdu.partTimeJobId;
        state.careerAndEdu.partTimeJobId = null;
        state.careerAndEdu.yearsInMainJob = 0;
        state.careerAndEdu.salaryMultiplier = 1.0;
        promotedPtNote = ptJob
          ? ` (ปรับงาน "${stripEmojis(ptJob.name_th)}" ขึ้นเป็นอาชีพเลี้ยงตัวชั่วคราวระหว่างหางานใหม่)`
          : '';
      }

      const cleanProgTitle = stripEmojis(progDef?.name_th || gradProgramId);
      pushCareerEduLog(
        state,
        `สำเร็จการศึกษา: ${cleanProgTitle}!`,
        `เรียนจบครบหลักสูตร ${study.durationYears} ปี รับใบปริญญา/วุฒิบัตรพร้อมต่อยอดสายอาชีพเต็มตัว${promotedPtNote}`,
        'trophy',
        'พฤษภาคม'
      );
    }
  }

  // 5. ประมวลผลอาชีพที่ทำอยู่ (อายุงาน, yearly_stat_effects, ความเสี่ยงโรคจากการทำงาน และการเกษียณอายุ)
  const checkOccupationalStatusTrigger = (jobDef) => {
    const trigger = jobDef?.risk_status_trigger;
    // กรองเฉพาะรหัสที่เป็นโรคประจำตัว status_* (ส่วนรหัส event_* เช่น event_heavy_accident_bill จะถูกทอยใน event_engine.js อยู่แล้ว)
    if (!trigger || !trigger.startsWith('status_')) return;
    if (getPlayerFlagSet(state).has(trigger)) return;

    if (rollChance(12)) {
      addFlagOrStatus(state, trigger);
      report.triggeredOccupationalIllness = trigger;
      const illnessDef = db.getTraitOrFlag(trigger);
      const illnessName = stripEmojis(illnessDef?.name_th || trigger);

      pushCareerEduLog(
        state,
        `โรคจากการทำงานถามหา: ${illnessName}`,
        `ผลจากการตรากตรำทำงานในสายอาชีพ "${stripEmojis(jobDef.name_th)}" ทำให้ร่างกายเริ่มมีอาการ ${illnessName}`,
        'hospital',
        'สิงหาคม'
      );
    }
  };

  // 5.1 อาชีพหลัก (mainJobId)
  if (state.careerAndEdu.mainJobId) {
    const mainJob = db.getJob(state.careerAndEdu.mainJobId);
    if (mainJob) {
      const retireLimit = Number(mainJob.retirement_age ?? mainJob.max_age ?? 100);
      if (age >= retireLimit) {
        // ปลดเกษียณตามเกณฑ์อายุของสายอาชีพนั้น
        report.retiredJobId = mainJob.job_id;
        safelyRemoveEmploymentFlags(state, mainJob);
        state.careerAndEdu.mainJobId = null;
        state.careerAndEdu.yearsInMainJob = 0;
        state.careerAndEdu.salaryMultiplier = 1.0;

        pushCareerEduLog(
          state,
          `เกษียณจากสายอาชีพ: ${stripEmojis(mainJob.name_th)}`,
          `ครบกำหนดอายุการทำงานสูงสุด (${retireLimit} ปี) ของตำแหน่ง "${stripEmojis(mainJob.name_th)}"`,
          'flag',
          'กันยายน'
        );
      } else {
        state.careerAndEdu.yearsInMainJob = Number(state.careerAndEdu.yearsInMainJob || 0) + 1;
        applyRecurringEffects(mainJob.yearly_stat_effects || {});
        checkOccupationalStatusTrigger(mainJob);
      }
    }
  }

  // 5.2 อาชีพเสริมพาร์ทไทม์ระหว่างเรียน (partTimeJobId)
  if (state.careerAndEdu.partTimeJobId) {
    const ptJob = db.getJob(state.careerAndEdu.partTimeJobId);
    if (ptJob) {
      const maxPtAge = Number(ptJob.max_age ?? 70);
      if (age > maxPtAge || (!isPlayerCurrentlyStudying(state) && state.careerAndEdu.mainJobId)) {
        safelyRemoveEmploymentFlags(state, ptJob);
        state.careerAndEdu.partTimeJobId = null;
      } else {
        applyRecurringEffects(ptJob.yearly_stat_effects || {});
        checkOccupationalStatusTrigger(ptJob);
      }
    }
  }

  return report;
}
