import test from 'node:test';
import assert from 'node:assert/strict';
import { MILESTONES, STAGE_LABELS, markMilestoneShown, nextMilestone, resolveMilestone, stageOfAge } from '../js/engine/milestone_events_engine.js';

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
const mk = (age) => ({ meta: { runId: 'm1' }, profile: { age, isAlive: true }, stats: { health: 50, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 }, statCounters: {}, relationships: { npcs: [] }, turn: { lifeFeedLog: [] } });

test('there are special events for every life stage, each with 3 options and consistent effects', () => {
  const stages = new Set(MILESTONES.map((m) => m.stage));
  for (const k of Object.keys(STAGE_LABELS)) assert.ok(stages.has(k), `stage ${k}`);
  assert.ok(MILESTONES.length >= 18);
  assert.equal(new Set(MILESTONES.map((m) => m.id)).size, MILESTONES.length);
  for (const m of MILESTONES) {
    assert.equal(m.options.length, 3, m.id);
    assert.ok(m.options[0][2].idx > 0 && m.options[2][2].idx <= 0, `${m.id}: best raises index, worst does not`);
    assert.equal(stageOfAge(m.age), m.stage);
  }
});

test('a milestone appears only in its age year, once, and resolves with effects', () => {
  assert.equal(nextMilestone(mk(9)), null);
  const s = mk(8);
  const ms = nextMilestone(s);
  assert.equal(ms.id, 'ms_play_roles');
  assert.ok(ms.tagTh.includes('วัยเด็ก'));
  markMilestoneShown(s, ms.id);
  assert.equal(nextMilestone(s), null);
  const s2 = mk(15); const m2 = nextMilestone(s2);
  assert.equal(m2.id, 'ms_track_choice');
  const r = resolveMilestone(s2, m2, 0);
  assert.equal(r.success, true);
  assert.equal(s2.equality.townIndex, 53);
  assert.ok(s2.stats.intelligence > 50);
  assert.equal(nextMilestone(mk(16)), null, 'no milestone at 16');
});
