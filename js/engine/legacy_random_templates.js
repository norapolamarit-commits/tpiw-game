// The base game already contains hundreds of authored, consequence-bearing Thai
// events. Curate 125 of them into the dynamic pool without copying their prose.
import { EVENT_CONFIG } from '../core/event_settings.js';
const CURATED = [
  ['eventsLocKarma', 0, 30, 'daily_life', 'common'],
  ['eventsPhase2', 0, 15, 'education', 'common'],
  ['eventsPhase3', 0, 10, 'education', 'uncommon'],
  ['eventsRelFamily', 0, 20, 'family', 'uncommon'],
  ['eventsRelFamily', 20, 10, 'friendship', 'common'],
  ['eventsRelRomance', 0, 10, 'romance', 'uncommon'],
  ['eventsJobsGig', 0, 8, 'finance', 'common'],
  ['eventsJobsCorp', 0, 7, 'career', 'rare'],
  ['eventsLocKarma', 55, 15, 'rare_events', 'rare']
];

export function buildCuratedLegacyTemplates(raw) {
  const result = [];
  for (const [fileKey, start, count, category, rarity] of CURATED) {
    const events = raw[fileKey]?.events || [];
    if (events.length < start + count) throw new Error(`คลังเหตุการณ์ไม่ครบ: ${fileKey}`);
    for (const event of events.slice(start, start + count)) {
      result.push({
        id: event.event_id,
        title: event.title_th,
        description: event.description_th,
        category,
        rarity,
        minAge: Number(event.trigger_age ?? event.min_age ?? 0),
        maxAge: Number(event.trigger_age ?? event.max_age ?? 100),
        triggerConditions: [],
        choices: event.choices,
        probabilityWeight: 1,
        cooldownTurns: EVENT_CONFIG.cooldownTurns,
        oncePerLife: true,
        aiGenerated: false,
        legacyEvent: event
      });
    }
  }
  return result;
}
