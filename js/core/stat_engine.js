/**
 * Shared Stat Resolution Engine.
 *
 * Positive core-stat gains are reduced as the current stat approaches 100.
 * Negative effects are always applied at their full authored value.
 * Fractional progress is preserved in statCounters.statGainRemainders so
 * small gains are not silently discarded by integer UI stats.
 */
export const CORE_STAT_KEYS = ['health', 'happiness', 'intelligence', 'connections', 'appearance'];
export const DIMINISHING_RETURNS_EXPONENT = 1.25;

export function calculateDiminishingReturnGain(baseGain, currentStat, exponent = DIMINISHING_RETURNS_EXPONENT) {
  const gain = Number(baseGain);
  const current = Math.min(100, Math.max(0, Number(currentStat) || 0));
  if (!Number.isFinite(gain) || gain <= 0 || current >= 100) return 0;
  return gain * Math.pow(1 - current / 100, exponent);
}

/**
 * Apply core stats and Merit, returning actual visible deltas.
 * studyEfficiencyMultiplier affects positive Intelligence before diminishing returns.
 */
export function applyStatEffects(state, effects, options = {}) {
  const deltas = Object.fromEntries([...CORE_STAT_KEYS, 'merit'].map((key) => [key, 0]));
  if (!state?.stats || !effects || typeof effects !== 'object') return deltas;

  state.statCounters ||= {};
  state.statCounters.statGainRemainders ||= {};
  const remainders = state.statCounters.statGainRemainders;
  const studyMultiplier = Math.max(0, Number(options.studyEfficiencyMultiplier ?? 1));

  for (const key of CORE_STAT_KEYS) {
    const authoredDelta = Number(effects[key] ?? 0);
    if (!Number.isFinite(authoredDelta) || authoredDelta === 0) continue;

    const visibleBefore = Number(state.stats[key] ?? 0);
    const preciseBefore = visibleBefore + Number(remainders[key] || 0);
    let resolvedDelta = authoredDelta;

    if (authoredDelta > 0) {
      if (key === 'intelligence' && studyMultiplier !== 1) resolvedDelta *= studyMultiplier;
      resolvedDelta = calculateDiminishingReturnGain(resolvedDelta, preciseBefore);
    }

    const preciseAfter = Math.min(100, Math.max(0, preciseBefore + resolvedDelta));
    const visibleAfter = Math.min(100, Math.max(0, Math.round(preciseAfter)));
    state.stats[key] = visibleAfter;
    remainders[key] = preciseAfter >= 100 || preciseAfter <= 0
      ? 0
      : Number((preciseAfter - visibleAfter).toFixed(8));
    deltas[key] = visibleAfter - visibleBefore;
  }

  const meritDelta = Number(effects.merit ?? 0) + Number(effects.karma ?? 0);
  if (Number.isFinite(meritDelta) && meritDelta !== 0) {
    const before = Number(state.stats.merit ?? 0);
    state.stats.merit = Math.max(-9999, before + Math.round(meritDelta));
    deltas.merit = state.stats.merit - before;
  }

  return deltas;
}
