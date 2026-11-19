import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyGameState, mergeGameStateWithTemplate } from '../js/core/state.js';
import { addRandomEventDialogue } from '../js/engine/event_dialogue_engine.js';

test('random event speech changes within a category and survives save reload', () => {
  const state = createEmptyGameState();
  state.meta.runId = 'dialogue-run';
  state.profile.age = 20;
  const card = { event_id: 'random_friend_a', source_type: 'random_event', category: 'friendship' };
  const lines = new Set();
  for (let i = 0; i < 3; i++) {
    const result = addRandomEventDialogue(state, { ...card, event_id: `${card.event_id}_${i}` });
    assert.ok(result.eventDialogueTh);
    assert.equal(lines.has(result.eventDialogueTh), false);
    lines.add(result.eventDialogueTh);
  }
  const restored = mergeGameStateWithTemplate(JSON.parse(JSON.stringify(state)));
  assert.ok(lines.has(addRandomEventDialogue(restored, card).eventDialogueTh), 'pool starts a new cycle after all lines were used');
  assert.deepEqual(restored.turn.eventDialogueHistory.friendship.length, 1);
  assert.equal(addRandomEventDialogue(state, { source_type: 'pool_event' }).eventDialogueTh, undefined);
});
