import test from 'node:test';
import assert from 'node:assert/strict';
import { CAST_FRIEND_THRESHOLD, TOWN_CAST, castProgress, nextChapter, placeCast, resolveChapter, visibleCast } from '../js/engine/town_cast_engine.js';
import { buildTownMap, walkable } from '../js/engine/gender_encounter_engine.js';
import { getMoves, listRelationshipNpcs } from '../js/engine/relationship_stage_engine.js';

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const mk = (age) => ({ meta: { runId: 'tc1' }, profile: { age, gender: 'male', isAlive: true }, stats: { health: 50, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 }, statCounters: {}, finance: { cash: 50000 }, relationships: { npcs: [] }, turn: { lifeFeedLog: [] } });

test('five named residents with diverse identities, 3 chapters each, 3 options per chapter', () => {
  assert.equal(TOWN_CAST.length, 5);
  assert.ok(new Set(TOWN_CAST.map((c) => c.identity)).size >= 4);
  for (const c of TOWN_CAST) {
    assert.equal(c.chapters.length, 3, c.id);
    for (const ch of c.chapters) { assert.equal(ch.options.length, 3); assert.ok(ch.options[0][2].rel > 0 && ch.options[2][2].rel <= 5); assert.ok(ch.options[0][2].idx >= ch.options[2][2].idx); }
  }
  assert.equal(new Set(TOWN_CAST.map((c) => c.id)).size, 5);
});

test('residents appear by age, stand on walkable tiles, and are placed uniquely', () => {
  assert.deepEqual(visibleCast(mk(5)).map((c) => c.id), []);
  assert.deepEqual(visibleCast(mk(12)).map((c) => c.id), ['bua', 'boonma', 'namfon', 'som']);
  const s = mk(25); const map = buildTownMap(s); const cast = placeCast(s, map);
  assert.equal(cast.length, 5);
  assert.equal(new Set(cast.map((c) => `${c.x},${c.y}`)).size, 5);
  for (const c of cast) assert.ok(walkable(map, c.x, c.y), c.id);
});

test('chapters unlock by age, one per year, in order; good answers make friends; bad answers hurt', () => {
  const s = mk(7);
  assert.equal(nextChapter(s, 'bua').id, 'bua1');
  assert.equal(nextChapter(s, 'boonma'), null, 'too young');
  const r = resolveChapter(s, 'bua', 0);
  assert.equal(r.success, true);
  assert.equal(s.equality.townIndex, 52);
  assert.equal(nextChapter(s, 'bua'), null, 'only one chapter per year');
  s.profile.age = 9; assert.equal(nextChapter(s, 'bua'), null, 'chapter 2 needs age 11');
  s.profile.age = 11; assert.equal(nextChapter(s, 'bua').id, 'bua2');
  resolveChapter(s, 'bua', 0);
  assert.ok(castProgress(s, 'bua').rel >= CAST_FRIEND_THRESHOLD);
  const friend = s.relationships.npcs.find((n) => n.id === 'friend_cast_bua');
  assert.ok(friend && friend.isCast && friend.name === 'ครูใบบัว');
  const bad = mk(8); resolveChapter(bad, 'boonma', 2);
  assert.ok(castProgress(bad, 'boonma').rel < 5);
  assert.equal(bad.equality.townIndex, 48);
  s.profile.age = 16; resolveChapter(s, 'bua', 0);
  assert.equal(castProgress(s, 'bua').done, 3);
  s.profile.age = 30; assert.equal(nextChapter(s, 'bua'), null, 'all done');
});

test('cast friends only get friendship moves (no romance ladder with a teacher or shopkeeper)', () => {
  const s = mk(25);
  s.relationships.npcs = [{ id: 'friend_cast_bua', name: 'ครูใบบัว', relationship: 95, genderIdentity: 'woman', isAlive: true, isCast: true, stage: 'close_friend' }];
  assert.equal(listRelationshipNpcs(s).length, 1);
  assert.deepEqual(getMoves(s, s.relationships.npcs[0]), []);
  s.relationships.npcs[0].stage = 'friend'; s.relationships.npcs[0].relationship = 70;
  assert.equal(getMoves(s, s.relationships.npcs[0])[0].id, 'best_friend');
});
