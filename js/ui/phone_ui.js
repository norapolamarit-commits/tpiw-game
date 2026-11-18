/**
 * js/ui/phone_ui.js
 * โทรศัพท์หลายแอป: โซเชียล (รูป + แคปชั่น) แชต กล้อง ข่าว กระเป๋าเงิน
 * เปิดเป็น Modal จึงหยุดนาฬิกาเกมระหว่างใช้งานโดยอัตโนมัติ
 */

import { saveGame } from '../core/state.js';
import { formatCurrency } from '../core/utils.js';
import {
  CAPTIONS, PHOTO_SCENES, SOCIAL_MIN_AGE, commentOptionsFor, ensureSocial, generateFeed, getNewsForAge, interactWithPost,
  isPhoneUnlocked, postPhoto, readNews, socialSummary
} from '../engine/social_media_engine.js';
import { getIdentity } from '../engine/gender_encounter_engine.js';
import { chatReply, ensureStoryCharacters, getChatOptions, getOthers, getThread, startChat } from '../engine/chat_dialogue_engine.js';
import { drawPhoto } from './pixel_photos.js';
import { escapeHtml, renderIcon } from './icons.js';
import { openModal, showToast } from './modals_ending_ui.js';

const APPS = [
  { id: 'social', label: 'ik', icon: 'heart', color: '#E8456B' },
  { id: 'chat', label: 'lane', icon: 'users', color: '#4EBF6A' },
  { id: 'camera', label: 'กล้อง', icon: 'sparkle', color: '#8A5BE8' },
  { id: 'news', label: 'ข่าวสาร', icon: 'file_text', color: '#4DA6FF' },
  { id: 'wallet', label: 'กระเป๋าเงิน', icon: 'wallet', color: '#FF8A1F' }
];

let app = 'home';
let commentingOn = null;
let cameraScene = 'friends';
let chatWith = null;

const authorHead = (name, handle, identity) => {
  const idn = getIdentity(identity);
  return `<div class="ph-head"><i class="ph-dot" style="background:${idn.color}"></i><div><strong>${escapeHtml(name)}</strong>${handle ? ` <span class="ph-handle">${escapeHtml(handle)}</span>` : ''}<div class="ph-id">${escapeHtml(idn.label)}</div></div></div>`;
};

function postHtml(state, post) {
  const a = ensureSocial(state).acted[post.id] || {};
  const head = authorHead(post.author.name, post.author.handle, post.author.identity);
  const photo = `<canvas class="ph-photo" data-photo="${post.kind}" data-seed="${Math.abs(post.likes) + 3}" aria-label="รูปโพสต์"></canvas>`;
  if (post.suspicious) {
    return `<div class="ph-post ph-post--warn">${head}${photo}<p class="ph-cap">${escapeHtml(post.text)}</p>
      ${a.handled ? '<p class="ph-done">จัดการแล้ว</p>' : `<p class="ph-warn">ข้อความนี้น่าสงสัย คนแปลกหน้าขอข้อมูลส่วนตัวและให้ปิดบังผู้ปกครอง</p>
      <div class="ph-actions"><button type="button" class="btn btn--primary btn--sm" data-ph-act="block" data-ph-post="${post.id}">บล็อกและรายงาน</button><button type="button" class="btn btn--outline btn--sm" data-ph-act="reply_suspicious" data-ph-post="${post.id}">ตอบกลับไป</button></div>`}</div>`;
  }
  const picker = commentingOn === post.id && !a.commented
    ? `<div class="ph-picker">${commentOptionsFor(state, post).map((o) => `<button type="button" class="btn btn--soft btn--sm btn--block" data-ph-act="comment:${o.id}" data-ph-post="${post.id}">${escapeHtml(o.labelTh)}</button>`).join('')}</div>` : '';
  return `<div class="ph-post">${head}${photo}
    <p class="ph-cap"><strong>${escapeHtml(post.author.name)}</strong> ${escapeHtml(post.text)}</p>
    <p class="ph-tags">${post.tags.map(escapeHtml).join(' ')}</p>
    ${post.punchline ? `<p class="ph-punch">ความเห็นเด่น: ${escapeHtml(post.punchline)}</p>` : ''}
    <div class="ph-actions">
      <button type="button" class="btn btn--outline btn--sm" data-ph-act="like" data-ph-post="${post.id}" ${a.liked || a.disliked ? 'disabled' : ''}>${a.liked ? 'ไลก์แล้ว' : `ไลก์ (${post.likes})`}</button>
      <button type="button" class="btn btn--outline btn--sm" data-ph-act="dislike" data-ph-post="${post.id}" ${a.liked || a.disliked ? 'disabled' : ''}>${a.disliked ? 'ไม่ชอบแล้ว' : 'ไม่ชอบ'}</button>
      <button type="button" class="btn btn--outline btn--sm" data-ph-open-comment="${post.id}" ${a.commented ? 'disabled' : ''}>${a.commented ? 'คอมเมนต์แล้ว' : 'คอมเมนต์'}</button>
      <button type="button" class="btn btn--outline btn--sm" data-ph-act="follow" data-ph-post="${post.id}" ${a.followed ? 'disabled' : ''}>${a.followed ? 'ติดตามแล้ว' : 'ติดตาม'}</button>
    </div>${picker}</div>`;
}

function chatContacts(state) {
  ensureStoryCharacters(state);
  return (state.relationships?.npcs || []).filter((n) => /^(online_|friend_|classmate_|story_)/.test(String(n.id))).sort((a, b) => (b.isStory ? 1 : 0) - (a.isStory ? 1 : 0));
}

function chatHtml(state) {
  if (chatWith) {
    const npc = chatContacts(state).find((c) => c.id === chatWith) || ensureSocial(state).others?.[chatWith] || getOthers(state).find((o) => o.id === chatWith) && { name: getOthers(state).find((o) => o.id === chatWith).name, genderIdentity: getOthers(state).find((o) => o.id === chatWith).identity, relationship: 36 };
    const t = getThread(state, chatWith);
    if (npc && t) {
      const opts = getChatOptions(state, chatWith);
      return `<div class="ph-chat">
        <div class="ph-chat-head">${authorHead(npc.name, '', npc.genderIdentity || 'woman')}<span class="ph-sum">${escapeHtml(t.title)} • ความสนิท ${Math.round(npc.relationship || 0)}%</span></div>
        <div class="ph-bubbles">${t.lines.map((l) => `<div class="ph-b ph-b--${l.from}">${escapeHtml(l.text)}</div>`).join('')}</div>
        ${t.finished
          ? `<div class="ph-post"><p class="ph-done">จบบทสนทนา ${t.delta > 0 ? `ความสนิท +${t.delta}` : t.delta < 0 ? `ความสนิท ${t.delta}` : 'ความสนิทเท่าเดิม'}</p><p class="ph-sum">${escapeHtml(t.summary || '')}</p><button type="button" class="btn btn--outline btn--sm" data-ph-chat-back>กลับไปรายชื่อ</button></div>`
          : `<div class="ph-picker">${opts.map((o) => `<button type="button" class="btn btn--soft btn--sm btn--block" data-ph-reply="${o.index}">${escapeHtml(o.label)}</button>`).join('')}</div>`}
      </div>`;
    }
  }
  const list = chatContacts(state);
  const age = Number(state.profile.age);
  const btnLabel = (id) => { const th = getThread(state, id); return th && th.age === age && th.finished ? 'ดูบทสนทนา' : th && th.age === age ? 'คุยต่อ' : 'เริ่มคุย'; };
  const friends = list.length ? list.map((c) => `<div class="ph-post">${authorHead(c.name, '', c.genderIdentity || 'woman')}
    <p class="ph-sum">${c.isStory ? '<span class="pill-badge pill-badge--navy">ตัวละครพิเศษ</span> ' : ''}${escapeHtml(c.roleTitle || 'เพื่อน')} • ความสนิท ${Math.round(c.relationship || 0)}%</p>
    <div class="ph-actions"><button type="button" class="btn btn--primary btn--sm" data-ph-chat="${escapeHtml(c.id)}">${btnLabel(c.id)}</button></div></div>`).join('')
    : '<p class="ph-empty">ยังไม่มีเพื่อนใน lane ลองสร้างเพื่อนจากเมืองพิกเซลหรือคนที่เดินมาทัก</p>';
  const others = getOthers(state).map((o) => `<div class="ph-post">${authorHead(o.name, o.handle, o.identity)}
    <p class="ph-sum">คนที่เพิ่งรู้จัก • ความคุ้นเคย ${Math.round(o.relationship)}%</p>
    <div class="ph-actions"><button type="button" class="btn btn--outline btn--sm" data-ph-chat="${escapeHtml(o.id)}">${btnLabel(o.id).replace('เริ่มคุย', 'ทักทายใน lane')}</button></div></div>`).join('');
  return `<h4 class="ph-sec">คุยกับเพื่อน (${list.length})</h4>${friends}<h4 class="ph-sec">คุยกับคนอื่น (${getOthers(state).length})</h4><p class="ph-sum">คนจากฟีดที่ยังไม่สนิท ระวังข้อมูลส่วนตัวเสมอ ใครขอเบอร์ ที่อยู่ หรือรูปบัตร ให้ปฏิเสธ</p>${others}`;
}

function cameraHtml(state) {
  const s = ensureSocial(state);
  const posted = s.postedAge === Number(state.profile.age);
  const last = s.lastPost && s.lastPost.age === Number(state.profile.age) ? s.lastPost : null;
  const preview = `<canvas class="ph-photo" data-photo="${cameraScene}" data-seed="5"></canvas>`;
  if (posted && last) {
    return `<div class="ph-post">${preview}<p class="ph-cap">${escapeHtml(last.caption)}</p><p class="ph-sum">ไลก์ ${last.likes}</p>
      ${last.reactions.map((x) => `<p class="ph-punch"><strong>${escapeHtml(x.name)}</strong> (${escapeHtml(getIdentity(x.identity).label)}): ${escapeHtml(x.text)}</p>`).join('')}
      <p class="ph-done">ปีนี้โพสต์แล้ว รอปีหน้านะ</p></div>`;
  }
  return `<div class="ph-post">${preview}
    <div class="ph-tabs">${PHOTO_SCENES.map((sc) => `<button type="button" class="subtab-pill ${cameraScene === sc.id ? 'is-active' : ''}" data-ph-scene="${sc.id}">${escapeHtml(sc.labelTh)}</button>`).join('')}</div>
    <p class="ph-sum">เลือกแคปชั่นเพื่อโพสต์ (ปีละ 1 ครั้ง)</p>
    <div class="ph-picker">${CAPTIONS.map((c) => `<button type="button" class="btn btn--soft btn--sm btn--block" data-ph-caption="${c.id}">${escapeHtml(c.labelTh)}</button>`).join('')}</div></div>`;
}

function newsHtml(state) {
  const s = ensureSocial(state);
  return getNewsForAge(state).map((n) => `<div class="ph-post"><p class="ph-cap"><strong>${escapeHtml(n.title)}</strong></p><p class="ph-punch">${escapeHtml(n.body)}</p>
    <div class="ph-actions"><button type="button" class="btn btn--outline btn--sm" data-ph-news="${n.id}" ${s.newsRead?.[n.id] ? 'disabled' : ''}>${s.newsRead?.[n.id] ? 'อ่านแล้ว' : 'อ่านจบ'}</button></div></div>`).join('');
}

function walletHtml(state) {
  const f = state.finance || {};
  let inv = 0; for (const v of Object.values(f.investments || {})) inv += Number(v?.amountCash || 0);
  const row = (k, v) => `<div class="slip-row"><span>${k}</span><strong>${escapeHtml(formatCurrency(v))}</strong></div>`;
  return `<div class="ph-post">${row('เงินสด', f.cash || 0)}${row('กระปุกออมสิน', f.piggyBank || 0)}${row('พอร์ตลงทุน', inv)}${row('ทรัพย์สินสุทธิ', f.netWorth || 0)}<p class="ph-sum">ดูอย่างเดียว ซื้อขายลงทุนที่แท็บสินทรัพย์</p></div>`;
}

function homeHtml(state) {
  const sum = socialSummary(state);
  return `<p class="ph-sum">เพื่อนออนไลน์ ${sum.contacts} คน จาก ${sum.groups} กลุ่มเพศ • คอมเมนต์ใจดี ${sum.kind} ครั้ง</p>
    <div class="ph-grid">${APPS.map((a) => `<button type="button" class="ph-app" data-ph-app="${a.id}"><span class="ph-app-icon" style="background:${a.color}">${renderIcon(a.icon, 'svg-icon--lg')}</span><span>${escapeHtml(a.label)}</span></button>`).join('')}</div>`;
}

export function openPhoneModal(state, { onRefresh } = {}) {
  if (!isPhoneUnlocked(state)) {
    openModal(`<div class="ph"><h3>โทรศัพท์</h3><p class="ph-empty">ยังไม่ถึงวัยใช้โซเชียลมีเดีย ต้องอายุ ${SOCIAL_MIN_AGE} ปีขึ้นไป ตอนนี้ลองสร้างมิตรภาพกับเพื่อนร่วมห้องในเมืองพิกเซลก่อนนะ</p><button type="button" class="btn btn--block" data-close-modal>ตกลง</button></div>`);
    return;
  }
  app = 'home';
  const feed = generateFeed(state);
  const render = () => {
    const title = APPS.find((a) => a.id === app)?.label || 'โทรศัพท์';
    const body = { home: () => homeHtml(state), social: () => feed.map((p) => postHtml(state, p)).join(''), chat: () => chatHtml(state), camera: () => cameraHtml(state), news: () => newsHtml(state), wallet: () => walletHtml(state) }[app]();
    openModal(`<div class="ph">
      <div class="ph-top">${app === 'home' ? '<h3>โทรศัพท์</h3>' : `<button type="button" class="btn btn--soft btn--sm" data-ph-app="home">หน้าหลัก</button><h3>${escapeHtml(title)}</h3>`}<button type="button" class="btn btn--soft btn--sm" data-close-modal>ปิด</button></div>
      <div class="ph-list">${body}</div></div>`);
    const root = document.getElementById('modal-root');
    root.querySelectorAll('canvas[data-photo]').forEach((c) => drawPhoto(c, c.getAttribute('data-photo'), Number(c.getAttribute('data-seed')) || 1));
    const done = (res, ok = 'success') => { saveGame(state); showToast(res.message, res.success ? ok : 'error'); render(); onRefresh?.(); };
    root.querySelectorAll('[data-ph-app]').forEach((b) => b.addEventListener('click', () => { app = b.getAttribute('data-ph-app'); commentingOn = null; chatWith = null; render(); }));
    root.querySelectorAll('[data-ph-open-comment]').forEach((b) => b.addEventListener('click', () => { commentingOn = b.getAttribute('data-ph-open-comment'); render(); }));
    root.querySelectorAll('[data-ph-act]').forEach((b) => b.addEventListener('click', () => {
      const post = feed.find((p) => p.id === b.getAttribute('data-ph-post'));
      const res = interactWithPost(state, post, b.getAttribute('data-ph-act'));
      commentingOn = null;
      done(res, res.safe === false ? 'error' : 'success');
    }));
    root.querySelectorAll('[data-ph-chat]').forEach((b) => b.addEventListener('click', () => {
      const res = startChat(state, b.getAttribute('data-ph-chat'));
      if (!res.success) { showToast(res.message, 'error'); return; }
      chatWith = b.getAttribute('data-ph-chat'); saveGame(state); render();
    }));
    root.querySelectorAll('[data-ph-reply]').forEach((b) => b.addEventListener('click', () => {
      const res = chatReply(state, chatWith, Number(b.getAttribute('data-ph-reply')));
      saveGame(state);
      if (res.finished) { showToast(res.summary, res.delta < 0 ? 'error' : 'success'); onRefresh?.(); }
      render();
      root.querySelector?.('.ph-list') && document.querySelector('.ph-bubbles')?.lastElementChild?.scrollIntoView({ block: 'end' });
    }));
    root.querySelectorAll('[data-ph-chat-back]').forEach((b) => b.addEventListener('click', () => { chatWith = null; render(); }));
    root.querySelectorAll('[data-ph-scene]').forEach((b) => b.addEventListener('click', () => { cameraScene = b.getAttribute('data-ph-scene'); render(); }));
    root.querySelectorAll('[data-ph-caption]').forEach((b) => b.addEventListener('click', () => { const res = postPhoto(state, cameraScene, b.getAttribute('data-ph-caption')); done(res, res.tone === 'bad' ? 'error' : 'success'); }));
    root.querySelectorAll('[data-ph-news]').forEach((b) => b.addEventListener('click', () => done(readNews(state, b.getAttribute('data-ph-news')))));
  };
  render();
}
