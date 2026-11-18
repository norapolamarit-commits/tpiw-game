/**
 * js/main.js
 * จุดเริ่มต้นของเกม (Bootloader / Entry Point)
 * โหลดฐานข้อมูลทั้ง 20 ไฟล์, ตรวจสอบเซฟใน localStorage, ผูก UI Router
 * และผูก Engine ทั้งหมดเข้ากับ window.__THAI_LIFE_SIM__
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { db } from './core/db.js';
import {
  createNewCharacter,
  getState,
  hasSavedGame,
  loadGame,
  loadMetaState,
  saveMetaState,
  saveGame,
  clearSavedGame
} from './core/state.js';
import { formatCurrency, formatShortCurrency } from './core/utils.js';

import * as economyEngine from './engine/economy_engine.js';
import * as eventEngine from './engine/event_engine.js';
import * as careerEduEngine from './engine/career_edu_engine.js';
import * as socialEngine from './engine/social_engine.js';
import * as endingEngine from './engine/ending_engine.js';
import * as turnManager from './engine/turn_manager.js';
import { initRouter } from './ui/router.js';

/**
 * แสดงสรุปสถานะตัวละครและสถานะเทิร์นปัจจุบันใน Console
 */
function logCharacterBootSummary(state, source) {
  if (!state) return;
  const cls = db.getClass(state.profile.currentClassId);
  const loc = db.getLocation(state.profile.currentLocationId);
  const phase = db.getLifePhaseByAge(state.profile.age);
  const connLabel = db.getConnectionsLabelByAge(state.profile.age);
  const btnSpec = turnManager.getPrimaryActionButtonSpec(state);
  const currentEvt = eventEngine.getCurrentPendingEvent(state);

  console.group(
    `%c[TPIW] Boot Complete (${source})`,
    'color: #1e3a8a; font-weight: bold; font-size: 13px;'
  );

  console.log('ตัวละคร:', `${state.profile.titlePrefix} ${eventEngine.stripEmojis(state.profile.name)}`);
  console.log('อายุ / ช่วงวัย:', `${state.profile.age} ปี (${eventEngine.stripEmojis(phase?.name_th || state.profile.lifePhaseId)})`);
  console.log('จังหวัดปัจจุบัน:', eventEngine.stripEmojis(loc?.name_th || state.profile.currentLocationId));
  console.log(
    'ชนชั้นทางสังคม:',
    `${eventEngine.stripEmojis(cls?.name_th || state.profile.currentClassId)} (เงินพ่อแม่ซัพพอร์ต: ${formatCurrency(state.finance.parentAnnualSupport)}/ปี)`
  );
  console.log(
    'การเงิน:',
    `กระปุก ${formatCurrency(state.finance.piggyBank)} | เงินสด ${formatCurrency(state.finance.cash)} | Net Worth ${formatCurrency(state.finance.netWorth)}`
  );
  console.log(
    'จังหวะเทิร์น:',
    `Phase = ${state.turn.phase} | ล็อกแท็บ = ${state.turn.areTabsLocked} | แต้มเวลาว่าง = ${state.turn.freeActionPoints}/${state.turn.maxFreeActionPoints}`
  );
  console.log('ปุ่มหลักด้านล่าง:', `[${btnSpec.actionType}] "${btnSpec.labelTh}" (disabled=${btnSpec.disabled})`);

  if (currentEvt) {
    console.log(
      'อีเวนต์ปัจจุบันในคิว:',
      `[เดือน${currentEvt.monthTh} - ใบที่ ${currentEvt.queuePosition}/${currentEvt.queueTotal}] ${currentEvt.title_th}`
    );
  }

  console.table({
    'สุขภาพ (health)': state.stats.health,
    'ความสุข (happiness)': state.stats.happiness,
    'สมอง (intelligence)': state.stats.intelligence,
    [`${connLabel} (connections)`]: state.stats.connections,
    'แต้มบุญ (merit)': state.stats.merit,
    'หน้าตา [Hidden] (appearance)': state.stats.appearance
  });

  console.groupEnd();
}

/**
 * ฟังก์ชันช่วยสร้างตัวละครใหม่พร้อมสุ่มคิวอีเวนต์ปีแรกสุดในคำสั่งเดียว
 */
export function startNewLifeRun(birthClassId = null, locationId = null, gender = null, name = null, options = {}) {
  const freshState = createNewCharacter(birthClassId, locationId, gender, name, options);
  turnManager.initializeFirstYearTurn(freshState);
  logCharacterBootSummary(freshState, 'NEW_CHARACTER');
  return freshState;
}

/**
 * ฟังก์ชันเริ่มต้นระบบเกมทั้งหมดเมื่อเปิดแอปพลิเคชัน
 */
export async function bootGame() {
  console.log('[Bootloader] กำลังโหลดฐานข้อมูล JSON ทั้ง 20 ไฟล์จาก ./data/ ...');

  try {
    const report = await db.loadAllData({
      strict: false,
      onProgress: (loaded, total, filename) => {
        if (loaded === total) {
          console.log(`[DB] โหลดไฟล์ข้อมูลเสร็จสมบูรณ์ (${loaded}/${total}) ล่าสุด: ${filename}`);
        }
      }
    });

    if (!report.success) {
      console.warn('[DB Warning] มีบางไฟล์โหลดไม่สำเร็จ:', report.errors);
    }

    const metaState = loadMetaState();
    let activeState = null;
    let bootSource = 'NO_SAVE_LOBBY';

    if (hasSavedGame()) {
      activeState = loadGame();
      if (activeState) {
        // Repair legacy in-progress annual queues once on restore; ordinary queue reads remain side-effect free.
        if (eventEngine.ensureAnnualEventMinimum(activeState)) {
          saveGame(activeState);
        }
        bootSource = 'LOADED_SAVE';
        const hasNoEventsYet =
          !Array.isArray(activeState.turn?.pendingEvents) || activeState.turn.pendingEvents.length === 0;
        const neverPlayedAnyEvent =
          !Array.isArray(activeState.turn?.triggeredEventIdsThisLife) ||
          activeState.turn.triggeredEventIdsThisLife.length === 0;

        if (activeState.profile.isAlive && hasNoEventsYet && neverPlayedAnyEvent && activeState.profile.age === 0) {
          turnManager.initializeFirstYearTurn(activeState);
        }
        logCharacterBootSummary(activeState, bootSource);
      }
    }

    window.__THAI_LIFE_SIM__ = {
      db,
      state: {
        getState,
        createNewCharacter,
        startNewLifeRun,
        saveGame,
        loadGame,
        clearSavedGame,
        loadMetaState,
        saveMetaState
      },
      utils: {
        formatCurrency,
        formatShortCurrency,
        stripEmojis: eventEngine.stripEmojis
      },
      engine: {
        ...turnManager.engineFacade,
        modules: {
          turnManager,
          economyEngine,
          eventEngine,
          careerEduEngine,
          socialEngine,
          endingEngine
        }
      }
    };

    // เตรียม UI Router ก่อนส่งสัญญาณ game:ready
    initRouter();

    window.dispatchEvent(
      new CustomEvent('game:ready', {
        detail: {
          state: activeState,
          source: bootSource,
          metaState,
          engine: window.__THAI_LIFE_SIM__.engine
        }
      })
    );
  } catch (err) {
    console.error('[Bootloader Fatal Error] ระบบไม่สามารถเริ่มต้นได้:', err);
    const appEl = document.getElementById('app');
    if (appEl) {
      appEl.innerHTML = `
        <div class="screen-scroll">
          <div class="card card--danger">
            <h3>เกิดข้อผิดพลาดในการโหลดเกม</h3>
            <p style="margin-top:8px;font-size:13px;">${err?.message || 'ไม่สามารถโหลดฐานข้อมูล JSON จาก ./data/ ได้ (ต้องรันผ่าน Local Server หรือ Live Server ของ Acode)'}</p>
          </div>
        </div>
      `;
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootGame);
} else {
  bootGame();
}