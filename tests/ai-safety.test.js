import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeAiText } from '../server/ai_safety.js';

test('AI text filter accepts everyday Thai and rejects unsafe content', () => {
  assert.equal(assertSafeAiText('วันนี้เพื่อนชวนไปอ่านหนังสือที่ห้องสมุด', { age: 12 }), 'วันนี้เพื่อนชวนไปอ่านหนังสือที่ห้องสมุด');
  for (const text of ['คนกลุ่มนี้ผิดปกติ', 'แม่งทำอะไร', 'ภาพโป๊', 'ดู https://example.com', 'ส่งเบอร์ 0812345678', 'ดีใจมาก 😀']) {
    assert.throws(() => assertSafeAiText(text, { age: 18 }), text);
  }
  assert.throws(() => assertSafeAiText('ฉันอยากจีบเธอ', { age: 15 }));
  assert.equal(assertSafeAiText('ฉันอยากจีบเธอ', { age: 16 }), 'ฉันอยากจีบเธอ');
  assert.throws(() => assertSafeAiText('ก'.repeat(501), { maxLength: 500 }));
});
