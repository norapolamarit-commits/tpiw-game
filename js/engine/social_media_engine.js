/**
 * js/engine/social_media_engine.js
 * โทรศัพท์และโซเชียลมีเดีย: ส่องโพสต์ของคนหลากหลายเพศ ไลก์ คอมเมนต์ ติดตาม สร้างความสัมพันธ์ออนไลน์
 * พร้อมกลไกความปลอดภัย (คนแปลกหน้าขอข้อมูลส่วนตัว) และผลต่อดัชนีความเท่าเทียมของเมือง
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { applyStatEffects } from '../core/stat_engine.js';
import { IDENTITIES, KID_IDENTITY_IDS, ensureEquality, getIdentity, hashString, mulberry32 } from './gender_encounter_engine.js';
import { newIdentityFor, queueConsequence } from './social_consequence_engine.js';

export const SOCIAL_MIN_AGE = 12;
export const ONLINE_BOND_THRESHOLD = 16;
export const FEED_SIZE = 8;

const NICKS = ['มะลิ', 'ต้นกล้า', 'พี่แมว', 'ซานตา', 'เจ้าบุญ', 'น้ำผึ้ง', 'ปุยฝ้าย', 'โอเลี้ยง', 'กัปตันมี่', 'ใบหม่อน', 'ข้าวโพด', 'ฟ้าใส', 'หมูหิน', 'ลูกพีช', 'ไอติม', 'ดาวเหนือ', 'บัวลอย', 'มังคุด', 'แพนด้า', 'ชานม'];

// [แคปชั่น, มุกตอบ, ฉากภาพ, แฮชแท็ก]
const TOPICS = [
  ['แมวที่บ้านเพิ่งรู้ตัวว่าเป็นเจ้าของบ้าน ตอนนี้ทุกคนต้องเรียกท่านว่าองค์ชาย', 'แมวหรือคนเป็นเจ้าของบ้านกันแน่', 'cat', ['#องค์ชายแมว', '#ทาสแมว']],
  ['ทอดไข่ดาวสิบฟอง ไม่มีฟองไหนเป็นวงกลม ถือว่าเป็นงานศิลปะนามธรรม', 'ไข่ก็มีเอกลักษณ์ของตัวเอง', 'food', ['#ไข่ดาว', '#ศิลปะนามธรรม']],
  ['แพ้เกมติดกันห้ารอบ แต่ยังเชื่อว่านิ้วตัวเองมีพรสวรรค์ระดับชาติ', 'นิ้วบอกว่าขอพักหน่อย', 'game', ['#แพ้ไม่เป็นไร', '#เกมเมอร์']],
  ['ติวสอบคืนก่อนสอบ ตื่นมาพบรอยสมุดโน้ตพิมพ์ติดแก้ม', 'ความรู้ซึมเข้าทางผิวหนังได้จริงไหมนะ', 'study', ['#ติวหนัก', '#สอบ']],
  ['วิ่งรอบสนามได้สามรอบ ขาขอลาออกจากร่างกายแล้ว', 'ขาส่งใบลาป่วยมาแล้ว', 'run', ['#วิ่ง', '#ขาไม่ไหว']],
  ['วาดรูปเพื่อนเสร็จ เพื่อนบอกว่าเหมือนมันฝรั่ง ฉันบอกว่ามันฝรั่งคือคนที่หล่อที่สุดในสวน', 'ขอบคุณมันฝรั่งที่ทำให้โลกอร่อยขึ้น', 'art', ['#วาดรูป', '#มันฝรั่ง']],
  ['ซ้อมกีตาร์มาทั้งเดือน ตอนนี้เล่นได้หนึ่งคอร์ดแบบมั่นใจมาก', 'หนึ่งคอร์ดก็คือเพลงแล้ว', 'guitar', ['#กีตาร์', '#หนึ่งคอร์ดพอ']],
  ['ไปเที่ยวทะเลแล้วโดนปูหนีบ ปูไม่ผิด มันแค่ตกใจที่เจอฉัน', 'ปูเองก็คงฝันร้ายไปหลายวัน', 'sea', ['#ทะเล', '#ปูเกรียน']],
  ['ใครอยากเป็นเพื่อนคุยเรื่องการ์ตูน ไม่ว่าเพศไหนก็ได้ เตรียมขนมไว้แล้ว', 'เข้าไปคุยเลย อย่าเกรงใจขนม', 'friends', ['#เพื่อนใหม่', '#การ์ตูน']]
];
const PRIDE_TOPIC = ['วันนี้ใส่ชุดที่ชอบไปเรียนแล้วรู้สึกเป็นตัวเองที่สุดเลย ใครมีสีโปรดยกมือขึ้น', 'ยินดีด้วยที่ได้เป็นตัวเอง สีโปรดของฉันก็คือสีทุกสี', 'pride', ['#เป็นตัวเอง', '#สีทุกสี']];
const SUSPICIOUS_TEXT = 'ใจดีจัง รูปน่ารักมากเลย ขอเบอร์กับที่อยู่หน่อยนะ เดี๋ยวส่งของขวัญไปให้ที่บ้าน ไม่ต้องบอกพ่อแม่นะ';

export const COMMENT_OPTIONS = [
  { id: 'kind', labelTh: 'ใจดี: ชอบเรื่องนี้มากเลย เล่าต่ออีกนะ', rel: 10, idx: 2, effects: { happiness: 1, connections: 1 }, replyTh: 'เจ้าของโพสต์ตอบกลับว่า "ขอบคุณมาก ยิ้มทั้งวันเลย"' },
  { id: 'funny', labelTh: 'ขำ: อ่านแล้วหัวเราะจนคนข้างๆ หันมา', rel: 8, idx: 1, effects: { happiness: 2 }, replyTh: 'เจ้าของโพสต์ตอบว่า "ฮ่าๆ มุกนี้ขอเอาไปใช้ต่อ"' },
  { id: 'support', labelTh: 'กำลังใจ: ค่อยๆ ไปนะ เราเชียร์อยู่', rel: 9, idx: 2, effects: { merit: 1, connections: 1 }, replyTh: 'เจ้าของโพสต์ตอบว่า "ขอบคุณที่เข้าใจนะ"' },
  { id: 'mean', labelTh: 'ปากร้าย: เรื่องแค่นี้ยังทำไม่ได้อีกเหรอ', rel: -12, idx: -4, effects: { merit: -2, happiness: -1 }, replyTh: 'เจ้าของโพสต์ลบคอมเมนต์ แล้วบล็อกคุณ เครือข่ายของคุณเงียบลงไปหนึ่งช่วง' }
];

const TOPIC_REPLIES = {
  cat: ['เจ้าแมวดูมีอำนาจจริง บ้านนี้ใครจ่ายค่าเช่ากันนะ', 'ท่านแมวคงกำลังประชุมคณะรัฐมนตรีบนโซฟา'],
  food: ['ไข่ดาวแต่ละฟองมีลายเซ็นของตัวเองเลย', 'นี่คือแกลเลอรีที่กินได้ใช่ไหม'],
  game: ['แพ้ห้ารอบแล้วยังกลับมาเล่นต่อ ใจสู้มาก', 'นิ้วขอวันลาพักร้อนแล้วหรือยัง'],
  study: ['อ่านหนักขนาดนี้ พักสายตาบ้างนะ', 'สมุดโน้ตแอบย้ายไปอยู่บนแก้มแล้ว'],
  run: ['วิ่งครบสามรอบเก่งแล้ว พักน้ำด้วยนะ', 'ขาส่งจดหมายลาออกแต่ใจยังไม่เซ็น'],
  art: ['ภาพนี้มีเสน่ห์มาก ชอบลายเส้นนะ', 'มันฝรั่งในภาพดูมีความฝันใหญ่โต'],
  guitar: ['หนึ่งคอร์ดที่มั่นใจก็เป็นจุดเริ่มต้นที่ดี', 'คอร์ดแรกคงอยากมีแฟนคลับแล้ว'],
  sea: ['วิวทะเลสวยมาก หวังว่าปูจะปลอดภัย', 'ปูคงคิดว่าเจอแขกผู้มีเกียรติ'],
  friends: ['คุยการ์ตูนด้วยได้ไหม เราชอบเหมือนกัน', 'ขนมรอการประชุมชมรมการ์ตูนแล้ว'],
  pride: ['ดีใจที่ได้เห็นเธอเป็นตัวเองนะ', 'สีโปรดวันนี้ดูมั่นใจมากเลย']
};

export function commentOptionsFor(state, post) {
  const topic = TOPIC_REPLIES[post?.kind];
  const age = Number(state.profile?.age || 0);
  const rep = Number(state.social?.commentsKind || 0) - Number(state.social?.commentsMean || 0) * 2;
  return COMMENT_OPTIONS.map((option) => {
    let spoken = option.labelTh.split(': ').slice(1).join(': ');
    if (topic && option.id === 'kind') spoken = topic[0];
    if (topic && option.id === 'funny') spoken = topic[1];
    if (option.id === 'support' && age < 16) spoken = 'สู้ๆ นะ เราเชียร์อยู่';
    if (option.id === 'support' && rep >= 5) spoken = 'เราอยู่ข้างๆ ถ้าอยากเล่าเพิ่ม';
    return { ...option, labelTh: `${option.labelTh.split(':')[0]}: ${spoken}`, spokenTh: spoken };
  });
}

const DM_REPLIES = ['ส่งสติกเกอร์แมวมาหนึ่งชุด พร้อมข้อความว่า "วันนี้เป็นไงบ้าง"', 'ส่งรูปขนมที่เพิ่งทำ ถามว่าอยากชิมไหม (ในจินตนาการ)', 'เล่าว่าเพิ่งแพ้เกมมา แต่ยังสู้ต่อ ขอให้ช่วยเชียร์หน่อย', 'ชวนคุยเรื่องการ์ตูนที่ชอบ ยาวไปสามหน้าจอ', 'ถามว่าสัปดาห์นี้มีเรื่องอะไรขำๆ ไหม แล้วเล่าเรื่องของตัวเองกลับมาให้ฟัง'];

export function ensureSocial(state) {
  state.social ||= {};
  const s = state.social;
  s.acted ||= {};
  s.blocked ||= [];
  s.dmAge ||= {};
  s.relations ||= {};
  for (const k of ['scams', 'commentsKind', 'commentsMean']) if (!Number.isFinite(s[k])) s[k] = 0;
  return s;
}

export function playerIdentity(state) {
  const id = state.profile?.genderIdentity;
  if (id && IDENTITIES.some((i) => i.id === id)) return id;
  return state.profile?.gender === 'female' ? 'woman' : 'man';
}

export function isPhoneUnlocked(state) { return Number(state.profile?.age || 0) >= SOCIAL_MIN_AGE; }

/** ฟีดประจำปี: อัตลักษณ์หลากหลาย เน้นผู้ใช้ที่เป็นเพศอื่นจากผู้เล่นอย่างน้อย 60% */
export function generateFeed(state) {
  const age = Number(state.profile?.age || 0);
  const rnd = mulberry32(hashString(`${state.meta?.runId || 'x'}|feed|${age}`));
  const pool = age < 13 ? KID_IDENTITY_IDS : IDENTITIES.map((i) => i.id);
  const own = playerIdentity(state);
  const others = pool.filter((i) => i !== own);
  const posts = [];
  for (let i = 0; i < FEED_SIZE; i++) {
    const identity = rnd() < 0.62 ? others[Math.floor(rnd() * others.length)] : pool[Math.floor(rnd() * pool.length)];
    const nick = NICKS[Math.floor(rnd() * NICKS.length)];
    const suspicious = i === 5 && rnd() < 0.7;
    const topic = suspicious ? null : (age >= 13 && i === 6 && ['trans_woman', 'trans_man', 'nonbinary', 'genderfluid', 'gay_man', 'lesbian', 'bisexual'].includes(identity) ? PRIDE_TOPIC : TOPICS[Math.floor(rnd() * TOPICS.length)]);
    posts.push({
      id: `post_${age}_${i}`,
      author: { id: `u_${age}_${i}`, name: nick, handle: `@${nick}${10 + Math.floor(rnd() * 89)}`, identity },
      text: suspicious ? SUSPICIOUS_TEXT : topic[0],
      punchline: suspicious ? '' : topic[1],
      kind: suspicious ? 'mystery' : topic[2],
      tags: suspicious ? [] : topic[3],
      suspicious,
      likes: 3 + Math.floor(rnd() * 120)
    });
  }
  return posts;
}

export function getContacts(state) {
  return (state.relationships?.npcs || []).filter((n) => String(n.id).startsWith('online_'));
}

function addOnlineFriend(state, author) {
  const id = `online_${author.id}`;
  state.relationships ||= {};
  state.relationships.npcs ||= [];
  if (state.relationships.npcs.some((n) => n.id === id)) return null;
  const friend = {
    id, archetypeId: 'npc_arch_random_friend', name: author.name, fullName: author.name, shortName: author.name,
    roleTitle: 'เพื่อนออนไลน์', genderIdentity: author.identity, identityShared: true,
    relationship: 48, isAlive: true, metAtAge: Number(state.profile?.age || 0)
  };
  state.relationships.npcs.push(friend);
  return friend;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * action: 'like' | 'follow' | 'comment:<optionId>' | 'block' | 'reply_suspicious'
 */
export function interactWithPost(state, post, action) {
  if (!isPhoneUnlocked(state)) return { success: false, message: `ต้องมีอายุ ${SOCIAL_MIN_AGE} ปีขึ้นไปถึงจะใช้โซเชียลมีเดียได้` };
  const s = ensureSocial(state);
  const eq = ensureEquality(state);
  const done = (s.acted[post.id] ||= {});
  const rel = (v) => { s.relations[post.author.id] = clamp((s.relations[post.author.id] || 0) + v, -100, 100); };

  if (post.suspicious) {
    if (done.handled) return { success: false, message: 'คุณจัดการโพสต์นี้ไปแล้ว' };
    done.handled = true;
    if (action === 'block') {
      s.blocked.push(post.author.id);
      applyStatEffects(state, { merit: 1 });
      queueConsequence(state, { type: 'safe_praise' });
      return { success: true, safe: true, message: 'บล็อกและรายงานบัญชีนี้แล้ว คุณปลอดภัยและทำถูกต้อง คนแปลกหน้าที่ขอข้อมูลส่วนตัวไม่ควรได้รับคำตอบ' };
    }
    s.scams += 1;
    queueConsequence(state, { type: 'scam_followup' });
    applyStatEffects(state, { happiness: -3 });
    return { success: true, safe: false, message: 'คุณตอบไปแล้วและรู้สึกไม่สบายใจ ครั้งหน้าควรบล็อกและบอกผู้ใหญ่ที่ไว้ใจ อย่าให้เบอร์หรือที่อยู่กับคนแปลกหน้า' };
  }

  let message; let delta = 0;
  if (action === 'dislike') {
    if (done.disliked) return { success: false, message: 'คุณกดไม่ชอบโพสต์นี้ไปแล้ว' };
    if (done.liked) return { success: false, message: 'คุณกดไลก์โพสต์นี้ไปแล้ว เปลี่ยนใจไม่ได้นะ' };
    done.disliked = true; rel(-4); delta = -4;
    s.dislikes = (s.dislikes || 0) + 1;
    if (post.kind === 'pride') { s.prideDislikes = (s.prideDislikes || 0) + 1; eq.townIndex = clamp(eq.townIndex - 1, 0, 100); message = 'กดไม่ชอบโพสต์ที่เจ้าของโพสต์ภูมิใจในตัวตนของเขา คนอื่นเห็นแล้วรู้สึกไม่ดีนัก'; }
    else message = 'กดไม่ชอบแล้ว เจ้าของโพสต์ไม่เห็นชื่อคุณ แต่ความคุ้นเคยลดลงเล็กน้อย';
  } else if (action === 'like') {
    if (done.disliked) return { success: false, message: 'คุณกดไม่ชอบโพสต์นี้ไปแล้ว' };
    if (done.liked) return { success: false, message: 'คุณกดไลก์โพสต์นี้ไปแล้ว' };
    done.liked = true; rel(3); delta = 3; message = 'กดไลก์แล้ว เจ้าของโพสต์เห็นชื่อคุณ';
  } else if (action === 'follow') {
    if (done.followed) return { success: false, message: 'คุณติดตามคนนี้อยู่แล้ว' };
    done.followed = true; rel(5); delta = 5; message = `ติดตาม ${post.author.name} แล้ว`;
  } else if (action.startsWith('comment:')) {
    if (done.commented) return { success: false, message: 'คุณคอมเมนต์โพสต์นี้ไปแล้ว' };
    const opt = COMMENT_OPTIONS.find((o) => o.id === action.slice(8));
    if (!opt) return { success: false, message: 'ไม่พบตัวเลือกคอมเมนต์' };
    done.commented = true; rel(opt.rel); delta = opt.rel;
    eq.townIndex = clamp(eq.townIndex + opt.idx, 0, 100);
    applyStatEffects(state, opt.effects);
    if (opt.id === 'mean') { s.commentsMean += 1; queueConsequence(state, { type: 'backlash', name: post.author.name, identity: post.author.identity }); } else s.commentsKind += 1;
    message = `${commentOptionsFor(state, post).find((x) => x.id === opt.id).spokenTh} • ${opt.replyTh}`;
  } else return { success: false, message: 'คำสั่งไม่ถูกต้อง' };

  let friend = null;
  if (s.relations[post.author.id] >= ONLINE_BOND_THRESHOLD) {
    friend = addOnlineFriend(state, post.author);
    if (friend) {
      const identity2 = newIdentityFor(state, `${post.author.id}|intro`, post.author.identity);
      queueConsequence(state, { type: 'friend_intro', name: post.author.name, name2: NICKS[hashString(post.author.id) % NICKS.length], identity: post.author.identity, identity2 });
    }
  }
  state.turn?.lifeFeedLog?.push({ age: Number(state.profile.age || 0), monthTh: 'ตลอดปี', type: 'social', title: `โซเชียล: ${post.author.name}`, message });
  return { success: true, message: friend ? `${message} • ${post.author.name} เป็นเพื่อนออนไลน์ของคุณแล้ว` : message, newFriend: friend, delta };
}

export function sendDirectMessage(state, contactId) {
  const s = ensureSocial(state);
  const age = Number(state.profile?.age || 0);
  const npc = (state.relationships?.npcs || []).find((n) => n.id === contactId);
  if (!npc) return { success: false, message: 'ไม่พบผู้ติดต่อนี้' };
  if (s.dmAge[contactId] === age) return { success: false, message: 'ปีนี้คุณคุยกับเพื่อนคนนี้ไปแล้ว' };
  s.dmAge[contactId] = age;
  npc.relationship = clamp(Number(npc.relationship || 0) + 6, 0, 100);
  applyStatEffects(state, { happiness: 1, connections: 1 });
  const reply = DM_REPLIES[hashString(`${contactId}${age}`) % DM_REPLIES.length];
  return { success: true, message: `${npc.name} ${reply}`, relationship: npc.relationship };
}

export function socialSummary(state) {
  const s = ensureSocial(state);
  const contacts = getContacts(state);
  return { contacts: contacts.length, groups: new Set(contacts.map((c) => c.genderIdentity)).size, kind: s.commentsKind, mean: s.commentsMean, scams: s.scams, label: (id) => getIdentity(id).label };
}

// ---------- กล้อง: โพสต์รูปของตัวเองพร้อมแคปชั่น ----------
export const PHOTO_SCENES = [
  { id: 'friends', labelTh: 'ถ่ายรูปกลุ่มเพื่อน' },
  { id: 'food', labelTh: 'ถ่ายอาหารจานโปรด' },
  { id: 'selfie', labelTh: 'เซลฟี่หน้าตาจริงจัง' },
  { id: 'sea', labelTh: 'ถ่ายวิวทะเล' }
];

export const CAPTIONS = [
  { id: 'inclusive', labelTh: 'ถ่ายกับเพื่อนทุกคน ไม่ว่าเพศไหนก็นั่งโต๊ะเดียวกันได้ ขนมแบ่งกันกิน', idx: 3, effects: { connections: 2, happiness: 1 }, tone: 'good' },
  { id: 'funny', labelTh: 'ถ่ายมาสิบรูป เหลือรูปเดียวที่ไม่หลับตา ถือว่าสำเร็จ', idx: 1, effects: { happiness: 2, connections: 1 }, tone: 'good' },
  { id: 'brag', labelTh: 'ฉันเท่ที่สุดในโลก ใครไม่เห็นด้วยไปเรียนใหม่', idx: -1, effects: { happiness: 1, connections: -1 }, tone: 'meh' },
  { id: 'mean', labelTh: 'ล้อเพื่อนที่ถ่ายรูปไม่ขึ้นแล้วติดแฮชแท็กขำๆ', idx: -3, effects: { merit: -2, connections: -1 }, tone: 'bad' }
];

const REACTION_TEXT = {
  good: ['รูปน่ารักมากเลย', 'ขำจนต้องกดไลก์สองรอบ', 'อยากไปนั่งโต๊ะนั้นด้วยคน', 'แคปชั่นนี้ดีจริงๆ'],
  meh: ['ก็... เท่ดีนะ (กดไลก์แบบเกรงใจ)', 'ความมั่นใจล้นจอมาก'],
  bad: ['แคปชั่นนี้ไม่ตลกนะ ลองลบดีไหม', 'เพื่อนในรูปคงรู้สึกไม่ดี', 'รายงานโพสต์แล้ว ขอบคุณที่อ่าน']
};

export function postPhoto(state, sceneId, captionId) {
  if (!isPhoneUnlocked(state)) return { success: false, message: `ต้องมีอายุ ${SOCIAL_MIN_AGE} ปีขึ้นไป` };
  const s = ensureSocial(state);
  const age = Number(state.profile?.age || 0);
  if (s.postedAge === age) return { success: false, message: 'ปีนี้คุณโพสต์รูปไปแล้ว รอปีหน้านะ' };
  const scene = PHOTO_SCENES.find((x) => x.id === sceneId);
  const cap = CAPTIONS.find((x) => x.id === captionId);
  if (!scene || !cap) return { success: false, message: 'เลือกรูปและแคปชั่นก่อน' };
  s.postedAge = age;
  if (cap.tone === 'good' && cap.id === 'inclusive') { s.goodPosts = (s.goodPosts || 0) + 1; queueConsequence(state, { type: 'post_viral' }); }
  else if (cap.tone === 'bad') { s.badPosts = (s.badPosts || 0) + 1; queueConsequence(state, { type: 'post_backlash' }); }
  else if (cap.tone === 'good') s.goodPosts = (s.goodPosts || 0) + 1;
  const eq = ensureEquality(state);
  eq.townIndex = clamp(eq.townIndex + cap.idx, 0, 100);
  applyStatEffects(state, cap.effects);
  const feed = generateFeed(state);
  const lines = REACTION_TEXT[cap.tone];
  const reactions = feed.filter((p) => !p.suspicious).slice(0, 3).map((p, i) => ({ name: p.author.name, identity: p.author.identity, text: lines[(hashString(p.id) + i) % lines.length] }));
  s.lastPost = { age, scene: scene.id, caption: cap.labelTh, reactions, likes: Math.max(2, 12 + Number(state.stats?.connections || 0) + (cap.tone === 'good' ? 25 : cap.tone === 'bad' ? -8 : 0)) };
  state.turn?.lifeFeedLog?.push({ age, monthTh: 'ตลอดปี', type: 'social', title: 'โพสต์รูปลงโซเชียล', message: cap.labelTh });
  return { success: true, post: s.lastPost, tone: cap.tone, message: cap.tone === 'bad' ? 'โพสต์นี้ถูกวิจารณ์ ลองคิดก่อนโพสต์ครั้งหน้านะ' : 'โพสต์สำเร็จ มีคนเข้ามาคอมเมนต์แล้ว' };
}

// ---------- ข่าวสาร ----------
const NEWS = [
  ['โรงเรียนเปิดให้นักเรียนเลือกเครื่องแต่งกายตามตัวตน', 'ผู้อำนวยการบอกว่า "ใส่สบายใจ เรียนก็เก่งขึ้น" ส่วนไม้บรรทัดวัดชายกระโปรงถูกย้ายไปเป็นเครื่องมือวาดเส้น'],
  ['ผลสำรวจ: ทีมที่มีหลายเพศทำงานสร้างสรรค์ขึ้น', 'นักวิจัยพบว่ามุมมองหลากหลายช่วยให้คิดนอกกรอบ ซึ่งไม่เกี่ยวกับกล่องนอกกรอบแต่อย่างใด'],
  ['คุณลุงแจกส้มตำให้ทุกคนที่ในงานวัด ไม่ถามว่าใครเป็นใคร', 'ชาวบ้านชื่นชมว่า "ส้มตำเป็นของทุกคน" และขอเพิ่มปลาร้าอีกหนึ่งช้อน'],
  ['นักวิ่งผู้หญิงทำลายสถิติระดับประเทศ แต่ถูกถามว่า "วิ่งไปทำไม"', 'เธอตอบว่า "เพราะอยากเร็วกว่าคำถามนี้" ผู้ชมปรบมือยาวสามนาที'],
  ['พ่อเลี้ยงเดี่ยวแชร์เคล็ดลับผูกผมลูกสาวจนกลายเป็นไวรัล', 'วิดีโอมีผู้ชมสองล้านครั้ง ผมของลูกสาวยังคงสวยกว่าผมของผู้ชม'],
  ['แอปแชตเพิ่มระบบรายงานการล้อเลียนเรื่องเพศ', 'ผู้ใช้ส่งรายงานจริงจังกว่าส่งสติกเกอร์ ซึ่งนับว่าเป็นก้าวสำคัญของอินเทอร์เน็ต'],
  ['สถานีตำรวจอบรมให้เจ้าหน้าที่รับแจ้งเหตุโดยไม่ถามว่า "แต่งตัวแบบไหน"', 'คู่มือฉบับใหม่ระบุว่า "คำถามนี้ผิดทุกครั้ง" ขีดเส้นใต้สามเส้น'],
  ['ห้องน้ำสาธารณะแบบเดี่ยวเปิดใช้ ทุกคนใช้ได้อย่างปลอดภัย', 'ประตูมีกลอนเดียวและไม่มีใครต้องถามคำถามกับใคร ระบบนี้มีชื่อว่า "ความสุภาพ"']
];

export function getNewsForAge(state) {
  const age = Number(state.profile?.age || 0);
  const rnd = mulberry32(hashString(`${state.meta?.runId || 'x'}|news|${age}`));
  const idx = NEWS.map((_, i) => i).sort(() => rnd() - 0.5).slice(0, 3);
  return idx.map((i) => ({ id: `news_${age}_${i}`, title: NEWS[i][0], body: NEWS[i][1] }));
}

export function readNews(state, id) {
  const s = ensureSocial(state);
  s.newsRead ||= {};
  if (s.newsRead[id]) return { success: false, message: 'คุณอ่านข่าวนี้ไปแล้ว' };
  s.newsRead[id] = true;
  applyStatEffects(state, { intelligence: 1 });
  return { success: true, message: 'อ่านข่าวจบ ได้ความรู้เพิ่มนิดหน่อย' };
}
