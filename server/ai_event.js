import { z } from 'zod';
import { assertSafeAiText } from './ai_safety.js';
import { callPathumma } from './pathumma_client.js';
import { extractJson } from './ai_equality.js';

const EffectSchema = z.object({
  health: z.number().int(), happiness: z.number().int(), intelligence: z.number().int(),
  connections: z.number().int(), merit: z.number().int(), appearance: z.number().int(), cash: z.number().int()
});

export const AiEventSchema = z.object({
  title: z.string().min(5).max(100),
  description: z.string().min(30).max(800),
  category: z.enum(['daily_life', 'education', 'family', 'friendship', 'romance', 'diversity', 'career', 'finance', 'health', 'social_issues', 'opportunity', 'rare_events']),
  choices: z.array(z.object({
    label: z.string().min(4).max(150),
    consequenceSummary: z.string().min(5).max(200),
    effects: EffectSchema
  })).min(2).max(4),
  referencedNpcIds: z.array(z.string()),
  futureStoryHooks: z.array(z.string().min(4).max(150)).max(3),
  educationalTopic: z.string()
});

const EFFECT_LIMITS = { health: 8, happiness: 8, intelligence: 8, connections: 8, merit: 5, appearance: 5, cash: 5000 };

export function validateAiProposal(proposal, context) {
  const event = AiEventSchema.parse(proposal);
  const narrative = [event.title, event.description, ...event.choices.flatMap((choice) => [choice.label, choice.consequenceSummary])];
  for (const text of narrative) assertSafeAiText(text, { age: context.age, maxLength: 800 });
  if (!narrative.every((text) => /[\u0E00-\u0E7F]/u.test(text))) {
    throw new Error('เนื้อหาเหตุการณ์ต้องเป็นภาษาไทย');
  }
  if (new Set(event.choices.map((choice) => choice.label)).size !== event.choices.length ||
      new Set(event.choices.map((choice) => JSON.stringify(choice.effects))).size !== event.choices.length) {
    throw new Error('ตัวเลือกต้องมีผลที่แตกต่างกัน');
  }
  const available = new Set((context.npcs || []).filter((npc) => npc.isAlive !== false && !npc.unavailable).map((npc) => npc.id));
  if (event.referencedNpcIds.some((id) => !available.has(id))) throw new Error('เหตุการณ์อ้างถึงตัวละครที่ไม่พร้อม');
  const storyText = narrative.join(' ');
  for (const npc of context.npcs || []) {
    const name = String(npc.name || '').trim();
    if (name.length < 2 || !storyText.includes(name)) continue;
    if (npc.isAlive === false || npc.unavailable) throw new Error('เรื่องเล่าอ้างถึงตัวละครที่ไม่พร้อม');
    if (!event.referencedNpcIds.includes(npc.id)) throw new Error('เรื่องเล่าไม่ได้ระบุรหัสตัวละครที่กล่าวถึง');
  }
  if ((context.recentEvents || []).some((recent) => recent.title === event.title)) throw new Error('เหตุการณ์ซ้ำกับเรื่องล่าสุด');
  if (!context.eligibleCategories?.includes(event.category)) throw new Error('หมวดเหตุการณ์ไม่เหมาะกับสถานะปัจจุบัน');
  const age = Number(context.age);
  if (Number.isFinite(age) && age < 18 && ['career', 'finance', 'romance'].includes(event.category)) throw new Error('หมวดเหตุการณ์ไม่เหมาะกับวัย');
  if (Number.isFinite(age) && age < 13 && /มหาวิทยาลัย|ฝึกงาน|แต่งงาน|คู่สมรส/u.test(storyText)) throw new Error('เรื่องเล่าไม่เหมาะกับวัย');
  if (context.careerAndEdu && !context.careerAndEdu.mainJobId && /เพื่อนร่วมงาน|หัวหน้าแผนก|เลื่อนตำแหน่ง/u.test(storyText)) throw new Error('เรื่องเล่าขัดกับประวัติการทำงาน');
  if (context.profile && !context.partner && /คู่สมรสของคุณ|แฟนของคุณ|คนรักของคุณ/u.test(storyText)) throw new Error('เรื่องเล่าขัดกับความสัมพันธ์ปัจจุบัน');
  for (const choice of event.choices) {
    if (!Object.entries(choice.effects).some(([, value]) => value !== 0)) throw new Error('ตัวเลือกไม่มีผลต่อชีวิต');
    for (const [stat, value] of Object.entries(choice.effects)) {
      if (Math.abs(value) > EFFECT_LIMITS[stat]) throw new Error('ผลกระทบเกินกติกาเกม');
    }
  }
  return event;
}

export async function generateAiProposal(context, options = {}) {
  const content = await callPathumma({
    system: 'คุณเขียนเหตุการณ์ชีวิตสำหรับเกมภาษาไทย สร้างเรื่องที่เคารพข้อเท็จจริงเดิม ไม่มีการเปิดเผยตัวตนทางเพศแทนผู้อื่น ผลลัพธ์ทุกข้อเป็นข้อเสนอเท่านั้น ห้ามแก้ค่าสถานะโดยตรง ใช้ชื่อ NPC เฉพาะผู้ที่อยู่ในรายการและยังมีชีวิต อย่าให้รางวัลซ้ำหรือขัดกับประวัติความสัมพันธ์ ตอบ JSON ตามโครงสร้าง title, description, category, choices, referencedNpcIds, futureStoryHooks, educationalTopic',
    user: JSON.stringify(context), temperature: 0.7, maxTokens: 1600
  }, options);
  return validateAiProposal(extractJson(content), context);
}

export function proposalToCard(proposal, id, age) {
  return {
    event_id: id,
    title_th: proposal.title,
    description_th: proposal.description,
    category: proposal.category,
    min_age: age,
    max_age: age,
    rarity: 'uncommon',
    source_type: 'random_event',
    aiGenerated: true,
    educationalTopic: proposal.educationalTopic || undefined,
    futureStoryHooks: proposal.futureStoryHooks,
    referencedNpcIds: proposal.referencedNpcIds,
    choices: proposal.choices.map((choice, index) => ({
      choice_id: `c${index + 1}`,
      label_th: choice.label,
      preview_text_th: choice.consequenceSummary,
      outcome_text_th: choice.consequenceSummary,
      stat_effects: choice.effects,
      req_stats: {}, req_flags: [], grants_flags: [], removes_flags: []
    }))
  };
}
