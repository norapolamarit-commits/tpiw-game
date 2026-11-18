import test from 'node:test';
import assert from 'node:assert/strict';
import { CoachRequestSchema, generateEqualityCoaching, validateCoach } from '../server/ai_equality.js';

const req = { age: 20, total: 5, avgScore: 0.2, trend: 0, weakIdentities: ['trans_man'], weakContexts: ['work'], strongIdentities: [], recentTones: ['ignore'] };

test('request schema rejects unknown identities', () => {
  assert.ok(CoachRequestSchema.parse(req));
  assert.throws(() => CoachRequestSchema.parse({ ...req, weakIdentities: ['x'] }));
});

test('validateCoach rejects stigmatizing or non-Thai output', () => {
  const ok = { coachingTh: 'คุณเริ่มเข้าใจความแตกต่างมากขึ้น ลองฝึกต่อในที่ทำงาน', focusIdentities: ['trans_man'], focusContexts: ['work'], nextScenarioIdeaTh: 'เพื่อนร่วมงานขอให้เรียกชื่อใหม่' };
  assert.ok(validateCoach(ok));
  assert.throws(() => validateCoach({ ...ok, coachingTh: 'English only text that is long enough here' }));
  assert.throws(() => validateCoach({ ...ok, coachingTh: 'พวกเขาเป็นคนผิดปกติ ควรปรับตัวให้ดีขึ้นอีกมาก' }));
});

test('generateEqualityCoaching uses Pathumma and fails without key', async () => {
  const ok = { coachingTh: 'คุณเริ่มเข้าใจความแตกต่างมากขึ้น ลองฝึกต่อในที่ทำงาน', focusIdentities: ['trans_man'], focusContexts: ['work'], nextScenarioIdeaTh: 'เพื่อนร่วมงานขอให้เรียกชื่อใหม่' };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: JSON.stringify(ok) }) });
  assert.deepEqual(await generateEqualityCoaching(req, { fetchImpl, env: { PATHUMMA_API_KEY: 'k' } }), ok);
  await assert.rejects(() => generateEqualityCoaching(req, { env: {} }));
});

import { extractJson, generateEqualityCoachingPathumma } from '../server/ai_equality.js';

test('pathumma adapter sends configured request and validates reply', async () => {
  const ok = { coachingTh: 'คุณเริ่มเข้าใจความแตกต่างมากขึ้น ลองฝึกต่อในที่ทำงาน', focusIdentities: ['trans_man'], focusContexts: ['work'], nextScenarioIdeaTh: 'เพื่อนร่วมงานขอให้เรียกชื่อใหม่' };
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ content: '<think>คิด</think>```json\n' + JSON.stringify(ok) + '\n```' }) }; };
  const env = { PATHUMMA_API_URL: 'https://example.test/textqa/completion', PATHUMMA_API_KEY: 'k' };
  assert.deepEqual(await generateEqualityCoachingPathumma(req, { fetchImpl, env }), ok);
  assert.equal(seen.url, env.PATHUMMA_API_URL);
  assert.equal(seen.init.headers.Apikey, 'k');
  assert.equal(seen.init.body.get('system_prompt').includes('คุณเป็นโค้ช'), true);
  await assert.rejects(() => generateEqualityCoachingPathumma(req, { fetchImpl, env: {} }));
  assert.throws(() => extractJson('ไม่มี json'));
});
