/**
 * js/engine/event_engine.js
 * โมดูลจัดการคิวอีเวนต์ประจำปี การจับคู่เดือนไทย การแปลงหมุดหมาย/วิกฤต/ดราม่าคู่สมรส/นโยบายลูก
 * ระบบสุ่มผสมถังอีเวนต์ (Weighted Pool Mixing) และการประมวลผลตัวเลือกพร้อมทอยเต๋า RNG
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100% และส่งรหัส iconKey สำหรับเรนเดอร์ Inline SVG เท่านั้น
 */

import { db } from '../core/db.js';
import { getLifePathPoolWeights } from './life_path_engine.js';
import { recalculateNetWorth, saveGame } from '../core/state.js';
import {
  clampStat,
  checkRequirement,
  getPlayerFlagSet,
  getPlayerStatValue,
  pickRandom,
  randomInt,
  rollChance,
  shuffleArray,
  weightedRandom,
  formatCurrency
} from '../core/utils.js';
import { smashPiggyBankAtAge7 } from './economy_engine.js';
import { applyStatEffects as applyCoreStatEffects } from '../core/stat_engine.js';
import { selectRandomEvents, recordRandomEvent } from './random_event_engine.js';
import { RANDOM_EVENT_TEMPLATES, toLegacyEventCard } from './random_event_templates.js';
import { buildCuratedLegacyTemplates } from './legacy_random_templates.js';
import { maybeEnhanceRandomEventWithAi } from './ai_event_client.js';
import { applyRandomNpcMeeting } from './random_npc_meeting.js';

// ============================================================================
// Constants & Thai Month Mapping
// ============================================================================

export const THAI_MONTHS = [
  { monthNum: 1, monthTh: 'มกราคม', shortTh: 'ม.ค.' },
  { monthNum: 2, monthTh: 'กุมภาพันธ์', shortTh: 'ก.พ.' },
  { monthNum: 3, monthTh: 'มีนาคม', shortTh: 'มี.ค.' },
  { monthNum: 4, monthTh: 'เมษายน', shortTh: 'เม.ย.' },
  { monthNum: 5, monthTh: 'พฤษภาคม', shortTh: 'พ.ค.' },
  { monthNum: 6, monthTh: 'มิถุนายน', shortTh: 'มิ.ย.' },
  { monthNum: 7, monthTh: 'กรกฎาคม', shortTh: 'ก.ค.' },
  { monthNum: 8, monthTh: 'สิงหาคม', shortTh: 'ส.ค.' },
  { monthNum: 9, monthTh: 'กันยายน', shortTh: 'ก.ย.' },
  { monthNum: 10, monthTh: 'ตุลาคม', shortTh: 'ต.ค.' },
  { monthNum: 11, monthTh: 'พฤศจิกายน', shortTh: 'พ.ย.' },
  { monthNum: 12, monthTh: 'ธันวาคม', shortTh: 'ธ.ค.' }
];

const STAT_META = {
  health: { nameTh: 'สุขภาพ', iconKey: 'heart_pulse' },
  happiness: { nameTh: 'ความสุข', iconKey: 'smile' },
  intelligence: { nameTh: 'สมอง', iconKey: 'brain' },
  connections: { nameTh: 'เส้นสาย', iconKey: 'users' },
  merit: { nameTh: 'แต้มบุญ', iconKey: 'sparkle' },
  appearance: { nameTh: 'บุคลิกหน้าตา', iconKey: 'star' },
  cash: { nameTh: 'เงิน', iconKey: 'coin' }
};

// Regex สำหรับล้างอักขระ Emoji, Pictographs, Variation Selectors และ Zero-Width Joiners จาก JSON
const EMOJI_STRIP_REGEX = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D\u20E3]+/gu;

// ============================================================================
// Text Sanitization & SVG Token Helpers (No-Emoji Enforcement)
// ============================================================================

/**
 * กรองตัวอักษร Emoji ออกจากข้อความ JSON เพื่อแสดงผลแบบ Clean Minimal Line-Art
 * @param {string} text
 * @returns {string}
 */
export function stripEmojis(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(EMOJI_STRIP_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * อนุมาน iconKey จากเนื้อหาข้อความภาษาไทย (สำหรับผูก Inline SVG แทน Emoji ที่ถูกตัดออก)
 * @param {string} rawSegment
 * @returns {string}
 */
export function inferIconKeyFromText(rawSegment) {
  const s = String(rawSegment || '').toLowerCase();
  if (s.includes('ล็อก') || s.includes('ต้องมี')) return 'lock';
  if (s.includes('โอกาส') || s.includes('%') || s.includes('วัดดวง')) return 'dice';
  if (s.includes('ประกัน') || s.includes('พ.ร.บ.') || s.includes('ปลอดภัย')) return 'shield';
  if (s.includes('รพ.') || s.includes('โรงพยาบาล') || s.includes('ผ่าตัด') || s.includes('ป่วย')) return 'hospital';
  if (s.includes('เงิน') || s.includes('฿') || s.includes('บาท') || s.includes('กำไร') || s.includes('โบนัส') || s.includes('ปรับ') || s.includes('ค่า')) return 'coin';
  if (s.includes('กระปุก')) return 'piggy';
  if (s.includes('สุขภาพ')) return 'heart_pulse';
  if (s.includes('ความสุข')) return 'smile';
  if (s.includes('สมอง') || s.includes('แต้มความสำเร็จ')) return 'brain';
  if (s.includes('เส้นสาย') || s.includes('ความเอ็นดู') || s.includes('เพื่อนฝูง')) return 'users';
  if (s.includes('ความสัมพันธ์') || s.includes('หัวใจ')) return 'heart';
  if (s.includes('แต้มบุญ') || s.includes('บุญ')) return 'sparkle';
  if (s.includes('หน้าตา')) return 'star';
  if (s.includes('ป้าย') || s.includes('ปลดล็อก') || s.includes('ได้รับ') || s.includes('ล้าง')) return 'tag';
  if (s.includes('เสี่ยง') || s.includes('ติดสถานะ') || s.includes('อุบัติเหตุ')) return 'alert';
  return 'info';
}

/**
 * แปลงข้อความ hint_th จาก JSON (ซึ่งคั่นด้วย ',') ให้เป็น Array ของ Token ไร้ Emoji พร้อม iconKey
 * @param {string} rawHintTh
 * @returns {Array<{ iconKey: string, text: string }>}
 */
export function parseHintTokens(rawHintTh) {
  if (!rawHintTh || typeof rawHintTh !== 'string') return [];
  return rawHintTh
      .split(/\s*,\s*(?=[^\d])/g)
    .map((part) => {
      const cleaned = stripEmojis(part);
      return {
        iconKey: inferIconKeyFromText(cleaned),
        text: cleaned
      };
    })
    .filter((token) => token.text.length > 0);
}

const PREVIEW_EFFECT_COPY = {
  health: ['ช่วยส่งเสริมสุขภาพ', 'อาจกระทบสุขภาพ'],
  happiness: ['ช่วยเพิ่มความสบายใจและความสุข', 'อาจทำให้รู้สึกกดดันหรือไม่สบายใจ'],
  intelligence: ['ช่วยพัฒนาความรู้และทักษะ', 'อาจทำให้เสียโอกาสในการเรียนรู้'],
  connections: ['ช่วยสร้างความสัมพันธ์และความไว้วางใจ', 'อาจทำให้ความสัมพันธ์ตึงเครียด'],
  merit: ['ส่งเสริมด้านคุณงามความดีและความเชื่อ', 'อาจไม่เป็นผลดีต่อความเชื่อหรือความตั้งใจ'],
  appearance: ['ช่วยเสริมบุคลิกภาพ', 'อาจกระทบภาพลักษณ์'],
  cash: ['ช่วยเพิ่มเงินสดหรือเงินออม', 'อาจมีค่าใช้จ่ายหรือทำให้เงินลดลง']
};

function describeEffectSet(effects = {}, relationshipChange = 0) {
  const parts = [];
  for (const [key, rawValue] of Object.entries(effects || {})) {
    const value = Number(rawValue || 0);
    if (!Number.isFinite(value) || value === 0) continue;
    const copy = PREVIEW_EFFECT_COPY[key];
    if (copy) parts.push(copy[value > 0 ? 0 : 1]);
  }
  const relationship = Number(relationshipChange || 0);
  if (relationship > 0) parts.push('ช่วยให้ความสัมพันธ์กับคนที่เกี่ยวข้องดีขึ้น');
  if (relationship < 0) parts.push('อาจสร้างระยะห่างกับคนที่เกี่ยวข้อง');
  return [...new Set(parts)];
}

/**
 * สร้างคำอธิบายผลที่คาดว่าจะตามมาโดยไม่เปิดเผยตัวเลขค่าสถานะก่อนผู้เล่นตัดสินใจ
 */
export function getChoicePreviewText(choice = {}) {
  if (typeof choice.preview_text_th === 'string' && choice.preview_text_th.trim()) {
    return stripEmojis(choice.preview_text_th);
  }

  const successEffects = describeEffectSet(
    choice.stat_effects || choice.on_success?.stat_effects || {},
    choice.relationship_change
  );
  const failureEffects = describeEffectSet(
    choice.rng_mechanic?.fail_stat_effects || choice.on_fail?.stat_effects || {},
    choice.rng_mechanic?.fail_relationship_change || 0
  );

  if (choice.rng_mechanic || choice.on_fail) {
    const successText = successEffects.length ? successEffects.join(' และ ') : 'อาจเปิดโอกาสหรือสถานะใหม่';
    const failureText = failureEffects.length ? failureEffects.join(' และ ') : 'อาจต้องรับมือกับผลที่ไม่เป็นไปตามแผน';
    return `หากเป็นไปตามแผน: ${successText} หากไม่สำเร็จ: ${failureText}`;
  }

  const effects = successEffects;
  if (effects.length) return `ผลที่อาจตามมา: ${effects.join(' และ ')}`;
  if ((choice.grants_flags || []).length || (choice.removes_flags || []).length) {
    return 'อาจเปลี่ยนสถานะหรือเปิดโอกาสใหม่ในเส้นทางชีวิต';
  }
  return 'เป็นอีกทางเลือกในการรับมือกับสถานการณ์ โดยไม่มีผลกระทบที่ระบุไว้ล่วงหน้า';
}

/**
 * สร้างข้อความสรุปผลกระทบค่าสถานะแบบไร้ Emoji สำหรับช้อยส์ที่สร้างขึ้นไดนามิก (เช่น Milestone / ดราม่าคู่สมรส)
 * @param {Record<string, number>} statEffects
 * @param {number} [cashEffect=0]
 * @returns {string}
 */
function buildCleanHintFromEffects(statEffects = {}, cashEffect = 0) {
  const parts = [];
  if (cashEffect !== 0) {
    parts.push(`เงิน ${formatCurrency(cashEffect, { showPlus: true })}`);
  }
  for (const [key, val] of Object.entries(statEffects || {})) {
    const num = Number(val || 0);
    if (num === 0) continue;
    if (key === 'cash') {
      parts.push(`เงิน ${formatCurrency(num, { showPlus: true })}`);
      continue;
    }
    const label = STAT_META[key]?.nameTh || key;
    parts.push(`${label} ${num > 0 ? `+${num}` : num}`);
  }
  return parts.join(' , ');
}

// ============================================================================
// Internal State Mutation Helpers
// ============================================================================

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

function removeFlagFromState(state, flagId) {
  if (!flagId) return;
  state.flags = (state.flags || []).filter((f) => f !== flagId);
  state.talentTags = (state.talentTags || []).filter((f) => f !== flagId);
  state.statuses = (state.statuses || []).filter((f) => f !== flagId);
  state.innateTraits = (state.innateTraits || []).filter((f) => f !== flagId);
}

/**
 * อัปเดตค่าสถานะทั้ง 7 ตัว (4 หลอดหลัก + แต้มบุญ + หน้าตา + เงินสด/กระปุก) และคืนค่าส่วนต่างจริง (statDeltas)
 * @param {object} state
 * @param {Record<string, number>} effects
 * @returns {Record<string, number>}
 */
function applyEventStatEffects(state, effects) {
  const deltas = {
    health: 0,
    happiness: 0,
    intelligence: 0,
    connections: 0,
    merit: 0,
    appearance: 0,
    cash: 0,
    piggyBank: 0
  };

  if (!effects || typeof effects !== 'object') return deltas;

  const coreDeltas = applyCoreStatEffects(state, effects);
  for (const key of ['health', 'happiness', 'intelligence', 'connections', 'appearance', 'merit']) {
    deltas[key] = coreDeltas[key] || 0;
  }

  const cashInput = Math.round(Number(effects.cash ?? 0));
  if (cashInput !== 0) {
    const usePiggy = state.profile.age < 7 && !state.finance.hasPiggyBankSmashed && cashInput > 0;
    if (usePiggy) {
      state.finance.piggyBank = Math.round(Number(state.finance.piggyBank || 0) + cashInput);
      deltas.piggyBank = cashInput;
    } else {
      state.finance.cash = Math.round(Number(state.finance.cash || 0) + cashInput);
      deltas.cash = cashInput;
    }
  }

  return deltas;
}

/**
 * อัปเดตค่าความสัมพันธ์ (relationship_change) ไปยัง NPC เป้าหมาย คู่รัก หรือลูก ตามบริบทของอีเวนต์
 */
function applyEventRelationshipChange(state, eventCard, relDelta) {
  const delta = Math.round(Number(relDelta || 0));
  if (delta === 0) return null;

  // 1. หากระบุ target_npc_archetype (เช่น พ่อ แม่ เพื่อน ผู้ใหญ่)
  if (eventCard.target_npc_archetype) {
    const targetNpc = (state.relationships?.npcs || []).find(
      (n) => n.archetypeId === eventCard.target_npc_archetype && n.isAlive !== false
    );
    if (targetNpc) {
      const before = Number(targetNpc.relationship ?? 50);
      targetNpc.relationship = clampStat(before + delta, 0, 100);
      if (
        (targetNpc.archetypeId === 'npc_arch_father' || targetNpc.archetypeId === 'npc_arch_mother') &&
        targetNpc.relationship >= 100
      ) {
        addFlagToState(state, 'flag_parent_hearts_5');
      }
      if (targetNpc.archetypeId === 'npc_arch_elite_mentor' && targetNpc.relationship >= 100) {
        addFlagToState(state, 'flag_elite_connection');
      }
      return { targetType: 'npc', targetName: targetNpc.name, delta: targetNpc.relationship - before };
    }
  }

  // 2. หากเป็นหมวดการเลี้ยงดูลูก (children_parenting)
  if (eventCard.category === 'children_parenting' || eventCard.source_type === 'child_policy') {
    const targetChild =
      (state.relationships?.children || []).find((c) => c.id === eventCard.target_child_id) ||
      state.relationships?.children?.[0];
    if (targetChild) {
      const before = Number(targetChild.relationship ?? 50);
      targetChild.relationship = clampStat(before + delta, 0, 100);
      return { targetType: 'child', targetName: targetChild.name, delta: targetChild.relationship - before };
    }
  }

  // 3. หากเป็นหมวดความรัก/คู่สมรส (romance_* / partner_specific / spouse_drama)
  const isRomanceEvent =
    String(eventCard.category || '').startsWith('romance') ||
    eventCard.category === 'partner_specific' ||
    eventCard.source_type === 'spouse_drama';

  if (isRomanceEvent && state.relationships?.partner) {
    const partner = state.relationships.partner;
    const before = Number(partner.relationship ?? 50);
    partner.relationship = clampStat(before + delta, 0, 100);
    if (partner.relationship >= 100) {
      addFlagToState(state, 'flag_partner_hearts_5');
    } else if (partner.relationship < 100 && partner.status !== 'married') {
      removeFlagFromState(state, 'flag_partner_hearts_5');
    }
    return { targetType: 'partner', targetName: partner.name, delta: partner.relationship - before };
  }

  return null;
}

// ============================================================================
// 1. ระบบจับคู่เดือนภาษาไทยให้สอดคล้องกับบริบทอีเวนต์
// ============================================================================

const FLAVOR_MONTH_RULES = [
  {
    months: [1, 2],
    keywords: ['วันเด็ก', 'ปีใหม่เริ่มต้น', 'วันขึ้นปีใหม่', 'ตรุษจีน', 'วาเลนไทน์', '14 กุมภาพันธ์', 'ลืมตาดูโลก', 'ขอนแก่นมาราธอน']
  },
  {
    months: [3],
    keywords: ['pm2.5', 'ฝุ่นควันไฟป่า', 'ฝุ่นพิษ', 'ย่าโม', 'ท้าวสุรนารี', 'ปัจฉิม', 'ซัมเมอร์แคมป์', 'ปิดเทอมหน้าร้อน', 'ปิดเทอมฤดูร้อน']
  },
  {
    months: [4],
    keywords: ['เกณฑ์ทหาร', 'ตรวจเลือกทหาร', 'ใบดำ-ใบแดง', 'สงกรานต์', 'วันไหล', 'ฮีทสโตรก', 'คลื่นความร้อน', 'เมษายน', 'วันผู้สูงอายุ']
  },
  {
    months: [5, 6],
    keywords: ['เปิดเทอม', 'รับน้อง', 'เฟรชชี่', 'เข้าเรียนเตรียมอนุบาล', 'เข้า ม.1', 'ม.1', 'ม.4', 'ป.1', 'ทุเรียน', 'มังคุด', 'สวนผลไม้']
  },
  {
    months: [7],
    keywords: ['กยศ.', 'เข้าพรรษา', 'อาสาฬหบูชา', '5 กรกฎาคม']
  },
  {
    months: [8],
    keywords: ['วันแม่', '12 สิงหาคม']
  },
  {
    months: [9],
    keywords: ['ปิดปีงบประมาณ', 'กันยายน', 'เกษียณอายุ', 'มุทิตาจิต']
  },
  {
    months: [10],
    keywords: ['กินเจ', 'ถือศีลกินผัก', 'ออกพรรษา', 'ชักพระ', 'ลากพระ', 'แซนโฎนตา', 'น้ำท่วม', 'อุทกภัย', 'กฐิน', 'ตุลาคม']
  },
  {
    months: [11],
    keywords: ['ลอยกระทง', 'ยี่เป็ง', '11.11', 'เกี่ยวข้าว', 'บุญคูณลาน', 'เขาชนไก่']
  },
  {
    months: [12],
    keywords: ['โบนัส', 'จับสลากของขวัญปีใหม่', 'สวดมนต์ข้ามปี', 'เคาท์ดาวน์', 'ส่งท้ายปีเก่า', '12.12', 'ธันวาคม', 'prom night']
  }
];

/**
 * ตรวจหาเลขเดือนไทยที่เข้ากับคำสำคัญของอีเวนต์ (คืนค่า null หากไม่มีคำสำคัญเฉพาะเจาะจง)
 * @param {object} evt
 * @returns {number|null} 1..12 หรือ null
 */
function detectPreferredFlavorMonth(evt) {
  const haystack = `${evt.title_th || ''} ${evt.description_th || ''} ${evt.event_id || ''}`.toLowerCase();

  for (const rule of FLAVOR_MONTH_RULES) {
    if (rule.keywords.some((kw) => haystack.includes(kw.toLowerCase()))) {
      return pickRandom(rule.months);
    }
  }
  return null;
}

/**
 * จัดสรรเลขเดือนและชื่อเดือนภาษาไทย (1-12) ให้กับคิวอีเวนต์ทั้งปีแบบเรียงลำดับจากต้นปีไปท้ายปี
 * โดยเคารพบริบทเทศกาลไทย และเว้นระยะห่าง 2-4 เดือนอย่างเป็นธรรมชาติ ไม่ให้เดือนย้อนกลับ
 *
 * @param {Array<object>} eventsQueue
 * @returns {Array<object>}
 */
export function assignFlavorMonthsToQueue(eventsQueue) {
  if (!Array.isArray(eventsQueue) || eventsQueue.length === 0) return [];

  // แนบ preferredMonth เบื้องต้น
  const tagged = eventsQueue.map((evt, idx) => ({
    evt,
    originalIdx: idx,
    preferredMonth: detectPreferredFlavorMonth(evt)
  }));

  // เรียงลำดับอีเวนต์ที่มีเดือนเฉพาะเจาะจงให้อยู่ในลำดับเวลาที่สอดคล้องกัน โดยให้ Milestone สำคัญอยู่ต้นคิวถ้าไม่มีเดือนบังคับ
  tagged.sort((a, b) => {
    const mA = a.preferredMonth ?? (a.evt.source_type === 'milestone' ? 2 : 6);
    const mB = b.preferredMonth ?? (b.evt.source_type === 'milestone' ? 2 : 6);
    if (mA !== mB) return mA - mB;
    return a.originalIdx - b.originalIdx;
  });

  const count = tagged.length;
  let prevMonth = 0;

  return tagged.map((entry, idx) => {
    const remainingAfterThis = count - 1 - idx;
    const maxAllowedMonth = Math.max(1, 12 - remainingAfterThis);
    const minAllowedMonth = Math.min(maxAllowedMonth, prevMonth + 1);

    let chosenMonth;
    if (
      entry.preferredMonth !== null &&
      entry.preferredMonth >= minAllowedMonth &&
      entry.preferredMonth <= maxAllowedMonth
    ) {
      chosenMonth = entry.preferredMonth;
    } else if (entry.preferredMonth !== null && entry.preferredMonth < minAllowedMonth) {
      chosenMonth = minAllowedMonth;
    } else if (entry.preferredMonth !== null && entry.preferredMonth > maxAllowedMonth) {
      chosenMonth = maxAllowedMonth;
    } else {
      // กรณีอีเวนต์ทั่วไป: กระจายระยะห่าง 2-4 เดือนอย่างเป็นธรรมชาติ
      if (idx === 0) {
        chosenMonth = Math.min(maxAllowedMonth, randomInt(2, Math.min(4, maxAllowedMonth)));
      } else {
        const step = randomInt(2, 4);
        chosenMonth = Math.min(maxAllowedMonth, Math.max(minAllowedMonth, prevMonth + step));
      }
    }

    prevMonth = chosenMonth;
    const monthMeta = THAI_MONTHS[chosenMonth - 1] || THAI_MONTHS[0];

    return {
      ...entry.evt,
      monthNum: monthMeta.monthNum,
      monthTh: monthMeta.monthTh,
      monthShortTh: monthMeta.shortTh
    };
  });
}

// ============================================================================
// 2. แปลงเหตุการณ์พิเศษให้เป็น Normalized Event Card Object
// ============================================================================

/**
 * ทำความสะอาดและจัดรูปแบบ Event Card จากทุกแหล่งให้มีโครงสร้างมาตรฐานเดียวกันและปราศจาก Emoji
 * @param {object} rawCard
 * @param {string} [defaultSourceType='pool_event']
 * @param {string} [defaultIconKey='calendar']
 * @returns {object}
 */
function getBalancedChoiceLabel(rawCard) {
  const title = String(rawCard.title_th || rawCard.name_th || '');
  const category = String(rawCard.category || rawCard.source_type || '').toLowerCase();
  const context = `${title} ${rawCard.description_th || ''}`.toLowerCase();

  if (/romance|relationship|family|friend|partner|children_parenting|spouse/.test(category) ||
      /ครอบครัว|พ่อแม่|เพื่อน|คู่รัก|แฟน|ความสัมพันธ์|แต่งงาน|ลูก/.test(context)) {
    return 'พูดคุยรับฟังกันและหาทางออกร่วมกัน';
  }
  if (/career|job|work/.test(category) || /อาชีพ|สมัครงาน|ทำงาน|หัวหน้า|ลูกค้า|ธุรกิจ/.test(context)) {
    return 'ขอคำแนะนำและวางแผนก่อนตัดสินใจรับภาระเพิ่มเติม';
  }
  if (/education|school|study/.test(category) || /เรียน|โรงเรียน|สอบ|มหาวิทยาลัย|ติว/.test(context)) {
    return 'แบ่งเวลาให้ทั้งความก้าวหน้าและการพักผ่อนอย่างสมดุล';
  }
  if (/เงิน|ซื้อ|ขาย|ลงทุน|ออม|ค่าใช้จ่าย|หนี้/.test(context)) {
    return 'เปรียบเทียบทางเลือกและวางแผนทรัพยากรก่อนตัดสินใจ';
  }
  if (Number(rawCard.trigger_age ?? rawCard.min_age ?? 100) <= 4) {
    return 'ให้ผู้ใหญ่ช่วยประคองและเลือกวิธีที่เหมาะกับสถานการณ์';
  }
  if (Number(rawCard.trigger_age ?? rawCard.min_age ?? 100) <= 17) {
    return 'ขอคำแนะนำจากผู้ใหญ่แล้วเลือกวิธีที่พอดีกับตัวเอง';
  }
  return 'เลือกแนวทางที่สมดุล โดยคำนึงถึงผลที่จะตามมา';
}

function getAverageEffects(choices, fieldName) {
  const valuesByKey = new Map();
  for (const choice of choices || []) {
    const source = choice?.[fieldName];
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    for (const [key, rawValue] of Object.entries(source)) {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;
      const bucket = valuesByKey.get(key) || [];
      bucket.push(value);
      valuesByKey.set(key, bucket);
    }
  }

  return Object.fromEntries(
    [...valuesByKey.entries()]
      .map(([key, values]) => [key, Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)])
      .filter(([, value]) => value !== 0)
  );
}

function ensureMinimumEventChoices(rawCard) {
  const choices = Array.isArray(rawCard.choices) ? [...rawCard.choices] : [];
  while (choices.length < 3) {
    const usedIds = new Set(choices.map((choice) => choice.choice_id).filter(Boolean));
    let nextId = `c${choices.length + 1}`;
    let suffix = 1;
    while (usedIds.has(nextId)) nextId = `choice_balanced_${suffix++}`;

    const averageEffects = getAverageEffects(choices, 'stat_effects');
    const relationshipValues = choices
      .map((choice) => Number(choice.relationship_change || 0))
      .filter(Number.isFinite);
    const relationshipChange = relationshipValues.length
      ? Math.round(relationshipValues.reduce((sum, value) => sum + value, 0) / relationshipValues.length)
      : 0;

    choices.push({
      choice_id: nextId,
      label_th: getBalancedChoiceLabel(rawCard),
      preview_text_th: 'เป็นทางเลือกประนีประนอมที่พิจารณาผลดีและข้อจำกัดไปพร้อมกัน',
      req_stats: {},
      req_flags: [],
      grants_flags: [],
      removes_flags: [],
      ...(relationshipChange ? { relationship_change: relationshipChange } : {}),
      stat_effects: averageEffects
    });
  }
  return choices;
}

export function normalizeEventCard(rawCard, defaultSourceType = 'pool_event', defaultIconKey = 'calendar') {
  const cleanTitle = stripEmojis(rawCard.title_th || rawCard.name_th || 'เหตุการณ์สำคัญ');
  const cleanDesc = stripEmojis(rawCard.description_th || '');

  const sourceChoices = rawCard.source_type === 'random_event' && Array.isArray(rawCard.choices) && rawCard.choices.length >= 2 && rawCard.choices.length <= 4
    ? rawCard.choices
    : ensureMinimumEventChoices(rawCard);
  const normalizedChoices = sourceChoices.map((ch, idx) => {
    const rawHint = ch.hint_th || '';
    return {
      ...ch,
      choice_id: ch.choice_id || `c${idx + 1}`,
      label_th: stripEmojis(ch.label_th || ch.choice_label_th || `ตัวเลือกที่ ${idx + 1}`),
      hint_th: stripEmojis(rawHint),
      preview_text_th: getChoicePreviewText(ch),
      hintTokens: parseHintTokens(rawHint)
    };
  });

  return {
    ...rawCard,
    event_id: rawCard.event_id,
    title_th: cleanTitle,
    description_th: cleanDesc,
    source_type: rawCard.source_type || defaultSourceType,
    iconKey: rawCard.iconKey || defaultIconKey,
    choices: normalizedChoices
  };
}

/**
 * สร้างการ์ดอีเวนต์บังคับประจำอายุ (Milestones) จาก Milestones_&_Licenses.json
 * @param {object} state
 * @returns {Array<object>}
 */
export function buildMilestoneEventCards(state) {
  const age = Number(state.profile.age || 0);
  const milestones = db.getMilestonesAtAge(age) || [];
  if (milestones.length === 0) return [];

  const cards = [];

  for (const ms of milestones) {
    // ข้ามการเกณฑ์ทหารสำหรับตัวละครเพศหญิง
    if (ms.milestone_id === 'ms_military_conscription' && state.profile.gender !== 'male') {
      continue;
    }

    // ตรวจสอบ req_flags ของ Milestone (ยกเว้นกรณี ms_education_branch_15 ที่เกิดปีเดียวกับ ms_first_national_id_title_update ซึ่งเพิ่งแจก flag_edu_middle_grad)
    const willBeGrantedEarlierSameYear =
      ms.milestone_id === 'ms_education_branch_15' && age === 15;
    if (!willBeGrantedEarlierSameYear && Array.isArray(ms.req_flags) && ms.req_flags.length > 0) {
      if (!checkRequirement(null, ms.req_flags, state)) continue;
    }

    const eventId = `evt_${ms.milestone_id}`;
    if ((state.turn.triggeredEventIdsThisLife || []).includes(eventId)) continue;

    // 2.1 อายุ 7 ปี: ทุบกระปุกออมสินลูกหมู
    if (ms.milestone_id === 'ms_piggy_bank_smash') {
      const piggyAmt = Math.round(Number(state.finance.piggyBank || 0));
      cards.push(
        normalizeEventCard(
          {
            event_id: eventId,
            title_th: ms.name_th,
            description_th: `${ms.description_th} (ยอดเงินสะสมในกระปุกปัจจุบัน: ${formatCurrency(piggyAmt)})`,
            source_type: 'milestone',
            category: 'milestone',
            iconKey: 'piggy',
            choices: [
              {
                choice_id: 'c1',
                label_th: 'ทุบกระปุกนำเงินไปฝากธนาคารออมสินและถ่ายรูปบัตรประชาชนเด็กใบแรก',
                hint_th: `โอนเงินกระปุกเข้าบัญชี +${formatCurrency(piggyAmt)} , เงินขวัญถุง +500 ฿ , ความสุข +3 , สมอง +1 , ได้รับป้าย [บัญชีธนาคาร & บัตรประชาชน]`,
                req_stats: {},
                req_flags: [],
                grants_flags: ms.grants_flags || ['flag_bank_account', 'flag_thai_id_card'],
                removes_flags: [],
                stat_effects: ms.stat_effects || { happiness: 3, intelligence: 1, cash: 500 },
                special_handler: 'smash_piggy_bank_age_7'
              }
            ]
          },
          'milestone',
          'piggy'
        )
      );
      continue;
    }

    // 2.2 อายุ 15 ปี (ใบที่ 1): เปลี่ยนคำนำหน้าเป็น นาย / นางสาว
    if (ms.milestone_id === 'ms_first_national_id_title_update') {
      const newPrefix = state.profile.gender === 'female' ? 'น.ส.' : 'นาย';
      cards.push(
        normalizeEventCard(
          {
            event_id: eventId,
            title_th: ms.name_th,
            description_th: ms.description_th,
            source_type: 'milestone',
            category: 'milestone',
            iconKey: 'id_card',
            choices: [
              {
                choice_id: 'c1',
                label_th: `อัปเดตบัตรประชาชนเป็น "${newPrefix}" พร้อมปลดล็อกสิทธิ์ทำงานพาร์ทไทม์และสอบใบขับขี่มอเตอร์ไซค์`,
                hint_th: 'ความสุข +2 , สมอง +1 , เส้นสาย +1 , ปลดล็อกงานพาร์ทไทม์ถูกกฎหมาย',
                req_stats: {},
                req_flags: [],
                grants_flags: ms.grants_flags || ['flag_legal_youth_worker', 'flag_edu_middle_grad'],
                removes_flags: [],
                stat_effects: ms.stat_effects || { happiness: 2, intelligence: 1, connections: 1 },
                special_handler: 'update_adult_title_prefix_15'
              }
            ]
          },
          'milestone',
          'id_card'
        )
      );
      continue;
    }

    // 2.3 อายุ 15 ปี (ใบที่ 2): ทางแยกชีวิตจบ ม.3 เลือกสายการเรียน 4 สาย
    if (ms.milestone_id === 'ms_education_branch_15') {
      const branchChoices = (ms.branch_options || []).map((opt) => ({
        choice_id: opt.option_id,
        label_th: `${opt.name_th} — ${opt.description_th}`,
        hint_th: buildCleanHintFromEffects(opt.stat_effects),
        req_stats: opt.req_stats || {},
        req_flags: opt.req_flags || [],
        grants_flags: opt.grants_flags || [],
        removes_flags: ['flag_middle_school_student'],
        stat_effects: opt.stat_effects || {}
      }));

      cards.push(
        normalizeEventCard(
          {
            event_id: eventId,
            title_th: ms.name_th,
            description_th: ms.description_th,
            source_type: 'milestone',
            category: 'milestone',
            iconKey: 'school',
            choices: branchChoices
          },
          'milestone',
          'school'
        )
      );
      continue;
    }

    // 2.4 อายุ 21 ปี (เฉพาะชายไทย): ตรวจเลือกทหารกองเกิน (จับใบดำ-ใบแดง)
    if (ms.milestone_id === 'ms_military_conscription') {
      const draftChoices = (ms.branch_options || []).map((opt) => {
        if (opt.option_id === 'opt_draw_ballot') {
          const redChance = Number(opt.red_card_chance_percent ?? 30);
          const blackChance = 100 - redChance;
          return {
            choice_id: opt.option_id,
            label_th: opt.name_th,
            hint_th: `โอกาสใบดำ ${blackChance}% (รอดตัวทันที) | โอกาสใบแดง ${redChance}% (รับใช้ชาติ 2 ปี เงินเดือนรวม +108,000 ฿)`,
            req_stats: {},
            req_flags: opt.req_flags || [],
            base_success_chance_percent: blackChance,
            stat_scaling_bonus: {},
            on_success: {
              outcome_text_th: 'เสียงประกาศก้องหอประชุม "ใบดำ!" คุณรอดพ้นจากการเป็นทหารกองประจำการ สามารถเรียนต่อและทำงานได้ตามปกติ!',
              grants_flags: [...(ms.grants_flags || []), ...(opt.grants_flags_on_black || ['flag_black_card_winner'])],
              removes_flags: [],
              stat_effects: opt.stat_effects_on_black || { happiness: 8 }
            },
            on_fail: {
              outcome_text_th: 'เสียงประกาศดังสนั่น "ใบแดง! ทบ. ผลัด 1!" คุณต้องเข้ากรมรับใช้ชาติ 2 ปีเต็ม (พักงานประจำชั่วคราว แต่ได้รับเบี้ยเลี้ยงทหารและร่างกายฟิตขึ้น)',
              grants_flags: [...(ms.grants_flags || []), ...(opt.grants_flags_on_red || ['flag_conscript_soldier_2yrs'])],
              removes_flags: [],
              stat_effects: opt.stat_effects_on_red || { health: 8, happiness: -6, connections: 2, cash: 108000 },
              special_handler: 'conscript_red_card_2yrs'
            }
          };
        }

        return {
          choice_id: opt.option_id,
          label_th: `${opt.name_th} — ${opt.description_th}`,
          hint_th: buildCleanHintFromEffects(opt.stat_effects),
          req_stats: {},
          req_flags: opt.req_flags || [],
          grants_flags: [...(ms.grants_flags || []), ...(opt.grants_flags || [])],
          removes_flags: [],
          stat_effects: opt.stat_effects || {},
          special_handler: opt.option_id === 'opt_volunteer_soldier' ? 'conscript_volunteer_1yr' : null
        };
      });

      cards.push(
        normalizeEventCard(
          {
            event_id: eventId,
            title_th: ms.name_th,
            description_th: ms.description_th,
            source_type: 'milestone',
            category: 'milestone',
            iconKey: 'shield',
            choices: draftChoices
          },
          'milestone',
          'shield'
        )
      );
      continue;
    }

    // 2.5 อายุ 25 ปี: อาถรรพ์วัยเบญจเพส (ประเมินค่า merit >= 50 หรือ < 50)
    if (ms.milestone_id === 'ms_benjapes_crisis') {
      const currentMerit = Number(state.stats.merit || 0);
      const isGoodBenjapes = currentMerit >= 50;

      cards.push(
        normalizeEventCard(
          {
            event_id: eventId,
            title_th: ms.name_th,
            description_th: isGoodBenjapes
              ? `${ms.description_th} — แต้มบุญสะสมของคุณสูงถึง ${currentMerit} แต้ม อานิสงส์หนุนนำให้วัยเบญจเพสกลายเป็นปีทองแห่งโชคลาภ!`
              : `${ms.description_th} — แต้มบุญสะสมของคุณอยู่ที่ ${currentMerit} แต้ม (ต่ำกว่าเกณฑ์ 50) ดวงชะตาแปรปรวนเสี่ยงเจอเรื่องไม่คาดฝัน!`,
            source_type: 'milestone',
            category: isGoodBenjapes ? 'milestone' : 'road_accident',
            iconKey: isGoodBenjapes ? 'sparkle' : 'alert',
            choices: isGoodBenjapes
              ? [
                  {
                    choice_id: 'c1',
                    label_th: 'น้อมรับโชคใหญ่เบญจเพส! ได้รับทรัพย์ก้อนโตและโอกาสก้าวหน้าในชีวิต',
                    hint_th: 'เงินโชคลาภ +25,000 ฿ , ความสุข +10 , เส้นสาย +5',
                    req_stats: {},
                    req_flags: [],
                    grants_flags: ms.grants_flags || ['flag_survived_benjapes'],
                    removes_flags: [],
                    stat_effects: { happiness: 10, connections: 5, cash: 25000, merit: 5 }
                  }
                ]
              : [
                  {
                    choice_id: 'c1',
                    label_th: 'รีบเข้าวัดทำบุญสะเดาะเคราะห์ชุดใหญ่ ผ่อนหนักให้เป็นเบา (-3,000฿)',
                    hint_th: 'เงิน -3,000 ฿ , แต้มบุญ +12 , สุขภาพ -2',
                    req_stats: {},
                    req_flags: [],
                    grants_flags: ms.grants_flags || ['flag_survived_benjapes'],
                    removes_flags: [],
                    stat_effects: { health: -2, happiness: 1, cash: -3000, merit: 12 }
                  },
                  {
                    choice_id: 'c2',
                    label_th: 'ฝืนชะตาเบญจเพสโดยไม่ระวังตัว เจอเรื่องซวยเสียทรัพย์และเจ็บตัว!',
                    hint_th: 'สุขภาพ -15 , ความสุข -8 , เงิน -12,000 ฿',
                    req_stats: {},
                    req_flags: [],
                    grants_flags: ms.grants_flags || ['flag_survived_benjapes'],
                    removes_flags: [],
                    stat_effects: { health: -15, happiness: -8, cash: -12000 }
                  }
                ]
          },
          'milestone',
          isGoodBenjapes ? 'sparkle' : 'alert'
        )
      );
      continue;
    }

    // 2.6 อายุ 40 ปี: คัดกรองโรคเรื้อรังวัยกลางคน
    if (ms.milestone_id === 'ms_midlife_health_check') {
      const hp = Number(state.stats.health || 0);
      const isUnhealthy = hp < 50;
      const extraIllnessFlags = isUnhealthy ? ['status_hypertension'] : [];

      cards.push(
        normalizeEventCard(
          {
            event_id: eventId,
            title_th: ms.name_th,
            description_th: isUnhealthy
              ? `${ms.description_th} — เนื่องจากสุขภาพสะสมของคุณต่ำกว่าเกณฑ์ (${hp}/100) แพทย์จึงตรวจพบภาวะความดันโลหิตสูงเริ่มต้น!`
              : `${ms.description_th} — ผลตรวจร่างกายของคุณแข็งแรงดีตามเกณฑ์ (${hp}/100) รอดพ้นจากโรคเรื้อรัง!`,
            source_type: 'milestone',
            category: 'milestone',
            iconKey: 'hospital',
            choices: [
              {
                choice_id: 'c1',
                label_th: isUnhealthy
                  ? 'รับทราบผลตรวจและปรับพฤติกรรมการใช้ชีวิตในวัยกลางคน'
                  : 'ดูแลสุขภาพอย่างต่อเนื่องก้าวสู่วัยกลางคนอย่างมั่นใจ',
                hint_th: isUnhealthy
                  ? 'สุขภาพ -2 , สมอง +1 , ติดสถานะ [ความดันโลหิตสูง]'
                  : 'สุขภาพ +2 , ความสุข +3 , สมอง +1',
                req_stats: {},
                req_flags: [],
                grants_flags: [...(ms.grants_flags || ['flag_midlife_stage']), ...extraIllnessFlags],
                removes_flags: [],
                stat_effects: isUnhealthy
                  ? (ms.stat_effects || { health: -2, intelligence: 1, connections: 1 })
                  : { health: 2, happiness: 3, intelligence: 1, connections: 1 }
              }
            ]
          },
          'milestone',
          'hospital'
        )
      );
      continue;
    }

    // 2.7 หมุดหมายมาตรฐานอื่นๆ (อายุ 12 จบ ป.6, อายุ 18 สอบ TCAS, อายุ 20 บรรลุนิติภาวะ, อายุ 60 เกษียณอายุ)
    cards.push(
      normalizeEventCard(
        {
          event_id: eventId,
          title_th: ms.name_th,
          description_th: ms.description_th,
          source_type: 'milestone',
          category: 'milestone',
          iconKey: ms.milestone_id === 'ms_retirement_gate' ? 'trophy' : 'flag',
          choices: [
            {
              choice_id: 'c1',
              label_th: `ก้าวสู่หมุดหมายสำคัญ: ${ms.name_th}`,
              hint_th: buildCleanHintFromEffects(ms.stat_effects),
              req_stats: {},
              req_flags: [],
              grants_flags: ms.grants_flags || [],
              removes_flags: ms.milestone_id === 'ms_tcas_university_entrance' ? ['flag_high_school_student'] : [],
              stat_effects: ms.stat_effects || {},
              special_handler: ms.milestone_id === 'ms_retirement_gate' ? 'retire_main_career_at_60' : null
            }
          ]
        },
        'milestone',
        'flag'
      )
    );
  }

  return cards;
}

/**
 * สร้างการ์ดเลือกนโยบายเลี้ยงดูลูกเมื่อลูกมีอายุแตะเกณฑ์ 0, 6, 12, 18 ปี
 * @param {object} state
 * @returns {Array<object>}
 */
export function buildChildPolicyEventCards(state) {
  const children = state.relationships?.children || [];
  if (children.length === 0) return [];

  const policies = db.raw.npcs?.child_upbringing_policies || [];
  const cards = [];

  for (const child of children) {
    const childAge = Number(child.age ?? 0);
    const stageDef = policies.find((p) => Number(p.trigger_child_age) === childAge);
    if (!stageDef) continue;

    // ป้องกันการถามซ้ำในปีเดียวกันสำหรับลูกคนเดิม
    if (child.currentStageId === stageDef.stage_id) continue;

    const choices = (stageDef.policy_options || []).map((opt) => ({
      choice_id: opt.option_id,
      label_th: `${opt.name_th} — ${opt.description_th}`,
      hint_th: `ค่าใช้จ่ายรายปี ${formatCurrency(-opt.annual_auto_cost_cash)}/ปี , แต้มอนาคตลูก +${opt.annual_child_success_points}/ปี , ความสัมพันธ์ลูก ${opt.annual_child_rel_change >= 0 ? `+${opt.annual_child_rel_change}` : opt.annual_child_rel_change}/ปี`,
      req_stats: {},
      req_flags: [],
      grants_flags: [],
      removes_flags: [],
      stat_effects: {},
      special_handler: 'set_child_upbringing_policy',
      handler_payload: {
        childId: child.id,
        stageId: stageDef.stage_id,
        policyId: opt.option_id
      }
    }));

    cards.push(
      normalizeEventCard(
        {
          event_id: `evt_child_pol_${child.id}_age${childAge}`,
          title_th: `${stageDef.prompt_title_th} (${child.name})`,
          description_th: `ลูกของคุณ (${child.name}) อายุครบ ${childAge} ปี เข้าสู่ "${stageDef.stage_name_th}" กรุณาเลือกแนวทางการส่งเสริมอนาคตให้ลูก`,
          source_type: 'child_policy',
          category: 'children_parenting',
          target_child_id: child.id,
          iconKey: 'family',
          choices
        },
        'child_policy',
        'family'
      )
    );
  }

  return cards;
}

/**
 * ทอยสุ่มเหตุการณ์ความเสี่ยง/บทลงโทษกฎหมาย/วิกฤตชีวิต/ดราม่าคู่สมรส (คืนค่าสูงสุดไม่เกิน 1 ใบต่อปี)
 * @param {object} state
 * @returns {object|null} Normalized Event Card หรือ null
 */
export function rollPenaltyOrCrisisOrSpouseEvent(state) {
  const age = Number(state.profile.age || 0);
  const activeFlags = getPlayerFlagSet(state);
  const candidates = [];

  // 1. ตรวจสอบวิกฤตการณ์ใหญ่จาก 9_Loans_Crises_&_Endings.json
  const crisisList = db.raw.loansCrisesEndings?.rng_risk_and_crisis_events || [];
  for (const cr of crisisList) {
    if (age < Number(cr.min_age || 0) || age > Number(cr.max_age ?? 100)) continue;
    if (
      !checkRequirement(null, [], state, {
        reqAnyFlags: cr.req_any_flags || [],
        forbiddenFlags: cr.forbidden_flags || []
      })
    ) {
      continue;
    }

    if (rollChance(Number(cr.annual_trigger_chance_percent || 0))) {
      const cat = cr.event_id === 'evt_crisis_01_heavy_road_accident' ? 'road_accident' : 'crisis';
      candidates.push(
        normalizeEventCard(
          {
            ...cr,
            source_type: 'crisis',
            category: cat,
            iconKey: 'alert'
          },
          'crisis',
          'alert'
        )
      );
    }
  }

  // 2. ตรวจสอบบทลงโทษทำผิดกฎหมายจาก Milestones_&_Licenses.json (เช่น ขี่รถไม่มีใบขับขี่ / แผงลอยเถื่อน)
  const penalties = db.raw.milestones?.illegal_bypass_penalties || [];
  for (const pen of penalties) {
    const hasRequiredActiveFlags = (pen.active_when_has_flags || []).every((f) => activeFlags.has(f));
    const isMissingRequiredFlags = (pen.active_when_missing_flags || []).every((f) => !activeFlags.has(f));
    if (!hasRequiredActiveFlags || !isMissingRequiredFlags) continue;

    if (rollChance(Number(pen.annual_trigger_chance_percent || 0))) {
      const fineCash = randomInt(
        Math.min(pen.cash_penalty_min, pen.cash_penalty_max),
        Math.max(pen.cash_penalty_min, pen.cash_penalty_max)
      );
      const mergedEffects = { ...(pen.stat_effects || {}), cash: fineCash };
      const isDraftEvasion = pen.penalty_id === 'penalty_military_draft_evasion';

      candidates.push(
        normalizeEventCard(
          {
            event_id: `evt_${pen.penalty_id}_age${age}`,
            title_th: pen.event_title_th || pen.name_th,
            description_th: pen.description_th,
            source_type: 'illegal_penalty',
            category: 'legal_penalty',
            iconKey: 'alert',
            choices: [
              {
                choice_id: 'c1',
                label_th: `ยอมรับใบสั่งและชำระค่าปรับตามกฎหมาย (${formatCurrency(fineCash)})`,
                hint_th: buildCleanHintFromEffects(pen.stat_effects, fineCash),
                req_stats: {},
                req_flags: [],
                grants_flags: pen.grants_flags || [],
                removes_flags: [],
                stat_effects: mergedEffects,
                special_handler: isDraftEvasion ? 'conscript_red_card_2yrs' : null
              }
            ]
          },
          'illegal_penalty',
          'alert'
        )
      );
    }
  }

  // 3. ตรวจสอบดราม่าคู่สมรสระหว่างปีจาก NPC_&_Relationships.json
  const partner = state.relationships?.partner;
  if (partner && (partner.status === 'married' || activeFlags.has('flag_married_registered')) && partner.financialTraitId) {
    const spTrait = db.indexes.spouseTraits.get(partner.financialTraitId);
    const drama = spTrait?.mid_year_drama_event;
    if (drama && rollChance(Number(spTrait.annual_trigger_chance_percent || 0))) {
      const dramaChoices = (drama.choices || []).map((dc, idx) => {
        const cashFx = Number(dc.cash_effect || 0);
        const mergedStats = { ...(dc.stat_effects || {}), cash: cashFx };
        return {
          choice_id: `c${idx + 1}`,
          label_th: dc.choice_label_th,
          hint_th: buildCleanHintFromEffects(dc.stat_effects, cashFx),
          req_stats: {},
          req_flags: dc.req_flags || [],
          grants_flags: [],
          removes_flags: [],
          relationship_change: Number(dc.relationship_change || 0),
          stat_effects: mergedStats
        };
      });

      candidates.push(
        normalizeEventCard(
          {
            event_id: `${drama.event_id}_age${age}`,
            title_th: drama.title_th,
            description_th: drama.description_th,
            source_type: 'spouse_drama',
            category: 'romance_married',
            iconKey: 'heart',
            choices: dramaChoices
          },
          'spouse_drama',
          'heart'
        )
      );
    }
  }

  if (candidates.length === 0) return null;

  // หากติดวิกฤตใหญ่ ให้ความสำคัญวิกฤตก่อน มิฉะนั้นสุ่ม 1 ใบเพื่อไม่ให้ซวยซ้ำซ้อนเกิน 1 ใบต่อปี
  const highPriorityCrisis = candidates.find((c) => c.source_type === 'crisis');
  return highPriorityCrisis || pickRandom(candidates);
}

// ============================================================================
// 3. ระบบตรวจเงื่อนไขและสุ่มผสมถังอีเวนต์ประจำปี (Weighted Pool Mixing)
// ============================================================================

const PARTNER_SPEC_ARCHETYPE_MAP = {
  evt_partner_spec_01_sweetheart: 'partner_highschool_sweetheart',
  evt_partner_spec_02_rider: 'partner_rider_factory_worker',
  evt_partner_spec_03_civil: 'partner_civil_servant',
  evt_partner_spec_04_seller: 'partner_online_seller',
  evt_partner_spec_05_influencer: 'partner_social_influencer',
  evt_partner_spec_06_crypto: 'partner_crypto_trader',
  evt_partner_spec_07_doctor: 'partner_medical_doctor',
  evt_partner_spec_08_tycoon: 'partner_tycoon_heir'
};

/**
 * ตรวจสอบว่าผู้เล่นถือครองอาชีพที่ตรงกับ req_job_id (รวมถึง Wildcard ประจำสายงาน) หรือไม่
 */
function matchesRequiredJob(reqJobId, state) {
  if (!reqJobId) return true;

  const heldIds = [state.careerAndEdu?.mainJobId, state.careerAndEdu?.partTimeJobId].filter(Boolean);
  if (heldIds.length === 0) return false;
  if (heldIds.includes(reqJobId)) return true;

  const heldJobs = heldIds.map((id) => db.getJob(id)).filter(Boolean);

  if (reqJobId === 'any_part_time_or_gig') {
    return heldJobs.some((j) => j.job_category === 'part_time_gig');
  }
  if (reqJobId === 'any_corporate_career') {
    return heldJobs.some((j) => j.job_category === 'corporate');
  }
  if (reqJobId === 'any_gov_or_business_career') {
    return heldJobs.some((j) => j.job_category === 'civil_service' || j.job_category === 'business');
  }

  return false;
}

/**
 * ตรวจสอบว่าอีเวนต์จากคลังตรงตามเงื่อนไขของผู้เล่นในปัจจุบันหรือไม่
 * @param {object} evt อีเวนต์จาก JSON
 * @param {object} state GameState ปัจจุบัน
 * @param {object} [options={}]
 * @param {number} [options.ageWindowTolerance=0] ระยะยืดหยุ่นอายุสำหรับ trigger_age กรณีอีเวนต์ปีนั้นหมดถัง
 * @param {boolean} [options.ignoreTriggeredHistory=false] ข้ามการเช็กประวัติซ้ำ (สำหรับการ revalidate อีเวนต์ที่อยู่ในคิวแล้ว)
 * @returns {boolean}
 */
export function isEventEligible(evt, state, options = {}) {
  if (!evt || !state) return false;

  if (Array.isArray(evt.referencedNpcIds) && evt.referencedNpcIds.some((id) => {
    const npc = (state.relationships?.npcs || []).find((person) => person.id === id) ||
      (state.relationships?.partner?.id === id ? state.relationships.partner : null);
    return !npc || npc.isAlive === false || npc.unavailable;
  })) return false;

  const { ageWindowTolerance = 0, ignoreTriggeredHistory = false } = options;

  // 1. ห้ามซ้ำกับอีเวนต์ที่เคยเกิดขึ้นแล้วในชีวิตนี้
  if (!ignoreTriggeredHistory && (state.turn?.triggeredEventIdsThisLife || []).includes(evt.event_id)) {
    return false;
  }

  // สำหรับการ์ดระบบที่สร้างขึ้นสด (Milestone / Crisis / Penalty / Child Policy) ข้ามการเช็กช่วงอายุของ Pool ปกติ
  if (
    evt.source_type &&
    ['milestone', 'child_policy', 'crisis', 'illegal_penalty', 'spouse_drama'].includes(evt.source_type)
  ) {
    return checkRequirement(null, evt.req_flags || [], state, {
      reqAnyFlags: evt.req_any_flags || [],
      forbiddenFlags: evt.forbidden_flags || []
    });
  }

  const age = Number(state.profile.age ?? 0);

  // 2. เช็กช่วงอายุ: trigger_age (Phase 1-6) หรือ min_age..max_age
  if (evt.trigger_age !== undefined && evt.trigger_age !== null) {
    const diff = Math.abs(age - Number(evt.trigger_age));
    if (diff > ageWindowTolerance) return false;
  } else {
    if (evt.min_age !== undefined && age < Number(evt.min_age)) return false;
    if (evt.max_age !== undefined && age > Number(evt.max_age)) return false;
  }

  // 3. เช็กชนชั้นทางสังคมปัจจุบัน (allowed_classes)
  if (Array.isArray(evt.allowed_classes) && evt.allowed_classes.length > 0) {
    const cls = state.profile.currentClassId || state.profile.spawnClassId;
    if (cls && !evt.allowed_classes.includes(cls)) return false;
  }

  // 4. เช็กเงื่อนไขอาชีพ (req_job_id)
  if (evt.req_job_id && !matchesRequiredJob(evt.req_job_id, state)) {
    return false;
  }

  // 5. เช็กเงื่อนไขจังหวัด (req_location_id)
  if (evt.req_location_id && evt.req_location_id !== 'any') {
    if (state.profile.currentLocationId !== evt.req_location_id) return false;
  }

  // 6. เช็กเงื่อนไข NPC เป้าหมายในครอบครัว/เพื่อน (target_npc_archetype)
  if (evt.target_npc_archetype) {
    const hasAliveNpc = (state.relationships?.npcs || []).some(
      (n) => n.archetypeId === evt.target_npc_archetype && n.isAlive !== false
    );
    if (!hasAliveNpc) return false;
  }

  // 7. เช็กความสอดคล้องของคนรักและลูกสำหรับไฟล์ Events_Rel_Romance_&_Children
  if (evt.category === 'romance_flirting') {
    const activeFlags = getPlayerFlagSet(state);
    if (activeFlags.has('flag_monkhood_active')) return false;
    // หากยังไม่เคยมีคนคุย/แฟนใน state.relationships.partner ให้เฉพาะอีเวนต์เริ่มต้นจีบหรืออีเวนต์ที่มีแฟนแล้วตามป้าย
    if (!state.relationships?.partner && (evt.req_flags || []).includes('flag_in_relationship')) {
      return false;
    }
  }

  if (evt.category === 'partner_specific') {
    const partner = state.relationships?.partner;
    if (!partner) return false;
    const expectedArch = PARTNER_SPEC_ARCHETYPE_MAP[evt.event_id];
    if (expectedArch && partner.archetypeId && partner.archetypeId !== expectedArch) {
      return false;
    }
  }

  if (evt.category === 'children_parenting') {
    if (!Array.isArray(state.relationships?.children) || state.relationships.children.length === 0) {
      return false;
    }
  }

  // 8. เช็กเงื่อนไขแต้มบุญเฉพาะทางสำหรับ evt_karma_22 (แต้มบุญทะลุ 100 แต้ม)
  if (evt.event_id === 'evt_karma_22' && Number(state.stats?.merit || 0) < 100) {
    return false;
  }

  // 9. เช็ก req_flags, req_any_flags, forbidden_flags ผ่านฟังก์ชันมาตรฐานใน utils.js
  return checkRequirement(null, evt.req_flags || [], state, {
    reqAnyFlags: evt.req_any_flags || [],
    forbiddenFlags: evt.forbidden_flags || []
  });
}

/**
 * ดึงรายการอีเวนต์ที่ผ่านเกณฑ์จากถังที่ระบุ (life_phase / career / relationship / location_karma)
 */
function getEligibleEventsFromBucket(bucketId, state, excludeIdsSet) {
  const flexYears = Number(db.raw.loansCrisesEndings?.event_pool_mixing_rules?.age_window_flexibility_years ?? 2);

  let poolKeys = [];
  if (bucketId === 'life_phase') {
    poolKeys = ['eventsPhase1', 'eventsPhase2', 'eventsPhase3', 'eventsPhase4', 'eventsPhase5', 'eventsPhase6'];
  } else if (bucketId === 'career') {
    poolKeys = ['eventsJobsGig', 'eventsJobsCorp', 'eventsJobsGovBiz'];
  } else if (bucketId === 'relationship') {
    poolKeys = ['eventsRelFamily', 'eventsRelRomance'];
  } else if (bucketId === 'location_karma') {
    poolKeys = ['eventsLocKarma'];
  }

  const rawEvents = [];
  for (const key of poolKeys) {
    const list = db.raw[key]?.events || [];
    for (const e of list) {
      if (!excludeIdsSet.has(e.event_id)) {
        rawEvents.push(e);
      }
    }
  }

  // รอบแรก: คัดกรองตรงอายุเป๊ะ (ageWindowTolerance = 0)
  let eligible = rawEvents.filter((e) => isEventEligible(e, state, { ageWindowTolerance: 0 }));

  // รอบสำรองสำหรับถัง life_phase: หากปีนั้นไม่มีอีเวนต์ตรงอายุ (เช่น วัยชราบางปีที่เว้นเลขปีคี่) ให้ยืดหยุ่น +-2 ปีตามกฎ JSON
  if (eligible.length === 0 && bucketId === 'life_phase') {
    eligible = rawEvents.filter((e) => isEventEligible(e, state, { ageWindowTolerance: flexYears }));
  }

  return eligible;
}

/**
 * ระบุ iconKey ตามหมวดหมู่ของอีเวนต์ทั่วไป
 */
function resolveBucketIconKey(bucketId, evt) {
  if (bucketId === 'career') return 'work';
  if (bucketId === 'relationship') {
    return String(evt.category || '').includes('romance') ? 'heart' : 'users';
  }
  if (bucketId === 'location_karma') {
    return evt.category === 'karma_merit' ? 'sparkle' : 'map_pin';
  }
  return 'calendar';
}

/**
 * สร้างคิวอีเวนต์ประจำปี (1-3+ ใบ) จัดเรียงเดือนไทย และบันทึกลง state.turn.pendingEvents
 * @param {object} state GameState ปัจจุบัน
 * @returns {Array<object>} คิวอีเวนต์ประจำปีที่จัดเดือนเรียบร้อยแล้ว
 */
/**
 * Resolve default and Life Path-adjusted annual event pool weights.
 * Every pool remains eligible; the path only changes relative draw chance.
 */
export function getAnnualEventPoolWeights(state){
 const r=db.raw.loansCrisesEndings?.event_pool_mixing_rules?.pool_weights_percent||{};
 return getLifePathPoolWeights(state?.profile?.lifePathId,{
  life_phase:Number(r.life_phase_pool_8_1_to_8_6??40),
  career:Number(r.career_and_job_pool_8_7_to_8_9??30),
  relationship:Number(r.relationship_pool_8_10_to_8_11??15),
  location_karma:Number(r.location_and_karma_pool_8_12??15)
 });
}

function createAnnualMinimumFallbackCard(age, existingIds = new Set()) {
  let eventId = `evt_annual_minimum_${age}`;
  let suffix = 1;
  while (existingIds.has(eventId)) eventId = `evt_annual_minimum_${age}_${suffix++}`;

  existingIds.add(eventId);
  return normalizeEventCard(
    {
      event_id: eventId,
      title_th: 'เรื่องเล็ก ๆ ที่ทำให้ปีนี้ไม่ธรรมดา',
      description_th: 'ระหว่างปีมีเรื่องราวเล็กน้อยเกิดขึ้น เปิดโอกาสให้คุณเลือกวิธีรับมือและกำหนดจังหวะชีวิตของตัวเอง',
      source_type: 'annual_fallback',
      category: 'shared',
      choices: [
        {
          choice_id: 'c1',
          label_th: 'ใช้โอกาสนี้ลองทำสิ่งใหม่อย่างค่อยเป็นค่อยไป',
          stat_effects: { happiness: 1, intelligence: 1 },
          req_stats: {}, req_flags: [], grants_flags: [], removes_flags: []
        },
        {
          choice_id: 'c2',
          label_th: 'รักษาสิ่งที่ทำได้ดีอยู่แล้วและดูแลตัวเองให้พร้อม',
          stat_effects: { health: 1, happiness: 1 },
          req_stats: {}, req_flags: [], grants_flags: [], removes_flags: []
        }
      ]
    },
    'annual_fallback',
    'calendar'
  );
}

export function buildAnnualEventQueue(state) {
  if (!state || !state.turn) return [];

  const age = Number(state.profile.age || 0);
  const rawQueue = [];
  const selectedIds = new Set();

  // --- Slot 1 (บังคับ): Milestone ประจำอายุ + นโยบายเลี้ยงดูลูก ---
  const milestoneCards = buildMilestoneEventCards(state);
  for (const card of milestoneCards) {
    rawQueue.push(card);
    selectedIds.add(card.event_id);
  }

  const childPolicyCards = buildChildPolicyEventCards(state);
  for (const card of childPolicyCards) {
    rawQueue.push(card);
    selectedIds.add(card.event_id);
  }

  // --- Slot 2 (ความเสี่ยง): ใบสั่งกฎหมาย / วิกฤตการณ์ / ดราม่าคู่สมรส (สูงสุด 1 ใบ) ---
  const riskCard = rollPenaltyOrCrisisOrSpouseEvent(state);
  if (riskCard && !selectedIds.has(riskCard.event_id)) {
    rawQueue.push(riskCard);
    selectedIds.add(riskCard.event_id);
  }

  // --- Slot 3 (ชีวิตประจำปีจากคลัง 12 ไฟล์ ตามระบบ Weighted Pool Mixing) ---
  // อายุ 0-12 หรือ 60+: ดึง 1 ใบ | อายุ 13-59: ดึง 2 ใบจากคนละหมวดถัง (ยกเว้นมีใบพิเศษเยอะเกินแล้วจะคุมให้ลื่นไหล)
  const targetPoolDraws = age >= 13 && age <= 59 ? 2 : 1;

  const w=getAnnualEventPoolWeights(state);
  let availableBuckets=[
    {id:'life_phase',weight:w.life_phase},{id:'career',weight:w.career},
    {id:'relationship',weight:w.relationship},{id:'location_karma',weight:w.location_karma}
  ];

  // วัยทารก (0-4 ปี) บังคับดึงจากถังช่วงวัยเป็นหลักเพื่อให้สอดคล้องพัฒนาการทารก
  if (age <= 4) {
    availableBuckets = [{ id: 'life_phase', weight: 100 }];
  }

  const usedBuckets = new Set();

  for (let i = 0; i < targetPoolDraws; i++) {
    const remainingBucketDefs = availableBuckets.filter((b) => !usedBuckets.has(b.id));
    if (remainingBucketDefs.length === 0) break;

    const chosenBucketObj = weightedRandom(remainingBucketDefs, 'weight') || remainingBucketDefs[0];
    let pickedBucketId = chosenBucketObj.id;
    let poolCandidates = getEligibleEventsFromBucket(pickedBucketId, state, selectedIds);

    // Fallback ลำดับศักดิ์: หากถังที่สุ่มได้ว่างเปล่า (เช่น ยังไม่มีงานทำ) ให้ถอยไปดึงจาก life_phase -> location_karma -> relationship
    if (poolCandidates.length === 0) {
      const fallbackOrder = shuffleArray(['life_phase', 'location_karma', 'relationship', 'career']).sort((a, b) =>
        a === 'life_phase' ? -1 : b === 'life_phase' ? 1 : 0
      );

      for (const fbId of fallbackOrder) {
        if (usedBuckets.has(fbId) && targetPoolDraws > 1) continue;
        const fbCandidates = getEligibleEventsFromBucket(fbId, state, selectedIds);
        if (fbCandidates.length > 0) {
          pickedBucketId = fbId;
          poolCandidates = fbCandidates;
          break;
        }
      }
    }

    if (poolCandidates.length > 0) {
      const chosenEvt = pickRandom(poolCandidates);
      usedBuckets.add(pickedBucketId);
      selectedIds.add(chosenEvt.event_id);

      rawQueue.push(
        normalizeEventCard(
          {
            ...chosenEvt,
            source_type: 'pool_event',
            pool_bucket: pickedBucketId
          },
          'pool_event',
          resolveBucketIconKey(pickedBucketId, chosenEvt)
        )
      );
    }
  }

  // Fallback การันตีขั้นสุดท้าย: ใน 1 ปีต้องมีอย่างน้อย 1 อีเวนต์เสมอแม้เล่นซ้ำจนการ์ดหมดถัง
  if (rawQueue.length === 0) {
    const emergencyPool = (age <= 4
      ? getEligibleEventsFromBucket('life_phase', state, selectedIds)
      : [
          ...(db.raw.eventsLocKarma?.events || []),
          ...Array.from(db.indexes.events.values())
        ].filter((e) => isEventEligible(e, state, { ageWindowTolerance: 5, ignoreTriggeredHistory: true }))
    );

    const fallbackEvt = pickRandom(emergencyPool);
    if (fallbackEvt) {
      selectedIds.add(fallbackEvt.event_id);
      rawQueue.push(
        normalizeEventCard(
          { ...fallbackEvt, source_type: 'pool_event', pool_bucket: age <= 4 ? 'life_phase' : 'fallback' },
          'pool_event',
          age <= 4 ? resolveBucketIconKey('life_phase', fallbackEvt) : 'sparkle'
        )
      );
    } else {
      // กรณีฉุกเฉินสุดขีด สร้างการ์ดปีแห่งความสงบสุข
      rawQueue.push(
        normalizeEventCard(
          {
            event_id: `evt_peaceful_year_${age}`,
            title_th: 'ปีแห่งความเรียบง่ายและทบทวนจังหวะชีวิต',
            description_th: 'ตลอดปีที่ผ่านมา ชีวิตดำเนินไปอย่างราบรื่นไร้คลื่นลมรุนแรง เปิดโอกาสให้คุณได้ดูแลสุขภาพกายใจและวางแผนก้าวต่อไป',
            source_type: 'fallback_peaceful',
            category: 'shared',
            iconKey: 'smile',
            choices: [
              {
                choice_id: 'c1',
                label_th: 'พักผ่อนชาร์จพลังกายใจให้พร้อมสำหรับก้าวต่อไป',
                hint_th: 'สุขภาพ +2 , ความสุข +3',
                req_stats: {},
                req_flags: [],
                grants_flags: [],
                removes_flags: [],
                stat_effects: { health: 2, happiness: 3 }
              }
            ]
          },
          'fallback_peaceful',
          'smile'
        )
      );
    }
  }

  // ตั้งแต่อายุ 1 ปีขึ้นไป ต้องมีอย่างน้อย 2 เหตุการณ์ให้ตัดสินใจในแต่ละปี
  // เติมจาก Event Pool ที่ยังไม่เคยเกิดก่อน หากหมดจริงจึงใช้การ์ดเหตุการณ์สำรอง
  if (age > 0 && rawQueue.length < 2) {
    const flexYears = Number(db.raw.loansCrisesEndings?.event_pool_mixing_rules?.age_window_flexibility_years ?? 2);
    const supplementalPool = age <= 4
      ? getEligibleEventsFromBucket('life_phase', state, selectedIds)
      : Array.from(db.indexes.events.values()).filter((event) =>
          !selectedIds.has(event.event_id) &&
          isEventEligible(event, state, { ageWindowTolerance: flexYears })
        );
    const supplementalEvent = pickRandom(supplementalPool);

    if (supplementalEvent) {
      selectedIds.add(supplementalEvent.event_id);
      const supplementBucket = age <= 4 ? 'life_phase' : 'annual_minimum';
      rawQueue.push(
        normalizeEventCard(
          { ...supplementalEvent, source_type: 'pool_event', pool_bucket: supplementBucket },
          'pool_event',
          resolveBucketIconKey(supplementBucket === 'annual_minimum' ? 'life_phase' : supplementBucket, supplementalEvent)
        )
      );
    }

    // รับประกันขั้นต่ำแม้ผู้เล่นใช้ Event Pool จนหมด โดยไม่เล่น Event เก่าซ้ำ
    if (rawQueue.length < 2) {
      rawQueue.push(createAnnualMinimumFallbackCard(age, selectedIds));
    }
  }

  const curated = buildCuratedLegacyTemplates(db.raw).filter((template) =>
    isEventEligible(template.legacyEvent, state)
  );
  for (const template of selectRandomEvents(state, [...RANDOM_EVENT_TEMPLATES, ...curated], selectedIds)) {
    rawQueue.push(normalizeEventCard(toLegacyEventCard(template), 'random_event', 'sparkle'));
  }

  // จัดเรียงเดือนไทย 1-12 ให้สอดคล้องบริบทและไม่ย้อนกลับ
  const finalizedQueue = assignFlavorMonthsToQueue(rawQueue);

  state.turn.pendingEvents = finalizedQueue;
  state.turn.currentEventIndex = 0;
  state.turn.areTabsLocked = finalizedQueue.length > 0;
  state.turn.phase = finalizedQueue.length > 0 ? 'EVENT_QUEUE' : 'FREE_ACTION';

  maybeEnhanceRandomEventWithAi(state, normalizeEventCard);

  return finalizedQueue;
}

// ============================================================================
// 4. การดึงอีเวนต์ปัจจุบัน ตรวจสอบสถานะปุ่มช้อยส์ และประมวลผลตัวเลือก (RNG & Effects)
// ============================================================================

/**
 * สร้างคำอธิบายภาษาไทยว่าทำไมปุ่มตัวเลือกนี้ถึงถูกล็อก (ไร้ Emoji)
 */
function buildChoiceLockReasonTh(choice, state) {
  const missingReasons = [];

  if (choice.req_stats && typeof choice.req_stats === 'object') {
    for (const [statKey, reqVal] of Object.entries(choice.req_stats)) {
      const currentVal = getPlayerStatValue(state, statKey);
      if (currentVal < Number(reqVal)) {
        const statName =
          statKey === 'connections'
            ? db.getConnectionsLabelByAge(state.profile.age)
            : STAT_META[statKey]?.nameTh || statKey;
        missingReasons.push(`ต้องการ${statName}อย่างน้อย ${reqVal} (มี ${currentVal})`);
      }
    }
  }

  const activeFlags = getPlayerFlagSet(state);
  for (const flagId of choice.req_flags || []) {
    if (!activeFlags.has(flagId)) {
      const def = db.getTraitOrFlag(flagId);
      const flagName = def?.name_th || flagId;
      missingReasons.push(`ต้องมีป้าย [${flagName}]`);
    }
  }

  return missingReasons.join(' และ ');
}

/**
 * ซ่อมคิว Event ของ Save รุ่นเก่าที่มี Event เหลือในปีปัจจุบันไม่ถึงสองใบ
 * เรียกตอน Boot/Restore เท่านั้น ไม่ผูกกับการดึงการ์ด เพื่อไม่เปลี่ยนคิวของ test fixture หรือการเล่นปกติ
 */
export function ensureAnnualEventMinimum(state) {
  if (!state?.turn || state.turn.phase !== 'EVENT_QUEUE') return false;
  const age = Number(state.profile?.age || 0);
  const queue = Array.isArray(state.turn.pendingEvents) ? state.turn.pendingEvents : [];
  if (age <= 0 || queue.length >= 2) return false;

  const existingIds = new Set(queue.map((event) => event.event_id));
  while (queue.length < 2) {
    queue.push(createAnnualMinimumFallbackCard(age, existingIds));
  }
  state.turn.pendingEvents = queue;
  return true;
}

/**
 * ดึงอีเวนต์ใบปัจจุบันที่รอผู้เล่นตัดสินใจ พร้อม revalidate เงื่อนไขซ้ำและประเมินสถานะล็อกของแต่ละช้อยส์
 * @param {object} state
 * @returns {object|null} อีเวนต์ปัจจุบันพร้อมข้อมูล choices ที่คำนวณ isLocked แล้ว หรือ null ถ้าหมดคิว
 */
export function getCurrentPendingEvent(state) {
  if (!state?.turn || !Array.isArray(state.turn.pendingEvents)) return null;

  const queue = state.turn.pendingEvents;

  while (state.turn.currentEventIndex < queue.length) {
    const candidate = queue[state.turn.currentEventIndex];

    // Revalidate เผื่ออีเวนต์ใบก่อนหน้าทำให้สถานะเปลี่ยน (เช่น หย่ากับคู่สมรสไปแล้ว)
    const stillValid = isEventEligible(candidate, state, {
      ageWindowTolerance: 5,
      ignoreTriggeredHistory: true
    });

    if (!stillValid) {
      state.turn.currentEventIndex += 1;
      continue;
    }

    // ประเมินสถานะปุ่มของแต่ละตัวเลือก (isLocked, lockReasonTh, effectiveSuccessChance)
    const evaluatedChoices = (candidate.choices || []).map((ch) => {
      const unlocked = checkRequirement(ch.req_stats || {}, ch.req_flags || [], state);
      const lockReasonTh = unlocked ? '' : buildChoiceLockReasonTh(ch, state);

      // คำนวณโอกาสสำเร็จจริงกรณีเป็นอีเวนต์วิกฤตหรือมี rng_mechanic เพื่อให้ UI แสดง % ที่แม่นยำได้
      let effectiveSuccessChance = 100;
      let hasRngRoll = false;

      if (ch.rng_mechanic && ch.rng_mechanic.success_chance_percent !== undefined) {
        hasRngRoll = true;
        effectiveSuccessChance = clampStat(Number(ch.rng_mechanic.success_chance_percent), 1, 99);
      } else if (ch.base_success_chance_percent !== undefined && Number(ch.base_success_chance_percent) < 100) {
        hasRngRoll = Boolean(ch.on_fail);
        let bonus = 0;
        for (const [sKey, mult] of Object.entries(ch.stat_scaling_bonus || {})) {
          bonus += getPlayerStatValue(state, sKey) * Number(mult);
        }
        effectiveSuccessChance = clampStat(Math.round(Number(ch.base_success_chance_percent) + bonus), 5, 98);
      }

      return {
        ...ch,
        isLocked: !unlocked,
        lockReasonTh,
        lockIconKey: unlocked ? null : 'lock',
        hasRngRoll,
        effectiveSuccessChance
      };
    });

    // หากไม่มีตัวเลือกที่ใช้ได้ ให้เพิ่มตัวเลือกสำรองของระบบแทนการปลดล็อกตัวเลือกที่ติดเงื่อนไข
    // ตัวเลือกนี้ไม่มีผลต่อค่าสถานะ ธง หรือความสัมพันธ์ของผู้เล่น
    if (evaluatedChoices.length === 0 || evaluatedChoices.every((choice) => choice.isLocked)) {
      evaluatedChoices.push({
        choice_id: '__system_no_available_choice__',
        label_th: 'ดำเนินต่อโดยไม่มีตัวเลือกเพิ่มเติม',
        outcome_text_th: 'ไม่มีตัวเลือกที่ตรงตามเงื่อนไขในขณะนี้ จึงข้ามเหตุการณ์นี้โดยไม่เปลี่ยนแปลงสถานะ',
        stat_effects: {},
        grants_flags: [],
        removes_flags: [],
        isLocked: false,
        lockReasonTh: '',
        lockIconKey: null,
        hasRngRoll: false,
        effectiveSuccessChance: 100
      });
    }

    return {
      ...candidate,
      queuePosition: state.turn.currentEventIndex + 1,
      queueTotal: queue.length,
      choices: evaluatedChoices
    };
  }

  // กรณีไม่มีอีเวนต์เหลือในคิวแล้ว ปลดล็อกแท็บเข้าสู่ช่วง Free Action
  state.turn.areTabsLocked = false;
  state.turn.phase = 'FREE_ACTION';
  return null;
}

/**
 * ประมวลผล handler พิเศษของ Milestone / การเกณฑ์ทหาร / นโยบายลูก
 */
function executeSpecialChoiceHandler(state, handlerName, payload = {}) {
  if (!handlerName) return null;

  if (handlerName === 'smash_piggy_bank_age_7') {
    const res = smashPiggyBankAtAge7(state);
    return `ทุบกระปุกออมสินลูกหมู โอนเงินสะสม ${formatCurrency(res.transferredAmount)} เข้าบัญชีออมทรัพย์เรียบร้อยแล้ว!`;
  }

  if (handlerName === 'update_adult_title_prefix_15') {
    state.profile.titlePrefix = state.profile.gender === 'female' ? 'น.ส.' : 'นาย';
    return `เปลี่ยนคำนำหน้าบัตรประชาชนเป็น "${state.profile.titlePrefix}" อย่างเป็นทางการ`;
  }

  if (handlerName === 'conscript_red_card_2yrs') {
    state.careerAndEdu.conscriptionYearsLeft = 2;
    state.careerAndEdu.mainJobId = null;
    state.careerAndEdu.partTimeJobId = null;
    removeFlagFromState(state, 'flag_regular_income');
    return 'เข้าประจำการเป็นทหารกองเกิน 2 ปีเต็ม (พักสายอาชีพชั่วคราวระหว่างรับใช้ชาติ)';
  }

  if (handlerName === 'conscript_volunteer_1yr') {
    state.careerAndEdu.conscriptionYearsLeft = 1;
    state.careerAndEdu.mainJobId = null;
    state.careerAndEdu.partTimeJobId = null;
    return 'สมัครใจเข้าเป็นทหารกองประจำการ 1 ปี และปลดล็อกโควตาสอบนายสิบ';
  }

  if (handlerName === 'retire_main_career_at_60') {
    if (state.careerAndEdu?.mainJobId) {
      const mainJob = db.getJob(state.careerAndEdu.mainJobId);
      // ปลดเกษียณเฉพาะงานองค์กรหรือราชการที่มีอายุเกษียณ 60 ปี (ธุรกิจส่วนตัวยังทำต่อได้ถึง 75-85 ปี)
      if (mainJob && Number(mainJob.retirement_age ?? 60) <= 60) {
        state.careerAndEdu.mainJobId = null;
      }
    }
    return 'เข้าสู่วัยเกษียณอายุ 60 ปีบริบูรณ์ เริ่มรับเบี้ยยังชีพผู้สูงอายุและเปิดระบบพินัยกรรม';
  }

  if (handlerName === 'set_child_upbringing_policy' && payload?.childId) {
    const child = (state.relationships?.children || []).find((c) => c.id === payload.childId);
    if (child) {
      child.currentStageId = payload.stageId;
      child.currentPolicyId = payload.policyId;
      return `กำหนดนโยบายการเลี้ยงดูให้กับ "${child.name}" เรียบร้อยแล้ว`;
    }
  }

  return null;
}

/**
 * ระบุรหัสสาเหตุการเสียชีวิตเบื้องต้นเมื่อสุขภาพแตะ 0 หรืออายุครบ 100 ปี (สอดคล้องกับ 9_Loans_Crises_&_Endings.json)
 */
function evaluateImmediateDeathCauseId(state) {
  const age = Number(state.profile.age || 0);
  const hp = Number(state.stats.health || 0);
  const flags = getPlayerFlagSet(state);

  if (age >= 100 && hp > 0) return 'death_natural_centenarian';
  if (hp > 0) return null;

  if (age >= 70) return 'death_natural_old_age';
  if (state.turn?.lastEventCategory === 'road_accident') return 'death_road_accident';
  if (flags.has('flag_informal_shark_debt')) return 'death_loan_shark_violence';
  if (flags.has('flag_depression')) return 'death_depression_burnout';
  if (
    age < 70 &&
    (flags.has('status_hypertension') || flags.has('status_chronic_insomnia') || flags.has('status_office_syndrome'))
  ) {
    return 'death_cardiovascular_overwork';
  }
  return 'death_general_illness';
}

function buildChoiceOutcomeNarrativeTh(eventCard, choice, baseText, statDeltas, relationshipUpdate, rngRollInfo) {
  const eventTitle = stripEmojis(eventCard.title_th || 'เหตุการณ์นี้');
  const choiceLabel = stripEmojis(choice.label_th || 'แนวทางที่เลือก');
  const base = stripEmojis(baseText || '');
  const looksGeneric = !base ||
    /^คุณ(?:เลือก|ตัดสินใจเลือก|ตัดสินใจ):?/u.test(base) ||
    base.includes('สำเร็จตามเป้าหมาย') && base.length < 90;

  let opening = looksGeneric
    ? `หลังจากคุณเลือก “${choiceLabel}” ในเหตุการณ์ “${eventTitle}”`
    : base;

  const category = String(eventCard.category || eventCard.source_type || '').toLowerCase();
  let storyBeat;
  if (/romance|relationship|family|friend|partner|children_parenting|spouse/.test(category)) {
    storyBeat = 'ท่าทีและความสัมพันธ์ระหว่างคุณกับคนที่เกี่ยวข้องจึงเปลี่ยนไปจากเดิม';
  } else if (/career|job|work/.test(category) || eventCard.req_job_id) {
    storyBeat = 'การตัดสินใจครั้งนี้ส่งผลต่อจังหวะการทำงานและโอกาสที่คุณจะต้องรับมือในระยะต่อไป';
  } else if (/education|school|study/.test(category) || /เรียน|โรงเรียน|สอบ|มหาวิทยาลัย/.test(eventTitle)) {
    storyBeat = 'ประสบการณ์ครั้งนี้กลายเป็นส่วนหนึ่งของเส้นทางการเรียนรู้และการเติบโตของคุณ';
  } else if (/location|karma|travel/.test(category) || eventCard.req_location_id) {
    storyBeat = 'เหตุการณ์รอบตัวค่อย ๆ คลี่คลายตามทางที่คุณเลือก และทิ้งประสบการณ์ให้คุณนำไปใช้ต่อ';
  } else {
    storyBeat = 'สถานการณ์ตรงหน้าค่อย ๆ ดำเนินต่อไป และคนรอบข้างตอบสนองต่อการกระทำของคุณ';
  }

  const deltas = Object.values(statDeltas || {}).map(Number).filter((value) => Number.isFinite(value) && value !== 0);
  const hasPositive = deltas.some((value) => value > 0);
  const hasNegative = deltas.some((value) => value < 0);
  let consequence;
  if (relationshipUpdate?.delta > 0) {
    consequence = 'ความสัมพันธ์ได้รับการประคับประคองไปในทางที่ดีขึ้น';
  } else if (relationshipUpdate?.delta < 0) {
    consequence = 'ความสัมพันธ์มีระยะห่างหรือความตึงเครียดเพิ่มขึ้น';
  } else if (hasPositive && hasNegative) {
    consequence = 'ผลที่ตามมามีทั้งด้านที่ช่วยให้คุณเดินหน้าและด้านที่ต้องแลกหรือรับมือ';
  } else if (hasPositive) {
    consequence = 'ทางเลือกนี้ส่งผลในด้านที่เป็นประโยชน์กับคุณ';
  } else if (hasNegative || (rngRollInfo && !rngRollInfo.isSuccess)) {
    consequence = 'ผลลัพธ์ไม่เป็นไปตามที่หวัง และทำให้คุณต้องรับมือกับข้อจำกัดที่เกิดขึ้น';
  } else if ((choice.grants_flags || []).length || (choice.removes_flags || []).length) {
    consequence = 'การตัดสินใจครั้งนี้ยังเปลี่ยนสถานะหรือเปิดโอกาสใหม่ให้กับเส้นทางชีวิตของคุณ';
  } else {
    consequence = 'แม้ไม่มีการเปลี่ยนแปลงเด่นชัดในทันที แต่เหตุการณ์นี้ก็กลายเป็นอีกหนึ่งประสบการณ์ของชีวิต';
  }

  if (!looksGeneric && base.length > 150) {
    // เก็บคำบรรยายเฉพาะที่ผู้เขียนใส่มา แล้วเติมบทสรุปผลที่เกิดขึ้นในโลกเกม
    opening = base;
  }

  return `${opening} ${storyBeat} ${consequence}`.replace(/\s+/g, ' ').trim();
}

/**
 * ประมวลผลเมื่อผู้เล่นกดปุ่มเลือกตัวเลือก (Choice) ในการ์ดอีเวนต์ใบปัจจุบัน
 * รองรับการทอยเต๋า RNG ทั้ง 2 สคีมา, อัปเดตสเตตัส/ป้าย/ความสัมพันธ์, เช็กการตายกลางคิว และบันทึก Life Feed
 *
 * @param {object} state GameState ปัจจุบัน
 * @param {string} choiceId รหัสตัวเลือก เช่น 'c1', 'c2', 'opt_sci_math'
 * @returns {object} ข้อมูลผลลัพธ์สำหรับให้ UI แสดงการ์ดสรุปผล
 */
export function selectEventChoice(state, choiceId) {
  const currentEvent = getCurrentPendingEvent(state);
  if (!currentEvent) {
    return { success: false, message: 'ไม่มีเหตุการณ์ค้างอยู่ในคิวขณะนี้' };
  }

  const chosen = currentEvent.choices.find((c) => c.choice_id === choiceId);
  if (!chosen) {
    return { success: false, message: 'ไม่พบตัวเลือกที่ระบุ' };
  }

  if (chosen.isLocked) {
    return {
      success: false,
      message: chosen.lockReasonTh || 'คุณยังไม่ผ่านเงื่อนไขสำหรับตัวเลือกนี้'
    };
  }

  let rngRollInfo = null;
  let outcomeTextTh = '';
  let resolvedStatEffects = {};
  let grantsFlags = [];
  let removesFlags = [];
  let specialHandler = chosen.special_handler || null;
  let handlerPayload = chosen.handler_payload || {};

  // -------------------------------------------------------------------------
  // รูปแบบ RNG ที่ 1: อีเวนต์ทั่วไปที่มี choice.rng_mechanic
  // -------------------------------------------------------------------------
  if (chosen.rng_mechanic && chosen.rng_mechanic.success_chance_percent !== undefined) {
    const chance = clampStat(Number(chosen.rng_mechanic.success_chance_percent), 1, 99);
    const isSuccess = rollChance(chance);

    rngRollInfo = {
      rolled: true,
      chancePercent: chance,
      isSuccess,
      iconKey: isSuccess ? 'trophy' : 'alert'
    };

    if (isSuccess) {
      resolvedStatEffects = chosen.stat_effects || {};
      grantsFlags = chosen.grants_flags || [];
      removesFlags = chosen.removes_flags || [];
      outcomeTextTh = stripEmojis(chosen.success_outcome_text_th || `ตัดสินใจเลือก: "${chosen.label_th}" — สำเร็จตามเป้าหมาย!`);
    } else {
      resolvedStatEffects = chosen.rng_mechanic.fail_stat_effects || {};
      grantsFlags = chosen.rng_mechanic.fail_grants_flags || [];
      removesFlags = chosen.rng_mechanic.fail_removes_flags || [];
      outcomeTextTh = stripEmojis(chosen.rng_mechanic.fail_outcome_text_th || 'โชคไม่เข้าข้าง! แผนที่วางไว้เกิดผิดพลาด');
    }
  }
  // -------------------------------------------------------------------------
  // รูปแบบ RNG ที่ 2: อีเวนต์วิกฤต / จับใบดำใบแดง ที่มี base_success_chance_percent + on_success / on_fail
  // -------------------------------------------------------------------------
  else if (chosen.on_success || chosen.base_success_chance_percent !== undefined) {
    const baseChance = Number(chosen.base_success_chance_percent ?? 100);
    let scalingBonus = 0;
    for (const [statKey, factor] of Object.entries(chosen.stat_scaling_bonus || {})) {
      scalingBonus += getPlayerStatValue(state, statKey) * Number(factor);
    }

    const finalChance = baseChance >= 100 && !chosen.on_fail
      ? 100
      : clampStat(Math.round(baseChance + scalingBonus), 5, 98);

    const isSuccess = finalChance >= 100 ? true : rollChance(finalChance);

    if (finalChance < 100 || chosen.on_fail) {
      rngRollInfo = {
        rolled: true,
        baseChancePercent: baseChance,
        bonusPercent: Number(scalingBonus.toFixed(1)),
        chancePercent: finalChance,
        isSuccess,
        iconKey: isSuccess ? 'trophy' : 'alert'
      };
    }

    const branch = isSuccess || !chosen.on_fail ? (chosen.on_success || {}) : chosen.on_fail;
    resolvedStatEffects = branch.stat_effects || chosen.stat_effects || {};
    grantsFlags = branch.grants_flags || chosen.grants_flags || [];
    removesFlags = branch.removes_flags || chosen.removes_flags || [];
    outcomeTextTh = stripEmojis(branch.outcome_text_th || `คุณเลือก: "${chosen.label_th}"`);
    if (branch.special_handler) {
      specialHandler = branch.special_handler;
    }
  }
  // -------------------------------------------------------------------------
  // รูปแบบปกติ (Deterministic 100%)
  // -------------------------------------------------------------------------
  else {
    resolvedStatEffects = chosen.stat_effects || {};
    grantsFlags = chosen.grants_flags || [];
    removesFlags = chosen.removes_flags || [];
    outcomeTextTh = stripEmojis(chosen.outcome_text_th || `คุณตัดสินใจ: ${chosen.label_th}`);
  }

  // 1. ประมวลผล Special Handler (ถ้ามี เช่น ทุบกระปุกอายุ 7 / เปลี่ยนคำนำหน้าอายุ 15 / ทหารเกณฑ์ / นโยบายลูก)
  const specialNote = executeSpecialChoiceHandler(state, specialHandler, handlerPayload);
  if (specialNote && !outcomeTextTh.includes(specialNote)) {
    outcomeTextTh = `${outcomeTextTh} (${specialNote})`;
  }

  // 2. อัปเดตป้ายสถานะ (grants_flags / removes_flags)
  for (const rf of removesFlags) {
    removeFlagFromState(state, rf);
  }
  for (const gf of grantsFlags) {
    addFlagToState(state, gf);
  }

  // กรณีช้อยส์ส่งผลให้หย่าขาดตามกฎหมาย (grants flag_divorced) ต้องแบ่งเงินสด 50% และล้างคู่สมรส
  if (grantsFlags.includes('flag_divorced')) {
    if (Number(state.finance.cash || 0) > 0) {
      const splitLoss = Math.floor(state.finance.cash * 0.5);
      state.finance.cash -= splitLoss;
    }
    state.relationships.partner = null;
    removeFlagFromState(state, 'flag_partner_hearts_5');
  }

  // 3. อัปเดตค่าสถานะทั้ง 7 ตัว (สุขภาพ, ความสุข, สมอง, เส้นสาย, แต้มบุญ, หน้าตา, เงินสด/กระปุก)
  const statDeltas = applyEventStatEffects(state, resolvedStatEffects);

  // 4. อัปเดตความสัมพันธ์ NPC / คู่รัก / ลูก
  const relationshipUpdate = applyEventRelationshipChange(state, currentEvent, chosen.relationship_change);
  const metNpc = currentEvent.source_type === 'random_event'
    ? applyRandomNpcMeeting(state, currentEvent, chosen)
    : null;
  if (metNpc) outcomeTextTh = `${outcomeTextTh} คุณได้รู้จัก ${metNpc.name} และสามารถพบกันอีกในหน้าความสัมพันธ์`;

  // 4.1 สร้างคำบรรยายเหตุการณ์หลังการตัดสินใจ แทนการแสดงเพียงข้อความชื่อ Choice
  outcomeTextTh = buildChoiceOutcomeNarrativeTh(
    currentEvent,
    chosen,
    outcomeTextTh,
    statDeltas,
    relationshipUpdate,
    rngRollInfo
  );

  // 5. บันทึกหมวดหมู่อีเวนต์ล่าสุด (สำหรับเช็กสาเหตุการตาย เช่น อุบัติเหตุทางถนน) และบันทึกว่าอีเวนต์นี้เล่นไปแล้ว
  const isRoadAccidentEvent =
    currentEvent.event_id === 'evt_crisis_01_heavy_road_accident' ||
    currentEvent.trigger_code === 'event_heavy_accident_bill' ||
    currentEvent.category === 'road_accident';

  state.turn.lastEventCategory = isRoadAccidentEvent
    ? 'road_accident'
    : (currentEvent.category || currentEvent.source_type || 'general');

  if (!state.turn.triggeredEventIdsThisLife.includes(currentEvent.event_id)) {
    state.turn.triggeredEventIdsThisLife.push(currentEvent.event_id);
  }
  if (currentEvent.source_type === 'random_event') {
    recordRandomEvent(state, {
      id: currentEvent.event_id,
      category: currentEvent.category,
      rarity: currentEvent.rarity,
      futureStoryHooks: chosen.futureStoryHooks || currentEvent.futureStoryHooks,
      title: currentEvent.title_th
    }, chosen.choice_id);
  }

  // 6. บันทึกลง Life Feed Log แบบไร้ Emoji พร้อมแนบ iconKey
  state.turn.lifeFeedLog.push({
    age: state.profile.age,
    monthNum: currentEvent.monthNum || 1,
    monthTh: currentEvent.monthTh || 'มกราคม',
    type: currentEvent.source_type || 'event',
    iconKey: rngRollInfo ? rngRollInfo.iconKey : (currentEvent.iconKey || 'calendar'),
    eventId: currentEvent.event_id,
    title: currentEvent.title_th,
    choiceLabel: chosen.label_th,
    message: outcomeTextTh,
    statDeltas,
    grantsFlags,
    removesFlags
  });

  // 7. ตรวจสอบการเสียชีวิตทันทีกลางคิว (Mid-Queue Death Interrupt เมื่อ health <= 0)
  let isPlayerDead = false;
  if (Number(state.stats.health || 0) <= 0) {
    isPlayerDead = true;
    state.stats.health = 0;
    state.profile.isAlive = false;
    state.profile.deathCauseId = evaluateImmediateDeathCauseId(state);

    // ล้างคิวอีเวนต์ที่เหลือทั้งหมดทันทีเมื่อเสียชีวิต
    state.turn.pendingEvents = [];
    state.turn.currentEventIndex = 0;
    state.turn.areTabsLocked = true;
    state.turn.phase = 'ENDED';
  }

  recalculateNetWorth(state);
  saveGame(state);

  const nextIndexPreview = state.turn.currentEventIndex + 1;
  const hasMoreEventsInQueue = !isPlayerDead && nextIndexPreview < (state.turn.pendingEvents?.length || 0);

  return {
    success: true,
    eventId: currentEvent.event_id,
    choiceId: chosen.choice_id,
    outcomeTextTh,
    statDeltas,
    grantsFlags,
    removesFlags,
    relationshipUpdate,
    rngRollInfo,
    hasMoreEventsInQueue,
    isPlayerDead,
    deathCauseId: state.profile.deathCauseId,
    nextActionButtonType: isPlayerDead
      ? 'VIEW_ENDING'
      : (hasMoreEventsInQueue ? 'NEXT_EVENT' : 'ENTER_FREE_ACTION')
  };
}

/**
 * เลื่อนคิวไปยังอีเวนต์ใบถัดไป (เรียกเมื่อผู้เล่นอ่านผลลัพธ์ของใบปัจจุบันเสร็จแล้วกดปุ่ม "เหตุการณ์ถัดไป / ดำเนินการต่อ")
 * หากไม่มีอีเวนต์เหลือในคิว จะปลดล็อกแท็บทั้ง 5 เข้าสู่ช่วง Free Action ทันที
 *
 * @param {object} state GameState ปัจจุบัน
 * @returns {{
 *   completedQueue: boolean,
 *   nextEvent: object|null,
 *   phase: string,
 *   areTabsLocked: boolean
 * }}
 */
export function advanceEventQueue(state) {
  if (!state?.turn) {
    return { completedQueue: true, nextEvent: null, phase: 'FREE_ACTION', areTabsLocked: false };
  }

  if (!state.profile.isAlive) {
    state.turn.phase = 'ENDED';
    state.turn.areTabsLocked = true;
    return { completedQueue: true, nextEvent: null, phase: 'ENDED', areTabsLocked: true };
  }

  state.turn.currentEventIndex = Number(state.turn.currentEventIndex || 0) + 1;

  // getCurrentPendingEvent จะช่วยข้ามอีเวนต์ที่เงื่อนไขไม่ตรงแล้วให้อัตโนมัติ และถ้าหมดคิวจะเซ็ต FREE_ACTION ให้ทันที
  const nextEvent = getCurrentPendingEvent(state);

  if (!nextEvent) {
    state.turn.pendingEvents = [];
    state.turn.currentEventIndex = 0;
    state.turn.areTabsLocked = false;
    state.turn.phase = 'FREE_ACTION';
  } else {
    state.turn.areTabsLocked = true;
    state.turn.phase = 'EVENT_QUEUE';
  }

  saveGame(state);

  return {
    completedQueue: !nextEvent,
    nextEvent,
    phase: state.turn.phase,
    areTabsLocked: state.turn.areTabsLocked
  };
}
