/**
 * js/engine/social_engine.js
 * โมดูลจัดการระบบความสัมพันธ์ NPC (พ่อแม่ เพื่อน หุ้นส่วน ผู้ใหญ่ในวงการ)
 * ระบบค้นหาคู่รัก การเดท การแต่งงานจดทะเบียนสมรส การหย่าร้างแบ่งสินสมรส
 * ระบบการมีบุตร นโยบายเลี้ยงดูลูก 4 ช่วงวัย การประเมินอนาคตลูกวัย 22 ปี และการตั้งผู้สืบทอดมรดก
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100% ใช้รหัส iconKey สำหรับเรนเดอร์ Inline SVG เท่านั้น
 */

import { db } from '../core/db.js';
import { generateThaiIdentity, recalculateNetWorth, saveGame } from '../core/state.js';
import {
  clampStat,
  checkRequirement,
  getPlayerFlagSet,
  getPlayerStatValue,
  pickRandom,
  randomInt,
  shuffleArray,
  rollChance,
  formatCurrency
} from '../core/utils.js';
import { isPlayerCurrentlyStudying } from './career_edu_engine.js';
import { stripEmojis } from './event_engine.js';
import { collectAnnualPassiveStatEffects } from '../core/annual_passive_stats.js';

// ============================================================================
// Constants & Internal Helpers
// ============================================================================

/**
 * รายการกิจกรรมเปลี่ยนสถานะชีวิตครั้งสำคัญที่ไม่เสียแต้มเวลาว่าง (0 แต้ม)
 */
const ZERO_AP_MILESTONE_REL_ACTIONS = new Set([
  'rel_act_ask_to_be_couple',
  'rel_act_propose_marriage',
  'rel_act_plan_have_baby',
  'rel_act_file_divorce'
]);

const STAT_LABELS_TH = {
  health: 'สุขภาพ',
  happiness: 'ความสุข',
  intelligence: 'สมอง',
  connections: 'เส้นสาย',
  merit: 'แต้มบุญ',
  appearance: 'บุคลิกหน้าตา'
};

/**
 * เพิ่มป้ายสถานะลงในหมวดหมู่ที่ถูกต้องของ GameState
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
 * ลบป้ายสถานะออกจากทุกหมวดหมู่ของ GameState
 */
function removeFlagOrStatus(state, flagId) {
  if (!flagId) return;
  state.flags = (state.flags || []).filter((f) => f !== flagId);
  state.talentTags = (state.talentTags || []).filter((f) => f !== flagId);
  state.statuses = (state.statuses || []).filter((f) => f !== flagId);
  state.innateTraits = (state.innateTraits || []).filter((f) => f !== flagId);
}

/**
 * ประยุกต์ผลกระทบค่าสถานะลงใน state.stats
 */
function applySocialStatEffects(state, effects) {
  const deltas = {
    health: 0,
    happiness: 0,
    intelligence: 0,
    connections: 0,
    merit: 0,
    appearance: 0
  };

  if (!effects || typeof effects !== 'object' || !state.stats) return deltas;

  const cappedKeys = ['health', 'happiness', 'intelligence', 'connections', 'appearance'];
  for (const key of cappedKeys) {
    if (effects[key] !== undefined && Number(effects[key]) !== 0) {
      const before = Number(state.stats[key] ?? 0);
      const after = clampStat(before + Math.round(Number(effects[key])), 0, 100);
      state.stats[key] = after;
      deltas[key] = after - before;
    }
  }

  const meritDelta = Math.round(Number(effects.merit ?? 0) + Number(effects.karma ?? 0));
  if (meritDelta !== 0) {
    const beforeMerit = Number(state.stats.merit ?? 0);
    const afterMerit = clampStat(beforeMerit + meritDelta, -9999, null);
    state.stats.merit = afterMerit;
    deltas[meritDelta ? 'merit' : 'merit'] = afterMerit - beforeMerit;
  }

  return deltas;
}

/**
 * บันทึกเหตุการณ์ความสัมพันธ์ลงใน Life Feed แบบไร้ Emoji พร้อมแนบ iconKey
 */
function pushSocialLog(state, title, message, iconKey = 'users', monthTh = 'กุมภาพันธ์', type = 'social') {
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
 * ตรวจสอบคลังเก็บบันทึกคูลดาวน์รายปีของกิจกรรมความสัมพันธ์ใน state.relationships.usedRelActionsThisYear
 */
function ensureRelActionTracker(state) {
  if (!state.relationships) state.relationships = { npcs: [], partner: null, children: [], designatedHeirId: null };
  if (!Array.isArray(state.relationships.usedRelActionsThisYear)) {
    state.relationships.usedRelActionsThisYear = [];
  }
  return state.relationships.usedRelActionsThisYear;
}

function makeActionCooldownKey(actionId, targetId) {
  return targetId ? `${actionId}::${targetId}` : actionId;
}

/**
 * แปลงค่าความสัมพันธ์ (0 - 100) เป็นจำนวนดวงหัวใจ (0 - 5 ดวง) สำหรับใช้ใน UI
 * @param {number} relScore
 * @returns {number}
 */
export function getHeartsCountFromScore(relScore) {
  const clamped = clampStat(Number(relScore || 0), 0, 100);
  return Math.floor(clamped / 20);
}

// ============================================================================
// 1. ระบบปลดล็อกเพื่อนและคอนเนกชันตามช่วงวัยอัตโนมัติ (unlockAgeAppropriateNpcs)
// ============================================================================

/**
 * ตรวจสอบและสร้าง NPC เพื่อน/หุ้นส่วน/ผู้ใหญ่ในวงการ ตามช่วงอายุและเงื่อนไขของผู้เล่นโดยไม่สร้างซ้ำ
 * @param {object} state
 * @returns {Array<object>} รายการ NPC ใหม่ที่เพิ่งปลดล็อกในปีนี้
 */
export function unlockAgeAppropriateNpcs(state) {
  if (!state?.relationships) return [];

  const age = Number(state.profile.age || 0);
  const archetypes = db.raw.npcs?.family_and_friend_archetypes || [];
  const existingArchIds = new Set((state.relationships.npcs || []).map((n) => n.archetypeId));
  const newlyUnlocked = [];

  for (const arch of archetypes) {
    // ข้ามคุณพ่อและคุณแม่ซึ่งถูกสร้างไว้แล้วตั้งแต่แรกเกิด
    if (arch.archetype_id === 'npc_arch_father' || arch.archetype_id === 'npc_arch_mother') {
      continue;
    }
    if (existingArchIds.has(arch.archetype_id)) {
      continue;
    }

    if (age < Number(arch.min_age_to_meet || 0)) {
      continue;
    }

    // ตรวจสอบเงื่อนไขค่าสถานะและป้าย (เช่น หุ้นส่วนต้องมี flag_merchant_permit / ผู้ใหญ่ต้องมี connections >= 60)
    if (!checkRequirement(arch.req_stats || {}, arch.req_flags || [], state)) {
      continue;
    }

    const npcGender =
      arch.gender === 'male' || arch.gender === 'female'
        ? arch.gender
        : (rollChance(50) ? 'male' : 'female');

    const npcClassId =
      arch.archetype_id === 'npc_arch_elite_mentor'
        ? 'class_5'
        : (state.profile.currentClassId || state.profile.spawnClassId || 'class_3');

    const identity = generateThaiIdentity(
      npcGender,
      npcClassId,
      arch.archetype_id === 'npc_arch_elite_mentor' ? 'parent' : 'player'
    );

    const formattedName = stripEmojis(
      String(arch.name_template || '{random_name}').replace('{random_name}', identity.nickname)
    );

    const newNpc = {
      id: `npc_${arch.archetype_id}_${Date.now()}_${randomInt(100, 999)}`,
      archetypeId: arch.archetype_id,
      name: formattedName,
      fullName: `${identity.firstName} ${identity.lastName}`,
      shortName: identity.nickname,
      roleTitle: stripEmojis(arch.role_title_th || ''),
      gender: npcGender,
      relationship: Number(arch.starting_relationship ?? 40),
      isAlive: true,
      metAtAge: age
    };

    state.relationships.npcs.push(newNpc);
    existingArchIds.add(arch.archetype_id);
    newlyUnlocked.push(newNpc);

    pushSocialLog(
      state,
      `รู้จักคนใหม่: ${newNpc.name}`,
      `คุณได้ทำความรู้จักกับ ${newNpc.name} (${newNpc.roleTitle}) เข้าสู่เครือข่ายความสัมพันธ์`,
      arch.archetype_id === 'npc_arch_elite_mentor' ? 'star' : 'users',
      'พฤษภาคม'
    );
  }

  return newlyUnlocked;
}

// ============================================================================
// 2. ระบบหาคู่ / สุ่มคนคุยใหม่ และการบอกเลิก (Romantic Partner Discovery)
// ============================================================================

/**
 * สร้างชื่อ-นามสกุลไทยตาม name_pool_tier เฉพาะของแต่ละสายอาชีพคนรักใน NPC_&_Relationships.json
 */
function generatePartnerIdentityFromTier(partnerArch, gender) {
  const pools = db.getThaiNamePools();
  const tier = partnerArch?.name_pool_tier || {};

  if (!pools) {
    return generateThaiIdentity(gender, 'class_3', 'player');
  }

  const nickList = pools[tier.nickname_pool] || pools.nicknames_millennial_genz || ['พลอย'];
  const firstPoolKey = gender === 'female' ? tier.first_name_female_pool : tier.first_name_male_pool;
  const firstList =
    pools[firstPoolKey] ||
    (gender === 'female' ? pools.first_names_female_modern : pools.first_names_male_modern) ||
    ['ณภัทร'];

  const lastList =
    pools.last_names_by_class?.[tier.last_name_pool] ||
    pools.last_names_by_class?.class_3_4_urban ||
    ['เจริญกิจ'];

  const nickname = pickRandom(nickList) || 'มายด์';
  const firstName = pickRandom(firstList) || 'กานต์พิชชา';
  const lastName = pickRandom(lastList) || 'วงศ์สว่าง';

  const displayName = stripEmojis(
    String(partnerArch.name_template || '{random_name}').replace(
      '{random_name}',
      `${nickname} (${firstName} ${lastName})`
    )
  );

  return {
    nickname,
    firstName,
    lastName,
    displayName
  };
}

/**
 * ตรวจสอบว่าผู้เล่นมีสิทธิ์พบเจอคนรัก Archetype นี้หรือไม่
 */
function isPartnerArchetypeEligible(partnerArch, state) {
  const age = Number(state.profile.age || 0);
  if (age < Number(partnerArch.min_age_to_meet || 15)) return false;

  // เช็ก req_stats เช่น appearance >= 50, intelligence >= 70, connections >= 85
  if (!checkRequirement(partnerArch.req_stats || {}, [], state)) {
    return false;
  }

  // เช็ก req_social_class_or_flags: หากมีรายการป้ายระบุ ต้องมีอย่างน้อย 1 ป้าย หรือผู้เล่นอยู่ในชนชั้นสูง (class_4 / class_5)
  const reqOrFlags = partnerArch.req_social_class_or_flags || [];
  if (reqOrFlags.length > 0) {
    const activeFlags = getPlayerFlagSet(state);
    const hasMatchingFlag = reqOrFlags.some((f) => activeFlags.has(f));
    const currentCls = state.profile.currentClassId || state.profile.spawnClassId;
    const isHighSocialClass =
      partnerArch.archetype_id === 'partner_tycoon_heir'
        ? currentCls === 'class_5'
        : (currentCls === 'class_4' || currentCls === 'class_5');

    if (!hasMatchingFlag && !isHighSocialClass) {
      return false;
    }
  }

  return true;
}

/**
 * สุ่มรายชื่อผู้สมัครคนคุย (Potential Partners) สูงสุด 3 คนตามระดับโปรไฟล์และสังคมของผู้เล่น
 * @param {object} state
 * @returns {{ success: boolean, iconKey: string, message?: string, candidates: Array<object> }}
 */
export function discoverPotentialPartners(state) {
  const age = Number(state.profile.age || 0);
  const activeFlags = getPlayerFlagSet(state);

  if (age < 15) {
    return {
      success: false,
      iconKey: 'lock',
      message: 'ต้องมีอายุครบ 15 ปีบริบูรณ์ขึ้นไปจึงจะเปิดระบบค้นหาคนคุยได้',
      candidates: []
    };
  }

  if (activeFlags.has('flag_monkhood_active')) {
    return {
      success: false,
      iconKey: 'lock',
      message: 'ไม่สามารถค้นหาคนคุยได้ขณะครองสมณเพศ',
      candidates: []
    };
  }

  if (state.relationships?.partner) {
    return {
      success: false,
      iconKey: 'heart',
      message: `ปัจจุบันคุณกำลังคบหา/คุยอยู่กับ "${state.relationships.partner.name}" อยู่แล้ว`,
      candidates: []
    };
  }

  const allPartnerArchs = db.raw.npcs?.romantic_partner_archetypes || [];
  const eligibleArchs = allPartnerArchs.filter((arch) => isPartnerArchetypeEligible(arch, state));

  if (eligibleArchs.length === 0) {
    return {
      success: false,
      iconKey: 'info',
      message: 'ยังไม่พบคนที่ตรงสเปกในช่วงเวลานี้ ลองพัฒนาความสามารถหรือขยับขยายสังคมเพิ่มเติม',
      candidates: []
    };
  }

  // ผู้เล่นได้พบคนคุยหลายอัตลักษณ์โดยไม่ผูกกับเพศของผู้เล่น
  const identities = shuffleArray(['woman', 'man', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid']);
  const candidates = [];
  const usedArchIds = new Set();

  for (let i = 0; i < 3; i++) {
    const pool = eligibleArchs.filter((a) => !usedArchIds.has(a.archetype_id));
    const chosenArch = pickRandom(pool.length > 0 ? pool : eligibleArchs);
    if (!chosenArch) break;

    usedArchIds.add(chosenArch.archetype_id);
    const genderIdentity = identities[i];
    const candGender = genderIdentity === 'woman' || genderIdentity === 'trans_woman' ? 'female'
      : genderIdentity === 'man' || genderIdentity === 'trans_man' ? 'male'
        : (i % 2 ? 'female' : 'male');
    const identityLabel = { woman: 'ผู้หญิง', man: 'ผู้ชาย', trans_woman: 'ผู้หญิงข้ามเพศ', trans_man: 'ผู้ชายข้ามเพศ', nonbinary: 'นอนไบนารี', genderfluid: 'เจนเดอร์ฟลูอิด' }[genderIdentity];
    const iden = generatePartnerIdentityFromTier(chosenArch, candGender);
    const econ = chosenArch.spouse_economy_after_marriage || {};

    candidates.push({
      candidateId: `cand_${chosenArch.archetype_id}_${Date.now()}_${i}`,
      archetypeId: chosenArch.archetype_id,
      name: iden.displayName,
      shortName: iden.nickname,
      firstName: iden.firstName,
      lastName: iden.lastName,
      gender: candGender,
      genderIdentity,
      openToDating: i === 0 || Math.random() < 0.65,
      identityShared: true,
      age: Math.max(15, age + randomInt(-2, 3)),
      roleTitle: stripEmojis(chosenArch.role_title_th || ''),
      descriptionTh: `${stripEmojis(chosenArch.description_th || '').replaceAll('ค่าสินสอด', 'ค่าใช้จ่ายแต่งงาน')} เจ้าตัวเลือกบอกในคำแนะนำตัวว่าเป็น${identityLabel}`,
      dowryCostCash: Number(chosenArch.dowry_marriage_cost_cash || 0),
      netAnnualCashContribution: Number(econ.net_annual_cash_contribution || 0),
      possibleFinancialTraits: econ.possible_financial_traits || [],
      iconKey: 'heart'
    });
  }

  state.relationships.lastPartnerCandidates = candidates;

  return {
    success: true,
    iconKey: 'heart',
    candidates
  };
}

/**
 * เลือกผู้สมัคร 1 คนมาเริ่มต้นความสัมพันธ์ในฐานะ "คนคุย" (status: 'crush', relationship: 25)
 * @param {object} state
 * @param {object|string} partnerCandidate ออบเจกต์ผู้สมัคร หรือ candidateId จาก discoverPotentialPartners
 */
export function startTalkingToPartner(state, partnerCandidate) {
  if (state.relationships?.partner) {
    return {
      success: false,
      iconKey: 'lock',
      message: 'คุณมีคนคุยหรือคนรักอยู่แล้ว ต้องยุติความสัมพันธ์เดิมก่อนจึงจะเริ่มคุยคนใหม่ได้'
    };
  }

  const resolvedCandidate =
    typeof partnerCandidate === 'string'
      ? (state.relationships?.lastPartnerCandidates || []).find((c) => c.candidateId === partnerCandidate)
      : partnerCandidate;

  if (!resolvedCandidate || !resolvedCandidate.archetypeId) {
    return { success: false, iconKey: 'alert', message: 'ข้อมูลผู้สมัครคนคุยไม่ถูกต้อง' };
  }
  if (resolvedCandidate.openToDating === false) return { success: false, message: 'อีกฝ่ายยังไม่พร้อมเริ่มความสัมพันธ์ในตอนนี้' };

  const arch = db.indexes.partnerArchetypes.get(resolvedCandidate.archetypeId);
  const econ = arch?.spouse_economy_after_marriage || {};

  state.relationships.partner = {
    id: `partner_${Date.now()}_${randomInt(100, 999)}`,
    archetypeId: resolvedCandidate.archetypeId,
    name: stripEmojis(resolvedCandidate.name),
    shortName: stripEmojis(resolvedCandidate.shortName || resolvedCandidate.name),
    roleTitle: stripEmojis(resolvedCandidate.roleTitle || arch?.role_title_th || ''),
    gender: resolvedCandidate.gender || 'female',
    genderIdentity: resolvedCandidate.genderIdentity || (resolvedCandidate.gender === 'male' ? 'man' : 'woman'),
    identityShared: Boolean(resolvedCandidate.identityShared),
    age: Number(resolvedCandidate.age || state.profile.age),
    relationship: 25,
    status: 'crush', // 'crush' | 'dating' | 'married'
    dowryCostCash: Number(resolvedCandidate.dowryCostCash ?? arch?.dowry_marriage_cost_cash ?? 50000),
    netAnnualCashContribution: Number(
      resolvedCandidate.netAnnualCashContribution ?? econ.net_annual_cash_contribution ?? 0
    ),
    financialTraitId: null,
    metAtAge: state.profile.age
  };

  state.relationships.lastPartnerCandidates = [];

  pushSocialLog(
    state,
    `เริ่มเปิดใจคุยกับ: ${state.relationships.partner.name}`,
    `เริ่มต้นสานสัมพันธ์ในฐานะคนคุยกับ ${state.relationships.partner.name} (${state.relationships.partner.roleTitle})`,
    'heart',
    'กุมภาพันธ์'
  );

  saveGame(state);

  return {
    success: true,
    iconKey: 'heart',
    partner: state.relationships.partner,
    message: `เริ่มทักคุยสานสัมพันธ์กับ "${state.relationships.partner.name}" เรียบร้อยแล้ว!`
  };
}

/**
 * ยุติความสัมพันธ์ / บอกเลิกกับคนคุยหรือแฟน (ใช้ได้เฉพาะกรณียังไม่จดทะเบียนสมรส หากแต่งงานแล้วต้องใช้ rel_act_file_divorce)
 * @param {object} state
 */
export function breakUpWithPartner(state) {
  const partner = state.relationships?.partner;
  if (!partner) {
    return { success: false, iconKey: 'info', message: 'ปัจจุบันคุณยังไม่มีคนคุยหรือแฟน' };
  }

  if (partner.status === 'married' || getPlayerFlagSet(state).has('flag_married_registered')) {
    return {
      success: false,
      iconKey: 'lock',
      message: 'คู่สมรสที่จดทะเบียนตามกฎหมายต้องทำเรื่อง "จดทะเบียนหย่าขาด" เท่านั้น'
    };
  }

  const prevName = partner.name;
  const wasDating = partner.status === 'dating';

  state.relationships.partner = null;
  removeFlagOrStatus(state, 'flag_in_relationship');
  removeFlagOrStatus(state, 'flag_partner_hearts_5');

  if (wasDating) {
    applySocialStatEffects(state, { happiness: -6 });
  }

  pushSocialLog(
    state,
    `ยุติความสัมพันธ์กับ ${prevName}`,
    wasDating
      ? `ตัดสินใจเลิกรากับแฟน (${prevName}) ต่างคนต่างแยกย้ายไปเติบโตตามเส้นทางของตัวเอง`
      : `หยุดพัฒนาความสัมพันธ์กับคนคุย (${prevName}) กลับมาใช้ชีวิตโสดอีกครั้ง`,
    'info',
    'ตุลาคม'
  );

  saveGame(state);

  return {
    success: true,
    iconKey: 'check',
    message: `ยุติความสัมพันธ์กับ "${prevName}" เรียบร้อยแล้ว`
  };
}

// ============================================================================
// 3. ระบบกดทำกิจกรรมความสัมพันธ์ 12 ท่า (performRelationshipAction)
// ============================================================================

/**
 * คำนวณค่าใช้จ่ายเงินสดของกิจกรรมความสัมพันธ์ตามสถานะวัยเรียน/ผู้ใหญ่ หรือค่าสินสอดคู่รัก
 */
function getRelationshipActionCashCost(actDef, state) {
  if (actDef.uses_partner_dowry_cost) {
    const partner = state.relationships?.partner;
    const arch = partner ? db.indexes.partnerArchetypes.get(partner.archetypeId) : null;
    return Math.round(Number(partner?.dowryCostCash ?? arch?.dowry_marriage_cost_cash ?? 50000));
  }

  const isStudent = isPlayerCurrentlyStudying(state);
  return Math.round(
    Number(isStudent ? (actDef.cost_cash_student ?? 0) : (actDef.cost_cash_adult ?? 0))
  );
}

/**
 * ตรวจสอบเงื่อนไขและความพร้อมของกิจกรรมความสัมพันธ์แต่ละรายการสำหรับแสดงบน UI แท็บที่ 3
 * @param {object} state
 * @param {string|null} [specificTargetId=null] รหัส NPC เป้าหมาย (กรณีเพื่อนหรือลูกหลายคน)
 * @returns {Array<object>}
 */
export function getAvailableRelationshipActions(state, specificTargetId = null) {
  const age = Number(state?.profile?.age ?? 0);
  const actions = db.raw.npcs?.relationship_actions || [];
  const usedTracker = ensureRelActionTracker(state);
  const activeFlags = getPlayerFlagSet(state);

  return actions
    .filter((act) => age >= Number(act.min_age || 0) && (act.max_age === undefined || age <= Number(act.max_age)))
    .map((act) => {
      const cleanName = stripEmojis(act.name_th);
      const cleanDesc = stripEmojis(act.description_th);
      const isMilestoneAction = ZERO_AP_MILESTONE_REL_ACTIONS.has(act.action_id);
      const apCost = isMilestoneAction ? 0 : 1;
      const cashCost = getRelationshipActionCashCost(act, state);

      // ตรวจสอบว่าเป้าหมายในกลุ่มนั้นมีตัวตนและยังมีชีวิตอยู่หรือไม่
      let hasValidTarget = true;
      let targetCurrentRel = 100;

      if (act.target_npc_group === 'parents') {
        const aliveParents = (state.relationships?.npcs || []).filter(
          (n) => (n.archetypeId === 'npc_arch_father' || n.archetypeId === 'npc_arch_mother') && n.isAlive
        );
        hasValidTarget = aliveParents.length > 0;
      } else if (act.target_npc_group === 'friends') {
        const aliveFriends = (state.relationships?.npcs || []).filter(
          (n) => n.archetypeId !== 'npc_arch_father' && n.archetypeId !== 'npc_arch_mother' && n.isAlive
        );
        hasValidTarget = aliveFriends.length > 0;
      } else if (act.target_npc_group === 'partner') {
        hasValidTarget = Boolean(state.relationships?.partner);
        targetCurrentRel = Number(state.relationships?.partner?.relationship || 0);
      } else if (act.target_npc_group === 'children') {
        hasValidTarget = (state.relationships?.children || []).length > 0;
      }

      // เช็ก Feature Gate ของระบบแชทออนไลน์ และระบบแต่งงาน
      let gateLockedMsg = '';
      if (act.action_id === 'rel_act_group_chat_friends' || act.action_id === 'rel_act_chat_crush') {
        const chatGate = db.getFeatureGate('gate_chat_and_online_study');
        if (chatGate && !checkRequirement(null, chatGate.req_flags, state, { minAge: chatGate.min_age })) {
          gateLockedMsg = stripEmojis(chatGate.locked_message_th);
        }
      }

      // เงื่อนไขพิเศษของ rel_act_plan_have_baby: รองรับทั้ง flag_ready_for_kids หรือ flag_has_own_home
      let effectiveReqFlags = [...(act.req_flags || [])];
      if (act.action_id === 'rel_act_plan_have_baby' && activeFlags.has('flag_has_own_home')) {
        effectiveReqFlags = effectiveReqFlags.filter((f) => f !== 'flag_ready_for_kids');
      }
      // เงื่อนไขพิเศษของ rel_act_propose_marriage: หากคู่รักมี relationship >= 100 ถือว่าผ่าน flag_partner_hearts_5 โดยอัตโนมัติ
      if (act.action_id === 'rel_act_propose_marriage' && targetCurrentRel >= 100) {
        effectiveReqFlags = effectiveReqFlags.filter((f) => f !== 'flag_partner_hearts_5');
      }

      const meetsFlags = checkRequirement(null, effectiveReqFlags, state, {
        forbiddenFlags: act.forbidden_flags || []
      });

      const meetsRelMin =
        act.req_relationship_min === undefined || targetCurrentRel >= Number(act.req_relationship_min);

      // ซ่อน/ล็อกปุ่มสารภาพรักเป็นแฟนหากเป็นแฟนหรือแต่งงานไปแล้ว
      const alreadyCoupleBlocked =
        act.action_id === 'rel_act_ask_to_be_couple' &&
        (state.relationships?.partner?.status === 'dating' || state.relationships?.partner?.status === 'married');

      const cooldownKey = makeActionCooldownKey(act.action_id, specificTargetId);
      const alreadyUsedThisYear = !isMilestoneAction && usedTracker.includes(cooldownKey);

      const usePiggy = age < 7 && !state.finance.hasPiggyBankSmashed;
      const walletAmt = usePiggy ? Number(state.finance.piggyBank || 0) : Number(state.finance.cash || 0);
      const canAffordCash = walletAmt >= cashCost;
      const hasEnoughAp = apCost === 0 || Number(state.turn?.freeActionPoints || 0) >= apCost;

      let lockReasonTh = '';
      if (!hasValidTarget) {
        lockReasonTh = 'ไม่มีบุคคลเป้าหมายในหมวดนี้';
      } else if (alreadyCoupleBlocked) {
        lockReasonTh = 'คุณเลื่อนสถานะเป็นคนรักกันแล้ว';
      } else if (gateLockedMsg) {
        lockReasonTh = gateLockedMsg;
      } else if (!meetsRelMin) {
        lockReasonTh = `ต้องการค่าความสัมพันธ์อย่างน้อย ${act.req_relationship_min}/100 (มี ${targetCurrentRel})`;
      } else if (!meetsFlags) {
        const missingNames = effectiveReqFlags
          .filter((f) => !activeFlags.has(f))
          .map((f) => stripEmojis(db.getTraitOrFlag(f)?.name_th || f));
        lockReasonTh = missingNames.length > 0
          ? `ต้องมี [${missingNames.join(', ')}]`
          : 'ติดเงื่อนไขสถานะต้องห้าม';
      } else if (alreadyUsedThisYear) {
        lockReasonTh = 'ทำกิจกรรมนี้ไปแล้วในปีนี้ (ทำซ้ำได้ในปีถัดไป)';
      } else if (!hasEnoughAp) {
        lockReasonTh = 'แต้มเวลาว่างหมดแล้ว (ต้องการ 1 แต้ม)';
      } else if (!canAffordCash) {
        lockReasonTh = `เงินไม่พอสำหรับค่าใช้จ่าย/สินสอด (${formatCurrency(cashCost)})`;
      }

      const isLocked =
        !hasValidTarget ||
        alreadyCoupleBlocked ||
        Boolean(gateLockedMsg) ||
        !meetsRelMin ||
        !meetsFlags ||
        alreadyUsedThisYear ||
        !hasEnoughAp ||
        !canAffordCash;

      let iconKey = 'users';
      if (act.target_npc_group === 'partner') iconKey = 'heart';
      if (act.target_npc_group === 'children') iconKey = 'family';
      if (act.action_id === 'rel_act_give_parents_allowance') iconKey = 'coin';
      if (act.action_id === 'rel_act_file_divorce') iconKey = 'alert';

      return {
        ...act,
        name_th: cleanName,
        description_th: cleanDesc,
        iconKey,
        apCost,
        cashCost,
        alreadyUsedThisYear,
        isLocked,
        lockIconKey: isLocked ? 'lock' : null,
        lockReasonTh
      };
    });
}

/**
 * ประมวลผลการกดปุ่มทำกิจกรรมความสัมพันธ์ในแท็บที่ 3
 * @param {object} state
 * @param {string} actionId รหัสจาก relationship_actions
 * @param {string|null} [targetId=null] รหัส NPC เฉพาะเจาะจง (เช่น เลือกคุยกับเพื่อนคนใดคนหนึ่ง หรือพาลูกคนใดคนหนึ่งไปเที่ยว)
 */
export function performRelationshipAction(state, actionId, targetId = null) {
  const evaluatedList = getAvailableRelationshipActions(state, targetId);
  const actEval = evaluatedList.find((a) => a.action_id === actionId);

  if (!actEval) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบกิจกรรมความสัมพันธ์นี้ในช่วงอายุปัจจุบัน' };
  }

  if (actEval.isLocked) {
    return {
      success: false,
      iconKey: 'lock',
      message: actEval.lockReasonTh || 'ยังไม่สามารถทำกิจกรรมนี้ได้'
    };
  }

  const age = Number(state.profile.age || 0);
  const cashCost = actEval.cashCost;
  const apCost = actEval.apCost;

  // 1. หักเงินค่าใช้จ่าย (หรือค่าสินสอด) และหักแต้มเวลาว่าง (ถ้าเป็นกิจกรรมทั่วไป)
  if (cashCost > 0) {
    if (age < 7 && !state.finance.hasPiggyBankSmashed) {
      state.finance.piggyBank = Math.round(state.finance.piggyBank - cashCost);
    } else {
      state.finance.cash = Math.round(state.finance.cash - cashCost);
    }
  }

  if (apCost > 0) {
    state.turn.freeActionPoints = Math.max(0, Number(state.turn.freeActionPoints || 0) - apCost);
    const tracker = ensureRelActionTracker(state);
    tracker.push(makeActionCooldownKey(actionId, targetId));
  }

  // 2. มอบและลบป้ายสถานะพื้นฐานของกิจกรรม
  for (const rf of actEval.removes_flags || []) {
    removeFlagOrStatus(state, rf);
  }
  for (const gf of actEval.grants_flags || []) {
    addFlagOrStatus(state, gf);
  }

  // 3. แยกประมวลผลตามประเภทกิจกรรมพิเศษและเป้าหมาย

  // --- กรณีพิเศษ A: สารภาพรักขอเป็นแฟน (rel_act_ask_to_be_couple) ---
  if (actionId === 'rel_act_ask_to_be_couple') {
    const partner = state.relationships.partner;
    partner.status = 'dating';
    partner.relationship = clampStat(Number(partner.relationship || 0) + Number(actEval.relationship_change || 10), 0, 100);
    if (partner.relationship >= 100) {
      addFlagOrStatus(state, 'flag_partner_hearts_5');
    }
    addFlagOrStatus(state, 'flag_in_relationship');
    const statDeltas = applySocialStatEffects(state, actEval.stat_effects || {});

    pushSocialLog(
      state,
      `ตกลงเป็นแฟนกับ ${partner.name}!`,
      `เลื่อนสถานะจากคนคุยขึ้นเป็นคนรู้ใจอย่างเป็นทางการ`,
      'heart',
      'กุมภาพันธ์'
    );

    saveGame(state);
    return {
      success: true,
      iconKey: 'heart',
      statDeltas,
      message: `สารภาพรักสำเร็จ! "${partner.name}" ตกลงเป็นแฟนกับคุณแล้ว`
    };
  }

  // --- กรณีพิเศษ B: คุกเข่าขอแต่งงานและจดทะเบียนสมรส (rel_act_propose_marriage) ---
  if (actionId === 'rel_act_propose_marriage') {
    const partner = state.relationships.partner;
    const partArch = db.indexes.partnerArchetypes.get(partner.archetypeId);
    const econ = partArch?.spouse_economy_after_marriage || {};

    partner.status = 'married';
    partner.relationship = 100;
    partner.netAnnualCashContribution = Number(econ.net_annual_cash_contribution ?? partner.netAnnualCashContribution ?? 0);

    // สุ่มนิสัยการเงินของคู่สมรส 1 อย่างจาก possible_financial_traits
    const possibleTraits = econ.possible_financial_traits || ['trait_spouse_supportive'];
    partner.financialTraitId = pickRandom(possibleTraits) || 'trait_spouse_supportive';
    const spTraitDef = db.indexes.spouseTraits.get(partner.financialTraitId);

    addFlagOrStatus(state, 'flag_married_registered');
    addFlagOrStatus(state, 'flag_in_relationship');
    removeFlagOrStatus(state, 'flag_divorced');

    // มอบป้ายสิทธิพิเศษจากการแต่งงานกับสายอาชีพคู่สมรส (เช่น เบิกค่ารักษาข้าราชการ, รพ.เอกชนของหมอ, ธุรกิจ SME)
    for (const mf of partArch?.grants_flags_on_marriage || []) {
      addFlagOrStatus(state, mf);
    }

    const statDeltas = applySocialStatEffects(state, actEval.stat_effects || {});

    pushSocialLog(
      state,
      `วิวาห์มงคลกับ ${partner.name}!`,
      `สวมแหวนและจ่ายค่าใช้จ่ายแต่งงาน ${formatCurrency(cashCost)} จดทะเบียนสมรสถูกต้องตามกฎหมาย (นิสัยคู่ชีวิต: ${stripEmojis(spTraitDef?.name_th || 'คู่คิด')})`,
      'heart',
      'พฤศจิกายน'
    );

    recalculateNetWorth(state);
    saveGame(state);

    return {
      success: true,
      iconKey: 'heart',
      dowryPaid: cashCost,
      spouseFinancialTraitId: partner.financialTraitId,
      statDeltas,
      message: `ยินดีด้วย! คุณจดทะเบียนสมรสกับ "${partner.name}" เรียบร้อยแล้ว (นิสัยการเงินคู่สมรส: ${stripEmojis(spTraitDef?.name_th || '')})`
    };
  }

  // --- กรณีพิเศษ C: วางแผนมีลูกด้วยกัน (rel_act_plan_have_baby) ---
  if (actionId === 'rel_act_plan_have_baby') {
    const babyGender = rollChance(50) ? 'male' : 'female';
    const clsId = state.profile.currentClassId || state.profile.spawnClassId || 'class_3';
    const babyIdentity = generateThaiIdentity(babyGender, clsId, 'player');
    const familyLastName = state.profile.lastName || babyIdentity.lastName;
    const prefix = babyGender === 'female' ? 'ด.ญ.' : 'ด.ช.';

    const stage1Def = (db.raw.npcs?.child_upbringing_policies || [])[0];
    const defaultPolicyId = stage1Def?.policy_options?.[0]?.option_id || 'pol_s1_public';

    const newChild = {
      id: `child_${Date.now()}_${randomInt(100, 999)}`,
      name: `น้อง${babyIdentity.nickname} (${prefix} ${babyIdentity.firstName} ${familyLastName})`,
      shortName: `น้อง${babyIdentity.nickname}`,
      firstName: babyIdentity.firstName,
      lastName: familyLastName,
      nickname: babyIdentity.nickname,
      gender: babyGender,
      age: 0,
      bornAtParentAge: age,
      relationship: 85,
      successPoints: 0,
      currentStageId: stage1Def?.stage_id || 'child_stage_1_infant_preschool',
      currentPolicyId: defaultPolicyId,
      outcomeId: null
    };

    state.relationships.children.push(newChild);
    if (!state.relationships.designatedHeirId) {
      state.relationships.designatedHeirId = newChild.id;
    }

    if (state.relationships.partner) {
      state.relationships.partner.relationship = clampStat(
        Number(state.relationships.partner.relationship || 80) + Number(actEval.relationship_change || 15),
        0,
        100
      );
    }

    addFlagOrStatus(state, 'flag_has_child');
    const statDeltas = applySocialStatEffects(state, actEval.stat_effects || {});

    pushSocialLog(
      state,
      `ต้อนรับสมาชิกใหม่: ${newChild.name}!`,
      `ครอบครัวต้อนรับสมาชิกใหม่ที่แข็งแรง เริ่มต้นเส้นทางการเลี้ยงดูลูกเต็มตัว`,
      'family',
      'สิงหาคม'
    );

    recalculateNetWorth(state);
    saveGame(state);

    return {
      success: true,
      iconKey: 'family',
      child: newChild,
      statDeltas,
      message: `ยินดีด้วย! ต้อนรับสมาชิกใหม่ "${newChild.name}" เข้าสู่ครอบครัว`
    };
  }

  // --- กรณีพิเศษ D: จดทะเบียนหย่าขาด แบ่งสินสมรส 50% (rel_act_file_divorce) ---
  if (actionId === 'rel_act_file_divorce') {
    const exPartnerName = state.relationships?.partner?.name || 'คู่สมรส';
    let maritalSplitAmount = 0;

    if (Number(state.finance.cash || 0) > 0) {
      maritalSplitAmount = Math.floor(state.finance.cash * 0.5);
      state.finance.cash = Math.round(state.finance.cash - maritalSplitAmount);
    }

    state.relationships.partner = null;
    removeFlagOrStatus(state, 'flag_married_registered');
    removeFlagOrStatus(state, 'flag_in_relationship');
    removeFlagOrStatus(state, 'flag_partner_hearts_5');
    addFlagOrStatus(state, 'flag_divorced');

    const statDeltas = applySocialStatEffects(state, actEval.stat_effects || {});

    pushSocialLog(
      state,
      `จดทะเบียนหย่าขาดกับ ${exPartnerName}`,
      `ยุติชีวิตสมรสตามกฎหมาย แบ่งเงินสดสินสมรสครึ่งหนึ่ง (${formatCurrency(maritalSplitAmount)}) ให้แก่อดีตคู่สมรส`,
      'alert',
      'กันยายน'
    );

    recalculateNetWorth(state);
    saveGame(state);

    return {
      success: true,
      iconKey: 'alert',
      maritalSplitAmount,
      statDeltas,
      message: `จดทะเบียนหย่าเรียบร้อยแล้ว (แบ่งสินสมรสเงินสด ${formatCurrency(maritalSplitAmount)})`
    };
  }

  // --- กรณีทั่วไป: เพิ่มความสัมพันธ์ให้ พ่อแม่ / เพื่อน / คนรัก / ลูก ---
  const relGain = Number(actEval.relationship_change || 0);
  let targetSummaryName = '';

  if (actEval.target_npc_group === 'parents') {
    const parents = (state.relationships.npcs || []).filter(
      (n) =>
        (n.archetypeId === 'npc_arch_father' || n.archetypeId === 'npc_arch_mother') &&
        n.isAlive &&
        (!targetId || n.id === targetId)
    );
    for (const p of parents) {
      p.relationship = clampStat(Number(p.relationship || 0) + relGain, 0, 100);
      if (p.relationship >= 100) {
        addFlagOrStatus(state, 'flag_parent_hearts_5');
      }
    }
    targetSummaryName = parents.map((p) => p.shortName || p.name).join(' และ ');
  } else if (actEval.target_npc_group === 'friends') {
    const friends = (state.relationships.npcs || []).filter(
      (n) =>
        n.archetypeId !== 'npc_arch_father' &&
        n.archetypeId !== 'npc_arch_mother' &&
        n.isAlive &&
        (!targetId || n.id === targetId)
    );
    // หากไม่ได้ระบุ targetId (เช่น เลี้ยงหมูกระทะรวมแก๊ง หรือส่งมีมกลุ่มแชท) ให้บวกความสัมพันธ์ให้เพื่อนทุกคนในกลุ่ม!
    for (const fr of friends) {
      fr.relationship = clampStat(Number(fr.relationship || 0) + relGain, 0, 100);
      const archDef = db.indexes.npcArchetypes.get(fr.archetypeId);
      if (fr.relationship >= 80) {
        for (const closeFlag of archDef?.grants_flags_when_close || []) {
          addFlagOrStatus(state, closeFlag);
        }
      }
    }
    targetSummaryName = targetId && friends[0] ? friends[0].name : 'แก๊งเพื่อนสนิท';
  } else if (actEval.target_npc_group === 'partner' && state.relationships.partner) {
    const partner = state.relationships.partner;
    partner.relationship = clampStat(Number(partner.relationship || 0) + relGain, 0, 100);
    if (partner.relationship >= 100) {
      addFlagOrStatus(state, 'flag_partner_hearts_5');
    }
    targetSummaryName = partner.name;
  } else if (actEval.target_npc_group === 'children') {
    const kids = (state.relationships.children || []).filter((c) => !targetId || c.id === targetId);
    for (const kid of kids) {
      kid.relationship = clampStat(Number(kid.relationship || 0) + relGain, 0, 100);
    }
    targetSummaryName = targetId && kids[0] ? kids[0].name : 'ลูกๆ';
  }

  const statDeltas = applySocialStatEffects(state, actEval.stat_effects || {});

  recalculateNetWorth(state);
  saveGame(state);

  return {
    success: true,
    iconKey: actEval.iconKey || 'heart',
    actionId,
    cashPaid: cashCost,
    relationshipGain: relGain,
    statDeltas,
    message: `${actEval.name_th}${targetSummaryName ? ` กับ ${targetSummaryName}` : ''} สำเร็จ! (ความสัมพันธ์ +${relGain})`
  };
}

// ============================================================================
// 4. ระบบจัดการนโยบายการเลี้ยงดูบุตรและตั้งผู้สืบทอดมรดก (Child Policy & Heir)
// ============================================================================

/**
 * ดึงข้อมูลช่วงวัยนโยบาย (Stage) ที่ตรงกับอายุปัจจุบันของลูก (0-5, 6-11, 12-17, 18-21 ปี)
 * @param {number} childAge
 */
export function getChildUpbringingStageByAge(childAge) {
  const age = Number(childAge ?? 0);
  const policies = db.raw.npcs?.child_upbringing_policies || [];
  return (
    policies.find(
      (st) => age >= Number(st.trigger_child_age) && age < Number(st.trigger_child_age) + Number(st.duration_years)
    ) || null
  );
}

/**
 * เปลี่ยนนโยบายการเลี้ยงดูและการศึกษาของลูกในแท็บที่ 3
 * @param {object} state
 * @param {string} childId
 * @param {string} policyOptionId
 */
export function changeChildUpbringingPolicy(state, childId, policyOptionId) {
  const child = (state.relationships?.children || []).find((c) => c.id === childId);
  if (!child) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบข้อมูลบุตรที่ระบุ' };
  }

  if (child.outcomeId || Number(child.age || 0) >= 22) {
    return { success: false, iconKey: 'info', message: `${child.name} บรรลุนิติภาวะและเรียนจบหลักสูตรไปแล้ว` };
  }

  const stageDef = getChildUpbringingStageByAge(child.age);
  if (!stageDef) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบนโยบายที่รองรับช่วงอายุปัจจุบันของบุตร' };
  }

  const optionDef = (stageDef.policy_options || []).find((o) => o.option_id === policyOptionId);
  if (!optionDef) {
    return { success: false, iconKey: 'alert', message: 'ตัวเลือกนโยบายไม่ตรงกับช่วงวัยปัจจุบันของบุตร' };
  }

  child.currentStageId = stageDef.stage_id;
  child.currentPolicyId = optionDef.option_id;

  saveGame(state);

  return {
    success: true,
    iconKey: 'family',
    childId,
    policyOptionId,
    message: `ตั้งค่านโยบายของ "${child.shortName || child.name}" เป็น "${stripEmojis(optionDef.name_th)}" (${formatCurrency(optionDef.annual_auto_cost_cash)}/ปี)`
  };
}

/**
 * แต่งตั้งบุตรคนใดคนหนึ่งเป็นทายาทผู้สืบทอดมรดกหลัก (สำหรับโหมดเล่นต่อรุ่นลูก Legacy Mode ตอนจบเกม)
 * @param {object} state
 * @param {string} childId
 */
export function designateHeirChild(state, childId) {
  const child = (state.relationships?.children || []).find((c) => c.id === childId);
  if (!child) {
    return { success: false, iconKey: 'alert', message: 'ไม่พบรายชื่อบุตรที่ต้องการแต่งตั้งเป็นทายาท' };
  }

  state.relationships.designatedHeirId = child.id;
  saveGame(state);

  return {
    success: true,
    iconKey: 'trophy',
    designatedHeirId: child.id,
    message: `แต่งตั้ง "${child.name}" เป็นผู้สืบทอดมรดกหลักของตระกูลเรียบร้อยแล้ว`
  };
}

// ============================================================================
// 5. ประมวลผลความสัมพันธ์ ครอบครัว มรดกพ่อแม่ และการเติบโตของลูกเมื่อข้ามปี
// ============================================================================

/**
 * ประเมินผลลัพธ์ความสำเร็จของลูกเมื่ออายุครบ 22 ปีบริบูรณ์ ตามแต้มสะสมและความสัมพันธ์
 */
function evaluateChildGraduationOutcome(child) {
  const outcomes = db.raw.npcs?.child_graduation_and_legacy_outcomes || [];
  const pts = Number(child.successPoints || 0);
  const rel = Number(child.relationship || 0);

  // เรียงจากเกณฑ์สูงสุดลงต่ำสุด (Tier S -> Tier A -> Tier B -> Tier C)
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

  return sorted[sorted.length - 1] || null;
}

/**
 * ประมวลผลการเปลี่ยนแปลงประจำปีของครอบครัว NPC คู่สมรส และบุตร (สำหรับให้ turn_manager.js เรียกทุกต้นปี)
 * @param {object} state GameState ปัจจุบัน (หลังจากบวกอายุผู้เล่น +1 ปีแล้ว)
 * @returns {object} สรุปเหตุการณ์ครอบครัวที่เกิดขึ้นในปีนี้
 */
export function processAnnualSocialAndFamilyProgression(state, options = {}) {
  if (!state?.relationships) return {};

  const playerAge = Number(state.profile.age || 0);
  const applyRecurringPassive = options.deferAnnualPassives
    ? (effects) => collectAnnualPassiveStatEffects(state,effects)
    : (effects) => applySocialStatEffects(state,effects);
  const report = {
    unlockedNpcs: [],
    fatherPassedAway: false,
    inheritanceReceived: 0,
    motherPassedAway: false,
    graduatedChildren: []
  };

  // 1. รีเซ็ตประวัติการกดปุ่มกิจกรรมความสัมพันธ์ประจำปี และปลดล็อก NPC ตามเกณฑ์อายุใหม่
  state.relationships.usedRelActionsThisYear = [];
  report.unlockedNpcs = unlockAgeAppropriateNpcs(state);

  // 2. ตรวจสอบอายุขัยของคุณพ่อ-คุณแม่ และประมวลผล Passive โบนัสของ NPC ที่มีความสัมพันธ์สูง (>= 80)
  for (const npc of state.relationships.npcs || []) {
    if (!npc.isAlive) continue;

    // 2.1 เช็กการเสียชีวิตตามอายุขัยของคุณพ่อและคุณแม่
    if (
      (npc.archetypeId === 'npc_arch_father' || npc.archetypeId === 'npc_arch_mother') &&
      npc.ageAtPlayerBirth !== undefined &&
      npc.passAwayParentAge !== undefined
    ) {
      const currentParentAge = Number(npc.ageAtPlayerBirth) + playerAge;
      if (currentParentAge >= Number(npc.passAwayParentAge)) {
        npc.isAlive = false;

        if (npc.archetypeId === 'npc_arch_father') {
          report.fatherPassedAway = true;
          const fatherArch = db.indexes.npcArchetypes.get('npc_arch_father');
          const inhMap = fatherArch?.inheritance_mechanic?.inheritance_by_class || {};
          const spawnClsId = state.profile.spawnClassId || 'class_1';
          const inheritanceCash = Math.round(Number(inhMap[spawnClsId] || 0));

          if (!npc.inheritanceClaimed && inheritanceCash > 0) {
            state.finance.cash = Math.round(Number(state.finance.cash || 0) + inheritanceCash);
            npc.inheritanceClaimed = true;
            report.inheritanceReceived = inheritanceCash;
          }

          applySocialStatEffects(state, { happiness: -8 });
          pushSocialLog(
            state,
            `สูญเสียคุณพ่อ (${npc.shortName || 'คุณพ่อ'}) ในวัย ${currentParentAge} ปี`,
            inheritanceCash > 0
              ? `คุณพ่อจากไปอย่างสงบตามอายุขัย และทิ้งมรดกประจำตระกูลไว้ให้คุณจำนวน ${formatCurrency(inheritanceCash)}`
              : `คุณพ่อจากไปอย่างสงบตามอายุขัย ทิ้งไว้เพียงคำสอนและความทรงจำอันอบอุ่น`,
            'info',
            'พฤศจิกายน'
          );
        } else {
          report.motherPassedAway = true;
          applySocialStatEffects(state, { happiness: -10 });
          pushSocialLog(
            state,
            `สูญเสียคุณแม่ (${npc.shortName || 'คุณแม่'}) ในวัย ${currentParentAge} ปี`,
            `คุณแม่ผู้เป็นที่รักจากไปอย่างสงบตามอายุขัย ความอาลัยรักยังคงอยู่ในหัวใจลูกเสมอ`,
            'info',
            'พฤศจิกายน'
          );
        }
        continue;
      }
    }

    // 2.2 หากพ่อแม่ทั้งคู่จากไปหมดแล้ว ถอดป้ายหัวใจพ่อแม่เต็ม 5 ดวงที่ผูกกับเงินช่วยเหลือสดออก (ส่วนป้ายลูกกตัญญู flag_filial_child คงอยู่ตลอดชีพ)
    const archDef = db.indexes.npcArchetypes.get(npc.archetypeId);
    if (!archDef) continue;

    if (Number(npc.relationship || 0) >= 100 && archDef.grants_flag_at_100) {
      addFlagOrStatus(state, archDef.grants_flag_at_100);
    }

    if (Number(npc.relationship || 0) >= 80) {
      if (archDef.yearly_passive_effects_when_high_rel) {
        applyRecurringPassive(archDef.yearly_passive_effects_when_high_rel);
      }
      for (const closeFlag of archDef.grants_flags_when_close || []) {
        addFlagOrStatus(state, closeFlag);
      }
    }
  }

  // เช็กว่ายังมีพ่อหรือแม่มีชีวิตอยู่ไหม
  const anyParentAlive = (state.relationships.npcs || []).some(
    (n) => (n.archetypeId === 'npc_arch_father' || n.archetypeId === 'npc_arch_mother') && n.isAlive
  );
  if (!anyParentAlive) {
    removeFlagOrStatus(state, 'flag_parent_hearts_5');
  }

  // 3. ประมวลผลคู่สมรส (อายุเพิ่มขึ้น +1, บวก yearly_stat_effects และ yearly_relationship_decay ตามนิสัยคู่สมรส)
  const partner = state.relationships.partner;
  if (partner) {
    partner.age = Number(partner.age || playerAge) + 1;

    if (partner.status === 'married' && partner.financialTraitId) {
      const spTrait = db.indexes.spouseTraits.get(partner.financialTraitId);
      if (spTrait?.yearly_stat_effects) {
        applyRecurringPassive(spTrait.yearly_stat_effects);
      }
      if (spTrait?.yearly_relationship_decay) {
        partner.relationship = clampStat(
          Number(partner.relationship || 80) + Number(spTrait.yearly_relationship_decay),
          0,
          100
        );
      }
    }
  }

  // 4. ประมวลผลการเติบโตของบุตรทุกคน
  const outcomeDefs = db.raw.npcs?.child_graduation_and_legacy_outcomes || [];

  for (const child of state.relationships.children || []) {
    child.age = Number(child.age || 0) + 1;

    // อัปเดตคำนำหน้าชื่อลูกเมื่อลูกอายุครบ 15 ปี
    if (child.age === 15 && child.firstName && child.lastName) {
      const adultPrefix = child.gender === 'female' ? 'น.ส.' : 'นาย';
      child.name = `น้อง${child.nickname || child.shortName} (${adultPrefix} ${child.firstName} ${child.lastName})`;
    }

    // กรณีที่ 1: ลูกยังอยู่ในวัยเรียน/เติบโต (อายุ 1 - 21 ปี และยังไม่มี outcomeId)
    if (child.age <= 21 && !child.outcomeId) {
      const stageDef = getChildUpbringingStageByAge(child.age);
      if (stageDef) {
        // หากข้ามเข้าสู่ช่วงวัยใหม่ (6, 12, 18 ปี) แต่ยังไม่ได้เลือกนโยบายช่วงใหม่ ให้ตั้งนโยบายพื้นฐานของช่วงใหม่รอไว้ก่อน (แล้วการ์ดใน event_engine จะเด้งให้ผู้เล่นเลือกปรับอีกที)
        const matchingOpt = (stageDef.policy_options || []).find((o) => o.option_id === child.currentPolicyId);
        const activeOpt = matchingOpt || stageDef.policy_options?.[0];

        if (activeOpt) {
          if (!matchingOpt) {
            child.currentPolicyId = activeOpt.option_id;
          }
          child.successPoints = Number(child.successPoints || 0) + Number(activeOpt.annual_child_success_points || 0);
          child.relationship = clampStat(
            Number(child.relationship || 50) + Number(activeOpt.annual_child_rel_change || 0),
            0,
            100
          );
        }
      }
    }
    // กรณีที่ 2: ลูกอายุครบ 22 ปีบริบูรณ์ -> ตัดสินผลลัพธ์ความสำเร็จในชีวิตของลูก!
    else if (child.age >= 22 && !child.outcomeId) {
      const outcome = evaluateChildGraduationOutcome(child);
      if (outcome) {
        child.outcomeId = outcome.outcome_id;
        child.outcomeTitleTh = stripEmojis(outcome.title_th);
        report.graduatedChildren.push({
          childId: child.id,
          name: child.name,
          outcomeId: outcome.outcome_id,
          titleTh: child.outcomeTitleTh
        });

        if (outcome.yearly_parent_stat_bonus) {
          applyRecurringPassive(outcome.yearly_parent_stat_bonus);
        }

        const supportAmt = Number(outcome.annual_filial_support_cash || 0);
        pushSocialLog(
          state,
          `ลูกบรรลุวัยทำงาน: ${child.shortName || child.name}`,
          `ผลลัพธ์การเลี้ยงดู: "${child.outcomeTitleTh}" (${supportAmt >= 0 ? `ส่งเงินกตัญญูให้คุณ +${formatCurrency(supportAmt)}/ปี` : `ยังพึ่งพาขอเงินพ่อแม่ ${formatCurrency(supportAmt)}/ปี`})`,
          supportAmt >= 0 ? 'trophy' : 'alert',
          'พฤษภาคม'
        );
      }
    }
    // กรณีที่ 3: ลูกที่เรียนจบและมี outcomeId อยู่แล้ว -> มอบโบนัสความภาคภูมิใจรายปีให้ผู้เล่น (ส่วนเงินรายปีถูกคิดรวมในสลิปของ economy_engine.js แล้ว)
    else if (child.outcomeId) {
      const outDef = outcomeDefs.find((o) => o.outcome_id === child.outcomeId);
      if (outDef?.yearly_parent_stat_bonus) {
        applyRecurringPassive(outDef.yearly_parent_stat_bonus);
      }
    }
  }

  recalculateNetWorth(state);
  return report;
}
