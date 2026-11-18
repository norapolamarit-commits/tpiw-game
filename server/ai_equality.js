import { z } from 'zod';
import { assertSafeAiText } from './ai_safety.js';
import { callPathumma } from './pathumma_client.js';

export const IDENTITY_IDS = ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'];
export const CONTEXT_IDS = ['school', 'work', 'family', 'public'];

export const CoachRequestSchema = z.object({
  age: z.number().int().min(0).max(110),
  total: z.number().int().min(0).max(500),
  avgScore: z.number().min(-2).max(2),
  trend: z.number().min(-4).max(4),
  weakIdentities: z.array(z.enum(IDENTITY_IDS)).max(9),
  weakContexts: z.array(z.enum(CONTEXT_IDS)).max(4),
  strongIdentities: z.array(z.enum(IDENTITY_IDS)).max(9),
  recentTones: z.array(z.enum(['defend', 'respect', 'ignore', 'disrespect'])).max(20)
});

export const CoachSchema = z.object({
  coachingTh: z.string().min(20).max(500),
  focusIdentities: z.array(z.enum(IDENTITY_IDS)).max(3),
  focusContexts: z.array(z.enum(CONTEXT_IDS)).max(2),
  nextScenarioIdeaTh: z.string().min(10).max(300)
});

export function validateCoach(result, age = 18) {
  const c = CoachSchema.parse(result);
  assertSafeAiText(c.coachingTh, { age, maxLength: 500 });
  assertSafeAiText(c.nextScenarioIdeaTh, { age, maxLength: 300 });
  return c;
}

const COACH_SYSTEM_PROMPT = 'คุณเป็นโค้ชของเกมที่ปลูกฝังการเคารพความแตกต่างทางเพศ วิเคราะห์พฤติกรรมของผู้เล่นจากสถิติแล้วแนะนำอย่างสุภาพ ให้กำลังใจ ไม่ตัดสินหรือตีตราผู้เล่นหรือกลุ่มคนใด เลือกกลุ่มอัตลักษณ์และบริบทที่ผู้เล่นควรฝึกต่อ (ไม่เกิน 3 และ 2 ตามลำดับ) และเสนอไอเดียสถานการณ์ถัดไปที่ท้าทายแต่เหมาะกับช่วงวัย ข้อมูลเป็นสถิติรวมเท่านั้น';

export function extractJson(text) {
  const raw = String(text || '').replace(/```(?:json)?/gi, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('คำตอบไม่มี JSON');
  return JSON.parse(raw.slice(start, end + 1));
}

export async function generateEqualityCoachingPathumma(context, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const schemaHint = `ตอบเป็น JSON เท่านั้น รูปแบบ {"coachingTh": string, "focusIdentities": string[] (เลือกจาก ${IDENTITY_IDS.join(', ')} ไม่เกิน 3), "focusContexts": string[] (เลือกจาก ${CONTEXT_IDS.join(', ')} ไม่เกิน 2), "nextScenarioIdeaTh": string}`;
  const content = await callPathumma({ system: `${COACH_SYSTEM_PROMPT}\n${schemaHint}`, user: JSON.stringify(context), temperature: 0.3 }, { fetchImpl, env });
  return validateCoach(extractJson(content), context.age);
}

export async function generateEqualityCoaching(context, options = {}) {
  return generateEqualityCoachingPathumma(context, options);
}
