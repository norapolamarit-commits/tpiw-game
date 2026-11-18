/**
 * js/ui/tab4_assets_debt.js
 * แท็บที่ 4: สินทรัพย์ (Net Worth, ข่าวตลาด, พอร์ตลงทุน 8 ชนิด, ทรัพย์สินขายต่อได้ และสินเชื่อ/หนี้สิน)
 */

import { db } from '../core/db.js';
import { checkRequirement, formatCurrency } from '../core/utils.js';
import {
  applyForLoan,
  buyOrInvestInstrument,
  canApplyForLoan,
  repayLoan,
  sellOrWithdrawInstrument,
  sellOwnedAsset
} from '../engine/economy_engine.js';
import { stripEmojis } from '../engine/event_engine.js';
import { inflationRateForAge } from '../engine/money_realism_engine.js';
import { GAMBLING_COUNSEL_COST, GAMBLING_GAMES, getGamblingStatus, placeBet, seekGamblingCounseling } from '../engine/gambling_engine.js';
import { escapeHtml, renderIcon } from './icons.js';
import { closeModal, openModal, showToast } from './modals_ending_ui.js';

let activeAssetTab = 'investments';
let lastRunId = null;

function openAmountActionModal({ title, subtitle, maxAmount, presets, actionLabel, onConfirm }) {
  const presetBtns = presets
    .map(
      (p) => `<button type="button" class="btn btn--soft btn--sm" data-preset-val="${p.val}">${escapeHtml(p.label)}</button>`
    )
    .join('');

  openModal(`
    <div class="modal-header">
      <div class="modal-title">${renderIcon('coin')}<span>${escapeHtml(title)}</span></div>
      <button class="icon-btn" data-close-modal>${renderIcon('x', 'svg-icon--sm')}</button>
    </div>
    <p style="font-size:13px;color:var(--text-secondary);">${escapeHtml(subtitle)}</p>
    <input id="modal-amount-input" type="number" class="input-text" min="1" max="${maxAmount}" value="${Math.min(maxAmount, presets[0]?.val || 1000)}" />
    <div class="badges-row">${presetBtns}</div>
    <button id="modal-amount-confirm" type="button" class="btn btn--primary btn--block">${escapeHtml(actionLabel)}</button>
  `);

  const input = document.getElementById('modal-amount-input');
  document.querySelectorAll('[data-preset-val]').forEach((b) => {
    b.addEventListener('click', () => {
      if (input) input.value = b.getAttribute('data-preset-val');
    });
  });

  document.getElementById('modal-amount-confirm')?.addEventListener('click', () => {
    const val = Math.round(Number(input?.value || 0));
    closeModal();
    onConfirm(val);
  });
}

function renderInvestmentsTab(state, onRefresh) {
  const instruments = db.raw.market?.financial_instruments || [];
  const age = Number(state.profile.age || 0);
  const cash = Math.max(0, Math.round(Number(state.finance.cash || 0)));

  const cardsHtml = instruments
    .map((inst) => {
      const holding = state.finance.investments?.[inst.instrument_id];
      const currentAmt = Math.round(Number(holding?.amountCash || 0));
      const costBasis = Math.round(Number(holding?.costBasis || 0));
      const pnl = currentAmt - costBasis;

      const unlocked =
        age >= Number(inst.min_age || 0) &&
        checkRequirement(null, inst.req_flags || [], state);

      const divPct = (Number(inst.base_annual_dividend_rate || 0) * 100).toFixed(1);
      const realYield = state.finance?.realismV2 ? ((1 + Number(inst.base_annual_dividend_rate || 0)) / (1 + inflationRateForAge(state, age)) - 1) * 100 : null;
      const minPct = (Number(inst.min_annual_price_change || 0) * 100).toFixed(0);
      const maxPct = (Number(inst.max_annual_price_change || 0) * 100).toFixed(0);

      return `
        <div class="card ${unlocked ? '' : 'card--locked'}">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <div style="font-weight:700;font-size:14.5px;">${escapeHtml(stripEmojis(inst.name_th))}</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(stripEmojis(inst.description_th))}</div>
              <div style="font-size:11.5px;color:var(--navy-700);margin-top:4px;">
                ปันผล/ดอกเบี้ย ${divPct}%/ปี • ผันผวน ${minPct}% ถึง +${maxPct}%
                ${realYield === null ? '' : ` • ผลตอบแทนจริงโดยประมาณ ${realYield.toFixed(1)}%/ปี`}
              </div>
            </div>
            ${!unlocked ? renderIcon('lock') : renderIcon('chart_up')}
          </div>

          <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div>
              <div style="font-size:11.5px;color:var(--text-muted);">มูลค่าที่ถือครอง</div>
              <div style="font-weight:700;font-size:14.5px;">${escapeHtml(formatCurrency(currentAmt))}</div>
              ${
                currentAmt > 0 && costBasis > 0
                  ? `<div style="font-size:11px;" class="${pnl >= 0 ? 'amt-pos' : 'amt-neg'}">กำไร/ขาดทุน: ${escapeHtml(formatCurrency(pnl, { showPlus: true }))}</div>`
                  : `<div style="font-size:11px;color:var(--text-muted);">ขั้นต่ำ ${escapeHtml(formatCurrency(inst.min_investment_cash))}</div>`
              }
            </div>

            <div style="display:flex;gap:6px;">
              <button type="button" class="btn btn--primary btn--sm" data-inv-buy="${escapeHtml(inst.instrument_id)}" ${unlocked && cash > 0 ? '' : 'disabled'}>ลงทุน</button>
              ${
                currentAmt > 0
                  ? `<button type="button" class="btn btn--outline btn--sm" data-inv-sell="${escapeHtml(inst.instrument_id)}">ขาย/ถอน</button>`
                  : ''
              }
            </div>
          </div>
          ${!unlocked ? `<div style="font-size:11.5px;color:var(--danger);margin-top:4px;">ต้องมีอายุ ${inst.min_age}+ ปี และเปิดบัญชี/พอร์ตลงทุนตามเงื่อนไข</div>` : ''}
        </div>`;
    })
    .join('');

  return {
    html: `<div class="list-stack">${cardsHtml}</div>`,
    bind(container) {
      container.querySelectorAll('[data-inv-buy]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-inv-buy');
          const inst = db.getInstrument(id);
          const minInv = Number(inst.min_investment_cash || 100);
          openAmountActionModal({
            title: `ลงทุน: ${stripEmojis(inst.name_th)}`,
            subtitle: `เงินสดที่มี ${formatCurrency(cash)} (ขั้นต่ำ ${formatCurrency(minInv)})`,
            maxAmount: cash,
            presets: [
              { label: formatCurrency(minInv), val: Math.min(cash, minInv) },
              { label: '10,000 ฿', val: Math.min(cash, 10000) },
              { label: '50,000 ฿', val: Math.min(cash, 50000) },
              { label: 'ทั้งหมด', val: cash }
            ],
            actionLabel: 'ยืนยันลงทุน',
            onConfirm: (amt) => {
              const res = buyOrInvestInstrument(state, id, amt);
              showToast(res.message, res.success ? 'success' : 'error');
              onRefresh();
            }
          });
        });
      });

      container.querySelectorAll('[data-inv-sell]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-inv-sell');
          const inst = db.getInstrument(id);
          const held = Math.round(Number(state.finance.investments?.[id]?.amountCash || 0));
          openAmountActionModal({
            title: `ขาย/ถอน: ${stripEmojis(inst.name_th)}`,
            subtitle: `มูลค่าที่ถือครองอยู่ ${formatCurrency(held)}`,
            maxAmount: held,
            presets: [
              { label: '25%', val: Math.max(1, Math.round(held * 0.25)) },
              { label: '50%', val: Math.max(1, Math.round(held * 0.5)) },
              { label: 'ถอนทั้งหมด', val: held }
            ],
            actionLabel: 'ยืนยันขาย/ถอน',
            onConfirm: (amt) => {
              const res = sellOrWithdrawInstrument(state, id, amt);
              showToast(res.message, res.success ? 'success' : 'error');
              onRefresh();
            }
          });
        });
      });
    }
  };
}

function renderGamblingTab(state, onRefresh) {
  const g = getGamblingStatus(state);
  const cash = Math.max(0, Math.round(Number(state.finance?.cash || 0)));
  const cards = GAMBLING_GAMES.map((game) => {
    const locked = state.profile.age < game.minAge;
    return `<div class="card">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
        <div><strong style="color:var(--text-primary);">${escapeHtml(game.nameTh)}</strong>${game.illegal ? ' <span class="pill-badge pill-badge--danger">ผิดกฎหมาย</span>' : ''}
          <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(game.descTh)}</div>
          <div style="font-size:12px;margin-top:4px;">โอกาสชนะ ${(game.winChance * 100).toFixed(1)}% • จ่าย ${game.payoutMultiplier} เท่า • คืนเฉลี่ยต่อ 100 บาท <strong>${(game.winChance * game.payoutMultiplier * 100).toFixed(0)} บาท</strong></div></div>
        <button type="button" class="btn btn--primary btn--sm" data-gamble="${escapeHtml(game.id)}" ${locked || cash <= 0 ? 'disabled' : ''}>แทง</button>
      </div>${locked ? `<div style="font-size:11.5px;color:var(--danger);margin-top:4px;">ต้องมีอายุ ${game.minAge}+ ปี</div>` : ''}</div>`;
  }).join('');
  return {
    html: `<div class="list-stack">
      <div class="card card--warning" style="padding:10px 12px;">
        <div style="font-weight:700;font-size:13px;color:var(--text-primary);">ความเสี่ยงติดพนัน: ${g.addiction}/100 (${escapeHtml(g.levelTh)})</div>
        <div class="stat-track" style="margin-top:6px;"><div class="stat-fill ${g.addiction >= 50 ? 'stat-fill--low' : ''}" style="width:${g.addiction}%"></div></div>
        <div style="font-size:12px;color:var(--text-secondary);margin-top:6px;">ทุกเกมมีเจ้ามือได้เปรียบ ยิ่งเล่นยิ่งเสียในระยะยาว แทงแล้วทั้งหมด ${g.rounds} ครั้ง ชนะรวม ${escapeHtml(formatCurrency(g.totalWon))} เสียรวม ${escapeHtml(formatCurrency(g.totalLost))}</div>
        ${g.addiction >= 30 ? `<button type="button" class="btn btn--outline btn--sm btn--block" style="margin-top:8px;" data-gamble-help>ปรึกษานักจิตวิทยา (${escapeHtml(formatCurrency(GAMBLING_COUNSEL_COST))})</button>` : ''}
      </div>${cards}</div>`,
    bind(container) {
      container.querySelectorAll('[data-gamble]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-gamble');
          const game = GAMBLING_GAMES.find((x) => x.id === id);
          openAmountActionModal({
            title: `แทง: ${game.nameTh}`,
            subtitle: `เงินสดที่มี ${formatCurrency(cash)}`,
            maxAmount: cash,
            presets: [{ label: '100 ฿', val: Math.min(cash, 100) }, { label: '1,000 ฿', val: Math.min(cash, 1000) }, { label: '10,000 ฿', val: Math.min(cash, 10000) }],
            actionLabel: 'ยืนยันแทง',
            onConfirm: (amt) => {
              const res = placeBet(state, id, amt);
              showToast(res.message, res.success ? (res.won ? 'success' : 'info') : 'error');
              onRefresh();
            }
          });
        });
      });
      container.querySelector('[data-gamble-help]')?.addEventListener('click', () => {
        const res = seekGamblingCounseling(state);
        showToast(res.message, res.success ? 'success' : 'error');
        onRefresh();
      });
    }
  };
}

function renderOwnedAssetsTab(state, onRefresh) {
  const owned = state.finance?.ownedAssets || [];
  const installments = state.finance?.installments || [];

  const assetsHtml = owned.length
    ? owned
        .map((a) => {
          const def = db.getShopItem(a.itemId);
          return `
            <div class="card">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <div>
                  <div style="font-weight:700;font-size:14.5px;">${escapeHtml(stripEmojis(def?.name_th || a.itemId))}</div>
                  <div style="font-size:12px;color:var(--text-secondary);">มูลค่าปัจจุบัน: <strong>${escapeHtml(formatCurrency(a.currentValue))}</strong> (ซื้อมา ${escapeHtml(formatCurrency(a.purchasePrice))})</div>
                  ${Number(def?.annual_rental_yield_cash || 0) > 0 ? `<div style="font-size:11.5px;color:var(--success);">ค่าเช่ารับ: +${escapeHtml(formatCurrency(def.annual_rental_yield_cash))}/ปี</div>` : ''}
                </div>
                <button type="button" class="btn btn--outline btn--sm" data-sell-asset="${escapeHtml(a.instanceId)}">ขาย</button>
              </div>
            </div>`;
        })
        .join('')
    : '<div class="card" style="text-align:center;color:var(--text-muted);font-size:13px;">ยังไม่มีทรัพย์สินถาวร (แก็ดเจ็ต/รถ/อสังหาฯ) ในครอบครอง</div>';

  const instHtml = installments.length
    ? installments
        .map((ins) => {
          const def = db.getShopItem(ins.itemId);
          return `
            <div class="card card--warning" style="padding:10px 12px;">
              <div class="slip-row" style="border:none;">
                <span>ผ่อน: ${escapeHtml(stripEmojis(def?.name_th || ins.itemId))}</span>
                <strong>${escapeHtml(formatCurrency(ins.annualPayment))}/ปี (เหลือ ${ins.yearsRemaining} ปี)</strong>
              </div>
            </div>`;
        })
        .join('')
    : '';

  return {
    html: `
      <div class="list-stack">
        ${assetsHtml}
        ${instHtml ? `<h3 style="font-size:14.5px;margin-top:6px;">ภาระผ่อนชำระคงค้าง</h3>${instHtml}` : ''}
      </div>
    `,
    bind(container) {
      container.querySelectorAll('[data-sell-asset]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = sellOwnedAsset(state, btn.getAttribute('data-sell-asset'), 1.0);
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });
    }
  };
}

function renderLoansTab(state, onRefresh) {
  const activeLoans = state.finance?.activeLoans || [];
  const loanProducts = db.raw.loansCrisesEndings?.loan_products_and_credit_rules?.loan_products || [];
  const cash = Math.max(0, Math.round(Number(state.finance.cash || 0)));

  const activeHtml = activeLoans.length
    ? activeLoans
        .map((l) => {
          const def = db.getLoanProduct(l.loanId);
          return `
            <div class="card card--danger">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                <div>
                  <div style="font-weight:700;font-size:14.5px;">${escapeHtml(stripEmojis(def?.name_th || l.loanId))}</div>
                  <div style="font-size:12.5px;">เงินต้นคงเหลือ: <strong class="amt-neg">${escapeHtml(formatCurrency(l.principalRemaining))}</strong></div>
                  <div style="font-size:11.5px;color:var(--text-secondary);">ดอกเบี้ย ${(Number(l.annualRate || 0) * 100).toFixed(1)}%/ปี • ค้างชำระ ${l.missedYears || 0} ปี</div>
                </div>
                <button type="button" class="btn btn--primary btn--sm" data-repay-loan="${escapeHtml(l.loanId)}" ${cash > 0 ? '' : 'disabled'}>โปะหนี้</button>
              </div>
            </div>`;
        })
        .join('')
    : '<div class="card" style="text-align:center;color:var(--success);font-size:13px;">ยอดเยี่ยม! คุณไม่มีหนี้สินเชื่อคงค้างในขณะนี้</div>';

  const productsHtml = loanProducts
    .filter((p) => p.loan_id !== 'loan_student_gys')
    .map((p) => {
      const check = canApplyForLoan(state, p.loan_id, 1);
      const maxRemaining = Number(check.remainingCreditLine ?? p.max_principal_cash ?? 0);
      return `
        <div class="card ${check.eligible ? '' : 'card--locked'}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div style="flex:1;">
              <div style="font-weight:700;font-size:14px;">${escapeHtml(stripEmojis(p.name_th))}</div>
              <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(stripEmojis(p.description_th))}</div>
              <div style="font-size:12px;margin-top:4px;">ดอกเบี้ย ${(Number(p.annual_interest_rate || 0) * 100).toFixed(1)}%/ปี • วงเงินสูงสุด ${escapeHtml(formatCurrency(p.max_principal_cash))}</div>
              ${!check.eligible ? `<div style="font-size:11.5px;color:var(--danger);margin-top:3px;">${escapeHtml(check.reason)}</div>` : ''}
            </div>
            <button type="button" class="btn btn--outline btn--sm" data-apply-loan="${escapeHtml(p.loan_id)}" data-loan-max="${maxRemaining}" ${check.eligible ? '' : 'disabled'}>ขอกู้</button>
          </div>
        </div>`;
    })
    .join('');

  return {
    html: `
      <div class="list-stack">
        <h3 style="font-size:14.5px;">บัญชีหนี้สินเชื่อปัจจุบัน</h3>
        ${activeHtml}
        <h3 style="font-size:14.5px;margin-top:6px;">ผลิตภัณฑ์สินเชื่อที่เปิดให้บริการ</h3>
        ${productsHtml}
      </div>
    `,
    bind(container) {
      container.querySelectorAll('[data-repay-loan]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const loanId = btn.getAttribute('data-repay-loan');
          const loan = (state.finance.activeLoans || []).find((l) => l.loanId === loanId);
          const def = db.getLoanProduct(loanId);
          const maxPay = Math.min(cash, Math.round(Number(loan?.principalRemaining || 0)));
          openAmountActionModal({
            title: `โปะหนี้: ${stripEmojis(def?.name_th || loanId)}`,
            subtitle: `หนี้คงเหลือ ${formatCurrency(loan?.principalRemaining)} | เงินสด ${formatCurrency(cash)}`,
            maxAmount: maxPay,
            presets: [
              { label: '5,000 ฿', val: Math.min(maxPay, 5000) },
              { label: '20,000 ฿', val: Math.min(maxPay, 20000) },
              { label: 'ปิดหนี้ทั้งหมด', val: maxPay }
            ],
            actionLabel: 'ยืนยันชำระหนี้',
            onConfirm: (amt) => {
              const res = repayLoan(state, loanId, amt);
              showToast(res.message, res.success ? 'success' : 'error');
              onRefresh();
            }
          });
        });
      });

      container.querySelectorAll('[data-apply-loan]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const loanId = btn.getAttribute('data-apply-loan');
          const maxAvail = Number(btn.getAttribute('data-loan-max') || 0);
          const def = db.getLoanProduct(loanId);
          openAmountActionModal({
            title: `ยื่นกู้: ${stripEmojis(def?.name_th || loanId)}`,
            subtitle: `วงเงินที่กู้ได้สูงสุด ${formatCurrency(maxAvail)} (ดอกเบี้ย ${(Number(def?.annual_interest_rate || 0) * 100).toFixed(1)}%/ปี)`,
            maxAmount: maxAvail,
            presets: [
              { label: '10,000 ฿', val: Math.min(maxAvail, 10000) },
              { label: '50,000 ฿', val: Math.min(maxAvail, 50000) },
              { label: 'เต็มวงเงิน', val: maxAvail }
            ],
            actionLabel: 'ยืนยันขอกู้',
            onConfirm: (amt) => {
              const res = applyForLoan(state, loanId, amt);
              showToast(res.message, res.success ? 'success' : 'error');
              onRefresh();
            }
          });
        });
      });
    }
  };
}

export function renderTab4AssetsDebt(state, { onRefresh }) {
  const runId = state.meta?.runId || null;
  if (runId !== lastRunId) {
    lastRunId = runId;
    activeAssetTab = 'investments';
  }

  let totalInvestments = 0;
  for (const inv of Object.values(state.finance?.investments || {})) {
    totalInvestments += Number(inv?.amountCash || 0);
  }
  let totalDebt = 0;
  for (const l of state.finance?.activeLoans || []) {
    totalDebt += Number(l?.principalRemaining || 0);
  }
  for (const ins of state.finance?.installments || []) {
    totalDebt += Number(ins?.annualPayment || 0) * Number(ins?.yearsRemaining || 0);
  }

  const currentNews = (db.raw.market?.market_news_events || []).find(
    (n) => n.news_id === state.finance?.currentMarketNewsId
  );

  const subTabs = [
    { id: 'investments', label: `ตลาดการเงิน (${(db.raw.market?.financial_instruments || []).length})` },
    { id: 'gambling', label: 'บ่อนและการพนัน' },
    { id: 'owned', label: `ทรัพย์สิน (${(state.finance?.ownedAssets || []).length})` },
    { id: 'loans', label: `สินเชื่อ & หนี้ (${(state.finance?.activeLoans || []).length})` }
  ];

  const subTabsHtml = subTabs
    .map(
      (t) => `<button type="button" class="subtab-pill ${activeAssetTab === t.id ? 'is-active' : ''}" data-asset-subtab="${t.id}">${escapeHtml(t.label)}</button>`
    )
    .join('');

  let innerView;
  if (activeAssetTab === 'investments') innerView = renderInvestmentsTab(state, onRefresh);
  else if (activeAssetTab === 'gambling') innerView = renderGamblingTab(state, onRefresh);
  else if (activeAssetTab === 'owned') innerView = renderOwnedAssetsTab(state, onRefresh);
  else innerView = renderLoansTab(state, onRefresh);

  return {
    html: `
      <div class="card" style="text-align:center;">
        <div style="font-size:12.5px;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;gap:6px;">
          ${renderIcon('wallet', 'svg-icon--sm')}
          <span>มูลค่าทรัพย์สินสุทธิ (Net Worth)</span>
        </div>
        <div style="font-family:var(--font-display);font-size:28px;font-weight:800;margin-top:4px;color:${state.finance.netWorth < 0 ? 'var(--danger)' : 'var(--navy-900)'};">
          ${escapeHtml(formatCurrency(state.finance.netWorth))}
        </div>
        <div class="grid-2" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border-subtle);font-size:12.5px;">
          <div>พอร์ตลงทุน: <strong>${escapeHtml(formatCurrency(totalInvestments))}</strong></div>
          <div>หนี้สินรวม: <strong class="${totalDebt > 0 ? 'amt-neg' : ''}">${escapeHtml(formatCurrency(totalDebt))}</strong></div>
        </div>
      </div>

      ${
        currentNews
          ? `<div class="card card--warning" style="padding:10px 12px;display:flex;gap:10px;align-items:flex-start;">
              ${renderIcon('chart_up')}
              <div>
                <div style="font-weight:700;font-size:13px;">ข่าวเศรษฐกิจ: ${escapeHtml(stripEmojis(currentNews.headline_th))}</div>
                <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(stripEmojis(currentNews.description_th))}</div>
              </div>
            </div>`
          : ''
      }

      <div class="subtabs-scroll">${subTabsHtml}</div>
      ${innerView.html}
    `,
    bind(container) {
      container.querySelectorAll('[data-asset-subtab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeAssetTab = btn.getAttribute('data-asset-subtab');
          onRefresh();
        });
      });
      innerView.bind(container);
    }
  };
}
