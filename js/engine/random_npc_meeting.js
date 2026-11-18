export function applyRandomNpcMeeting(state, event, choice) {
  const person = choice?.meetNpc;
  if (!person || !event || !state.relationships || !Array.isArray(state.relationships.npcs)) return null;
  const id = `npc_${event.event_id}`;
  if (state.relationships.npcs.some((npc) => npc.id === id)) return null;
  const npc = {
    id,
    archetypeId: 'npc_arch_random_friend',
    name: person.name,
    fullName: person.name,
    shortName: person.name,
    roleTitle: person.roleTitle || 'เพื่อนใหม่',
    genderIdentity: person.genderIdentity,
    identityShared: Boolean(person.identityShared),
    relationship: 45,
    isAlive: true,
    metAtAge: state.profile.age
  };
  state.relationships.npcs.push(npc);
  return npc;
}
