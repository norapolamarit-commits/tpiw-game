/**
 * js/engine/greeting_engine.js
 * อีเวนต์ "มีคนเดินมาทัก": คนหลากหลายเพศเข้ามาแนะนำตัวระหว่างปี (โรงเรียน เพื่อนบ้าน ที่ทำงาน ออนไลน์)
 * ผู้เล่นเลือกวิธีทักตอบ มีผลต่อความสนิท ดัชนีความเท่าเทียม และอาจได้เพื่อนใหม่
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { applyStatEffects } from '../core/stat_engine.js';
import {
  FRIEND_BOND_THRESHOLD, IDENTITIES, fillWho, KID_IDENTITY_IDS, addFriendFromEncounter, ensureEquality, getIdentity, hashString, mulberry32
} from './gender_encounter_engine.js';
import { playerIdentity } from './social_media_engine.js';
import { socialReputation } from './social_consequence_engine.js';

export const GREETINGS_PER_YEAR = 2;
export const GREETING_MIN_AGE = 6;

const NICKS = ['ใบเตย', 'ต้นกล้า', 'พลอย', 'ภูมิ', 'ไอซ์', 'มิ้นท์', 'บอส', 'ฟ้าใส', 'ข้าวปั้น', 'เจ', 'ก้อง', 'ปลื้ม', 'ตะวัน', 'น้ำหวาน', 'ปุณณ์', 'แพรว', 'ณเดช', 'นุ่น', 'กวาง', 'เบลล์'];

const INTROS = {
  school: [
    '{name} ({who}) เดินมายืนข้างโต๊ะแล้วประกาศเสียงดังว่า "ฉันชื่อ{name} ย้ายมาใหม่ ขอแนะนำตัวและขอขนมหนึ่งชิ้นเป็นค่าทำความรู้จัก"',
    '{name} ({who}) ถือสมุดการ์ตูนมาโบกมือตรงหน้าคุณ "เห็นคุณอ่านเล่มเดียวกัน อยากคุยด้วยแต่ไม่รู้จะเริ่มยังไง เลยโบกมือแทน"',
    '{name} ({who}) เดินชนเสาธงโดยบังเอิญ แล้วหันมาทักคุณด้วยหน้าแดงๆ "ขอโทษนะ ฉันชื่อ{name} ไม่ได้ตั้งใจชนเสา"'
  ],
  neighbor: [
    '{name} ({who}) ยกมือทักข้ามรั้วพร้อมถุงมะม่วง "บ้านใหม่ใช่ไหม ฉันอยู่ข้างๆ เอามะม่วงมาฝาก ถือว่าเป็นของขวัญต้อนรับ"',
    '{name} ({who}) เดินจูงหมาตัวอ้วนมาทักที่หน้าบ้านคุณ "หมาตัวนี้ชอบคุณมาก ส่วนฉันชื่อ{name} ยินดีที่ได้รู้จักนะ"'
  ],
  work: [
    '{name} ({who}) ยื่นแก้วกาแฟให้ "เห็นคุณมาทำงานเช้าทุกวัน ขอแนะนำตัวหน่อย ฉันชื่อ{name} ประจำโต๊ะข้างๆ"',
    '{name} ({who}) เดินเข้ามาพร้อมถาดขนม "ฉลองวันแรกที่ได้ทำงานด้วยกัน เชิญทำความรู้จักก่อนกาแฟเย็น"'
  ],
  online: [
    '{name} ({who}) ส่งข้อความทักมาว่า "เห็นคอมเมนต์ของคุณในโพสต์เมื่อวาน รู้สึกขำมาก ขอทำความรู้จักได้ไหม"',
    '{name} ({who}) พิมพ์มาว่า "แนะนำตัวหน่อย เราชอบเรื่องเดียวกัน อยากมีเพื่อนคุยเรื่องนี้" พร้อมสติกเกอร์แมวโบกมือ'
  ]
};

export const REPLIES = [
  { id: 'warm', labelTh: 'สวัสดี ยินดีที่ได้รู้จักนะ! เรียกชื่อเล่นได้เลย แล้วคุณชื่ออะไรเหรอ', rel: 12, idx: 3, effects: { happiness: 1, connections: 1 }, resultTh: 'บรรยากาศอบอุ่นขึ้นทันที อีกฝ่ายยิ้มกลับและบอกว่า "ดีใจที่ได้รู้จักนะ"' },
  { id: 'curious', labelTh: 'สวัสดี! ตอนว่างๆ คุณชอบทำอะไรเหรอ เล่าให้ฟังหน่อยสิ', rel: 10, idx: 2, effects: { intelligence: 1, connections: 1 }, resultTh: 'ทั้งสองคุยกันยาวจนลืมเวลา เจอจุดร่วมที่ไม่คาดคิดสามอย่าง' },
  { id: 'polite', labelTh: 'สวัสดี ตอนนี้ยังไม่ค่อยว่างเลย ไว้คุยกันใหม่นะ', rel: 4, idx: 1, effects: {}, resultTh: 'จบอย่างสุภาพ อีกฝ่ายพยักหน้าและบอกว่า "ไว้คุยกันใหม่ก็ได้"' },
  { id: 'brush', labelTh: 'อ๋อ ไม่รู้จักหรอก ขอตัวก่อนนะ', rel: -6, idx: -2, effects: { happiness: -1 }, resultTh: 'อีกฝ่ายยืนนิ่งไปครู่หนึ่ง บรรยากาศเงียบจนได้ยินเสียงพัดลมหมุน' }
];

function contextsFor(age) {
  const list = ['neighbor'];
  if (age >= 6 && age <= 22) list.push('school', 'school');
  if (age >= 18 && age <= 64) list.push('work', 'work');
  if (age >= 14) list.push('online');
  return list;
}

/** คำทักของปีนี้ (คงที่ตาม seed): อัตลักษณ์ไม่ซ้ำกันและเน้นเพศอื่นจากผู้เล่น */
export function generateGreetings(state) {
  const age = Number(state.profile?.age || 0);
  const rnd = mulberry32(hashString(`${state.meta?.runId || 'x'}|greet|${age}`));
  const pool = age < 13 ? KID_IDENTITY_IDS : IDENTITIES.map((i) => i.id);
  const own = playerIdentity(state);
  const used = [];
  const out = [];
  const rep = socialReputation(state);
  const count = GREETINGS_PER_YEAR + (rep >= 5 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const cands = pool.filter((id) => !used.includes(id) && (i === 0 ? id !== own : true));
    const identity = cands[Math.floor(rnd() * cands.length)];
    used.push(identity);
    const ctxs = contextsFor(age);
    const context = ctxs[Math.floor(rnd() * ctxs.length)];
    const name = NICKS[Math.floor(rnd() * NICKS.length)];
    const tpl = INTROS[context][Math.floor(rnd() * INTROS[context].length)];
    const prefix = rep >= 5 && i === count - 1 ? 'เห็นคุณใจดีในโซเชียลมาตลอด เลยอยากมาทักด้วยตัวเอง: ' : rep <= -3 ? 'ท่าทีค่อนข้างระมัดระวังเพราะเคยเห็นคอมเมนต์ของคุณมาก่อน: ' : '';
    out.push({ id: `greet_${age}_${i}`, identity, context, name, wary: rep <= -3, introTh: prefix + fillWho(tpl.replaceAll('{name}', name), getIdentity(identity).label) });
  }
  return out;
}

/** คำทักถัดไปที่ยังไม่เคยเปิดในปีนี้ (ไม่เกิดซ้ำแม้ปิดไปแล้ว) */
export function nextGreeting(state) {
  const age = Number(state.profile?.age || 0);
  if (age < GREETING_MIN_AGE || !state.profile?.isAlive) return null;
  const eq = ensureEquality(state);
  eq.greet ||= { shown: [] };
  return generateGreetings(state).find((g) => !eq.greet.shown.includes(g.id)) || null;
}

export function markGreetingShown(state, greeting) {
  const eq = ensureEquality(state);
  eq.greet ||= { shown: [] };
  if (!eq.greet.shown.includes(greeting.id)) eq.greet.shown.push(greeting.id);
  if (eq.greet.shown.length > 200) eq.greet.shown.splice(0, 100);
}

export function resolveGreeting(state, greeting, replyId) {
  const reply = REPLIES.find((r) => r.id === replyId);
  if (!reply) return { success: false, message: 'ไม่พบตัวเลือก' };
  const eq = ensureEquality(state);
  const before = eq.townIndex;
  eq.townIndex = Math.max(0, Math.min(100, eq.townIndex + reply.idx));
  eq.relations[greeting.id] = Math.max(-100, Math.min(100, (eq.relations[greeting.id] || 0) + reply.rel - (greeting.wary ? 4 : 0)));
  applyStatEffects(state, reply.effects);
  const friend = eq.relations[greeting.id] >= FRIEND_BOND_THRESHOLD ? addFriendFromEncounter(state, { id: greeting.id, identity: greeting.identity }, greeting.name) : null;
  state.turn?.lifeFeedLog?.push({ age: Number(state.profile.age || 0), monthTh: 'ตลอดปี', type: 'greeting', title: `${greeting.name} มาทักทาย`, message: reply.resultTh });
  return { success: true, reply, friend, indexBefore: before, indexAfter: eq.townIndex, message: friend ? `${reply.resultTh} • ${friend.name} กลายเป็นเพื่อนของคุณแล้ว` : reply.resultTh };
}
