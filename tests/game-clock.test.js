import test from 'node:test';
import assert from 'node:assert/strict';
import { OUTCOME_MS, YEAR_MS, resetClockProgress, setClockSpeed, tickClock } from '../js/ui/game_clock.js';

const free = { actionType: 'NEXT_YEAR' };
const run = (spec, ms, opts) => { let fired = 0; for (let t = 0; t < ms; t += 200) if (tickClock(spec, 200, opts)) fired++; return fired; };

test('time advances a year while free, at speed multiples', () => {
  setClockSpeed(1); resetClockProgress();
  assert.equal(run(free, YEAR_MS), 1);
  setClockSpeed(2); resetClockProgress();
  assert.equal(run(free, YEAR_MS), 2);
});

test('clock pauses for choices, annual slip, modals, hidden tab and speed 0', () => {
  setClockSpeed(2); resetClockProgress();
  for (const t of ['AWAITING_CHOICE', 'ACK_ANNUAL_SLIP', 'AWAITING_DEBT_MODAL', 'VIEW_ENDING']) assert.equal(run({ actionType: t }, 60000), 0, t);
  assert.equal(run(free, 60000, { modalOpen: true }), 0);
  assert.equal(run(free, 60000, { hidden: true }), 0);
  setClockSpeed(0);
  assert.equal(run(free, 60000), 0);
});

test('after a choice the outcome auto-advances so the game runs on', () => {
  setClockSpeed(1); resetClockProgress();
  assert.equal(run({ actionType: 'NEXT_EVENT' }, OUTCOME_MS), 1);
  resetClockProgress();
  assert.equal(run({ actionType: 'UNLOCK_FREE_ACTION' }, OUTCOME_MS), 1);
  setClockSpeed(1);
});
