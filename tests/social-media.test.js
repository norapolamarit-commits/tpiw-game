import test from 'node:test';
import assert from 'node:assert/strict';
import { COMMENT_OPTIONS, ONLINE_BOND_THRESHOLD, generateFeed, getContacts, interactWithPost, isPhoneUnlocked, sendDirectMessage } from '../js/engine/social_media_engine.js';

const mk = (age = 14, gender = 'male') => ({
  meta: { runId: 'r1' }, profile: { age, gender }, stats: { health: 50, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 },
  statCounters: {}, relationships: { npcs: [] }, turn: { lifeFeedLog: [] }
});

test('phone is locked under 12 and feed is deterministic with mostly other genders', () => {
  assert.equal(isPhoneUnlocked(mk(11)), false);
  assert.equal(interactWithPost(mk(11), { id: 'p', author: { id: 'a' } }, 'like').success, false);
  const a = generateFeed(mk(14)), b = generateFeed(mk(14));
  assert.deepEqual(a, b);
  assert.equal(a.length, 8);
  let others = 0, n = 0;
  for (let age = 12; age < 40; age++) for (const p of generateFeed(mk(age))) { n++; if (p.author.identity !== 'man') others++; }
  assert.ok(others / n > 0.6);
});

test('kind comments build an online friend; mean comments hurt equality index', () => {
  const s = mk(); const post = generateFeed(s).find((p) => !p.suspicious);
  assert.equal(interactWithPost(s, post, 'comment:mean').delta < 0, true);
  assert.equal(s.equality.townIndex, 46);
  const s2 = mk(); const p2 = generateFeed(s2).find((p) => !p.suspicious);
  interactWithPost(s2, p2, 'comment:kind');
  interactWithPost(s2, p2, 'follow');
  const r = interactWithPost(s2, p2, 'like');
  assert.ok(s2.social.relations[p2.author.id] >= ONLINE_BOND_THRESHOLD);
  assert.equal(getContacts(s2).length, 1);
  assert.ok(r.newFriend);
  assert.equal(interactWithPost(s2, p2, 'comment:kind').success, false);
  const contact = getContacts(s2)[0];
  assert.equal(sendDirectMessage(s2, contact.id).success, true);
  assert.equal(sendDirectMessage(s2, contact.id).success, false);
  assert.ok(COMMENT_OPTIONS.every((o) => o.labelTh));
});

test('suspicious stranger requests: block is safe, replying is risky', () => {
  const s = mk(14);
  const sus = { id: 'p_s', author: { id: 'u_s', name: 'x', identity: 'man' }, suspicious: true };
  const safe = interactWithPost(s, sus, 'block');
  assert.equal(safe.safe, true);
  const s2 = mk(14); const r = interactWithPost(s2, { ...sus, id: 'p_s2' }, 'reply_suspicious');
  assert.equal(r.safe, false);
  assert.equal(s2.social.scams, 1);
});

import { CAPTIONS, PHOTO_SCENES, getNewsForAge, postPhoto, readNews } from '../js/engine/social_media_engine.js';

test('posts have photos and captions; camera posts once a year; news reads once', () => {
  const s = mk(14);
  for (const p of generateFeed(s)) { assert.ok(p.kind); assert.ok(Array.isArray(p.tags)); assert.ok(p.text.length > 5); }
  const r = postPhoto(s, PHOTO_SCENES[0].id, 'inclusive');
  assert.equal(r.success, true);
  assert.equal(s.equality.townIndex, 53);
  assert.equal(r.post.reactions.length, 3);
  assert.equal(postPhoto(s, 'friends', 'funny').success, false);
  const bad = mk(14); postPhoto(bad, 'selfie', 'mean');
  assert.equal(bad.equality.townIndex, 47);
  assert.equal(CAPTIONS.length, 4);
  const n = getNewsForAge(s)[0];
  assert.equal(readNews(s, n.id).success, true);
  assert.equal(readNews(s, n.id).success, false);
  assert.equal(postPhoto(mk(10), 'friends', 'funny').success, false);
});

test('ik dislike lowers closeness; disliking a pride post lowers the town index and reputation; like/dislike are exclusive', async () => {
  const { socialReputation } = await import('../js/engine/social_consequence_engine.js');
  const s = mk(14);
  const normal = generateFeed(s).find((p) => !p.suspicious && p.kind !== 'pride');
  const r = interactWithPost(s, normal, 'dislike');
  assert.equal(r.success, true);
  assert.equal(s.social.relations[normal.author.id], -4);
  assert.equal(interactWithPost(s, normal, 'like').success, false);
  assert.equal(interactWithPost(s, normal, 'dislike').success, false);
  const pride = { id: 'p_pride', kind: 'pride', suspicious: false, author: { id: 'u_p', name: 'x', identity: 'trans_woman' } };
  const before = s.equality.townIndex;
  interactWithPost(s, pride, 'dislike');
  assert.equal(s.equality.townIndex, before - 1);
  assert.ok(socialReputation(s) < 0);
  const liked = mk(14); const p2 = generateFeed(liked).find((p) => !p.suspicious);
  interactWithPost(liked, p2, 'like');
  assert.equal(interactWithPost(liked, p2, 'dislike').success, false);
});
