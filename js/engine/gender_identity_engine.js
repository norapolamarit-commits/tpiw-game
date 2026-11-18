/**
 * js/engine/gender_identity_engine.js
 * ระบบสำรวจ/เปลี่ยนตัวตนทางเพศของตัวเอก (เพศทางเลือก) เริ่มที่อายุ 13 ปี
 * เปลี่ยนป้ายตัวตน ชื่อเล่น คำนำหน้า และส่งผลสะท้อนจากครอบครัวและเพื่อน (ขึ้นกับความสัมพันธ์และบรรยากาศของเมือง)
 * ไม่เกี่ยวกับเรื่องการแพทย์ เป็นเรื่องตัวตน การแสดงออก และการยอมรับ
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { applyStatEffects } from '../core/stat_engine.js';
import { IDENTITIES, ensureEquality, getIdentity, hashString } from './gender_encounter_engine.js';
import { queueConsequence } from './social_consequence_engine.js';

export const IDENTITY_CHANGE_MIN_AGE = 13;
export const NICKNAME_SUGGESTIONS = ['ใบเตย', 'ฟ้าใส', 'ตะวัน', 'ภูมิ', 'มิ้นท์', 'เจ', 'ปลื้ม', 'กวาง', 'น้ำใส', 'ไอซ์', 'ต้นกล้า', 'ณดา'];

export function getPlayerIdentityId(state) {
  const id = state.profile?.genderIdentity;
  if (id && IDENTITIES.some((i) => i.id === id)) return id;
  return state.profile?.gender === 'female' ? 'woman' : 'man';
}

export function getPlayerIdentityLabel(state) { return getIdentity(getPlayerIdentityId(state)).label; }

export function canChangeIdentity(state) {
  const age = Number(state.profile?.age || 0);
  if (age < IDENTITY_CHANGE_MIN_AGE) return { ok: false, reason: `การเปลี่ยนตัวตนทางเพศเปิดให้ทำได้ตั้งแต่อายุ ${IDENTITY_CHANGE_MIN_AGE} ปี ตอนนี้ลองรู้จักตัวเองไปก่อนนะ` };
  if (state.profile?.identityChangedAge === age) return { ok: false, reason: 'ปีนี้คุณเพิ่งเปลี่ยนตัวตนไปแล้ว ให้เวลาตัวเองและคนรอบข้างอีกสักนิดนะ' };
  return { ok: true, reason: '' };
}

export function getIdentityTitlePrefix(identity, age) {
  if (['woman', 'trans_woman', 'lesbian'].includes(identity)) return age >= 15 ? 'น.ส.' : 'ด.ญ.';
  if (['man', 'trans_man', 'gay_man'].includes(identity)) return age >= 15 ? 'นาย' : 'ด.ช.';
  return 'คุณ';
}
const cleanNick = (t) => String(t || '').replace(/[()<>]/g, '').trim().slice(0, 20);

/** ท่าทีของครอบครัวที่จะตอบรับ คำนวณจากความสัมพันธ์กับพ่อแม่ + บรรยากาศความเท่าเทียมของเมือง (คงที่ตามเซฟ) */
export function familyStance(state) {
  const eq = ensureEquality(state);
  const parents = (state.relationships?.npcs || []).filter((n) => n.id === 'npc_father' || n.id === 'npc_mother');
  const rel = parents.length ? parents.reduce((a, p) => a + Number(p.relationship || 0), 0) / parents.length : 60;
  const noise = ((hashString(`${state.meta?.runId || 'x'}|stance|${state.profile?.age}`) % 100) / 100 - 0.5) * 1.2;
  const score = (eq.townIndex - 50) / 12 + (rel - 60) / 22 + noise;
  return score >= 1 ? 'supportive' : score <= -1 ? 'resistant' : 'mixed';
}

export function friendsStance(state) {
  const eq = ensureEquality(state);
  const noise = ((hashString(`${state.meta?.runId || 'x'}|fstance|${state.profile?.age}`) % 100) / 100 - 0.5) * 1.0;
  const score = (eq.townIndex - 45) / 14 + noise;
  return score >= 0.6 ? 'supportive' : score <= -0.8 ? 'resistant' : 'mixed';
}

/**
 * เปลี่ยนตัวตนทางเพศของตัวเอก
 * @param {string} newId รหัสตัวตนจาก IDENTITIES
 * @param {{nickname?:string}} opts ชื่อเล่นใหม่ (ไม่บังคับ)
 */
export function changeGenderIdentity(state, newId, { nickname = '' } = {}) {
  const can = canChangeIdentity(state);
  if (!can.ok) return { success: false, message: can.reason };
  if (!IDENTITIES.some((i) => i.id === newId)) return { success: false, message: 'ไม่พบตัวเลือกนี้' };
  const oldId = getPlayerIdentityId(state);
  if (oldId === newId && !nickname.trim()) return { success: false, message: 'ตัวตนนี้เป็นของคุณอยู่แล้ว' };

  const profile = state.profile;
  const age = Number(profile.age || 0);
  profile.identityHistory ||= [];
  profile.identityHistory.push({ age, from: oldId, to: newId });
  profile.genderIdentity = newId;
  profile.identityChangedAge = age;
  profile.titlePrefix = getIdentityTitlePrefix(newId, age);
  const nick = cleanNick(nickname);
  if (nick) {
    profile.nickname = nick;
    profile.name = /\([^)]*\)\s*$/.test(profile.name || '') ? profile.name.replace(/\([^)]*\)\s*$/, `(${nick})`) : `${profile.name || ''} (${nick})`.trim();
  }

  applyStatEffects(state, { happiness: oldId === newId ? 0 : 3 });
  const label = getIdentity(newId).label;
  const fam = familyStance(state), fr = friendsStance(state);
  queueConsequence(state, { type: 'coming_out_family', identityLabel: label, stance: fam, dueAge: age });
  queueConsequence(state, { type: 'coming_out_friends', identityLabel: label, stance: fr, dueAge: age });
  state.turn?.lifeFeedLog?.push({ age, monthTh: 'ตลอดปี', type: 'identity', title: 'ค้นพบและเลือกตัวตนของตัวเอง', message: `คุณเลือกใช้ตัวตน ${label}${nick ? ` และชื่อเล่น "${nick}"` : ''} รู้สึกเป็นตัวเองมากขึ้น` });
  return { success: true, from: oldId, to: newId, label, message: `คุณเลือกใช้ตัวตน ${label} ขอให้รู้สึกเป็นตัวเองมากขึ้นนะ ครอบครัวและเพื่อนกำลังจะรู้เรื่องนี้`, familyStance: fam, friendsStance: fr };
}
