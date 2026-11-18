/**
 * js/ui/game_clock.js
 * นาฬิกาเดินเวลาอัตโนมัติ: เวลาเดินต่อเนื่อง หยุดเมื่อมีสรุปงบ/อีเวนต์ให้ตัดสินใจ
 * และเดินต่อเองหลังเลือก (ตรรกะตัดสินใจเป็นฟังก์ชันล้วน ทดสอบได้)
 */

import { escapeHtml } from './icons.js';

export const CLOCK_SPEEDS = [0, 1, 2];
export const YEAR_MS = 30000;
export const OUTCOME_MS = 5000;
const STORAGE_KEY = 'thai_life_sim_clock_speed';

const clock = { speed: 1, yearElapsed: 0, outcomeElapsed: 0, loaded: false };

function load() {
  if (clock.loaded) return;
  clock.loaded = true;
  try {
    const v = Number(globalThis.localStorage?.getItem(STORAGE_KEY));
    if (CLOCK_SPEEDS.includes(v)) clock.speed = v;
  } catch { /* ใช้ค่าเริ่มต้น */ }
}

export function getClockSpeed() { load(); return clock.speed; }

export function setClockSpeed(v) {
  load();
  if (!CLOCK_SPEEDS.includes(v)) return clock.speed;
  clock.speed = v;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, String(v)); } catch { /* ไม่เป็นไร */ }
  return v;
}

export function resetClockProgress() { clock.yearElapsed = 0; clock.outcomeElapsed = 0; }

/**
 * ตัดสินใจจากปุ่มหลักปัจจุบัน (spec) ว่าควรเดินเวลาต่อหรือไม่
 * @returns {'TRIGGER'|null} TRIGGER = ให้เรียกปุ่มหลักอัตโนมัติ (ข้ามปี หรือไปอีเวนต์ถัดไป)
 */
export function tickClock(spec, dtMs, { modalOpen = false, hidden = false } = {}) {
  load();
  if (!spec || clock.speed === 0 || modalOpen || hidden) return null;
  switch (spec.actionType) {
    case 'NEXT_YEAR':
      clock.outcomeElapsed = 0;
      clock.yearElapsed += dtMs * clock.speed;
      if (clock.yearElapsed >= YEAR_MS) { resetClockProgress(); return 'TRIGGER'; }
      return null;
    case 'NEXT_EVENT':
    case 'UNLOCK_FREE_ACTION':
      clock.outcomeElapsed += dtMs * Math.min(clock.speed, 2);
      if (clock.outcomeElapsed >= OUTCOME_MS) { resetClockProgress(); return 'TRIGGER'; }
      return null;
    default:
      resetClockProgress();
      return null;
  }
}

export function getClockStatus(spec, { modalOpen = false } = {}) {
  load();
  const t = spec?.actionType;
  if (t === 'VIEW_ENDING') return { text: 'จบชีวิตแล้ว', progress: 1, waiting: true };
  if (t === 'ACK_ANNUAL_SLIP') return { text: 'หยุดเวลา: รอรับทราบสรุปงบประจำปี', progress: 1, waiting: true };
  if (t === 'AWAITING_CHOICE') return { text: 'หยุดเวลา: เลือกทางตัดสินใจ', progress: 1, waiting: true };
  if (t === 'AWAITING_DEBT_MODAL') return { text: 'หยุดเวลา: จัดการหนี้ฉุกเฉิน', progress: 1, waiting: true };
  if (modalOpen) return { text: 'หยุดเวลา: กำลังตัดสินใจ', progress: clock.yearElapsed / YEAR_MS, waiting: true };
  if (clock.speed === 0) return { text: 'หยุดชั่วคราว', progress: clock.yearElapsed / YEAR_MS, waiting: true };
  if (t === 'NEXT_EVENT' || t === 'UNLOCK_FREE_ACTION') return { text: 'อ่านผลลัพธ์ แล้วเวลาจะเดินต่อ', progress: clock.outcomeElapsed / OUTCOME_MS, waiting: false };
  return { text: 'เวลาเดินอยู่', progress: Math.min(1, clock.yearElapsed / YEAR_MS), waiting: false };
}

export function renderGameClockHtml(state, spec, opts) {
  const st = getClockStatus(spec, opts);
  const speeds = CLOCK_SPEEDS.map((v) => `<button type="button" class="gc-btn ${v === clock.speed ? 'is-active' : ''}" data-clock-speed="${v}" aria-label="${v === 0 ? 'หยุดเวลา' : `ความเร็ว ${v} เท่า`}">${v === 0 ? 'หยุด' : `${v}x`}</button>`).join('');
  return `<div id="game-clock" class="game-clock" role="group" aria-label="ควบคุมเวลา">
    <div class="gc-row">
      <div class="gc-title"><span class="gc-brand">TPIW</span><span class="gc-bigage">${escapeHtml(String(state.profile.age))}</span><span class="gc-unit">ปี</span></div>
      <span class="gc-name">${escapeHtml(String(state.profile.name || ''))}</span>
      <span class="gc-status" data-gc-status>${escapeHtml(st.text)}</span>
    </div>
    <div class="gc-track"><div class="gc-fill" data-gc-fill style="width:${Math.round(st.progress * 100)}%"></div></div>
    <div class="gc-speeds">${speeds}<button type="button" class="gc-btn gc-phone" data-open-phone>โทรศัพท์</button></div>
  </div>`;
}

export function updateGameClockDom(root, spec, opts) {
  const el = root?.querySelector('#game-clock');
  if (!el) return;
  const st = getClockStatus(spec, opts);
  el.querySelector('[data-gc-status]').textContent = st.text;
  el.querySelector('[data-gc-fill]').style.width = `${Math.round(st.progress * 100)}%`;
  el.querySelectorAll('[data-clock-speed]').forEach((b) => b.classList.toggle('is-active', Number(b.getAttribute('data-clock-speed')) === clock.speed));
}

export function bindGameClock(root, getSpec, getOpts) {
  root.querySelectorAll('[data-clock-speed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setClockSpeed(Number(btn.getAttribute('data-clock-speed')));
      updateGameClockDom(root, getSpec(), getOpts());
    });
  });
}
