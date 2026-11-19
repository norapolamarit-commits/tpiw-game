/**
 * js/engine/relationship_stage_engine.js
 * เมนูระดับความสัมพันธ์: คนรู้จัก → เพื่อน → เพื่อนสนิท → คนคุย → แฟน → แต่งงาน และสายกิ๊ก (ไม่ผูกมัด แต่ต้องซื่อสัตย์)
 * ใช้ได้กับทุกเพศ อีกฝ่ายอาจปฏิเสธได้เสมอ (การเคารพคำว่า "ไม่" เป็นส่วนหนึ่งของบทเรียน)
 * เชื่อมกับระบบคนคุย/แฟน/แต่งงานเดิม (state.relationships.partner และ rel_act_propose_marriage)
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { db } from '../core/db.js';
import { applyStatEffects } from '../core/stat_engine.js';
import { ensureEquality, getIdentity, hashString } from './gender_encounter_engine.js';
import { breakUpWithPartner, performRelationshipAction } from './social_engine.js';
import { queueConsequence } from './social_consequence_engine.js';

export const STAGES = [
  { id: 'acquaintance', label: 'คนรู้จัก' },
  { id: 'friend', label: 'เพื่อน' },
  { id: 'close_friend', label: 'เพื่อนสนิท' },
  { id: 'crush', label: 'คนคุย' },
  { id: 'dating', label: 'แฟน' },
  { id: 'engaged', label: 'หมั้นแล้ว' },
  { id: 'married', label: 'แต่งงานแล้ว' }
];
const EXTRA_LABELS = { fling: 'กิ๊ก', secret: 'แอบคบ', ex: 'แฟนเก่า' };
export const RING_COST = 20000;
export const COURT_DIVORCE_COST = 15000;
export const COVER_COST = 500;
export const FLING_LABEL = 'กิ๊ก';
export const MIN_AGE = { talk: 16, dating: 16, fling: 18, secret: 18, engage: 20, marriage: 20 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isFamily = (n) => n.id === 'npc_father' || n.id === 'npc_mother' || n.archetypeId === 'npc_arch_father' || n.archetypeId === 'npc_arch_mother';
const hasPartner = (state) => Boolean(state.relationships?.partner);
const partnerIs = (state, npc) => state.relationships?.partner?.sourceNpcId === npc.id;

export function getStageLabel(npc) {
  if (npc.stage === 'secret' && npc.secretKind === 'talk') return 'คุยซ้อน';
  if (EXTRA_LABELS[npc.stage]) return EXTRA_LABELS[npc.stage];
  return (STAGES.find((x) => x.id === npc.stage) || STAGES[0]).label;
}

/** ระดับปัจจุบัน: ถ้ายังไม่เคยตั้งค่า ให้อนุมานจากความสนิท */
export function stageOf(npc) {
  if (npc.stage) return npc.stage;
  const r = Number(npc.relationship || 0);
  return r >= 70 ? 'close_friend' : r >= 45 ? 'friend' : 'acquaintance';
}

/** ความสนใจ/ความเปิดใจของอีกฝ่าย (คงที่ต่อคน ไม่ผูกกับเพศใดๆ) */
export function openness(state, npc) {
  const h = hashString(`${state.meta?.runId || 'x'}|open|${npc.id}`);
  const playerIdentity = state.profile?.genderIdentity || (state.profile?.gender === 'female' ? 'woman' : 'man');
  const compatible = npc.genderIdentity === 'gay_man' ? ['man', 'trans_man', 'gay_man'].includes(playerIdentity)
    : npc.genderIdentity === 'lesbian' ? ['woman', 'trans_woman', 'lesbian'].includes(playerIdentity)
      : true;
  return { romance: compatible && h % 100 < 55, casual: compatible && (h >> 7) % 100 < 40 };
}

export function listRelationshipNpcs(state) {
  return (state.relationships?.npcs || []).filter((n) => n.isAlive !== false && !isFamily(n));
}

function syncStage(state, npc) {
  npc.stage = stageOf(npc);
  const p = state.relationships?.partner;
  if (p && p.sourceNpcId === npc.id) npc.stage = p.status === 'married' ? 'married' : p.status === 'dating' ? (p.engaged ? 'engaged' : 'dating') : 'crush';
  return npc.stage;
}

const lock = (id, label, reason) => ({ id, label, locked: true, reason });
const open = (id, label) => ({ id, label, locked: false, reason: '' });

/** รายการ "ก้าวถัดไป" ที่ทำได้กับ NPC คนนี้ (พร้อมเหตุผลที่ยังทำไม่ได้) */
export function getMoves(state, npc) {
  const age = Number(state.profile?.age || 0);
  const stage = syncStage(state, npc);
  const rel = Number(npc.relationship || 0);
  const moves = [];
  const partnerOther = hasPartner(state) && !partnerIs(state, npc);
  if (npc.isCast) {
    if (stage === 'acquaintance') moves.push(rel >= 40 ? open('befriend', 'ขอเป็นเพื่อน') : lock('befriend', 'ขอเป็นเพื่อน', 'ต้องสนิทกันถึง 40% ก่อน'));
    if (stage === 'friend') moves.push(rel >= 65 ? open('best_friend', 'ขอเป็นเพื่อนสนิท') : lock('best_friend', 'ขอเป็นเพื่อนสนิท', 'ต้องสนิทกันถึง 65% ก่อน'));
    return moves;
  }
  if (stage === 'acquaintance') moves.push(rel >= 40 ? open('befriend', 'ขอเป็นเพื่อน') : lock('befriend', 'ขอเป็นเพื่อน', 'ต้องสนิทกันถึง 40% ก่อน'));
  if (stage === 'friend') moves.push(rel >= 65 ? open('best_friend', 'ขอเป็นเพื่อนสนิท') : lock('best_friend', 'ขอเป็นเพื่อนสนิท', 'ต้องสนิทกันถึง 65% ก่อน'));
  if (stage === 'close_friend' || stage === 'fling') {
    if (age < MIN_AGE.talk) moves.push(lock('talk', 'ขอลองคุยแบบคนคุย', `ต้องอายุ ${MIN_AGE.talk} ปีขึ้นไป`));
    else if (partnerOther) moves.push(lock('talk', 'ขอลองคุยแบบคนคุย', 'คุณมีคนคุยหรือแฟนอยู่แล้ว ต้องเคลียร์ให้ชัดเจนก่อน'));
    else moves.push(rel >= 75 ? open('talk', 'ขอลองคุยแบบคนคุย') : lock('talk', 'ขอลองคุยแบบคนคุย', 'ต้องสนิทกันถึง 75% ก่อน'));
  }
  if (stage === 'close_friend' || stage === 'crush') {
    if (age < MIN_AGE.fling) moves.push(lock('fling', 'ขอเป็นกิ๊ก (ไม่ผูกมัด)', `ต้องอายุ ${MIN_AGE.fling} ปีขึ้นไป`));
    else if (hasPartner(state)) moves.push(lock('fling', 'ขอเป็นกิ๊ก (ไม่ผูกมัด)', 'คุณมีคนคุยหรือแฟนอยู่ ต้องซื่อสัตย์และเคลียร์ให้ชัดก่อน'));
    else moves.push(rel >= 70 ? open('fling', 'ขอเป็นกิ๊ก (ไม่ผูกมัด)') : lock('fling', 'ขอเป็นกิ๊ก (ไม่ผูกมัด)', 'ต้องสนิทกันถึง 70% ก่อน'));
  }
  if (stage === 'crush') moves.push(age < MIN_AGE.dating ? lock('ask_dating', 'ขอเป็นแฟน', `ต้องอายุ ${MIN_AGE.dating} ปีขึ้นไป`) : rel >= 85 ? open('ask_dating', 'ขอเป็นแฟน') : lock('ask_dating', 'ขอเป็นแฟน', 'ต้องสนิทกันถึง 85% ก่อน'));
  if (stage === 'dating') moves.push(age < MIN_AGE.engage ? lock('engage', 'ขอหมั้น', `ต้องอายุ ${MIN_AGE.engage} ปีขึ้นไป`) : rel < 90 ? lock('engage', 'ขอหมั้น', 'ต้องสนิทกันถึง 90% ก่อน') : Number(state.finance?.cash || 0) < RING_COST ? lock('engage', `ขอหมั้น (ค่าแหวน ${RING_COST.toLocaleString('th-TH')} บาท)`, 'เงินสดไม่พอซื้อแหวน') : open('engage', `ขอหมั้น (ค่าแหวน ${RING_COST.toLocaleString('th-TH')} บาท)`));
  if (stage === 'engaged') moves.push(open('wedding', 'จดทะเบียนสมรส / จัดงานแต่ง'));
  if (stage === 'married') moves.push(open('divorce_amicable', 'หย่าโดยสมัครใจ (แบ่งสินสมรสครึ่งหนึ่ง)'), open('divorce_court', `หย่าแบบฟ้องศาล (ค่าทนาย ${COURT_DIVORCE_COST.toLocaleString('th-TH')} บาท และกระทบจิตใจมากกว่า)`));
  if (stage === 'ex') {
    const exAge = Number(npc.exAge ?? -9);
    if (hasPartner(state)) moves.push(lock('reconcile', 'ขอคืนดี', 'คุณมีคนคุยหรือแฟนอยู่แล้ว'));
    else if (age <= exAge) moves.push(lock('reconcile', 'ขอคืนดี', 'ให้เวลากันสักปีก่อนค่อยคุยนะ'));
    else moves.push(rel >= 50 ? open('reconcile', 'ขอคืนดี') : lock('reconcile', 'ขอคืนดี', 'ต้องกลับมาสนิทกันถึง 50% ก่อน'));
  }
  if (stage === 'crush' || stage === 'dating' || stage === 'fling' || stage === 'engaged') moves.push(open('step_back', stage === 'engaged' ? 'ยกเลิกการหมั้น' : stage === 'dating' ? 'เลิกเป็นแฟน' : stage === 'fling' ? 'ยุติความเป็นกิ๊ก (กลับไปเป็นเพื่อน)' : 'พอแค่เพื่อน (เลิกคุย)'));
  if (stage === 'secret') {
    if (npc.secretKind === 'talk') moves.push(rel >= 70 ? open('secret_date', 'พัฒนาจากคุยซ้อนเป็นแอบคบ') : lock('secret_date', 'พัฒนาจากคุยซ้อนเป็นแอบคบ', 'ต้องสนิทกันถึง 70% ก่อน'));
    moves.push(Number(state.finance?.cash || 0) < COVER_COST || npc.coveredAge === age ? lock('cover_tracks', `ระวังตัวไม่ให้ใครรู้ (${COVER_COST} บาท)`, npc.coveredAge === age ? 'ปีนี้ระวังตัวไปแล้ว' : 'เงินสดไม่พอ') : open('cover_tracks', `ระวังตัวไม่ให้ใครรู้ (${COVER_COST} บาท)`));
    moves.push(open('confess', 'สารภาพกับคู่ของคุณตรงๆ'), open('end_secret', npc.secretKind === 'talk' ? 'หยุดคุยซ้อน แล้วกลับไปเป็นเพื่อน' : 'เลิกแอบคบ แล้วกลับไปเป็นเพื่อน'));
  }
  if (hasPartner(state) && !partnerIs(state, npc) && ['friend', 'close_friend', 'fling'].includes(stage)) {
    const risk = Math.round(secretRiskPct(state, { secrecy: 70 }) * 100);
    moves.push(age < MIN_AGE.talk ? lock('secret_talk', 'เริ่มคุยซ้อน', `ต้องอายุ ${MIN_AGE.talk} ปีขึ้นไป`) : rel < 65 ? lock('secret_talk', 'เริ่มคุยซ้อน', 'ต้องสนิทกันถึง 65% ก่อน') : open('secret_talk', `เริ่มคุยซ้อน (เสี่ยงถูกจับได้ราว ${risk}% ต่อปี)`));
    moves.push(age < MIN_AGE.secret ? lock('secret_date', 'แอบคบซ้อน', `ต้องอายุ ${MIN_AGE.secret} ปีขึ้นไป`) : rel < 70 ? lock('secret_date', 'แอบคบซ้อน (ผิดคำมั่นกับคู่)', 'ต้องสนิทกันถึง 70% ก่อน') : open('secret_date', `แอบคบซ้อน (เสี่ยงถูกจับได้ราว ${risk}% ต่อปี)`));
  }
  return moves;
}

function makePartnerFromNpc(state, npc, status) {
  const arches = db.indexes?.partnerArchetypes ? [...db.indexes.partnerArchetypes.keys()] : [];
  const arch = arches.length ? db.indexes.partnerArchetypes.get(arches[hashString(npc.id) % arches.length]) : null;
  const identity = npc.genderIdentity || 'woman';
  state.relationships.partner = {
    id: `partner_${npc.id}`, sourceNpcId: npc.id, archetypeId: arch?.archetype_id || 'partner_generic',
    name: npc.name, shortName: npc.shortName || npc.name, roleTitle: arch?.role_title_th || 'คนพิเศษ',
    gender: ['man', 'trans_man', 'gay_man'].includes(identity) ? 'male' : 'female', genderIdentity: identity, identityShared: true,
    age: Number(state.profile.age || 0), relationship: Number(npc.relationship || 50), status,
    dowryCostCash: Number(arch?.dowry_marriage_cost_cash ?? 50000), netAnnualCashContribution: Number(arch?.spouse_economy_after_marriage?.net_annual_cash_contribution ?? 0),
    financialTraitId: null, metAtAge: Number(state.profile.age || 0)
  };
  return state.relationships.partner;
}

/** โอกาสถูกจับได้ต่อปี รวมทุกคนที่แอบคบ (ยิ่งแอบหลายคน ยิ่งปกปิดไม่ดี ยิ่งเสี่ยง) */
export function secretRiskPct(state, onlyNpc = null) {
  const secrets = onlyNpc ? [onlyNpc] : (state.relationships?.npcs || []).filter((n) => n.stage === 'secret');
  if (!secrets.length) return 0;
  let safe = 1;
  for (const n of secrets) safe *= 1 - clamp(0.12 + (100 - Number(n.secrecy ?? 70)) / 250, 0.05, 0.7);
  const extra = Math.max(0, secrets.length - 1) * 0.05;
  return clamp(1 - safe + extra, 0, 0.85);
}

const spend = (state, amt) => { if (Number(state.finance?.cash || 0) < amt) return false; state.finance.cash = Math.round(state.finance.cash - amt); return true; };
const addFlag = (state, f) => { state.flags ||= []; if (!state.flags.includes(f)) state.flags.push(f); };
const delFlag = (state, f) => { state.flags = (state.flags || []).filter((x) => x !== f); };

/** หย่าร้าง: แบ่งสินสมรสครึ่งหนึ่ง (ใช้กติกาเดิมของเกม) บวกผลกระทบตามรูปแบบการหย่า */
function doDivorce(state, npc, mode) {
  const kids = state.relationships?.children || [];
  if (mode === 'court' && !spend(state, COURT_DIVORCE_COST)) return { success: false, message: 'เงินสดไม่พอจ่ายค่าทนายความ' };
  const res = performRelationshipAction(state, 'rel_act_file_divorce', null);
  if (!res.success) { if (mode === 'court') state.finance.cash += COURT_DIVORCE_COST; return { success: false, message: res.message || 'ยังหย่าไม่ได้ในตอนนี้' }; }
  npc.stage = 'ex';
  npc.exAge = Number(state.profile.age || 0);
  npc.relationship = mode === 'court' ? 12 : 42;
  for (const k of kids) k.relationship = clamp(Number(k.relationship || 50) - (mode === 'court' ? 12 : 4), 0, 100);
  applyStatEffects(state, mode === 'court' ? { happiness: -6, connections: -2, merit: -1 } : { happiness: -2, merit: 1 });
  log(state, `หย่าร้างกับ ${npc.name}`, mode === 'court' ? 'หย่าแบบฟ้องศาล ใช้เวลานานและเหนื่อยใจ ทนายคิดค่าบริการตามกำหนด' : 'ตกลงหย่ากันอย่างสุภาพ แบ่งสินสมรสครึ่งหนึ่ง และยังเคารพกันในฐานะผู้ที่เคยรักกัน');
  return { success: true, message: `${res.message}${kids.length ? ' ความสัมพันธ์กับลูกได้รับผลกระทบ ควรใช้เวลาอธิบายและอยู่ข้างลูกให้มาก' : ''}`, stage: 'แฟนเก่า' };
}

const decline = (npc, line) => { npc.relationship = clamp(Number(npc.relationship || 0) - 2, 0, 100); return { success: false, declined: true, message: line }; };
const log = (state, title, message) => state.turn?.lifeFeedLog?.push({ age: Number(state.profile?.age || 0), monthTh: 'ตลอดปี', type: 'relationship', title, message });

export function performMove(state, npcId, moveId) {
  const npc = listRelationshipNpcs(state).find((n) => n.id === npcId);
  if (!npc) return { success: false, message: 'ไม่พบคนนี้ในรายชื่อ' };
  const move = getMoves(state, npc).find((m) => m.id === moveId);
  if (!move) return { success: false, message: 'ตอนนี้ยังทำขั้นนี้ไม่ได้' };
  if (move.locked) return { success: false, message: move.reason };
  const age = Number(state.profile.age || 0);
  if (npc.declinedAge === age && ['talk', 'ask_dating', 'fling', 'secret_talk', 'secret_date'].includes(moveId)) return { success: false, message: 'ปีนี้คุณเพิ่งถามไปแล้ว ให้เวลาเขาสักหน่อยนะ การรออย่างเคารพก็เป็นความใจดี' };
  const o = openness(state, npc);
  const eq = ensureEquality(state);
  const ok = (stage, msg, fx = {}) => {
    npc.stage = stage;
    npc.relationship = clamp(Number(npc.relationship || 0) + (fx.rel ?? 4), 0, 100);
    applyStatEffects(state, fx.effects || { happiness: 2 });
    eq.townIndex = clamp(eq.townIndex + (fx.idx ?? 1), 0, 100);
    log(state, `ความสัมพันธ์กับ ${npc.name}: ${getStageLabel(npc)}`, msg);
    return { success: true, message: msg, stage: getStageLabel(npc) };
  };
  const no = (line) => { npc.declinedAge = age; return decline(npc, line); };

  switch (moveId) {
    case 'befriend': return ok('friend', `${npc.name} ยิ้มกว้าง "ได้เลย เป็นเพื่อนกันนะ!" ตอนนี้คุณทั้งสองเป็นเพื่อนกัน`);
    case 'best_friend': return ok('close_friend', `${npc.name} หัวเราะดีใจ "เพื่อนสนิทเลยเหรอ ขอบคุณที่ไว้ใจนะ" คุณทั้งสองสนิทกันขึ้นอีกระดับ`, { rel: 6 });
    case 'talk': {
      if (!o.romance) return no(`${npc.name} ยิ้มอ่อนโยน "ขอบคุณที่บอกตรงๆ นะ แต่ตอนนี้ฉันอยากเป็นเพื่อนกันแบบนี้ต่อไปมากกว่า" คุณขอบคุณที่เขาตอบตรงๆ และยังเป็นเพื่อนกันเหมือนเดิม`);
      makePartnerFromNpc(state, npc, 'crush');
      return ok('crush', `${npc.name} หน้าแดงนิดๆ "ก็ได้ ลองคุยกันดู" คุณทั้งสองเริ่มคุยกันแบบคนคุย`, { rel: 3 });
    }
    case 'ask_dating': {
      if (!o.romance || Number(npc.relationship) < 85) return no(`${npc.name} เงียบไปครู่หนึ่ง "ขอเวลาคิดหน่อยนะ ยังไม่แน่ใจ" คุณพยักหน้ารับฟังโดยไม่กดดัน`);
      const p = state.relationships.partner?.sourceNpcId === npc.id ? state.relationships.partner : makePartnerFromNpc(state, npc, 'crush');
      p.status = 'dating'; p.relationship = Math.max(p.relationship, 88);
      return ok('dating', `${npc.name} ยิ้มทั้งน้ำตา "ตกลง เป็นแฟนกันนะ" คุณทั้งสองกลายเป็นคนรักกัน`, { rel: 6, effects: { happiness: 5 } });
    }
    case 'fling': {
      if (!o.casual) return no(`${npc.name} ตอบตรงๆ "ขอบคุณที่ชวนนะ แต่ฉันไม่ได้อยากมีความสัมพันธ์แบบไม่ผูกมัด" คุณเคารพคำตอบและยังเป็นเพื่อนกัน`);
      queueConsequence(state, { type: 'fling_talk', npcId: npc.id, name: npc.name });
      return ok('fling', `${npc.name} คิดสักพัก "ได้ แต่เราต้องพูดกันตรงๆ ตลอดนะ ใครอยากเปลี่ยนใจให้บอกกัน" ตอนนี้คุณทั้งสองเป็นกิ๊กที่ตกลงกันชัดเจน`, { rel: 2, idx: 0, effects: { happiness: 1 } });
    }
    case 'engage': {
      if (!spend(state, RING_COST)) return { success: false, message: 'เงินสดไม่พอซื้อแหวนหมั้น' };
      const p = state.relationships.partner;
      p.engaged = true; p.relationship = Math.max(p.relationship, 92);
      addFlag(state, 'flag_has_wedding_ring');
      return ok('engaged', `${npc.name} น้ำตาซึม "ตกลงค่ะ/ครับ ขอแต่งงานกันนะ" แหวนหมั้นถูกสวมนิ้ว คุณทั้งสองประกาศการหมั้นกับครอบครัว`, { rel: 5, effects: { happiness: 6 } });
    }
    case 'wedding': {
      const p = state.relationships.partner;
      p.relationship = 100; addFlag(state, 'flag_partner_hearts_5'); addFlag(state, 'flag_sui_juris_20');
      const res = performRelationshipAction(state, 'rel_act_propose_marriage', null);
      if (state.relationships?.partner?.status === 'married') { npc.stage = 'married'; log(state, `แต่งงานกับ ${npc.name}`, res.message || 'วิวาห์มงคล'); return { success: true, message: res.message || `คุณแต่งงานกับ ${npc.name} แล้ว`, stage: 'แต่งงานแล้ว' }; }
      return { success: false, message: res.message || 'ยังจดทะเบียนสมรสไม่ได้ ตรวจเงินสดสำหรับสินสอดและค่าจัดงาน' };
    }
    case 'divorce_amicable': return doDivorce(state, npc, 'amicable');
    case 'divorce_court': return doDivorce(state, npc, 'court');
    case 'reconcile': {
      if (!o.romance) return no(`${npc.name} พูดเบาๆ "ขอบคุณที่ยังนึกถึงกันนะ แต่ฉันอยากเดินต่อไปแบบนี้" คุณเคารพการตัดสินใจของเขา`);
      const p = makePartnerFromNpc(state, npc, 'dating'); p.relationship = Math.max(p.relationship, 70);
      return ok('dating', `${npc.name} คิดอยู่นาน "เราลองเริ่มใหม่ด้วยความซื่อสัตย์ต่อกันนะ" คุณทั้งสองกลับมาคบกันอีกครั้ง`, { rel: 8, effects: { happiness: 4 } });
    }
    case 'secret_talk': {
      if (!o.romance) return no(`${npc.name} บอกว่าอยากเป็นเพื่อนกันต่อ คุณเคารพคำตอบของเขา`);
      npc.secrecy = 70; npc.secretSinceAge = age; npc.secretKind = 'talk';
      state.social ||= {}; state.social.infidelity = (state.social.infidelity || 0) + 1;
      applyStatEffects(state, { merit: -1, happiness: 1 });
      npc.stage = 'secret';
      log(state, `เริ่มคุยซ้อนกับ ${npc.name}`, 'คุณเริ่มคุยกับอีกคนโดยไม่บอกคู่ปัจจุบัน ความไว้ใจอาจได้รับผลกระทบ');
      return { success: true, message: `คุณเริ่มคุยซ้อนกับ ${npc.name} แล้ว ความลับนี้มีโอกาสถูกพบในแต่ละปี`, stage: 'คุยซ้อน' };
    }
    case 'secret_date': {
      if (!o.romance) return no(`${npc.name} ปฏิเสธทันที "ไม่ล่ะ ฉันไม่อยากเป็นฝ่ายที่ทำให้ใครต้องเจ็บ" และถามว่าคุณมีแฟนอยู่ไม่ใช่เหรอ`);
      const upgrading = npc.stage === 'secret' && npc.secretKind === 'talk';
      npc.secrecy = 70; npc.secretSinceAge = age;
      npc.secretKind = 'date';
      if (!upgrading) { state.social ||= {}; state.social.infidelity = (state.social.infidelity || 0) + 1; }
      applyStatEffects(state, { merit: -2, happiness: 1 });
      npc.stage = 'secret';
      log(state, `แอบคบซ้อนกับ ${npc.name}`, 'คุณเลือกแอบคบโดยไม่บอกคู่ของคุณ ซึ่งทำให้เสี่ยงต่อการถูกจับได้และอาจทำร้ายความไว้ใจที่มี');
      return { success: true, message: `${npc.name} ตกลงแอบคบกับคุณ แต่ต้องระวังตัวให้ดี ทุกปีมีโอกาสถูกจับได้ และถ้าเรื่องแดงขึ้นมา คู่ของคุณจะเสียใจมาก`, stage: 'แอบคบ' };
    }
    case 'cover_tracks': {
      if (!spend(state, COVER_COST)) return { success: false, message: 'เงินสดไม่พอ' };
      npc.coveredAge = age; npc.secrecy = clamp(Number(npc.secrecy ?? 70) + 20, 0, 100);
      return { success: true, message: 'คุณลบแชต เปลี่ยนที่นัด และระวังตัวมากขึ้นปีนี้ แต่ความรู้สึกผิดก็เพิ่มขึ้นเช่นกัน', stage: 'แอบคบ' };
    }
    case 'confess': {
      const p = state.relationships.partner;
      if (!p) return { success: false, message: 'ไม่มีคู่ให้สารภาพ' };
      npc.stage = 'friend'; npc.relationship = clamp(Number(npc.relationship || 0) - 15, 0, 100);
      const forgive = Number(p.relationship) >= 75 || hashString(`${state.meta?.runId}|forgive|${age}`) % 100 < 35;
      p.relationship = clamp(Number(p.relationship) - 25, 0, 100);
      applyStatEffects(state, { merit: 2, happiness: -3 });
      log(state, 'สารภาพกับคู่', forgive ? 'คู่ของคุณเสียใจมาก แต่ให้โอกาสเพราะคุณกล้าพูดความจริง' : 'คู่ของคุณเสียใจมากและเลือกจบความสัมพันธ์');
      if (!forgive) { if (p.status === 'married') doDivorce(state, { ...npc, ...{ name: p.name } }, 'amicable'); else breakUpWithPartner(state); return { success: true, message: 'คู่ของคุณเสียใจมากและเลือกจบความสัมพันธ์ คุณกล้าพูดความจริง แม้จะต้องเจ็บ', stage: 'เพื่อน' }; }
      return { success: true, message: 'คู่ของคุณร้องไห้ แล้วบอกว่า "ฉันยังเจ็บอยู่ แต่ขอบคุณที่ไม่โกหกต่อ" ความไว้ใจต้องใช้เวลาสร้างใหม่', stage: 'เพื่อน' };
    }
    case 'end_secret': {
      const wasTalking = npc.secretKind === 'talk';
      npc.stage = 'friend'; npc.relationship = clamp(Number(npc.relationship || 0) - 12, 0, 100);
      delete npc.secretKind;
      applyStatEffects(state, { merit: 1 });
      return { success: true, message: `คุณหยุด${wasTalking ? 'คุยซ้อน' : 'แอบคบ'}กับ ${npc.name} อย่างสุภาพและกลับไปเป็นเพื่อน (คู่ของคุณยังไม่รู้เรื่องนี้ แต่คุณรู้สึกเบาขึ้นที่เลิกปิดบัง)`, stage: 'เพื่อน' };
    }
    case 'propose': {
      const res = performRelationshipAction(state, 'rel_act_propose_marriage', null);
      if (state.relationships?.partner?.status === 'married') { npc.stage = 'married'; log(state, `แต่งงานกับ ${npc.name}`, res.message || 'วิวาห์มงคล'); return { success: true, message: res.message || `คุณแต่งงานกับ ${npc.name} แล้ว`, stage: 'แต่งงานแล้ว' }; }
      return { success: false, message: res.message || 'ยังขอแต่งงานไม่ได้ในตอนนี้' };
    }
    case 'step_back': {
      if (partnerIs(state, npc) && state.relationships.partner.status === 'married') return { success: false, message: 'ต้องหย่าตามกฎหมายเท่านั้น' };
      const wasDating = npc.stage === 'dating' || npc.stage === 'engaged';
      if (partnerIs(state, npc)) breakUpWithPartner(state);
      npc.stage = wasDating ? 'ex' : 'friend';
      if (wasDating) npc.exAge = Number(state.profile.age || 0);
      npc.relationship = clamp(Number(npc.relationship || 0) - 8, 0, 100);
      log(state, `ยุติความสัมพันธ์กับ ${npc.name}`, 'คุยกันดีๆ และตกลงแยกทางอย่างสุภาพ ไม่มีใครต้องเสียใจคนเดียว');
      return { success: true, message: `คุณและ ${npc.name} คุยกันอย่างสุภาพและแยกทางกัน ${wasDating ? '(เป็นแฟนเก่า ถ้าเวลาผ่านไปอาจกลับมาคุยกันได้)' : '(กลับไปเป็นเพื่อน)'}`, stage: wasDating ? 'แฟนเก่า' : 'เพื่อน' };
    }
    default: return { success: false, message: 'ไม่รู้จักคำสั่งนี้' };
  }
}

export function describeNpcIdentity(npc) { return npc.genderIdentity ? getIdentity(npc.genderIdentity).label : ''; }

/** ตรวจประจำปีของความสัมพันธ์ลับ: ปกปิดค่อยๆ หลุด คู่ห่างเหิน และมีโอกาสถูกจับได้ (ทำครั้งเดียวต่อปี) */
export function runYearlyRelationshipChecks(state) {
  const age = Number(state.profile?.age || 0);
  state.relationships ||= {};
  if (state.relationships.checkedAge === age) return { ran: false };
  state.relationships.checkedAge = age;
  const secrets = (state.relationships.npcs || []).filter((n) => n.stage === 'secret');
  if (!secrets.length) return { ran: true, caught: false };
  const p = state.relationships.partner;
  if (!p) { for (const n of secrets) n.stage = 'friend'; return { ran: true, caught: false }; }
  for (const n of secrets) { n.secrecy = clamp(Number(n.secrecy ?? 70) - 12, 0, 100); if (n.coveredAge !== age) n.relationship = clamp(Number(n.relationship) + 2, 0, 100); }
  p.relationship = clamp(Number(p.relationship || 0) - 2 * secrets.length, 0, 100);
  applyStatEffects(state, { merit: -1 });
  const risk = secretRiskPct(state);
  const roll = (hashString(`${state.meta?.runId || 'x'}|caught|${age}`) % 1000) / 1000;
  if (roll < risk) {
    state.social ||= {};
    state.social.caughtCheatingCount = Number(state.social.caughtCheatingCount || 0) + 1;
    const n = secrets.reduce((a, b) => (Number(b.secrecy) < Number(a.secrecy) ? b : a), secrets[0]);
    queueConsequence(state, { type: 'caught_cheating', npcId: n.id, name: n.name, partnerName: p.name, dueAge: age });
    return { ran: true, caught: true, risk };
  }
  return { ran: true, caught: false, risk };
}
