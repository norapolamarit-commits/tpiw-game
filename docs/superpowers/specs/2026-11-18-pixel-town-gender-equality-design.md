# Pixel Town: Gender Equality Encounters — Design

## Goal
Add a WorldBox-style pixel minimap ("living town") and a gender-diverse encounter system whose purpose is to teach gender equality. Existing 5-tab engine is untouched except for integration hooks.

## Decisions (user-approved)
- Minimap = living town map with walking NPCs; clicking an NPC opens an encounter.
- Identity scope = diverse: male, female, gay, lesbian, bisexual, trans man, trans woman, non-binary, other; tied to Thai context.
- Mechanic = equality score + real consequences, with a town equality index reflected visually on the map and lessons at year/life end.
- Out of scope: reworking existing romance/marriage to allow any partner gender (later round).

## Components
1. `js/ui/pixel_town.js` + `css/pixel_town.css`: canvas 64x40 tiles, `imageSmoothingEnabled=false`, seeded map (grass, water, road, house, school, workplace, market) varying by age/class/province; player marker plus randomly walking NPC pixels colored per identity, with legend. Shown as a card on tab3, mini-collapsed on tab1.
2. `js/engine/gender_encounter_engine.js` + `data/Gender_Encounters.json`: identity pool, encounter events (school, work, family, public) with 2-3 choices (disrespect / ignore / defend / respect); no emoji in text. Pure functions for NPC spawn, encounter pick, choice resolution.
3. Equality index (state): town index 0-100 and per-NPC relationship. Respect/defend raises index; disrespect lowers it and affects happiness, merit, relationship. Map palette brightens (flowers) at high index, dims (fences) at low. Year/life-end summary hooks into `ending_engine`.
4. Persistence through existing `state.js` save/load; migration default for old saves.

## Testing
`node --test` unit tests: seeded map determinism, encounter selection by age/context, score resolution bounds, save migration. Manual verification in the browser.

## Constraints
Follow existing patterns (ES modules, Thai UI text, no emoji), reuse existing modal and router.
