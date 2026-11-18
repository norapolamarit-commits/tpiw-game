/**
 * js/ui/header_footer_ui.js
 * วาดส่วนหัว (โปรไฟล์, เงินสด/กระปุก, แต้มบุญ) และส่วนท้าย (ปุ่ม Sticky Action + 5 แท็บเมนู)
 */

import { db } from '../core/db.js';
import { saveGame } from '../core/state.js';
import { formatCurrency, formatShortCurrency, getPlayerFlagSet } from '../core/utils.js';
import { stripEmojis } from '../engine/event_engine.js';
import { getPrimaryActionButtonSpec, triggerPrimaryActionButton } from '../engine/turn_manager.js';
import { getAudioPrefs, setBgmVolume, setSfxVolume, toggleBgm, toggleSfx } from './audio.js';
import { escapeHtml, renderIcon } from './icons.js';
import { closeModal, openModal, showToast } from './modals_ending_ui.js';
import { getPlayerIdentityLabel } from '../engine/gender_identity_engine.js';
import { openIdentityModal } from './identity_ui.js';

export const BOTTOM_TABS = [
  { id: 'tab1', label: 'บันทึกชีวิต', iconKey: 'book' },
  { id: 'tab2', label: 'ทำงาน/เรียน', iconKey: 'work' },
  { id: 'tab3', label: 'ความสัมพันธ์', iconKey: 'users' },
  { id: 'tab4', label: 'สินทรัพย์', iconKey: 'piggy' },
  { id: 'tab5', label: 'ใช้ชีวิต', iconKey: 'cart' }
];

function openProfileStatusModal(state) {
  const cls = db.getClass(state.profile.currentClassId);
  const loc = db.getLocation(state.profile.currentLocationId);
  const activeFlags = Array.from(getPlayerFlagSet(state));

  const badgesHtml = activeFlags
    .map((fid) => {
      const def = db.getTraitOrFlag(fid);
      const label = stripEmojis(def?.name_th || fid);
      const isBad =
        fid.startsWith('status_') ||
        fid === 'flag_depression' ||
        fid === 'flag_credit_blacklist' ||
        fid === 'flag_informal_shark_debt' ||
        fid === 'flag_cursed_fate';
      return `<span class="pill-badge ${isBad ? 'pill-badge--danger' : 'pill-badge--soft-blue'}">${escapeHtml(label)}</span>`;
    })
    .join('');

  openModal(`
    <div class="modal-header">
      <div class="modal-title">
        ${renderIcon('user')}
        <span>ข้อมูลตัวละครและป้ายสถานะ</span>
      </div>
      <button class="icon-btn" data-close-modal aria-label="ปิด">${renderIcon('x', 'svg-icon--sm')}</button>
    </div>

    <div class="card" style="padding:12px;">
      <div class="slip-row"><span>ชื่อ</span><strong>${escapeHtml(state.profile.titlePrefix)} ${escapeHtml(stripEmojis(state.profile.name))}</strong></div>
      <div class="slip-row"><span>รุ่นตระกูล</span><strong>รุ่นที่ ${state.meta?.generationNumber || 1}</strong></div>
      <div class="slip-row"><span>จังหวัด</span><strong>${escapeHtml(stripEmojis(loc?.name_th || '-'))}</strong></div>
      <div class="slip-row"><span>ชนชั้นปัจจุบัน</span><strong>${escapeHtml(stripEmojis(cls?.name_th || '-'))}</strong></div>
      <div class="slip-row"><span>ความมั่งคั่งสุทธิ</span><strong>${escapeHtml(formatCurrency(state.finance.netWorth))}</strong></div>
      <div class="slip-row"><span>หน้าตา/บุคลิก</span><strong>${state.stats.appearance}/100</strong></div>
      <div class="slip-row"><span>ตัวตนทางเพศ</span><strong>${escapeHtml(getPlayerIdentityLabel(state))}</strong></div>
      <button type="button" class="btn btn--outline btn--sm btn--block" style="margin-top:8px;" data-open-identity>สำรวจ / เปลี่ยนตัวตนทางเพศ</button>
      ${state.finance?.realismV2 ? '<p style="font-size:12px;margin-top:8px;">ระบบเงินสมจริง: เปิดอยู่</p>' : '<button type="button" class="btn btn--outline btn--sm btn--block" style="margin-top:8px;" data-enable-realism>เปิดระบบเงินสมจริง</button><p style="font-size:12px;margin-top:4px;">เมื่อเปิดแล้ว ราคาสินค้า รายรับ รายจ่าย ภาษี และดอกเบี้ยในปีถัดไปจะเปลี่ยน และจะบันทึกลงเซฟ</p>'}
    </div>

    <div>
      <div style="font-size:13px;font-weight:700;margin-bottom:6px;">ป้ายสถานะทั้งหมด (${activeFlags.length})</div>
      <div class="badges-row" style="max-height:160px;overflow-y:auto;">
        ${badgesHtml || '<span style="font-size:12.5px;color:var(--text-muted);">ยังไม่มีป้ายสถานะ</span>'}
      </div>
    </div>
  `);
  document.querySelector('[data-open-identity]')?.addEventListener('click', () => openIdentityModal(state, { onRefresh: () => window.dispatchEvent(new CustomEvent('game:stateChanged', { detail: { state } })) }));
  document.querySelector('[data-enable-realism]')?.addEventListener('click', () => {
    state.finance.realismV2 = true;
    saveGame(state);
    openProfileStatusModal(state);
  });
}

function openGameSettingsModal(state, onReturnToLobby) {
  const audioPrefs = getAudioPrefs();
  const bgmPercent = Math.round(audioPrefs.bgmVolume * 100);
  const sfxPercent = Math.round(audioPrefs.sfxVolume * 100);

  openModal(`
    <div class="modal-header">
      <div class="modal-title">
        ${renderIcon('settings')}
        <span>การตั้งค่าเกม</span>
      </div>
      <button class="icon-btn" data-close-modal aria-label="ปิด">${renderIcon('x', 'svg-icon--sm')}</button>
    </div>

    <div class="grid-2">
      <button id="btn-game-toggle-bgm" class="btn btn--soft btn--sm" type="button" aria-pressed="${audioPrefs.bgmEnabled}">
        ${renderIcon(audioPrefs.bgmEnabled ? 'music' : 'music_off', 'svg-icon--sm')}
        <span>${audioPrefs.bgmEnabled ? 'เพลง: เปิด' : 'เพลง: ปิด'}</span>
      </button>
      <button id="btn-game-toggle-sfx" class="btn btn--soft btn--sm" type="button" aria-pressed="${audioPrefs.sfxEnabled}">
        ${renderIcon('volume', 'svg-icon--sm')}
        <span>${audioPrefs.sfxEnabled ? 'เสียงปุ่ม: เปิด' : 'เสียงปุ่ม: ปิด'}</span>
      </button>
    </div>

    <div class="audio-settings-list">
      <label class="audio-setting">
        <span class="audio-setting__label">ระดับเสียงเพลง</span>
        <output id="game-bgm-volume-value" class="audio-setting__value">${bgmPercent}%</output>
        <input id="game-bgm-volume" class="audio-setting__range" type="range" min="0" max="100" step="5" value="${bgmPercent}" aria-label="ระดับเสียงเพลง">
      </label>
      <label class="audio-setting">
        <span class="audio-setting__label">ระดับเสียงปุ่มกด</span>
        <output id="game-sfx-volume-value" class="audio-setting__value">${sfxPercent}%</output>
        <input id="game-sfx-volume" class="audio-setting__range" type="range" min="0" max="100" step="5" value="${sfxPercent}" aria-label="ระดับเสียงปุ่มกด">
      </label>
    </div>

    <div class="card" style="font-size:12.5px;color:var(--text-secondary);line-height:1.5;">
      ปรับระดับเสียงแยกกันได้ การตั้งค่าจะถูกบันทึกไว้ในอุปกรณ์นี้
    </div>

    <button id="btn-game-return-lobby" class="btn btn--outline btn--block" type="button">
      ${renderIcon('home', 'svg-icon--sm')}
      <span>บันทึกและออกไปหน้าล็อบบี้</span>
    </button>
  `);

  document.getElementById('btn-game-toggle-bgm')?.addEventListener('click', (e) => {
    const enabled = toggleBgm();
    e.currentTarget.setAttribute('aria-pressed', String(enabled));
    e.currentTarget.innerHTML = `${renderIcon(enabled ? 'music' : 'music_off', 'svg-icon--sm')}<span>${enabled ? 'เพลง: เปิด' : 'เพลง: ปิด'}</span>`;
    showToast(enabled ? 'เปิดเพลงพื้นหลังแล้ว' : 'ปิดเพลงพื้นหลังแล้ว', 'info');
  });

  document.getElementById('btn-game-toggle-sfx')?.addEventListener('click', (e) => {
    const enabled = toggleSfx();
    e.currentTarget.setAttribute('aria-pressed', String(enabled));
    e.currentTarget.innerHTML = `${renderIcon('volume', 'svg-icon--sm')}<span>${enabled ? 'เสียงปุ่ม: เปิด' : 'เสียงปุ่ม: ปิด'}</span>`;
  });

  document.getElementById('game-bgm-volume')?.addEventListener('input', (e) => {
    const percent = Math.round(setBgmVolume(Number(e.currentTarget.value) / 100) * 100);
    const output = document.getElementById('game-bgm-volume-value');
    if (output) output.textContent = `${percent}%`;
  });

  document.getElementById('game-sfx-volume')?.addEventListener('input', (e) => {
    const percent = Math.round(setSfxVolume(Number(e.currentTarget.value) / 100) * 100);
    const output = document.getElementById('game-sfx-volume-value');
    if (output) output.textContent = `${percent}%`;
  });

  document.getElementById('btn-game-return-lobby')?.addEventListener('click', () => {
    const saved = saveGame(state);
    if (!saved) {
      showToast('บันทึกชีวิตไม่สำเร็จ จึงยังไม่ออกจากเกม', 'error');
      return;
    }
    closeModal();
    if (typeof onReturnToLobby === 'function') onReturnToLobby();
  });
}

export function renderTopHeaderHtml(state) {
  const age = Number(state.profile.age || 0);
  const phase = db.getLifePhaseByAge(age);
  const loc = db.getLocation(state.profile.currentLocationId);
  const usePiggy = age < 7 && !state.finance.hasPiggyBankSmashed;

  const primaryMoneyLabel = usePiggy ? 'กระปุก' : 'เงินสด';
  const primaryMoneyIcon = usePiggy ? 'piggy' : 'wallet';
  const primaryMoneyVal = usePiggy ? state.finance.piggyBank : state.finance.cash;

  return `
    <header class="top-header">
      <div class="header-row">
        <div class="profile-block">
          <button id="btn-open-profile-modal" class="avatar-circle" type="button" title="ดูข้อมูลตัวละคร" aria-label="ดูข้อมูลตัวละคร">
            ${renderIcon('user')}
          </button>
          <div class="profile-meta">
            <h2 class="profile-name">${escapeHtml(state.profile.titlePrefix)} ${escapeHtml(stripEmojis(state.profile.name))}</h2>
            <p class="profile-sub">
              <span>อายุ ${age} ปี</span>
              <span>•</span>
              <span>${escapeHtml(stripEmojis(phase?.name_th || ''))}</span>
              <span>•</span>
              <span>จ.${escapeHtml(stripEmojis(loc?.name_th || ''))}</span>
            </p>
          </div>
        </div>

        <div class="header-actions">
          <div class="currency-stack">
            <div class="pill-badge">
              ${renderIcon(primaryMoneyIcon, 'svg-icon--sm')}
              <span>${primaryMoneyLabel}: ${escapeHtml(formatShortCurrency(primaryMoneyVal))}</span>
            </div>
            <div class="pill-badge">
              ${renderIcon('sparkle', 'svg-icon--sm')}
              <span>แต้มบุญ: ${Number(state.stats.merit || 0).toLocaleString('th-TH')}</span>
            </div>
          </div>
          <button id="btn-open-settings-modal" class="icon-btn header-settings-btn" type="button" title="การตั้งค่าเกม" aria-label="เปิดการตั้งค่าเกม">
            ${renderIcon('settings', 'svg-icon--sm')}
          </button>
        </div>
      </div>
    </header>
  `;
}

export function renderBottomDockHtml(state, activeTab) {
  const btnSpec = getPrimaryActionButtonSpec(state);
  const areTabsLocked = Boolean(state.turn?.areTabsLocked);

  const tabsHtml = BOTTOM_TABS.map((t) => {
    const isActive = t.id === activeTab;
    const isLocked = areTabsLocked && t.id !== 'tab1';
    return `
      <button
        type="button"
        class="nav-tab-btn ${isActive ? 'is-active' : ''} ${isLocked ? 'is-locked' : ''}"
        data-nav-tab="${t.id}"
        data-tab-locked="${isLocked ? '1' : '0'}"
      >
        ${isLocked ? `<span class="nav-tab-lock-badge">${renderIcon('lock', 'svg-icon--sm')}</span>` : ''}
        ${renderIcon(t.iconKey)}
        <span>${escapeHtml(t.label)}</span>
      </button>
    `;
  }).join('');

  return `
    <div class="bottom-dock">
      <div class="sticky-action-wrap">
        <button
          id="btn-primary-turn-action"
          type="button"
          class="btn btn--primary-cta"
          ${btnSpec.disabled ? 'disabled' : ''}
        >
          <span style="display:inline-flex;align-items:center;gap:8px;">
            ${renderIcon(btnSpec.iconKey)}
            <span>${escapeHtml(btnSpec.labelTh)}</span>
          </span>
          ${renderIcon('chevron_right')}
        </button>
      </div>
      <nav class="bottom-nav" aria-label="เมนูหลัก">
        ${tabsHtml}
      </nav>
    </div>
  `;
}

export function bindHeaderFooterEvents(rootEl, state, { onTabChange, onAfterPrimaryAction, onReturnToLobby }) {
  rootEl.querySelector('#btn-open-profile-modal')?.addEventListener('click', () => {
    openProfileStatusModal(state);
  });

  rootEl.querySelector('#btn-open-settings-modal')?.addEventListener('click', () => {
    openGameSettingsModal(state, onReturnToLobby);
  });

  rootEl.querySelector('#btn-primary-turn-action')?.addEventListener('click', () => {
    const res = triggerPrimaryActionButton(state);
    if (!res?.success && res?.message) {
      showToast(res.message, 'error');
    }
    if (typeof onAfterPrimaryAction === 'function') {
      onAfterPrimaryAction(res);
    }
  });

  rootEl.querySelectorAll('[data-nav-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-nav-tab');
      const isLocked = btn.getAttribute('data-tab-locked') === '1';
      if (isLocked) {
        showToast('กรุณาเคลียร์เหตุการณ์หรือสรุปงบประจำปีในแท็บ "บันทึกชีวิต" ให้เสร็จก่อน', 'error');
        return;
      }
      if (typeof onTabChange === 'function') {
        onTabChange(tabId);
      }
    });
  });
}
