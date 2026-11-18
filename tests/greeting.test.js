import test from 'node:test';
import assert from 'node:assert/strict';
import { GREETINGS_PER_YEAR, REPLIES, generateGreetings, markGreetingShown, nextGreeting, resolveGreeting } from '../js/engine/greeting_engine.js';
import { KID_IDENTITY_IDS } from '../js/engine/gender_encounter_engine.js';

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const mk = (age = 20, gender = 'male') => ({
  meta: { runId: 'g1' }, profile: { age, gender, isAlive: true }, stats: { health: 50, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 },
  statCounters: {}, relationships: { npcs: [] }, turn: { lifeFeedLog: [] }
});

test('greetings are deterministic, diverse, kid-safe, and none before age 6', () => {
  const a = generateGreetings(mk(20)), b = generateGreetings(mk(20));
  assert.deepEqual(a, b);
  assert.equal(a.length, GREETINGS_PER_YEAR);
  assert.notEqual(a[0].identity, a[1].identity);
  assert.notEqual(a[0].identity, 'man');
  for (const g of generateGreetings(mk(9))) assert.ok(KID_IDENTITY_IDS.includes(g.identity));
  assert.equal(nextGreeting(mk(4)), null);
});

test('each greeting appears once per year and chains to the next', () => {
  const s = mk(20);
  const g1 = nextGreeting(s); markGreetingShown(s, g1);
  const g2 = nextGreeting(s); assert.notEqual(g2.id, g1.id); markGreetingShown(s, g2);
  assert.equal(nextGreeting(s), null);
  s.profile.age = 21;
  assert.ok(nextGreeting(s));
});

test('warm reply builds friendship and index; brushing off lowers them', () => {
  const s = mk(20); const g = nextGreeting(s);
  const r = resolveGreeting(s, g, 'warm');
  assert.equal(r.success, true);
  assert.equal(s.equality.townIndex, 53);
  assert.ok(r.friend, 'friend after one warm reply (12 >= threshold)');
  assert.equal(s.relationships.npcs[0].name, g.name);
  const s2 = mk(20); const g2 = nextGreeting(s2);
  resolveGreeting(s2, g2, 'brush');
  assert.equal(s2.equality.townIndex, 48);
  assert.equal(s2.relationships.npcs.length, 0);
  assert.equal(REPLIES.length, 4);
});
