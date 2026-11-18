/**
 * js/ui/screen_lobby_reborn.js
 * หน้าหลัก Lobby (พร้อมปุ่มเปิด/ปิดเพลง) และหน้าเตรียมตัวจุติใหม่
 */

import { db } from '../core/db.js';
import {
  clearSavedGame,
  generateThaiIdentity,
  hasSavedGame,
  loadGame,
  loadMetaState,
  saveMetaState,
  START_STAGES
} from '../core/state.js';
import { formatCurrency } from '../core/utils.js';
import { stripEmojis } from '../engine/event_engine.js';
import { startNewLifeRun } from '../main.js';
import { DEFAULT_LIFE_PATH_ID, getAvailableLifePaths } from '../engine/life_path_engine.js';
import { getAudioPrefs, setBgmVolume, setSfxVolume, toggleBgm, toggleSfx } from './audio.js';
import { escapeHtml, renderIcon } from './icons.js';
import { openModal, showToast } from './modals_ending_ui.js';

const TRAIT_ICON_MAP = {
  trait_quick_learner: 'bulb',
  trait_easy_baby: 'smile',
  trait_strong_immune: 'shield',
  trait_lucky_star: 'sparkle',
  trait_natural_charmer: 'heart',
  trait_silver_spoon: 'crown'
};

function openAchievementsModal(meta) {
  const tiers = db.raw.loansCrisesEndings?.ending_archetypes_and_merit_conversion?.ending_tiers || [];
  const unlockedSet = new Set(meta.unlockedEndings || []);

  const listHtml = tiers
    .map((t) => {
      const unlocked = unlockedSet.has(t.ending_id);
      return `
        <div class="card ${unlocked ? 'card--highlight' : 'card--locked'}" style="padding:10px 12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <span class="pill-badge ${unlocked ? 'pill-badge--gold' : 'pill-badge--muted'}">ระดับ ${escapeHtml(t.rank)}</span>
            <span style="font-size:12px;font-weight:700;color:${unlocked ? 'var(--success)' : 'var(--text-muted)'};">
              ${unlocked ? 'ปลดล็อกแล้ว' : 'ยังไม่ปลดล็อก'}
            </span>
          </div>
          <div style="font-weight:700;font-size:14px;margin-top:6px;">${escapeHtml(stripEmojis(t.title_th))}</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(stripEmojis(t.summary_th))}</div>
        </div>
      `;
    })
    .join('');

  openModal(`
    <div class="modal-header">
      <div class="modal-title">
        ${renderIcon('trophy')}
        <span>ความสำเร็จฉากจบ (${unlockedSet.size}/${tiers.length})</span>
      </div>
      <button class="icon-btn" data-close-modal>${renderIcon('x', 'svg-icon--sm')}</button>
    </div>
    <div class="list-stack">${listHtml}</div>
  `);
}

function openHallOfFameModal(meta) {
  const list = meta.hallOfFame || [];
  const rowsHtml = list.length
    ? list
        .map(
          (entry, idx) => `
          <div class="card" style="padding:10px 12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <strong>#${idx + 1} ${escapeHtml(stripEmojis(entry.fullName))}</strong>
              <span class="pill-badge pill-badge--gold">ระดับ ${escapeHtml(entry.endingRank)}</span>
            </div>
            <div style="font-size:12.5px;color:var(--text-secondary);margin-top:4px;">
              อายุ ${entry.finalAge} ปี • ${escapeHtml(stripEmojis(entry.endingTitleTh))}
            </div>
            <div style="font-size:12px;margin-top:4px;display:flex;justify-content:space-between;">
              <span>ทรัพย์สิน: ${escapeHtml(formatCurrency(entry.netWorth))}</span>
              <span class="amt-pos">+${entry.earnedMerit} แต้มบุญ</span>
            </div>
          </div>`
        )
        .join('')
    : '<div style="text-align:center;color:var(--text-muted);padding:16px;">ยังไม่มีประวัติชีวิตที่จบลงในทำเนียบ</div>';

  openModal(`
    <div class="modal-header">
      <div class="modal-title">
        ${renderIcon('crown')}
        <span>ทำเนียบผู้รอดชีวิต</span>
      </div>
      <button class="icon-btn" data-close-modal>${renderIcon('x', 'svg-icon--sm')}</button>
    </div>
    <div class="list-stack">${rowsHtml}</div>
  `);
}

function openSettingsModal(onDataCleared, onAudioUpdated) {
  const audioPrefs = getAudioPrefs();

  openModal(`
    <div class="modal-header">
      <div class="modal-title">
        ${renderIcon('settings')}
        <span>การตั้งค่า</span>
      </div>
      <button class="icon-btn" data-close-modal>${renderIcon('x', 'svg-icon--sm')}</button>
    </div>

    <div class="grid-2">
      <button id="btn-set-bgm" class="btn btn--soft btn--sm" type="button" aria-pressed="${audioPrefs.bgmEnabled}">
        ${renderIcon(audioPrefs.bgmEnabled ? 'music' : 'music_off', 'svg-icon--sm')}
        <span>${audioPrefs.bgmEnabled ? 'เพลง: เปิด' : 'เพลง: ปิด'}</span>
      </button>
      <button id="btn-set-sfx" class="btn btn--soft btn--sm" type="button" aria-pressed="${audioPrefs.sfxEnabled}">
        ${renderIcon('volume', 'svg-icon--sm')}
        <span>${audioPrefs.sfxEnabled ? 'เสียงปุ่ม: เปิด' : 'เสียงปุ่ม: ปิด'}</span>
      </button>
    </div>

    <div class="audio-settings-list">
      <label class="audio-setting">
        <span class="audio-setting__label">ระดับเสียงเพลง</span>
        <output id="lobby-bgm-volume-value" class="audio-setting__value">${Math.round(audioPrefs.bgmVolume * 100)}%</output>
        <input id="lobby-bgm-volume" class="audio-setting__range" type="range" min="0" max="100" step="5" value="${Math.round(audioPrefs.bgmVolume * 100)}" aria-label="ระดับเสียงเพลง">
      </label>
      <label class="audio-setting">
        <span class="audio-setting__label">ระดับเสียงปุ่มกด</span>
        <output id="lobby-sfx-volume-value" class="audio-setting__value">${Math.round(audioPrefs.sfxVolume * 100)}%</output>
        <input id="lobby-sfx-volume" class="audio-setting__range" type="range" min="0" max="100" step="5" value="${Math.round(audioPrefs.sfxVolume * 100)}" aria-label="ระดับเสียงปุ่มกด">
      </label>
    </div>

    <div class="card" style="font-size:13px;color:var(--text-secondary);line-height:1.5;">
      <p><strong>TPIW (The Path I Want) v1.2.0</strong></p>
      <p style="margin-top:4px;">ระบบบันทึกข้อมูลลงในอุปกรณ์ของคุณอัตโนมัติ (localStorage) เล่นออฟไลน์ได้หลังโหลดข้อมูลเสร็จ</p>
    </div>

    <button id="btn-clear-current-save" class="btn btn--outline btn--block">
      ${renderIcon('refresh', 'svg-icon--sm')}
      <span>ล้างเฉพาะเซฟชีวิตปัจจุบัน (เก็บแต้มบุญไว้)</span>
    </button>
  `);

  document.getElementById('btn-set-bgm')?.addEventListener('click', (e) => {
    const enabled = toggleBgm();
    e.currentTarget.setAttribute('aria-pressed', String(enabled));
    e.currentTarget.innerHTML = `${renderIcon(enabled ? 'music' : 'music_off', 'svg-icon--sm')}<span>${enabled ? 'เพลง: เปิด' : 'เพลง: ปิด'}</span>`;
    if (typeof onAudioUpdated === 'function') onAudioUpdated();
  });

  document.getElementById('btn-set-sfx')?.addEventListener('click', (e) => {
    const enabled = toggleSfx();
    e.currentTarget.setAttribute('aria-pressed', String(enabled));
    e.currentTarget.innerHTML = `${renderIcon('volume', 'svg-icon--sm')}<span>${enabled ? 'เสียงปุ่ม: เปิด' : 'เสียงปุ่ม: ปิด'}</span>`;
  });

  document.getElementById('lobby-bgm-volume')?.addEventListener('input', (e) => {
    const value = Math.round(setBgmVolume(Number(e.currentTarget.value) / 100) * 100);
    const output = document.getElementById('lobby-bgm-volume-value');
    if (output) output.textContent = `${value}%`;
    if (typeof onAudioUpdated === 'function') onAudioUpdated();
  });

  document.getElementById('lobby-sfx-volume')?.addEventListener('input', (e) => {
    const value = Math.round(setSfxVolume(Number(e.currentTarget.value) / 100) * 100);
    const output = document.getElementById('lobby-sfx-volume-value');
    if (output) output.textContent = `${value}%`;
  });

  document.getElementById('btn-clear-current-save')?.addEventListener('click', () => {
    clearSavedGame();
    document.getElementById('modal-root')?.classList.remove('is-open');
    showToast('ล้างเซฟชีวิตปัจจุบันเรียบร้อยแล้ว', 'success');
    if (typeof onDataCleared === 'function') onDataCleared();
  });
}

export function renderLobbyScreen({ onGoReborn, onContinueGame, onRefreshLobby }) {
  const meta = loadMetaState();
  const hasSave = hasSavedGame();
  const savedState = hasSave ? loadGame() : null;
  const savedLoc = savedState ? db.getLocation(savedState.profile.currentLocationId) : null;
  const latestHall = (meta.hallOfFame || [])[0] || null;
  const audioPrefs = getAudioPrefs();

  return {
    html: `
      <div class="screen-scroll" style="justify-content:space-between;">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="pill-badge pill-badge--navy">v1.1.0</span>
            <div class="pill-badge">
              ${renderIcon('sparkle', 'svg-icon--sm')}
              <span>แต้มบุญสะสม: ${Number(meta.karmaBankMerit || 0).toLocaleString('th-TH')}</span>
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:10px;">
            <button id="btn-lobby-music" class="icon-btn" type="button" title="เปิด/ปิดเสียงเพลง" style="${audioPrefs.bgmEnabled ? 'border-color:var(--navy-900);background:var(--navy-50);' : 'opacity:0.65;'}">
              ${renderIcon(audioPrefs.bgmEnabled ? 'music' : 'music_off', 'svg-icon--sm')}
            </button>
            <button id="btn-lobby-settings" class="icon-btn" type="button" title="การตั้งค่า">
              ${renderIcon('settings', 'svg-icon--sm')}
            </button>
          </div>

          <div class="lobby-title-wrap">
            <h1 class="lobby-title-main">TPIW</h1>
            <div class="lobby-title-sub"><span>The Path</span> <span>I Want</span></div>
          </div>

          ${
            latestHall
              ? `
            <div class="card" style="text-align:center;margin-top:12px;">
              <div style="font-weight:700;font-size:15px;">ชีวิตล่าสุด: ${escapeHtml(stripEmojis(latestHall.fullName))}</div>
              <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">
                อายุ ${latestHall.finalAge} ปี • ระดับ ${escapeHtml(latestHall.endingRank)} • ${escapeHtml(stripEmojis(latestHall.endingTitleTh))}
              </div>
              <div style="font-size:13px;font-weight:700;color:var(--navy-900);margin-top:4px;">
                แต้มบุญที่ได้รับ: +${latestHall.earnedMerit}
              </div>
            </div>`
              : `
            <div class="card" style="text-align:center;margin-top:12px;">
              <div style="font-weight:700;font-size:15px;">พร้อมเริ่มต้นชะตาชีวิตใหม่หรือยัง?</div>
              <div style="font-size:13px;color:var(--text-secondary);margin-top:4px;">
                สุ่มชนชั้น 5 ระดับและ 12 จังหวัดทั่วไทย สู้ชีวิตจาก 0 ถึง 100 ปี
              </div>
            </div>`
          }

          <div class="list-stack" style="margin-top:18px;">
            <button id="btn-lobby-new-reborn" class="btn btn--primary-cta" style="justify-content:center;" type="button">
              ${renderIcon('sparkle', 'svg-icon--sm')}
              <span>เกิดใหม่ (ใช้แต้มบุญ)</span>
            </button>
            <div style="text-align:center;font-size:12px;color:var(--text-secondary);">
              เริ่มชีวิตใหม่สุ่มชนชั้นและจังหวัด
            </div>

            ${
              savedState
                ? `
              <button id="btn-lobby-continue" class="btn btn--outline btn--block" style="flex-direction:column;gap:2px;padding:10px 16px;" type="button">
                <span style="font-size:15px;font-weight:700;">ดำเนินต่อชีวิตเดิม</span>
                <span style="font-size:12px;color:var(--text-secondary);font-weight:500;">
                  ${escapeHtml(stripEmojis(savedState.profile.name))} • อายุ ${savedState.profile.age} ปี (${escapeHtml(stripEmojis(savedLoc?.name_th || ''))})
                </span>
              </button>`
                : ''
            }
          </div>
        </div>

        <div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px;">
            <button id="btn-lobby-achievements" class="btn btn--outline" style="flex-direction:column;border-radius:var(--radius-md);padding:10px 6px;font-size:11.5px;" type="button">
              ${renderIcon('trophy')}
              <span>ดูความสำเร็จ</span>
            </button>
            <button id="btn-lobby-merit-shop" class="btn btn--outline" style="flex-direction:column;border-radius:var(--radius-md);padding:10px 6px;font-size:11.5px;" type="button">
              ${renderIcon('tag')}
              <span>พรสวรรค์ติดตัว</span>
            </button>
            <button id="btn-lobby-hall" class="btn btn--outline" style="flex-direction:column;border-radius:var(--radius-md);padding:10px 6px;font-size:11.5px;" type="button">
              ${renderIcon('crown')}
              <span>ทำเนียบผู้รอดชีวิต</span>
            </button>
          </div>
          <div class="app-footer-credit">TPIW • เส้นทางที่ฉันเลือก</div>
        </div>
      </div>
    `,
    bind(rootEl) {
      rootEl.querySelector('#btn-lobby-music')?.addEventListener('click', (e) => {
        const enabled = toggleBgm();
        e.currentTarget.innerHTML = renderIcon(enabled ? 'music' : 'music_off', 'svg-icon--sm');
        e.currentTarget.style.opacity = enabled ? '1' : '0.65';
        e.currentTarget.style.borderColor = enabled ? 'var(--navy-900)' : 'var(--border-strong)';
        e.currentTarget.style.background = enabled ? 'var(--navy-50)' : 'var(--surface-solid)';
        showToast(enabled ? 'เปิดเสียงเพลงแล้ว' : 'ปิดเสียงเพลงแล้ว', 'info');
      });

      rootEl.querySelector('#btn-lobby-new-reborn')?.addEventListener('click', onGoReborn);
      rootEl.querySelector('#btn-lobby-continue')?.addEventListener('click', () => {
        if (savedState && typeof onContinueGame === 'function') {
          onContinueGame(savedState);
        }
      });
      rootEl.querySelector('#btn-lobby-achievements')?.addEventListener('click', () => openAchievementsModal(meta));
      rootEl.querySelector('#btn-lobby-merit-shop')?.addEventListener('click', onGoReborn);
      rootEl.querySelector('#btn-lobby-hall')?.addEventListener('click', () => openHallOfFameModal(meta));
      rootEl.querySelector('#btn-lobby-settings')?.addEventListener('click', () =>
        openSettingsModal(onRefreshLobby, onRefreshLobby)
      );
    }
  };
}

export function renderRebornScreen({ onBackToLobby, onStartLife }) {
  const meta = loadMetaState();
  const availableMerit = Number(meta.karmaBankMerit || 0);
  const purchasableTraits = db.getAllInnateTraits().filter((t) => Number(t.merit_cost_to_buy || 0) > 0);

  let gender = 'male';
  const randIden = generateThaiIdentity(gender, 'class_3', 'player');
  let customName = `${randIden.firstName} ${randIden.lastName} (${randIden.nickname})`;
  const selectedTraitIds = new Set();
  let selectedLifePathId = DEFAULT_LIFE_PATH_ID;
  let selectedStartAge = START_STAGES[0].age;
  const availableLifePaths = getAvailableLifePaths();

  const getSpentMerit = () => {
    let total = 0;
    for (const id of selectedTraitIds) {
      const tr = db.getInnateTrait(id);
      total += Number(tr?.merit_cost_to_buy || 0);
    }
    return total;
  };

  const renderInner = (rootEl) => {
    const spent = getSpentMerit();
    const remaining = availableMerit - spent;

    const lifePathCardsHtml = availableLifePaths.map((path) => {
      const selected = path.path_id === selectedLifePathId;
      return `
        <button type="button" class="card ${selected ? 'card--highlight' : ''}" data-life-path-id="${escapeHtml(path.path_id)}" aria-pressed="${selected ? 'true' : 'false'}" style="text-align:left;padding:10px 12px;border-width:${selected ? '2px' : '1px'};">
          <div style="font-weight:700;font-size:13px;">${escapeHtml(path.name_th)}</div>
          <div style="font-size:11.5px;color:var(--text-secondary);line-height:1.4;margin-top:3px;">${escapeHtml(path.description_th)}</div>
          ${selected ? '<div style="font-size:11px;font-weight:700;color:var(--success);margin-top:5px;">เลือกเส้นทางนี้แล้ว</div>' : ''}
        </button>
      `;
    }).join('');

    const traitCardsHtml = purchasableTraits
      .map((tr) => {
        const cost = Number(tr.merit_cost_to_buy || 0);
        const isSelected = selectedTraitIds.has(tr.id);
        const cannotAfford = !isSelected && remaining < cost;
        const iconKey = TRAIT_ICON_MAP[tr.id] || 'sparkle';

        return `
          <button
            type="button"
            class="trait-card ${isSelected ? 'is-selected' : ''}"
            data-trait-id="${escapeHtml(tr.id)}"
            ${cannotAfford ? 'disabled' : ''}
          >
            ${isSelected ? `<span class="trait-check">${renderIcon('check', 'svg-icon--sm')}</span>` : ''}
            ${renderIcon(iconKey, 'svg-icon--lg')}
            <div style="font-family:var(--font-display);font-weight:700;font-size:13.5px;">${escapeHtml(stripEmojis(tr.name_th))}</div>
            <div style="font-size:11.5px;color:var(--text-secondary);line-height:1.35;">${escapeHtml(stripEmojis(tr.description_th))}</div>
            <div style="font-family:var(--font-display);font-size:12.5px;font-weight:700;color:${cannotAfford ? 'var(--text-muted)' : 'var(--navy-900)'};">
              ${cost} แต้มบุญ
            </div>
          </button>
        `;
      })
      .join('');

    rootEl.innerHTML = `
      <div class="screen-scroll" style="justify-content:space-between;">
        <div class="list-stack">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <button id="btn-reborn-back" class="btn btn--soft btn--sm" type="button">
              ${renderIcon('arrow_left', 'svg-icon--sm')}
              <span>ย้อนกลับ</span>
            </button>
            <div class="pill-badge">
              ${renderIcon('sparkle', 'svg-icon--sm')}
              <span>แต้มบุญคงเหลือ: ${remaining.toLocaleString('th-TH')}</span>
            </div>
          </div>

          <h2 style="text-align:center;font-size:22px;margin-top:4px;">เตรียมตัวจุติใหม่</h2>

          <div class="card">
            <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:14.5px;margin-bottom:8px;">
              ${renderIcon('user', 'svg-icon--sm')}
              <span>ข้อมูลตัวละคร</span>
            </div>

            <div style="display:flex;gap:8px;align-items:center;">
              <input id="input-reborn-name" type="text" class="input-text" value="${escapeHtml(customName)}" placeholder="ระบุชื่อตัวละคร..." />
              <button id="btn-random-name" class="icon-btn" type="button" title="สุ่มชื่อใหม่" style="flex-shrink:0;">
                ${renderIcon('dice', 'svg-icon--sm')}
              </button>
            </div>

            <div class="segmented-toggle" style="margin-top:10px;">
              <button type="button" class="segmented-btn ${gender === 'male' ? 'is-active' : ''}" data-gender="male">ชาย</button>
              <button type="button" class="segmented-btn ${gender === 'female' ? 'is-active' : ''}" data-gender="female">หญิง</button>
            </div>
          </div>

          <div>
            <h3 style="font-size:15px;margin-bottom:8px;">เลือกช่วงชีวิตที่เริ่มเล่น</h3>
            <div class="list-stack">${START_STAGES.map((st) => `<button type="button" class="choice-btn ${selectedStartAge === st.age ? 'choice-btn--special' : ''}" data-start-age="${st.age}"><div class="choice-label">${escapeHtml(st.labelTh)}</div><div class="choice-hints">${escapeHtml(st.descTh)}</div></button>`).join('')}</div>
          </div>

          <div>
            <h3 style="font-size:15px;margin-bottom:8px;">เลือกเส้นทางชีวิต</h3>
            <p style="font-size:12px;color:var(--text-secondary);line-height:1.45;margin-bottom:8px;">เส้นทางมีผลต่อสัดส่วนการสุ่มเหตุการณ์เท่านั้น ไม่ล็อกอาชีพ ความสัมพันธ์ หรือคลังเหตุการณ์หมวดอื่น</p>
            <div class="list-stack">${lifePathCardsHtml}</div>
          </div>

          <div>
            <h3 style="font-size:15px;margin-bottom:8px;">เลือกพรสวรรค์ติดตัวแต่เกิด (ไม่บังคับ)</h3>
            <div class="trait-grid">${traitCardsHtml}</div>
          </div>

          <div class="card" style="background:var(--info-bg);border-color:#BFD8F7;display:flex;align-items:center;gap:10px;">
            ${renderIcon('map_pin')}
            <div style="font-size:12.5px;line-height:1.4;">
              <strong>ชะตาชีวิต:</strong> ${
                selectedTraitIds.has('trait_silver_spoon')
                  ? 'พรสวรรค์คาบช้อนเงินช้อนทองการันตีเกิดในครอบครัวมีอันจะกินหรือมหาเศรษฐี + สุ่ม 12 จังหวัด'
                  : 'สุ่มชนชั้นทางสังคม (5 ระดับ) และจังหวัดเกิด (12 แห่ง)'
              }
            </div>
          </div>
        </div>

        <div style="margin-top:10px;">
          <button id="btn-confirm-reborn" class="btn btn--primary-cta" style="justify-content:center;" type="button">
            <span>เริ่มต้นชีวิตใหม่ (ใช้ ${spent} แต้มบุญ)</span>
          </button>
          <div class="app-footer-credit">TPIW • เส้นทางที่ฉันเลือก</div>
        </div>
      </div>
    `;

    rootEl.querySelector('#btn-reborn-back')?.addEventListener('click', onBackToLobby);

    const nameInput = rootEl.querySelector('#input-reborn-name');
    nameInput?.addEventListener('input', (e) => {
      customName = e.target.value;
    });

    rootEl.querySelector('#btn-random-name')?.addEventListener('click', () => {
      const nextIden = generateThaiIdentity(gender, 'class_3', 'player');
      customName = `${nextIden.firstName} ${nextIden.lastName} (${nextIden.nickname})`;
      if (nameInput) nameInput.value = customName;
    });

    rootEl.querySelectorAll('[data-gender]').forEach((btn) => {
      btn.addEventListener('click', () => {
        gender = btn.getAttribute('data-gender');
        const nextIden = generateThaiIdentity(gender, 'class_3', 'player');
        customName = `${nextIden.firstName} ${nextIden.lastName} (${nextIden.nickname})`;
        renderInner(rootEl);
      });
    });

    rootEl.querySelectorAll('[data-start-age]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedStartAge = Number(btn.getAttribute('data-start-age'));
        renderInner(rootEl);
      });
    });

    rootEl.querySelectorAll('[data-life-path-id]').forEach((card) => {
      card.addEventListener('click', () => {
        selectedLifePathId = card.getAttribute('data-life-path-id');
        renderInner(rootEl);
      });
    });

    rootEl.querySelectorAll('[data-trait-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const tid = card.getAttribute('data-trait-id');
        if (selectedTraitIds.has(tid)) selectedTraitIds.delete(tid);
        else selectedTraitIds.add(tid);
        renderInner(rootEl);
      });
    });

    rootEl.querySelector('#btn-confirm-reborn')?.addEventListener('click', () => {
      const latestMeta = loadMetaState();
      const cost = getSpentMerit();
      if (cost > Number(latestMeta.karmaBankMerit || 0)) {
        showToast('แต้มบุญสะสมไม่เพียงพอ', 'error');
        return;
      }

      if (cost > 0) {
        latestMeta.karmaBankMerit = Number(latestMeta.karmaBankMerit || 0) - cost;
        saveMetaState(latestMeta);
      }

      const freshState = startNewLifeRun(null, null, gender, customName, {
        purchasedTraitIds: Array.from(selectedTraitIds),
        lifePathId: selectedLifePathId,
        startAge: selectedStartAge
      });

      if (typeof onStartLife === 'function') {
        onStartLife(freshState);
      }
    });
  };

  return {
    mount(rootEl) {
      renderInner(rootEl);
    }
  };
}