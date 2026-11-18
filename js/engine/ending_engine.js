/**
 * js/engine/ending_engine.js
 * โมดูลจัดการระบบพินัยกรรมวัยเกษียณ การตรวจสอบสาเหตุการเสียชีวิต 7 รูปแบบ
 * การจัดอันดับฉากจบ 9 ระดับ (SSR - E) การคำนวณแต้มบุญสะสมข้ามภพชาติ (Karmic Balance)
 * และระบบส่งต่อมรดกเพื่อเล่นต่อเป็นทายาทรุ่นลูก (Legacy Mode)
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100% ใช้รหัส iconKey / rankIconKey สำหรับวาด Inline SVG เท่านั้น
 */

import { db } from '../core/db.js';
import {
  createEmptyGameState,
  loadMetaState,
  saveMetaState,
  recalculateNetWorth,
  setState,
  saveGame,
  clearSavedGame,
  MAX_FREE_ACTION_POINTS
} from '../core/state.js';
import { clampStat, getPlayerFlagSet, formatCurrency } from '../core/utils.js';
import { stripEmojis } from './event_engine.js';

// ============================================================================
// Constants & Mapping Tables
// ============================================================================

const ENDING_RANK_ICON_MAP = {
  end_01_centenarian_legend: 'crown',
  end_02_tycoon_mogul: 'gem',
  end_03_bodhisattva_philanthropist: 'sparkle',
  end_04_self_made_fighter: 'flame',
  end_05_honorable_pillar: 'shield',
  end_06_happy_family_matriarch: 'home',
  end_07_ordinary_survivor: 'leaf',
  end_08_drowned_in_debt: 'coin',
  end_09_fallen_youth: 'alert'
};

const DEATH_CAUSE_ICON_MAP = {
  death_natural_centenarian: 'crown',
  death_natural_old_age: 'leaf',
  death_cardiovascular_overwork: 'heart_pulse',
  death_road_accident: 'alert',
  death_depression_burnout: 'hospital',
  death_loan_shark_violence: 'alert',
  death_general_illness: 'hospital'
};

const BASE_WILL_LAWYER_FEE = 2000;

/**
 * เพิ่มป้ายสถานะลงในหมวดหมู่ที่ถูกต้องของ state
 */
function addFlagToState(state, flagId) {
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

// ============================================================================
// 1. ระบบร่างพินัยกรรมวัยเกษียณ (Will & Testament System)
// ============================================================================

/**
 * ร่างและจดทะเบียนพินัยกรรมอย่างเป็นทางการ (ปลดล็อกเมื่ออายุ >= 60 ปี หรือมี flag_will_unlocked)
 * ไม่เสียแต้มเวลาว่าง เสียค่าธรรมเนียมทนาย 2,000 ฿ (ฟรีหากผู้เล่นมีตั๋วทนาย flag_lawyer_license)
 * ช่วยลดภาษีมรดกจาก 10% เหลือ 0% เมื่อส่งต่อทรัพย์สินให้ทายาท
 *
 * @param {object} state GameState ปัจจุบัน
 * @param {object} [options={}]
 * @param {string|null} [options.designatedHeirId=null] รหัสลูกที่ต้องการระบุเป็นผู้รับมรดกหลัก
 */
export function writeWillAndTestament(state, options = {}) {
  if (!state) {
    return { success: false, iconKey: 'alert', message: 'ข้อมูลสถานะเกมไม่ถูกต้อง' };
  }

  const age = Number(state.profile.age || 0);
  const activeFlags = getPlayerFlagSet(state);

  if (age < 60 && !activeFlags.has('flag_will_unlocked')) {
    return {
      success: false,
      iconKey: 'lock',
      message: 'ระบบทำพินัยกรรมจะเปิดให้ใช้งานเมื่ออายุครบ 60 ปีบริบูรณ์ขึ้นไป'
    };
  }

  const alreadyWritten = activeFlags.has('flag_has_written_will');
  const hasLawyerLicense = activeFlags.has('flag_lawyer_license');
  // หากเคยร่างพินัยกรรมไปแล้ว การแก้ไขรายชื่อผู้รับมรดกในภายหลังจะไม่เสียค่าธรรมเนียมซ้ำ
  const fee = alreadyWritten || hasLawyerLicense ? 0 : BASE_WILL_LAWYER_FEE;

  if (fee > 0 && Number(state.finance.cash || 0) < fee) {
    return {
      success: false,
      iconKey: 'coin',
      message: `เงินสดไม่เพียงพอสำหรับค่าธรรมเนียมทนายรับรองพินัยกรรม (${formatCurrency(fee)})`
    };
  }

  if (options.designatedHeirId) {
    const validChild = (state.relationships?.children || []).find(
      (c) => c.id === options.designatedHeirId
    );
    if (!validChild) {
      return { success: false, iconKey: 'alert', message: 'ไม่พบรายชื่อบุตรที่ระบุเป็นผู้รับมรดก' };
    }
    state.relationships.designatedHeirId = validChild.id;
  } else if (!state.relationships?.designatedHeirId && state.relationships?.children?.length > 0) {
    state.relationships.designatedHeirId = state.relationships.children[0].id;
  }

  if (fee > 0) {
    state.finance.cash = Math.round(state.finance.cash - fee);
  }

  addFlagToState(state, 'flag_will_unlocked');
  addFlagToState(state, 'flag_has_written_will');

  const heirObj = (state.relationships?.children || []).find(
    (c) => c.id === state.relationships?.designatedHeirId
  );
  const heirNote = heirObj ? ` โดยระบุให้ "${stripEmojis(heirObj.name)}" เป็นผู้สืบทอดหลัก` : '';

  if (!alreadyWritten && Array.isArray(state.turn?.lifeFeedLog)) {
    state.turn.lifeFeedLog.push({
      age,
      monthTh: 'ตุลาคม',
      type: 'legal',
      iconKey: 'file_text',
      title: 'จดทะเบียนทำพินัยกรรมสมบูรณ์',
      message: `จัดทำหนังสือพินัยกรรมตามกฎหมาย${heirNote} รับสิทธิ์ยกเว้นภาษีมรดก 100%${fee > 0 ? ` (ค่าธรรมเนียม ${formatCurrency(fee)})` : ' (ร่างสัญญาเองฟรีด้วยตั๋วทนาย)'}`
    });
  }

  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    iconKey: 'check',
    feePaid: fee,
    designatedHeirId: state.relationships?.designatedHeirId || null,
    message: alreadyWritten
      ? `อัปเดตรายละเอียดพินัยกรรมเรียบร้อยแล้ว${heirNote}`
      : `จดทะเบียนพินัยกรรมสำเร็จ${heirNote}! ทายาทจะได้รับยกเว้นภาษีมรดก 10% เหลือ 0%`
  };
}

// ============================================================================
// 2. ระบบประเมินสาเหตุการเสียชีวิต 7 รูปแบบ (determineDeathCause)
// ============================================================================

/**
 * ตรวจสอบและระบุสาเหตุการเสียชีวิตตามลำดับความเฉพาะเจาะจงจาก 9_Loans_Crises_&_Endings.json
 * @param {object} state GameState ปัจจุบัน
 * @returns {{
 *   deathId: string,
 *   nameTh: string,
 *   isPrematureDeath: boolean,
 *   meritBonusOnDeath: number,
 *   obituaryTextTh: string,
 *   iconKey: string
 * }|null}
 */
export function determineDeathCause(state) {
  if (!state) return null;

  const age = Number(state.profile.age || 0);
  const hp = Number(state.stats?.health ?? 0);
  const activeFlags = getPlayerFlagSet(state);
  const lastCat = state.turn?.lastEventCategory || null;

  // หากยังมีชีวิตปกติ (อายุยังไม่ถึง 100 และเลือดมากกว่า 0 และยังไม่ได้ถูกฟันธงว่าเสียชีวิต) คืนค่า null
  if (age < 100 && hp > 0 && state.profile.isAlive !== false) {
    return null;
  }

  const deathDefs = db.raw.loansCrisesEndings?.death_conditions_and_causes || [];
  const findDef = (id) => deathDefs.find((d) => d.death_id === id);

  // ลำดับความเฉพาะเจาะจง 1 -> 7 ตาม System Spec
  let matchedId = state.profile.deathCauseId || null;

  if (!matchedId || !findDef(matchedId)) {
    if (age >= 100) {
      matchedId = 'death_natural_centenarian';
    } else if (hp <= 0 && age >= 70) {
      matchedId = 'death_natural_old_age';
    } else if (hp <= 0 && lastCat === 'road_accident') {
      matchedId = 'death_road_accident';
    } else if (hp <= 0 && activeFlags.has('flag_informal_shark_debt')) {
      matchedId = 'death_loan_shark_violence';
    } else if (hp <= 0 && activeFlags.has('flag_depression')) {
      matchedId = 'death_depression_burnout';
    } else if (
      hp <= 0 &&
      age < 70 &&
      (activeFlags.has('status_hypertension') ||
        activeFlags.has('status_chronic_insomnia') ||
        activeFlags.has('status_office_syndrome'))
    ) {
      matchedId = 'death_cardiovascular_overwork';
    } else {
      matchedId = 'death_general_illness';
    }
  }

  const chosenDef = findDef(matchedId) || deathDefs[deathDefs.length - 1] || {
    death_id: matchedId,
    name_th: 'สิ้นอายุขัย',
    is_premature_death: age < 70,
    merit_bonus_on_death: 10,
    obituary_template_th: '{player_name} ถึงแก่กรรมในวัย {age} ปี'
  };

  const fullDisplayName = `${state.profile.titlePrefix || ''} ${state.profile.name || 'ผู้วายชนม์'}`.trim();
  const formattedObituary = stripEmojis(
    String(chosenDef.obituary_template_th || '')
      .replace(/\{player_name\}/g, fullDisplayName)
      .replace(/\{age\}/g, String(age))
  );

  return {
    deathId: chosenDef.death_id,
    nameTh: stripEmojis(chosenDef.name_th),
    isPrematureDeath: Boolean(chosenDef.is_premature_death),
    meritBonusOnDeath: Number(chosenDef.merit_bonus_on_death || 0),
    obituaryTextTh: formattedObituary,
    iconKey: DEATH_CAUSE_ICON_MAP[chosenDef.death_id] || 'hospital'
  };
}

// ============================================================================
// 3. ระบบจัดอันดับฉากจบ 9 ระดับ SSR ถึง E (evaluateEndingArchetype)
// ============================================================================

/**
 * ตรวจสอบเงื่อนไขฉากจบแต่ละระดับตามนิพจน์ req_condition ใน 9_Loans_Crises_&_Endings.json
 */
function matchesEndingTierCondition(endingId, state, netWorth) {
  const age = Number(state.profile.age || 0);
  const merit = Number(state.stats?.merit || 0);
  const happiness = Number(state.stats?.happiness || 0);
  const spawnClass = state.profile.spawnClassId || 'class_3';
  const flags = getPlayerFlagSet(state);

  switch (endingId) {
    case 'end_01_centenarian_legend':
      return age >= 100 && netWorth >= 10_000_000 && merit >= 200;

    case 'end_02_tycoon_mogul':
      return netWorth >= 50_000_000;

    case 'end_03_bodhisattva_philanthropist':
      return merit >= 300;

    case 'end_04_self_made_fighter':
      return (spawnClass === 'class_1' || spawnClass === 'class_2') && netWorth >= 5_000_000;

    case 'end_05_honorable_pillar':
      return (
        age >= 70 &&
        (flags.has('flag_gov_pension_right') ||
          flags.has('flag_medical_license') ||
          flags.has('flag_lawyer_license') ||
          flags.has('flag_engineer_license'))
      );

    case 'end_06_happy_family_matriarch':
      return flags.has('flag_has_child') && happiness >= 70 && age >= 65;

    case 'end_07_ordinary_survivor':
      return age >= 60 && netWorth >= 0;

    case 'end_08_drowned_in_debt':
      return netWorth < 0 || flags.has('flag_credit_blacklist') || flags.has('flag_informal_shark_debt');

    case 'end_09_fallen_youth':
      return age < 40;

    default:
      return false;
  }
}

/**
 * จัดอันดับฉากจบ (Ending Tier: SSR, SR, A, B, C, D, E) พร้อมกรอง Emoji และผูก rankIconKey
 * @param {object} state GameState ปัจจุบัน
 * @returns {{
 *   endingId: string,
 *   rank: string,
 *   titleTh: string,
 *   summaryTh: string,
 *   bonusMeritReward: number,
 *   rankIconKey: string
 * }}
 */
export function evaluateEndingArchetype(state) {
  const netWorth = recalculateNetWorth(state);
  const tiers = db.raw.loansCrisesEndings?.ending_archetypes_and_merit_conversion?.ending_tiers || [];

  let matchedTier = null;
  for (const tier of tiers) {
    if (matchesEndingTierCondition(tier.ending_id, state, netWorth)) {
      matchedTier = tier;
      break;
    }
  }

  // Fallback สำหรับกรณีเสียชีวิตช่วงอายุ 40 - 59 ปี โดยที่ทรัพย์สินเป็นบวกและไม่ติดแบล็กลิสต์
  if (!matchedTier) {
    const ordinaryDef = tiers.find((t) => t.ending_id === 'end_07_ordinary_survivor');
    matchedTier = ordinaryDef
      ? {
          ...ordinaryDef,
          summary_th:
            'แม้การเดินทางจะยุติลงในวัยกลางคน แต่คุณได้ต่อสู้ฝ่าฟันชีวิตอย่างเต็มกำลังโดยไม่ทิ้งภาระหนี้สินไว้เบื้องหลัง'
        }
      : {
          ending_id: 'end_07_ordinary_survivor',
          rank: 'C',
          title_th: 'คนสู้ชีวิต 1 ใน 70 ล้านผู้ไม่ยอมแพ้',
          bonus_merit_reward: 30,
          summary_th: 'ชีวิตคนธรรมดาที่ผ่านทั้งรอยยิ้มและหยาดเหงื่ออย่างสง่างาม'
        };
  }

  return {
    endingId: matchedTier.ending_id,
    rank: matchedTier.rank,
    titleTh: stripEmojis(matchedTier.title_th),
    summaryTh: stripEmojis(matchedTier.summary_th),
    bonusMeritReward: Number(matchedTier.bonus_merit_reward || 0),
    rankIconKey: ENDING_RANK_ICON_MAP[matchedTier.ending_id] || 'leaf'
  };
}

// ============================================================================
// 4. ระบบคำนวณแต้มบุญข้ามภพชาติและสรุปรายงานบทอวสาน (finalizeLifeAndCalculateKarmicBalance)
// ============================================================================

/**
 * ค้นหาชื่ออาชีพสุดท้ายหรืออาชีพที่โดดเด่นที่สุดของผู้เล่นเพื่อแสดงในใบสรุปประวัติชีวิต
 */
function resolveFinalOrNotableCareerNameTh(state) {
  const jobId = state.careerAndEdu?.mainJobId || state.careerAndEdu?.partTimeJobId;
  if (jobId) {
    const jobDef = db.getJob(jobId);
    if (jobDef) return stripEmojis(jobDef.name_th);
  }

  const activeFlags = getPlayerFlagSet(state);
  if (activeFlags.has('flag_medical_license')) return 'แพทย์วิชาชีพ';
  if (activeFlags.has('flag_lawyer_license')) return 'ทนายความวิชาชีพ';
  if (activeFlags.has('flag_engineer_license')) return 'วิศวกรวิชาชีพ';
  if (activeFlags.has('flag_gov_pension_right')) return 'ข้าราชการบำนาญ';
  if (activeFlags.has('flag_family_business')) return 'เจ้าของกิจการส่วนตัว';
  if (Number(state.profile.age || 0) < 18) return 'เยาวชนวัยเรียน';
  if (activeFlags.has('flag_retired_elder')) return 'ผู้สูงอายุวัยเกษียณ';
  return 'ประชาชนอิสระ';
}

/**
 * คำนวณแต้มบุญสะสมทั้งหมดตามสูตร merit_conversion_formula บันทึกลง MetaState (ครั้งเดียวต่อ 1 ชีวิต)
 * และสร้างรายงานบทอวสานฉบับสมบูรณ์สำหรับแสดงในหน้าฉากจบ (รูปที่ 7)
 *
 * @param {object} state GameState ที่สิ้นสุดชีวิตแล้ว
 * @returns {object} รายงานสรุปบทอวสานพร้อมตารางแต้มบุญและข้อมูลมรดก
 */
export function finalizeLifeAndCalculateKarmicBalance(state) {
  if (!state) {
    throw new Error('[EndingEngine] ไม่พบข้อมูล GameState สำหรับสรุปฉากจบ');
  }

  // หากเคยคำนวณและแคชผลลัพธ์ของชีวิตนี้ไว้แล้ว ให้คืนค่ารายงานเดิมทันทีเพื่อป้องกันแต้มบุญเบิ้ล
  if (state.turn?.endingFinalized && state.turn?.finalEndingReport) {
    return state.turn.finalEndingReport;
  }

  const age = Number(state.profile.age || 0);
  const netWorth = recalculateNetWorth(state);
  const activeFlags = getPlayerFlagSet(state);

  state.profile.isAlive = false;
  state.turn.phase = 'ENDED';
  state.turn.areTabsLocked = true;

  const deathInfo = determineDeathCause(state);
  if (deathInfo) {
    state.profile.deathCauseId = deathInfo.deathId;
  }

  const endingTier = evaluateEndingArchetype(state);

  const convConfig = db.raw.loansCrisesEndings?.ending_archetypes_and_merit_conversion || {};
  const formula = convConfig.merit_conversion_formula || {};
  const inhRules = convConfig.inheritance_and_next_generation_rules || {};

  // --- แจกแจงตารางคำนวณแต้มบุญทีละบรรทัดตามสูตร JSON ---
  const meritBreakdown = [];

  // 1. แต้มบุญสะสมจากในชีวิต (100%)
  const keepPercent = Number(formula.keep_accumulated_merit_percent ?? 100) / 100;
  const rawLifeMerit = Math.max(0, Number(state.stats?.merit || 0));
  const keptLifeMerit = Math.round(rawLifeMerit * keepPercent);
  meritBreakdown.push({
    key: 'accumulated_life_merit',
    labelTh: 'แต้มบุญสะสมตลอดช่วงชีวิต (100%)',
    iconKey: 'sparkle',
    points: keptLifeMerit
  });

  // 2. โบนัสจากความมั่งคั่งสุทธิ (ทุกๆ 1 ล้านบาท ได้ +5 แต้ม สูงสุด 200 แต้ม)
  const perMillionRate = Number(formula.bonus_merit_per_1_million_net_worth ?? 5);
  const maxNetWorthBonus = Number(formula.max_net_worth_merit_bonus ?? 200);
  const millionUnits = netWorth > 0 ? Math.floor(netWorth / 1_000_000) : 0;
  const netWorthMeritBonus = Math.min(maxNetWorthBonus, millionUnits * perMillionRate);
  if (netWorthMeritBonus > 0) {
    meritBreakdown.push({
      key: 'net_worth_bonus',
      labelTh: `โบนัสความมั่งคั่งสุทธิ (${millionUnits} ล้านบาท)`,
      iconKey: 'coin',
      points: netWorthMeritBonus
    });
  }

  // 3. โบนัสการมีอายุยืนหลังวัย 60 ปี (+2 แต้มต่อปี)
  const perYearAfter60 = Number(formula.bonus_merit_per_surviving_year_after_60 ?? 2);
  const yearsAfter60 = Math.max(0, age - 60);
  const longevityMeritBonus = yearsAfter60 * perYearAfter60;
  if (longevityMeritBonus > 0) {
    meritBreakdown.push({
      key: 'longevity_bonus',
      labelTh: `โบนัสอายุยืนยาวหลังวัย 60 ปี (${yearsAfter60} ปี)`,
      iconKey: 'heart_pulse',
      points: longevityMeritBonus
    });
  }

  // 4. โบนัสป้ายลูกกตัญญู (+30 แต้ม)
  const filialBonus = activeFlags.has('flag_filial_child')
    ? Number(formula.bonus_merit_for_filial_child_flag ?? 30)
    : 0;
  if (filialBonus > 0) {
    meritBreakdown.push({
      key: 'filial_child_bonus',
      labelTh: 'อานิสงส์ความกตัญญูกตเวทีต่อบิดามารดา',
      iconKey: 'heart',
      points: filialBonus
    });
  }

  // 5. โบนัสผู้บริจาคสร้างตึกโรงพยาบาล (+50 แต้ม)
  const philanthropistBonus = activeFlags.has('flag_philanthropist_donor')
    ? Number(formula.bonus_merit_for_philanthropist_flag ?? 50)
    : 0;
  if (philanthropistBonus > 0) {
    meritBreakdown.push({
      key: 'philanthropist_bonus',
      labelTh: 'มหากุศลผู้บริจาคสร้างโรงพยาบาลช่วยเหลือผู้ป่วย',
      iconKey: 'hospital',
      points: philanthropistBonus
    });
  }

  // 6. โบนัสจากวาระสุดท้าย (merit_bonus_on_death)
  const deathBonus = Number(deathInfo?.meritBonusOnDeath || 0);
  if (deathBonus > 0) {
    meritBreakdown.push({
      key: 'death_cause_bonus',
      labelTh: `บุญวาสนาวาระสุดท้าย (${deathInfo.nameTh})`,
      iconKey: deathInfo.iconKey || 'leaf',
      points: deathBonus
    });
  }

  // 7. โบนัสรางวัลประจำระดับฉากจบ (bonus_merit_reward)
  const endingBonus = Number(endingTier.bonusMeritReward || 0);
  if (endingBonus > 0) {
    meritBreakdown.push({
      key: 'ending_rank_bonus',
      labelTh: `รางวัลเกียรติยศฉากจบระดับ ${endingTier.rank}`,
      iconKey: endingTier.rankIconKey,
      points: endingBonus
    });
  }

  const totalEarnedMeritThisLife = meritBreakdown.reduce((sum, item) => sum + Number(item.points || 0), 0);

  // --- อัปเดตข้อมูลข้ามภพชาติลงใน MetaState ---
  const meta = loadMetaState();
  const previousKarmaBank = Number(meta.karmaBankMerit || 0);
  const newKarmaBankTotal = previousKarmaBank + totalEarnedMeritThisLife;

  meta.karmaBankMerit = newKarmaBankTotal;
  meta.totalLivesPlayed = Number(meta.totalLivesPlayed || 0) + 1;

  if (!Array.isArray(meta.unlockedEndings)) meta.unlockedEndings = [];
  if (!meta.unlockedEndings.includes(endingTier.endingId)) {
    meta.unlockedEndings.push(endingTier.endingId);
  }

  if (!Array.isArray(meta.hallOfFame)) meta.hallOfFame = [];
  meta.hallOfFame.unshift({
    runId: state.meta?.runId || `run_${Date.now()}`,
    generationNumber: Number(state.meta?.generationNumber || 1),
    fullName: `${state.profile.titlePrefix || ''} ${state.profile.name || ''}`.trim(),
    finalAge: age,
    netWorth,
    endingId: endingTier.endingId,
    endingRank: endingTier.rank,
    endingTitleTh: endingTier.titleTh,
    earnedMerit: totalEarnedMeritThisLife,
    finishedAt: new Date().toISOString()
  });
  // เก็บประวัติสูงสุด 20 อันดับล่าสุด
  if (meta.hallOfFame.length > 20) {
    meta.hallOfFame = meta.hallOfFame.slice(0, 20);
  }

  saveMetaState(meta);

  // --- ประเมินสิทธิ์การส่งต่อมรดกให้ทายาทรุ่นลูก ---
  const children = state.relationships?.children || [];
  const canContinueAsChild =
    children.length > 0 &&
    (activeFlags.has(inhRules.can_continue_as_child_if_has_flag || 'flag_has_child') || children.length > 0);

  const hasValidWill =
    activeFlags.has('flag_has_written_will') ||
    activeFlags.has(inhRules.will_testament_flag || 'flag_will_unlocked');

  const taxRate = hasValidWill
    ? Number(inhRules.inheritance_tax_rate_with_will ?? 0.0)
    : Number(inhRules.inheritance_tax_rate_without_will ?? 0.1);

  const grossPositiveEstate = Math.max(0, netWorth);
  const estimatedInheritanceTax = Math.round(grossPositiveEstate * taxRate);
  const netEstateAfterTax = Math.max(0, grossPositiveEstate - estimatedInheritanceTax);

  const spawnCls = db.getClass(state.profile.spawnClassId);
  const currentCls = db.getClass(state.profile.currentClassId);
  const currentLoc = db.getLocation(state.profile.currentLocationId);

  const report = {
    summaryProfile: {
      fullName: `${state.profile.titlePrefix || ''} ${state.profile.name || ''}`.trim(),
      generationNumber: Number(state.meta?.generationNumber || 1),
      finalAge: age,
      spawnClassNameTh: stripEmojis(spawnCls?.name_th || ''),
      finalClassNameTh: stripEmojis(currentCls?.name_th || ''),
      finalLocationNameTh: stripEmojis(currentLoc?.name_th || ''),
      notableCareerNameTh: resolveFinalOrNotableCareerNameTh(state),
      finalNetWorth: netWorth,
      childrenCount: children.length
    },
    deathInfo,
    endingTier,
    karmicSummary: {
      meritBreakdown,
      totalEarnedMeritThisLife,
      previousKarmaBank,
      newKarmaBankTotal
    },
    inheritanceSummary: {
      canContinueAsChild,
      hasValidWill,
      taxRatePercent: Math.round(taxRate * 100),
      grossEstate: grossPositiveEstate,
      inheritanceTaxCash: estimatedInheritanceTax,
      netEstateForHeirs: netEstateAfterTax,
      designatedHeirId: state.relationships?.designatedHeirId || (children[0]?.id ?? null),
      heirsList: children.map((c) => ({
        id: c.id,
        name: stripEmojis(c.name),
        shortName: stripEmojis(c.shortName || c.name),
        ageAtParentDeath: c.age,
        relationship: c.relationship,
        successPoints: c.successPoints,
        outcomeId: c.outcomeId
      }))
    }
  };

  state.turn.endingFinalized = true;
  state.turn.finalEndingReport = report;
  saveGame(state);

  return report;
}

// ============================================================================
// 5. ระบบส่งต่อมรดกเล่นต่อเป็นทายาทรุ่นลูก (startNextGenerationAsChild) & กลับหน้าหลัก
// ============================================================================

/**
 * ค้นหาข้อมูล Legacy Outcome Tier ของลูกตาม outcomeId หรือประเมินจากแต้มสะสมที่มี ณ วันที่พ่อแม่เสียชีวิต
 */
function resolveChildLegacyOutcomeDef(child) {
  const outcomes = db.raw.npcs?.child_graduation_and_legacy_outcomes || [];
  if (child.outcomeId) {
    const exact = outcomes.find((o) => o.outcome_id === child.outcomeId);
    if (exact) return exact;
  }

  const pts = Number(child.successPoints || 0);
  const rel = Number(child.relationship || 0);
  const sorted = [...outcomes].sort((a, b) => Number(b.min_success_points) - Number(a.min_success_points));

  for (const out of sorted) {
    if (
      pts >= Number(out.min_success_points) &&
      pts <= Number(out.max_success_points) &&
      rel >= Number(out.min_relationship_req || 0)
    ) {
      return out;
    }
  }

  // หากลูกยังเล็กมากตอนพ่อแม่จากไป แต่ความสัมพันธ์อบอุ่น ให้เริ่มต้นที่เกณฑ์คนสู้ชีวิตทั่วไป (Tier B) เป็นฐาน
  if (Number(child.age || 0) < 18 && rel >= 50) {
    return outcomes.find((o) => o.outcome_id === 'child_tier_b_average') || sorted[sorted.length - 1];
  }

  return sorted[sorted.length - 1] || null;
}

/**
 * สืบทอดมรดกและเริ่มเล่นชีวิตใหม่ต่อเป็นทายาทรุ่นลูก (เริ่มต้นที่วัยหนุ่มสาวสร้างตัว อายุ 18 ปี)
 *
 * @param {object} previousState GameState ของรุ่นพ่อ/แม่ที่เพิ่งจบลง
 * @param {string|null} [childId=null] รหัสบุตรที่เลือกสืบทอด (หากไม่ระบุจะใช้ designatedHeirId หรือลูกคนแรก)
 * @returns {{ success: boolean, iconKey: string, message: string, newState?: object }}
 */
export function startNextGenerationAsChild(previousState, childId = null) {
  if (!previousState) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลของตระกูลรุ่นก่อนหน้า' };
  }

  // ตรวจให้แน่ใจว่าแต้มบุญและสถิติรุ่นก่อนถูกบันทึกเข้า MetaState เรียบร้อยแล้วก่อนล้างเข้าสู่รุ่นลูก
  if (!previousState.turn?.endingFinalized) {
    finalizeLifeAndCalculateKarmicBalance(previousState);
  }

  const children = previousState.relationships?.children || [];
  if (children.length === 0) {
    return {
      success: false,
      iconKey: 'lock',
      message: 'ไม่มีทายาทสืบสกุลในรอบชีวิตนี้ กรุณาเลือกจุติใหม่ด้วยแต้มบุญสะสม'
    };
  }

  const targetId = childId || previousState.relationships?.designatedHeirId || children[0].id;
  const heirChild = children.find((c) => c.id === targetId) || children[0];

  // 1. คำนวณเงินมรดกสุทธิหลังหักภาษีมรดก
  const parentNetWorth = recalculateNetWorth(previousState);
  const parentFlags = getPlayerFlagSet(previousState);
  const inhRules = db.raw.loansCrisesEndings?.ending_archetypes_and_merit_conversion?.inheritance_and_next_generation_rules || {};

  const hasValidWill =
    parentFlags.has('flag_has_written_will') ||
    parentFlags.has(inhRules.will_testament_flag || 'flag_will_unlocked');

  const taxRate = hasValidWill
    ? Number(inhRules.inheritance_tax_rate_with_will ?? 0.0)
    : Number(inhRules.inheritance_tax_rate_without_will ?? 0.1);

  let inheritedCashForHeir = 0;
  let taxDeducted = 0;

  if (parentNetWorth > 0) {
    taxDeducted = Math.round(parentNetWorth * taxRate);
    const netEstate = Math.max(0, parentNetWorth - taxDeducted);

    if (children.length === 1) {
      inheritedCashForHeir = netEstate;
    } else if (hasValidWill && previousState.relationships?.designatedHeirId === heirChild.id) {
      // กรณีมีพินัยกรรมแต่งตั้งทายาทหลักและมีพี่น้องหลายคน ทายาทหลักรับมรดกสัดส่วนหลัก 70% ส่วนที่เหลือแบ่งพี่น้อง
      inheritedCashForHeir = Math.round(netEstate * 0.7);
    } else {
      // กรณีไม่มีพินัยกรรม แบ่งมรดกเท่าๆ กันในบรรดาบุตรตามกฎหมายแพ่ง
      inheritedCashForHeir = Math.floor(netEstate / children.length);
    }
  }

  // 2. ดึงค่าสถานะเริ่มต้นตามคุณภาพการเลี้ยงดู (Legacy Outcome Tier)
  const outcomeDef = resolveChildLegacyOutcomeDef(heirChild);
  const startStats = outcomeDef?.legacy_starting_stats || {
    health: 70,
    happiness: 65,
    intelligence: 55,
    connections: 35
  };

  // หากพ่อแม่ติดหนี้ (netWorth <= 0) ทายาทไม่ต้องรับหนี้สินเกินตัว แต่ได้เงินติดกระเป๋าเริ่มต้นเล็กน้อยตามระดับความสามารถของลูก
  const fallbackStarterCash =
    outcomeDef?.outcome_id === 'child_tier_s_elite'
      ? 50000
      : outcomeDef?.outcome_id === 'child_tier_a_professional'
        ? 25000
        : 10000;

  const finalStartingCash = parentNetWorth > 0 ? inheritedCashForHeir : fallbackStarterCash;

  // 3. สร้าง GameState ใหม่สำหรับทายาทรุ่นที่ N+1 (เริ่มที่อายุ 18 ปี วัยหนุ่มสาวและสร้างตัว)
  const nextGenNum = Number(previousState.meta?.generationNumber || 1) + 1;
  const newState = createEmptyGameState();
  newState.meta.generationNumber = nextGenNum;

  const gender = heirChild.gender === 'female' ? 'female' : 'male';
  const titlePrefix = gender === 'female' ? 'น.ส.' : 'นาย';
  const firstName = heirChild.firstName || stripEmojis(heirChild.shortName || 'ทายาท');
  const lastName = heirChild.lastName || previousState.profile.lastName || 'เจริญกิจ';
  const nickname = heirChild.nickname || stripEmojis(heirChild.shortName || 'ต้น').replace(/^น้อง/, '');
  const displayName = `${firstName} ${lastName} (${nickname})`;

  const inheritedLocationId = previousState.profile.currentLocationId || 'loc_bangkok';
  const locDef = db.getLocation(inheritedLocationId);

  newState.profile = {
    ...newState.profile,
    name: displayName,
    firstName,
    lastName,
    nickname,
    gender,
    titlePrefix,
    age: 18,
    birthYearBE: Number(previousState.profile.currentYearBE || 2568) - 18,
    currentYearBE: Number(previousState.profile.currentYearBE || 2568),
    lifePhaseId: 'phase_4_young_adult',
    spawnClassId: previousState.profile.currentClassId || 'class_3',
    currentClassId: previousState.profile.currentClassId || 'class_3',
    birthLocationId: inheritedLocationId,
    currentLocationId: inheritedLocationId,
    isAlive: true,
    deathCauseId: null
  };

  newState.stats = {
    health: clampStat(startStats.health, 1, 100),
    happiness: clampStat(startStats.happiness, 0, 100),
    intelligence: clampStat(startStats.intelligence, 0, 100),
    connections: clampStat(startStats.connections, 0, 100),
    merit: 15,
    appearance: clampStat(Number(previousState.stats?.appearance || 55), 25, 95)
  };

  // ตั้งค่าเงินสดและกระปุก (อายุ 18 ผ่านวัยทุบกระปุกมาแล้ว)
  newState.finance.cash = finalStartingCash;
  newState.finance.piggyBank = 0;
  newState.finance.hasPiggyBankSmashed = true;
  newState.finance.parentAnnualSupport = 0;
  newState.finance.baseAnnualLivingCost = Number(
    db.getLifePhaseByAge(18)?.baseAnnualLivingCost ?? 84000
  );

  // มอบป้ายพื้นฐานของวัย 18 ปี + ป้ายภูมิลำเนาจังหวัด + ป้ายจาก Legacy Outcome
  const baseAdultFlags = [
    'flag_bank_account',
    'flag_thai_id_card',
    'flag_edu_primary_grad',
    'flag_edu_middle_grad',
    'flag_legal_youth_worker',
    'flag_edu_high_school_grad',
    'flag_legal_adult_18',
    'flag_track_sci_math',
    'flag_smartphone',
    ...(locDef?.local_flags_granted || [])
  ];

  for (const f of baseAdultFlags) {
    addFlagToState(newState, f);
  }

  for (const lf of outcomeDef?.legacy_grants_flags || []) {
    // กรองป้าย flag_regular_income ออกชั่วคราวตอนยังไม่ได้เลือกสมัครงานจริง เพื่อให้สอดคล้องกับสถานะว่างงานตอนเริ่มวัย 18
    if (lf === 'flag_regular_income') continue;
    addFlagToState(newState, lf);
  }

  // ประเมินชนชั้นทางสังคมตามมรดกสุทธิที่ได้รับทันที และเพิ่มป้ายชนชั้นสำคัญ (เช่น สิทธิ์กู้ กยศ. หากมรดกน้อย หรือคอนเนกชันเจ้าสัวหากมรดกระดับ 50M+)
  recalculateNetWorth(newState);
  newState.profile.spawnClassId = newState.profile.currentClassId;

  const resolvedSpawnClass = db.getClass(newState.profile.currentClassId);
  if (newState.profile.currentClassId === 'class_1' || newState.profile.currentClassId === 'class_2') {
    addFlagToState(newState, 'flag_student_loan_eligible');
    addFlagToState(newState, 'flag_welfare_card');
  } else if (newState.profile.currentClassId === 'class_4') {
    addFlagToState(newState, 'flag_family_business');
    addFlagToState(newState, 'flag_private_hospital_access');
  } else if (newState.profile.currentClassId === 'class_5') {
    addFlagToState(newState, 'flag_elite_connection');
    addFlagToState(newState, 'flag_private_hospital_access');
  }

  // 4. บันทึกตัวละครรุ่นก่อนและคู่สมรสไว้ในรายชื่อพ่อแม่ (isAlive: false สำหรับผู้ล่วงลับ) เพื่อเก็บประวัติสายตระกูล
  const lateParentRole = previousState.profile.gender === 'female' ? 'คุณแม่ผู้ล่วงลับ' : 'คุณพ่อผู้ล่วงลับ';
  const lateParentArch = previousState.profile.gender === 'female' ? 'npc_arch_mother' : 'npc_arch_father';
  const otherParentObj = previousState.relationships?.partner;

  newState.relationships.npcs.push({
    id: 'npc_late_player_parent',
    archetypeId: lateParentArch,
    name: `${stripEmojis(previousState.profile.name)} (รุ่นที่ ${nextGenNum - 1})`,
    shortName: previousState.profile.nickname || 'บรรพบุรุษ',
    roleTitle: lateParentRole,
    gender: previousState.profile.gender,
    relationship: clampStat(heirChild.relationship || 80, 0, 100),
    isAlive: false,
    inheritanceClaimed: true
  });

  if (otherParentObj) {
    const otherArch = previousState.profile.gender === 'female' ? 'npc_arch_father' : 'npc_arch_mother';
    const otherRole = previousState.profile.gender === 'female' ? 'คุณพ่อ' : 'คุณแม่';
    newState.relationships.npcs.push({
      id: 'npc_surviving_spouse_parent',
      archetypeId: otherArch,
      name: stripEmojis(otherParentObj.name),
      shortName: stripEmojis(otherParentObj.shortName || otherParentObj.name),
      roleTitle: otherRole,
      gender: otherParentObj.gender || 'female',
      ageAtPlayerBirth: 28,
      passAwayParentAge: 82,
      relationship: 85,
      isAlive: Number(otherParentObj.age || 60) < 80,
      inheritanceClaimed: true
    });
  }

  newState.careerAndEdu.currentActivityId = null;
  newState.turn.freeActionPoints = MAX_FREE_ACTION_POINTS;
  newState.turn.areTabsLocked = false;
  newState.turn.phase = 'FREE_ACTION';

  const taxNote =
    parentNetWorth > 0
      ? hasValidWill
        ? 'ยกเว้นภาษีมรดก 0% ตามพินัยกรรม'
        : `หักภาษีมรดก 10% (${formatCurrency(taxDeducted)})`
      : 'ตั้งต้นชีวิตใหม่ด้วยทุนสำรองส่วนตัว';

  newState.turn.lifeFeedLog.push({
    age: 18,
    monthTh: 'มกราคม',
    type: 'legacy_start',
    iconKey: 'crown',
    title: `สืบทอดสายเลือดตระกูล รุ่นที่ ${nextGenNum}`,
    message: `${titlePrefix} ${displayName} รับช่วงต่อวงศ์ตระกูลในวัย 18 ปี ฐานะ "${stripEmojis(resolvedSpawnClass?.name_th || '')}" พร้อมเงินตั้งต้น ${formatCurrency(finalStartingCash)} (${taxNote})`
  });

  setState(newState);
  saveGame(newState);

  return {
    success: true,
    iconKey: 'crown',
    inheritedCash: finalStartingCash,
    taxDeducted,
    generationNumber: nextGenNum,
    newState,
    message: `เข้าสู่ชีวิตทายาทรุ่นที่ ${nextGenNum}: "${titlePrefix} ${displayName}" พร้อมเงินมรดกสุทธิ ${formatCurrency(finalStartingCash)}`
  };
}

/**
 * จบเกมรอบปัจจุบัน ล้างเซฟตัวละครเดิม และคืนข้อมูลแต้มบุญสะสมสำหรับกลับสู่หน้าหลัก/หน้าจุติใหม่
 * @param {object|null} [currentState=null]
 */
export function finishAndReturnToLobby(currentState = null) {
  if (currentState && !currentState.turn?.endingFinalized) {
    finalizeLifeAndCalculateKarmicBalance(currentState);
  }

  clearSavedGame();
  const metaState = loadMetaState();

  return {
    success: true,
    iconKey: 'sparkle',
    karmaBankMerit: metaState.karmaBankMerit,
    totalLivesPlayed: metaState.totalLivesPlayed,
    unlockedEndings: metaState.unlockedEndings,
    message: `บันทึกประวัติชีวิตเรียบร้อยแล้ว คุณมีแต้มบุญสะสมสำหรับจุติใหม่รวม ${metaState.karmaBankMerit.toLocaleString('th-TH')} แต้ม`
  };
}
