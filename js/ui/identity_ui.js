/**
 * js/ui/identity_ui.js
 * หน้าต่างสำรวจ/เปลี่ยนตัวตนทางเพศของตัวเอก (เพศทางเลือก) พร้อมชื่อเล่นใหม่ที่ไม่บังคับ
 */

import { saveGame } from '../core/state.js';
import { NICKNAME_SUGGESTIONS, canChangeIdentity, changeGenderIdentity, getPlayerIdentityId } from '../engine/gender_identity_engine.js';
import { IDENTITIES } from '../engine/gender_encounter_engine.js';
import { escapeHtml } from './icons.js';
import { closeModal, openModal, showToast } from './modals_ending_ui.js';

export function openIdentityModal(state, { onRefresh } = {}) {
  const can = canChangeIdentity(state);
  if (!can.ok) {
    openModal(`<div class="gr"><h3>ตัวตนทางเพศ</h3><p class="gr-intro">${escapeHtml(can.reason)}</p><button type="button" class="btn btn--primary btn--block" data-close-modal>ตกลง</button></div>`);
    return;
  }
  let chosen = getPlayerIdentityId(state);
  let nick = '';
  const render = () => {
    openModal(`<div class="gr id-modal">
      <h3>ตัวตนทางเพศของฉัน</h3>
      <p class="gr-intro">ตัวตนของคุณเป็นของคุณ เลือกสิ่งที่รู้สึกว่าใช่ได้เลย ไม่ต้องรีบ และเปลี่ยนได้ในอนาคต คนรอบข้างอาจตอบรับต่างกัน ลองเตรียมใจและเลือกวิธีที่ปลอดภัยกับตัวเองไว้นะ</p>
      <div class="id-grid">${IDENTITIES.map((i) => `<button type="button" class="id-chip ${chosen === i.id ? 'is-active' : ''}" data-id-pick="${i.id}"><i style="background:${i.color}"></i>${escapeHtml(i.label)}</button>`).join('')}</div>
      <label class="id-label">ชื่อเล่นใหม่ (ไม่บังคับ)<input id="id-nick" class="input-text" maxlength="20" value="${escapeHtml(nick)}" placeholder="เช่น ใบเตย" /></label>
      <div class="id-sugg">${NICKNAME_SUGGESTIONS.map((n) => `<button type="button" class="pt-person" data-id-nick="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}</div>
      <div class="ph-actions"><button type="button" class="btn btn--primary" data-id-confirm>ยืนยันตัวตนนี้</button><button type="button" class="btn btn--soft" data-close-modal>ไว้ก่อน</button></div>
    </div>`, { closable: true });
    const root = document.getElementById('modal-root');
    const input = root.querySelector('#id-nick');
    input?.addEventListener('input', () => { nick = input.value; });
    root.querySelectorAll('[data-id-pick]').forEach((b) => b.addEventListener('click', () => { chosen = b.getAttribute('data-id-pick'); render(); }));
    root.querySelectorAll('[data-id-nick]').forEach((b) => b.addEventListener('click', () => { nick = b.getAttribute('data-id-nick'); render(); }));
    root.querySelector('[data-id-confirm]')?.addEventListener('click', () => {
      const res = changeGenderIdentity(state, chosen, { nickname: nick });
      saveGame(state);
      if (!res.success) { showToast(res.message, 'error'); return; }
      closeModal();
      showToast(res.message, 'success');
      onRefresh?.();
    });
  };
  render();
}
