# Phase 5D Event Design Standard

**Purpose:** Prepare the existing event pipeline for a future negative-event content phase without introducing that content in the current implementation phase.

## Current Phase Boundary

This phase changes event choice presentation and infrastructure only:

- Every authored event in the 12 event pools must contain at least three choices.
- Existing two-choice events receive a balanced third option based on the existing choices' stat effects.
- Stat deltas are not shown before selection. The UI presents a qualitative explanation of likely consequences.
- After selection, the event result must show a narrative follow-through and the actual stat deltas.
- From age 1 onward, the annual queue must contain at least two events. Age 0 is exempt.
- Existing positive, neutral, and negative effects remain supported; this phase does not add a new negative-event pool.

## Event and Choice Contract

Each event must have:

- A unique `event_id`.
- A clear `title_th` and `description_th`.
- At least three choices with unique `choice_id` values.
- Age, class, location, career, relationship, and flag requirements only when relevant.

Each choice should have:

- `label_th`: the action the player is choosing.
- `req_stats` and `req_flags`: eligibility requirements; use empty values when the choice is generally available.
- `stat_effects`: the deterministic outcome when applicable.
- `relationship_change`: relationship impact when relevant.
- `grants_flags` / `removes_flags`: durable state changes when relevant.
- `outcome_text_th`: an optional authored narrative for what happens after the action.

Choices with RNG may additionally use:

- `rng_mechanic.success_chance_percent`
- `rng_mechanic.fail_stat_effects`
- `rng_mechanic.fail_grants_flags` / `rng_mechanic.fail_removes_flags`
- `success_outcome_text_th` and `rng_mechanic.fail_outcome_text_th`

## Player-Facing Disclosure

Before selection:

- Do not display numeric stat changes, cash deltas, or raw `hint_th` values.
- Show a natural-language preview such as “ช่วยส่งเสริมสุขภาพ” or “อาจมีค่าใช้จ่าย”.
- Keep actual requirement explanations for locked choices visible where needed.
- RNG probability may be shown separately when the choice uses an explicit random roll.

After selection:

- Show what the character did and what happened next.
- Show the actual applied stat and finance deltas, not the intended values.
- For RNG choices, show the branch that actually occurred.
- Save the narrative and deltas in the life feed so they survive reload.

## Future Negative-Event Content Rules

When the negative-event pool is authored in its own phase:

1. Negative events must create a decision, not merely apply an unavoidable stat penalty.
2. Provide at least three genuinely distinct responses where the context allows them, such as addressing the problem immediately, seeking support, or choosing a lower-cost alternative.
3. Make the trade-offs legible in natural language without revealing hidden numeric balance values.
4. Use positive, negative, or mixed effects intentionally; do not make every response a disguised penalty.
5. Add an authored aftermath for every important branch, including failure branches.
6. Avoid arbitrary effects that do not follow from the event description or the player's chosen action.
7. Verify that the event can appear under its intended age, class, location, career, and relationship conditions.
8. Run data validation, event eligibility tests, choice-resolution tests, annual queue tests, and save/reload UI tests.

## Validation Gate

`npm run validate:data` must verify at least three choices per authored event, unique event IDs, unique choice IDs within an event, and valid event-choice structure.

A future negative-event phase must add tests for both success and failure branches and verify that the narrative shown to the player matches the branch and effects that were actually applied.
