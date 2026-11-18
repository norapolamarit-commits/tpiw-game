/** คำแนะนำการเล่นแบบสั้น เปิดอัตโนมัติครั้งแรกและเปิดซ้ำจากการตั้งค่าได้ */
import { saveGame } from '../core/state.js';
import { closeModal, openModal } from './modals_ending_ui.js';

export const TUTORIAL_STEPS = [
  { title: 'เริ่มต้นชีวิต', body: 'อ่านเหตุการณ์ที่เกิดขึ้นในแต่ละปี แล้วเลือกคำตอบที่อยากให้ตัวละครทำ ผลลัพธ์จะเปลี่ยนเงิน ค่าสถานะ และเรื่องราวในชีวิต' },
  { title: 'ดูค่าสถานะ', body: 'ติดตามสุขภาพ ความสุข ความรู้ และเส้นสาย รวมถึงเงินสดที่ด้านบนของเกม ค่าสถานะมีผลต่อโอกาสในปีถัดไป' },
  { title: 'ใช้เวลาว่าง', body: 'หลังจบเหตุการณ์ประจำปี เลือกทำกิจกรรมในแท็บ ทำงาน/เรียน ความสัมพันธ์ สินทรัพย์ และใช้ชีวิต แต่ละกิจกรรมอาจใช้แต้มเวลาว่างหรือเงิน' },
  { title: 'ก้าวสู่ปีถัดไป', body: 'กดปุ่มหลักด้านล่างเพื่อดำเนินเรื่องและขึ้นปีใหม่ เกมบันทึกความคืบหน้าในอุปกรณ์นี้ และเปิดวิธีเล่นซ้ำได้จากการตั้งค่า' }
];

export function openTutorial(state, { onFinish } = {}) {
  let step = 0;
  const finish = () => {
    state.meta ||= {};
    state.meta.tutorialSeen = true;
    saveGame(state);
    closeModal();
    onFinish?.();
  };
  const render = () => {
    const current = TUTORIAL_STEPS[step];
    openModal(`<div class="card" style="padding:20px;">
      <div style="font-size:12px;color:var(--text-secondary);">วิธีเล่น TPIW · ${step + 1}/${TUTORIAL_STEPS.length}</div>
      <h2 style="font-size:20px;margin:10px 0;">${current.title}</h2>
      <p style="font-size:14px;line-height:1.6;">${current.body}</p>
      <div style="display:flex;gap:8px;justify-content:space-between;margin-top:20px;">
        <button type="button" class="btn btn--soft btn--sm" data-tutorial-skip>ข้าม</button>
        <div style="display:flex;gap:8px;">
          ${step > 0 ? '<button type="button" class="btn btn--outline btn--sm" data-tutorial-back>ก่อนหน้า</button>' : ''}
          <button type="button" class="btn btn--primary btn--sm" data-tutorial-next>${step === TUTORIAL_STEPS.length - 1 ? 'เริ่มเล่น' : 'ถัดไป'}</button>
        </div>
      </div>
    </div>`, { closable: false });
    const root = document.getElementById('modal-root');
    root.querySelector('[data-tutorial-skip]')?.addEventListener('click', finish);
    root.querySelector('[data-tutorial-back]')?.addEventListener('click', () => { step -= 1; render(); });
    root.querySelector('[data-tutorial-next]')?.addEventListener('click', () => {
      if (step === TUTORIAL_STEPS.length - 1) finish();
      else { step += 1; render(); }
    });
  };
  render();
}
