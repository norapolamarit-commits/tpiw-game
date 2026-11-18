/**
 * js/ui/tab2_work_study.js
 * แท็บที่ 2: ทำงาน/เรียน (กิจกรรมตามวัย, เรียนต่อ ป.ตรี/ปวส., สอบใบอนุญาต, พาร์ทไทม์, งานประจำ, ราชการ, ธุรกิจ)
 */

import { db } from '../core/db.js';
import { formatCurrency } from '../core/utils.js';
import {
  applyForJob,
  dropOutHigherEducation,
  enrollHigherEducation,
  getAvailableActivities,
  getAvailableEducationPrograms,
  getAvailableLicenses,
  getCategorizedJobsForUI,
  quitJob,
  requestPromotionOrRaise,
  selectAgeActivity,
  takeLicenseExam,
  workOvertimeAction
} from '../engine/career_edu_engine.js';
import { calculateJobAnnualIncome, getCombinedActionMultipliers } from '../engine/economy_engine.js';
import { stripEmojis } from '../engine/event_engine.js';
import { escapeHtml, renderIcon } from './icons.js';
import { showToast } from './modals_ending_ui.js';

let activeSubTab = null;
let lastRunId = null;

function getSubTabsForState(state) {
  const age = Number(state?.profile?.age || 0);
  const tabs = [{ id: 'activities', label: age >= 60 ? 'กิจวัตรวัยเกษียณ' : 'กิจกรรมตามวัย' }];
  if (getAvailableEducationPrograms(state).length > 0) {
    tabs.push({ id: 'education', label: 'มหาวิทยาลัย/ปวส.' });
  }
  if (getAvailableLicenses(state).length > 0) {
    tabs.push({ id: 'licenses', label: 'สอบใบอนุญาต' });
  }
  const jobs = getCategorizedJobsForUI(state);
  for (const [id, label] of [
    ['part_time_gig', 'พาร์ทไทม์/อิสระ'],
    ['corporate', 'งานบริษัท/วิชาชีพ'],
    ['civil_service', 'ข้าราชการ'],
    ['business', 'ธุรกิจส่วนตัว']
  ]) {
    if ((jobs[id] || []).length > 0) tabs.push({ id, label });
  }
  return tabs;
}

function renderActiveStatusBanner(state) {
  const study = state.careerAndEdu?.activeStudy;
  const mainJobId = state.careerAndEdu?.mainJobId;
  const ptJobId = state.careerAndEdu?.partTimeJobId;
  const mults = getCombinedActionMultipliers(state);
  const blocks = [];

  if (study) {
    const prog = db.getProgram(study.programId);
    blocks.push(`
      <div class="card card--highlight">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="display:flex;gap:10px;align-items:center;">
            ${renderIcon('school', 'svg-icon--lg')}
            <div>
              <div style="font-size:12px;color:var(--text-muted);">กำลังศึกษาอยู่</div>
              <div style="font-weight:700;font-size:15px;">${escapeHtml(stripEmojis(prog?.name_th || study.programId))}</div>
            </div>
          </div>
          <span class="pill-badge pill-badge--soft-blue">ปีที่ ${Number(study.yearsCompleted || 0) + 1}/${study.durationYears}</span>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:12.5px;">
          <span>${study.useStudentLoan ? 'ใช้สิทธิ์กองทุน กยศ.' : `ค่าเทอม ${formatCurrency(study.annualTuition)}/ปี`}</span>
          <button id="btn-dropout-study" class="btn btn--outline btn--sm" type="button">ดรอปเรียน</button>
        </div>
      </div>
    `);
  }

  if (mainJobId || ptJobId) {
    const jobId = mainJobId || ptJobId;
    const isMain = Boolean(mainJobId);
    const jobDef = db.getJob(jobId);
    if (jobDef) {
      const annual = calculateJobAnnualIncome(jobDef, state, mults, isMain);
      const monthly = Math.round(annual / 12);
      const otUsed = Number(state.careerAndEdu?.otUsedThisYear || 0) >= 1;
      const raisedUsed = Boolean(state.careerAndEdu?.requestedRaiseThisYear);
      const yearsWorked = Number(state.careerAndEdu?.yearsInMainJob || 0);

      blocks.push(`
        <div class="card card--highlight">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
            <div style="display:flex;gap:10px;align-items:center;">
              ${renderIcon('work', 'svg-icon--lg')}
              <div>
                <div style="font-size:12px;color:var(--text-muted);">${isMain ? 'อาชีพหลักปัจจุบัน' : 'งานพาร์ทไทม์ระหว่างเรียน'}</div>
                <div style="font-weight:700;font-size:15px;">${escapeHtml(stripEmojis(jobDef.name_th))}</div>
              </div>
            </div>
            <button class="btn btn--soft btn--sm" data-quit-slot="${isMain ? 'main' : 'part_time'}" type="button">ลาออก</button>
          </div>

          <div class="grid-2" style="margin-top:10px;padding:8px 0;border-top:1px solid var(--border-subtle);border-bottom:1px solid var(--border-subtle);">
            <div>
              <div style="font-size:11.5px;color:var(--text-muted);">รายได้ประเมิน</div>
              <div style="font-weight:700;color:var(--success);font-size:14px;">${escapeHtml(formatCurrency(monthly))}/ด.</div>
              <div style="font-size:11px;color:var(--text-muted);">(${escapeHtml(formatCurrency(annual))}/ปี)</div>
            </div>
            <div>
              <div style="font-size:11.5px;color:var(--text-muted);">อายุงาน / ตัวคูณฐาน</div>
              <div style="font-weight:700;font-size:14px;">${isMain ? `${yearsWorked} ปี (${Number(state.careerAndEdu?.salaryMultiplier || 1).toFixed(2)}x)` : 'พาร์ทไทม์'}</div>
              <div style="font-size:11px;color:var(--text-muted);">เวลาว่าง: ${state.turn.freeActionPoints}/${state.turn.maxFreeActionPoints}</div>
            </div>
          </div>

          <div class="grid-2" style="margin-top:10px;">
            <button id="btn-work-ot" class="btn btn--outline btn--sm" type="button" ${otUsed ? 'disabled' : ''}>
              <span>${otUsed ? 'ทำ OT ปีนี้แล้ว' : 'ทำโอที (OT) • 1 แต้ม'}</span>
            </button>
            ${
              isMain
                ? `<button id="btn-request-raise" class="btn btn--outline btn--sm" type="button" ${raisedUsed || yearsWorked < 2 ? 'disabled' : ''}>
                    <span>${yearsWorked < 2 ? 'ขอขึ้นเงินเดือน (รอ 2 ปี)' : (raisedUsed ? 'ขอปรับปีนี้แล้ว' : 'ขอขึ้นเงินเดือน • 1 แต้ม')}</span>
                  </button>`
                : `<div class="pill-badge pill-badge--muted" style="justify-content:center;">ทำควบคู่กับการเรียน</div>`
            }
          </div>
        </div>
      `);
    }
  }

  return blocks.join('');
}

function renderActivitiesList(state) {
  const list = getAvailableActivities(state);
  if (list.length === 0) {
    return `<div class="card" style="text-align:center;color:var(--text-secondary);font-size:13px;">ช่วงอายุนี้ไม่มีโหมดกิจวัตรอัตโนมัติ ให้เลือกสมัครเรียนต่อหรือหางานทำจากแถบด้านบนได้เลย</div>`;
  }

  return list
    .map(
      (act) => `
      <div class="card ${act.isSelected ? 'card--highlight' : (act.isLocked ? 'card--locked' : '')}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            ${renderIcon(act.iconKey || 'book', 'svg-icon--lg')}
            <div>
              <div style="font-weight:700;font-size:14.5px;">${escapeHtml(act.name_th)}</div>
              <div style="font-size:12.5px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(act.description_th)}</div>
              <div style="font-size:12px;font-weight:600;margin-top:4px;color:var(--navy-900);">
                ${Number(act.annual_cost_cash || 0) > 0 ? `ค่าใช้จ่าย ${escapeHtml(formatCurrency(act.annual_cost_cash))}/ปี` : 'ฟรี ไม่มีค่าใช้จ่าย'}
              </div>
              ${act.isLocked && act.lockReasonTh ? `<div style="font-size:11.5px;color:var(--danger);margin-top:3px;">${escapeHtml(act.lockReasonTh)}</div>` : ''}
            </div>
          </div>
          <button
            type="button"
            class="btn btn--sm ${act.isSelected ? 'btn--primary' : 'btn--outline'}"
            data-select-activity="${escapeHtml(act.activity_id)}"
            ${act.isSelected || act.isLocked ? 'disabled' : ''}
          >
            ${act.isSelected ? 'กำลังทำ' : (act.isLocked ? 'ล็อก' : 'เลือก')}
          </button>
        </div>
      </div>`
    )
    .join('');
}

function renderEducationList(state) {
  const programs = getAvailableEducationPrograms(state);
  return programs
    .map(
      (p) => `
      <div class="card ${p.isCurrentlyEnrolled ? 'card--highlight' : (p.isLocked && !p.alreadyGraduated ? 'card--locked' : '')}">
        <div style="display:flex;gap:10px;align-items:flex-start;">
          ${renderIcon('school', 'svg-icon--lg')}
          <div style="flex:1;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
              <strong style="font-size:14.5px;">${escapeHtml(p.name_th)}</strong>
              <span class="pill-badge pill-badge--soft-blue">${p.duration_years} ปี</span>
            </div>
            <p style="font-size:12.5px;color:var(--text-secondary);margin-top:3px;">${escapeHtml(p.description_th)}</p>
            <div style="font-size:12.5px;font-weight:600;margin-top:5px;">ค่าเทอม: ${escapeHtml(formatCurrency(p.annual_tuition_cash))}/ปี</div>
            ${p.lockReasonTh ? `<div style="font-size:11.5px;color:${p.alreadyGraduated ? 'var(--success)' : 'var(--danger)'};margin-top:4px;">${escapeHtml(p.lockReasonTh)}</div>` : ''}
            ${
              !p.isLocked && !p.isCurrentlyEnrolled
                ? `<div class="grid-2" style="margin-top:8px;">
                    <button type="button" class="btn btn--primary btn--sm" data-enroll-id="${escapeHtml(p.program_id)}" data-use-loan="0" ${p.canPayCashFirstYear ? '' : 'disabled'}>จ่ายสดเข้าเรียน</button>
                    <button type="button" class="btn btn--outline btn--sm" data-enroll-id="${escapeHtml(p.program_id)}" data-use-loan="1" ${p.canUseStudentLoan ? '' : 'disabled'}>กู้ กยศ. เรียน</button>
                  </div>`
                : ''
            }
          </div>
        </div>
      </div>`
    )
    .join('');
}

function renderLicensesList(state) {
  const list = getAvailableLicenses(state);
  return list
    .map(
      (lic) => `
      <div class="card ${lic.isOwned ? 'card--highlight' : (lic.isLocked ? 'card--locked' : '')}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            ${renderIcon(lic.iconKey || 'id_card', 'svg-icon--lg')}
            <div>
              <div style="font-weight:700;font-size:14px;">${escapeHtml(lic.name_th)}</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(lic.unlocks_description_th)}</div>
              <div style="font-size:12px;font-weight:600;margin-top:4px;">ค่าสอบ: ${escapeHtml(formatCurrency(lic.cost_cash))}</div>
              ${lic.lockReasonTh && !lic.isOwned ? `<div style="font-size:11.5px;color:var(--danger);margin-top:3px;">${escapeHtml(lic.lockReasonTh)}</div>` : ''}
            </div>
          </div>
          <button
            type="button"
            class="btn btn--sm ${lic.isOwned ? 'btn--soft' : 'btn--primary'}"
            data-take-license="${escapeHtml(lic.license_id)}"
            ${lic.isLocked ? 'disabled' : ''}
          >
            ${lic.isOwned ? 'มีแล้ว' : 'สมัครสอบ'}
          </button>
        </div>
      </div>`
    )
    .join('');
}

function renderJobsCategoryList(state, categoryKey) {
  const grouped = getCategorizedJobsForUI(state);
  const jobs = grouped[categoryKey] || [];
  if (jobs.length === 0) {
    return '<div class="card" style="text-align:center;color:var(--text-muted);">ไม่พบรายการงานในหมวดนี้</div>';
  }

  return jobs
    .map(
      (job) => `
      <div class="card ${job.isEmployedHere ? 'card--highlight' : (job.isLocked ? 'card--locked' : '')}">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
          <div style="display:flex;gap:10px;align-items:flex-start;flex:1;">
            ${renderIcon(job.isLocked ? 'lock' : (job.iconKey || 'work'), 'svg-icon--lg')}
            <div>
              <div style="font-weight:700;font-size:14.5px;">${escapeHtml(job.name_th)}</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;">${escapeHtml(job.description_th)}</div>
              <div style="font-size:12.5px;font-weight:700;color:var(--success);margin-top:4px;">
                รายได้ประเมิน: ${escapeHtml(formatCurrency(job.estimatedMonthlyIncome))}/ด. (${escapeHtml(formatCurrency(job.estimatedAnnualIncome))}/ปี)
              </div>
              ${job.isLocked && job.lockReasonTh ? `<div style="font-size:11.5px;color:var(--danger);margin-top:3px;">${escapeHtml(job.lockReasonTh)}</div>` : ''}
            </div>
          </div>
          <button
            type="button"
            class="btn btn--sm ${job.isEmployedHere ? 'btn--soft' : 'btn--primary'}"
            data-apply-job="${escapeHtml(job.job_id)}"
            ${job.isLocked || job.isEmployedHere ? 'disabled' : ''}
          >
            ${job.isEmployedHere ? 'ทำอยู่' : (job.isLocked ? 'ล็อก' : 'สมัคร')}
          </button>
        </div>
      </div>`
    )
    .join('');
}

export function renderTab2WorkStudy(state, { onRefresh }) {
  const age = Number(state.profile.age || 0);
  const runId = state.meta?.runId || null;
  if (runId !== lastRunId || !activeSubTab) {
    lastRunId = runId;
    activeSubTab = age < 18 || age >= 60 ? 'activities' : 'corporate';
  }

  const subTabs = getSubTabsForState(state);
  if (!subTabs.some((tab) => tab.id === activeSubTab)) activeSubTab = subTabs[0]?.id || 'activities';
  const subTabsHtml = subTabs
    .map(
      (st) => `
      <button type="button" class="subtab-pill ${activeSubTab === st.id ? 'is-active' : ''}" data-work-subtab="${st.id}">
        ${escapeHtml(st.label)}
      </button>`
    )
    .join('');

  let bodyHtml = '';
  if (activeSubTab === 'activities') bodyHtml = renderActivitiesList(state);
  else if (activeSubTab === 'education') bodyHtml = renderEducationList(state);
  else if (activeSubTab === 'licenses') bodyHtml = renderLicensesList(state);
  else bodyHtml = renderJobsCategoryList(state, activeSubTab);

  return {
    html: `
      ${renderActiveStatusBanner(state)}
      <div class="subtabs-scroll">${subTabsHtml}</div>
      <div class="list-stack">${bodyHtml}</div>
    `,
    bind(container) {
      container.querySelectorAll('[data-work-subtab]').forEach((btn) => {
        btn.addEventListener('click', () => {
          activeSubTab = btn.getAttribute('data-work-subtab');
          onRefresh();
        });
      });

      container.querySelectorAll('[data-select-activity]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = selectAgeActivity(state, btn.getAttribute('data-select-activity'));
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });

      container.querySelectorAll('[data-enroll-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const pid = btn.getAttribute('data-enroll-id');
          const useLoan = btn.getAttribute('data-use-loan') === '1';
          const res = enrollHigherEducation(state, pid, useLoan);
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });

      container.querySelector('#btn-dropout-study')?.addEventListener('click', () => {
        const res = dropOutHigherEducation(state);
        showToast(res.message, res.success ? 'info' : 'error');
        onRefresh();
      });

      container.querySelectorAll('[data-take-license]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = takeLicenseExam(state, btn.getAttribute('data-take-license'));
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });

      container.querySelectorAll('[data-apply-job]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = applyForJob(state, btn.getAttribute('data-apply-job'));
          showToast(res.message, res.success ? 'success' : 'error');
          onRefresh();
        });
      });

      container.querySelectorAll('[data-quit-slot]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const res = quitJob(state, btn.getAttribute('data-quit-slot'));
          showToast(res.message, res.success ? 'info' : 'error');
          onRefresh();
        });
      });

      container.querySelector('#btn-work-ot')?.addEventListener('click', () => {
        const res = workOvertimeAction(state);
        showToast(res.message, res.success ? 'success' : 'error');
        onRefresh();
      });

      container.querySelector('#btn-request-raise')?.addEventListener('click', () => {
        const res = requestPromotionOrRaise(state);
        showToast(res.message, res.raised ? 'success' : 'info');
        onRefresh();
      });
    }
  };
}