import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { DATA_MANIFEST, db } from '../js/core/db.js';
import { createNewCharacter } from '../js/core/state.js';
import { getCurrentPendingEvent } from '../js/engine/event_engine.js';
import { initializeFirstYearTurn, triggerPrimaryActionButton, selectCurrentEventChoice, resolveEmergencyDebtAndContinue } from '../js/engine/turn_manager.js';
import { getMoves, performMove } from '../js/engine/relationship_stage_engine.js';
import { getCategorizedJobsForUI, applyForJob } from '../js/engine/career_edu_engine.js';
import { discoverPotentialPartners, startTalkingToPartner } from '../js/engine/social_engine.js';
import { generateFeed, interactWithPost, postPhoto, PHOTO_SCENES } from '../js/engine/social_media_engine.js';

const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,String(v)), removeItem: k => memory.delete(k) };
const originalRandom = Math.random;
const rnd = seed => { let x = seed >>> 0; return () => ((x = Math.imul(x ^ x >>> 15, 1 | x) + 0x6D2B79F5 | 0) >>> 0) / 4294967296; };
for (const [key, file] of Object.entries(DATA_MANIFEST)) db.raw[key] = JSON.parse(readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8'));
db.buildIndexes(); db.isLoaded = true;
const report = { total: 80, completed: 0, deaths: [], errors: [], suspicious: [] };
for (const startAge of [0,10,13,16]) for (let seed = 1; seed <= 20; seed++) {
  const runId = `soak_${startAge}_${seed}`;
  Math.random = rnd(startAge * 100000 + seed);
  try {
    memory.clear();
    const s = createNewCharacter('class_3', 'loc_bangkok', seed % 2 ? 'female' : 'male', `ทดสอบ ${seed}`, { startAge });
    s.meta.runId = runId;
    initializeFirstYearTurn(s);
    let steps = 0, negatives = 0, taxes = 0, lastAge = -1;
    while (s.turn.phase !== 'ENDED' && s.profile.age <= 100 && steps++ < 2500) {
      const phase = s.turn.phase;
      if (phase === 'EVENT_QUEUE') {
        if (s.turn.awaitingEventAdvance) triggerPrimaryActionButton(s);
        else {
          const event = getCurrentPendingEvent(s);
          if (!event) continue;
          const choices = event.choices || [];
          if (!choices.length) throw new Error(`no choices: ${event.event_id}`);
          const choice = choices[Math.floor(Math.random() * choices.length)];
          const result = selectCurrentEventChoice(choice.choice_id, s);
          if (!result.success) {
            const alternative = choices.find(c => c.choice_id !== choice.choice_id && selectCurrentEventChoice(c.choice_id, s).success);
            if (!alternative) throw new Error(`no selectable choice: ${event.event_id}; ${result.message}`);
          }
        }
      } else if (phase === 'YEAR_SUMMARY' || phase === 'FREE_ACTION') {
        if (phase === 'FREE_ACTION' && s.profile.age >= 12) {
          if (s.profile.age >= 18 && !s.careerAndEdu.mainJobId) {
            const jobs = Object.values(getCategorizedJobsForUI(s)).flat().filter(j => !j.isLocked);
            const job = jobs.find(j => j.job_category === 'corporate') || jobs[0];
            if (job) applyForJob(s, job.job_id);
          }
          if (s.profile.age >= 16 && !s.relationships.partner && seed % 2 === 0) {
            const candidates = discoverPotentialPartners(s).candidates || [];
            const candidate = candidates.find(c => c.openToDating);
            if (candidate) startTalkingToPartner(s, candidate.candidateId);
          }
          const post = generateFeed(s).find(p => !p.suspicious);
          if (post) interactWithPost(s, post, `comment:${['kind','funny','support','mean'][seed % 4]}`);
          postPhoto(s, PHOTO_SCENES[seed % PHOTO_SCENES.length].id, ['inclusive','funny','brag','mean'][seed % 4]);
          for (const npc of (s.relationships?.npcs || []).slice(0, 3)) {
            const move = getMoves(s, npc).find(m => !m.locked);
            if (move) { try { performMove(s, npc.id, move.id); } catch {} }
          }
        }
        triggerPrimaryActionButton(s);
      } else if (phase === 'EMERGENCY_DEBT') {
        const options = s.turn.pendingEmergencyDebt?.availableOptions || [];
        const pick = options.find(o => o.optionType === 'apply_personal_bank_loan_if_eligible') || options.find(o => o.optionType === 'forced_informal_shark_loan_to_cover_deficit') || options[0];
        if (!pick) throw new Error('emergency debt has no options');
        const result = resolveEmergencyDebtAndContinue(pick.optionType, pick.assets?.[0] ? { instanceId: pick.assets[0].instanceId } : {}, s);
        if (!result.success) throw new Error(`debt option failed: ${result.message}`);
      } else throw new Error(`unknown phase ${phase}`);
      for (const key of ['health','happiness','intelligence','connections','appearance']) if (!Number.isFinite(s.stats[key]) || s.stats[key] < 0 || s.stats[key] > 100) throw new Error(`invalid stat ${key}=${s.stats[key]}`);
      if (!Number.isFinite(s.finance.cash)) throw new Error('invalid cash');
      if (s.profile.age !== lastAge) {
        if (s.finance.cash < 0) negatives++;
        taxes += Number(s.finance?.lastAnnualSlip?.expenseBreakdown?.tax || 0);
        lastAge = s.profile.age;
      }
    }
    if (s.turn.phase !== 'ENDED') throw new Error(`step limit/age reached: ${s.turn.phase}, age ${s.profile.age}`);
    report.completed++; report.deaths.push(s.profile.age);
    if (negatives > 40 || (taxes === 0 && s.profile.age >= 50)) report.suspicious.push({runId, negatives, taxes});
  } catch (error) { report.errors.push({runId, error: error.stack || String(error)}); }
}
Math.random = originalRandom;
report.averageDeathAge = report.deaths.length ? +(report.deaths.reduce((a,b)=>a+b,0)/report.deaths.length).toFixed(1) : null;
writeFileSync(new URL('../soak-report.json', import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total:report.total, completed:report.completed, averageDeathAge:report.averageDeathAge, errors:report.errors.length, suspicious:report.suspicious.length }));
if (report.errors.length) { console.error(report.errors.slice(0, 3)); process.exitCode = 1; }
