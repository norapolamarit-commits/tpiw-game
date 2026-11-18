/**
 * js/ui/tab5_lifestyle_shop.js
 * แท็บที่ 5: ใช้ชีวิต (ร้านค้า 7 หมวด ซื้อสด/ผ่อนชำระ และระบบย้ายภูมิลำเนา 12 จังหวัด)
 */

import { db } from '../core/db.js';
import { checkRequirement, formatCurrency, getPlayerFlagSet } from '../core/utils.js';
import { buyShopItem, relocateProvince } from '../engine/economy_engine.js';
import { inflationFactor } from '../engine/money_realism_engine.js';
import { stripEmojis } from '../engine/event_engine.js';
import { escapeHtml, renderIcon } from './icons.js';
import { showToast } from './modals_ending_ui.js';

const SHOP_TABS = [
  { id: 'childhood_school_shop', label: 'วัยเด็ก/โรงเรียน' },
  { id: 'gadgets_and_it', label: 'มือถือ/ไอที' },
  { id: 'courses_and_business_starters', label: 'คอร์ส/ตั้งตัว' },
  { id: 'family_romance_and_merit', label: 'ทำบุญ/หวย/คู่รัก' },
  { id: 'travel_and_wellness', label: 'เที่ยว/สุขภาพ' },
  { id: 'vehicles_assets', label: 'ยานพาหนะ' },
  { id: 'real_estate_assets', label: 'บ้าน/ที่ดิน' },
  { id: 'relocate', label: 'ย้ายจังหวัด (12)' }
];

let activeShopTab = null;
let lastRunId = null;

function renderShopCategory(state, categoryId) {
  const items = db.raw.shop?.[categoryId] || [];
  const age = Number(state.profile.age || 0);
  const usePiggy = age < 7 && !state.finance.hasPiggyBankSmashed;
  const wallet = usePiggy ? Number(state.finance.piggyBank || 0) : Number(state.finance.cash || 0);
  const priceFactor = state.finance?.realismV2 ? inflationFactor(state, age) : 1;
  const purchasedOneTime = new Set(state.finance?.purchasedOneTimeItems || []);
  const activeFlags = getPlayerFlagSet(state);

  if (items.length === 0) {
    return '<div class="card" style="text-align:center;color:var(--text-muted);">ไม่มีรายการในหมวดนี้</div>';
  }

  return items
    .filter((item) => {
      const ownedOnce = item.is_one_time_purchase && purchasedOneTime.has(item.item_id);
      const inAge = age >= Number(item.min_age || 0) && age <= Number(item.max_age ?? 100);
      const meetsFlags = checkRequirement(null, item.req_flags || [], state, {
        forbiddenFlags: item.forbidden_flags || []
      });
      return ownedOnce || (inAge && meetsFlags);
    })
    .map((item) => {
      const ownedOnce = item.is_one_time_purchase && purchasedOneTime.has(item.item_id);
      const inAge = age >= Number(item.min_age || 0) && age <= Number(item.max_age ?? 100);
      const meetsFlags = checkRequirement(null, item.req_flags || [], state, {
        forbiddenFlags: item.forbidden_flags || []
      });
      const needsAp =
        item.is_one_time_purchase === false &&
        item.is_resellable_asset === false &&
        item.item_id !== 'item_government_lottery';
      const hasAp = !needsAp || Number(state.turn?.freeActionPoints || 0) > 0;
      const cashPrice = Math.round(Number(item.price_cash || 0) * priceFactor);
      const downPayment = Math.round(Number(item.installment_option?.down_payment || 0) * priceFactor);
      const canCash = wallet >= cashPrice;

      const inst = item.installment_option;
      let canInstallment = Boolean(inst?.available) && !activeFlags.has('flag_credit_blacklist') && wallet >= downPayment;
      if (canInstallment && categoryId === 'real_estate_assets') {
        const gate = db.getFeatureGate('gate_home_and_condo_mortgage');
        if (gate && !checkRequirement(null, gate.req_flags, state, { forbiddenFlags: gate.forbidden_flags, minAge: gate.min_age })) {
          canInstallment = false;
        }
      }

      let statusNote = '';
      if (ownedOnce) statusNote = 'ซื้อครอบครองแล้ว (ครั้งเดียวในชีวิต)';
      else if (!inAge) statusNote = `เปิดขายเฉพาะอายุ ${item.min_age} - ${item.max_age ?? 100} ปี`;
      else if (!meetsFlags) statusNote = 'คุณสมบัติไม่ครบหรือติดเงื่อนไขต้องห้าม';
      else if (!hasAp) statusNote = 'แต้มเวลาว่างปีนี้หมดแล้ว (0/3)';

      const isBlocked = ownedOnce || !inAge || !meetsFlags || !hasAp;

      return `
        <div class="card ${isBlocked && !ownedOnce ? 'card--locked' : ''}">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            ${renderIcon(
              categoryId === 'vehicles_assets'
                ? 'car'
                : categoryId === 'real_estate_assets'
                  ? 'home'
                  : categoryId === 'travel_and_wellness'
                    ? 'hospital'
                    : 'shop',
              'svg-icon--lg'
            )}
            <div style="flex:1;">
              <div style="font-weight:700;font-size:14.5px;">${escapeHtml(stripEmojis(item.name_th))}</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(stripEmojis(item.description_th))}</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;">
                <span class="pill-badge pill-badge--soft-blue">ราคา ${escapeHtml(formatCurrency(cashPrice))}</span>
                ${needsAp ? '<span class="pill-badge pill-badge--muted">ใช้ 1 แต้มเวลาว่าง</span>' : ''}
              </div>
              ${statusNote ? `<div style="font-size:11.5px;color:${ownedOnce ? 'var(--success)' : 'var(--danger)'};margin-top:4px;">${escapeHtml(statusNote)}</div>` : ''}

              ${
                !isBlocked
                  ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                      <button
                        type="button"
                        class="btn btn--primary btn--sm"
                        style="flex:1;"
                        data-buy-item="${escapeHtml(item.item_id)}"
                        data-pay-mode="cash"
                        ${canCash ? '' : 'disabled'}
                      >
                        ${canCash ? 'ซื้อสดทันที' : 'เงินสดไม่พอ'}
                      </button>
                      ${
                        inst?.available
                          ? `<button
                              type="button"
                              class="btn btn--outline btn--sm"
                              style="flex:1;"
                              data-buy-item="${escapeHtml(item.item_id)}"
                              data-pay-mode="installment"
                              ${canInstallment ? '' : 'disabled'}
                            >
                              ผ่อน (ดาวน์ ${escapeHtml(formatCurrency(downPayment))})
                            </button>`
                          : ''
                      }
                    </div>`
                  : ''
              }
            </div>
          </div>
        </div>`;
    })
    .join('');
}

function renderRelocateList(state) {
  const age = Number(state.profile.age || 0);
  const currentLocId = state.profile.currentLocationId;
  const locs = db.getAllLocations();

  return locs
    .map((loc) => {
      const isCurrent = loc.location_id === currentLocId;
      const canRelocate = !isCurrent && age >= 18 && Number(state.finance.cash || 0) >= Number(loc.relocation_cost || 0);

      return `
        <div class="card ${isCurrent ? 'card--highlight' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
            <div style="display:flex;gap:10px;align-items:flex-start;">
              ${renderIcon('map_pin', 'svg-icon--lg')}
              <div>
                <div style="font-weight:700;font-size:14.5px;">จังหวัด${escapeHtml(stripEmojis(loc.name_th))}</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">
                  ค่าครองชีพ x${loc.cost_of_living_multiplier} • โอกาสงาน x${loc.job_opportunity_multiplier} • โบนัสเรียน ${loc.education_quality_bonus >= 0 ? `+${loc.education_quality_bonus}` : loc.education_quality_bonus}
                </div>
                <div style="font-size:12px;font-weight:600;margin-top:3px;">
                  ค่าย้ายถิ่น: ${escapeHtml(formatCurrency(loc.relocation_cost))}
                </div>
              </div>
            </div>
            <button
              type="button"
              class="btn btn--sm ${isCurrent ? 'btn--soft' : 'btn--primary'}"
              data-relocate-id="${escapeHtml(loc.location_id)}"
              ${canRelocate ? '' : 'disabled'}
            >
              ${isCurrent ? 'อยู่จังหวัดนี้' : (age < 18 ? 'รอ 18 ปี' : 'ย้ายถิ่น')}
            </button>
          </div>
        </div>`;
    })
    .join('');
}

export function renderTab5LifestyleShop(state, { onRefresh }) {
  const age = Number(state.profile.age || 0);
  const runId = state.meta?.runId || null;
  if (runId !== lastRunId || !activeShopTab) {
    lastRunId = runId;
    activeShopTab = age < 13 ? 'childhood_school_shop' : 'gadgets_and_it';
  }

  const loc = db.getLocation(state.profile.currentLocationId);
  const phase = db.getLifePhaseByAge(age);
  const estLiving = Math.round(Number(phase?.baseAnnualLivingCost || 0) * Number(loc?.cost_of_living_multiplier || 1));

  const visibleShopTabs = SHOP_TABS.filter((tab) => {
    if (tab.id === 'relocate') return age >= 18;
    return (db.raw.shop?.[tab.id] || []).some((item) => {
      const ownedOnce = item.is_one_time_purchase && (state.finance?.purchasedOneTimeItems || []).includes(item.item_id);
      const inAge = age >= Number(item.min_age || 0) && age <= Number(item.max_age ?? 100);
      const meetsFlags = checkRequirement(null, item.req_flags || [], state, {
        forbiddenFlags: item.forbidden_flags || []
      });
      return ownedOnce || (inAge && meetsFlags);
    });
  });
  if (!visibleShopTabs.some((tab) => tab.id === activeShopTab)) {
    activeShopTab = visibleShopTabs[0]?.id || 'childhood_school_shop';
  }
  const subTabsHtml = visibleShopTabs.map(
    (t) => `<button type="button" class="subtab-pill ${activeShopTab === t.id ? 'is-active' : ''}" data-shop-subtab="${t.id}">${escapeHtml(t.label)}</button>`
  ).join('');

  const bodyHtml =
    activeShopTab === 'relocate'
      ? renderRelocateList(state)
      : renderShopCategory(state, activeShopTab);

  return {
    html: `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${renderIcon('map_pin')}
            <div>
              <div style="font-weight:700;font-size:14px;">ปัจจุบัน: จ.${escapeHtml(stripEmojis(loc?.name_th || ''))}</div>
              <div style="font-size:12px;color:var(--text-secondary);">ค่าครองชีพพื้นฐานประเมิน: ${escapeHtml(formatCurrency(estLiving))}/ปี</div>
            </div>
          </div>
          <span class="pill-badge pill-badge--navy">เวลาว่าง ${state.turn.freeActionPoints}/${state.turn.maxFreeActionPoints}</span>
        </div>
      </div>

      <div class="subtabs-scroll">${subTabsHtml}</div>
      <div class="list-stack">${bodyHtml}</div>
    `,
    bind(container) {
      container.querySelectorAll('[data-shop-subtab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeShopTab = btn.getAttribute('data-shop-subtab');
          onRefresh();
        });
      });

      container.querySelectorAll('[data-buy-item]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const itemId = btn.getAttribute('data-buy-item');
          const mode = btn.getAttribute('data-pay-mode') || 'cash';
          const res = buyShopItem(state, itemId, mode);
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });

      container.querySelectorAll('[data-relocate-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = relocateProvince(state, btn.getAttribute('data-relocate-id'));
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });
    }
  };
}
