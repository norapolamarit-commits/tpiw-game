import test from 'node:test';
import assert from 'node:assert/strict';
import { MIN_AGE, getMoves, listRelationshipNpcs, openness, performMove, stageOf } from '../js/engine/relationship_stage_engine.js';
import { markConsequenceShown, nextConsequence, resolveConsequence } from '../js/engine/social_consequence_engine.js';

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const mk = (age = 20, rel = 90, id = 'friend_a') => ({
  meta: { runId: 'rs1' }, profile: { age, gender: 'male', isAlive: true }, stats: { health: 50, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 }, statCounters: {},
  relationships: { npcs: [{ id: 'npc_father', relationship: 80, isAlive: true }, { id, name: 'ใบเตย', relationship: rel, genderIdentity: 'trans_woman', isAlive: true, roleTitle: 'เพื่อน' }], partner: null }, turn: { lifeFeedLog: [] }
});
const findOpen = (pred) => { for (let i = 0; i < 400; i++) { const s = mk(20, 99, `friend_${i}`); const o = openness(s, s.relationships.npcs[1]); if (pred(o)) return s; } throw new Error('no state'); };

test('parents are excluded; stage is inferred from closeness; moves are locked with reasons', () => {
  const s = mk(20, 50);
  assert.equal(listRelationshipNpcs(s).length, 1);
  assert.equal(stageOf(s.relationships.npcs[1]), 'friend');
  const mv = getMoves(s, s.relationships.npcs[1]);
  assert.equal(mv[0].id, 'best_friend');
  assert.equal(mv[0].locked, true);
  assert.ok(mv[0].reason.includes('65%'));
  const young = mk(14, 99); young.relationships.npcs[1].stage = 'close_friend';
  const ym = getMoves(young, young.relationships.npcs[1]);
  assert.ok(ym.find((m) => m.id === 'talk').locked);
  assert.ok(ym.find((m) => m.id === 'fling').reason.includes(String(MIN_AGE.fling)));
});

test('ladder: befriend -> best friend -> talk (may be declined) -> dating; declines are respectful and cost a year of asking', () => {
  const open = findOpen((o) => o.romance);
  const npc = open.relationships.npcs[1]; npc.stage = 'acquaintance'; npc.relationship = 50;
  assert.equal(performMove(open, npc.id, 'befriend').success, true);
  assert.equal(npc.stage, 'friend');
  npc.relationship = 80;
  assert.equal(performMove(open, npc.id, 'best_friend').success, true);
  const t = performMove(open, npc.id, 'talk');
  assert.equal(t.success, true);
  assert.equal(open.relationships.partner.status, 'crush');
  npc.relationship = 90;
  assert.equal(performMove(open, npc.id, 'ask_dating').success, true);
  assert.equal(open.relationships.partner.status, 'dating');
  assert.equal(stageOf(npc), 'dating');
  const closed = findOpen((o) => !o.romance);
  const cn = closed.relationships.npcs[1]; cn.stage = 'close_friend';
  const before = cn.relationship;
  const d = performMove(closed, cn.id, 'talk');
  assert.equal(d.success, false); assert.equal(d.declined, true);
  assert.ok(cn.relationship < before);
  assert.equal(closed.relationships.partner, null);
  assert.ok(performMove(closed, cn.id, 'talk').message.includes('ให้เวลา'));
});

test('fling needs mutual agreement and honesty: blocked when you have a partner; follow-up check-in next year', () => {
  const s = findOpen((o) => o.casual && o.romance);
  const npc = s.relationships.npcs[1]; npc.stage = 'close_friend'; npc.relationship = 90;
  const withPartner = JSON.parse(JSON.stringify(s)); withPartner.relationships.partner = { id: 'p', sourceNpcId: 'other', status: 'dating' };
  assert.ok(getMoves(withPartner, withPartner.relationships.npcs[1]).find((m) => m.id === 'fling').locked);
  assert.equal(performMove(s, npc.id, 'fling').success, true);
  assert.equal(npc.stage, 'fling');
  s.profile.age = 21;
  const c = nextConsequence(s);
  assert.equal(c.type, 'fling_talk');
  markConsequenceShown(s, c.id);
  resolveConsequence(s, c, 2);
  assert.equal(npc.stage, 'friend');
  const none = findOpen((o) => !o.casual);
  const nn = none.relationships.npcs[1]; nn.stage = 'close_friend';
  const r = performMove(none, nn.id, 'fling');
  assert.equal(r.declined, true);
  assert.equal(nn.stage, 'close_friend');
});

test('stepping back returns to friends and clears the partner link', () => {
  const s = findOpen((o) => o.romance);
  const npc = s.relationships.npcs[1]; npc.stage = 'close_friend'; npc.relationship = 90;
  performMove(s, npc.id, 'talk');
  assert.ok(s.relationships.partner);
  const r = performMove(s, npc.id, 'step_back');
  assert.equal(r.success, true);
  assert.equal(s.relationships.partner, null);
  assert.equal(npc.stage, 'friend');
});

import { COVER_COST, RING_COST, runYearlyRelationshipChecks, secretRiskPct } from '../js/engine/relationship_stage_engine.js';
import { socialReputation } from '../js/engine/social_consequence_engine.js';

const withPartner = (age = 25) => {
  const s = findOpen((o) => o.romance && o.casual);
  s.profile.age = age;
  s.finance = { cash: 200000, piggyBank: 0, netWorth: 0, investments: {}, ownedAssets: [], installments: [], activeLoans: [] };
  const npc = s.relationships.npcs[1]; npc.stage = 'close_friend'; npc.relationship = 95;
  performMove(s, npc.id, 'talk'); npc.relationship = 95; performMove(s, npc.id, 'ask_dating');
  return { s, npc };
};

test('dating -> engagement needs age, closeness and money for the ring; engaged unlocks wedding', () => {
  const { s, npc } = withPartner(25);
  assert.equal(npc.stage, 'dating');
  npc.relationship = 85;
  assert.equal(getMoves(s, npc).find((m) => m.id === 'engage').locked, true);
  npc.relationship = 95; s.finance.cash = 1000;
  assert.ok(getMoves(s, npc).find((m) => m.id === 'engage').reason.includes('เงินสด'));
  s.finance.cash = 100000;
  const r = performMove(s, npc.id, 'engage');
  assert.equal(r.success, true);
  assert.equal(s.finance.cash, 100000 - RING_COST);
  assert.equal(npc.stage, 'engaged');
  assert.ok(s.flags.includes('flag_has_wedding_ring'));
  assert.ok(getMoves(s, npc).some((m) => m.id === 'wedding' && !m.locked));
  const young = withPartner(17).s; assert.ok(!young.relationships.partner || young.relationships.partner.status !== 'married');
});

test('secret relationship: needs a partner, is risky, can be covered, confessed, or ended; risk grows with more secrets', () => {
  const { s, npc } = withPartner(25);
  const other = { id: 'friend_x', name: 'มะลิ', relationship: 90, genderIdentity: 'man', isAlive: true, stage: 'close_friend' };
  s.relationships.npcs.push(other);
  const mv = getMoves(s, other).find((m) => m.id === 'secret_date');
  assert.ok(mv && !mv.locked && mv.label.includes('เสี่ยงถูกจับได้'));
  let r; let id = 0;
  // find a runId where the other person is open to it
  for (; id < 300; id++) { s.meta.runId = `sec${id}`; if (performMove(s, other.id, 'secret_date').success) break; other.declinedAge = undefined; other.stage = 'close_friend'; }
  assert.equal(other.stage, 'secret');
  assert.ok(socialReputation(s) < 0, 'infidelity hurts reputation');
  const base = secretRiskPct(s);
  assert.ok(base > 0.1 && base < 0.5);
  other.secrecy = 30;
  assert.ok(secretRiskPct(s) > base);
  const cash0 = s.finance.cash;
  other.secrecy = 70; const sec0 = other.secrecy;
  assert.equal(performMove(s, other.id, 'cover_tracks').success, true);
  assert.equal(s.finance.cash, cash0 - COVER_COST);
  assert.ok(other.secrecy > sec0);
  assert.equal(performMove(s, other.id, 'cover_tracks').success, false, 'once per year');
  const unlocked = secretRiskPct(s, { secrecy: 70 });
  assert.ok(unlocked > 0);
});

test('yearly check can expose the secret; consequences differ by how you respond; unforgiven leaves -> ex', () => {
  const { s } = withPartner(25);
  const other = { id: 'friend_y', name: 'ใบบัว', relationship: 90, genderIdentity: 'woman', isAlive: true, stage: 'secret', secrecy: 5 };
  s.relationships.npcs.push(other);
  s.relationships.partner.relationship = 40;
  let caught = false;
  for (let age = 26; age < 80 && !caught; age++) { s.profile.age = age; caught = runYearlyRelationshipChecks(s).caught; }
  assert.ok(caught, 'eventually caught at low secrecy');
  const c = nextConsequence(s);
  assert.equal(c.type, 'caught_cheating');
  markConsequenceShown(s, c.id);
  const res = resolveConsequence(s, c, 1); // deny
  assert.ok(res.message.includes('คู่ของคุณ'));
  assert.equal(other.stage, 'friend');
  const idempotent = runYearlyRelationshipChecks(s);
  assert.equal(idempotent.ran, false);
});

test('confession to a partner you hurt ends or heals; divorce flow uses legal split and marks ex', async () => {
  const { s, npc } = withPartner(25);
  const other = { id: 'friend_z', name: 'ต้นกล้า', relationship: 90, genderIdentity: 'nonbinary', isAlive: true, stage: 'secret', secrecy: 60 };
  s.relationships.npcs.push(other);
  const r = performMove(s, other.id, 'confess');
  assert.equal(r.success, true);
  assert.equal(other.stage, 'friend');
  // exes can reconcile only after a year and when single
  const ex = findOpen((o) => o.romance); const en = ex.relationships.npcs[1]; en.stage = 'ex'; en.exAge = 20; en.relationship = 60; ex.profile.age = 20;
  assert.equal(getMoves(ex, en).find((m) => m.id === 'reconcile').locked, true);
  ex.profile.age = 22;
  const rr = performMove(ex, en.id, 'reconcile');
  assert.equal(rr.success, true);
  assert.equal(ex.relationships.partner.status, 'dating');
});
