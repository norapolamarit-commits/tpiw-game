/**
 * js/engine/gambling_engine.js
 * ระบบการพนัน: ทุกเกมเจ้ามือได้เปรียบ มีความเสี่ยงติดพนัน และผลกระทบต่อความสุข/แต้มบุญ
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { applyStatEffects } from '../core/stat_engine.js';
import { recalculateNetWorth, saveGame } from '../core/state.js';
import { formatCurrency } from '../core/utils.js';

export const GAMBLING_COUNSEL_COST = 3000;

export const GAMBLING_GAMES = [
  { id: 'gamble_football', nameTh: 'แทงบอลออนไลน์', descTh: 'ทายผลบอลคู่ดังคืนนี้ เสียงเชียร์ทำให้ลืมว่าราคาต่อรองถูกตั้งให้เจ้ามือได้เปรียบ', minAge: 20, winChance: 0.46, payoutMultiplier: 1.9, illegal: true },
  { id: 'gamble_casino_slot', nameTh: 'ตู้สล็อตคาสิโน', descTh: 'ไฟวิบวับและเสียงเหรียญ ออกแบบมาให้เล่นต่อเนื่อง จ่ายถี่แต่คืนน้อย', minAge: 20, winChance: 0.3, payoutMultiplier: 2.8, illegal: false },
  { id: 'gamble_baccarat', nameTh: 'บาคาร่าออนไลน์', descTh: 'เกมไพ่ที่ดูเหมือนลุ้นง่าย แต่ค่าคอมมิชชันและกติกาทำให้เจ้ามือชนะระยะยาว', minAge: 20, winChance: 0.47, payoutMultiplier: 1.95, illegal: true },
  { id: 'gamble_underground_lottery', nameTh: 'หวยใต้ดิน', descTh: 'จ่ายสูงถึง 70 เท่า แต่โอกาสถูกน้อยมาก และเงินที่เสียไม่คุ้มครองใดๆ', minAge: 18, winChance: 0.012, payoutMultiplier: 70, illegal: true }
];

export function ensureGambling(state) {
  state.gambling ||= {};
  const g = state.gambling;
  for (const k of ['addiction', 'rounds', 'totalWagered', 'totalWon', 'totalLost', 'betsThisYear']) {
    if (!Number.isFinite(g[k])) g[k] = 0;
  }
  if (!Number.isFinite(g.lastAge)) g.lastAge = Number(state.profile?.age || 0);
  const age = Number(state.profile?.age || 0);
  if (age > g.lastAge) {
    const gap = age - g.lastAge;
    if (g.betsThisYear === 0) g.addiction = Math.max(0, g.addiction - 8 * gap);
    g.betsThisYear = 0;
    g.lastAge = age;
  }
  return g;
}

export function addictionLevelTh(v) {
  if (v >= 70) return 'ติดพนันรุนแรง';
  if (v >= 50) return 'เริ่มติด';
  if (v >= 30) return 'เสี่ยงสูง';
  if (v >= 10) return 'เริ่มเสี่ยง';
  return 'ปลอดภัย';
}

export function getGamblingStatus(state) {
  const g = ensureGambling(state);
  return { ...g, levelTh: addictionLevelTh(g.addiction) };
}

export function placeBet(state, gameId, amount, rng = Math.random) {
  const game = GAMBLING_GAMES.find((x) => x.id === gameId);
  if (!game) return { success: false, message: 'ไม่พบเกมนี้' };
  const g = ensureGambling(state);
  const stake = Math.round(Number(amount || 0));
  if (state.profile.age < game.minAge) return { success: false, message: `ต้องมีอายุอย่างน้อย ${game.minAge} ปี` };
  if (stake <= 0) return { success: false, message: 'ระบุจำนวนเงินที่แทงให้มากกว่า 0 บาท' };
  if (Number(state.finance.cash || 0) < stake) return { success: false, message: 'เงินสดไม่เพียงพอ' };

  state.finance.cash = Math.round(state.finance.cash - stake);
  g.rounds += 1;
  g.betsThisYear += 1;
  g.totalWagered += stake;
  const won = rng() < game.winChance;
  const addicted = g.addiction >= 50;
  let effects;
  if (won) {
    const payout = Math.round(stake * game.payoutMultiplier);
    state.finance.cash += payout;
    g.totalWon += payout - stake;
    g.addiction = Math.min(100, g.addiction + 4);
    effects = { happiness: 2 };
  } else {
    g.totalLost += stake;
    g.addiction = Math.min(100, g.addiction + 3);
    effects = { happiness: addicted ? -3 : -1 };
  }
  if (game.illegal) effects.merit = (effects.merit || 0) - 1;
  const deltas = applyStatEffects(state, effects);
  state.turn?.lifeFeedLog?.push({
    age: Number(state.profile.age || 0),
    monthTh: 'ตลอดปี',
    type: 'gambling',
    title: `${won ? 'ชนะ' : 'แพ้'}: ${game.nameTh}`,
    message: won ? `ชนะ ได้เงินกำไร ${formatCurrency(Math.round(stake * (game.payoutMultiplier - 1)))}` : `เสียเงิน ${formatCurrency(stake)} ความเสี่ยงติดพนัน ${g.addiction}/100`
  });
  recalculateNetWorth(state);
  saveGame(state);
  return {
    success: true,
    won,
    deltas,
    message: won
      ? `ชนะ! ได้กำไร ${formatCurrency(Math.round(stake * (game.payoutMultiplier - 1)))}`
      : `แพ้ เสียเงิน ${formatCurrency(stake)}${g.addiction >= 50 ? ' (คุณเริ่มไล่ตามเงินที่เสียไป ควรหยุดและขอความช่วยเหลือ)' : ''}`
  };
}

export function seekGamblingCounseling(state) {
  const g = ensureGambling(state);
  if (Number(state.finance.cash || 0) < GAMBLING_COUNSEL_COST) return { success: false, message: 'เงินสดไม่พอสำหรับค่าปรึกษา' };
  state.finance.cash = Math.round(state.finance.cash - GAMBLING_COUNSEL_COST);
  g.addiction = Math.max(0, g.addiction - 30);
  applyStatEffects(state, { happiness: 1, merit: 1 });
  recalculateNetWorth(state);
  saveGame(state);
  return { success: true, message: `ปรึกษานักจิตวิทยาแล้ว ความเสี่ยงติดพนันลดเหลือ ${g.addiction}/100` };
}
