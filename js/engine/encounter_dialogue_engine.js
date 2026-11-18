/**
 * js/engine/encounter_dialogue_engine.js
 * บทสนทนาพบปะแบบถาม-ตอบ: หลังตอบครั้งแรก เพื่อนตอบสนอง ถามต่อ และให้เลือกตอบอีก 2 รอบ
 * บทพูดจะไม่ซ้ำกับที่เคยใช้ (จำใน equality.seenLines) จนกว่าคลังบทพูดหมวดนั้นจะหมด
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { applyStatEffects } from '../core/stat_engine.js';
import { CALLBACKS, CLOSINGS, GUARDED_QUESTIONS, QUESTIONS, REACTIONS, WARM_QUESTIONS } from './dialogue_pools.js';
import { FRIEND_BOND_THRESHOLD, addFriendFromEncounter, ensureEquality, hashString, mulberry32 } from './gender_encounter_engine.js';

export const FOLLOW_UP_ROUNDS = 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** เลือกบทพูดที่ยังไม่เคยเจอ ถ้าหมดแล้วรีเซ็ตเฉพาะกลุ่มนั้น */
export function pickFresh(state, pool, seedKey, keyOf = (t) => t) {
  const eq = ensureEquality(state);
  eq.seenLines ||= [];
  const seen = new Set(eq.seenLines);
  let fresh = pool.filter((t) => !seen.has(hashString(keyOf(t))));
  if (!fresh.length) {
    const ids = new Set(pool.map((t) => hashString(keyOf(t))));
    eq.seenLines = eq.seenLines.filter((h) => !ids.has(h));
    fresh = pool;
  }
  const item = fresh[Math.floor(mulberry32(hashString(`${seedKey}|${eq.seenLines.length}`))() * fresh.length)];
  eq.seenLines.push(hashString(keyOf(item)));
  if (eq.seenLines.length > 900) eq.seenLines.splice(0, 300);
  return item;
}

const MOOD = { defend: 'good', respect: 'good', ignore: 'mid', disrespect: 'bad' };

/** ระดับคำถามถัดไปตามน้ำเสียงคำตอบก่อนหน้า: good เปิดใจ / mid ปกติ / bad ระวังตัว (สลับกับคำถามตามบริบทบ้างให้เป็นธรรมชาติ) */
export function questionTier(prevTone, seedKey, round) {
  const mood = MOOD[prevTone] || 'mid';
  const roll = (hashString(`${seedKey}|${round}|tier`) % 100) / 100;
  if (mood === 'good' && roll < 0.7) return 'warm';
  if (mood === 'bad' && roll < 0.85) return 'guarded';
  return 'context';
}

/**
 * สร้างรอบถัดไปของบทสนทนา โดยเปลี่ยนตามสิ่งที่ผู้เล่นตอบก่อนหน้า
 * @param {{context:string, prevTone:string, prevLine?:string, seedKey:string, round:number}} p
 * @returns {{reaction:string, callback:string, tier:string, question:string, options:{id:string,label:string}[]}}
 */
export function buildFollowUp(state, { context, prevTone, prevLine = '', seedKey, round }) {
  const ai = state.equality?.aiLines;
  const mood = MOOD[prevTone] || 'mid';
  const tier = questionTier(prevTone, seedKey, round);
  const callback = prevLine ? pickFresh(state, CALLBACKS[mood], `${seedKey}|r${round}|cb`).replaceAll('{prev}', prevLine) : '';
  const reaction = pickFresh(state, [...(REACTIONS[prevTone] || REACTIONS.respect), ...(ai?.reactions?.[prevTone] || [])], `${seedKey}|r${round}|react`);
  const pool = tier === 'warm' ? WARM_QUESTIONS : tier === 'guarded' ? GUARDED_QUESTIONS : [...(QUESTIONS[context] || QUESTIONS.public), ...(ai?.questions?.[context] || [])];
  const picked = pickFresh(state, pool, `${seedKey}|r${round}|q`, (x) => x.q);
  const opts = ['good', 'mid', 'bad'].map((id) => ({ id, label: picked[id] }));
  const order = mulberry32(hashString(`${seedKey}|${round}|order`));
  opts.sort(() => order() - 0.5);
  return { reaction, callback, tier, question: picked.q, options: opts };
}

const FOLLOW = {
  good: { rel: 4, idx: 1, effects: { connections: 1 }, tone: 'respect' },
  mid: { rel: 1, idx: 0, effects: {}, tone: 'ignore' },
  bad: { rel: -5, idx: -2, effects: { happiness: -1 }, tone: 'disrespect' }
};

/** ใช้ผลของคำตอบต่อเนื่อง 1 ครั้ง: ปรับความสนิท ดัชนีเมือง และอาจได้เพื่อนใหม่ */
export function applyFollowUp(state, { relKey, identity, name = null }, optionId) {
  const f = FOLLOW[optionId];
  if (!f) return { success: false };
  const eq = ensureEquality(state);
  eq.townIndex = clamp(eq.townIndex + f.idx, 0, 100);
  eq.relations[relKey] = clamp((eq.relations[relKey] || 0) + f.rel, -100, 100);
  applyStatEffects(state, f.effects);
  let friend = null;
  if (eq.relations[relKey] >= FRIEND_BOND_THRESHOLD) friend = addFriendFromEncounter(state, { id: relKey, identity }, name);
  return { success: true, tone: f.tone, friend };
}

export function closingLine(state, scoreIds, seedKey) {
  const g = scoreIds.filter((x) => x === 'good').length, b = scoreIds.filter((x) => x === 'bad').length;
  const bucket = g > b ? 'good' : b > g ? 'bad' : 'mid';
  return { bucket, text: pickFresh(state, [...CLOSINGS[bucket], ...(state.equality?.aiLines?.closings?.[bucket] || [])], `${seedKey}|close`) };
}
