/**
 * js/ui/greeting_ui.js
 * หน้าต่าง "มีคนเดินมาทัก": เด้งในช่วงอิสระของแต่ละปี ต้องเลือกตอบก่อนเวลาจะเดินต่อ
 */

import { saveGame } from '../core/state.js';
import { runFollowUpDialogue } from './dialogue_ui.js';
import { runYearlyRelationshipChecks } from '../engine/relationship_stage_engine.js';
import { markMilestoneShown, nextMilestone, resolveMilestone } from '../engine/milestone_events_engine.js';
import { markConsequenceShown, nextConsequence, resolveConsequence } from '../engine/social_consequence_engine.js';
import { REPLIES, markGreetingShown, nextGreeting, resolveGreeting } from '../engine/greeting_engine.js';
import { getIdentity } from '../engine/gender_encounter_engine.js';
import { escapeHtml } from './icons.js';
import { closeModal, openModal } from './modals_ending_ui.js';

const CONTEXT_LABEL = { school: 'ที่โรงเรียน', neighbor: 'หน้าบ้าน', work: 'ที่ทำงาน', online: 'ทางแชต' };

export function maybeOpenGreeting(state, onRefresh) {
  const root = document.getElementById('modal-root');
  if (!root || root.classList.contains('is-open')) return false;
  runYearlyRelationshipChecks(state);
  const cons = nextConsequence(state);
  if (cons) { openConsequence(state, cons, onRefresh); return true; }
  const ms = nextMilestone(state);
  if (ms) { markMilestoneShown(state, ms.id); openConsequence(state, ms, onRefresh, resolveMilestone, ms.tagTh); return true; }
  const g = nextGreeting(state);
  if (!g) return false;
  markGreetingShown(state, g);
  const idn = getIdentity(g.identity);
  openModal(`<div class="gr">
      <div class="gr-tag"><i style="background:${idn.color}"></i>มีคนเดินมาทัก ${escapeHtml(CONTEXT_LABEL[g.context])} • ${escapeHtml(idn.label)}</div>
      <p class="gr-intro">${escapeHtml(g.introTh)}</p>
      <div class="list-stack">${REPLIES.map((r) => `<button type="button" class="choice-btn" data-gr-reply="${r.id}"><div class="choice-label">${escapeHtml(r.labelTh)}</div></button>`).join('')}</div>
    </div>`, { closable: false });
  const TONE_OF = { warm: 'respect', curious: 'respect', polite: 'ignore', brush: 'disrespect' };
  document.querySelectorAll('[data-gr-reply]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const replyId = btn.getAttribute('data-gr-reply');
      const reply = REPLIES.find((r) => r.id === replyId);
      const res = resolveGreeting(state, g, replyId);
      saveGame(state);
      runFollowUpDialogue(state, {
        context: g.context, relKey: g.id, identity: g.identity, name: g.name, firstTone: TONE_OF[replyId],
        lines: [{ from: 'them', text: g.introTh }, { from: 'me', text: reply.labelTh }, { from: 'them', text: reply.resultTh }],
        finalHtml: `<p class="pt-hint">ดัชนีความเท่าเทียมของเมือง ${res.indexBefore} เป็น ${res.indexAfter}</p>`,
        onDone: () => { if (!maybeOpenGreeting(state, onRefresh)) onRefresh?.(); }
      });
    });
  });
  return true;
}

function openConsequence(state, c, onRefresh, resolver = resolveConsequence, tag = 'ผลจากโซเชียลของคุณ') {
  if (resolver === resolveConsequence) markConsequenceShown(state, c.id);
  openModal(`<div class="gr">
      <div class="gr-tag"><i style="background:#ff8a1f"></i>${escapeHtml(tag)}</div>
      <h3>${escapeHtml(c.title)}</h3>
      <p class="gr-intro">${escapeHtml(c.text)}</p>
      <div class="list-stack">${c.options.map((o, i) => `<button type="button" class="choice-btn" data-cons-opt="${i}"><div class="choice-label">${escapeHtml(o[0])}</div></button>`).join('')}</div>
    </div>`, { closable: false });
  document.querySelectorAll('[data-cons-opt]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const res = resolver(state, c, Number(btn.getAttribute('data-cons-opt')));
      saveGame(state);
      openModal(`<div class="gr"><h3>${escapeHtml(c.title)}</h3><p class="gr-intro">${escapeHtml(res.message)}</p><p class="pt-hint">ดัชนีความเท่าเทียมของเมือง ${res.indexBefore} เป็น ${res.indexAfter}</p><button type="button" class="btn btn--primary btn--block" data-gr-next>ตกลง</button></div>`, { closable: false });
      document.querySelector('[data-gr-next]').addEventListener('click', () => {
        closeModal();
        if (!maybeOpenGreeting(state, onRefresh)) onRefresh?.();
      });
    });
  });
}
