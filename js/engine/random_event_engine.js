import { EVENT_CONFIG } from '../core/event_settings.js';
import { db } from '../core/db.js';

const UINT32 = 0x100000000;

export function nextSeededRandom(state) {
  const turn = state.turn;
  if (!Number.isInteger(turn.randomEventSeed)) {
    const source = String(state.meta?.runId || 'ชีวิตใหม่');
    let hash = 2166136261;
    for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    turn.randomEventSeed = hash >>> 0;
  }
  turn.randomEventSeed = (Math.imul(turn.randomEventSeed, 1664525) + 1013904223) >>> 0;
  return turn.randomEventSeed / UINT32;
}

export function weightedPick(items, weightOf, random) {
  const weighted = items.map((item) => ({ item, weight: Math.max(0, Number(weightOf(item)) || 0) }));
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (!total) return null;
  let roll = random() * total;
  for (const entry of weighted) {
    roll -= entry.weight;
    if (roll < 0) return entry.item;
  }
  return weighted.at(-1).item;
}

export function chooseRarity(random, weights = EVENT_CONFIG.rarityWeights) {
  return weightedPick(Object.keys(weights), (rarity) => weights[rarity], random);
}

export function isRandomEventEligible(event, state, selectedIds = new Set()) {
  const age = Number(state.profile?.age || 0);
  if (age < event.minAge || age > event.maxAge) return false;
  if (selectedIds.has(event.id)) return false;
  const history = state.turn?.randomEventHistory || [];
  const last = [...history].reverse().find((entry) => entry.id === event.id);
  if (last && age - last.age <= (event.cooldownTurns ?? EVENT_CONFIG.cooldownTurns)) return false;
  if (event.oncePerLife && last) return false;
  for (const condition of event.triggerConditions || []) {
    const value = conditionValue(condition, state);
    if (condition.op === 'eq' && value !== condition.value) return false;
    if (condition.op === 'neq' && value === condition.value) return false;
    if (condition.op === 'lte' && !(value <= condition.value)) return false;
    if (condition.op === 'gte' && !(value >= condition.value)) return false;
    if (condition.op === 'includes' && !(Array.isArray(value) && value.includes(condition.value))) return false;
    if (condition.op === 'in' && !(Array.isArray(condition.value) && condition.value.includes(value))) return false;
    if (!['eq', 'neq', 'lte', 'gte', 'includes', 'in'].includes(condition.op)) return false;
  }
  if (event.npcId) {
    const npc = state.relationships?.npcs?.find((person) => person.id === event.npcId);
    if (!npc || npc.isAlive === false || npc.unavailable) return false;
  }
  return true;
}

function conditionValue(condition, state) {
  const allowed = {
    cash: state.finance?.cash,
    stress: 100 - Number(state.stats?.happiness ?? 100),
    friendship: Math.max(0, ...(state.relationships?.npcs || []).filter((npc) => npc.isAlive !== false && (String(npc.archetypeId || '').includes('friend') || String(npc.roleTitle || '').includes('เพื่อน'))).map((npc) => Number(npc.relationship || 0))),
    npcConflict: (state.relationships?.npcs || []).some((npc) => npc.isAlive !== false && Number(npc.relationship || 0) < 30),
    province: state.profile?.currentLocationId,
    region: db.getLocation(state.profile?.currentLocationId)?.region,
    class: state.profile?.currentClassId,
    job: state.careerAndEdu?.mainJobId,
    partnerStatus: state.relationships?.partner?.status || null,
    degrees: state.careerAndEdu?.completedDegrees,
    traits: state.innateTraits,
    flags: state.flags,
    recentCategories: (state.turn?.randomEventHistory || []).slice(-5).map((entry) => entry.category),
    previousChoices: (state.turn?.randomEventHistory || []).map((entry) => `${entry.id}:${entry.choiceId}`),
    memoryHooks: (state.turn?.randomEventHistory || []).flatMap((entry) => entry.futureStoryHooks || [])
  };
  return allowed[condition.field];
}

export function selectRandomEvents(state, templates, selectedIds = new Set(), config = EVENT_CONFIG) {
  if (nextSeededRandom(state) >= config.eventTriggerChance) return [];
  const history = state.turn.randomEventHistory || [];
  const counts = new Map();
  for (const entry of history.slice(-12)) counts.set(entry.category, (counts.get(entry.category) || 0) + 1);
  const result = [];
  const count = Math.min(config.maxEventsPerTurn, 1 + (nextSeededRandom(state) < (config.extraEventChance ?? 0.20) ? 1 : 0));
  for (let index = 0; index < count; index++) {
    const eligible = templates.filter((event) => isRandomEventEligible(event, state, selectedIds));
    if (!eligible.length) break;
    const availableRarities = new Set(eligible.map((event) => event.rarity));
    const availableWeights = Object.fromEntries(Object.entries(config.rarityWeights).filter(([rarity]) => availableRarities.has(rarity)));
    const rarity = chooseRarity(() => nextSeededRandom(state), availableWeights);
    const pool = eligible.filter((event) => event.rarity === rarity);
    const chosen = weightedPick(pool, (event) => contextualWeight(event, state) / (1 + (counts.get(event.category) || 0)), () => nextSeededRandom(state));
    if (!chosen) break;
    selectedIds.add(chosen.id);
    result.push(chosen);
    counts.set(chosen.category, (counts.get(chosen.category) || 0) + 1);
  }
  return result;
}

export function contextualWeight(event, state) {
  const rawWeight = event.probabilityWeight === undefined ? 1 : Number(event.probabilityWeight);
  let weight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;
  const hints = event.weightHints || {};
  if (hints.provinces?.includes(state.profile?.currentLocationId)) weight *= 1.8;
  if (hints.regions?.includes(db.getLocation(state.profile?.currentLocationId)?.region)) weight *= 1.5;
  if (hints.classes?.includes(state.profile?.spawnClassId)) weight *= 1.5;
  if (hints.traits?.some((trait) => state.innateTraits?.includes(trait))) weight *= 1.4;
  if (hints.jobs?.includes(state.careerAndEdu?.mainJobId)) weight *= 1.5;
  if (hints.hasJob && state.careerAndEdu?.mainJobId) weight *= 1.5;
  if (hints.degree && state.careerAndEdu?.completedDegrees?.length) weight *= 1.3;
  if (hints.lowMoney && Number(state.finance?.cash || 0) < 1000) weight *= 2;
  if (hints.highFriendship && conditionValue({ field: 'friendship' }, state) >= 70) weight *= 1.5;
  if (hints.previousEventIds?.some((id) => (state.turn?.randomEventHistory || []).some((entry) => entry.id === id))) weight *= 1.7;
  if (hints.previousChoiceIds?.some((id) => conditionValue({ field: 'previousChoices' }, state).includes(id))) weight *= 1.8;
  if (hints.memoryHook && conditionValue({ field: 'memoryHooks' }, state).includes(hints.memoryHook)) weight *= 2;
  return weight;
}

export function recordRandomEvent(state, event, choiceId) {
  if (!Array.isArray(state.turn.randomEventHistory)) state.turn.randomEventHistory = [];
  state.turn.randomEventHistory.push({ id: event.id, category: event.category, rarity: event.rarity, age: state.profile.age, choiceId, title: event.title, futureStoryHooks: event.futureStoryHooks || [] });
}
