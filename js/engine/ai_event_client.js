import { EVENT_CONFIG } from '../core/event_settings.js';
import { getState, saveGame } from '../core/state.js';
import { nextSeededRandom } from './random_event_engine.js';

const LIMITS = { health: 8, happiness: 8, intelligence: 8, connections: 8, merit: 5, appearance: 5, cash: 5000 };

export function createAiContext(state) {
  const history = state.turn.randomEventHistory || [];
  const salient = history.filter((entry) => ['rare', 'legendary'].includes(entry.rarity) || (entry.futureStoryHooks || []).length);
  const memories = [...new Map([...salient, ...history.slice(-10)].map((entry) => [`${entry.id}:${entry.age}`, entry])).values()].slice(-20);
  return {
    runId: String(state.meta.runId),
    age: Number(state.profile.age),
    profile: { ...state.profile },
    stats: { ...state.stats },
    finance: { cash: state.finance.cash, netWorth: state.finance.netWorth, parentAnnualSupport: state.finance.parentAnnualSupport },
    careerAndEdu: { mainJobId: state.careerAndEdu.mainJobId, activeStudy: state.careerAndEdu.activeStudy, completedDegrees: state.careerAndEdu.completedDegrees },
    partner: state.relationships?.partner ? { name: state.relationships.partner.name, status: state.relationships.partner.status } : null,
    recentEvents: (state.turn.lifeFeedLog || []).slice(-12).map(({ eventId, age, title, choiceLabel, message }) => ({ eventId, age, title, choiceLabel, message })),
    memories: memories.map(({ id, age, category, choiceId, futureStoryHooks, title }) => ({ id, age, category, choiceId, futureStoryHooks, title })),
    npcs: [
      ...(state.relationships?.npcs || []).map(({ id, name, roleTitle, relationship, isAlive, unavailable }) => ({ id, name, roleTitle, relationship, isAlive, unavailable })),
      ...(state.relationships?.partner ? [{ id: state.relationships.partner.id, name: state.relationships.partner.name, roleTitle: 'คนรัก', relationship: state.relationships.partner.relationship, isAlive: true }] : [])
    ].slice(0, 30),
    eligibleCategories: ['daily_life', 'education', 'family', 'friendship', 'romance', 'diversity', 'career', 'finance', 'health', 'social_issues', 'opportunity', 'rare_events'].filter((category) =>
      !(['career', 'finance', 'romance'].includes(category) && state.profile.age < 18) && !(category === 'education' && state.profile.age > 35)
    ),
    continuityConstraints: [
      'ห้ามอ้างถึง NPC ที่เสียชีวิตหรือไม่พร้อม',
      'ห้ามเปิดเผยอัตลักษณ์ทางเพศของตัวละครโดยไม่ได้รับความยินยอม',
      'ห้ามให้รางวัลเดิมซ้ำ',
      `จังหวัดปัจจุบัน: ${state.profile.currentLocationId}`,
      `ธงเรื่องราว: ${(state.flags || []).slice(-12).join(', ')}`
    ]
  };
}

export function validateClientAiCard(card, state) {
  if (!card || card.aiGenerated !== true || card.source_type !== 'random_event') return false;
  if (!/^[\u0E00-\u0E7F\s\S]*[\u0E00-\u0E7F]/u.test(card.title_th || '') || !/[\u0E00-\u0E7F]/u.test(card.description_th || '')) return false;
  if (!Array.isArray(card.choices) || card.choices.length < 2 || card.choices.length > 4) return false;
  const available = new Set([
    ...(state.relationships?.npcs || []).filter((npc) => npc.isAlive !== false && !npc.unavailable).map((npc) => npc.id),
    ...(state.relationships?.partner ? [state.relationships.partner.id] : [])
  ]);
  if ((card.referencedNpcIds || []).some((id) => !available.has(id))) return false;
  return card.choices.every((choice) => {
    const effects = choice.stat_effects;
    return effects && Object.entries(effects).length > 0 && Object.entries(effects).every(([key, value]) =>
      key in LIMITS && Number.isInteger(value) && Math.abs(value) <= LIMITS[key]
    );
  });
}

export function maybeEnhanceRandomEventWithAi(state, normalizeCard, { fetchImpl = globalThis.fetch } = {}) {
  if (!fetchImpl) return false;
  const queue = state.turn.pendingEvents || [];
  const index = queue.findIndex((card, position) => position > state.turn.currentEventIndex && card.source_type === 'random_event' && !card.aiGenerated);
  if (index < 0) return false;
  if (nextSeededRandom(state) >= EVENT_CONFIG.aiGenerationChance) return false;
  const originalId = queue[index].event_id;
  const age = state.profile.age;
  const runId = state.meta.runId;
  const context = createAiContext(state);
  void fetchImpl('/api/random-event', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(context)
  }).then(async (response) => {
    if (!response.ok) return;
    const result = await response.json();
    const card = result.event;
    if (!result.aiGenerated || !validateClientAiCard(card, state)) return;
    if (getState() !== state || state.meta.runId !== runId || state.profile.age !== age || state.turn.phase === 'ENDED') return;
    const currentIndex = state.turn.pendingEvents.findIndex((entry) => entry.event_id === originalId);
    if (currentIndex <= state.turn.currentEventIndex || state.turn.awaitingEventAdvance) return;
    card.rarity = state.turn.pendingEvents[currentIndex].rarity;
    card.monthNum = state.turn.pendingEvents[currentIndex].monthNum;
    card.monthTh = state.turn.pendingEvents[currentIndex].monthTh;
    state.turn.pendingEvents[currentIndex] = normalizeCard(card, 'random_event', 'sparkle');
    saveGame(state);
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('game:stateChanged', { detail: { state } }));
    }
  }).catch(() => {
    // The handcrafted card remains playable when the API is unavailable.
  });
  return true;
}
