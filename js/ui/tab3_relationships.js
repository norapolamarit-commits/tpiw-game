/**
 * js/ui/tab3_relationships.js
 * แท็บที่ 3: ความสัมพันธ์ (พ่อแม่ เพื่อนฝูง ค้นหาคู่รัก แต่งงาน/หย่า เลี้ยงดูบุตร และทำพินัยกรรม)
 */

import { db } from '../core/db.js';
import { saveGame } from '../core/state.js';
import { formatCurrency } from '../core/utils.js';
import { writeWillAndTestament } from '../engine/ending_engine.js';
import { stripEmojis } from '../engine/event_engine.js';
import {
  breakUpWithPartner,
  changeChildUpbringingPolicy,
  designateHeirChild,
  discoverPotentialPartners,
  getAvailableRelationshipActions,
  getChildUpbringingStageByAge,
  getHeartsCountFromScore,
  performRelationshipAction,
  startTalkingToPartner
} from '../engine/social_engine.js';
import { escapeHtml, renderIcon } from './icons.js';
import { showToast } from './modals_ending_ui.js';
import { bindPixelTown, renderPixelTownCard } from './pixel_town.js';
import { STAGES, describeNpcIdentity, getMoves, getStageLabel, listRelationshipNpcs, performMove, stageOf } from '../engine/relationship_stage_engine.js';

let activeRelTab = 'family';
let lastRunId = null;

function renderHeartsMeter(relScore) {
  const filled = getHeartsCountFromScore(relScore);
  let hearts = '';
  for (let i = 0; i < 5; i++) {
    hearts += renderIcon(i < filled ? 'heart_filled' : 'heart', 'svg-icon--sm');
  }
  return `<span class="hearts-row">${hearts} <span style="font-size:12px;font-weight:700;margin-left:4px;">${Math.round(relScore || 0)}%</span></span>`;
}

function renderRelActionsButtons(actions, targetId = null) {
  if (!actions || actions.length === 0) return '';
  return `
    <div class="list-stack" style="gap:6px;margin-top:8px;">
      ${actions
        .map(
          (a) => `
          <button
            type="button"
            class="btn btn--outline btn--sm btn--block"
            style="justify-content:space-between;text-align:left;border-radius:var(--radius-md);padding:8px 10px;"
            data-rel-action="${escapeHtml(a.action_id)}"
            data-rel-target="${escapeHtml(targetId || '')}"
            ${a.isLocked ? 'disabled' : ''}
          >
            <span>
              <strong>${escapeHtml(a.name_th)}</strong>
              <span style="display:block;font-size:11px;font-weight:400;color:${a.isLocked ? 'var(--danger)' : 'var(--text-secondary)'};">
                ${escapeHtml(a.isLocked ? a.lockReasonTh : `${a.cashCost > 0 ? formatCurrency(a.cashCost) : 'ฟรี'} • ${a.apCost > 0 ? `${a.apCost} แต้มเวลาว่าง` : '0 แต้ม'}`)}
              </span>
            </span>
            ${renderIcon(a.isLocked ? 'lock' : (a.iconKey || 'heart'), 'svg-icon--sm')}
          </button>`
        )
        .join('')}
    </div>
  `;
}

function sharedGenderLabel(person) {
  if (!person?.identityShared) return '';
  const labels = { woman: 'Woman', man: 'Man', trans_woman: 'Trans woman', trans_man: 'Trans man', nonbinary: 'Non-binary', genderfluid: 'Genderfluid', agender: 'Agender' };
  return labels[person.genderIdentity] ? ` • ${escapeHtml(labels[person.genderIdentity])}` : '';
}

function renderStagesTab(state) {
  const list = listRelationshipNpcs(state);
  if (!list.length) return '<div class="card"><p style="font-size:13px;">ยังไม่มีเพื่อนในรายชื่อ ลองไปพบปะผู้คนในเมืองพิกเซลหรือทักทายใน lane ก่อนนะ</p></div>';
  const ladder = (npc) => {
    const cur = stageOf(npc) === 'fling' ? 'fling' : stageOf(npc);
    const idx = STAGES.findIndex((x) => x.id === cur);
    return `<div class="rs-ladder">${STAGES.map((x, i) => `<span class="rs-step ${i <= idx && cur !== 'fling' ? 'is-done' : ''} ${i === idx && cur !== 'fling' ? 'is-current' : ''}">${escapeHtml(x.label)}</span>`).join('')}${cur === 'fling' ? '<span class="rs-step is-current rs-fling">กิ๊ก</span>' : ''}</div>`;
  };
  return `<p style="font-size:12.5px;color:var(--text-secondary);margin:2px 2px 8px;">ก้าวต่อไปของความสัมพันธ์ ทุกคนมีสิทธิ์ตอบตกลงหรือปฏิเสธ การถามอย่างสุภาพและเคารพคำตอบคือหัวใจ</p><div class="list-stack">${list.map((npc) => {
    const moves = getMoves(state, npc);
    return `<div class="card rs-card">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
        <div><strong style="color:var(--text-primary);">${escapeHtml(stripEmojis(npc.name))}</strong> <small style="color:var(--text-muted);">${escapeHtml(describeNpcIdentity(npc))}</small>
          <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(npc.roleTitle || 'เพื่อน')}</div></div>
        <span class="pill-badge pill-badge--navy">${escapeHtml(getStageLabel({ ...npc, stage: stageOf(npc) }))}</span>
      </div>
      <div style="margin:8px 0 4px;">${renderHeartsMeter(npc.relationship)}</div>
      ${ladder(npc)}
      <div class="list-stack" style="gap:6px;margin-top:8px;">${moves.map((m) => `<button type="button" class="btn btn--outline btn--sm btn--block" style="text-align:left;justify-content:space-between;" data-stage-move="${m.id}" data-stage-npc="${escapeHtml(npc.id)}" ${m.locked ? 'disabled' : ''}><span>${escapeHtml(m.label)}</span>${m.locked ? `<small style="color:var(--text-muted);">${escapeHtml(m.reason)}</small>` : ''}</button>`).join('') || '<small style="color:var(--text-muted);">ตอนนี้ไม่มีก้าวถัดไป</small>'}</div>
    </div>`;
  }).join('')}</div>`;
}

function renderFamilyAndFriendsTab(state) {
  const npcs = state.relationships?.npcs || [];
  const parents = npcs.filter((n) => n.archetypeId === 'npc_arch_father' || n.archetypeId === 'npc_arch_mother');
  const friends = npcs.filter((n) => n.archetypeId !== 'npc_arch_father' && n.archetypeId !== 'npc_arch_mother');

  const allActions = getAvailableRelationshipActions(state, null);
  const parentActions = allActions.filter((a) => a.target_npc_group === 'parents');
  const friendActions = allActions.filter((a) => a.target_npc_group === 'friends');

  const parentsHtml = parents
    .map(
      (p) => `
      <div class="card ${p.isAlive ? '' : 'card--locked'}">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:700;font-size:14.5px;">${escapeHtml(stripEmojis(p.name))}</div>
            <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(stripEmojis(p.roleTitle))} • ${p.isAlive ? 'ยังมีชีวิต' : 'ล่วงลับไปแล้ว'}</div>
          </div>
          ${p.isAlive ? renderHeartsMeter(p.relationship) : ''}
        </div>
      </div>`
    )
    .join('');

  const friendsHtml = friends.length
    ? friends
        .map(
          (f) => `
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <div style="font-weight:700;font-size:14.5px;">${escapeHtml(stripEmojis(f.name))}</div>
                <div style="font-size:12px;color:var(--text-secondary);">${escapeHtml(stripEmojis(f.roleTitle))}${sharedGenderLabel(f)}</div>
              </div>
              ${renderHeartsMeter(f.relationship)}
            </div>
          </div>`
        )
        .join('')
    : '<div class="card" style="text-align:center;font-size:12.5px;color:var(--text-muted);">ยังไม่มีเพื่อนหรือผู้ใหญ่ในเครือข่าย (ปลดล็อกตามช่วงวัย)</div>';

  return `
    <div class="list-stack">
      <h3 style="font-size:14.5px;">คุณพ่อและคุณแม่</h3>
      ${parentsHtml}
      ${parentActions.length > 0 ? `<div class="card"><div style="font-size:13px;font-weight:700;">กิจกรรมดูแลพ่อแม่</div>${renderRelActionsButtons(parentActions)}</div>` : ''}

      <h3 style="font-size:14.5px;margin-top:6px;">เพื่อนร่วมรุ่นและผู้ใหญ่ในวงการ</h3>
      ${friendsHtml}
      ${friends.length > 0 && friendActions.length > 0 ? `<div class="card"><div style="font-size:13px;font-weight:700;">กิจกรรมเข้าสังคม</div>${renderRelActionsButtons(friendActions)}</div>` : ''}
    </div>
  `;
}

function renderRomanceTab(state) {
  const partner = state.relationships?.partner;
  const age = Number(state.profile.age || 0);

  if (!partner) {
    const candidates = state.relationships?.lastPartnerCandidates || [];
    const candidatesHtml = candidates
      .map(
        (c) => `
        <div class="card card--highlight">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div>
              <div style="font-weight:700;font-size:14.5px;">${escapeHtml(stripEmojis(c.name))}</div>
              <div style="font-size:12px;color:var(--text-secondary);">อายุ ${c.age} ปี • ${escapeHtml(c.roleTitle)}${sharedGenderLabel(c)}</div>
              <div style="font-size:12px;margin-top:4px;">${escapeHtml(c.descriptionTh)}</div>
              <div style="font-size:11.5px;color:var(--navy-700);margin-top:4px;">ค่าใช้จ่ายแต่งงานโดยประมาณ: ${escapeHtml(formatCurrency(c.dowryCostCash))}</div>
            </div>
            <button type="button" class="btn btn--primary btn--sm" data-pick-candidate="${escapeHtml(c.candidateId)}">เริ่มคุย</button>
          </div>
        </div>`
      )
      .join('');

    return `
      <div class="list-stack">
        <div class="card" style="text-align:center;">
          ${renderIcon('heart', 'svg-icon--lg')}
          <h3 style="font-size:15.5px;margin-top:6px;">สถานะปัจจุบัน: โสด</h3>
          <p style="font-size:12.5px;color:var(--text-secondary);margin-top:4px;">
            ${age < 15 ? 'เปิดระบบค้นหาคนคุยเมื่ออายุครบ 15 ปีขึ้นไป' : 'สุ่มพบคนที่ตรงสเปกตามระดับความสามารถและสังคมของคุณ'}
          </p>
          <button id="btn-discover-partners" type="button" class="btn btn--primary btn--block" style="margin-top:10px;" ${age < 15 ? 'disabled' : ''}>
            ${renderIcon('heart', 'svg-icon--sm')}
            <span>ค้นหาคนคุย / หาคู่</span>
          </button>
        </div>
        ${candidatesHtml}
      </div>
    `;
  }

  const statusLabel = partner.status === 'married' ? 'คู่สมรส' : (partner.status === 'dating' ? 'คนรัก/แฟน' : 'คนคุย');
  const spTrait = partner.financialTraitId ? db.indexes.spouseTraits.get(partner.financialTraitId) : null;
  const partnerActions = getAvailableRelationshipActions(state, partner.id).filter(
    (a) => a.target_npc_group === 'partner'
  );

  return `
    <div class="list-stack">
      <div class="card card--highlight">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div>
            <span class="pill-badge pill-badge--soft-blue">${statusLabel}</span>
            <h3 style="font-size:16px;margin-top:6px;">${escapeHtml(stripEmojis(partner.name))}</h3>
            <p style="font-size:12.5px;color:var(--text-secondary);">อายุ ${partner.age} ปี • ${escapeHtml(stripEmojis(partner.roleTitle))}${sharedGenderLabel(partner)}</p>
          </div>
          ${renderHeartsMeter(partner.relationship)}
        </div>

        ${
          partner.status === 'married'
            ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border-subtle);font-size:12.5px;">
                <div>นิสัยการเงินคู่ชีวิต: <strong>${escapeHtml(stripEmojis(spTrait?.name_th || 'ปกติ'))}</strong></div>
                <div>ช่วยค่าใช้จ่ายครัวเรือน: <strong class="${partner.netAnnualCashContribution >= 0 ? 'amt-pos' : 'amt-neg'}">${escapeHtml(formatCurrency(partner.netAnnualCashContribution, { showPlus: true }))}/ปี</strong></div>
              </div>`
            : ''
        }

        ${renderRelActionsButtons(partnerActions, partner.id)}

        ${
          partner.status !== 'married'
            ? `<button id="btn-breakup-partner" type="button" class="btn btn--soft btn--sm btn--block" style="margin-top:10px;color:var(--danger);">ยุติความสัมพันธ์ / บอกเลิก</button>`
            : ''
        }
      </div>
    </div>
  `;
}

function renderChildrenAndWillTab(state) {
  const age = Number(state.profile.age || 0);
  const children = state.relationships?.children || [];
  const childActions = getAvailableRelationshipActions(state, null).filter((a) => a.target_npc_group === 'children');
  const heirId = state.relationships?.designatedHeirId;

  const kidsHtml = children.length
    ? children
        .map((kid) => {
          const isHeir = heirId === kid.id;
          const stageDef = kid.age <= 21 && !kid.outcomeId ? getChildUpbringingStageByAge(kid.age) : null;
          const policyBtns = stageDef
            ? (stageDef.policy_options || [])
                .map((opt) => {
                  const selected = kid.currentPolicyId === opt.option_id;
                  return `
                    <button
                      type="button"
                      class="btn btn--sm ${selected ? 'btn--primary' : 'btn--outline'} btn--block"
                      style="justify-content:space-between;border-radius:var(--radius-md);padding:7px 10px;"
                      data-child-policy="${escapeHtml(kid.id)}|${escapeHtml(opt.option_id)}"
                      ${selected ? 'disabled' : ''}
                    >
                      <span>${escapeHtml(stripEmojis(opt.name_th))}</span>
                      <span>${escapeHtml(formatCurrency(opt.annual_auto_cost_cash))}/ปี</span>
                    </button>`;
                })
                .join('')
            : '';

          return `
            <div class="card ${isHeir ? 'card--highlight' : ''}">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <div>
                  <div style="font-weight:700;font-size:15px;">${escapeHtml(stripEmojis(kid.name))}</div>
                  <div style="font-size:12px;color:var(--text-secondary);">อายุ ${kid.age} ปี • แต้มความสำเร็จ: ${kid.successPoints}</div>
                </div>
                ${renderHeartsMeter(kid.relationship)}
              </div>

              ${
                kid.outcomeTitleTh
                  ? `<div class="pill-badge pill-badge--gold" style="margin-top:8px;">ผลลัพธ์: ${escapeHtml(kid.outcomeTitleTh)}</div>`
                  : ''
              }

              ${
                policyBtns
                  ? `<div style="margin-top:10px;"><div style="font-size:12px;font-weight:700;margin-bottom:5px;">นโยบายการเลี้ยงดู (${escapeHtml(stripEmojis(stageDef.stage_name_th))})</div><div class="list-stack" style="gap:5px;">${policyBtns}</div></div>`
                  : ''
              }

              <div style="display:flex;gap:8px;margin-top:10px;">
                <button
                  type="button"
                  class="btn btn--sm ${isHeir ? 'btn--soft' : 'btn--outline'}"
                  style="flex:1;"
                  data-set-heir="${escapeHtml(kid.id)}"
                  ${isHeir ? 'disabled' : ''}
                >
                  ${isHeir ? 'ทายาทผู้สืบทอดหลัก' : 'ตั้งเป็นทายาทหลัก'}
                </button>
              </div>

              ${renderRelActionsButtons(childActions, kid.id)}
            </div>`;
        })
        .join('')
    : '<div class="card" style="text-align:center;color:var(--text-muted);font-size:13px;">คุณยังไม่มีบุตร (แต่งงานและเตรียมความพร้อมที่อยู่อาศัยก่อนวางแผนมีบุตร)</div>';

  const canWill = age >= 60 || (state.flags || []).includes('flag_will_unlocked');
  const hasWill = (state.flags || []).includes('flag_has_written_will');

  const willCard = `
    <div class="card ${hasWill ? 'card--highlight' : ''}">
      <div style="display:flex;align-items:center;gap:8px;">
        ${renderIcon('file_text')}
        <div>
          <div style="font-weight:700;font-size:14.5px;">พินัยกรรมและการส่งต่อมรดก</div>
          <div style="font-size:12px;color:var(--text-secondary);">
            ${hasWill ? 'จดทะเบียนพินัยกรรมแล้ว (ลดภาษีมรดกเหลือ 0%)' : 'ทำพินัยกรรมเมื่ออายุ 60+ ลดภาษีมรดกจาก 10% เหลือ 0% (ค่าทนาย 2,000 ฿)'}
          </div>
        </div>
      </div>
      <button id="btn-write-will" type="button" class="btn btn--primary btn--sm btn--block" style="margin-top:10px;" ${!canWill ? 'disabled' : ''}>
        ${hasWill ? 'อัปเดตพินัยกรรมตามทายาทปัจจุบัน' : (canWill ? 'จดทะเบียนทำพินัยกรรม' : 'ปลดล็อกเมื่ออายุ 60 ปี')}
      </button>
    </div>
  `;

  return `<div class="list-stack">${kidsHtml}${willCard}</div>`;
}

export function renderTab3Relationships(state, { onRefresh }) {
  const runId = state.meta?.runId || null;
  if (runId !== lastRunId) {
    lastRunId = runId;
    activeRelTab = 'family';
  }

  const npcs = state.relationships?.npcs || [];
  const kids = state.relationships?.children || [];

  const subTabs = [
    { id: 'town', label: 'เมืองพิกเซล' },
    { id: 'stages', label: 'ระดับความสัมพันธ์' },
    { id: 'family', label: `ครอบครัว & เพื่อน (${npcs.length})` },
    { id: 'romance', label: state.relationships?.partner ? 'ความรัก (มีคู่)' : 'ความรัก (โสด)' },
    { id: 'children', label: `บุตร (${kids.length}) & พินัยกรรม` }
  ];

  const subTabsHtml = subTabs
    .map(
      (t) => `<button type="button" class="subtab-pill ${activeRelTab === t.id ? 'is-active' : ''}" data-rel-subtab="${t.id}">${escapeHtml(t.label)}</button>`
    )
    .join('');

  let bodyHtml = '';
  if (activeRelTab === 'town') bodyHtml = renderPixelTownCard(state);
  else if (activeRelTab === 'stages') bodyHtml = renderStagesTab(state);
  else if (activeRelTab === 'family') bodyHtml = renderFamilyAndFriendsTab(state);
  else if (activeRelTab === 'romance') bodyHtml = renderRomanceTab(state);
  else bodyHtml = renderChildrenAndWillTab(state);

  return {
    html: `
      <div class="card" style="padding:10px 14px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:700;font-size:13.5px;">แต้มเวลาว่างคงเหลือ</span>
        <span class="pill-badge pill-badge--navy">${state.turn.freeActionPoints}/${state.turn.maxFreeActionPoints} แต้ม</span>
      </div>
      <div class="subtabs-scroll">${subTabsHtml}</div>
      ${bodyHtml}
    `,
    bind(container) {
      if (activeRelTab === 'town') bindPixelTown(container, state, { onRefresh });
      container.querySelectorAll('[data-stage-move]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = performMove(state, btn.getAttribute('data-stage-npc'), btn.getAttribute('data-stage-move'));
          saveGame(state);
          showToast(res.message, res.success ? 'success' : 'info');
          onRefresh();
        });
      });

      container.querySelectorAll('[data-rel-subtab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeRelTab = btn.getAttribute('data-rel-subtab');
          onRefresh();
        });
      });

      container.querySelector('#btn-discover-partners')?.addEventListener('click', () => {
        const res = discoverPotentialPartners(state);
        if (!res.success) showToast(res.message, 'error');
        onRefresh();
      });

      container.querySelectorAll('[data-pick-candidate]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = startTalkingToPartner(state, btn.getAttribute('data-pick-candidate'));
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });

      container.querySelector('#btn-breakup-partner')?.addEventListener('click', () => {
        const res = breakUpWithPartner(state);
        showToast(res.message, res.success ? 'info' : 'error');
        onRefresh();
      });

      container.querySelectorAll('[data-rel-action]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const actId = btn.getAttribute('data-rel-action');
          const targetId = btn.getAttribute('data-rel-target') || null;
          const res = performRelationshipAction(state, actId, targetId);
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });

      container.querySelectorAll('[data-child-policy]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const [cid, pid] = btn.getAttribute('data-child-policy').split('|');
          const res = changeChildUpbringingPolicy(state, cid, pid);
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });

      container.querySelectorAll('[data-set-heir]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = designateHeirChild(state, btn.getAttribute('data-set-heir'));
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });

      container.querySelector('#btn-write-will')?.addEventListener('click', () => {
        const res = writeWillAndTestament(state, {
          designatedHeirId: state.relationships?.designatedHeirId
        });
        showToast(res.message, res.success ? 'success' : 'error');
        onRefresh();
      });
    }
  };
}
