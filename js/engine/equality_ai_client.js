/**
 * js/engine/equality_ai_client.js
 * ขอให้ AI (ผ่านเซิร์ฟเวอร์) วิเคราะห์พฤติกรรมความเท่าเทียมและปรับเหตุการณ์ในอนาคต
 * หากเรียก AI ไม่ได้ จะใช้การวิเคราะห์ในเครื่อง (analyzeEqualityBehavior) แทนเสมอ
 */

import { FOCUS_CONTEXT_IDS, FOCUS_IDENTITY_IDS, analyzeEqualityBehavior, ensureEquality } from './gender_encounter_engine.js';

export function buildCoachRequest(state) {
  const eq = ensureEquality(state);
  const local = analyzeEqualityBehavior(state);
  return {
    age: Number(state.profile?.age || 0), total: local.total, avgScore: local.avgScore, trend: local.trend,
    weakIdentities: local.weakIdentities, weakContexts: local.weakContexts, strongIdentities: local.strongIdentities,
    recentTones: eq.history.slice(-20).map((h) => h.tone)
  };
}

export function validateCoachResponse(coach) {
  if (!coach || typeof coach.coachingTh !== 'string' || !/[฀-๿]/u.test(coach.coachingTh)) return false;
  const ids = coach.focusIdentities, ctx = coach.focusContexts;
  return Array.isArray(ids) && ids.length <= 3 && ids.every((x) => FOCUS_IDENTITY_IDS.includes(x)) &&
    Array.isArray(ctx) && ctx.length <= 2 && ctx.every((x) => FOCUS_CONTEXT_IDS.includes(x));
}

/** วิเคราะห์ในเครื่องก่อนเสมอ แล้วลองอัปเกรดด้วย AI; คืนค่า { source: 'ai' | 'local' } */
export async function runEqualityCoaching(state, { fetchImpl = globalThis.fetch } = {}) {
  const eq = ensureEquality(state);
  eq.localAnalysis = analyzeEqualityBehavior(state);
  if (!fetchImpl || eq.localAnalysis.total < 3) return { source: 'local', analysis: eq.localAnalysis };
  try {
    const res = await fetchImpl('/api/equality-coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(buildCoachRequest(state)) });
    if (!res.ok) return { source: 'local', analysis: eq.localAnalysis };
    const data = await res.json();
    if (!data.aiGenerated || !validateCoachResponse(data.coach)) return { source: 'local', analysis: eq.localAnalysis };
    eq.aiCoach = {
      age: Number(state.profile?.age || 0), coachingTh: data.coach.coachingTh, nextScenarioIdeaTh: data.coach.nextScenarioIdeaTh || '',
      focus: { identities: data.coach.focusIdentities, contexts: data.coach.focusContexts }
    };
    return { source: 'ai', analysis: eq.aiCoach };
  } catch {
    return { source: 'local', analysis: eq.localAnalysis };
  }
}
