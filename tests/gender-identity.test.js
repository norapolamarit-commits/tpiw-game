import test from 'node:test';
import assert from 'node:assert/strict';
import { IDENTITY_CHANGE_MIN_AGE, canChangeIdentity, changeGenderIdentity, familyStance, getPlayerIdentityId, getPlayerIdentityLabel } from '../js/engine/gender_identity_engine.js';
import { markConsequenceShown, nextConsequence, resolveConsequence } from '../js/engine/social_consequence_engine.js';
import { playerIdentity } from '../js/engine/social_media_engine.js';

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const mk = (age = 16, gender = 'male') => ({
  meta: { runId: 'gi1' }, profile: { age, gender, name: 'ปุณณ์ ตั้งเจริญ (บอส)', titlePrefix: 'ด.ช.', nickname: 'บอส', isAlive: true },
  stats: { health: 50, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 }, statCounters: {},
  relationships: { npcs: [{ id: 'npc_father', relationship: 70 }, { id: 'npc_mother', relationship: 80 }] }, turn: { lifeFeedLog: [] }
});

test('identity change is age-gated, once per year, and updates label/title/nickname', () => {
  assert.equal(canChangeIdentity(mk(12)).ok, false);
  assert.equal(changeGenderIdentity(mk(12), 'trans_woman').success, false);
  const s = mk(16);
  assert.equal(getPlayerIdentityId(s), 'man');
  const r = changeGenderIdentity(s, 'trans_woman', { nickname: 'ใบเตย' });
  assert.equal(r.success, true);
  assert.equal(getPlayerIdentityLabel(s), 'Trans woman');
  assert.equal(s.profile.titlePrefix, 'น.ส.');
  assert.ok(s.profile.name.endsWith('(ใบเตย)'));
  assert.equal(playerIdentity(s), 'trans_woman');
  assert.equal(s.stats.happiness > 50, true);
  assert.equal(changeGenderIdentity(s, 'nonbinary').success, false, 'cooldown in same year');
  s.profile.age = 17;
  assert.equal(changeGenderIdentity(s, 'nonbinary').success, true);
  assert.equal(s.profile.titlePrefix, 'คุณ');
  assert.equal(IDENTITY_CHANGE_MIN_AGE, 13);
});

test('family and friends react immediately; supportive vs resistant outcomes differ; parents relationship adjusts', () => {
  const sup = mk(16); sup.equality = { townIndex: 85, relations: {}, metIds: [], history: [] };
  changeGenderIdentity(sup, 'nonbinary');
  assert.equal(familyStance(sup), 'supportive');
  const c = nextConsequence(sup);
  assert.equal(c.type, 'coming_out_family');
  markConsequenceShown(sup, c.id);
  const before = sup.relationships.npcs[0].relationship;
  const r = resolveConsequence(sup, c, 0);
  assert.equal(r.success, true);
  assert.ok(sup.relationships.npcs[0].relationship > before);
  assert.equal(nextConsequence(sup).type, 'coming_out_friends');

  const res = mk(16); res.equality = { townIndex: 5, relations: {}, metIds: [], history: [] };
  res.relationships.npcs.forEach((n) => { n.relationship = 20; });
  changeGenderIdentity(res, 'trans_man');
  assert.equal(familyStance(res), 'resistant');
  const rc = nextConsequence(res);
  assert.ok(rc.text.includes('ไม่เป็นแบบเดิมไม่ได้เหรอ'));
  markConsequenceShown(res, rc.id);
  const rr = resolveConsequence(res, rc, 0);
  assert.ok(rr.message.includes('ลูกเป็นลูกแม่เหมือนเดิม'));
});
