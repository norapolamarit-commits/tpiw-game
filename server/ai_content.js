import { z } from 'zod';
import { extractJson } from './ai_equality.js';
import { assertSafeAiText } from './ai_safety.js';
import { callPathumma } from './pathumma_client.js';

export const IDENTITY_IDS = ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'];
export const CONTEXT_IDS = ['school', 'work', 'family', 'public'];
const TONES = ['defend', 'respect', 'ignore', 'disrespect'];

export const ScenarioRequestSchema = z.object({
  age: z.number().int().min(6).max(110),
  context: z.enum(CONTEXT_IDS),
  focusIdentities: z.array(z.enum(IDENTITY_IDS)).max(3),
  weakContexts: z.array(z.enum(CONTEXT_IDS)).max(2),
  recentTones: z.array(z.enum(TONES)).max(20)
});

export const ScenarioSchema = z.object({
  title: z.string().min(5).max(90),
  text: z.string().min(30).max(420),
  lesson: z.string().min(20).max(260),
  context: z.enum(CONTEXT_IDS),
  identities: z.array(z.enum(IDENTITY_IDS)).min(1).max(4),
  minAge: z.number().int().min(6).max(110),
  maxAge: z.number().int().min(6).max(110)
});

export const DialogueRequestSchema = z.object({
  age: z.number().int().min(6).max(110),
  context: z.enum(CONTEXT_IDS)
});

const lines = (min, max) => z.array(z.string().min(6).max(220)).min(min).max(max);
export const DialogueSchema = z.object({
  reactions: z.object({ defend: lines(1, 3), respect: lines(1, 3), ignore: lines(1, 3), disrespect: lines(1, 3) }),
  questions: z.array(z.object({ q: z.string().min(6).max(220), good: z.string().min(4).max(200), mid: z.string().min(3).max(200), bad: z.string().min(3).max(200) })).min(2).max(4),
  closings: z.object({ good: lines(1, 2), mid: lines(1, 2), bad: lines(1, 2) })
});

export function validateScenario(raw, age = 18) {
  const sc = ScenarioSchema.parse(raw);
  for (const value of [sc.title, sc.text, sc.lesson]) assertSafeAiText(value, { age, maxLength: 420 });
  if (!sc.text.includes('({who})') && !sc.text.includes('{who}')) throw new Error('ต้องมีตัวแทน {who}');
  if (sc.maxAge < sc.minAge) throw new Error('ช่วงอายุไม่ถูกต้อง');
  return sc;
}

export function validateDialogue(raw, age = 18) {
  const d = DialogueSchema.parse(raw);
  const all = [...Object.values(d.reactions).flat(), ...d.questions.flatMap((x) => [x.q, x.good, x.mid, x.bad]), ...Object.values(d.closings).flat()];
  for (const value of all) assertSafeAiText(value, { age, maxLength: 220 });
  return d;
}

const SCENARIO_SYSTEM = 'คุณเขียนสถานการณ์พบปะสำหรับเกมที่ปลูกฝังการเคารพความแตกต่างทางเพศ แนวตลกปั่นๆ เบาสมอง ล้อเลียนเฉพาะคนที่มีอคติหรือสถานการณ์ ห้ามล้อเลียนตัวตนทางเพศของใคร ข้อความภาษาไทยเท่านั้น ห้ามอีโมจิ ใช้ ({who}) แทนป้ายเพศของอีกฝ่ายอย่างน้อยหนึ่งครั้ง เหมาะกับช่วงอายุที่กำหนด สร้างสถานการณ์ที่ผู้เล่นฝึกจุดอ่อนตามข้อมูลสถิติรวม';
const DIALOGUE_SYSTEM = 'คุณเขียนบทพูดสำหรับบทสนทนาพบปะในเกมที่ปลูกฝังการเคารพความแตกต่างทางเพศ แนวตลกเบาๆ เป็นกันเอง ข้อความภาษาไทยเท่านั้น ห้ามอีโมจิ ไม่ตีตราใคร ปฏิกิริยาของอีกฝ่ายขึ้นกับน้ำเสียงของผู้เล่น (ปกป้อง/เคารพ/เมินเฉย/เหยียด) คำถามต้องเข้ากับบริบท แต่ละคำถามต้องมีคำตอบของผู้เล่น 3 แบบ (good/mid/bad) เป็น "ประโยคที่คนพูดกันจริงในชีวิตประจำวัน" เป็นคำพูดตรงๆ ไม่ใช่คำบรรยาย และตอบตรงกับคำถามนั้น';

/** เรียก Pathumma ตามรูปแบบ textqa.generate ของ AIforThai */
export async function callStructured({ system, user }, options = {}) {
  return extractJson(await callPathumma({ system, user, temperature: 0.8 }, options));
}

export async function generateScenario(req, opts = {}) {
  const raw = await callStructured({ schema: ScenarioSchema, name: 'equality_scenario', system: SCENARIO_SYSTEM, user: JSON.stringify(req) }, opts);
  return validateScenario(raw, req.age);
}

export async function generateDialogue(req, opts = {}) {
  const raw = await callStructured({ schema: DialogueSchema, name: 'encounter_dialogue', system: DIALOGUE_SYSTEM, user: JSON.stringify(req) }, opts);
  return validateDialogue(raw, req.age);
}
