import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMBLING_GAMES, ensureGambling, placeBet, seekGamblingCounseling } from '../js/engine/gambling_engine.js';

globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };

const mk = (age = 25, cash = 100000) => ({
  meta: {}, profile: { age }, finance: { cash, netWorth: 0, investments: {}, ownedAssets: [], installments: [], activeLoans: [] },
  stats: { health: 50, happiness: 50, intelligence: 50, connections: 50, appearance: 50, merit: 0 }, statCounters: {}, turn: { lifeFeedLog: [] }
});

test('every game has house edge (expected return below 100%)', () => {
  for (const g of GAMBLING_GAMES) assert.ok(g.winChance * g.payoutMultiplier < 1, g.id);
});

test('winning pays out and losing deducts stake; underage blocked', () => {
  const s = mk();
  assert.equal(placeBet(s, 'gamble_football', 1000, () => 0).won, true);
  assert.equal(s.finance.cash, 100000 + 900);
  assert.equal(placeBet(s, 'gamble_football', 1000, () => 0.99).won, false);
  assert.equal(s.finance.cash, 100000 + 900 - 1000);
  assert.equal(placeBet(mk(15), 'gamble_football', 100).success, false);
  assert.equal(placeBet(mk(25, 50), 'gamble_football', 100).success, false);
});

test('addiction rises with play, decays when idle, and counseling reduces it', () => {
  const s = mk();
  for (let i = 0; i < 12; i++) placeBet(s, 'gamble_casino_slot', 100, () => 0.99);
  assert.equal(ensureGambling(s).addiction, 36);
  assert.equal(seekGamblingCounseling(s).success, true);
  assert.equal(s.gambling.addiction, 6);
  s.gambling.addiction = 40; s.gambling.betsThisYear = 0; s.profile.age = 27;
  assert.equal(ensureGambling(s).addiction, 24);
});
