import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRelationshipEndingCard } from '../js/ui/modals_ending_ui.js';

test('ending card summarizes relationship stages, discovery, reputation and identity history safely', () => {
  const html = renderRelationshipEndingCard({
    relationships: { npcs: [{ stage: 'close_friend' }, { stage: 'married' }, { stage: 'ex' }, { stage: 'secret' }] },
    social: { caughtCheatingCount: 2, commentsKind: 3, commentsMean: 1 },
    profile: { genderIdentity: 'nonbinary', identityHistory: [{ from: 'woman', to: 'nonbinary' }] }
  });
  for (const text of ['เรื่องราวความรัก', 'เพื่อนสนิท 1', 'แต่งงาน 1', 'แฟนเก่า 1', 'แอบคบ 1', 'ถูกจับได้ 2 ครั้ง', 'ชื่อเสียงออนไลน์ 1']) assert.match(html, new RegExp(text));
  assert.ok(!html.includes('undefined'));
});
