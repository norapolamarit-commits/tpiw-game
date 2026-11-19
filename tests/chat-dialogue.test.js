import test from 'node:test';
import assert from 'node:assert/strict';
import { chatReply, getChatOptions, getThread, startChat } from '../js/engine/chat_dialogue_engine.js';

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const mk = () => ({
  meta: { runId: 'c1' }, profile: { age: 15, gender: 'male' }, stats: { health: 50, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 }, statCounters: {},
  relationships: { npcs: [{ id: 'friend_a', name: 'ใบเตย', relationship: 50, genderIdentity: 'woman' }] }, turn: { lifeFeedLog: [] }
});

test('chat is a 3-turn dialogue and kind answers raise closeness', () => {
  const s = mk();
  const r = startChat(s, 'friend_a');
  assert.equal(r.success, true);
  assert.equal(getThread(s, 'friend_a').lines.length, 1);
  for (let i = 0; i < 3; i++) {
    assert.equal(getChatOptions(s, 'friend_a').length, 3);
    const res = chatReply(s, 'friend_a', 0);
    assert.equal(res.success, true);
    assert.equal(res.finished, i === 2);
  }
  const t = getThread(s, 'friend_a');
  assert.equal(t.finished, true);
  assert.equal(t.score, 6);
  assert.equal(s.relationships.npcs[0].relationship, 62);
  assert.equal(chatReply(s, 'friend_a', 0).success, false);
  assert.equal(startChat(s, 'friend_a').readonly, true);
});

test('rude answers lower closeness and equality index', () => {
  const s = mk(); startChat(s, 'friend_a');
  for (let i = 0; i < 3; i++) chatReply(s, 'friend_a', 2);
  assert.ok(s.relationships.npcs[0].relationship < 50);
  assert.ok(s.equality.townIndex < 50);
  s.profile.age = 16;
  assert.equal(startChat(s, 'friend_a').readonly, false);
});

test('chat topics do not repeat for a contact or across friends until the pool is exhausted', () => {
  const s = mk();
  const personal = new Set();
  for (let age = 15; age < 20; age++) {
    s.profile.age = age;
    startChat(s, 'friend_a');
    const id = getThread(s, 'friend_a').dialogueId;
    assert.equal(personal.has(id), false);
    personal.add(id);
  }
  assert.equal(personal.size, 5);
  s.profile.age = 20;
  assert.equal(startChat(s, 'friend_a').success, true, 'a new cycle starts when all topics were used');

  const otherState = mk();
  for (let i = 0; i < 4; i++) otherState.relationships.npcs.push({ id: `friend_${i}`, name: `เพื่อน ${i}`, relationship: 50 });
  const group = new Set();
  for (const npc of otherState.relationships.npcs) {
    startChat(otherState, npc.id);
    const id = getThread(otherState, npc.id).dialogueId;
    assert.equal(group.has(id), false);
    group.add(id);
  }
  assert.equal(group.size, 5);
});

import { getOthers } from '../js/engine/chat_dialogue_engine.js';
import { markConsequenceShown, nextConsequence, resolveConsequence, socialReputation } from '../js/engine/social_consequence_engine.js';
import { interactWithPost, generateFeed } from '../js/engine/social_media_engine.js';

test('chatting with others: good talk promotes them to a friend; risky answers count as scams', () => {
  const s = mk(); s.relationships.npcs = [];
  const other = getOthers(s)[0];
  assert.ok(other);
  startChat(s, other.id);
  for (let i = 0; i < 3; i++) chatReply(s, other.id, 0);
  assert.equal(s.relationships.npcs.some((n) => n.id === `online_${other.id}`), true);
  const s2 = mk(); s2.relationships.npcs = []; s2.profile.age = 20;
  let found = null;
  for (let age = 12; age < 60 && !found; age++) { s2.profile.age = age; for (const o of getOthers(s2)) { startChat(s2, o.id); if (s2.social.threads[o.id].dialogueId === 'safety') { found = o; break; } } }
  assert.ok(found, 'safety dialogue reachable');
  const before = s2.social.scams || 0;
  chatReply(s2, found.id, 2);
  assert.equal(s2.social.scams, before + 1);
});

test('social actions come back as next-year consequences', () => {
  const s = mk(); s.relationships.npcs = [];
  const post = generateFeed(s).find((p) => !p.suspicious);
  interactWithPost(s, post, 'comment:mean');
  assert.equal(nextConsequence(s), null, 'not due this year');
  s.profile.age = 16;
  const c = nextConsequence(s);
  assert.equal(c.type, 'backlash');
  assert.equal(c.name, post.author.name);
  markConsequenceShown(s, c.id);
  const r = resolveConsequence(s, c, 0);
  assert.ok(r.friend);
  assert.equal(nextConsequence(s), null);
  assert.ok(socialReputation(s) < 0);
});

import { STORY_CHARACTERS, ensureStoryCharacters } from '../js/engine/chat_dialogue_engine.js';

test('legacy Sincia is purged from saves; a registered story character appears in lane from age 12 with an intro first', () => {
  const s = mk(); s.relationships.npcs = [{ id: 'story_sincia', name: 'ซินเซีย', isStory: true, relationship: 60 }, { id: 'friend_a', name: 'ใบเตย', relationship: 50 }];
  ensureStoryCharacters(s);
  assert.deepEqual(s.relationships.npcs.map((n) => n.id), ['friend_a'], 'Sincia removed, others kept');
  assert.equal(STORY_CHARACTERS.length, 0, 'no built-in story characters now');
  const demo = { id: 'story_demo', name: 'เดโม', roleTitle: 'เพื่อนพิเศษ', identity: 'nonbinary', dialogues: [
    { id: 'demo_intro', title: 'แนะนำตัว', turns: [{ them: 'สวัสดี ฉันเดโม', options: [['สวัสดี ยินดีที่ได้รู้จัก', 2, 'ดีใจมาก'], ['อืม', 0, 'โอเค'], ['ไม่สน', -2, 'อ้าว']] }] },
    { id: 'demo_2', title: 'คุยต่อ', turns: [{ them: 'วันนี้เป็นไงบ้าง', options: [['ดีมาก', 2, 'เยี่ยม'], ['เฉยๆ', 0, 'โอเค'], ['แย่', -1, 'เสียใจด้วย']] }] }] };
  STORY_CHARACTERS.push(demo);
  try {
    const young = mk(); young.profile.age = 11; assert.equal(ensureStoryCharacters(young).length, 0);
    const npcs = ensureStoryCharacters(s);
    assert.equal(npcs[0].name, 'เดโม');
    startChat(s, 'story_demo');
    assert.equal(getThread(s, 'story_demo').dialogueId, 'demo_intro');
    chatReply(s, 'story_demo', 0);
    s.profile.age = 16; startChat(s, 'story_demo');
    assert.equal(getThread(s, 'story_demo').dialogueId, 'demo_2');
  } finally { STORY_CHARACTERS.length = 0; }
});
