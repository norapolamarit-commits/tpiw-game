import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStatEffects, calculateDiminishingReturnGain } from '../js/core/stat_engine.js';

function createState() {
  return {
    stats: { health: 70, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 },
    statCounters: { statGainRemainders: {} }
  };
}

test('positive gains diminish as the current stat approaches 100', () => {
  const low = calculateDiminishingReturnGain(5, 0);
  const middle = calculateDiminishingReturnGain(5, 50);
  const high = calculateDiminishingReturnGain(5, 90);
  assert.equal(low, 5);
  assert.ok(middle < low);
  assert.ok(high < middle);
  assert.ok(high > 0);
});

test('negative effects are applied at full authored strength regardless of current stat', () => {
  const state = createState();
  state.stats.health = 90;
  applyStatEffects(state, { health: -15 });
  assert.equal(state.stats.health, 75);
});

test('fractional positive gains accumulate instead of being discarded', () => {
  const state = createState();
  state.stats.intelligence = 90;
  const first = applyStatEffects(state, { intelligence: 1 });
  assert.equal(first.intelligence, 0);
  assert.ok(state.statCounters.statGainRemainders.intelligence > 0);
  for (let i = 0; i < 10; i += 1) applyStatEffects(state, { intelligence: 1 });
  assert.equal(state.stats.intelligence, 91);
});

test('study efficiency is applied before diminishing returns', () => {
  const normal = createState();
  const boosted = createState();
  applyStatEffects(normal, { intelligence: 4 });
  applyStatEffects(boosted, { intelligence: 4 }, { studyEfficiencyMultiplier: 1.2 });
  assert.ok(boosted.stats.intelligence >= normal.stats.intelligence);
  assert.ok(boosted.statCounters.statGainRemainders.intelligence >= normal.statCounters.statGainRemainders.intelligence);
});

test('merit remains outside core-stat diminishing returns', () => {
  const state = createState();
  applyStatEffects(state, { merit: 10 });
  assert.equal(state.stats.merit, 10);
});
