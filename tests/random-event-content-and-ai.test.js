import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCuratedLegacyTemplates } from '../js/engine/legacy_random_templates.js';
import { RANDOM_EVENT_TEMPLATES } from '../js/engine/random_event_templates.js';
import { validateAiProposal, generateAiProposal } from '../server/ai_event.js';
import { createGameServer, handleAiRequest } from '../server/index.js';
import { Readable } from 'node:stream';

const filenames = {
  eventsLocKarma: 'Events_Locations_&_Karma.json', eventsPhase2: 'Events_Phase2_Child.json',
  eventsPhase3: 'Events_Phase3_Teen.json', eventsRelFamily: 'Events_Rel_Family_&_Friends.json',
  eventsRelRomance: 'Events_Rel_Romance_&_Children.json', eventsJobsGig: 'Events_Jobs_PartTime_&_Gig.json',
  eventsJobsCorp: 'Events_Jobs_Corporate_&_Pro.json'
};
const raw = Object.fromEntries(Object.entries(filenames).map(([key, filename]) => [key, JSON.parse(fs.readFileSync(new URL(`../data/${filename}`, import.meta.url)))]));

test('curated Thai event pool meets all requested content quotas with distinct choices', () => {
  const events = [...RANDOM_EVENT_TEMPLATES, ...buildCuratedLegacyTemplates(raw)];
  const count = (categories) => RANDOM_EVENT_TEMPLATES.filter((event) => categories.includes(event.category)).length;
  assert.ok(RANDOM_EVENT_TEMPLATES.length >= 150);
  assert.ok(count(['daily_life', 'health']) >= 30);
  assert.ok(count(['education', 'opportunity']) >= 25);
  assert.ok(count(['family']) >= 20);
  assert.ok(count(['friendship', 'romance']) >= 20);
  assert.ok(count(['diversity', 'social_issues']) >= 25);
  assert.ok(count(['career', 'finance']) >= 15);
  assert.ok(count(['rare_events']) >= 15);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  for (const event of events) {
    assert.ok(/[\u0E00-\u0E7F]/u.test(event.title));
    assert.ok(/[\u0E00-\u0E7F]/u.test(event.description));
    assert.ok(event.choices.length >= 2 && event.choices.length <= 4, event.id);
    assert.ok(event.choices.every((choice) => choice.stat_effects || choice.effects || choice.on_success), event.id);
  }
  for (const event of RANDOM_EVENT_TEMPLATES) {
    assert.ok(event.minAge >= 0 && event.maxAge <= 100 && event.minAge <= event.maxAge, event.id);
    assert.ok(event.choices.every((choice) => Object.values(choice.effects || {}).some((value) => value !== 0)), event.id);
    assert.equal(new Set(event.choices.map((choice) => choice.label)).size, event.choices.length, event.id);
    assert.equal(new Set(event.choices.map((choice) => JSON.stringify(choice.effects))).size, event.choices.length, event.id);
  }
  assert.ok(RANDOM_EVENT_TEMPLATES.some((event) => event.rarity === 'legendary' && event.choices.some((choice) => Object.values(choice.effects).some((value) => value < 0))));
});

const context = {
  eligibleCategories: ['friendship'],
  npcs: [{ id: 'friend_1', name: 'มิน', isAlive: true }]
};
const proposal = {
  title: 'เพื่อนเก่าติดต่อกลับมา',
  description: 'เพื่อนที่คุณเคยช่วยในวัยเรียนส่งข้อความมาถามสารทุกข์และชวนคุยเรื่องวันเก่า',
  category: 'friendship',
  choices: [
    { label: 'ตอบกลับและนัดคุย', consequenceSummary: 'มิตรภาพกลับมาใกล้ชิด', effects: { health: 0, happiness: 2, intelligence: 0, connections: 2, merit: 0, appearance: 0, cash: 0 } },
    { label: 'ขอคุยเมื่อพร้อม', consequenceSummary: 'คุณได้จัดเวลาตามที่สะดวก', effects: { health: 1, happiness: 1, intelligence: 0, connections: 0, merit: 0, appearance: 0, cash: 0 } }
  ],
  referencedNpcIds: ['friend_1'], futureStoryHooks: ['ชวนพบกันอีกปีหน้า'], educationalTopic: ''
};

test('AI proposals are Zod validated and reject unavailable NPCs or excessive effects', () => {
  assert.equal(validateAiProposal(proposal, context).title, proposal.title);
  assert.throws(() => validateAiProposal(proposal, { ...context, npcs: [{ id: 'friend_1', isAlive: false }] }));
  assert.throws(() => validateAiProposal({ ...proposal, choices: [{ ...proposal.choices[0], effects: { ...proposal.choices[0].effects, cash: 999999 } }, proposal.choices[1]] }, context));
  assert.throws(() => validateAiProposal({ ...proposal, description: 'มินชวนคุณคุยเรื่องชีวิตและวันเก่า แม้เธอไม่ได้อยู่ในรายชื่อคนที่พร้อมพบกันแล้ว' }, { ...context, npcs: [{ id: 'friend_1', name: 'มิน', isAlive: false }] }));
  assert.throws(() => validateAiProposal({ ...proposal, choices: [proposal.choices[0], { ...proposal.choices[1], effects: proposal.choices[0].effects }] }, context));
  assert.throws(() => validateAiProposal({ ...proposal, description: 'หัวหน้าแผนกชวนคุณไปทำงานกับเพื่อนเก่าหลังจากไม่ได้พบกันนานหลายปี' }, { ...context, careerAndEdu: { mainJobId: null } }));
  assert.throws(() => validateAiProposal({ ...proposal, category: 'romance' }, { ...context, age: 15, eligibleCategories: ['romance'] }));
});

test('AI generator accepts structured output without mutating game state', async () => {
  const before = structuredClone(context);
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: JSON.stringify(proposal) }) });
  const result = await generateAiProposal(context, { fetchImpl, env: { PATHUMMA_API_KEY: 'k' } });
  assert.equal(result.title, proposal.title);
  assert.deepEqual(context, before);
});

test('server returns a handcrafted event when AI generation fails', async () => {
  const request = Readable.from([JSON.stringify({
    runId: 'fallback-test', age: 20, profile: {}, stats: {}, finance: {}, careerAndEdu: {},
    recentEvents: [], memories: [], npcs: [], eligibleCategories: ['diversity'], continuityConstraints: []
  })]);
  let body = '';
  const response = {
    writeHead(status) { assert.equal(status, 200); },
    end(value) { body = value; }
  };
  await handleAiRequest(request, response, async () => { throw new Error('model unavailable'); });
  const result = JSON.parse(body);
  assert.equal(result.aiGenerated, false);
  assert.equal(result.event.source_type, 'random_event');
  assert.ok(result.event.choices.length >= 2);
});

test('game server does not expose dotfiles or accept cross-origin AI requests', async () => {
  const server = createGameServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${url}/.gitignore`)).status, 404);
    const rejected = await fetch(`${url}/api/random-event`, { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(rejected.status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
