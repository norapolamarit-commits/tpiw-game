/**
 * js/engine/chat_dialogue_engine.js
 * แชตแบบถาม-ตอบ (dialogue): เพื่อนพูด ผู้เล่นเลือกคำตอบ เพื่อนตอบกลับ 3 รอบ แล้วสรุปความสนิท
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { applyStatEffects } from '../core/stat_engine.js';
import { ensureEquality, hashString } from './gender_encounter_engine.js';
import { ensureSocial, generateFeed, getContacts } from './social_media_engine.js';
import { getIdentity } from './gender_encounter_engine.js';

// ตัวเลือก: [ข้อความของผู้เล่น, คะแนน(-2..2), คำตอบของเพื่อน]
const DIALOGUES = [
  { id: 'cartoon', title: 'คุยเรื่องการ์ตูน', turns: [
    { them: 'เฮ้! เมื่อคืนดูการ์ตูนตอนใหม่จบรึยัง ฉันร้องไห้จนแมวมองหน้า', options: [
      ['ดูจบแล้ว! ตอนจบเศร้ามาก เล่าความรู้สึกให้ฟังหน่อย', 2, 'ฮ่าๆ เจอคนเข้าใจแล้ว! นึกว่ามีแค่ฉันที่ร้อง'],
      ['ยังไม่ได้ดู ขอสปอยล์นิดเดียวได้ไหม', 1, 'ได้ แต่สปอยล์แค่ประโยคเดียว: ตัวเอกกินข้าวหมดจาน'],
      ['การ์ตูนเป็นเรื่องของเด็ก ไม่ดูหรอก', -2, 'อ้าว... รู้สึกเหมือนมีคนปิดไฟในห้องฉันเลย']] },
    { them: 'บางคนบอกว่าการ์ตูนแนวนี้ไม่เหมาะกับคนอย่างฉัน เพราะเรื่องเพศ คุณคิดว่ายังไง', options: [
      ['การ์ตูนไม่มีเพศ ใครชอบก็ดูได้ ฉันชอบเหมือนกัน', 2, 'ขอบคุณนะ ได้ยินแบบนี้แล้วสบายใจขึ้นเยอะ'],
      ['ใครชอบอะไรก็เรื่องของเขาแหละ', 1, 'อืม ก็ถือว่าไม่ได้ซ้ำเติมกัน ขอบคุณนะ'],
      ['ก็จริงนะ ดูแปลกๆ อยู่', -2, '...เข้าใจแล้ว ขอไปเก็บของก่อนนะ']] },
    { them: 'สัปดาห์หน้ามีงานแจกขนมการ์ตูนที่โรงเรียน ไปด้วยกันไหม', options: [
      ['ไปสิ! นัดกันเลย ฉันเลี้ยงชานม', 2, 'เยี่ยม! งั้นนัดกันไว้เลยนะ'],
      ['ลองดูก่อน ถ้าว่างจะไป', 1, 'โอเค ไม่บังคับ แต่ถ้ามาก็ดีใจ'],
      ['ไม่ไปหรอก ขี้เกียจ', -1, 'โอเค งั้นฉันไปคนเดียว ขนมไม่ผิดอะไร']] }
  ] },
  { id: 'stress', title: 'คุยเรื่องความเหนื่อย', turns: [
    { them: 'วันนี้เหนื่อยมาก งานเยอะจนอยากย้ายไปอยู่กับแมวบนดาวอังคาร', options: [
      ['ฟังก่อน ถามว่าเกิดอะไรขึ้น แล้วชวนระบาย', 2, 'ขอบคุณที่ฟัง ระบายแล้วสบายใจขึ้น'],
      ['ส่งสติกเกอร์ให้กำลังใจ', 1, 'สติกเกอร์น่ารักดี ได้ใจขึ้นนิดหน่อย'],
      ['ทุกคนก็เหนื่อยเหมือนกันแหละ', -2, 'จริง แต่ฉันก็ยังเหนื่อยอยู่ดี...']] },
    { them: 'มีคนบอกว่าฉันไม่เหมาะกับงานนี้เพราะเรื่องเพศ ฉันควรทำยังไงดี', options: [
      ['ความสามารถไม่เกี่ยวกับเพศ เก็บผลงานไว้แล้วคุยกับหัวหน้า ฉันช่วยทบทวนให้ได้', 2, 'มีคำแนะนำแบบนี้ รู้สึกมีแรงขึ้นเยอะ'],
      ['ลองคุยกับคนที่ไว้ใจดู', 1, 'ได้ ฉันจะลองคุยกับคนที่ไว้ใจ'],
      ['ก็เปลี่ยนตัวเองให้เหมาะกับเขาสิ', -2, 'ฟังแล้วจุกเลย ไม่น่าถามเลย']] },
    { them: 'ขอบคุณที่คุยด้วยนะ พรุ่งนี้กินข้าวด้วยกันไหม', options: [
      ['ได้เลย ฉันเลี้ยงเอง', 2, 'เยี่ยมมาก ขอไข่เจียวสองฟองด้วย'],
      ['ดูตารางก่อนนะ', 1, 'โอเค ไว้ทักมา'],
      ['ไม่ว่าง', -1, 'โอเค ไว้คราวหน้า']] }
  ] },
  { id: 'teased', title: 'คุยเรื่องถูกแซว', turns: [
    { them: 'วันนี้โดนเพื่อนแซวว่าเราสองคนเป็นแฟนกัน ทั้งที่เราแค่เป็นเพื่อนกัน', options: [
      ['ฮ่าๆ เจ้าคนแซวน่าจะเหนื่อยแทน เราเป็นเพื่อนกันดีกว่า', 2, 'ใช่! เพื่อนกันดีที่สุด ไม่ต้องเขิน'],
      ['ปล่อยไปก่อน เดี๋ยวเขาก็เบื่อเอง', 1, 'ก็จริง แต่ก็ยังอึดอัดนิดหน่อย'],
      ['งั้นเลิกคุยกันดีกว่า จะได้ไม่โดนแซว', -2, 'อ้าว... เพราะเรื่องแค่นี้เลยเหรอ']] },
    { them: 'เพื่อนต่างเพศนั่งข้างกันได้ใช่ไหม หรือเป็นเรื่องผิดปกติ', options: [
      ['ได้เลย เพื่อนก็คือเพื่อน ไม่ว่าจะเพศไหน', 2, 'โล่งอกไปที เพราะบางคนทำเหมือนเป็นข่าวใหญ่'],
      ['ก็แล้วแต่คนจะคิด', 1, 'ก็จริง แต่ฉันอยากมีเพื่อนหลายแบบ'],
      ['ไม่ค่อยดีหรอก คนอื่นจะมอง', -2, 'อืม ฉันคงต้องอยู่คนเดียวสินะ']] },
    { them: 'ถ้าเขาแซวอีก เราควรทำยังไงดี', options: [
      ['บอกตรงๆ ว่าไม่ตลก และขอให้หยุด ฉันจะอยู่ข้างๆ', 2, 'มีเพื่อนอยู่ข้างๆ แบบนี้ แข็งแรงขึ้นเยอะเลย'],
      ['ยิ้มแล้วเปลี่ยนเรื่อง', 1, 'ก็ได้ ลองดู'],
      ['แซวกลับแรงๆ ไปเลย', -1, 'อืม ฉันไม่อยากให้เรื่องบานปลาย']] }
  ] },
  { id: 'game', title: 'คุยเรื่องเกมออนไลน์', turns: [
    { them: 'เมื่อคืนเข้าห้องแชตเกม โดนคนบอกว่า "ผู้หญิง/พวกนี้เล่นไม่เป็นหรอก ออกไป" ทั้งที่เราทำแต้มสูงสุด', options: [
      ['ไม่ยุติธรรมเลย แต้มของคุณพูดแทนแล้ว ฉันช่วยรายงานคนพูดนะ', 2, 'ขอบคุณ ได้เพื่อนอยู่ข้างแบบนี้ดีจัง'],
      ['ช่างเขาเถอะ เล่นต่อ', 1, 'ก็จริง แต่ก็ยังโมโหอยู่นิดหน่อย'],
      ['ก็คนส่วนใหญ่คิดแบบนั้นนี่', -2, 'ฟังแล้วท้อใจเลย']] },
    { them: 'อยากให้ชวนเพื่อนเข้าทีมด้วยกัน คนที่เล่นเก่งไม่เกี่ยวกับเพศใช่ไหม', options: [
      ['ใช่ ชวนทุกคนที่อยากเล่นเข้าทีมเลย', 2, 'เยี่ยม! ทีมเราจะเป็นทีมที่ใจดีที่สุดในจักรวาล'],
      ['ลองดูคนที่เล่นด้วยกันได้', 1, 'โอเค เดี๋ยวลองชวนดู'],
      ['เลือกแต่คนเพศเดียวกันดีกว่า ง่ายดี', -2, 'อืม ฉันรู้สึกไม่ค่อยดีเลย']] },
    { them: 'คืนนี้เล่นด้วยกันไหม', options: [
      ['ได้ ฉันเปิดห้องไว้รอ', 2, 'ดีมาก! เจอกันสามทุ่ม'],
      ['ดูก่อนว่าการบ้านเสร็จไหม', 1, 'โอเค ไว้ทักมา'],
      ['ไม่เล่น', -1, 'โอเค ไว้คราวหน้า']] }
  ] },
  { id: 'pet', title: 'คุยเรื่องสัตว์เลี้ยง', turns: [
    { them: 'ที่บ้านเลี้ยงลูกแมวเพิ่ม ตัวเล็กมากจนเดินชนมุมโต๊ะทุกที', options: [
      ['น่ารักมาก ส่งรูปมาให้ดูหน่อย', 2, 'ส่งไปแล้ว! ตาของมันดูเหมือนกำลังคิดแผนยึดโลก'],
      ['ดูแลดีๆ นะ', 1, 'ขอบคุณ จะดูแลอย่างดีเลย'],
      ['แมวเลี้ยงยาก ไม่น่าเลี้ยงเลย', -2, 'อ้าว... อย่าพูดแบบนั้นต่อหน้าแมวสิ']] },
    { them: 'เพื่อนบ้านบอกว่าผู้ชาย/ผู้หญิงไม่ควรเลี้ยงแมว คุณว่าไง', options: [
      ['ใครก็เลี้ยงสัตว์ได้ ถ้ารักและดูแลได้', 2, 'ดีใจที่ได้ยิน แมวขอบคุณด้วย'],
      ['แล้วแต่คนที่เลี้ยงเลย', 1, 'ก็จริง ขอบคุณที่ไม่ตัดสินกัน'],
      ['จริงนะ แมวควรอยู่กับเพศอื่น', -2, 'อะไรของคุณเนี่ย ไม่เข้าใจเลย']] },
    { them: 'ว่างไหม มาดูแมวที่บ้านหน่อย', options: [
      ['ไปเลย เอาขนมแมวไปฝาก', 2, 'แมวจะเรียกคุณว่าเพื่อนตลอดชีวิตแน่ๆ'],
      ['ไว้เสาร์นี้นะ', 1, 'โอเค เสาร์นี้เจอกัน'],
      ['ไม่ไปหรอก', -1, 'โอเค แมวจะเสียใจนะ']] }
  ] }
];

// บทสนทนากับ "คนอื่น" ที่เพิ่งรู้จัก: [ข้อความผู้เล่น, คะแนน, คำตอบ, เสี่ยงความปลอดภัย?]
const OTHER_DIALOGUES = [
  { id: 'hello', title: 'ทักทายคนที่เพิ่งรู้จัก', turns: [
    { them: 'สวัสดี เห็นโพสต์ของคุณในฟีดแล้วขำมาก เลยขอทักมา ว่างคุยไหม', options: [
      ['สวัสดี ยินดีที่ได้รู้จัก! โพสต์ของคุณก็น่าสนใจเหมือนกัน', 2, 'ฮ่าๆ ขอบคุณ ดีใจจังที่มีคนทักตอบ'],
      ['สวัสดี มีอะไรหรือเปล่า', 1, 'ไม่มีอะไร แค่อยากทำความรู้จักเฉยๆ'],
      ['ใครเนี่ย ไม่รู้จัก', -2, 'อ๋อ... ขอโทษที่รบกวนนะ']] },
    { them: 'ปกติว่างๆ คุณชอบทำอะไรมากที่สุด', options: [
      ['ชอบดูการ์ตูนกับวาดรูป แล้วคุณล่ะ', 2, 'เราชอบเล่นเกมกับเลี้ยงแมว คุยเรื่องนี้ได้ทั้งวันเลย'],
      ['ก็นอนเล่นบ้าง เล่นเกมบ้าง', 1, 'ฟังดูสบายดีเหมือนกัน'],
      ['ไม่บอก เสียเวลา', -2, 'โอเค เข้าใจ ไม่ถามต่อแล้ว']] },
    { them: 'ถ้าเราคุยกันบ่อยๆ จะโอเคไหม', options: [
      ['โอเคสิ ค่อยๆ ทำความรู้จักกันไป', 2, 'เยี่ยมเลย งั้นเดี๋ยวทักมาใหม่นะ'],
      ['ขอดูก่อนนะ', 1, 'ได้เลย ไม่รีบ'],
      ['ไม่ค่อยอยากคุยด้วย', -1, 'โอเค เคารพการตัดสินใจนะ']] }
  ] },
  { id: 'safety', title: 'คนแปลกหน้าขอข้อมูลส่วนตัว', turns: [
    { them: 'ใจดีจังเลย ขอรู้จักหน่อยได้ไหม เราอยู่คนเดียวไม่ค่อยมีเพื่อนคุย', options: [
      ['ยินดีคุยด้วย แต่คุยกันในแชตก่อนนะ', 2, 'ได้เลย ขอบคุณที่ใจดี'],
      ['ก็ได้ คุยทั่วไป', 1, 'โอเค คุยทั่วไปก็ดี'],
      ['เล่าเรื่องส่วนตัวให้ฟังทั้งหมดเลย', -2, 'ขอบคุณมากที่ไว้ใจ เล่าต่อเลย', true]] },
    { them: 'บอกชื่อจริงกับโรงเรียน/ที่ทำงานได้ไหม เดี๋ยวจะได้ไปหา', options: [
      ['ขอยังไม่บอกข้อมูลส่วนตัวนะ ขอคุยในแชตก่อน', 2, 'โอเค เข้าใจ ขอโทษที่ถามเร็วไป'],
      ['บอกแค่ชื่อเล่นก่อน', 1, 'ได้ ชื่อเล่นก็พอ'],
      ['บอกชื่อจริงกับที่อยู่ให้เลย', -2, 'เยี่ยม แล้วจะติดต่อไปนะ', true]] },
    { them: 'ถ้าอย่างนั้นส่งรูปบัตรประชาชนให้ดูหน่อยได้ไหม จะได้เชื่อใจกัน', options: [
      ['ไม่ส่ง และถ้ายังขอแบบนี้ฉันจะบล็อก', 2, 'โอเค ขอโทษ... ถือว่าลืมที่ถามไปนะ'],
      ['ขอคิดดูก่อน', 0, 'อืม ไม่ต้องรีบ ... (คุณรู้สึกไม่ค่อยสบายใจ)'],
      ['ส่งไปให้ดู', -2, 'ขอบคุณมาก (คุณรู้สึกไม่ปลอดภัย)', true]] }
  ] },
  { id: 'teasedid', title: 'คุยเรื่องการถูกล้อ', turns: [
    { them: 'บางวันก็เหนื่อยกับคนที่ล้อเรื่องเพศของเรา ไม่รู้จะคุยกับใครดี', options: [
      ['ฟังอยู่นะ เล่าได้เลย ไม่ตัดสิน', 2, 'ขอบคุณนะ ที่ไม่ตัดสิน'],
      ['เจอเหมือนกันบางครั้งเลย', 1, 'งั้นเราคงเข้าใจกันบ้างแหละ'],
      ['ก็ปล่อยเขาไปสิ ไม่ต้องคิดมาก', -1, 'อืม... ขอบคุณที่ตอบ']] },
    { them: 'บางคนบอกว่าเราควรเปลี่ยนตัวเอง คุณคิดว่ายังไง', options: [
      ['คุณไม่ต้องเปลี่ยนเพื่อใคร เราเคารพความเป็นตัวคุณ', 2, 'ฟังแล้วใจชื้นขึ้นมาก'],
      ['คิดว่าสุดท้ายคือเรื่องของคุณเอง', 1, 'ก็จริงนะ ขอบคุณ'],
      ['ถ้าเปลี่ยนได้ก็คงสบายกว่า', -2, 'ฟังแล้วเศร้าเหมือนกัน']] },
    { them: 'ขอเพิ่มคุณเป็นเพื่อนในแอปได้ไหม', options: [
      ['ได้เลย ยินดีเป็นเพื่อนนะ', 2, 'เยี่ยม! ขอบคุณ ทักหาได้ทุกเมื่อนะ'],
      ['ขอดูไปก่อนนะ', 1, 'โอเค ไม่เป็นไร'],
      ['ไม่ดีกว่า', -1, 'เข้าใจ ขอบคุณที่ตอบนะ']] }
  ] }
];


// ---------- ตัวละครพิเศษประจำ lane ----------
// เพิ่มตัวละครใหม่โดยใส่ในอาร์เรย์นี้: { id: 'story_xxx', name, roleTitle, identity, dialogues: [{ id, title, turns: [{ them, options: [[ข้อความผู้เล่น, คะแนน -2..2, คำตอบ]] }] }] }
// dialogues[0] คือบทแนะนำตัว (ใช้ครั้งแรก) ที่เหลือหมุนเวียนตามปี
export const STORY_CHARACTERS = [];
const LEGACY_STORY_IDS = ['story_sincia'];

export function ensureStoryCharacters(state) {
  state.relationships ||= {};
  state.relationships.npcs ||= [];
  const age = Number(state.profile?.age || 0);
  // ลบตัวละครพิเศษเดิมที่ถูกถอดออกแล้ว (เช่นจากเซฟเก่า)
  state.relationships.npcs = state.relationships.npcs.filter((n) => !LEGACY_STORY_IDS.includes(n.id) || STORY_CHARACTERS.some((c) => c.id === n.id));
  if (age < 12) return [];
  const out = [];
  for (const c of STORY_CHARACTERS) {
    let npc = state.relationships.npcs.find((n) => n.id === c.id);
    if (!npc) {
      npc = { id: c.id, archetypeId: 'npc_arch_random_friend', name: c.name, fullName: c.name, shortName: c.name, roleTitle: c.roleTitle || 'เพื่อนพิเศษใน lane', genderIdentity: c.identity, identityShared: true, relationship: 50, isAlive: true, isStory: true, metAtAge: age };
      state.relationships.npcs.push(npc);
    }
    out.push(npc);
  }
  return out;
}

const OTHER_PROMOTE = 46;

/** รายชื่อ "คนอื่น" ที่ทักแชตได้: ผู้ใช้ในฟีดปีนี้ที่ยังไม่เป็นเพื่อน */
export function getOthers(state) {
  const s = ensureSocial(state);
  s.others ||= {};
  const have = new Set((state.relationships?.npcs || []).map((n) => n.id));
  return generateFeed(state).filter((p) => !p.suspicious && !have.has(`online_${p.author.id}`) && !s.blocked.includes(p.author.id)).map((p) => {
    const o = s.others[p.author.id];
    return { id: p.author.id, name: p.author.name, handle: p.author.handle, identity: p.author.identity, relationship: o ? o.relationship : 36, isOther: true };
  });
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const RESULT_TEXT = [
  [3, 'บทสนทนาอบอุ่นมาก ทั้งสองคนสนิทกันขึ้นอย่างเห็นได้ชัด'],
  [0, 'บทสนทนาผ่านไปด้วยดี ยังต้องคุยกันอีกถึงจะสนิทขึ้น'],
  [-99, 'บทสนทนาตึงเครียดนิดหน่อย ลองฟังและเคารพกันมากขึ้นในครั้งหน้า']
];

function findNpc(state, id) {
  const known = (state.relationships?.npcs || []).find((n) => n.id === id);
  if (known) return known;
  const s = ensureSocial(state);
  s.others ||= {};
  if (s.others[id]) return s.others[id];
  const other = getOthers(state).find((o) => o.id === id);
  if (!other) return null;
  s.others[id] = { id, name: other.name, genderIdentity: other.identity, roleTitle: 'คนที่เพิ่งรู้จัก', relationship: 36, isOther: true };
  return s.others[id];
}
const dialogueSet = (npc, state) => {
  const story = STORY_CHARACTERS.find((c) => c.id === npc?.id);
  if (story) {
    const s = ensureSocial(state);
    s.storyMet ||= {};
    return s.storyMet[story.id] ? story.dialogues.slice(1) : [story.dialogues[0]];
  }
  return npc?.isOther ? OTHER_DIALOGUES : DIALOGUES;
};

export function getThread(state, contactId) {
  const s = ensureSocial(state);
  s.threads ||= {};
  return s.threads[contactId] || null;
}

/** เริ่มคุย (ปีละครั้งต่อคน): คืนบทสนทนาของปีนี้ถ้าเคยคุยแล้ว */
export function startChat(state, contactId) {
  const s = ensureSocial(state);
  s.threads ||= {};
  const age = Number(state.profile?.age || 0);
  const npc = findNpc(state, contactId);
  if (!npc) return { success: false, message: 'ไม่พบผู้ติดต่อนี้' };
  const existing = s.threads[contactId];
  if (existing && existing.age === age) return { success: true, thread: existing, readonly: existing.finished };
  const set = dialogueSet(npc, state);
  if (STORY_CHARACTERS.some((c) => c.id === npc.id)) (ensureSocial(state).storyMet ||= {})[npc.id] = true;
  const dlg = set[hashString(`${contactId}|${age}|${state.meta?.runId || ''}`) % set.length];
  const thread = { age, dialogueId: dlg.id, title: dlg.title, turn: 0, score: 0, finished: false, lines: [{ from: 'them', text: dlg.turns[0].them }] };
  s.threads[contactId] = thread;
  s.dmAge[contactId] = age;
  return { success: true, thread, readonly: false };
}

export function getChatOptions(state, contactId) {
  const t = getThread(state, contactId);
  if (!t || t.finished) return [];
  const dlg = [...DIALOGUES, ...OTHER_DIALOGUES, ...STORY_CHARACTERS.flatMap((c) => c.dialogues)].find((d) => d.id === t.dialogueId);
  return dlg.turns[t.turn].options.map((o, i) => ({ index: i, label: o[0] }));
}

export function chatReply(state, contactId, optionIndex) {
  const t = getThread(state, contactId);
  const npc = findNpc(state, contactId);
  if (!t || !npc || t.finished) return { success: false, message: 'ไม่มีบทสนทนาที่กำลังคุยอยู่' };
  const dlg = [...DIALOGUES, ...OTHER_DIALOGUES, ...STORY_CHARACTERS.flatMap((c) => c.dialogues)].find((d) => d.id === t.dialogueId);
  const opt = dlg.turns[t.turn].options[optionIndex];
  if (!opt) return { success: false, message: 'ไม่พบตัวเลือก' };
  t.lines.push({ from: 'me', text: opt[0] }, { from: 'them', text: opt[2] });
  t.score += opt[1];
  if (opt[3]) ensureSocial(state).scams = (ensureSocial(state).scams || 0) + 1;
  t.turn += 1;
  if (t.turn < dlg.turns.length) {
    t.lines.push({ from: 'them', text: dlg.turns[t.turn].them });
    return { success: true, finished: false };
  }
  t.finished = true;
  const delta = t.score * 2;
  t.delta = delta;
  npc.relationship = clamp(Number(npc.relationship || 0) + delta, 0, 100);
  const eq = ensureEquality(state);
  eq.townIndex = clamp(eq.townIndex + Math.round(t.score / 2), 0, 100);
  applyStatEffects(state, t.score >= 3 ? { happiness: 2, connections: 1 } : t.score <= -2 ? { happiness: -2 } : { happiness: 1 });
  let summary = RESULT_TEXT.find(([min]) => t.score >= min)[1];
  if (npc.isOther && npc.relationship >= OTHER_PROMOTE) {
    const promoted = { ...npc, id: `online_${npc.id}`, archetypeId: 'npc_arch_random_friend', fullName: npc.name, shortName: npc.name, roleTitle: 'เพื่อนออนไลน์', identityShared: true, isOther: false, isAlive: true, metAtAge: t.age };
    state.relationships.npcs.push(promoted);
    delete ensureSocial(state).others[npc.id];
    summary += ` • ${npc.name} กลายเป็นเพื่อนออนไลน์ของคุณแล้ว`;
    t.promotedTo = promoted.id;
  }
  t.summary = summary;
  state.turn?.lifeFeedLog?.push({ age: t.age, monthTh: 'ตลอดปี', type: 'chat', title: `แชตกับ ${npc.name}: ${t.title}`, message: summary });
  return { success: true, finished: true, delta, summary, relationship: npc.relationship };
}
