/**
 * js/ui/tab1_life_feed.js
 * แท็บที่ 1: บันทึกชีวิต (4 หลอดสถานะหลัก, ป้ายสถานะ, แต้มเวลาว่าง, การ์ดอีเวนต์ & ผลลัพธ์, ประวัติย้อนหลัง)
 */

import { db } from '../core/db.js';
import { formatCurrency } from '../core/utils.js';
import { getCurrentPendingEvent, getChoicePreviewText, stripEmojis } from '../engine/event_engine.js';
import { selectCurrentEventChoice } from '../engine/turn_manager.js';
import { escapeHtml, renderIcon } from './icons.js';
import { bindPixelTown, renderPixelTownCard } from './pixel_town.js';
import { getPlayerIdentityLabel } from '../engine/gender_identity_engine.js';
import { openAnnualSlipModal, openEmergencyDebtModal, showToast } from './modals_ending_ui.js';

const DELTA_LABELS = {
  health: 'สุขภาพ',
  happiness: 'ความสุข',
  intelligence: 'สมอง',
  connections: 'เส้นสาย',
  merit: 'แต้มบุญ',
  appearance: 'บุคลิกหน้าตา'
};

const EVENT_CATEGORY_LABELS = {
  daily_life: 'ชีวิตประจำวัน', education: 'การศึกษา', family: 'ครอบครัว', friendship: 'มิตรภาพ',
  romance: 'ความรัก', diversity: 'ความหลากหลาย', career: 'อาชีพ', finance: 'การเงิน',
  health: 'สุขภาพ', social_issues: 'สังคม', opportunity: 'โอกาส', rare_events: 'เรื่องไม่คาดฝัน'
};
const EVENT_RARITY_LABELS = { common: 'ทั่วไป', uncommon: 'พิเศษ', rare: 'หายาก', legendary: 'สำคัญมาก' };
let showingRandomHistory = false;
let randomHistoryFilter = 'all';

function renderStatBarRow(iconKey, label, value) {
  const val = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
  const isLow = val <= 20;
  return `
    <div class="stat-bar-row">
      <div class="stat-label">
        ${renderIcon(iconKey, 'svg-icon--sm')}
        <span>${escapeHtml(label)}</span>
      </div>
      <div class="stat-track">
        <div class="stat-fill ${isLow ? 'stat-fill--low' : ''}" style="width:${val}%"></div>
      </div>
      <div class="stat-value">${val}</div>
    </div>
  `;
}

function renderActiveBadgesHtml(state) {
  const cls = db.getClass(state.profile.currentClassId);
  const loc = db.getLocation(state.profile.currentLocationId);
  const pills = [];

  pills.push(
    `<span class="pill-badge pill-badge--muted">${escapeHtml(stripEmojis(cls?.name_th || ''))}</span>`
  );
  pills.push(
    `<span class="pill-badge pill-badge--soft-blue">จ.${escapeHtml(stripEmojis(loc?.name_th || ''))}</span>`
  );
  pills.push(
    `<span class="pill-badge pill-badge--navy">เวลาว่าง: ${state.turn.freeActionPoints}/${state.turn.maxFreeActionPoints}</span>`
  );

  for (const tid of state.innateTraits || []) {
    const def = db.getTraitOrFlag(tid);
    if (def) {
      pills.push(
        `<span class="pill-badge pill-badge--gold">${renderIcon('bulb', 'svg-icon--sm')}<span>${escapeHtml(stripEmojis(def.name_th))}</span></span>`
      );
    }
  }

  for (const tagId of state.talentTags || []) {
    const def = db.getTraitOrFlag(tagId);
    if (def) {
      pills.push(`<span class="pill-badge pill-badge--soft-blue">${escapeHtml(stripEmojis(def.name_th))}</span>`);
    }
  }

  for (const stId of state.statuses || []) {
    const def = db.getTraitOrFlag(stId);
    if (def) {
      const isGood = stId === 'flag_iron_body';
      pills.push(
        `<span class="pill-badge ${isGood ? 'pill-badge--success' : 'pill-badge--danger'}">${escapeHtml(stripEmojis(def.name_th))}</span>`
      );
    }
  }

  return `<div class="badges-row">${pills.join('')}</div>`;
}

function renderOutcomeCardHtml(outcome) {
  const deltasHtml = [];
  for (const [k, v] of Object.entries(outcome.statDeltas || {})) {
    const num = Number(v || 0);
    if (num === 0) continue;
    if (k === 'cash' || k === 'piggyBank') {
      const label = k === 'piggyBank' ? 'กระปุก' : 'เงินสด';
      deltasHtml.push(
        `<span class="pill-badge ${num > 0 ? 'pill-badge--success' : 'pill-badge--danger'}">${label} ${escapeHtml(formatCurrency(num, { showPlus: true }))}</span>`
      );
    } else {
      deltasHtml.push(
        `<span class="pill-badge ${num > 0 ? 'pill-badge--success' : 'pill-badge--danger'}">${escapeHtml(DELTA_LABELS[k] || k)} ${num > 0 ? `+${num}` : num}</span>`
      );
    }
  }

  const rngBadge = outcome.rngRollInfo?.rolled
    ? `<span class="pill-badge ${outcome.rngRollInfo.isSuccess ? 'pill-badge--success' : 'pill-badge--danger'}">
        ${renderIcon(outcome.rngRollInfo.iconKey || 'dice', 'svg-icon--sm')}
        <span>${outcome.rngRollInfo.isSuccess ? 'ทอยเต๋าสำเร็จ' : 'ทอยเต๋าพลาด'} (โอกาส ${outcome.rngRollInfo.chancePercent}%)</span>
      </span>`
    : '';

  return `
    <div class="card card--highlight">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:6px;font-weight:700;font-size:15px;">
          ${renderIcon('book_open')}
          <span>เรื่องราวหลังการตัดสินใจ</span>
        </div>
        ${rngBadge}
      </div>
      <p style="font-size:14px;line-height:1.5;color:var(--text-primary);">
        ${escapeHtml(stripEmojis(outcome.outcomeTextTh || ''))}
      </p>
      ${deltasHtml.length ? `
        <div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-top:12px;">ผลลัพธ์ค่าสถานะ</div>
        <div class="badges-row" style="margin-top:6px;">${deltasHtml.join('')}</div>` : ''}
      <p style="font-size:12px;color:var(--text-secondary);margin-top:10px;">
        กดปุ่มด้านล่างเพื่อไปต่อ
      </p>
    </div>
  `;
}

function renderActiveTurnCardHtml(state) {
  const phase = state.turn?.phase;

  if (phase === 'YEAR_SUMMARY') {
    return `
      <div class="card card--highlight" style="text-align:center;">
        <div style="font-weight:700;font-size:15px;">สรุปงบการเงินต้นปีพร้อมแล้ว</div>
        <p style="font-size:13px;color:var(--text-secondary);margin-top:4px;">ตรวจสอบรายรับ-รายจ่ายประจำปีเพื่อเริ่มเหตุการณ์</p>
        <button id="btn-reopen-slip" class="btn btn--primary btn--sm" style="margin-top:10px;" type="button">
          ${renderIcon('file_text', 'svg-icon--sm')}
          <span>เปิดดูสลิปงบประจำปี</span>
        </button>
      </div>
    `;
  }

  if (phase === 'EMERGENCY_DEBT') {
    return `
      <div class="card card--danger" style="text-align:center;">
        <div style="font-weight:700;font-size:15px;color:var(--danger);">เงินสดติดลบ! ต้องจัดการสภาพคล่องด่วน</div>
        <button id="btn-reopen-debt-modal" class="btn btn--danger btn--sm" style="margin-top:10px;" type="button">
          ${renderIcon('alert', 'svg-icon--sm')}
          <span>เปิดหน้าต่างแก้ไขหนี้ฉุกเฉิน</span>
        </button>
      </div>
    `;
  }

  if (phase === 'EVENT_QUEUE') {
    if (state.turn.awaitingEventAdvance && state.turn.lastChoiceOutcome) {
      return renderOutcomeCardHtml(state.turn.lastChoiceOutcome);
    }

    const evt = getCurrentPendingEvent(state);
    if (evt) {
      const choicesHtml = (evt.choices || [])
        .map((ch) => {
          const isSpecial =
            !ch.isLocked &&
            ((ch.req_flags && ch.req_flags.length > 0) ||
              (ch.req_stats && Object.keys(ch.req_stats).length > 0));

          const previewText = getChoicePreviewText(ch);
          const previewHtml = `<span class="choice-hint-token choice-preview-token">
            ${renderIcon('info', 'svg-icon--sm')}
            <span>${escapeHtml(previewText)}</span>
          </span>`;

          const rngTag = ch.hasRngRoll
            ? `<span class="choice-hint-token">${renderIcon('dice', 'svg-icon--sm')}<span>โอกาสสำเร็จ ${ch.effectiveSuccessChance}%</span></span>`
            : '';

          const lockBanner = ch.isLocked
            ? `<div class="choice-hint-token" style="color:var(--danger);font-weight:600;">
                ${renderIcon('lock', 'svg-icon--sm')}
                <span>${escapeHtml(ch.lockReasonTh || 'ยังไม่ผ่านเงื่อนไข')}</span>
              </div>`
            : '';

          return `
            <button
              type="button"
              class="choice-btn ${isSpecial ? 'choice-btn--special' : ''}"
              data-choice-id="${escapeHtml(ch.choice_id)}"
              ${ch.isLocked ? 'disabled' : ''}
            >
              <div class="choice-label">${escapeHtml(ch.label_th)}</div>
              <div class="choice-hints">
                ${lockBanner || `${rngTag}${previewHtml}`}
              </div>
            </button>
          `;
        })
        .join('');

      return `
        <div class="card card--highlight event-choice-panel ${evt.source_type === 'random_event' ? `random-event-card random-event-card--${evt.rarity}` : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
            <span class="pill-badge pill-badge--soft-blue">
              ${renderIcon('calendar', 'svg-icon--sm')}
              <span>เดือน${escapeHtml(evt.monthTh)} • เหตุการณ์ ${evt.queuePosition}/${evt.queueTotal}</span>
            </span>
            ${evt.source_type === 'random_event' ? `<span class="pill-badge pill-badge--gold">เหตุการณ์สุ่ม • ${escapeHtml(EVENT_CATEGORY_LABELS[evt.category] || 'ชีวิต')} • ${escapeHtml(EVENT_RARITY_LABELS[evt.rarity] || '')}</span>` : ''}
          </div>

          <div style="display:flex;align-items:flex-start;gap:8px;">
            ${renderIcon(evt.iconKey || 'calendar', 'svg-icon--lg')}
            <h3 style="font-size:17px;line-height:1.3;">${escapeHtml(evt.title_th)}</h3>
          </div>

          <p style="font-size:14px;line-height:1.55;color:var(--text-secondary);margin-top:8px;">
            ${escapeHtml(evt.description_th)}
          </p>

          <div class="choice-list">${choicesHtml}</div>
        </div>
      `;
    }
  }

  // FREE_ACTION
  return `
    <div class="card" style="background:var(--success-bg);border-color:#A8DFC6;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="display:flex;align-items:center;gap:8px;color:var(--success);font-weight:700;font-size:14.5px;">
          ${renderIcon('unlock')}
          <span>ช่วงเวลาอิสระท้ายปี (อายุ ${state.profile.age} ปี)</span>
        </div>
        <span class="pill-badge pill-badge--success">เวลาว่าง ${state.turn.freeActionPoints}/${state.turn.maxFreeActionPoints}</span>
      </div>
      <p style="font-size:13px;color:var(--text-secondary);margin-top:6px;">
        สลับไปทำกิจกรรมในแท็บ ทำงาน/เรียน, ความสัมพันธ์, สินทรัพย์ หรือ ใช้ชีวิต ได้ตามอิสระ หรือกด "ปีถัดไป (+1 ปี)" ด้านล่าง
      </p>
    </div>
  `;
}

export function renderTab1LifeFeed(state, { onRefresh }) {
  const age = Number(state.profile.age || 0);
  const connLabel = db.getConnectionsLabelByAge(age);

  const logs = [...(state.turn?.lifeFeedLog || [])].reverse().slice(0, 25);
  const randomHistory = [...(state.turn?.randomEventHistory || [])].reverse();
  const filteredHistory = randomHistoryFilter === 'all' ? randomHistory : randomHistory.filter((entry) => entry.category === randomHistoryFilter);
  const randomHistoryHtml = filteredHistory.map((entry) => {
    const feed = [...(state.turn.lifeFeedLog || [])].reverse().find((item) => item.eventId === entry.id && item.age === entry.age);
    return `<div class="card random-history-item random-history-item--${escapeHtml(entry.rarity || 'common')}">
      <span class="pill-badge pill-badge--muted">อายุ ${Number(entry.age)} ปี • ${escapeHtml(EVENT_CATEGORY_LABELS[entry.category] || 'ชีวิต')}</span>
      <h3>${escapeHtml(feed?.title || entry.title || entry.id)}</h3>
      <p>${escapeHtml(feed?.message || '')}</p>
    </div>`;
  }).join('');
  const logsHtml = logs
    .map(
      (entry) => `
      <div class="card" style="padding:11px 13px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="display:inline-flex;align-items:center;gap:6px;font-weight:700;font-size:13.5px;">
            ${renderIcon(entry.iconKey || 'calendar', 'svg-icon--sm')}
            <span>${escapeHtml(stripEmojis(entry.title || ''))}</span>
          </span>
          <span style="font-size:11.5px;color:var(--text-muted);flex-shrink:0;">
            อายุ ${entry.age} ปี • ${escapeHtml(entry.monthTh || '')}
          </span>
        </div>
        <p style="font-size:13px;color:var(--text-secondary);line-height:1.45;">
          ${escapeHtml(stripEmojis(entry.message || ''))}
        </p>
      </div>`
    )
    .join('');

  const location = db.getLocation(state.profile.currentLocationId);
  const className = db.getClass(state.profile.currentClassId);
  const acquaintances = (state.relationships?.npcs || []).filter((npc) => npc.isAlive !== false);
  const personRows = acquaintances.slice(0, 7).map((npc) => `
    <div class="dashboard-person"><div><strong>${escapeHtml(stripEmojis(npc.name || 'คนรู้จัก'))}</strong>
      <small>${escapeHtml(stripEmojis(npc.roleTitle || 'คนรู้จัก'))}${npc.identityShared ? ` · ${escapeHtml(({ woman: 'Woman', man: 'Man', trans_woman: 'Trans woman', trans_man: 'Trans man', nonbinary: 'Non-binary', genderfluid: 'Genderfluid', agender: 'Agender' })[npc.genderIdentity] || '')}` : ''}</small></div>
      <span>${Math.max(0, Math.min(100, Math.round(Number(npc.relationship || 0))))}</span></div>`).join('');
  const years = Math.max(24, Math.min(80, age + 14));
  const lifeMap = Array.from({ length: years }, (_, year) => `<span class="dashboard-life-cell ${year < age ? 'is-lived' : year === age ? 'is-current' : ''}" title="อายุ ${year} ปี"></span>`).join('');
  const profilePanel = `<aside class="dashboard-side dashboard-profile" aria-label="ข้อมูลตัวละคร">
    <div class="dashboard-panel"><div class="dashboard-panel-kicker">ทะเบียนชีวิต · ${escapeHtml(String(state.profile.birthYearBE || ''))}</div>
      <div class="dashboard-portrait" aria-hidden="true">${escapeHtml((state.profile.firstName || state.profile.name || 'ช').slice(0, 1))}</div>
      <h2>${escapeHtml(stripEmojis(state.profile.name || 'ชีวิตใหม่'))}</h2>
      <dl class="dashboard-facts"><div><dt>อายุ</dt><dd>${age} ปี</dd></div><div><dt>เพศ</dt><dd>${escapeHtml(getPlayerIdentityLabel(state))}</dd></div>
      <div><dt>จังหวัด</dt><dd>${escapeHtml(stripEmojis(location?.name_th || ''))}</dd></div><div><dt>พื้นฐานครอบครัว</dt><dd>${escapeHtml(stripEmojis(className?.name_th || ''))}</dd></div></dl></div>
    <div class="dashboard-panel"><h3>สถานะ <small>0–100</small></h3>
      ${renderStatBarRow('heart_pulse', 'สุขภาพ', state.stats.health)}
      ${renderStatBarRow('smile', 'ความสุข', state.stats.happiness)}
      ${renderStatBarRow('brain', 'ความรู้', state.stats.intelligence)}
      ${renderStatBarRow('users', connLabel, state.stats.connections)}
      <div class="dashboard-money">เงินสด <strong>${escapeHtml(formatCurrency(state.finance?.cash || 0))}</strong></div>
    </div></aside>`;
  const socialPanel = `<aside class="dashboard-side dashboard-social" aria-label="ผู้คนและแผนที่ชีวิต">
    <div class="dashboard-panel"><h3>ครอบครัวและคนรู้จัก <small>${acquaintances.length} คน</small></h3>
      ${personRows || '<p class="dashboard-empty">เรื่องราวของผู้คนจะเริ่มที่นี่</p>'}</div>
    <div class="dashboard-panel"><h3>แผนที่ชีวิต <small>1 ช่อง = 1 ปี</small></h3><div class="dashboard-life-map">${lifeMap}</div></div>
    <div class="dashboard-panel"><h3>เหตุการณ์ที่ผ่านมา</h3><p class="dashboard-history-count">${randomHistory.length} เรื่องราวที่เลือกเอง</p></div></aside>`;

  return {
    html: `<div class="life-dashboard">${profilePanel}<div class="dashboard-center">
      ${showingRandomHistory ? `
      <section aria-label="หน้าประวัติเหตุการณ์สุ่ม">
        <div class="card random-history-controls">
          <div><h2 style="font-size:18px;">ประวัติเหตุการณ์สุ่ม</h2><p>เรื่องราวที่คุณพบและผลจากการตัดสินใจ</p></div>
          <button id="btn-random-history" class="btn btn--sm" type="button">กลับสู่บันทึกชีวิต</button>
          <label>หมวดเหตุการณ์ <select id="random-history-filter"><option value="all">ทุกหมวด</option>${Object.entries(EVENT_CATEGORY_LABELS).map(([key, label]) => `<option value="${key}" ${randomHistoryFilter === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        </div>
        <div class="random-history-timeline" aria-label="ไทม์ไลน์เหตุการณ์สุ่ม">${randomHistoryHtml || '<p>ยังไม่มีเหตุการณ์ในหมวดนี้</p>'}</div>
      </section>
      ` : `
      ${renderPixelTownCard(state, { compact: true })}

      <div class="card stats-card dashboard-mobile-stats">
        ${renderStatBarRow('heart_pulse', 'สุขภาพ', state.stats.health)}
        ${renderStatBarRow('smile', 'ความสุข', state.stats.happiness)}
        ${renderStatBarRow('brain', 'สมอง', state.stats.intelligence)}
        ${renderStatBarRow('users', connLabel, state.stats.connections)}
      </div>

      ${renderActiveBadgesHtml(state)}

      ${renderActiveTurnCardHtml(state)}

      <div class="card random-history-controls">
        <button id="btn-random-history" class="btn btn--sm" type="button">ประวัติเหตุการณ์สุ่ม (${randomHistory.length})</button>
      </div>
      <div style="margin-top:4px;">
        <h3 style="font-size:14.5px;margin-bottom:8px;color:var(--text-secondary);">บันทึกชีวิตย้อนหลัง</h3>
        <div class="list-stack">${logsHtml}</div>
      </div>
      `}
      </div>${socialPanel}</div>
    `,
    bind(container) {
      if (!showingRandomHistory) bindPixelTown(container, state, { onRefresh });
      container.querySelector('#btn-random-history')?.addEventListener('click', () => {
        showingRandomHistory = !showingRandomHistory;
        onRefresh?.();
      });
      container.querySelector('#random-history-filter')?.addEventListener('change', (event) => {
        randomHistoryFilter = event.target.value;
        onRefresh?.();
      });
      container.querySelector('#btn-reopen-slip')?.addEventListener('click', () => {
        openAnnualSlipModal(state, onRefresh);
      });
      container.querySelector('#btn-reopen-debt-modal')?.addEventListener('click', () => {
        openEmergencyDebtModal(state, onRefresh);
      });
      container.querySelectorAll('[data-choice-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const cid = btn.getAttribute('data-choice-id');
          const res = selectCurrentEventChoice(cid, state);
          if (!res.success) {
            showToast(res.message || 'ไม่สามารถเลือกตัวเลือกนี้ได้', 'error');
            return;
          }
          if (typeof onRefresh === 'function') onRefresh();
        });
      });
    }
  };
}
