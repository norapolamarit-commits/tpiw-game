/**
 * js/engine/social_consequence_engine.js
 * ผลสะท้อนของการกระทำในโซเชียลที่กลับมาเป็นอีเวนต์ในปีถัดไป + ชื่อเสียงออนไลน์
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { applyStatEffects } from '../core/stat_engine.js';
import { addFriendFromEncounter, ensureEquality, getIdentity, hashString, IDENTITIES, KID_IDENTITY_IDS } from './gender_encounter_engine.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function social(state) {
  state.social ||= {};
  state.social.consequences ||= [];
  for (const k of ['commentsKind', 'commentsMean', 'goodPosts', 'badPosts', 'scams']) if (!Number.isFinite(state.social[k])) state.social[k] = 0;
  return state.social;
}

/** ชื่อเสียงออนไลน์: ใจดีสะสมเพิ่ม ปากร้าย/โพสต์แย่/ตอบคนแปลกหน้าลด */
export function socialReputation(state) {
  const s = social(state);
  return s.commentsKind + s.goodPosts * 2 - s.commentsMean * 2 - s.badPosts * 3 - s.scams - (s.prideDislikes || 0) * 2 - (s.infidelity || 0) * 3;
}

export function reputationLabel(r) {
  if (r >= 8) return 'คนใจดีที่ใครๆ ก็รู้จัก';
  if (r >= 4) return 'เพื่อนที่น่าคบ';
  if (r >= -2) return 'คนทั่วไป';
  if (r >= -6) return 'ถูกจับตามอง';
  return 'ชื่อเสียงแย่ในโลกออนไลน์';
}

export function queueConsequence(state, c) {
  const s = social(state);
  const age = Number(state.profile?.age || 0);
  const id = `cons_${c.type}_${age}_${s.consequences.length}`;
  s.consequences.push({ id, shown: false, ...c, dueAge: Number.isFinite(c.dueAge) ? c.dueAge : age + 1 });
  if (s.consequences.length > 60) s.consequences.splice(0, 20);
  return id;
}

const pickIdentity = (state, seed, avoid) => {
  const pool = (Number(state.profile?.age || 0) < 13 ? KID_IDENTITY_IDS : IDENTITIES.map((i) => i.id)).filter((x) => x !== avoid);
  return pool[hashString(seed) % pool.length];
};

// ตัวเลือก: [ป้าย, ผลลัพธ์, ผล {effects, idx, rel, friend}]
const DEFS = {
  backlash: (c) => ({
    title: 'คนที่เคยโดนคอมเมนต์ปากร้ายกลับมาเจอ',
    text: `${c.name} (${getIdentity(c.identity).label}) เดินมาหาตรงหน้า ถือภาพแคปหน้าจอคอมเมนต์ของคุณเมื่อปีที่แล้ว "นี่คุณเขียนใช่ไหม" บรรยากาศเงียบจนได้ยินเสียงนาฬิกา`,
    options: [
      ['ขอโทษอย่างจริงใจ และบอกว่าจะไม่ทำอีก', 'อีกฝ่ายนิ่งไปครู่หนึ่ง แล้วพยักหน้า "ขอบคุณที่กล้าขอโทษ"', { effects: { merit: 2, happiness: 1 }, idx: 3, rel: 12, friend: true }],
      ['แกล้งไม่รู้ว่าพูดเรื่องอะไร', 'อีกฝ่ายเดินจากไปด้วยสายตาผิดหวัง', { effects: { happiness: -1 }, idx: -1, rel: -4 }],
      ['ยืนยันว่า "แค่ล้อเล่น" แล้วหัวเราะ', 'ทุกคนในห้องหันมามอง ชื่อเสียงของคุณตกลงทันที', { effects: { merit: -2, happiness: -2 }, idx: -4, rel: -12 }]
    ]
  }),
  friend_intro: (c) => ({
    title: 'เพื่อนออนไลน์พาเพื่อนมาแนะนำ',
    text: `${c.name} เพื่อนออนไลน์ของคุณพา ${c.name2} (${getIdentity(c.identity2).label}) มาแนะนำตัว "เห็นคุณคอมเมนต์ใจดี เลยอยากให้รู้จักกัน"`,
    options: [
      ['ยิ้มทักทายและชวนไปกินขนมด้วยกัน', 'ทั้งสามคนนั่งคุยกันจนขนมหมดจาน', { effects: { connections: 2, happiness: 1 }, idx: 2, rel: 12, friend2: true }],
      ['ทักทายสุภาพแล้วขอตัว', 'จบอย่างสุภาพ เพื่อนใหม่พยักหน้าและบอกว่าไว้คุยกันใหม่', { effects: {}, idx: 1, rel: 4 }],
      ['บอกว่าไม่สะดวกคุยกับคนใหม่', 'บรรยากาศเงียบไปครู่หนึ่ง', { effects: { connections: -1 }, idx: -1, rel: -4 }]
    ]
  }),
  post_viral: () => ({
    title: 'โพสต์ของคุณถูกแชร์ไปทั่ว',
    text: 'รูปที่คุณโพสต์กับเพื่อนหลายเพศถูกแชร์ในกลุ่มโรงเรียนและกลุ่มชุมชน มีคนทักมาบอกว่า "อยากเข้ากลุ่มแบบนี้บ้าง"',
    options: [
      ['ตอบรับและเปิดกลุ่มให้ทุกคนเข้ามาคุยกัน', 'กลุ่มของคุณกลายเป็นพื้นที่ที่ใครก็นั่งโต๊ะเดียวกันได้', { effects: { connections: 3, happiness: 2, merit: 1 }, idx: 4 }],
      ['ขอบคุณเฉยๆ แล้วใช้ชีวิตต่อ', 'กระแสสงบลงอย่างนุ่มนวล', { effects: { happiness: 1 }, idx: 1 }],
      ['ลบโพสต์เพราะอาย', 'กระแสหายไป คนที่อยากเข้ากลุ่มผิดหวังเล็กน้อย', { effects: { happiness: -1 }, idx: -1 }]
    ]
  }),
  post_backlash: () => ({
    title: 'ถูกเรียกคุยเรื่องแคปชั่น',
    text: 'ครูและผู้ปกครองเรียกคุยเรื่องแคปชั่นที่คุณโพสต์เมื่อปีก่อน เพื่อนในรูปรู้สึกไม่ดี และบางคนไม่กล้าคุยกับคุณอีก',
    options: [
      ['ขอโทษเพื่อนต่อหน้า และลบแคปชั่นนั้น', 'เพื่อนยิ้มรับคำขอโทษ ครูพยักหน้าเบาๆ', { effects: { merit: 1, happiness: 1 }, idx: 2 }],
      ['เถียงว่า "แค่ล้อเล่น"', 'ครูถอนหายใจ เพื่อนในรูปเงียบไป', { effects: { merit: -2, happiness: -1 }, idx: -2 }],
      ['ไม่พูดอะไรและเดินหนี', 'เรื่องยังค้างคา ทุกคนยังสงสัย', { effects: { happiness: -1 }, idx: -1 }]
    ]
  }),
  scam_followup: () => ({
    title: 'คนแปลกหน้าที่คุณตอบไปส่งข้อความมาตื๊อ',
    text: 'บัญชีที่เคยขอเบอร์และที่อยู่ส่งข้อความมาอีกครั้ง "อย่าบอกใครนะ ส่งรูปบัตรมาให้หน่อย แล้วจะมีของขวัญ"',
    options: [
      ['บล็อก เก็บภาพหน้าจอ และบอกผู้ใหญ่ที่ไว้ใจ', 'คุณปลอดภัยและผู้ใหญ่ช่วยแจ้งความต่อ', { effects: { merit: 2, happiness: 1 }, idx: 2 }],
      ['ลองคุยต่ออีกนิดเผื่อเป็นเรื่องจริง', 'บทสนทนาแปลกขึ้นเรื่อยๆ คุณเริ่มรู้สึกไม่ปลอดภัย', { effects: { happiness: -3 }, idx: -1 }],
      ['ส่งข้อมูลไปตามที่ขอ', 'ผลเสียเกิดขึ้นทันที คุณต้องใช้เวลาแก้ไขเรื่องนี้นาน', { effects: { happiness: -4, merit: -1 }, idx: -2 }]
    ]
  }),
  coming_out_family: (c) => {
    const T = {
      supportive: `คุณเล่าให้พ่อแม่ฟังว่าตอนนี้คุณใช้ตัวตน ${c.identityLabel} ทั้งสองคนเงียบไปครู่หนึ่ง แล้วแม่ถามว่า "แล้วลูกอยากให้เรียกว่าอะไร เดี๋ยวแม่เรียกให้ถูก" พ่อวางแก้วน้ำลงเบาๆ`,
      mixed: `คุณเล่าให้พ่อแม่ฟังว่าตอนนี้คุณใช้ตัวตน ${c.identityLabel} ทั้งสองคนมองหน้ากัน "ขอเวลาทำความเข้าใจหน่อยนะ" พ่อพูดเบาๆ ส่วนแม่ยังไม่พูดอะไร`,
      resistant: `คุณเล่าให้พ่อแม่ฟังว่าตอนนี้คุณใช้ตัวตน ${c.identityLabel} บรรยากาศตึงขึ้นทันที "ลูกคิดดีแล้วหรือ ไม่เป็นแบบเดิมไม่ได้เหรอ" แม่พูดเสียงสั่น`
    };
    const R = {
      supportive: [['เล่าอย่างใจเย็นว่าคุณรู้สึกอย่างไรมาตลอด', 'แม่กอดคุณแน่น "ขอบคุณที่ไว้ใจเล่านะ แม่รักลูกเหมือนเดิม"', { effects: { happiness: 3, merit: 1 }, idx: 2, family: 12 }],
                    ['ขอให้พ่อแม่ลองหาข้อมูลและคุยกับคนที่เข้าใจไปด้วยกัน', 'พ่อพยักหน้า "งั้นเสาร์นี้ไปหาข้อมูลด้วยกันก็ได้"', { effects: { happiness: 2, intelligence: 1 }, idx: 2, family: 9 }],
                    ['บอกว่ายังไม่อยากคุยรายละเอียดตอนนี้', 'พ่อแม่ตอบ "ไม่เป็นไร พร้อมเมื่อไหร่ค่อยคุยนะ"', { effects: { happiness: 1 }, idx: 0, family: 4 }]],
      mixed: [['เล่าอย่างใจเย็นว่าคุณรู้สึกอย่างไรมาตลอด', 'พ่อแม่ฟังจนจบ แม่เช็ดตา "ยังไม่เข้าใจทั้งหมด แต่แม่ตั้งใจฟังนะ"', { effects: { happiness: 1, merit: 1 }, idx: 1, family: 5 }],
              ['ขอให้พ่อแม่ลองหาข้อมูลและคุยกับคนที่เข้าใจไปด้วยกัน', 'พ่อแม่ตกลงจะลองอ่านบทความที่คุณส่งให้', { effects: { happiness: 1, intelligence: 1 }, idx: 1, family: 6 }],
              ['บอกว่ายังไม่อยากคุยรายละเอียดตอนนี้', 'บทสนทนาจบลงอย่างเงียบๆ แต่ไม่มีใครพูดคำรุนแรง', { effects: { happiness: -1 }, idx: 0, family: 1 }]],
      resistant: [['เล่าอย่างใจเย็นว่าคุณรู้สึกอย่างไรมาตลอด', 'พ่อแม่ยังไม่เห็นด้วย แต่ไม่มีใครตะโกน แม่พูดเบาๆ "ลูกเป็นลูกแม่เหมือนเดิม แม่แค่ยังไม่เข้าใจ"', { effects: { happiness: 0, merit: 1 }, idx: 1, family: 2 }],
                  ['ขอให้พ่อแม่ลองหาข้อมูลและคุยกับคนที่เข้าใจไปด้วยกัน', 'พ่อแม่ไม่ตอบรับ แต่คุณเก็บบทความไว้ในโต๊ะ เผื่อวันหนึ่งพร้อม', { effects: { happiness: -1 }, idx: 1, family: 0 }],
                  ['บอกว่ายังไม่อยากคุยรายละเอียดตอนนี้', 'คุณพักเรื่องนี้ไว้ก่อนเพื่อรักษาตัวเอง คุณรู้ว่าเวลาอาจช่วยได้ และมีเพื่อนที่รับฟังคุณอยู่', { effects: { happiness: -1 }, idx: 0, family: 0 }]]
    };
    return { title: 'ครอบครัวรู้ตัวตนใหม่ของคุณ', text: T[c.stance] || T.mixed, options: R[c.stance] || R.mixed };
  },
  coming_out_friends: (c) => {
    const T = {
      supportive: `คุณบอกเพื่อนสนิทว่าตอนนี้คุณใช้ตัวตน ${c.identityLabel} เพื่อนตะโกน "ว้าว! ขอบคุณที่บอกนะ" แล้วทุกคนช่วยกันซ้อมเรียกชื่อใหม่จนติดปาก`,
      mixed: `คุณบอกเพื่อนสนิทว่าตอนนี้คุณใช้ตัวตน ${c.identityLabel} เพื่อนส่วนใหญ่ตอบรับดี แต่มีสองคนที่นิ่งไป "ขอเวลาปรับตัวนะ" หนึ่งในนั้นพูด`,
      resistant: `คุณบอกเพื่อนว่าตอนนี้คุณใช้ตัวตน ${c.identityLabel} เพื่อนบางคนทำหน้าลำบากใจ มีคนพึมพำว่า "ไม่เห็นต้องทำเรื่องใหญ่" แต่เพื่อนสนิทหนึ่งคนวางมือบนไหล่คุณเงียบๆ`
    };
    const R = {
      supportive: [['บอกเพื่อนตรงๆ ว่าอยากให้เรียกชื่อและสรรพนามแบบไหน', 'เพื่อนทุกคนจดไว้ในมือถือ และเรียกถูกตั้งแต่ครั้งแรก', { effects: { happiness: 3, connections: 2 }, idx: 3, friends: true }],
                    ['โพสต์บอกใน ik ให้ทุกคนรู้พร้อมกัน', 'มีคนกดไลก์และคอมเมนต์ให้กำลังใจเพียบ', { effects: { happiness: 2, connections: 2 }, idx: 2, friends: true }],
                    ['ค่อยๆ บอกทีละคนตามความสบายใจ', 'ทุกคนที่คุณบอกให้การต้อนรับที่อบอุ่น', { effects: { happiness: 2, connections: 1 }, idx: 2, friends: true }]],
      mixed: [['บอกเพื่อนตรงๆ ว่าอยากให้เรียกชื่อและสรรพนามแบบไหน', 'เพื่อนส่วนใหญ่ปรับตัวได้เร็ว คนที่ยังไม่แน่ใจขอให้คุณช่วยอธิบายเพิ่ม', { effects: { happiness: 2, connections: 1 }, idx: 2 }],
              ['โพสต์บอกใน ik ให้ทุกคนรู้พร้อมกัน', 'มีทั้งไลก์และความเงียบ คุณรู้สึกโล่งที่ไม่ต้องปิดบังอีกต่อไป', { effects: { happiness: 1, connections: 0 }, idx: 1 }],
              ['ค่อยๆ บอกทีละคนตามความสบายใจ', 'ใช้เวลาหน่อย แต่คนที่ตอบรับแล้วกลายเป็นเพื่อนที่แน่นแฟ้นขึ้นอีก', { effects: { happiness: 1, connections: 1 }, idx: 1 }]],
      resistant: [['บอกเพื่อนตรงๆ ว่าอยากให้เรียกชื่อและสรรพนามแบบไหน', 'เพื่อนบางคนยังเรียกผิด แต่เพื่อนสนิทคอยแก้ให้ทุกครั้ง คุณรู้ว่ามีคนอยู่ข้างๆ', { effects: { happiness: 0, connections: 1 }, idx: 2 }],
                  ['โพสต์บอกใน ik ให้ทุกคนรู้พร้อมกัน', 'มีคอมเมนต์ไม่น่ารักบ้าง แต่มีคนมากมายออกมาปกป้องคุณ', { effects: { happiness: -1, connections: 1 }, idx: 1 }],
                  ['ค่อยๆ บอกทีละคนตามความสบายใจ', 'คุณเลือกบอกเฉพาะคนที่ไว้ใจก่อน ปลอดภัยและสบายใจกว่าเดิม', { effects: { happiness: 1, connections: 1 }, idx: 1 }]]
    };
    return { title: 'เพื่อนรู้ตัวตนใหม่ของคุณ', text: T[c.stance] || T.mixed, options: R[c.stance] || R.mixed };
  },
  fling_talk: (c) => ({
    title: `${c.name} ชวนคุยเรื่องที่เราเป็นอะไรกัน`,
    text: `${c.name} ชวนคุยเรื่องความสัมพันธ์ที่ตกลงกันไว้ว่าเป็นกิ๊ก "ช่วงนี้เป็นยังไงบ้าง ยังสบายใจกับแบบนี้ไหม พูดตรงๆ ได้นะ"`,
    options: [
      ['คุยตรงๆ ว่ายังสบายใจ และอยากให้ซื่อสัตย์ต่อกันแบบนี้ต่อไป', `${c.name} ยิ้มโล่งใจ "ขอบคุณที่พูดตรงๆ เลย ฉันก็สบายใจเหมือนกัน"`, { effects: { happiness: 2 }, idx: 1, flingKeep: true }],
      ['บอกว่าเริ่มรู้สึกจริงจังกว่าเดิม และอยากลองเป็นคนคุยกัน', `${c.name} ตอบอย่างใจเย็น "ขอเวลาคิดแล้วจะบอกคุณนะ" คุณรู้สึกเบาขึ้นที่พูดความรู้สึกออกไป`, { effects: { happiness: 1 }, idx: 1, flingToCrush: true }],
      ['บอกว่ายุติความเป็นกิ๊ก แต่ยังอยากเป็นเพื่อนกัน', `${c.name} พยักหน้า "ขอบคุณที่บอกตรงๆ ไม่มีใครต้องเสียใจคนเดียวนะ" คุณทั้งสองกลับไปเป็นเพื่อนกัน`, { effects: { happiness: 0, merit: 1 }, idx: 2, flingEnd: true }]
    ]
  }),
  caught_cheating: (c) => ({
    title: 'เรื่องที่ปิดไว้ถูกจับได้',
    text: `${c.partnerName} นั่งรอคุณอยู่ที่บ้านพร้อมโทรศัพท์ที่เปิดข้อความจาก ${c.name} ค้างไว้ "นี่คืออะไร ช่วยอธิบายหน่อยได้ไหม" ไม่มีใครพูดอะไรอีกเลยจนได้ยินเสียงนาฬิกา`,
    options: [
      ['สารภาพทั้งหมด ขอโทษอย่างจริงใจ และยอมรับผลที่ตามมา', `${c.partnerName} ร้องไห้ แต่เพราะคุณไม่โกหกต่อ จึงมีโอกาสที่ความสัมพันธ์จะเยียวยา ถ้ามีความไว้ใจเหลืออยู่บ้าง`, { effects: { merit: 1, happiness: -4 }, idx: 1, cheat: 'confess' }],
      ['ปฏิเสธและบอกว่าเป็นแค่เพื่อน', `คุณพยายามอธิบายด้วยเสียงสั่น ${c.partnerName} มองหน้าคุณนิ่งๆ แล้วถามว่า "คุณคิดว่าฉันโง่เหรอ"`, { effects: { merit: -2, happiness: -3 }, idx: -2, cheat: 'deny' }],
      ['ยุติกับ ' + c.name + ' ทันที และขอโอกาสแก้ตัว', `${c.partnerName} ขอเวลาคิดคนเดียวหลายวัน และบอกว่า "ฉันยังไม่รู้ว่าจะไว้ใจคุณได้อีกไหม"`, { effects: { merit: 0, happiness: -3 }, idx: 0, cheat: 'end' }]
    ]
  }),
  safe_praise: () => ({
    title: 'ครูชมวิธีรับมือบัญชีแปลกหน้า',
    text: 'ครูเล่าในคาบให้ทุกคนฟังว่ามีนักเรียนคนหนึ่งบล็อกและรายงานบัญชีน่าสงสัยทันที โดยไม่ต้องเอ่ยชื่อ แต่ทุกคนหันมามองคุณ',
    options: [['ยิ้มเขินๆ และชวนเพื่อนเรียนรู้วิธีเดียวกัน', 'ห้องทั้งห้องได้เรียนรู้วิธีปลอดภัยออนไลน์ไปพร้อมกัน', { effects: { merit: 2, happiness: 1, connections: 1 }, idx: 2 }]]
  })
};

export function nextConsequence(state) {
  const s = social(state);
  const age = Number(state.profile?.age || 0);
  const c = s.consequences.find((x) => !x.shown && x.dueAge <= age);
  if (!c) return null;
  const def = DEFS[c.type]?.(c);
  return def ? { ...c, ...def } : null;
}

export function markConsequenceShown(state, id) {
  const c = social(state).consequences.find((x) => x.id === id);
  if (c) c.shown = true;
}

export function resolveConsequence(state, consequence, optionIndex) {
  const opt = consequence.options[optionIndex];
  if (!opt) return { success: false, message: 'ไม่พบตัวเลือก' };
  const [, resultTh, fx] = opt;
  const eq = ensureEquality(state);
  const before = eq.townIndex;
  eq.townIndex = clamp(eq.townIndex + (fx.idx || 0), 0, 100);
  applyStatEffects(state, fx.effects || {});
  let friend = null;
  if (fx.flingKeep || fx.flingToCrush || fx.flingEnd) {
    const n = (state.relationships?.npcs || []).find((x) => x.id === consequence.npcId);
    if (n) {
      if (fx.flingEnd) { n.stage = 'friend'; n.relationship = clamp(Number(n.relationship || 0) - 4, 0, 100); }
      else if (fx.flingToCrush) { n.stage = 'close_friend'; n.relationship = clamp(Number(n.relationship || 0) + 3, 0, 100); }
      else n.relationship = clamp(Number(n.relationship || 0) + 4, 0, 100);
    }
  }
  if (fx.cheat) {
    const st = state.relationships || {};
    const p = st.partner;
    const sec = (st.npcs || []).find((x) => x.id === consequence.npcId);
    const age = Number(state.profile?.age || 0);
    const h = hashString(`${state.meta?.runId || 'x'}|cheat|${age}`) % 100;
    state.social ||= {}; state.social.infidelity = (state.social.infidelity || 0) + 1;
    let leaves = false;
    if (p) {
      const before = Number(p.relationship || 0);
      if (fx.cheat === 'confess') { p.relationship = clamp(before - 30, 0, 100); leaves = !(before >= 70 || h < 40); }
      else if (fx.cheat === 'deny') { const believed = Number(sec?.secrecy ?? 0) >= 55 && h < 55; p.relationship = clamp(before - (believed ? 5 : 40), 0, 100); leaves = !believed; }
      else { p.relationship = clamp(before - 18, 0, 100); leaves = !(before >= 60 || h < 55); }
      if (leaves) {
        const partnerNpc = (st.npcs || []).find((x) => x.id === p.sourceNpcId);
        if (p.status === 'married') {
          const half = Math.floor(Math.max(0, Number(state.finance?.cash || 0)) * 0.5);
          state.finance.cash = Math.round(Number(state.finance.cash || 0) - half);
          state.flags = (state.flags || []).filter((f) => !['flag_married_registered', 'flag_in_relationship', 'flag_partner_hearts_5'].includes(f));
          if (!state.flags.includes('flag_divorced')) state.flags.push('flag_divorced');
        }
        if (partnerNpc) { partnerNpc.stage = 'ex'; partnerNpc.exAge = age; partnerNpc.relationship = 15; }
        st.partner = null;
      }
    }
    if (sec) { sec.stage = 'friend'; sec.relationship = clamp(Number(sec.relationship || 0) - 20, 0, 100); sec.secrecy = undefined; }
    consequence.leaves = leaves;
  }
  if (fx.family != null) {
    for (const n of (state.relationships?.npcs || [])) if (n.id === 'npc_father' || n.id === 'npc_mother') n.relationship = clamp(Number(n.relationship || 0) + fx.family, 0, 100);
  }
  if (fx.friend || fx.friend2) {
    const who = fx.friend2 ? { id: `cons_${consequence.id}`, identity: consequence.identity2 } : { id: `cons_${consequence.id}`, identity: consequence.identity };
    eq.relations[who.id] = fx.rel || 12;
    friend = addFriendFromEncounter(state, who, fx.friend2 ? consequence.name2 : consequence.name);
  }
  state.turn?.lifeFeedLog?.push({ age: Number(state.profile?.age || 0), monthTh: 'ตลอดปี', type: 'social', title: `ผลจากโซเชียล: ${consequence.title}`, message: resultTh });
  const tail = consequence.leaves === true ? ' ผลคือ คู่ของคุณเลือกจากไป ความไว้ใจที่เสียไปไม่ใช่เรื่องที่เงินหรือคำพูดซื้อคืนได้ง่ายๆ' : consequence.leaves === false ? ' ความสัมพันธ์ยังไม่จบ แต่ต้องใช้เวลานานในการสร้างความไว้ใจกลับมา' : '';
  return { success: true, message: (friend ? `${resultTh} • ${friend.name} กลายเป็นเพื่อนของคุณแล้ว` : resultTh) + tail, indexBefore: before, indexAfter: eq.townIndex, friend };
}

export function newIdentityFor(state, seed, avoid) { return pickIdentity(state, seed, avoid); }
