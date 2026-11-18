/**
 * js/engine/ai_content_client.js
 * AI สร้างสถานการณ์ใหม่ (จากผลวิเคราะห์) และ AI สุ่มบทสนทนาใหม่ ผ่านเซิร์ฟเวอร์
 * ถ้าเรียก AI ไม่ได้ จะสร้างสถานการณ์ด้วยระบบสุ่มประกอบในเครื่อง (local) แทนเสมอ
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { FOCUS_CONTEXT_IDS, FOCUS_IDENTITY_IDS, KID_IDENTITY_IDS, analyzeEqualityBehavior, ensureEquality, getFocus, hashString, mulberry32 } from './gender_encounter_engine.js';

const THAI = /[฀-๿]/u;
const BAD = /ผิดปกติ|วิปริต|น่ารังเกียจ|เป็นโรค|ป่วยจิต|\p{Extended_Pictographic}/u;
const okText = (t, max = 460, min = 6) => typeof t === 'string' && THAI.test(t) && t.length >= min && t.length <= max && !BAD.test(t);
const CAP_SCENARIOS = 24;
const CAP_LINES = 60;

export function validateScenarioClient(sc) {
  return Boolean(sc) && okText(sc.title, 100) && okText(sc.text, 460) && (sc.text.includes('({who})') || sc.text.includes('{who}')) && okText(sc.lesson, 280) &&
    FOCUS_CONTEXT_IDS.includes(sc.context) && Array.isArray(sc.identities) && sc.identities.length >= 1 && sc.identities.length <= 4 && sc.identities.every((i) => FOCUS_IDENTITY_IDS.includes(i)) &&
    Number.isInteger(sc.minAge) && Number.isInteger(sc.maxAge) && sc.minAge <= sc.maxAge;
}

export function validateDialogueClient(d) {
  if (!d || typeof d !== 'object') return false;
  const groups = [d.reactions?.defend, d.reactions?.respect, d.reactions?.ignore, d.reactions?.disrespect, d.closings?.good, d.closings?.mid, d.closings?.bad];
  const qs = d.questions;
  return groups.every((g) => Array.isArray(g) && g.length >= 1 && g.length <= 4 && g.every((t) => okText(t, 230))) &&
    Array.isArray(qs) && qs.length >= 1 && qs.length <= 4 && qs.every((x) => x && okText(x.q, 230) && okText(x.good, 210, 4) && okText(x.mid, 210, 3) && okText(x.bad, 210, 3));
}

// ---------- ตัวสร้างสถานการณ์ในเครื่อง (สำรอง) ----------
const LOCAL = {
  school: { places: ['ห้องสมุดโรงเรียน', 'สนามบาสเก็ตบอล', 'โรงอาหาร', 'ห้องชมรมดนตรี'], },
  work: { places: ['ห้องพักพนักงาน', 'ลิฟต์ตอนเช้า', 'โต๊ะประชุมกลม', 'มุมกาแฟหน้าออฟฟิศ'] },
  family: { places: ['โต๊ะกินข้าวหลังบ้าน', 'ระเบียงบ้านญาติ', 'ห้องครัวตอนเย็น', 'งานเลี้ยงวันเกิดคุณยาย'] },
  public: { places: ['ป้ายรถเมล์', 'ตลาดนัดเย็น', 'สวนสาธารณะ', 'ห้างสรรพสินค้า'] }
};
const HOOKS = [
  ['ถูกบอกว่า "งานแบบนี้ไม่เหมาะกับเพศเธอ" ทั้งที่ทำได้ดีมาก', 'งานไม่มีเพศ'],
  ['ถูกถามว่า "ทำไมแต่งตัวแบบนี้" ทั้งที่แค่แต่งตัวไปซื้อของ', 'คำถามที่ไม่จำเป็น'],
  ['ถูกแซวว่าเป็นแฟนกับเพื่อนอีกเพศ ทั้งที่แค่นั่งกินขนมด้วยกัน', 'เพื่อนก็คือเพื่อน'],
  ['ถูกผู้ใหญ่เหมารวมว่า "พวกนี้ก็เป็นแบบนี้แหละ" โดยไม่ถามความจริง', 'การเหมารวม'],
  ['ถูกเรียกชื่อและคำสรรพนามผิดต่อหน้าคนอื่นอีกครั้ง', 'เรียกให้ถูกคือความเคารพ'],
  ['ถูกขอให้พิสูจน์ว่า "เป็นแบบนั้นจริงไหม" ต่อหน้าคนหมู่มาก', 'ไม่ต้องพิสูจน์ตัวตน'],
  ['ถูกกันออกจากกลุ่มเพราะ "คุยกันไม่ถนัด" ทั้งที่ยังไม่เคยเริ่มคุย', 'ลองคุยก่อนตัดสิน'],
  ['ถูกล้อเรื่องรูปร่างและท่าทางเสียงดังจนทุกคนหันมามอง', 'การล้อไม่ใช่เรื่องตลก']
];
const TAILS = [
  'คนรอบข้างทำหน้าเหมือนดูละครหลังข่าวที่ไม่มีใครอยากลุกไปไหน',
  'เสียงพัดลมในห้องดังกว่าเสียงตอบของทุกคนรวมกัน',
  'ทุกคนจับจ้องเหมือนรอให้คุณเป็นพระเอกประจำวัน',
  'แมวข้างทางเดินผ่านพร้อมสายตาตัดสินใจแทนมนุษย์',
  'มีคนหยิบโทรศัพท์ขึ้นมา แล้วลืมว่าจะถ่ายหรือจะช่วยดี',
  'บรรยากาศเงียบจนได้ยินเสียงกระเพาะอาหารของใครสักคน'
];
const LESSONS = ['ความเคารพเริ่มจากการไม่เหมารวม และถามอีกฝ่ายด้วยความสุภาพ', 'การช่วยเพียงประโยคเดียวอาจเปลี่ยนวันของใครบางคน', 'ทุกคนมีสิทธิ์เป็นตัวเองโดยไม่ต้องพิสูจน์กับใคร', 'ความสามารถและความตั้งใจไม่เกี่ยวกับเพศ'];

/** สร้างสถานการณ์ในเครื่อง: คงที่ตาม (run, age, ลำดับ) ไม่ซ้ำกับของเดิม */
export function generateLocalScenario(state, contextHint = null) {
  const eq = ensureEquality(state);
  const age = Number(state.profile?.age || 0);
  const n = (eq.aiScenarios || []).length;
  const rnd = mulberry32(hashString(`${state.meta?.runId || 'x'}|local|${age}|${n}`));
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const focus = getFocus(eq);
  const context = contextHint || (focus.contexts.length ? pick(focus.contexts) : pick(Object.keys(LOCAL)));
  const pool = age < 13 ? KID_IDENTITY_IDS : FOCUS_IDENTITY_IDS;
  const identity = focus.identities.filter((x) => pool.includes(x)).length ? pick(focus.identities.filter((x) => pool.includes(x))) : pick(pool);
  const place = pick(LOCAL[context].places);
  const [hook, key] = pick(HOOKS);
  return {
    id: `ai_local_${hashString(`${place}|${hook}|${n}|${age}`)}`, aiGenerated: true, source: 'local', context,
    title: `ที่${place}: ${key}`, text: `ที่${place} เพื่อน ({who}) ${hook} ${pick(TAILS)}`, lesson: pick(LESSONS),
    identities: [identity], minAge: Math.max(6, age - 2), maxAge: age + 3
  };
}

function storeScenario(state, sc) {
  const eq = ensureEquality(state);
  eq.aiScenarios ||= [];
  if (eq.aiScenarios.some((x) => x.id === sc.id)) return null;
  eq.aiScenarios.push(sc);
  if (eq.aiScenarios.length > CAP_SCENARIOS) eq.aiScenarios.shift();
  return sc;
}

function storeLines(state, d) {
  const eq = ensureEquality(state);
  const L = (eq.aiLines ||= { reactions: { defend: [], respect: [], ignore: [], disrespect: [] }, questions: {}, closings: { good: [], mid: [], bad: [] } });
  const add = (arr, items) => { for (const t of items) if (!arr.includes(t)) arr.push(t); if (arr.length > CAP_LINES) arr.splice(0, arr.length - CAP_LINES); };
  for (const k of Object.keys(L.reactions)) add(L.reactions[k], d.reactions[k]);
  for (const k of Object.keys(L.closings)) add(L.closings[k], d.closings[k]);
  return L;
}

const contextForAge = (state, rnd) => {
  const age = Number(state.profile?.age || 0);
  const list = ['public', 'family'];
  if (age <= 22) list.push('school');
  if (age >= 18) list.push('work');
  return list[Math.floor(rnd() * list.length)];
};

/** AI สร้างสถานการณ์ใหม่จากผลวิเคราะห์; ถ้าไม่สำเร็จใช้ตัวสร้างในเครื่อง */
export async function requestAiScenario(state, { fetchImpl = globalThis.fetch } = {}) {
  const eq = ensureEquality(state);
  const analysis = eq.localAnalysis || analyzeEqualityBehavior(state);
  eq.localAnalysis = analysis;
  const age = Number(state.profile?.age || 0);
  const rnd = mulberry32(hashString(`${state.meta?.runId || 'x'}|aiS|${age}|${(eq.aiScenarios || []).length}`));
  const context = analysis.weakContexts[0] || contextForAge(state, rnd);
  const req = { age: Math.max(6, age), context, focusIdentities: analysis.focus.identities.slice(0, 3), weakContexts: analysis.focus.contexts.slice(0, 2), recentTones: eq.history.slice(-20).map((h) => h.tone) };
  if (fetchImpl) {
    try {
      const res = await fetchImpl('/api/ai-scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
      if (res.ok) {
        const data = await res.json();
        if (data.aiGenerated && validateScenarioClient(data.data)) {
          const sc = storeScenario(state, { ...data.data, id: `ai_${hashString(data.data.title + data.data.text)}`, aiGenerated: true, source: 'ai' });
          if (sc) return { source: 'ai', scenario: sc };
        }
      }
    } catch { /* ใช้ตัวสร้างในเครื่อง */ }
  }
  return { source: 'local', scenario: storeScenario(state, generateLocalScenario(state, context)) };
}

/** AI สุ่มสร้างบทสนทนาใหม่ (ปฏิกิริยา คำถาม ตัวเลือก ประโยคปิด) เก็บเพิ่มเข้าคลังบทพูด */
export async function requestAiDialogue(state, { fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl) return { source: 'none' };
  const eq = ensureEquality(state);
  const age = Number(state.profile?.age || 0);
  const rnd = mulberry32(hashString(`${state.meta?.runId || 'x'}|aiD|${age}|${eq.history.length}`));
  const context = contextForAge(state, rnd);
  try {
    const res = await fetchImpl('/api/ai-dialogue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ age: Math.max(6, age), context }) });
    if (!res.ok) return { source: 'none' };
    const data = await res.json();
    if (!data.aiGenerated || !validateDialogueClient(data.data)) return { source: 'none' };
    const L = storeLines(state, data.data);
    (L.questions[context] ||= []);
    for (const q of data.data.questions) if (!L.questions[context].some((x) => x.q === q.q)) L.questions[context].push({ q: q.q, good: q.good, mid: q.mid, bad: q.bad });
    if (L.questions[context].length > CAP_LINES) L.questions[context].splice(0, L.questions[context].length - CAP_LINES);
    return { source: 'ai', context };
  } catch { return { source: 'none' }; }
}

/** เรียกครั้งเดียวต่อปี (ตอนเข้าช่วงอิสระ) แบบไม่บล็อกเกม */
export async function refreshAiContent(state, opts = {}) {
  const eq = ensureEquality(state);
  const age = Number(state.profile?.age || 0);
  if (age < 6 || eq.aiContentAge === age) return null;
  eq.aiContentAge = age;
  const [scenario, dialogue] = await Promise.all([requestAiScenario(state, opts), requestAiDialogue(state, opts)]);
  return { scenario, dialogue };
}
