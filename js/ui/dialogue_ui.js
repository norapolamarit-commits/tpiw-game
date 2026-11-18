/**
 * js/ui/dialogue_ui.js
 * หน้าต่างบทสนทนาต่อเนื่อง (ใช้ร่วมกันทั้งการกดหาชาวบ้านบนแผนที่และตอนมีคนมาทัก)
 * แสดงเป็นฟองแชต: เพื่อนพูด ผู้เล่นเลือกตอบ ต่อกัน 2 รอบ แล้วปิดด้วยประโยคสรุป
 */

import { saveGame } from '../core/state.js';
import { FOLLOW_UP_ROUNDS, applyFollowUp, buildFollowUp, closingLine } from '../engine/encounter_dialogue_engine.js';
import { escapeHtml } from './icons.js';
import { closeModal, openModal } from './modals_ending_ui.js';

/**
 * @param {object} state
 * @param {{ context:string, relKey:string, identity:string, name?:string, firstTone:string, lines:{from:'them'|'me',text:string}[], finalHtml?:string, onDone?:Function }} cfg
 */
export function runFollowUpDialogue(state, cfg) {
  const lines = [...cfg.lines];
  const picked = [cfg.firstTone === 'defend' || cfg.firstTone === 'respect' ? 'good' : cfg.firstTone === 'ignore' ? 'mid' : 'bad'];
  let prevTone = cfg.firstTone;
  let prevLine = [...cfg.lines].reverse().find((l) => l.from === 'me')?.text || '';
  const seedKey = `${cfg.relKey}|${state.profile?.age}`;
  let newFriend = null;

  const bubbles = () => `<div class="ph-bubbles dlg-bubbles">${lines.map((l) => `<div class="ph-b ph-b--${l.from}">${escapeHtml(l.text)}</div>`).join('')}</div>`;
  const scrollEnd = () => document.querySelector('.dlg-bubbles')?.lastElementChild?.scrollIntoView({ block: 'end' });

  const round = (n) => {
    const turn = buildFollowUp(state, { context: cfg.context, prevTone, prevLine, seedKey, round: n });
    lines.push({ from: 'them', text: `${turn.callback} ${turn.reaction}`.trim() }, { from: 'them', text: turn.question });
    openModal(`<div class="gr">${bubbles()}<div class="list-stack">${turn.options.map((o) => `<button type="button" class="choice-btn" data-dlg-opt="${o.id}"><div class="choice-label">${escapeHtml(o.label)}</div></button>`).join('')}</div></div>`, { closable: false });
    scrollEnd();
    document.querySelectorAll('[data-dlg-opt]').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-dlg-opt');
      const label = turn.options.find((o) => o.id === id).label;
      lines.push({ from: 'me', text: label });
      prevLine = label;
      const res = applyFollowUp(state, { relKey: cfg.relKey, identity: cfg.identity, name: cfg.name }, id);
      if (res.friend) newFriend = res.friend;
      picked.push(id);
      prevTone = res.tone;
      saveGame(state);
      if (n < FOLLOW_UP_ROUNDS) round(n + 1); else finish();
    }));
  };

  const finish = () => {
    const closing = closingLine(state, picked, seedKey);
    lines.push({ from: 'them', text: closing.text });
    openModal(`<div class="gr">${bubbles()}${cfg.finalHtml || ''}${newFriend ? `<p class="gr-intro">${escapeHtml(newFriend.name)} กลายเป็นเพื่อนของคุณแล้ว</p>` : ''}<button type="button" class="btn btn--primary btn--block" data-dlg-done>ตกลง</button></div>`, { closable: false });
    scrollEnd();
    document.querySelector('[data-dlg-done]').addEventListener('click', () => { closeModal(); cfg.onDone?.(); });
  };

  round(1);
}
