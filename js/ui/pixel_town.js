/**
 * js/ui/pixel_town.js
 * Minimap พิกเซลสไตล์ WorldBox: เมืองมีชีวิต NPC เดินไปมา กดเพื่อพบปะ
 */

import {
  CONTEXT_LABELS, IDENTITIES, TILE, buildEncounter, buildTownMap, ensureEquality, getIdentity, hasMet,
  resolveEncounter, spawnTownNpcs, summarizeEquality, walkable
} from '../engine/gender_encounter_engine.js';
import { castChatLine, castProgress, getCast, nextChapter, placeCast, resolveChapter, visibleCast } from '../engine/town_cast_engine.js';
import { requestAiDialogue, requestAiScenario } from '../engine/ai_content_client.js';
import { runEqualityCoaching } from '../engine/equality_ai_client.js';
import { getClockSpeed } from './game_clock.js';
import { runFollowUpDialogue } from './dialogue_ui.js';
import { saveGame } from '../core/state.js';
import { escapeHtml } from './icons.js';
import { closeModal, openModal, showToast } from './modals_ending_ui.js';

const PX = 16;
const VIEW_W = 24;
const VIEW_H = 15;
let cam = { x: 2, y: 10 };
const n2 = (x, y) => ((Math.imul(x * 73856093 ^ y * 19349663, 2654435761) >>> 0) % 100) / 100;

function drawTile(ctx, map, x, y, frame, townIndex) {
  const t = map.tiles[y][x];
  const px = (x - cam.x) * PX, py = (y - cam.y) * PX, r = n2(x, y), r2 = n2(y + 91, x + 17);
  const rect = (c, ox, oy, w, h) => { ctx.fillStyle = c; ctx.fillRect(px + ox, py + oy, w, h); };
  const base = (c) => rect(c, 0, 0, PX, PX);
  const at = (dx, dy) => map.tiles[y + dy]?.[x + dx];
  const grass = () => {
    base(r < 0.3 ? '#4E9A3F' : r < 0.65 ? '#58A548' : '#4A9140');
    if (r2 > 0.82) { rect('#69BD58', 3, 5, 2, 3); rect('#69BD58', 9, 10, 2, 2); }
    if (r < 0.05) rect('#3A7A32', 7, 3, 3, 2);
  };
  const above = at(0, -1);
  switch (t) {
    case TILE.DEEP:
      base(((x * 2 + y + frame) >> 2) % 2 ? '#2A5FA8' : '#2D66B0');
      if ((x + y * 2 + frame) % 9 === 0) rect('#4F86CC', 4, 7, 6, 1);
      break;
    case TILE.WATER:
      base(((x + y + frame) >> 1) % 2 ? '#4A98DC' : '#4F9EE2');
      if ((x * 3 + y + frame) % 7 === 0) rect('#9ACFF5', 3, 5, 6, 1);
      if (at(0, -1) === TILE.SAND || at(0, 1) === TILE.SAND || at(-1, 0) === TILE.SAND || at(1, 0) === TILE.SAND) rect('#E8F6FF', 0, 0, PX, 2);
      break;
    case TILE.SAND:
      base(r < 0.5 ? '#E8D08A' : '#E0C57C');
      if (r2 > 0.8) rect('#C9AE62', 4, 6, 2, 2);
      break;
    case TILE.ROAD: base(r < 0.5 ? '#C9B08A' : '#BEA47C'); if (r > 0.82) rect('#A38D66', 4, 5, 2, 2); if (r2 > 0.9) rect('#D8C6A4', 8, 9, 2, 1); break;
    case TILE.FARM:
      base('#8A5A33');
      for (let i = 0; i < PX; i += 4) rect(((i / 4) + y) % 2 ? '#5FB04A' : '#A06C3C', 0, i, PX, 3);
      if (r > 0.6) rect('#F2D04A', 5, 4, 2, 4);
      break;
    case TILE.PINK: base(r < 0.5 ? '#F2A6C6' : '#EC9BBE'); if (r2 > 0.7) rect('#FFD0E4', 4, 4, 3, 3); break;
    case TILE.DRY: base(r < 0.5 ? '#D9A441' : '#CE9838'); if (r2 > 0.6) rect('#F2C45A', 3, 3, 2, 6); if (r < 0.2) rect('#A87522', 8, 8, 3, 2); break;
    case TILE.FLOWER: grass(); rect('#F7A8C8', 4, 4, 3, 3); rect('#FFE27A', 5, 5, 1, 1); rect('#fff', 10, 9, 2, 2); break;
    case TILE.FENCE: grass(); rect('#6B5A45', 0, 5, PX, 2); rect('#4E4132', 2, 3, 2, 7); rect('#4E4132', 10, 3, 2, 7); break;
    case TILE.MOUNTAIN:
      base('#7A7468'); rect('#5E5950', 0, PX - 4, PX, 4); rect('#948D7E', 3, 2, 8, 5); rect('#B0A998', 5, 2, 4, 2);
      break;
    case TILE.SNOW: base('#EEF3F8'); rect('#C9D6E4', 0, PX - 4, PX, 4); rect('#FFFFFF', 3, 2, 8, 4); break;
    case TILE.TREE: {
      grass();
      const biome = townIndex >= 66 ? ['#E58AB3', '#F2A6C6', '#FFD0E4'] : townIndex <= 33 ? ['#C7771C', '#E8931F', '#F7B648'] : (r < 0.5 ? ['#2B7433', '#37893D', '#52AE55'] : ['#1F6A3C', '#2A8248', '#46A468']);
      rect('rgba(0,0,0,.2)', 3, 13, 10, 3);
      rect('#5B3A1E', 7, 9, 2, 6);
      if (r < 0.5) { rect(biome[0], 3, 2, 10, 9); rect(biome[1], 4, 1, 8, 7); rect(biome[2], 5, 2, 4, 3); }
      else { rect(biome[0], 5, 0, 6, 3); rect(biome[1], 4, 3, 8, 3); rect(biome[0], 3, 6, 10, 4); rect(biome[2], 6, 2, 2, 2); }
      break;
    }
    case TILE.HOUSE: case TILE.SCHOOL: case TILE.WORK: case TILE.MARKET: {
      grass();
      const roof = { [TILE.HOUSE]: ['#3F78C8', '#2B56A0', '#6FA2E6'], [TILE.SCHOOL]: ['#E8B730', '#B8891A', '#FFD968'], [TILE.WORK]: ['#8795AF', '#5F6D86', '#B3BED2'], [TILE.MARKET]: ['#E07A2F', '#B85A1A', '#FFAA66'] }[t];
      const wall = '#EAD9B4';
      const left = at(-1, 0) !== t, right = at(1, 0) !== t;
      if (above === t) {
        base(wall); rect('#C9B48A', 0, PX - 2, PX, 2);
        if (t === TILE.MARKET) { for (let i = 0; i < PX; i += 4) rect('#F5F0E6', i, 0, 2, 4); }
        else { rect('#8FC7F0', 3, 3, 4, 4); rect('#6B4423', 9, 5, 4, 11); }
      } else {
        rect(roof[0], 0, 2, PX, PX - 2); rect(roof[2], 0, 2, PX, 2); rect(roof[1], 0, PX - 4, PX, 4); rect('#4A2F18', 0, PX - 1, PX, 1);
        if (left) rect(roof[1], 0, 2, 2, PX - 2);
        if (right) rect(roof[1], PX - 2, 2, 2, PX - 2);
        if (t === TILE.MARKET) { for (let i = 0; i < PX; i += 4) rect('#F5F0E6', i, 2, 2, PX - 6); }
      }
      break;
    }
    default: grass();
  }
}

function drawBubble(ctx, cx, cy, mood) {
  const color = { happy: '#FFD84A', sad: '#9B6FD0', idle: '#C9CFD8' }[mood];
  ctx.fillStyle = '#5BA0E0'; ctx.fillRect(cx, cy - 12, 1, 8);
  ctx.fillStyle = '#1b1b1b'; ctx.fillRect(cx - 5, cy - 21, 11, 10);
  ctx.fillStyle = color; ctx.fillRect(cx - 4, cy - 20, 9, 8); ctx.fillRect(cx - 5, cy - 19, 11, 6);
  ctx.fillStyle = '#3a2a10';
  ctx.fillRect(cx - 2, cy - 18, 1, 2); ctx.fillRect(cx + 2, cy - 18, 1, 2);
  if (mood === 'happy') { ctx.fillRect(cx - 2, cy - 15, 5, 1); ctx.fillRect(cx - 1, cy - 14, 3, 1); }
  else if (mood === 'sad') { ctx.fillRect(cx - 2, cy - 14, 5, 1); }
  else ctx.fillRect(cx - 1, cy - 15, 3, 1);
}

function drawPerson(ctx, n, color, mood, met) {
  const cx = (n.x - cam.x) * PX + PX / 2, by = (n.y - cam.y) * PX + PX;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(cx - 4, by - 1, 9, 2);
  ctx.fillStyle = '#2b2b3a'; ctx.fillRect(cx - 2, by - 4, 2, 4); ctx.fillRect(cx + 1, by - 4, 2, 4);
  ctx.fillStyle = '#1b1b1b'; ctx.fillRect(cx - 4, by - 10, 9, 7);
  ctx.fillStyle = color; ctx.fillRect(cx - 3, by - 9, 7, 6);
  ctx.fillStyle = '#F0C9A0'; ctx.fillRect(cx - 2, by - 14, 5, 5);
  ctx.fillStyle = '#3a2a10'; ctx.fillRect(cx - 2, by - 14, 5, 2);
  drawBubble(ctx, cx, by - 14, met ? mood : 'idle');
}
let timer = null;

export function renderPixelTownCard(state, { compact = false } = {}) {
  const eq = ensureEquality(state);
  const sum = summarizeEquality(state);
  const legend = IDENTITIES.map((i) => `<span class="pt-legend-item"><i style="background:${i.color}"></i>${escapeHtml(i.label)}</span>`).join('');
  return `
    <div class="card pixel-town ${compact ? 'pixel-town--compact' : ''}">
      <div class="pt-head">
        <h3>เมืองพิกเซลแห่งความเท่าเทียม</h3>
        <span class="pill-badge pill-badge--navy">ดัชนี ${eq.townIndex}/100 • ${escapeHtml(sum.label)}</span>
      </div>
      <canvas class="pt-canvas" data-pt-canvas aria-label="แผนที่เมืองพิกเซล ลากเพื่อเลื่อน กดที่คนเพื่อพบปะ"></canvas>
      <p class="pt-hint">ลากเพื่อเลื่อนแผนที่ กดที่ชาวบ้านเพื่อพบปะ ปีนี้พบได้คนละ 1 ครั้ง</p>
      ${compact ? '' : `<div class="pt-legend">${legend}</div><div class="pt-people" data-pt-people></div>${renderCastList(state)}${renderCoach(state)}${renderSummary(sum)}`}
    </div>`;
}

function renderCastList(state) {
  const list = visibleCast(state);
  if (!list.length) return '';
  return `<div class="pt-cast"><h4 class="ph-sec">ชาวเมืองประจำ</h4><div class="pt-people">${list.map((c) => { const p = castProgress(state, c.id); return `<button type="button" class="pt-person" data-pt-cast="${c.id}"><i style="background:${c.color}"></i>${escapeHtml(c.name)} (${escapeHtml(p.label)}) ${p.done}/${p.total}${p.available ? ' !' : ''}</button>`; }).join('')}</div></div>`;
}

function renderCoach(state) {
  const eq = ensureEquality(state);
  const ai = eq.aiCoach;
  const local = eq.localAnalysis;
  const text = ai?.coachingTh || local?.coachingTh || 'พบปะผู้คนอย่างน้อย 3 คน แล้วกดปุ่มเพื่อให้โค้ชวิเคราะห์';
  const focus = ai?.focus || local?.focus;
  const chips = focus ? [...focus.identities.map((i) => getIdentity(i).label), ...focus.contexts.map((c) => CONTEXT_LABELS[c])] : [];
  return `<div class="pt-coach">
    <div class="pt-coach-head"><strong>โค้ชความเท่าเทียม</strong> <span class="pill-badge pill-badge--soft-blue">${ai ? 'วิเคราะห์โดย AI' : 'วิเคราะห์อัตโนมัติ'}</span></div>
    <p>${escapeHtml(text)}</p>
    ${chips.length ? `<p class="pt-hint">เหตุการณ์ในอนาคตจะเน้น: ${chips.map(escapeHtml).join(', ')}</p>` : ''}
    ${ai?.nextScenarioIdeaTh ? `<p class="pt-hint">ไอเดียสถานการณ์ต่อไป: ${escapeHtml(ai.nextScenarioIdeaTh)}</p>` : ''}
    <button type="button" class="btn btn--outline btn--sm" data-pt-coach>ให้โค้ชวิเคราะห์ใหม่</button>
    <button type="button" class="btn btn--outline btn--sm" data-pt-gen>สร้างสถานการณ์ใหม่ (${(eq.aiScenarios || []).length})</button>
  </div>`;
}

function renderSummary(sum) {
  if (!sum.total) return '<p class="pt-hint">ยังไม่มีการพบปะ ลองทักทายคนในเมืองดู</p>';
  const c = sum.counts;
  return `<div class="pt-summary"><strong>บทเรียนของคุณ</strong>
    <p>ปกป้อง ${c.defend} • เคารพ ${c.respect} • เมินเฉย ${c.ignore} • เหยียด ${c.disrespect}</p>
    ${sum.lessons.map((l) => `<p>- ${escapeHtml(l)}</p>`).join('')}</div>`;
}

export function bindPixelTown(container, state, { onRefresh } = {}) {
  const canvas = container.querySelector('[data-pt-canvas]');
  if (!canvas) return;
  if (timer) { clearInterval(timer); timer = null; }

  const map = buildTownMap(state);
  const npcs = spawnTownNpcs(state, map);
  const cast = placeCast(state, map);
  const ctx = canvas.getContext('2d');
  canvas.width = VIEW_W * PX;
  canvas.height = VIEW_H * PX;
  ctx.imageSmoothingEnabled = false;

  cam.x = Math.max(0, Math.min(map.w - VIEW_W, cam.x));
  cam.y = Math.max(0, Math.min(map.h - VIEW_H, cam.y));
  let frame = 0;
  const eq = ensureEquality(state);
  const draw = () => {
    for (let y = cam.y; y < cam.y + VIEW_H; y++) for (let x = cam.x; x < cam.x + VIEW_W; x++) drawTile(ctx, map, x, y, frame, eq.townIndex);
    const sorted = [...npcs, ...cast, { home: true, x: map.homeX, y: map.homeY }].sort((a, b) => a.y - b.y);
    for (const n of sorted) {
      if (n.home) {
        ctx.fillStyle = '#fff'; ctx.fillRect((n.x - cam.x) * PX + 7, (n.y - cam.y) * PX - 14, 2, 14);
        ctx.fillStyle = '#E8456B'; ctx.fillRect((n.x - cam.x) * PX + 9, (n.y - cam.y) * PX - 14, 9, 5);
        continue;
      }
      if (n.isCast) {
        drawPerson(ctx, n, n.color, 'happy', true);
        const cx = (n.x - cam.x) * PX + PX / 2, top = (n.y - cam.y) * PX - 38;
        ctx.font = 'bold 9px Prompt, Sarabun, sans-serif'; ctx.textAlign = 'center';
        ctx.lineWidth = 3; ctx.strokeStyle = '#1b1b1b'; ctx.strokeText(n.name, cx, top); ctx.fillStyle = '#FFE27A'; ctx.fillText(n.name, cx, top);
        if (nextChapter(state, n.castId)) { ctx.fillStyle = '#FF4B3A'; ctx.fillRect(cx + 9, top + 3, 3, 7); ctx.fillRect(cx + 9, top + 12, 3, 3); }
        continue;
      }
      const rel = eq.relations[n.id] || 0;
      drawPerson(ctx, n, getIdentity(n.identity).color, rel < 0 ? 'sad' : 'happy', hasMet(state, n.id));
    }
  };
  draw();

  const rnd = Math.random;
  const tick = () => {
    frame++;
    if (!canvas.isConnected) { clearInterval(timer); timer = null; return; }
    for (const n of npcs) {
      if (rnd() < 0.5) continue;
      const dx = Math.floor(rnd() * 3) - 1, dy = Math.floor(rnd() * 3) - 1;
      if (walkable(map, n.x + dx, n.y + dy) && !(dx === 0 && dy === 0)) { n.x += dx; n.y += dy; }
    }
    draw();
  };
  // ความเร็วชาวบ้านตามนาฬิกาเกมหลัก (หยุดเวลา = ชาวบ้านหยุดเดิน)
  let acc = 0;
  timer = setInterval(() => {
    if (!canvas.isConnected) { clearInterval(timer); timer = null; return; }
    acc += 100 * getClockSpeed();
    if (acc >= 400) { acc = 0; tick(); }
  }, 100);

  const openCast = (castId) => {
    const c = getCast(castId);
    const ch = nextChapter(state, castId);
    if (!ch) { showToast(`${c.name} (${c.role}): ${castChatLine(state, castId)}`, 'info'); return; }
    const prog = castProgress(state, castId);
    openModal(`<div class="gr"><div class="gr-tag"><i style="background:${c.color}"></i>${escapeHtml(c.name)} • ${escapeHtml(c.role)} • ตอนที่ ${prog.done + 1}/${prog.total}</div>
      <h3>${escapeHtml(ch.title)}</h3><p class="gr-intro">${escapeHtml(ch.text)}</p>
      <div class="list-stack">${ch.options.map((o, i) => `<button type="button" class="choice-btn" data-cast-opt="${i}"><div class="choice-label">${escapeHtml(o[0])}</div></button>`).join('')}</div>
      <button type="button" class="btn btn--soft btn--sm" data-close-modal>ไว้ก่อน</button></div>`);
    document.querySelectorAll('[data-cast-opt]').forEach((btn) => btn.addEventListener('click', () => {
      const res = resolveChapter(state, castId, Number(btn.getAttribute('data-cast-opt')));
      saveGame(state);
      openModal(`<div class="gr"><h3>${escapeHtml(c.name)}</h3><p class="gr-intro">${escapeHtml(res.message)}</p>
        ${res.success ? `<p class="pt-hint">ดัชนีความเท่าเทียมของเมือง ${res.indexBefore} เป็น ${res.indexAfter} • เรื่องราวของ${escapeHtml(c.name)} ${res.chaptersDone}/${res.total} ตอน</p>${res.friend ? `<p class="gr-intro">${escapeHtml(c.name)} กลายเป็นเพื่อนของคุณแล้ว</p>` : ''}` : ''}
        <button type="button" class="btn btn--primary btn--block" data-close-modal>ตกลง</button></div>`);
      onRefresh?.();
    }));
  };

  const openEncounter = (npc) => {
    if (hasMet(state, npc.id)) { showToast('ปีนี้คุณพบคนนี้ไปแล้ว', 'info'); return; }
    const enc = buildEncounter(state, npc);
    if (!enc) { showToast(`คุณทักทาย ${getIdentity(npc.identity).label} ตามปกติ วันนี้ไม่มีเรื่องพิเศษ`, 'info'); return; }
    openModal(`
      <div class="pt-modal">
        <h3>${escapeHtml(enc.title)}</h3>
        <p>${escapeHtml(enc.text)}</p>
        <div class="list-stack">${enc.choices.map((c) => `<button type="button" class="btn btn--outline btn--block" data-pt-tone="${c.tone}">${escapeHtml(c.label)}</button>`).join('')}</div>
      </div>`);
    document.querySelectorAll('[data-pt-tone]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tone = btn.getAttribute('data-pt-tone');
        const res = resolveEncounter(state, npc, tone);
        if (!res.success) { showToast(res.message, 'error'); closeModal(); return; }
        saveGame(state);
        const choice = enc.choices.find((c) => c.tone === tone);
        runFollowUpDialogue(state, {
          context: enc.context, relKey: npc.id, identity: npc.identity, firstTone: tone,
          lines: [{ from: 'them', text: `${enc.title}: ${enc.text}` }, { from: 'me', text: choice.label }],
          finalHtml: `<p class="gr-intro"><strong>ผลลัพธ์: ${escapeHtml(res.toneLabel)}</strong> ${escapeHtml(res.message)} (${res.indexBefore} เป็น ${res.indexAfter})</p><p class="gr-intro"><strong>ข้อคิด:</strong> ${escapeHtml(res.lesson)}</p>`,
          onDone: () => onRefresh?.()
        });
      });
    });
  };

  let drag = null;
  const clampCam = () => { cam.x = Math.max(0, Math.min(map.w - VIEW_W, cam.x)); cam.y = Math.max(0, Math.min(map.h - VIEW_H, cam.y)); };
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; canvas.setPointerCapture?.(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = canvas.getBoundingClientRect(), tw = r.width / VIEW_W;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 5) drag.moved = true;
    if (drag.moved) { cam.x = Math.round(drag.cx - dx / tw); cam.y = Math.round(drag.cy - dy / tw); clampCam(); draw(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    const d = drag; drag = null;
    if (!d || d.moved) return;
    const r = canvas.getBoundingClientRect();
    const tx = cam.x + ((e.clientX - r.left) / r.width) * VIEW_W, ty = cam.y + ((e.clientY - r.top) / r.height) * VIEW_H;
    let castBest = null, cbd = 2.6;
    for (const n of cast) { const d3 = Math.hypot(n.x + 0.5 - tx, n.y - 0.5 - ty); if (d3 < cbd) { cbd = d3; castBest = n; } }
    if (castBest) { openCast(castBest.castId); return; }
    let best = null, bd = 2.4;
    for (const n of npcs) { const d2 = Math.hypot(n.x + 0.5 - tx, n.y - 0.5 - ty); if (d2 < bd) { bd = d2; best = n; } }
    if (best) openEncounter(best);
  });

  container.querySelector('[data-pt-coach]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'กำลังวิเคราะห์...';
    const r = await runEqualityCoaching(state);
    saveGame(state);
    showToast(r.source === 'ai' ? 'AI วิเคราะห์เสร็จแล้ว' : 'วิเคราะห์ด้วยระบบอัตโนมัติ (ยังไม่ได้เชื่อมต่อ AI)', 'info');
    onRefresh?.();
  });

  container.querySelector('[data-pt-gen]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'กำลังสร้าง...';
    const sc = await requestAiScenario(state);
    await requestAiDialogue(state);
    saveGame(state);
    showToast(sc.source === 'ai' ? 'AI สร้างสถานการณ์ใหม่แล้ว' : 'สร้างสถานการณ์ใหม่ด้วยระบบอัตโนมัติ (ยังไม่ได้เชื่อมต่อ AI)', 'info');
    onRefresh?.();
  });

  container.querySelectorAll('[data-pt-cast]').forEach((b) => b.addEventListener('click', () => openCast(b.getAttribute('data-pt-cast'))));

  const people = container.querySelector('[data-pt-people]');
  if (people) {
    people.innerHTML = npcs.map((n) => `<button type="button" class="pt-person" data-pt-npc="${n.id}" ${hasMet(state, n.id) ? 'disabled' : ''}><i style="background:${getIdentity(n.identity).color}"></i>${escapeHtml(getIdentity(n.identity).label)}${hasMet(state, n.id) ? ' (พบแล้ว)' : ''}</button>`).join('');
    people.querySelectorAll('[data-pt-npc]').forEach((b) => b.addEventListener('click', () => openEncounter(npcs.find((n) => n.id === b.getAttribute('data-pt-npc')))));
  }
}
