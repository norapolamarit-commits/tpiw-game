/**
 * js/engine/turn_manager.js
 * ตัวคุมจังหวะเกมหลัก (Turn & Game Loop Orchestrator):
 * ควบคุมการเริ่มต้นชีวิตปีแรก, ลำดับการประมวลผลข้ามปี 7 ขั้นตอน,
 * การเช็กขีดสุดของหลอดสถานะ 0 / 100, การแสดงสลิปสรุปงบต้นปี,
 * การไหลของคิวอีเวนต์สู่ช่วง Free Action และปุ่ม Primary Action ด้านล่าง
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100% ใช้รหัส iconKey สำหรับเรนเดอร์ Inline SVG เท่านั้น
 */

import { db } from '../core/db.js';
import {
  getState,
  recalculateNetWorth,
  saveGame,
  MAX_FREE_ACTION_POINTS
} from '../core/state.js';
import { clampStat, getPlayerFlagSet } from '../core/utils.js';
import { applyStatEffects as applyCoreStatEffects } from '../core/stat_engine.js';
import { resetAnnualPassiveStatEffects, collectAnnualPassiveStatEffects, applyAnnualPassiveStatEffects } from '../core/annual_passive_stats.js';

import {
  processAnnualEconomyAndMarket,
  resolveNegativeCashProtocol,
  executeEmergencyDeficitOption,
  buyOrInvestInstrument,
  sellOrWithdrawInstrument,
  buyShopItem,
  sellOwnedAsset,
  applyForLoan,
  repayLoan,
  relocateProvince
} from './economy_engine.js';

import {
  buildAnnualEventQueue,
  getCurrentPendingEvent,
  selectEventChoice as baseSelectEventChoice,
  advanceEventQueue as baseAdvanceEventQueue,
  stripEmojis
} from './event_engine.js';

import {
  processAnnualCareerAndStudyProgression,
  selectAgeActivity,
  enrollHigherEducation,
  dropOutHigherEducation,
  takeLicenseExam,
  applyForJob,
  quitJob,
  workOvertimeAction,
  requestPromotionOrRaise,
  getAvailableActivities,
  getAvailableEducationPrograms,
  getAvailableLicenses,
  getCategorizedJobsForUI
} from './career_edu_engine.js';

import {
  processAnnualSocialAndFamilyProgression,
  discoverPotentialPartners,
  startTalkingToPartner,
  breakUpWithPartner,
  performRelationshipAction,
  changeChildUpbringingPolicy,
  designateHeirChild,
  getAvailableRelationshipActions
} from './social_engine.js';

import {
  determineDeathCause,
  finalizeLifeAndCalculateKarmicBalance,
  writeWillAndTestament,
  startNextGenerationAsChild as baseStartNextGenerationAsChild,
  finishAndReturnToLobby
} from './ending_engine.js';

// ============================================================================
// Internal Helpers (การจัดการป้ายสถานะ สเตตัส และการกระจาย Event แจ้ง UI)
// ============================================================================

/**
 * คำนวณเพดานแต้มเวลาว่างต่อปีตามช่วงวัย (วัยทารก 0-4 ปี ได้ 2 แต้ม, วัย 5+ ได้ 3 แต้ม)
 * @param {number} age
 * @returns {number}
 */
export function getMaxFreeActionPointsForAge(age) {
  return Number(age || 0) <= 4 ? 2 : MAX_FREE_ACTION_POINTS;
}

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

function removeFlagOrStatus(state, flagId) {
  if (!flagId) return;
  state.flags = (state.flags || []).filter((f) => f !== flagId);
  state.talentTags = (state.talentTags || []).filter((f) => f !== flagId);
  state.statuses = (state.statuses || []).filter((f) => f !== flagId);
  state.innateTraits = (state.innateTraits || []).filter((f) => f !== flagId);
}

/**
 * บวกลบค่าสถานะเฉพาะหลอดทั้ง 6 (ห้ามยุ่งกับ cash เด็ดขาดเพราะคำนวณใน economy_engine.js แล้ว)
 * @param {object} state
 * @param {Record<string, number>} effects
 */
function applyNonCashStatEffects(state, effects) {
  if (!effects || typeof effects !== 'object' || !state.stats) return;

  applyCoreStatEffects(state, effects);
}

/**
 * ทำความสะอาดรายการข้อความใน lifeFeedLog ไม่ให้มีอักขระ Emoji ตกค้างจากโมดูลยุคแรก
 * @param {object} state
 */
function sanitizeLifeFeedLog(state) {
  if (!Array.isArray(state?.turn?.lifeFeedLog)) return;
  for (const entry of state.turn.lifeFeedLog) {
    if (entry.title) entry.title = stripEmojis(entry.title);
    if (entry.message) entry.message = stripEmojis(entry.message);
    if (!entry.iconKey) {
      entry.iconKey = entry.type === 'birth' ? 'smile' : (entry.type === 'crisis' ? 'alert' : 'calendar');
    }
  }
}

/**
 * กระจาย CustomEvent แจ้งฝั่ง UI ให้วาดหน้าจอใหม่เมื่อ State เปลี่ยนแปลง
 * @param {object} state
 */
export function notifyGameStateChanged(state) {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent('game:stateChanged', {
        detail: { state }
      })
    );
  }
}

// ============================================================================
// 1. เริ่มต้นเทิร์นปีแรกสุดสำหรับตัวละครเกิดใหม่ (0 ขวบ) หรือทายาทสืบทอดมรดก (18 ปี)
// ============================================================================

/**
 * สุ่มคิวอีเวนต์ปีแรกสุดและตั้งค่าแต้มเวลาว่างเมื่อเพิ่งกำเนิดตัวละครใหม่หรือเริ่มรุ่นทายาท
 * @param {object} [state=getState()]
 */
export function initializeFirstYearTurn(state = getState()) {
  if (!state || !state.turn) return null;

  const age = Number(state.profile.age || 0);
  const maxAp = getMaxFreeActionPointsForAge(age);

  state.turn.maxFreeActionPoints = maxAp;
  state.turn.freeActionPoints = maxAp;
  state.turn.awaitingEventAdvance = false;
  state.turn.lastChoiceOutcome = null;

  sanitizeLifeFeedLog(state);

  const queue = buildAnnualEventQueue(state);
  const firstEvent = getCurrentPendingEvent(state);

  saveGame(state);
  notifyGameStateChanged(state);

  return {
    success: true,
    iconKey: 'calendar',
    age,
    phase: state.turn.phase,
    areTabsLocked: state.turn.areTabsLocked,
    eventsCount: queue.length,
    currentEvent: firstEvent
  };
}

// ============================================================================
// 2. ประมวลผล Passive ประจำปีของจังหวัด ป้ายสถานะ และขีดสุดหลอด 0 / 100
// ============================================================================

/**
 * บวกลบค่าสถานะรายปีจากจังหวัดปัจจุบัน และป้ายสถานะทั้งหมดของผู้เล่น (ไม่แตะ cash!)
 * @param {object} state
 */
export function processAnnualLocationAndFlagPassives(state) {
  if (!state) return;

  // Collect location passives so they share an annual cap with Traits, Statuses and family.
  const currentLoc = db.getLocation(state.profile.currentLocationId);
  if (currentLoc?.yearly_passive_effects) collectAnnualPassiveStatEffects(state,currentLoc.yearly_passive_effects);

  // 2.2 บวกลบ yearly_stat_effects (เฉพาะ health, happiness, intelligence, connections, merit, appearance)
  const activeFlags = getPlayerFlagSet(state);
  for (const flagId of activeFlags) {
    // หากผู้เล่นสร้างฐานะพ้นจาก class_1 แล้ว ล้างป้ายเสี่ยงขาดสารอาหารวัยยากจนออก
    if (flagId === 'flag_malnutrition_risk' && state.profile.currentClassId !== 'class_1') {
      removeFlagOrStatus(state, 'flag_malnutrition_risk');
      continue;
    }

    const def = db.getTraitOrFlag(flagId);
    if (def?.yearly_stat_effects) {
      collectAnnualPassiveStatEffects(state,def.yearly_stat_effects);
    }
  }
  return applyAnnualPassiveStatEffects(state,db.getGameConstants()?.annual_passive_stat_gain_caps||[]);
}

/**
 * Apply a threshold effect only when its flag becomes active.
 * Threshold checks also run after individual event choices, so applying the
 * reward on every check would multiply the effect within a single year.
 */
function grantThresholdFlagOnce(state, flagId, effects, grantedThresholdFlags) {
  const wasActive = getPlayerFlagSet(state).has(flagId);
  addFlagOrStatus(state, flagId);
  if (wasActive) return false;

  if (effects) applyNonCashStatEffects(state, effects);
  grantedThresholdFlags.push(flagId);
  return true;
}

/**
 * ตรวจสอบขีดสุดของหลอดทั้ง 6 (0 และ 100) ตาม Core_Rules_&_Locations.json
 * และเช็กเงื่อนไขจบเกม (health <= 0 หรือ age >= 100)
 * @param {object} state
 * @returns {{
 *   isEnded: boolean,
 *   endingReport: object|null,
 *   grantedThresholdFlags: string[]
 * }}
 */
export function checkStatThresholdsAndDeath(state) {
  const grantedThresholdFlags = [];
  if (!state || !state.stats) {
    return { isEnded: false, endingReport: null, grantedThresholdFlags };
  }

  const s = state.stats;

  // 1. Health (0 = เสียชีวิตทันที / 100 = บัฟร่างกายเหล็กไหล flag_iron_body)
  if (Number(s.health) >= 100) {
    s.health = 100;
    grantThresholdFlagOnce(state, 'flag_iron_body', { happiness: 1, appearance: 1 }, grantedThresholdFlags);
  } else {
    removeFlagOrStatus(state, 'flag_iron_body');
  }

  if (Number(s.health) <= 0) {
    s.health = 0;
    addFlagOrStatus(state, 'flag_dead_by_illness');
    state.profile.isAlive = false;
  }

  // 2. Happiness (0 ติดกัน 2 ปี = โรคซึมเศร้า flag_depression / 100 = ออร่าพลังบวก flag_optimist_aura)
  if (Number(s.happiness) <= 0) {
    s.happiness = 0;
    state.statCounters = state.statCounters || {};
    const age = Number(state.profile.age || 0);
    if (Number(state.statCounters.lastZeroHappinessCountedAge ?? -1) !== age) {
      state.statCounters.zeroHappinessStreakYears =
        Number(state.statCounters.zeroHappinessStreakYears || 0) + 1;
      state.statCounters.lastZeroHappinessCountedAge = age;
    }

    if (state.statCounters.zeroHappinessStreakYears >= 2) {
      grantThresholdFlagOnce(state, 'flag_depression', { health: -5, intelligence: -2 }, grantedThresholdFlags);
    }
  } else {
    state.statCounters.zeroHappinessStreakYears = 0;
  }

  if (Number(s.happiness) >= 100) {
    s.happiness = 100;
    grantThresholdFlagOnce(state, 'flag_optimist_aura', { health: 2, connections: 2 }, grantedThresholdFlags);
  } else {
    removeFlagOrStatus(state, 'flag_optimist_aura');
  }

  // 3. Intelligence (0 = flag_severe_learning_disability / 100 = flag_genius_mind)
  if (Number(s.intelligence) <= 0) {
    s.intelligence = 0;
    grantThresholdFlagOnce(state, 'flag_severe_learning_disability', { connections: -1 }, grantedThresholdFlags);
  } else {
    removeFlagOrStatus(state, 'flag_severe_learning_disability');
  }

  if (Number(s.intelligence) >= 100) {
    s.intelligence = 100;
    grantThresholdFlagOnce(state, 'flag_genius_mind', { connections: 2 }, grantedThresholdFlags);
  } else {
    removeFlagOrStatus(state, 'flag_genius_mind');
  }

  // 4. Connections (0 = flag_public_enemy / 100 = flag_beloved_icon)
  if (Number(s.connections) <= 0) {
    s.connections = 0;
    grantThresholdFlagOnce(state, 'flag_public_enemy', { happiness: -2 }, grantedThresholdFlags);
  } else {
    removeFlagOrStatus(state, 'flag_public_enemy');
  }

  if (Number(s.connections) >= 100) {
    s.connections = 100;
    grantThresholdFlagOnce(state, 'flag_beloved_icon', { happiness: 2 }, grantedThresholdFlags);
  } else {
    removeFlagOrStatus(state, 'flag_beloved_icon');
  }

  // 5. Merit (<= 0 = flag_cursed_fate / >= 100 = flag_blessed_destiny)
  if (Number(s.merit) <= 0) {
    grantThresholdFlagOnce(state, 'flag_cursed_fate', { health: -2, happiness: -2 }, grantedThresholdFlags);
    removeFlagOrStatus(state, 'flag_blessed_destiny');
  } else if (Number(s.merit) >= 100) {
    grantThresholdFlagOnce(state, 'flag_blessed_destiny', { happiness: 2, connections: 1 }, grantedThresholdFlags);
    removeFlagOrStatus(state, 'flag_cursed_fate');
  } else {
    removeFlagOrStatus(state, 'flag_cursed_fate');
    removeFlagOrStatus(state, 'flag_blessed_destiny');
  }

  // 6. Appearance (0 = flag_social_outcast_look / 100 = flag_beauty_privilege)
  if (Number(s.appearance) <= 0) {
    s.appearance = 0;
    grantThresholdFlagOnce(state, 'flag_social_outcast_look', { happiness: -2, connections: -2 }, grantedThresholdFlags);
  } else {
    removeFlagOrStatus(state, 'flag_social_outcast_look');
  }

  if (Number(s.appearance) >= 100) {
    s.appearance = 100;
    grantThresholdFlagOnce(state, 'flag_beauty_privilege', { connections: 3, happiness: 1 }, grantedThresholdFlags);
  } else {
    removeFlagOrStatus(state, 'flag_beauty_privilege');
  }

  // ตรวจซ้ำอีกครั้งเผื่อดีบัฟจากความสุขหรือดวงตกดึง health ลงมาแตะ 0 พอดี
  if (Number(s.health) <= 0) {
    s.health = 0;
    addFlagOrStatus(state, 'flag_dead_by_illness');
    state.profile.isAlive = false;
  }

  // 7. ตรวจสอบเงื่อนไขจบเกม (เสียชีวิต หรือ อายุครบ 100 ปีบริบูรณ์)
  const maxAge = Number(db.getGameConstants()?.max_age ?? 100);
  const reachedMaxAge = Number(state.profile.age || 0) >= maxAge;

  if (!state.profile.isAlive || reachedMaxAge) {
    const cause = determineDeathCause(state);
    if (cause) {
      state.profile.deathCauseId = cause.deathId;
    }
    const endingReport = finalizeLifeAndCalculateKarmicBalance(state);
    state.turn.pendingEvents = [];
    state.turn.currentEventIndex = 0;
    state.turn.awaitingEventAdvance = false;
    state.turn.lastChoiceOutcome = null;
    state.turn.phase = 'ENDED';
    state.turn.areTabsLocked = true;

    return {
      isEnded: true,
      endingReport,
      grantedThresholdFlags
    };
  }

  return {
    isEnded: false,
    endingReport: null,
    grantedThresholdFlags
  };
}

// ============================================================================
// 3. ฟังก์ชันหลักเมื่อผู้เล่นกดปุ่ม "ปีถัดไป (+1 ปี)" (startNextYearTurn)
// ============================================================================

/**
 * เดินแกนเวลาไปข้างหน้า +1 ปี คำนวณครบทั้ง 7 ขั้นตอน และเข้าสู่หน้าสลิปสรุปงบต้นปี
 * @param {object} [state=getState()]
 */
export function startNextYearTurn(state = getState()) {
  if (!state || !state.turn) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลสถานะเกมปัจจุบัน' };
  }

  if (!state.profile.isAlive || state.turn.phase === 'ENDED') {
    const endingReport = finalizeLifeAndCalculateKarmicBalance(state);
    return {
      success: false,
      phase: 'ENDED',
      iconKey: 'crown',
      endingReport,
      message: 'ชีวิตนี้ได้เดินทางมาถึงบทสรุปแล้ว'
    };
  }

  if (state.turn.phase !== 'FREE_ACTION') {
    return {
      success: false,
      phase: state.turn.phase,
      iconKey: 'lock',
      message:
        state.turn.phase === 'YEAR_SUMMARY'
          ? 'กรุณากดรับทราบสรุปงบประจำปีก่อนดำเนินการต่อ'
          : state.turn.phase === 'EMERGENCY_DEBT'
            ? 'กรุณาจัดการยอดเงินสดติดลบฉุกเฉินให้เรียบร้อยก่อนข้ามปี'
            : 'กรุณาตัดสินใจเหตุการณ์ประจำปีในคิวให้ครบก่อนก้าวสู่ปีถัดไป'
    };
  }

  // --- Pre-Turn Guard: เช็กว่ายังมีเงินสดติดลบค้างอยู่ก่อนกดข้ามปีหรือไม่ ---
  if (Number(state.finance?.cash || 0) < 0) {
    const preDebtCheck = resolveNegativeCashProtocol(state);
    sanitizeLifeFeedLog(state);

    if (!preDebtCheck.resolved) {
      state.turn.phase = 'EMERGENCY_DEBT';
      state.turn.areTabsLocked = true;
      state.turn.pendingEmergencyDebt = preDebtCheck;
      saveGame(state);
      notifyGameStateChanged(state);

      return {
        success: false,
        phase: 'EMERGENCY_DEBT',
        iconKey: 'alert',
        emergencyDebtInfo: preDebtCheck,
        message: 'บัญชีเงินสดติดลบ! กรุณาเลือกแนวทางแก้ไขสภาพคล่องฉุกเฉินก่อนข้ามปี'
      };
    }
  }

  // =========================================================================
  // ลำดับการคำนวณข้ามปี 7 ขั้นตอน (Annual 7-Step Pipeline)
  // =========================================================================

  // ขั้นที่ 1: เพิ่มอายุ +1 ปี, ปี พ.ศ. +1, อัปเดตช่วงวัย และรีเซ็ตแต้มเวลาว่าง
  const newAge = Number(state.profile.age || 0) + 1;
  state.profile.age = newAge;
  state.profile.currentYearBE = Number(state.profile.currentYearBE || 2568) + 1;

  const phaseInfo = db.getLifePhaseByAge(newAge);
  if (phaseInfo?.phaseId) {
    state.profile.lifePhaseId = phaseInfo.phaseId;
  }

  const maxAp = getMaxFreeActionPointsForAge(newAge);
  resetAnnualPassiveStatEffects(state);
  state.turn.maxFreeActionPoints = maxAp;
  state.turn.freeActionPoints = maxAp;
  state.turn.awaitingEventAdvance = false;
  state.turn.lastChoiceOutcome = null;
  state.turn.pendingEmergencyDebt = null;

  // ขั้นที่ 2: ประมวลผลครอบครัว ความสัมพันธ์ มรดกพ่อแม่ และพัฒนาการลูก
  const socialReport = processAnnualSocialAndFamilyProgression(state,{ deferAnnualPassives:true });

  // ขั้นที่ 3: ประมวลผลการเรียน กิจกรรมตามวัย อายุงาน โรคจากการทำงาน และการเกษียณ
  const careerEduReport = processAnnualCareerAndStudyProgression(state,{ deferAnnualPassives:true });

  // ขั้นที่ 4: คำนวณเศรษฐกิจรายปี รายรับ-รายจ่าย ตลาดหุ้น สลากออมสิน และสร้างสลิปงบ
  const annualSlip = processAnnualEconomyAndMarket(state);

  // ขั้นที่ 5: บวกลบ Passive ประจำจังหวัดและป้ายสถานะทั้งหมด (เฉพาะหลอด 6 ตัว ไม่รวมเงินสด)
  processAnnualLocationAndFlagPassives(state);

  // ขั้นที่ 6: ตรวจสอบขีดสุดหลอด 0 / 100 และเช็กเงื่อนไขเสียชีวิตหรืออายุครบ 100 ปี
  const thresholdCheck = checkStatThresholdsAndDeath(state);
  sanitizeLifeFeedLog(state);

  if (thresholdCheck.isEnded) {
    recalculateNetWorth(state);
    saveGame(state);
    notifyGameStateChanged(state);

    return {
      success: true,
      phase: 'ENDED',
      iconKey: 'crown',
      age: newAge,
      annualSlip,
      endingReport: thresholdCheck.endingReport,
      message: 'สิ้นสุดการเดินทางของชีวิต เข้าสู่หน้าสรุปบทอวสาน'
    };
  }

  // ขั้นที่ 7: เช็กโปรโตคอลเงินติดลบเบื้องต้น (ถอนออมสิน/แม่ช่วยอัตโนมัติ) และสร้างคิวอีเวนต์ปีใหม่
  const postSlipDebtCheck = resolveNegativeCashProtocol(state);
  state.turn.pendingEmergencyDebt = postSlipDebtCheck.resolved ? null : postSlipDebtCheck;

  const eventsQueue = buildAnnualEventQueue(state);

  // บังคับตั้งโหมดเป็น YEAR_SUMMARY และล็อกแท็บ เพื่อให้ผู้เล่นดูสลิปสรุปงบข้ามปีก่อนเริ่มอีเวนต์!
  state.turn.phase = 'YEAR_SUMMARY';
  state.turn.areTabsLocked = true;

  sanitizeLifeFeedLog(state);
  recalculateNetWorth(state);
  saveGame(state);
  notifyGameStateChanged(state);

  return {
    success: true,
    phase: 'YEAR_SUMMARY',
    iconKey: 'file_text',
    age: newAge,
    annualSlip,
    socialReport,
    careerEduReport,
    postSlipDebtCheck,
    eventsQueuedCount: eventsQueue.length,
    message: `ก้าวสู่วัย ${newAge} ปี สรุปงบการเงินประจำปีพร้อมแสดงผล`
  };
}

// ============================================================================
// 4. ปิดสลิปงบต้นปีเพื่อเข้าสู่คิวอีเวนต์ & Wrapper ควบคุมจังหวะการ์ดอีเวนต์
// ============================================================================

/**
 * เรียกเมื่อผู้เล่นกดปุ่มรับทราบสลิปสรุปงบต้นปี (Modal / การ์ดสรุปงบ)
 * หากเงินสดยังติดลบจะบังคับเข้าโหมดเคลียร์หนี้ฉุกเฉิน มิฉะนั้นจะเปิดอีเวนต์ใบแรกของปีทันที
 * @param {object} [state=getState()]
 */
export function acknowledgeAnnualSlipAndStartEvents(state = getState()) {
  if (!state || !state.turn) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลสถานะเกม' };
  }

  if (!state.profile.isAlive || state.turn.phase === 'ENDED') {
    return {
      success: true,
      phase: 'ENDED',
      iconKey: 'crown',
      endingReport: finalizeLifeAndCalculateKarmicBalance(state)
    };
  }

  // ตรวจสอบว่าหลังหักค่าใช้จ่ายต้นปีและดึงออมสิน/แม่ช่วยแล้ว เงินยังติดลบอยู่หรือไม่
  if (Number(state.finance?.cash || 0) < 0) {
    const debtCheck = resolveNegativeCashProtocol(state);
    sanitizeLifeFeedLog(state);

    if (!debtCheck.resolved) {
      state.turn.phase = 'EMERGENCY_DEBT';
      state.turn.areTabsLocked = true;
      state.turn.pendingEmergencyDebt = debtCheck;
      saveGame(state);
      notifyGameStateChanged(state);

      return {
        success: true,
        phase: 'EMERGENCY_DEBT',
        iconKey: 'alert',
        requiresEmergencyResolution: true,
        emergencyDebtInfo: debtCheck,
        currentEvent: null,
        message: 'ยอดเงินสดติดลบ! กรุณาเลือกวิธีหาเงินสำรองฉุกเฉินก่อนดำเนินชีวิตในปีนี้ต่อ'
      };
    }
  }

  state.turn.pendingEmergencyDebt = null;
  state.turn.awaitingEventAdvance = false;
  state.turn.lastChoiceOutcome = null;

  const firstEvent = getCurrentPendingEvent(state);
  if (firstEvent) {
    state.turn.phase = 'EVENT_QUEUE';
    state.turn.areTabsLocked = true;
  } else {
    state.turn.phase = 'FREE_ACTION';
    state.turn.areTabsLocked = false;
  }

  saveGame(state);
  notifyGameStateChanged(state);

  return {
    success: true,
    phase: state.turn.phase,
    iconKey: firstEvent ? 'calendar' : 'unlock',
    requiresEmergencyResolution: false,
    currentEvent: firstEvent,
    message: firstEvent ? `เริ่มเหตุการณ์เดือน${firstEvent.monthTh}` : 'เข้าสู่ช่วงเวลาอิสระประจำปี'
  };
}

/**
 * ดำเนินการแก้ไขหนี้ติดลบฉุกเฉินจาก Modal แล้วพาผู้เล่นกลับเข้าสู่คิวอีเวนต์หรือ Free Action อัตโนมัติ
 * @param {string} optionType
 * @param {object} [payload={}]
 * @param {object} [state=getState()]
 */
export function resolveEmergencyDebtAndContinue(optionType, payload = {}, state = getState()) {
  if (!state) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลสถานะเกม' };
  }

  const res = executeEmergencyDeficitOption(state, optionType, payload);
  sanitizeLifeFeedLog(state);

  if (!res.success) {
    return { ...res, iconKey: 'alert' };
  }

  if (!res.resolved) {
    // กรณีขายทรัพย์สินชิ้นเล็กแล้วยังโปะยอดติดลบไม่ครบ ให้ค้างหน้า Modal ต่อพร้อมยอดคงเหลือใหม่
    state.turn.phase = 'EMERGENCY_DEBT';
    state.turn.areTabsLocked = true;
    state.turn.pendingEmergencyDebt = res;
    saveGame(state);
    notifyGameStateChanged(state);

    return {
      success: true,
      resolved: false,
      phase: 'EMERGENCY_DEBT',
      iconKey: 'alert',
      emergencyDebtInfo: res,
      message: 'ขายสินทรัพย์แล้วแต่ยอดเงินสดยังติดลบอยู่ กรุณาเลือกจัดการส่วนที่เหลือเพิ่มเติม'
    };
  }

  // เคลียร์ยอดติดลบเป็น >= 0 สำเร็จแล้ว -> เช็กว่ามีคิวอีเวนต์ของปีนี้รออยู่หรือไม่
  state.turn.pendingEmergencyDebt = null;
  const pendingEvt = getCurrentPendingEvent(state);

  if (pendingEvt) {
    state.turn.phase = 'EVENT_QUEUE';
    state.turn.areTabsLocked = true;
  } else {
    state.turn.phase = 'FREE_ACTION';
    state.turn.areTabsLocked = false;
  }

  saveGame(state);
  notifyGameStateChanged(state);

  return {
    success: true,
    resolved: true,
    phase: state.turn.phase,
    iconKey: 'check',
    currentEvent: pendingEvt,
    message: 'จัดการสภาพคล่องฉุกเฉินเรียบร้อยแล้ว!'
  };
}

/**
 * เลือกตัวเลือกในการ์ดอีเวนต์ปัจจุบัน พร้อมเช็กขีดสุดหลอด 0/100 และตั้งสถานะรอเลื่อนการ์ด
 * @param {string} choiceId
 * @param {object} [state=getState()]
 */
export function selectCurrentEventChoice(choiceId, state = getState()) {
  if (!state || !state.turn) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลสถานะเกม' };
  }

  if (state.turn.awaitingEventAdvance) {
    return {
      success: false,
      iconKey: 'info',
      message: 'คุณได้ตัดสินใจเหตุการณ์นี้ไปแล้ว กรุณากดปุ่มด้านล่างเพื่อไปต่อ'
    };
  }

  const result = baseSelectEventChoice(state, choiceId);
  if (!result.success) {
    return { ...result, iconKey: 'lock' };
  }

  // เช็กบัฟ/ดีบัฟขีดสุดและกรณีตายทันทีกลางคิว
  const thresholdCheck = checkStatThresholdsAndDeath(state);
  sanitizeLifeFeedLog(state);

  if (result.isPlayerDead || thresholdCheck.isEnded) {
    const endingReport = thresholdCheck.endingReport || finalizeLifeAndCalculateKarmicBalance(state);
    state.turn.phase = 'ENDED';
    state.turn.areTabsLocked = true;
    state.turn.awaitingEventAdvance = false;
    state.turn.lastChoiceOutcome = result;

    saveGame(state);
    notifyGameStateChanged(state);

    return {
      ...result,
      isPlayerDead: true,
      phase: 'ENDED',
      endingReport
    };
  }

  state.turn.awaitingEventAdvance = true;
  state.turn.lastChoiceOutcome = result;

  saveGame(state);
  notifyGameStateChanged(state);

  return {
    ...result,
    phase: state.turn.phase
  };
}

/**
 * กดปุ่มเลื่อนจากหน้าแสดงผลลัพธ์ช้อยส์ไปยังอีเวนต์ใบถัดไป หรือปลดล็อกเข้าสู่ช่วง Free Action
 * @param {object} [state=getState()]
 */
export function proceedAfterEventOutcome(state = getState()) {
  if (!state || !state.turn) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลสถานะเกม' };
  }

  state.turn.awaitingEventAdvance = false;
  state.turn.lastChoiceOutcome = null;

  const advResult = baseAdvanceEventQueue(state);

  // หากจบคิวอีเวนต์ทั้งหมดของปีนี้แล้ว แต่ช้อยส์ในอีเวนต์ทำเงินสดติดลบ ให้ตรวจสอบโปรโตคอลเงินติดลบทันที
  if (advResult.completedQueue && state.turn.phase === 'FREE_ACTION' && Number(state.finance?.cash || 0) < 0) {
    const debtCheck = resolveNegativeCashProtocol(state);
    sanitizeLifeFeedLog(state);

    if (!debtCheck.resolved) {
      state.turn.phase = 'EMERGENCY_DEBT';
      state.turn.areTabsLocked = true;
      state.turn.pendingEmergencyDebt = debtCheck;
      saveGame(state);
      notifyGameStateChanged(state);

      return {
        ...advResult,
        phase: 'EMERGENCY_DEBT',
        areTabsLocked: true,
        emergencyDebtInfo: debtCheck
      };
    }
  }

  saveGame(state);
  notifyGameStateChanged(state);

  return advResult;
}

/**
 * Wrapper สืบทอดทายาทรุ่นลูกพร้อมสุ่มคิวอีเวนต์ปีแรกของวัย 18 ปีให้พร้อมเล่นทันที
 * @param {object} [previousState=getState()]
 * @param {string|null} [childId=null]
 */
export function continueAsNextGenerationHeir(previousState = getState(), childId = null) {
  const res = baseStartNextGenerationAsChild(previousState, childId);
  if (!res.success || !res.newState) {
    return res;
  }

  initializeFirstYearTurn(res.newState);
  return res;
}

// ============================================================================
// 5. Helper กลางสำหรับปุ่ม Sticky Primary Action ด้านล่างสุดของหน้าจอ
// ============================================================================

/**
 * คำนวณสเปกปุ่มใหญ่สีกรมท่าด้านล่างสุดของจอตามสถานะเทิร์นปัจจุบัน
 * เพื่อให้ฝั่ง UI นำไปเรนเดอร์ข้อความ สถานะ Disabled และ Inline SVG ได้ตรงกันทุกหน้าจอ
 *
 * @param {object} [state=getState()]
 * @returns {{
 *   actionType: string,
 *   labelTh: string,
 *   iconKey: string,
 *   disabled: boolean,
 *   phase: string,
 *   remainingEventsCount: number
 * }}
 */
export function getPrimaryActionButtonSpec(state = getState()) {
  if (!state || !state.turn) {
    return {
      actionType: 'NONE',
      labelTh: 'กำลังโหลดข้อมูล...',
      iconKey: 'info',
      disabled: true,
      phase: 'INIT',
      remainingEventsCount: 0
    };
  }

  const phase = state.turn.phase;
  const totalInQueue = Array.isArray(state.turn.pendingEvents) ? state.turn.pendingEvents.length : 0;
  const currentIdx = Number(state.turn.currentEventIndex || 0);
  const remainingAfterCurrent = Math.max(0, totalInQueue - (currentIdx + 1));

  if (!state.profile.isAlive || phase === 'ENDED') {
    return {
      actionType: 'VIEW_ENDING',
      labelTh: 'ดูบทสรุปชีวิต',
      iconKey: 'crown',
      disabled: false,
      phase: 'ENDED',
      remainingEventsCount: 0
    };
  }

  if (phase === 'YEAR_SUMMARY') {
    return {
      actionType: 'ACK_ANNUAL_SLIP',
      labelTh: 'รับทราบสรุปงบ / เริ่มเหตุการณ์ปีนี้',
      iconKey: 'check',
      disabled: false,
      phase: 'YEAR_SUMMARY',
      remainingEventsCount: totalInQueue
    };
  }

  if (phase === 'EMERGENCY_DEBT') {
    return {
      actionType: 'AWAITING_DEBT_MODAL',
      labelTh: 'กรุณาจัดการหนี้ติดลบฉุกเฉินด้านบน',
      iconKey: 'alert',
      disabled: true,
      phase: 'EMERGENCY_DEBT',
      remainingEventsCount: totalInQueue - currentIdx
    };
  }

  if (phase === 'EVENT_QUEUE') {
    if (!state.turn.awaitingEventAdvance) {
      return {
        actionType: 'AWAITING_CHOICE',
        labelTh: 'กรุณาเลือกทางตัดสินใจด้านบน',
        iconKey: 'info',
        disabled: true,
        phase: 'EVENT_QUEUE',
        remainingEventsCount: Math.max(0, totalInQueue - currentIdx)
      };
    }

    if (remainingAfterCurrent > 0) {
      return {
        actionType: 'NEXT_EVENT',
        labelTh: `เหตุการณ์ถัดไป (เหลืออีก ${remainingAfterCurrent})`,
        iconKey: 'arrow_right',
        disabled: false,
        phase: 'EVENT_QUEUE',
        remainingEventsCount: remainingAfterCurrent
      };
    }

    return {
      actionType: 'UNLOCK_FREE_ACTION',
      labelTh: 'เข้าสู่ช่วงอิสระท้ายปี',
      iconKey: 'unlock',
      disabled: false,
      phase: 'EVENT_QUEUE',
      remainingEventsCount: 0
    };
  }

  // โหมด FREE_ACTION ปกติ
  return {
    actionType: 'NEXT_YEAR',
    labelTh: 'ปีถัดไป (+1 ปี)',
    iconKey: 'fast_forward',
    disabled: false,
    phase: 'FREE_ACTION',
    remainingEventsCount: 0
  };
}

/**
 * สั่งทำงานเมื่อผู้เล่นแตะปุ่ม Sticky Primary Action ด้านล่างสุดของจอ
 * @param {object} [state=getState()]
 */
export function triggerPrimaryActionButton(state = getState()) {
  const spec = getPrimaryActionButtonSpec(state);
  if (spec.disabled) {
    return {
      success: false,
      actionType: spec.actionType,
      iconKey: spec.iconKey,
      message: spec.labelTh
    };
  }

  switch (spec.actionType) {
    case 'ACK_ANNUAL_SLIP':
      return acknowledgeAnnualSlipAndStartEvents(state);

    case 'NEXT_EVENT':
    case 'UNLOCK_FREE_ACTION':
      return proceedAfterEventOutcome(state);

    case 'NEXT_YEAR':
      return startNextYearTurn(state);

    case 'VIEW_ENDING': {
      const endingReport = finalizeLifeAndCalculateKarmicBalance(state);
      notifyGameStateChanged(state);
      return {
        success: true,
        actionType: 'VIEW_ENDING',
        phase: 'ENDED',
        iconKey: 'crown',
        endingReport
      };
    }

    default:
      return { success: false, iconKey: 'info', message: 'ไม่สามารถดำเนินการได้ในขณะนี้' };
  }
}

// ============================================================================
// Re-export Unified Engine Facade สำหรับให้ UI และ main.js เรียกใช้งานได้ครบจากจุดเดียว
// ============================================================================

export const engineFacade = {
  // Turn & Primary Loop
  initializeFirstYearTurn,
  startNextYearTurn,
  acknowledgeAnnualSlipAndStartEvents,
  selectCurrentEventChoice,
  proceedAfterEventOutcome,
  resolveEmergencyDebtAndContinue,
  getPrimaryActionButtonSpec,
  triggerPrimaryActionButton,
  processAnnualLocationAndFlagPassives,
  checkStatThresholdsAndDeath,

  // Economy, Market, Shop & Loans
  processAnnualEconomyAndMarket,
  resolveNegativeCashProtocol,
  executeEmergencyDeficitOption,
  buyOrInvestInstrument,
  sellOrWithdrawInstrument,
  buyShopItem,
  sellOwnedAsset,
  applyForLoan,
  repayLoan,
  relocateProvince,

  // Events
  buildAnnualEventQueue,
  getCurrentPendingEvent,
  selectEventChoice: selectCurrentEventChoice,
  advanceEventQueue: proceedAfterEventOutcome,
  stripEmojis,

  // Career, Education & Licenses
  processAnnualCareerAndStudyProgression,
  selectAgeActivity,
  enrollHigherEducation,
  dropOutHigherEducation,
  takeLicenseExam,
  applyForJob,
  quitJob,
  workOvertimeAction,
  requestPromotionOrRaise,
  getAvailableActivities,
  getAvailableEducationPrograms,
  getAvailableLicenses,
  getCategorizedJobsForUI,

  // Social, Romance & Children
  processAnnualSocialAndFamilyProgression,
  discoverPotentialPartners,
  startTalkingToPartner,
  breakUpWithPartner,
  performRelationshipAction,
  changeChildUpbringingPolicy,
  designateHeirChild,
  getAvailableRelationshipActions,

  // Endings, Will & Legacy
  determineDeathCause,
  finalizeLifeAndCalculateKarmicBalance,
  writeWillAndTestament,
  startNextGenerationAsChild: continueAsNextGenerationHeir,
  finishAndReturnToLobby
};

export default engineFacade;
