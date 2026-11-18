/**
 * js/engine/gender_encounter_engine.js
 * เมืองพิกเซลแห่งความเท่าเทียม: ตัวตนหลากหลายเพศ, สุ่ม NPC ในเมือง, อีเวนต์พบปะ,
 * ดัชนีความเท่าเทียม และสร้างแผนที่จาก seed (ฟังก์ชันล้วน ไม่แตะ DOM)
 *
 * [UI Hygiene Rule]: ปราศจากตัวอักษร Emoji 100%
 */

import { applyStatEffects } from '../core/stat_engine.js';
import { COMEDY, COMEDY_CHOICES, COMEDY_LESSON_PREFIX, COMEDY_RESULTS } from './gender_encounter_comedy.js';

export const TOWN_W = 64;
export const TOWN_H = 40;

export const TILE = { GRASS: 0, WATER: 1, ROAD: 2, HOUSE: 3, SCHOOL: 4, WORK: 5, MARKET: 6, FLOWER: 7, FENCE: 8, TREE: 9, FARM: 10, DEEP: 11, SAND: 12, MOUNTAIN: 13, SNOW: 14, PINK: 15, DRY: 16 };

export const IDENTITIES = [
  { id: 'woman', label: 'Woman', color: '#F06292' },
  { id: 'man', label: 'Man', color: '#42A5F5' },
  { id: 'gay_man', label: 'Gay', color: '#26C6DA' },
  { id: 'lesbian', label: 'Lesbian', color: '#FF8A65' },
  { id: 'bisexual', label: 'Bisexual', color: '#AB47BC' },
  { id: 'trans_woman', label: 'Trans woman', color: '#F8BBD0' },
  { id: 'trans_man', label: 'Trans man', color: '#81D4FA' },
  { id: 'nonbinary', label: 'Non-binary', color: '#FDD835' },
  { id: 'genderfluid', label: 'Genderfluid', color: '#9CCC65' }
];

const IDENTITY_IDS = IDENTITIES.map((i) => i.id);
/** อัตลักษณ์ทางเพศที่ใช้กับเด็กเล็ก (ไม่ใช้ป้ายรสนิยมทางเพศกับเด็กก่อนวัยรุ่น) */
export const KID_IDENTITY_IDS = ['woman', 'man', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'];
export const getIdentity = (id) => IDENTITIES.find((i) => i.id === id) || IDENTITIES[0];

export const TONES = {
  defend: { label: 'ปกป้อง', delta: 6, effects: { merit: 3, happiness: 1, connections: 1 }, rel: 12 },
  respect: { label: 'เคารพ', delta: 4, effects: { merit: 1, happiness: 1 }, rel: 8 },
  ignore: { label: 'เมินเฉย', delta: -1, effects: {}, rel: 0 },
  disrespect: { label: 'เหยียด/ล้อเลียน', delta: -6, effects: { merit: -3, happiness: -1, connections: -1 }, rel: -12 }
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export function ensureEquality(state) {
  state.equality ||= {};
  const eq = state.equality;
  if (!Number.isFinite(eq.townIndex)) eq.townIndex = 50;
  if (!eq.relations || typeof eq.relations !== 'object') eq.relations = {};
  if (!Array.isArray(eq.metIds)) eq.metIds = [];
  if (!Array.isArray(eq.history)) eq.history = [];
  return eq;
}

const townSeed = (state) => hashString(`${state.meta?.runId || state.profile?.name || 'town'}|${state.profile?.currentLocationId || ''}`);

export function getAgeBand(age) {
  if (age < 6) return 'infant';
  if (age < 23) return 'school';
  if (age < 60) return 'work';
  return 'elder';
}

function contextsForAge(age) {
  const list = ['public', 'family'];
  if (age >= 6 && age <= 22) list.push('school');
  if (age >= 18 && age <= 64) list.push('work');
  return list;
}

/** value noise + fBm สำหรับสร้างภูมิประเทศแบบ WorldBox */
function makeNoise(seed) {
  const lattice = (ix, iy) => {
    let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seed) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  const value = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = smooth(x - xi), yf = smooth(y - yi);
    const a = lattice(xi, yi), b = lattice(xi + 1, yi), c = lattice(xi, yi + 1), d = lattice(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
  };
  return (x, y) => (value(x / 13, y / 13) * 0.55 + value(x / 6, y / 6) * 0.3 + value(x / 3, y / 3) * 0.15);
}

const LAND = new Set([TILE.GRASS, TILE.TREE, TILE.SAND, TILE.FLOWER, TILE.PINK, TILE.DRY]);

/** แผนที่เมืองจาก seed + ช่วงวัย + ดัชนีความเท่าเทียม: ทวีปมีทะเล ทราย ป่า ภูเขา หมู่บ้าน ถนนดิน ไร่นา */
export function buildTownMap(state) {
  const eq = ensureEquality(state);
  const seed = townSeed(state);
  const rnd = mulberry32(seed);
  const elev = makeNoise(seed);
  const forest = makeNoise(seed ^ 0x9e3779b9);
  const patch = makeNoise(seed ^ 0x85ebca6b);
  const tiles = Array.from({ length: TOWN_H }, () => new Array(TOWN_W).fill(TILE.GRASS));
  const clearings = [[14, 17, 13, 8], [46, 17, 10, 8], [42, 31, 9, 6]];

  for (let y = 0; y < TOWN_H; y++) {
    for (let x = 0; x < TOWN_W; x++) {
      const edge = Math.min(x, y, TOWN_W - 1 - x, TOWN_H - 1 - y) / 5;
      let e = elev(x, y) * (0.5 + 0.5 * Math.min(1, edge)) + 0.04;
      for (const [cx, cy, rx, ry] of clearings) {
        if (Math.hypot((x - cx) / rx, (y - cy) / ry) < 1) e = Math.min(0.6, Math.max(0.44, e));
      }
      let t = TILE.GRASS;
      if (e < 0.3) t = TILE.DEEP;
      else if (e < 0.37) t = TILE.WATER;
      else if (e < 0.41) t = TILE.SAND;
      else if (e >= 0.8) t = TILE.SNOW;
      else if (e >= 0.7) t = TILE.MOUNTAIN;
      else if (forest(x * 1.3, y * 1.3) > 0.5 ? rnd() < 0.82 : rnd() < 0.07) t = TILE.TREE;
      tiles[y][x] = t;
    }
  }

  const free = (x, y, w, h) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (!LAND.has(tiles[j]?.[i])) return false;
    return true;
  };
  const stamp = (x, y, w, h, code) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) tiles[j][i] = code; };
  const village = (cx, cy, count, spread) => {
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < count; tries++) {
      const x = cx + Math.round((rnd() - 0.5) * 2 * spread), y = cy + Math.round((rnd() - 0.5) * 1.4 * spread);
      if (free(x - 1, y - 1, 4, 4)) { stamp(x, y, 2, 2, TILE.HOUSE); placed++; }
    }
  };
  const landmark = (x, y, w, h, code) => { for (let dy = -2; dy <= 2; dy++) if (free(x, y + dy, w, h)) { stamp(x, y + dy, w, h, code); return true; } return false; };

  const band = getAgeBand(Number(state.profile?.age || 0));
  tiles[16][9] = tiles[16][10] = tiles[15][9] = tiles[15][10] = TILE.GRASS;
  stamp(9, 15, 2, 2, TILE.HOUSE);
  village(14, 18, 9, 7);
  landmark(24, 13, band === 'school' ? 5 : 4, 3, TILE.SCHOOL);
  village(27, 20, 7, 6);
  landmark(44, 14, band === 'work' ? 6 : 5, 3, TILE.WORK);
  village(47, 20, 8, 7);
  landmark(40, 30, 5, 3, TILE.MARKET);
  village(36, 9, 6, 6);

  for (const [fx, fy] of [[16, 22], [22, 23], [44, 23], [36, 31]]) { if (free(fx, fy, 5, 3)) stamp(fx, fy, 5, 3, TILE.FARM); }

  const carve = (x0, y0, x1, y1) => {
    let x = x0, y = y0;
    const isBuilding = (t) => t === TILE.HOUSE || t === TILE.SCHOOL || t === TILE.WORK || t === TILE.MARKET || t === TILE.FARM;
    for (let guard = 0; guard < 200 && (x !== x1 || y !== y1); guard++) {
      if (!isBuilding(tiles[y][x]) && tiles[y][x] !== TILE.MOUNTAIN && tiles[y][x] !== TILE.SNOW) tiles[y][x] = TILE.ROAD;
      const goX = x !== x1 && (y === y1 || rnd() < 0.55);
      if (goX) x += Math.sign(x1 - x); else y += Math.sign(y1 - y);
    }
  };
  carve(11, 17, 24, 17); carve(26, 16, 36, 12); carve(36, 12, 45, 17); carve(26, 17, 40, 31); carve(11, 17, 17, 21);

  // ไบโอมตามดัชนีความเท่าเทียม: สูง = ทุ่งดอกไม้/ป่าซากุระชมพู ต่ำ = ทุ่งแห้งสีส้ม + รั้ว
  for (let y = 0; y < TOWN_H; y++) {
    for (let x = 0; x < TOWN_W; x++) {
      const t = tiles[y][x];
      if (t !== TILE.GRASS && t !== TILE.TREE) continue;
      const p = patch(x * 1.1 + 40, y * 1.1 + 40), r = rnd();
      if (eq.townIndex >= 66 && p > 0.5) { if (t === TILE.GRASS) tiles[y][x] = TILE.PINK; }
      else if (eq.townIndex <= 33 && p > 0.42) { if (t === TILE.GRASS) tiles[y][x] = TILE.DRY; }
      else if (t === TILE.GRASS && eq.townIndex >= 55 && r < 0.05) tiles[y][x] = TILE.FLOWER;
      else if (t === TILE.GRASS && eq.townIndex <= 40 && r < 0.03) tiles[y][x] = TILE.FENCE;
    }
  }
  return { w: TOWN_W, h: TOWN_H, tiles, homeX: 9, homeY: 17 };
}

export function walkable(map, x, y) {
  const t = map.tiles[y]?.[x];
  return t === TILE.GRASS || t === TILE.ROAD || t === TILE.FLOWER || t === TILE.FARM || t === TILE.SAND || t === TILE.PINK || t === TILE.DRY;
}

/** NPC ในเมืองของปีนี้ (ซ้ำได้เมื่ออายุเดียวกัน) พร้อมตัวตนครบทุกกลุ่ม */
export function spawnTownNpcs(state, map = buildTownMap(state)) {
  const age = Number(state.profile?.age || 0);
  const rnd = mulberry32(townSeed(state) ^ Math.imul(age + 1, 2654435761));
  const count = 12 + Math.floor(rnd() * 4);
  const pool = age < 13 ? KID_IDENTITY_IDS : IDENTITY_IDS;
  const npcs = [];
  for (let i = 0; i < count; i++) {
    let identity = i < pool.length ? pool[i] : pool[Math.floor(rnd() * pool.length)];
    const fi = state.equality ? getFocus(state.equality).identities : [];
    const fiPool = fi.filter((x) => pool.includes(x));
    if (i >= pool.length && fiPool.length && rnd() < 0.7) identity = fiPool[Math.floor(rnd() * fiPool.length)];
    let x = 0, y = 0, tries = 0;
    do { x = 3 + Math.floor(rnd() * 19); y = 11 + Math.floor(rnd() * 11); tries++; } while (!walkable(map, x, y) && tries < 200);
    npcs.push({ id: `town_${age}_${i}`, identity, x, y });
  }
  return npcs;
}

export function hasMet(state, npcId) {
  return ensureEquality(state).metIds.includes(npcId);
}

/** อีเวนต์พบปะ: ใช้บริบทตามช่วงวัย + ตัวตนของ NPC */
const SCENARIOS = [
  { id: 'enc_school_pronoun', context: 'school', minAge: 6, maxAge: 22, identities: ['nonbinary', 'genderfluid', 'trans_woman', 'trans_man'],
    title: 'เพื่อนร่วมห้องขอให้เรียกด้วยคำสรรพนามที่ตรงกับตัวตน',
    text: 'เพื่อน ({who}) บอกว่าอยากให้เรียกชื่อและสรรพนามแบบใหม่ บางคนในห้องหัวเราะและบอกว่า "เรียกยากจัง ไม่ต้องหรอก"',
    lesson: 'การเรียกคนด้วยชื่อและสรรพนามที่เขาเลือกเป็นเรื่องของความเคารพ ไม่ได้ทำให้ใครเสียอะไร' },
  { id: 'enc_school_group', context: 'school', minAge: 6, maxAge: 22, identities: ['woman', 'man', 'lesbian', 'gay_man', 'bisexual'],
    title: 'ครูให้แบ่งกลุ่มทำโครงงาน',
    text: 'มีเพื่อน ({who}) ถูกเพื่อนในกลุ่มพูดว่า "งานวิทย์/งานช่างให้ผู้ชายทำ งานตกแต่งให้ผู้หญิงทำ" ทั้งที่เจ้าตัวอยากทำอีกงานหนึ่ง',
    lesson: 'งานและความสามารถไม่ได้ผูกกับเพศ ทุกคนควรได้เลือกบทบาทตามความถนัดและความสนใจ' },
  { id: 'enc_school_bully', context: 'school', minAge: 8, maxAge: 22, identities: ['gay_man', 'lesbian', 'trans_woman', 'trans_man', 'nonbinary', 'bisexual'],
    title: 'มีคนถูกล้อเรื่องเพศสภาพกลางสนามโรงเรียน',
    text: '{who} ถูกกลุ่มเพื่อนล้อเลียนเรื่องท่าทางและความรัก คนรอบตัวยืนดูเงียบๆ',
    lesson: 'การเป็นผู้ยืนดูไม่ช่วยลดความรุนแรง คำพูดสั้นๆ หรือการไปเรียกครูช่วยได้มาก' },
  { id: 'enc_work_promotion', context: 'work', minAge: 18, maxAge: 64, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual'],
    title: 'ที่ทำงานพิจารณาโปรโมตหัวหน้าทีม',
    text: 'เพื่อนร่วมงาน ({who}) ผลงานโดดเด่น แต่หัวหน้าบางคนพูดว่า "ผู้หญิงเดี๋ยวก็แต่งงานมีลูก ไม่เหมาะเป็นผู้นำ" และอยากเลือกคนอื่นแทน',
    lesson: 'การตัดสินคนจากเพศแทนผลงานคือการเลือกปฏิบัติ ค่าจ้างและโอกาสควรเท่ากันเมื่อทำงานเท่ากัน' },
  { id: 'enc_work_caregiver', context: 'work', minAge: 22, maxAge: 64, identities: ['man', 'gay_man', 'trans_man'],
    title: 'เพื่อนร่วมงานขอลาไปดูแลลูก/พ่อแม่ป่วย',
    text: '{who} ขอลางานไปดูแลคนในครอบครัว แต่มีคนแซวว่า "ผู้ชายต้องหาเงิน เรื่องดูแลบ้านเป็นงานผู้หญิง"',
    lesson: 'งานดูแลคนในครอบครัวเป็นของทุกเพศ การแบ่งงานบ้านอย่างเท่าเทียมช่วยให้ทุกคนมีชีวิตที่ดีขึ้น' },
  { id: 'enc_work_coming_out', context: 'work', minAge: 18, maxAge: 64, identities: ['gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man'],
    title: 'เพื่อนร่วมงานเล่าเรื่องคนรักของตัวเอง',
    text: '{who} เล่าให้ฟังด้วยความตื่นเต้นว่าจะจดทะเบียน/ฉลองกับคนรัก ห้องพักกลางเริ่มมีเสียงซุบซิบและมุกตลกเชิงล้อเลียน',
    lesson: 'ความรักของทุกคนมีค่าเท่ากัน การไม่ซุบซิบและไม่เอามาเป็นมุกคือการทำให้ที่ทำงานปลอดภัย' },
  { id: 'enc_public_restroom', context: 'public', minAge: 12, maxAge: 99, identities: ['trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ห้องน้ำสาธารณะในห้างสรรพสินค้า',
    text: '{who} ถูกคนแปลกหน้าจ้องและพูดไล่ที่หน้าห้องน้ำ เจ้าตัวดูอึดอัดและกลัว',
    lesson: 'ทุกคนมีสิทธิ์ใช้พื้นที่สาธารณะอย่างปลอดภัย การช่วยให้เหตุการณ์สงบลงสำคัญกว่าการตัดสินคน' },
  { id: 'enc_kid_toys', context: 'school', minAge: 4, maxAge: 12, identities: ['woman', 'man', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'เล่นของเล่นในคาบพักกลางวัน',
    text: 'เพื่อนเล็ก ({who}) อยากเล่นตุ๊กตา/รถบังคับอีกแบบที่ไม่ตรงกับ "ของเล่นของเพศตัวเอง" เด็กคนอื่นตะโกนว่า "ผู้ชายไม่เล่นอันนี้!" "ผู้หญิงไม่เล่นอันนั้น!"',
    choices: { defend: 'บอกทุกคนว่าของเล่นเล่นได้ทุกคน แล้วชวนเพื่อนมาเล่นด้วยกัน', respect: 'ยื่นของเล่นให้เพื่อนแล้วถามว่าอยากเล่นด้วยกันไหม', ignore: 'ไปเล่นที่อื่น ไม่อยากมีเรื่อง', disrespect: 'ตะโกนล้อตามเพื่อนคนอื่น' },
    lesson: 'ของเล่นและสีไม่มีเพศ เด็กทุกคนมีสิทธิ์เล่นตามความสนใจโดยไม่ถูกล้อ' },
  { id: 'enc_school_sports', context: 'school', minAge: 10, maxAge: 22, identities: ['woman', 'trans_woman', 'lesbian', 'nonbinary', 'trans_man'],
    title: 'คัดตัวทีมฟุตบอลของโรงเรียน',
    text: '{who} สมัครเข้าทีมฟุตบอล แต่ครูพละพูดว่า "ผู้หญิงเล่นกีฬาหนักไม่ไหวหรอก ไปเป็นผู้จัดการทีมดีกว่า" ทั้งที่เจ้าตัวเตะได้ดีมาก',
    choices: { defend: 'ยืนยันกับครูว่าให้ทดสอบฝีมือเท่ากันทุกคน', respect: 'ชวนเขามาซ้อมด้วยกันและเชียร์เต็มที่', ignore: 'ไม่พูดอะไร ปล่อยให้ครูตัดสิน', disrespect: 'พูดเสริมว่าครูพูดถูกแล้ว' },
    lesson: 'กีฬาและโอกาสควรวัดจากฝีมือและความตั้งใจ ไม่ใช่เพศ' },
  { id: 'enc_school_science', context: 'school', minAge: 10, maxAge: 22, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual'],
    title: 'แข่งโครงงานวิทยาศาสตร์',
    text: 'เพื่อน ({who}) เป็นหัวหน้าทีมวิทย์ แต่มีคนพูดว่า "สายวิทย์/วิศวะเป็นของผู้ชาย ให้ผู้ชายคนอื่นพรีเซนต์แทนเถอะ"',
    lesson: 'ความสามารถทางวิทยาศาสตร์และเทคโนโลยีไม่ผูกกับเพศ การไม่ให้พื้นที่คือการเสียโอกาสของทุกคน' },
  { id: 'enc_school_dress', context: 'school', minAge: 12, maxAge: 22, identities: ['trans_woman', 'trans_man', 'nonbinary', 'genderfluid', 'lesbian'],
    title: 'กฎการแต่งกายและทรงผมของโรงเรียน',
    text: '{who} ถูกครูฝ่ายปกครองเรียกตักเตือนเรื่องทรงผมและเครื่องแบบที่ไม่ตรงกับเพศในทะเบียน เพื่อนในห้องเริ่มซุบซิบ',
    choices: { defend: 'เข้าไปบอกครูว่าควรพูดคุยกันดีๆ และเสนอให้โรงเรียนทบทวนกฎ', respect: 'อยู่ข้างเขาและชวนไปกินข้าวหลังเลิกเรียน', ignore: 'แกล้งไม่เห็น เดินเข้าห้อง', disrespect: 'ถ่ายรูปส่งต่อในกลุ่มแชต' },
    lesson: 'การแต่งกายตามตัวตนไม่ควรเป็นเหตุให้ถูกลงโทษหรือถูกประจาน' },
  { id: 'enc_school_dating', context: 'school', minAge: 13, maxAge: 22, identities: ['gay_man', 'lesbian', 'bisexual'],
    title: 'ข่าวลือเรื่องคนที่ชอบ',
    text: 'มีคนแอบเห็น {who} จับมือกับคนที่ชอบหลังโรงเรียน ข่าวถูกแชร์ในกลุ่มแชตของห้องพร้อมคำล้อเลียน',
    choices: { defend: 'เตือนในกลุ่มให้ลบข้อความและบอกว่านี่คือเรื่องส่วนตัว', respect: 'ส่งข้อความหาเขาว่าเรายังเป็นเพื่อนกันเหมือนเดิม', ignore: 'อ่านเฉยๆ ไม่ตอบ', disrespect: 'กดรีแอคและแชร์ต่อ' },
    lesson: 'การเปิดเผยเรื่องส่วนตัวของคนอื่นเป็นการละเมิด ความปลอดภัยทางใจของเพื่อนสำคัญกว่าเรื่องสนุก' },
  { id: 'enc_school_harass', context: 'school', minAge: 12, maxAge: 22, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual', 'nonbinary'],
    title: 'ถูกคุกคามทางวาจาที่ทางเดิน',
    text: '{who} ถูกรุ่นพี่กลุ่มหนึ่งพูดจาลวนลามและวิจารณ์รูปร่าง เจ้าตัวก้มหน้าเดินเร็ว คนรอบข้างหัวเราะ',
    choices: { defend: 'เดินไปยืนข้างเขา บอกรุ่นพี่ให้หยุด และพาไปแจ้งครู', respect: 'เดินไปด้วยกันและถามว่าอยากให้ช่วยอะไร', ignore: 'หลบสายตา ไม่อยากเกี่ยว', disrespect: 'หัวเราะว่า "แค่ล้อเล่น"' },
    lesson: 'การคุกคามไม่ใช่เรื่องล้อเล่น การไม่ยอมรับและช่วยเหลือผู้ถูกกระทำคือความรับผิดชอบร่วมกัน' },
  { id: 'enc_work_interview', context: 'work', minAge: 20, maxAge: 60, identities: ['trans_woman', 'trans_man', 'nonbinary', 'genderfluid', 'gay_man', 'lesbian'],
    title: 'สัมภาษณ์งานตำแหน่งบริการลูกค้า',
    text: 'ผู้สมัคร ({who}) ผ่านการทดสอบทุกด้าน แต่ฝ่ายบุคคลคุยกันว่า "ลูกค้าอาจไม่ชอบ ไม่เหมาะกับภาพลักษณ์บริษัท" ขณะที่คุณอยู่ในห้องประชุม',
    choices: { defend: 'ท้วงว่าควรตัดสินจากผลงานและความสามารถ และขอให้ทบทวน', respect: 'เสนอให้ใช้เกณฑ์คะแนนเดียวกันกับผู้สมัครทุกคน', ignore: 'นิ่งเฉยและรอผลการประชุม', disrespect: 'พยักหน้าเห็นด้วยกับฝ่ายบุคคล' },
    lesson: 'การจ้างงานต้องใช้เกณฑ์ที่เท่ากัน อคติเรื่องภาพลักษณ์ทำให้องค์กรเสียคนเก่งและสร้างความไม่เป็นธรรม' },
  { id: 'enc_work_pay', context: 'work', minAge: 22, maxAge: 64, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual', 'nonbinary'],
    title: 'เงินเดือนไม่เท่ากันในตำแหน่งเดียวกัน',
    text: 'เพื่อนร่วมงาน ({who}) บังเอิญรู้ว่าตัวเองได้เงินเดือนต่ำกว่าเพื่อนชายที่ทำงานเหมือนกัน และมาปรึกษาคุณว่าควรทำอย่างไร',
    lesson: 'ค่าจ้างที่เท่ากันสำหรับงานเท่ากันเป็นสิทธิ์พื้นฐาน การเปิดเผยและพูดคุยเรื่องค่าจ้างช่วยลดความไม่เป็นธรรม' },
  { id: 'enc_work_harass', context: 'work', minAge: 20, maxAge: 64, identities: ['woman', 'man', 'gay_man', 'trans_woman', 'trans_man', 'bisexual'],
    title: 'มุกลามกในวงข้าวเที่ยง',
    text: 'หัวหน้าเล่นมุกลามกเกี่ยวกับรูปร่างของ {who} ทุกคนหัวเราะ เจ้าตัวยิ้มแห้งๆ และเริ่มเงียบ',
    choices: { defend: 'บอกตรงๆ ว่ามุกนี้ไม่ตลก และขอให้หยุด', respect: 'ชวนเขาไปคุยแยกและบอกว่ารับรู้ว่าไม่โอเค', ignore: 'ก้มหน้ากินข้าวต่อ', disrespect: 'หัวเราะดังกว่าคนอื่น' },
    lesson: 'การคุกคามทางเพศเกิดได้กับทุกเพศ ที่ทำงานที่ปลอดภัยต้องเริ่มจากการไม่หัวเราะให้การล้อเลียน' },
  { id: 'enc_work_leave', context: 'work', minAge: 22, maxAge: 55, identities: ['man', 'gay_man', 'trans_man', 'woman'],
    title: 'ลาดูแลบุตรหลังคลอด',
    text: '{who} ขอลาไปดูแลลูกที่เพิ่งเกิด แต่ผู้จัดการพูดว่า "ผู้ชายลาเลี้ยงลูกเหรอ ไม่จริงจังกับงานหรือเปล่า" หรือ "ผู้หญิงลาแล้วอย่ากลับมาทำงานนะ"',
    lesson: 'การเลี้ยงดูบุตรเป็นความรับผิดชอบร่วม ทุกเพศควรได้รับสิทธิ์ลาและไม่ถูกลงโทษทางอาชีพ' },
  { id: 'enc_work_team', context: 'work', minAge: 20, maxAge: 64, identities: ['nonbinary', 'genderfluid', 'trans_man', 'trans_woman'],
    title: 'ฟอร์มข้อมูลพนักงานมีแค่ช่อง "นาย/นาง/นางสาว"',
    text: '{who} ขอให้ฝ่ายบุคคลใช้คำเรียกที่ตรงกับตัวตน แต่คนในแผนกบอกว่า "ระบบไม่มีช่องให้ ยุ่งยากเกินไป"',
    choices: { defend: 'เสนอให้แก้ฟอร์มและช่วยผลักดันกับฝ่ายบุคคล', respect: 'เรียกด้วยชื่อและคำที่เขาเลือกในที่ทำงานทุกวัน', ignore: 'คิดว่าไม่ใช่หน้าที่ตัวเอง', disrespect: 'แกล้งเรียกด้วยคำเดิมต่อไป' },
    lesson: 'ระบบและเอกสารที่ไม่รองรับความหลากหลายทำให้คนบางกลุ่มถูกมองข้าม การปรับระบบเล็กน้อยสร้างความเคารพได้มาก' },
  { id: 'enc_job_pilot', context: 'work', minAge: 24, maxAge: 60, identities: ['woman', 'trans_woman', 'lesbian', 'nonbinary'],
    title: 'ห้องนักบินและความไว้ใจของผู้โดยสาร',
    text: 'นักบินร่วมเที่ยวบิน ({who}) ถูกผู้โดยสารบ่นว่า "ขอเปลี่ยนเป็นกัปตันผู้ชาย ไม่ไว้ใจ" ทั้งที่ผ่านการตรวจสอบและฝึกบินครบทุกอย่าง',
    choices: { defend: 'ชี้แจงกับผู้โดยสารว่านักบินทุกคนผ่านมาตรฐานเดียวกัน และยืนยันให้บินตามแผน', respect: 'แสดงความเชื่อมั่นต่อทีมและชวนผู้โดยสารคุยให้สบายใจ', ignore: 'ปล่อยให้เป็นเรื่องของลูกเรือคนอื่น', disrespect: 'ขอโทษผู้โดยสารและเสนอเปลี่ยนนักบินตามที่ขอ' },
    lesson: 'ความไว้ใจควรมาจากความสามารถและมาตรฐานวิชาชีพ ไม่ใช่เพศของผู้ปฏิบัติงาน' },
  { id: 'enc_job_nurse', context: 'work', minAge: 22, maxAge: 60, identities: ['man', 'gay_man', 'trans_man', 'trans_woman'],
    title: 'พยาบาลชายในหอผู้ป่วย',
    text: 'ผู้ป่วยญาติพูดกับ {who} ที่เป็นพยาบาลว่า "ผู้ชายมาเป็นพยาบาลได้ไง ขอเปลี่ยนเป็นพยาบาลผู้หญิง" ทั้งที่เจ้าตัวคือคนที่ดูแลเคสนี้ได้ดีที่สุด',
    lesson: 'งานดูแลคนไม่ได้เป็นของเพศใดเพศหนึ่ง ทุกเพศเป็นผู้ให้การดูแลที่ดีได้' },
  { id: 'enc_job_chef', context: 'work', minAge: 20, maxAge: 60, identities: ['trans_woman', 'trans_man', 'nonbinary', 'gay_man', 'lesbian'],
    title: 'หัวหน้าเชฟกับลูกทีมครัว',
    text: 'ผู้ช่วยเชฟ ({who}) ถูกพ่อครัวคนอื่นล้อว่า "ครัวนี้ไม่ต้อนรับพวกเธอ" ทุกครั้งที่ออกจานเด็ด ขณะที่ลูกค้าติดใจรสชาติ',
    choices: { defend: 'ประกาศกลางครัวว่าให้ทุกคนเคารพกัน และรายงานหัวหน้าถ้ายังมีการล้อ', respect: 'ชมฝีมือและชวนมาเป็นผู้ช่วยหลักของเมนูใหม่', ignore: 'ตั้งใจทำงานต่อ ไม่อยากมีเรื่อง', disrespect: 'หัวเราะตามเพื่อนร่วมครัว' },
    lesson: 'ฝีมือและความรับผิดชอบเป็นตัววัดงาน ไม่ใช่เพศสภาพ ครัวที่ปลอดภัยทำให้ทีมเก่งขึ้นทั้งทีม' },
  { id: 'enc_job_lecturer', context: 'work', minAge: 28, maxAge: 65, identities: ['woman', 'trans_woman', 'trans_man', 'nonbinary', 'gay_man', 'lesbian'],
    title: 'อาจารย์ในคณะกับตำแหน่งวิชาการ',
    text: 'อาจารย์ ({who}) ส่งผลงานขอตำแหน่งทางวิชาการ แต่กรรมการบางคนพูดว่า "เก่งแต่ท่าทางไม่เหมาะเป็นแบบอย่างให้นักศึกษา"',
    lesson: 'ผลงานวิชาการต้องประเมินด้วยเกณฑ์เดียวกันกับทุกคน การตัดสินจากเพศสภาพทำให้สังคมเสียนักวิชาการที่เก่ง' },
  { id: 'enc_job_analyst', context: 'work', minAge: 21, maxAge: 60, identities: ['woman', 'man', 'bisexual', 'nonbinary', 'genderfluid', 'trans_woman', 'trans_man'],
    title: 'ข้อมูลเงินเดือนทั้งบริษัท',
    text: 'นักวิเคราะห์ข้อมูล ({who}) พบว่าบริษัทจ่ายเงินเดือนต่างกันตามเพศในตำแหน่งเดียวกัน และกำลังคิดว่าจะรายงานหรือเงียบไว้',
    choices: { defend: 'ช่วยทำรายงานเปิดเผยข้อมูลและเสนอแนวทางปรับให้เท่ากัน', respect: 'ให้กำลังใจและช่วยตรวจสอบตัวเลขว่าถูกต้อง', ignore: 'บอกว่าไม่ใช่เรื่องของเรา', disrespect: 'แนะนำให้ลบหลักฐานเพื่อกันปัญหา' },
    lesson: 'ข้อมูลช่วยทำให้ความไม่เท่าเทียมมองเห็นได้ การพูดความจริงเรื่องค่าจ้างเป็นก้าวแรกของการแก้ไข' },
  { id: 'enc_job_shop', context: 'work', minAge: 18, maxAge: 70, identities: ['woman', 'trans_woman', 'gay_man', 'lesbian', 'nonbinary', 'trans_man'],
    title: 'ลูกค้าในร้านออนไลน์และตลาดนัด',
    text: 'เจ้าของร้าน ({who}) ถูกลูกค้ารีวิวต่ำเพราะเรื่องรสนิยมและเพศสภาพ ไม่ใช่คุณภาพสินค้า แล้วมีคนมาคอมเมนต์ซ้ำเติม',
    choices: { defend: 'เขียนรีวิวเชิงบวกตามจริงและรายงานคอมเมนต์ที่เหยียดเพศ', respect: 'สั่งซื้อสินค้าและแนะนำร้านให้เพื่อน', ignore: 'เลื่อนผ่านไป', disrespect: 'กดไลก์คอมเมนต์ที่ล้อเลียน' },
    lesson: 'ผู้ประกอบการทุกเพศควรถูกตัดสินจากสินค้าและบริการ ผู้บริโภคช่วยสร้างตลาดที่เป็นธรรมได้' },
  { id: 'enc_kid_playground', context: 'school', minAge: 3, maxAge: 9, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ที่สนามเด็กเล่น',
    text: 'เด็กอีกคน ({who}) อยากเล่นบทพ่อ/แม่/ฮีโร่ในเกมสมมติ แต่เพื่อนบอกว่า "บทนี้ของเด็กผู้ชาย/ผู้หญิงเท่านั้น"',
    lesson: 'เด็กทุกคนเล่นบทบาทไหนก็ได้ การเล่นสนุกร่วมกันคือพื้นฐานของความเคารพกัน' },
  { id: 'enc_kid_colors', context: 'school', minAge: 3, maxAge: 10, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'วันเลือกสีผ้ากันเปื้อน',
    text: 'เพื่อนตัวเล็ก ({who}) เลือกสีชมพู/สีฟ้าที่ถูกมองว่า "ไม่ใช่สีของเพศตัวเอง" แล้วมีเด็กหัวเราะ',
    choices: { defend: 'บอกเพื่อนว่าสีไหนก็ใช้ได้ แล้วเลือกสีเดียวกันด้วย', respect: 'ชมว่าสีที่เลือกสวยดี', ignore: 'ไม่พูดอะไร', disrespect: 'หัวเราะและพูดว่าสีนี้ไม่ใช่ของเธอ' },
    lesson: 'สีไม่มีเพศ ทุกคนมีสิทธิ์ชอบสีที่ตัวเองชอบ' },
  { id: 'enc_school_uniform', context: 'school', minAge: 6, maxAge: 18, identities: ['trans_woman', 'trans_man', 'nonbinary', 'genderfluid', 'woman', 'man'],
    title: 'วันถ่ายภาพรุ่นกับชุดนักเรียน',
    text: '{who} อยากแต่งชุดที่ตรงกับตัวตนในวันถ่ายภาพรุ่น แต่เพื่อนและครูบางคนบอกว่า "ต้องแต่งตามเพศในทะเบียน"',
    lesson: 'การแต่งกายที่ตรงกับตัวตนเป็นเรื่องศักดิ์ศรี โรงเรียนที่ยืดหยุ่นทำให้ทุกคนอยากมาเรียน' },
  { id: 'enc_school_class_rep', context: 'school', minAge: 10, maxAge: 22, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'เลือกประธานนักเรียน',
    text: 'ผู้สมัคร ({who}) ถูกบอกว่า "เป็นผู้นำไม่ได้หรอก" เพราะเพศ ทั้งที่ได้รับเสียงสนับสนุนจากเพื่อนจำนวนมาก',
    lesson: 'ความเป็นผู้นำมาจากความสามารถและการรับฟัง ไม่ได้มาจากเพศ' },
  { id: 'enc_school_textbook', context: 'school', minAge: 8, maxAge: 18, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'หนังสือเรียนที่เหมารวมบทบาททางเพศ',
    text: 'ครูให้อ่านบทเรียนที่เขียนว่า "ผู้ชายเป็นหมอ ผู้หญิงเป็นพยาบาล" เพื่อน ({who}) ยกมือถามว่าทำไมต้องเป็นแบบนั้น แล้วถูกเพื่อนแซว',
    choices: { defend: 'ยกมือสนับสนุนคำถามและเล่าตัวอย่างคนที่ทำอาชีพต่างจากในหนังสือ', respect: 'ฟังเหตุผลของเพื่อนและขอบคุณที่ถาม', ignore: 'ก้มหน้าจดโน้ต', disrespect: 'ล้อว่าเรื่องมากแล้วหัวเราะ' },
    lesson: 'การตั้งคำถามกับอคติเป็นการเรียนรู้ ไม่ใช่การก่อกวน' },
  { id: 'enc_school_camp', context: 'school', minAge: 10, maxAge: 18, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ค่ายลูกเสือและการแบ่งกลุ่มนอนเต็นท์',
    text: 'ครูให้แบ่งเต็นท์ตามเพศในทะเบียน {who} กังวลว่าจะไม่ปลอดภัยหรือไม่สบายใจ และมีเพื่อนล้อว่าเรื่องมาก',
    choices: { defend: 'เสนอครูให้มีเต็นท์ทางเลือกที่ปลอดภัยและเป็นส่วนตัว', respect: 'ถามเขาว่าอยากอยู่กับใครแล้วช่วยจัดให้', ignore: 'ไม่ยุ่ง ปล่อยให้ครูจัดตามเดิม', disrespect: 'แซวว่า "จะนอนเต็นท์ไหนก็ไม่ต่างกัน"' },
    lesson: 'ความปลอดภัยและความเป็นส่วนตัวของทุกคนสำคัญ การหาทางเลือกที่ทุกคนสบายใจเป็นหน้าที่ของทั้งห้อง' },
  { id: 'enc_school_exam', context: 'school', minAge: 12, maxAge: 22, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ผลสอบกับคำพูดเหมารวม',
    text: 'ผลสอบคณิต/ภาษาออกมา เพื่อน ({who}) ได้คะแนนสูงมาก แต่มีคนพูดว่า "ผู้หญิง/ผู้ชายเก่งแต่ท่องจำ ไม่ฉลาดจริง"',
    lesson: 'ผลการเรียนเกิดจากความพยายามของแต่ละคน ไม่ได้ผูกกับเพศ' },
  { id: 'enc_school_graduation', context: 'school', minAge: 15, maxAge: 22, identities: ['gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'พาคนรักไปงานเต้นรำจบการศึกษา',
    text: '{who} อยากพาคนรักมาร่วมงานเต้นรำ แต่ถูกฝ่ายจัดงานบอกว่า "ให้พาคู่ต่างเพศมาเท่านั้น"',
    choices: { defend: 'รวมรายชื่อเพื่อนเสนอให้เปิดรับทุกคู่', respect: 'เชิญไปนั่งโต๊ะด้วยกันและเต้นรำด้วยกัน', ignore: 'ไม่เกี่ยวกับเรา', disrespect: 'เห็นด้วยกับกฎและไล่ให้ไปงานอื่น' },
    lesson: 'งานรื่นเริงของโรงเรียนควรเปิดให้ทุกคู่เข้าร่วมได้อย่างปลอดภัย' },
  { id: 'enc_work_meeting', context: 'work', minAge: 20, maxAge: 64, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual', 'nonbinary'],
    title: 'ประชุมทีมและการถูกขัดจังหวะ',
    text: 'ในที่ประชุม {who} ถูกขัดจังหวะบ่อยครั้ง และไอเดียเดียวกันถูกยกเครดิตให้เพื่อนร่วมงานอีกคนที่พูดซ้ำทีหลัง',
    choices: { defend: 'พูดว่า "ขอให้เขาพูดจบก่อน และไอเดียนี้เป็นของเขา"', respect: 'ถามเขาในที่ประชุมว่ามีอะไรจะเสริมอีก', ignore: 'นั่งเงียบ', disrespect: 'พูดซ้ำแล้วรับเครดิตเอง' },
    lesson: 'การเคารพพื้นที่พูดของทุกคนทำให้ไอเดียดีๆ ไม่สูญหาย' },
  { id: 'enc_work_dresscode', context: 'work', minAge: 20, maxAge: 64, identities: ['trans_woman', 'trans_man', 'nonbinary', 'genderfluid', 'woman', 'man'],
    title: 'กฎการแต่งกายที่ทำงาน',
    text: 'บริษัทออกกฎให้ "ผู้ชายสวมสูท ผู้หญิงสวมกระโปรง" {who} รู้สึกอึดอัดและขอแต่งกายแบบที่ตรงกับตัวตน',
    lesson: 'การแต่งกายสุภาพมีได้หลายแบบ กฎที่ยืดหยุ่นทำให้พนักงานทำงานได้เต็มที่' },
  { id: 'enc_work_inclusive_benefit', context: 'work', minAge: 22, maxAge: 64, identities: ['gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'สวัสดิการคู่ชีวิตของพนักงาน',
    text: '{who} ขอใช้สวัสดิการประกันสุขภาพสำหรับคู่ชีวิต แต่ฝ่ายบุคคลบอกว่า "ใช้ได้เฉพาะสามีภรรยาตามกฎหมายเดิม"',
    choices: { defend: 'ร่วมเสนอแก้ระเบียบสวัสดิการกับสหภาพหรือผู้บริหาร', respect: 'ชวนเขาคุยและช่วยหาข้อมูลสิทธิที่ใช้ได้', ignore: 'เห็นว่าเป็นเรื่องของฝ่ายบุคคล', disrespect: 'บอกว่า "ไม่เห็นต้องมีสวัสดิการแบบนี้"' },
    lesson: 'สวัสดิการที่ครอบคลุมทุกครอบครัวเป็นความเท่าเทียมที่จับต้องได้' },
  { id: 'enc_work_mentor', context: 'work', minAge: 20, maxAge: 64, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'พี่เลี้ยงงานคนใหม่',
    text: 'พนักงานใหม่ ({who}) ขอให้เป็นพี่เลี้ยง แต่หัวหน้าส่งคนอื่นมาแทนเพราะ "คุยกับผู้ชาย/ผู้หญิงด้วยกันถนัดกว่า"',
    lesson: 'การให้คำแนะนำและโอกาสเติบโตควรเปิดให้ทุกเพศ' },
  { id: 'enc_work_overtime', context: 'work', minAge: 20, maxAge: 64, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual'],
    title: 'ทำงานล่วงเวลาและคำพูดเรื่องบ้าน',
    text: 'เพื่อนร่วมงาน ({who}) ถูกหัวหน้าพูดว่า "ไม่ต้องอยู่ดึกก็ได้ เดี๋ยวสามี/ลูกรอ" และข้ามไม่ให้เข้าโครงการสำคัญ',
    lesson: 'การตัดสินแทนว่าใครมีเวลาทำงานแค่ไหนเป็นอคติ ควรถามเจ้าตัวและให้โอกาสเท่ากัน' },
  { id: 'enc_work_client', context: 'work', minAge: 20, maxAge: 64, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ลูกค้าสำคัญขอคุยกับ "ผู้ชาย"',
    text: 'ลูกค้ารายใหญ่ปฏิเสธที่จะคุยกับ {who} โดยบอกว่า "ขอคุยกับหัวหน้าผู้ชายแทน" ทั้งที่เจ้าตัวเป็นผู้ดูแลโครงการ',
    choices: { defend: 'ยืนยันกับลูกค้าว่าเขาคือผู้รับผิดชอบโครงการ และคุยต่อกับเขาเท่านั้น', respect: 'แนะนำว่าเขาคือผู้เชี่ยวชาญที่สุดและรับฟังเขาเป็นหลัก', ignore: 'ปล่อยให้ลูกค้าเรียกคนอื่นมา', disrespect: 'รีบเข้าไปคุยแทนตามที่ลูกค้าต้องการ' },
    lesson: 'บริษัทที่ปกป้องพนักงานจากอคติของลูกค้าทำให้ทีมไว้ใจกัน' },
  { id: 'enc_work_nametag', context: 'work', minAge: 20, maxAge: 64, identities: ['trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ป้ายชื่อและอีเมลบริษัท',
    text: '{who} ขอให้ป้ายชื่อและอีเมลใช้ชื่อที่ตรงกับตัวตน แต่ระบบยังตั้งค่าไว้ตามเอกสารเดิม ทำให้ถูกเรียกชื่อผิดต่อหน้าลูกค้า',
    lesson: 'การเรียกชื่อที่ถูกต้องเป็นความเคารพขั้นพื้นฐาน' },
  { id: 'enc_work_parental', context: 'work', minAge: 22, maxAge: 55, identities: ['man', 'gay_man', 'trans_man', 'bisexual'],
    title: 'พ่อที่อยากไปรับลูกจากโรงเรียน',
    text: '{who} ขอเลื่อนเวลาประชุมเพื่อไปรับลูก แต่ถูกเพื่อนร่วมงานล้อว่า "ผู้ชายยุคนี้เป็นพ่อบ้านหรือไง"',
    lesson: 'การเป็นพ่อที่ใส่ใจลูกควรได้รับการยอมรับเท่ากับแม่' },
  { id: 'enc_public_cafe', context: 'public', minAge: 12, maxAge: 99, identities: ['gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'คู่รักในร้านกาแฟ',
    text: 'คู่รักคู่หนึ่ง ({who}) จับมือกันในร้านกาแฟ มีลูกค้าโต๊ะข้างๆ มองด้วยสายตาตำหนิและพูดเสียงดังว่า "ไม่ควรมาทำแบบนี้ในที่สาธารณะ"',
    lesson: 'ความรักที่สุภาพควรแสดงได้ในที่สาธารณะเหมือนกันทุกคู่' },
  { id: 'enc_public_gym', context: 'public', minAge: 15, maxAge: 99, identities: ['trans_woman', 'trans_man', 'nonbinary', 'genderfluid', 'woman', 'man'],
    title: 'ห้องเปลี่ยนชุดฟิตเนส',
    text: '{who} ถูกพนักงานถามเสียงดังว่า "คุณใช้ห้องนี้ได้จริงเหรอ" ต่อหน้าลูกค้าคนอื่น',
    lesson: 'พื้นที่ส่วนตัวต้องปลอดภัยสำหรับทุกคน ไม่ควรมีใครถูกตั้งคำถามเรื่องตัวตนต่อหน้าคนอื่น' },
  { id: 'enc_public_taxi', context: 'public', minAge: 18, maxAge: 99, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual', 'nonbinary'],
    title: 'แท็กซี่กลางดึก',
    text: '{who} ขึ้นรถแท็กซี่ตอนดึกและถูกคนขับถามเรื่องส่วนตัวและแสดงท่าทีไม่เหมาะสม',
    choices: { defend: 'ช่วยจดทะเบียนรถและแจ้งบริษัทหรือเจ้าหน้าที่', respect: 'โทรเป็นเพื่อนระหว่างทางและรอรับที่ปลายทาง', ignore: 'ไม่รู้จะทำอะไร', disrespect: 'บอกว่าเป็นแค่การทักทาย อย่าคิดมาก' },
    lesson: 'ความปลอดภัยของผู้โดยสารทุกเพศเป็นความรับผิดชอบร่วม' },
  { id: 'enc_public_temple', context: 'public', minAge: 10, maxAge: 99, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ที่วัดในวันพระ',
    text: '{who} มาร่วมทำบุญ แต่มีคนในวัดพูดว่า "คนแบบนี้ทำบุญไปก็ไม่ได้บุญหรอก"',
    lesson: 'การทำบุญและศรัทธาเป็นของทุกคน ผู้ที่ตัดสินคนอื่นด้วยอคติต่างหากที่ควรทบทวนใจตัวเอง' },
  { id: 'enc_public_barber', context: 'public', minAge: 8, maxAge: 99, identities: ['trans_woman', 'trans_man', 'nonbinary', 'genderfluid', 'woman', 'man', 'lesbian'],
    title: 'ร้านตัดผมและร้านเสริมสวย',
    text: '{who} เข้าร้านเพื่อตัดผมทรงที่ตรงกับตัวตน แต่ช่างปฏิเสธว่า "ร้านนี้ตัดให้เฉพาะผู้ชาย/ผู้หญิงเท่านั้น"',
    lesson: 'บริการที่เปิดกว้างทำให้ทุกคนรู้สึกเป็นส่วนหนึ่งของชุมชน' },
  { id: 'enc_public_news', context: 'public', minAge: 14, maxAge: 99, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ข่าวคดีความรุนแรงเรื่องเพศ',
    text: 'มีข่าวกล่าวโทษผู้เสียหาย ({who}) ว่า "แต่งตัวยั่ว/ทำตัวเอง" และคนในโซเชียลช่วยกันแชร์คอมเมนต์ซ้ำเติม',
    choices: { defend: 'ตอบโต้ด้วยข้อมูลและรายงานคอมเมนต์ที่ซ้ำเติม', respect: 'ส่งข้อความให้กำลังใจและแชร์ช่องทางขอความช่วยเหลือ', ignore: 'เลื่อนผ่านไป', disrespect: 'กดไลก์คอมเมนต์ที่โทษผู้เสียหาย' },
    lesson: 'ผู้เสียหายไม่ควรถูกกล่าวโทษ การแชร์ต่ออย่างระวังช่วยหยุดการซ้ำเติมได้' },
  { id: 'enc_public_queue', context: 'public', minAge: 6, maxAge: 99, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'เข้าคิวซื้อของ',
    text: '{who} ถูกพนักงานเรียกด้วยคำที่ไม่ตรงกับตัวตนและมีคนในคิวหัวเราะ',
    lesson: 'การเรียกด้วยคำที่สุภาพและเป็นกลางเป็นมารยาทที่ทำให้ทุกคนสบายใจ' },
  { id: 'enc_family_dinner2', context: 'family', minAge: 6, maxAge: 99, identities: ['woman', 'man', 'nonbinary', 'genderfluid'],
    title: 'ที่โต๊ะอาหารวันตรุษจีนและสงกรานต์',
    text: 'ผู้ใหญ่ในบ้านให้ {who} เสิร์ฟน้ำและเก็บจานเพราะ "เป็นผู้หญิง/ผู้ชายต้องทำหน้าที่แบบนี้" ขณะที่คนอื่นนั่งคุยกัน',
    lesson: 'การแบ่งหน้าที่ในบ้านควรยุติธรรมและผลัดเปลี่ยนกัน' },
  { id: 'enc_family_inherit', context: 'family', minAge: 20, maxAge: 99, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual', 'nonbinary'],
    title: 'การแบ่งมรดกในครอบครัว',
    text: 'ญาติ ({who}) ถูกบอกว่า "ที่ดินให้ลูกชายก่อน ผู้หญิงจะได้อะไรไปทำไม" ทั้งที่เป็นผู้ดูแลพ่อแม่มาตลอด',
    choices: { defend: 'เสนอให้ปรึกษาทนายและแบ่งตามหลักความเป็นธรรมตามกฎหมาย', respect: 'รับฟังและยอมรับบทบาทการดูแลของเขาที่ผ่านมา', ignore: 'ไม่อยากยุ่งเรื่องเงินของบ้านอื่น', disrespect: 'สนับสนุนว่าควรให้ลูกชายก่อน' },
    lesson: 'สิทธิในมรดกและการดูแลครอบครัวควรเป็นธรรมกับทุกเพศ' },
  { id: 'enc_family_wedding', context: 'family', minAge: 18, maxAge: 99, identities: ['gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'งานแต่งของญาติ',
    text: '{who} ได้รับเชิญไปงานแต่ง แต่ญาติบางคนขอให้ "อย่าพาแฟนมา เดี๋ยวแขกคนอื่นมองกัน"',
    lesson: 'ความรักที่ถูกซ่อนไว้ทำร้ายใจ ครอบครัวที่ยอมรับทำให้ทุกคนมีที่ยืน' },
  { id: 'enc_family_grand', context: 'family', minAge: 50, maxAge: 99, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'หลานถามเรื่องเพศที่หลากหลาย',
    text: 'หลานตัวน้อยถามคุณว่าทำไม {who} ถึงแต่งตัว/รักแบบนี้ และผู้ใหญ่คนอื่นกำลังรอฟังคำตอบของคุณ',
    choices: { defend: 'อธิบายว่าทุกคนมีสิทธิ์เป็นตัวเอง และเราให้เกียรติกัน', respect: 'ตอบอย่างใจเย็นและชวนหลานฟังเรื่องราวของเขา', ignore: 'เปลี่ยนเรื่องคุย', disrespect: 'บอกหลานว่าเป็นเรื่องผิดปกติ' },
    lesson: 'เด็กเรียนรู้ความเคารพจากคำตอบของผู้ใหญ่ที่ใกล้ตัว' },
  { id: 'enc_family_son_cry', context: 'family', minAge: 3, maxAge: 15, identities: ['man', 'gay_man', 'trans_man', 'nonbinary'],
    title: 'ลูกชายร้องไห้หลังหกล้ม',
    text: 'เด็กชาย ({who}) ร้องไห้หลังหกล้ม แล้วมีผู้ใหญ่บอกว่า "ผู้ชายห้ามร้องไห้ ต้องเข้มแข็ง"',
    lesson: 'การร้องไห้เป็นเรื่องปกติ การสอนให้เก็บความรู้สึกทำให้เด็กโตมากดดันตัวเอง' },
  { id: 'enc_family_daughter_sport', context: 'family', minAge: 6, maxAge: 18, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual', 'nonbinary'],
    title: 'ลูกสาวอยากเรียนมวยไทย',
    text: 'เด็กหญิง ({who}) บอกว่าอยากเรียนมวยไทย แต่ญาติแนะนำว่า "ไปเรียนรำไทยดีกว่า เป็นผู้หญิงต้องเรียบร้อย"',
    lesson: 'เด็กทุกคนมีสิทธิ์เลือกกีฬาและกิจกรรมที่รักโดยไม่ถูกจำกัดด้วยเพศ' },
  { id: 'enc_elder_home', context: 'family', minAge: 60, maxAge: 99, identities: ['gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'บ้านพักผู้สูงอายุ',
    text: 'ผู้สูงอายุ ({who}) อยู่ในบ้านพักแล้วถูกปฏิเสธไม่ให้คู่ชีวิตมาเยี่ยมและตัดสินใจเรื่องการรักษาแทน เพราะ "ไม่ใช่ญาติตามกฎหมาย"',
    choices: { defend: 'ช่วยยื่นเรื่องขอให้ทบทวนและเรียกร้องแนวทางที่เคารพคู่ชีวิต', respect: 'พาคู่ชีวิตเข้าไปเยี่ยมและช่วยประสานกับเจ้าหน้าที่', ignore: 'ไม่ใช่เรื่องของเรา', disrespect: 'สนับสนุนให้ตัดสิทธิ์คู่ชีวิตตามระเบียบเดิม' },
    lesson: 'คู่ชีวิตของผู้สูงอายุควรมีสิทธิ์ดูแลและตัดสินใจร่วมกัน ความรักไม่ควรถูกกันออกตอนที่ต้องการกันที่สุด' },
  { id: 'enc_elder_retire', context: 'work', minAge: 55, maxAge: 70, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'งานเกษียณและเวทีเสวนา',
    text: 'ในงานเกษียณมีผู้ใหญ่เล่ามุกล้อเรื่องเพศ {who} เป็นหนึ่งในผู้ได้รับเกียรติ และเริ่มเงียบเพราะเสียงหัวเราะของคนในห้อง',
    lesson: 'การให้เกียรติผู้ร่วมงานตลอดชีวิตการทำงานรวมถึงการไม่เอาเรื่องเพศมาเป็นมุก' },
  { id: 'enc_public_online', context: 'public', minAge: 12, maxAge: 99, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ถูกล้อเลียนบนโลกออนไลน์',
    text: '{who} ถูกรุมคอมเมนต์ล้อเลียนเรื่องเพศสภาพในโพสต์ที่เพิ่งโพสต์ มีคนเข้ามาช่วยป้องกันบ้างเล็กน้อย',
    choices: { defend: 'เข้าไปคอมเมนต์เชิงบวกและรายงานบัญชีที่โจมตี', respect: 'ส่งข้อความส่วนตัวไปให้กำลังใจ', ignore: 'เลื่อนผ่านไป', disrespect: 'กดไลก์หรือคอมเมนต์ซ้ำเติม' },
    lesson: 'การไม่เพิ่มเชื้อไฟ และการรายงานคอมเมนต์รุนแรง ช่วยให้พื้นที่ออนไลน์ปลอดภัยขึ้น' },
  { id: 'enc_public_games', context: 'public', minAge: 10, maxAge: 40, identities: ['woman', 'man', 'gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ห้องแชตเกมออนไลน์',
    text: 'เพื่อนร่วมทีม ({who}) ถูกผู้เล่นคนอื่นพูดว่า "ผู้หญิง/พวกนี้เล่นเกมไม่เป็นหรอก ออกไป" ทั้งที่เล่นได้ดีมาก',
    lesson: 'ทักษะการเล่นไม่เกี่ยวกับเพศ ชุมชนเกมที่ปลอดภัยดึงคนเก่งเข้ามามากขึ้น' },
  { id: 'enc_friend_seat', context: 'school', minAge: 8, maxAge: 14, identities: ['woman', 'man', 'nonbinary', 'trans_woman', 'trans_man', 'genderfluid'],
    title: 'ที่นั่งข้างๆ ในห้องเรียน',
    text: '{who} เดินหาที่นั่งในคาบรวม แต่เพื่อนบอกว่า "ห้ามนั่งข้างเพศตรงข้าม เดี๋ยวโดนแซว" ที่นั่งข้างคุณยังว่างอยู่',
    choices: { defend: 'ยกมือบอกครูว่านั่งกับใครก็ได้ แล้วเลื่อนกระเป๋าให้เพื่อน', respect: 'เลื่อนกระเป๋าและชวนนั่งข้างกัน', ignore: 'แกล้งวางกระเป๋าไว้ที่เดิม', disrespect: 'หัวเราะตามเพื่อนที่แซว' },
    lesson: 'เพื่อนต่างเพศนั่งข้างกันได้ มิตรภาพไม่เกี่ยวกับเพศ และการแซวทำให้ใครบางคนไม่กล้าคบเพื่อน' },
  { id: 'enc_friend_group', context: 'school', minAge: 8, maxAge: 14, identities: ['woman', 'man', 'nonbinary', 'trans_woman', 'trans_man', 'genderfluid'],
    title: 'ทำรายงานกลุ่มผสม',
    text: 'ครูจับกลุ่มทำรายงาน {who} เข้ากลุ่มของคุณ แต่เพื่อนในกลุ่มบ่นว่า "อยู่กลุ่มเดียวกับเพศนี้ไม่สนุกหรอก"',
    lesson: 'กลุ่มที่มีเพื่อนหลายเพศมองโจทย์ได้หลายมุม งานจึงออกมาดีกว่า' },
  { id: 'enc_friend_tease', context: 'school', minAge: 9, maxAge: 14, identities: ['woman', 'man', 'nonbinary', 'trans_woman', 'trans_man', 'genderfluid'],
    title: 'โดนแซวว่า "แฟนกันหรอ"',
    text: 'คุณเดินกลับบ้านกับเพื่อนสนิท ({who}) แล้วเพื่อนในห้องตะโกนแซวว่า "แฟนกันหรอ!" ทั้งที่แค่เป็นเพื่อนกัน',
    choices: { defend: 'ตอบเสียงดังว่า "เพื่อนกันต่างหาก ใครจะคบกับใครก็เรื่องของเขา"', respect: 'หัวเราะเบาๆ แล้วเดินกลับกับเพื่อนต่อ', ignore: 'เดินห่างจากเพื่อนเพราะอาย', disrespect: 'ผลักเพื่อนออกแล้วแซวตามคนอื่น' },
    lesson: 'เพื่อนต่างเพศเป็นเพื่อนได้เหมือนเพื่อนเพศเดียวกัน การแซวเกินจริงทำให้มิตรภาพอึดอัด' },
  { id: 'enc_friend_birthday', context: 'family', minAge: 8, maxAge: 14, identities: ['woman', 'man', 'nonbinary', 'trans_woman', 'trans_man', 'genderfluid'],
    title: 'งานวันเกิดและรายชื่อแขก',
    text: 'คุณจัดวันเกิด แล้วญาติบอกว่า "เชิญแค่เพื่อนเพศเดียวกันพอ" แต่เพื่อนที่คุณอยากเชิญที่สุดคือ {who}',
    lesson: 'วันเกิดคือวันที่ได้อยู่กับคนที่สำคัญ เพื่อนทุกเพศมีที่นั่งได้เสมอ' },
  { id: 'enc_friend_team', context: 'school', minAge: 8, maxAge: 14, identities: ['woman', 'man', 'nonbinary', 'trans_woman', 'trans_man', 'genderfluid'],
    title: 'เลือกทีมวิ่งผลัดสีกีฬา',
    text: 'หัวหน้าสีบอกว่า "ทีมชายหญิงแยกกัน" แต่ {who} วิ่งเร็วที่สุดในกลุ่มและอยากอยู่ทีมเดียวกับคุณ',
    choices: { defend: 'เสนอให้ทดสอบความเร็วแล้วเลือกคนเร็วที่สุดเข้าทีม', respect: 'ชวนเข้าทีมและเชียร์ให้เต็มที่', ignore: 'ปล่อยให้หัวหน้าสีตัดสิน', disrespect: 'บอกว่าไม่ต้องรับเพราะเป็นอีกเพศ' },
    lesson: 'กีฬาและการแข่งขันเลือกคนที่ความสามารถและความตั้งใจ ไม่ควรแยกด้วยเพศอย่างเดียว' },
  { id: 'enc_friend_snack', context: 'public', minAge: 8, maxAge: 14, identities: ['woman', 'man', 'nonbinary', 'trans_woman', 'trans_man', 'genderfluid'],
    title: 'ร้านขนมหน้าโรงเรียน',
    text: '{who} มีเงินไม่พอซื้อขนมที่อยากกิน และมีเด็กอื่นล้อว่า "ผู้ชาย/ผู้หญิงต้องซื้อให้ได้เองสิ" ขณะที่คุณถือเหรียญอยู่พอดี',
    lesson: 'การแบ่งปันและช่วยเหลือกันไม่เกี่ยวกับเพศ เพื่อนที่ใจดีคือเพื่อนที่ดี' },
  { id: 'enc_public_bus', context: 'public', minAge: 8, maxAge: 99, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual', 'nonbinary'],
    title: 'บนรถเมล์ตอนเย็น',
    text: '{who} ถูกชายแปลกหน้าเบียดและถูกเนื้อต้องตัวบนรถที่แออัด เจ้าตัวพยายามขยับหนีแต่ไม่มีที่ให้',
    choices: { defend: 'เข้าไปยืนกั้น พูดเสียงดังให้เขาหยุด และขอให้คนขับช่วย', respect: 'ชวนคุยและแลกที่ยืนให้เขาปลอดภัย', ignore: 'ทำเป็นไม่เห็น', disrespect: 'บอกว่า "รถแออัดเป็นเรื่องปกติ อย่าคิดมาก"' },
    lesson: 'ที่สาธารณะต้องปลอดภัยสำหรับทุกเพศ การลงมือช่วยเมื่อเห็นการคุกคามช่วยให้คนกล้าขอความช่วยเหลือมากขึ้น' },
  { id: 'enc_public_hospital', context: 'public', minAge: 18, maxAge: 99, identities: ['trans_woman', 'trans_man', 'gay_man', 'lesbian', 'nonbinary', 'genderfluid'],
    title: 'รอพบหมอที่โรงพยาบาล',
    text: 'พยาบาลเรียกชื่อในบัตรประชาชนของ {who} เสียงดังกลางห้องรอ แล้วถามคำถามส่วนตัวต่อหน้าผู้ป่วยคนอื่น คนในห้องหันมามอง',
    choices: { defend: 'บอกพยาบาลอย่างสุภาพให้ถามเรื่องส่วนตัวในห้องตรวจ', respect: 'นั่งข้างเขาและชวนคุยให้สบายใจ', ignore: 'ก้มหน้าเล่นโทรศัพท์', disrespect: 'กระซิบวิจารณ์กับคนข้างๆ' },
    lesson: 'ทุกคนมีสิทธิ์ได้รับบริการสุขภาพอย่างสุภาพและเป็นส่วนตัว โดยไม่ถูกตีตราจากเพศสภาพ' },
  { id: 'enc_public_police', context: 'public', minAge: 18, maxAge: 99, identities: ['woman', 'trans_woman', 'lesbian', 'bisexual'],
    title: 'ไปแจ้งความที่สถานีตำรวจ',
    text: '{who} ไปแจ้งความเรื่องถูกคุกคาม แต่เจ้าหน้าที่ถามว่า "แต่งตัวแบบไหนมา" และบอกว่า "เรื่องเล็กน้อย ไม่ต้องแจ้งก็ได้"',
    choices: { defend: 'ยืนยันกับเจ้าหน้าที่ว่าต้องรับเรื่องตามขั้นตอนและบันทึกให้ถูกต้อง', respect: 'อยู่เป็นเพื่อนและช่วยจดรายละเอียดเหตุการณ์', ignore: 'บอกว่า "คงทำอะไรไม่ได้"', disrespect: 'พูดว่า "ก็จริงนะ แต่งตัวแบบนั้นเอง"' },
    lesson: 'การโทษผู้ถูกกระทำทำให้คนไม่กล้าขอความช่วยเหลือ ความผิดอยู่ที่ผู้กระทำเสมอ' },
  { id: 'enc_public_sport', context: 'public', minAge: 12, maxAge: 99, identities: ['man', 'gay_man', 'trans_man', 'bisexual'],
    title: 'ในยิมออกกำลังกาย',
    text: '{who} ร้องไห้หลังเพิ่งได้ข่าวร้ายจากที่บ้าน คนรอบข้างล้อว่า "ผู้ชายร้องไห้ได้ไง อ่อนแอ"',
    choices: { defend: 'บอกทุกคนว่าการร้องไห้เป็นเรื่องปกติของทุกเพศ และนั่งข้างเขา', respect: 'ยื่นน้ำให้และถามว่าอยากคุยไหม', ignore: 'ใส่หูฟังและออกกำลังต่อ', disrespect: 'หัวเราะร่วมวงล้อ' },
    lesson: 'ความรู้สึกไม่มีเพศ การให้ผู้ชายแสดงอารมณ์ได้ช่วยลดปัญหาสุขภาพจิตและความรุนแรงในสังคม' },
  { id: 'enc_family_career', context: 'family', minAge: 15, maxAge: 40, identities: ['woman', 'man', 'lesbian', 'gay_man'],
    title: 'ญาติคุยเรื่องอาชีพในอนาคต',
    text: 'ญาติ ({who}) บอกว่าอยากเป็นนักบิน/เชฟ/ช่างซ่อมรถ/พยาบาล แต่ผู้ใหญ่ตอบว่า "อาชีพนั้นไม่เหมาะกับผู้ชาย/ผู้หญิง เลือกอย่างอื่นเถอะ"',
    lesson: 'อาชีพไม่ควรถูกกำหนดด้วยเพศ ทุกคนควรเลือกเส้นทางตามความถนัดและความฝัน' },
  { id: 'enc_family_marriage', context: 'family', minAge: 18, maxAge: 99, identities: ['gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man'],
    title: 'ญาติถามเรื่องแต่งงาน',
    text: 'ในวงข้าวญาติ {who} ถูกถามซ้ำๆ ว่า "เมื่อไหร่จะแต่งงานมีลูก" แล้วมีคนพูดว่า "ถ้าเป็นแบบนี้ก็ไม่มีใครสืบสกุล"',
    choices: { defend: 'บอกผู้ใหญ่ว่าความรักและครอบครัวมีหลายแบบ และให้เลิกถามเรื่องนี้', respect: 'ชวนเขาไปช่วยเตรียมของและเปลี่ยนหัวข้อคุย', ignore: 'นั่งเงียบ', disrespect: 'พูดตามว่า "จริงๆ ควรทำตามธรรมเนียม"' },
    lesson: 'ครอบครัวที่มีความรักและการดูแลซึ่งกันและกันคือครอบครัว การกดดันเรื่องแต่งงานทำร้ายความรู้สึกของคนที่รักกัน' },
  { id: 'enc_elder_care', context: 'family', minAge: 40, maxAge: 99, identities: ['woman', 'man', 'gay_man', 'lesbian', 'trans_woman', 'trans_man'],
    title: 'ดูแลผู้สูงอายุในครอบครัว',
    text: 'เมื่อพ่อแม่ป่วย ญาติทุกคนเสนอว่า "ให้ลูกสาว/ผู้หญิงลาออกมาดูแล" ขณะที่ {who} ก็มีงานของตัวเองเช่นกัน',
    choices: { defend: 'เสนอให้ทุกคนแบ่งหน้าที่ดูแลและค่าใช้จ่ายเท่าๆ กัน', respect: 'อาสาผลัดเวรกับเขาและถามความต้องการของเขา', ignore: 'ปล่อยให้เป็นเรื่องของคนอื่น', disrespect: 'พูดว่า "นี่เป็นหน้าที่ของผู้หญิงอยู่แล้ว"' },
    lesson: 'การดูแลผู้สูงอายุเป็นความรับผิดชอบของทุกเพศ การผลักภาระให้ผู้หญิงคนเดียวทำให้เกิดความเหลื่อมล้ำ' },
  { id: 'enc_public_parade', context: 'public', minAge: 15, maxAge: 99, identities: ['gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'ขบวนพาเหรดความหลากหลายในเมือง',
    text: 'มีงานเดินขบวนเพื่อความเท่าเทียมทางเพศ {who} เป็นหนึ่งในผู้เข้าร่วม ข้างถนนมีทั้งคนโบกมือและคนตะโกนต่อว่า',
    choices: { defend: 'ไปร่วมเดินขบวนหรือยืนอยู่ข้างทางเพื่อสนับสนุนอย่างเปิดเผย', respect: 'ปรบมือและทักทายผู้ร่วมงาน', ignore: 'เดินผ่านไป', disrespect: 'ตะโกนต่อว่าเหมือนคนอื่น' },
    lesson: 'การรณรงค์เพื่อสิทธิความเท่าเทียมเป็นการเรียกร้องให้ทุกคนมีสิทธิ์เท่ากัน ซึ่งไม่ได้ลดสิทธิ์ของใคร' },
  { id: 'enc_public_market', context: 'public', minAge: 6, maxAge: 99, identities: ['woman', 'man', 'bisexual', 'genderfluid', 'nonbinary', 'lesbian', 'gay_man'],
    title: 'แม่ค้าในตลาดกับลูกค้าคนหนึ่ง',
    text: 'ลูกค้า ({who}) ถูกแม่ค้าอีกร้านพูดว่า "ไม่ต้องมาต่อราคาหรอก ดูแล้วเป็นพวกไม่ทำงานทำการ" เพราะการแต่งตัวและท่าทาง',
    lesson: 'อคติจากรูปลักษณ์และเพศสภาพทำให้ผู้คนถูกปฏิบัติไม่เท่ากันแม้ในเรื่องเล็กๆ ประจำวัน' },
  { id: 'enc_family_dinner', context: 'family', minAge: 10, maxAge: 99, identities: ['gay_man', 'lesbian', 'bisexual', 'trans_woman', 'trans_man', 'nonbinary', 'genderfluid'],
    title: 'งานเลี้ยงญาติ',
    text: 'ญาติสนิท ({who}) พาคนรักมาแนะนำ ผู้ใหญ่บางคนเงียบแล้วเปลี่ยนเรื่อง บางคนพูดว่า "ทำไมไม่เป็นเหมือนคนอื่นเขา"',
    lesson: 'การได้รับการยอมรับจากครอบครัวเป็นเกราะสำคัญของสุขภาพใจ ครอบครัวหลากหลายก็คือครอบครัว' },
  { id: 'enc_family_chores', context: 'family', minAge: 8, maxAge: 99, identities: ['woman', 'man', 'lesbian', 'gay_man'],
    title: 'แบ่งงานบ้านหลังมื้อเย็น',
    text: 'ญาติคนหนึ่ง ({who}) ถูกเรียกให้ล้างจานคนเดียวทั้งที่คนอื่นนั่งดูทีวี ผู้ใหญ่พูดว่า "เป็นงานของผู้หญิง/ผู้ชายอยู่แล้ว"',
    lesson: 'การแบ่งงานบ้านตามความสะดวกและความยุติธรรม ไม่ใช่ตามเพศ ช่วยให้ครอบครัวมีความสุขมากขึ้น' }
];

const CHOICES = {
  defend: 'ออกตัวปกป้อง บอกว่าไม่เหมาะและช่วยให้เขารู้สึกปลอดภัย',
  respect: 'ทักทายและรับฟังด้วยความเคารพ ใช้ชื่อและคำที่เขาอยากให้เรียก',
  ignore: 'เดินผ่านไป ไม่อยากยุ่ง',
  disrespect: 'หัวเราะตามหรือล้อเลียนไปด้วย'
};

/** แทน {who} ด้วยป้ายเพศภาษาอังกฤษ ให้ประโยคไทยอ่านลื่น: "(Label)" ในวงเล็บ หรือ "เพื่อนคนนี้ (Label)" เมื่อเป็นประธาน */
export function fillWho(text, label) {
  return String(text).replaceAll('({who})', `(${label})`).replaceAll('{who}', `เพื่อนคนนี้ (${label})`);
}

export function getEncounterScenario(state, npc) {
  const age = Number(state.profile?.age || 0);
  const ctxs = contextsForAge(age);
  const extra = state.equality?.aiScenarios || [];
  const pool = [...SCENARIOS, ...extra].filter((s) => ctxs.includes(s.context) && age >= s.minAge && age <= s.maxAge && s.identities.includes(npc.identity));
  if (!pool.length) return null;
  const eq = state.equality;
  const seen = new Set((eq?.history || []).map((h) => h.scenarioId));
  const focus = eq ? getFocus(eq) : { contexts: [] };
  const weights = pool.map((sc) => 1 + (seen.has(sc.id) ? 0 : 2) + (focus.contexts.includes(sc.context) ? 2 : 0) + (sc.aiGenerated && !seen.has(sc.id) ? 3 : 0));
  let r = hashString(`${npc.id}|${state.meta?.runId || ''}`) % weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { if (r < weights[i]) return pool[i]; r -= weights[i]; }
  return pool[0];
}

export function buildEncounter(state, npc) {
  const sc = getEncounterScenario(state, npc);
  if (!sc) return null;
  const who = getIdentity(npc.identity).label;
  const funny = COMEDY[sc.id] || (sc.aiGenerated ? [sc.title, sc.text] : null);
  return {
    scenarioId: sc.id,
    context: sc.context,
    aiGenerated: Boolean(sc.aiGenerated),
    npcId: npc.id,
    identity: npc.identity,
    title: funny ? funny[0] : sc.title,
    text: fillWho(funny ? funny[1] : sc.text, who),
    choices: Object.keys(TONES).map((tone) => ({ tone, label: funny ? COMEDY_CHOICES[tone] : (sc.choices?.[tone] || CHOICES[tone]) }))
  };
}

const NICKNAMES = ['บอส', 'มายด์', 'ต้น', 'พลอย', 'เจ', 'ฟ้า', 'โอ๊ต', 'แพรว', 'ก้อง', 'นัท', 'มิ้นท์', 'ภูมิ', 'ใบเตย', 'ไอซ์', 'ปลื้ม', 'กัปตัน', 'ขนมปัง', 'ข้าวปั้น', 'น้ำใส', 'เก่ง', 'ฝน', 'ตุ๊กตา', 'ไบร์ท', 'หมูแฮม'];
export const FRIEND_BOND_THRESHOLD = 12;

function nicknameFor(seedStr) { return NICKNAMES[hashString(seedStr) % NICKNAMES.length]; }

/** เพื่อนร่วมห้อง/ต่างเพศที่ผูกมิตรแล้วจะถูกเพิ่มเข้ารายชื่อเพื่อนในแท็บความสัมพันธ์ */
export function addFriendFromEncounter(state, npc, givenName = null) {
  const eq = ensureEquality(state);
  const id = `friend_${npc.id}`;
  state.relationships ||= {};
  state.relationships.npcs ||= [];
  if (state.relationships.npcs.some((n) => n.id === id)) return null;
  const name = givenName || nicknameFor(`${state.meta?.runId || ''}${npc.id}`);
  const friend = {
    id, archetypeId: 'npc_arch_random_friend', name, fullName: name, shortName: name,
    roleTitle: 'เพื่อนจากเมืองพิกเซล', genderIdentity: npc.identity, identityShared: true,
    relationship: Math.max(45, Math.min(80, 40 + (eq.relations[npc.id] || 0))), isAlive: true, metAtAge: Number(state.profile?.age || 0)
  };
  state.relationships.npcs.push(friend);
  return friend;
}

/** นักเรียนร่วมห้องตอนเริ่มช่วงประถมปลาย: หลากหลายเพศ เป็นเพื่อนร่วมชั้นที่คุณเริ่มรู้จัก */
export function createClassmates(state) {
  state.relationships ||= {};
  state.relationships.npcs ||= [];
  const teen = Number(state.profile?.age || 0) >= 13;
  const flip = hashString(String(state.meta?.runId || 'x')) % 2;
  const ids = teen
    ? ['woman', 'man', flip ? 'lesbian' : 'gay_man', 'bisexual', 'nonbinary', flip ? 'trans_woman' : 'trans_man']
    : ['woman', 'man', 'woman', 'man', 'nonbinary', flip ? 'trans_woman' : 'trans_man'];
  ids.forEach((identity, i) => {
    const id = `classmate_${i}`;
    if (state.relationships.npcs.some((n) => n.id === id)) return;
    const name = nicknameFor(`${state.meta?.runId || ''}classmate${i}`);
    state.relationships.npcs.push({
      id, archetypeId: 'npc_arch_random_friend', name, fullName: name, shortName: name,
      roleTitle: 'เพื่อนร่วมห้อง', genderIdentity: identity, identityShared: true,
      relationship: 40 + (hashString(id + name) % 15), isAlive: true, metAtAge: Number(state.profile?.age || 0)
    });
  });
}

export function townIndexLabel(index) {
  if (index >= 80) return 'เมืองแห่งการยอมรับ';
  if (index >= 60) return 'เมืองเปิดใจ';
  if (index >= 40) return 'เมืองกำลังเรียนรู้';
  if (index >= 20) return 'เมืองที่ยังมีอคติ';
  return 'เมืองที่ปิดกั้น';
}

export function resolveEncounter(state, npc, tone) {
  const eq = ensureEquality(state);
  const sc = getEncounterScenario(state, npc);
  const t = TONES[tone];
  if (!sc || !t) return { success: false, message: 'ไม่สามารถเริ่มเหตุการณ์นี้ได้' };
  if (eq.metIds.includes(npc.id)) return { success: false, message: 'ปีนี้คุณพบเขาไปแล้ว' };

  const before = eq.townIndex;
  eq.townIndex = Math.max(0, Math.min(100, eq.townIndex + t.delta));
  eq.relations[npc.id] = Math.max(-100, Math.min(100, (eq.relations[npc.id] || 0) + t.rel));
  eq.metIds.push(npc.id);
  const deltas = applyStatEffects(state, t.effects);
  const age = Number(state.profile?.age || 0);
  eq.history.push({ age, scenarioId: sc.id, context: sc.context, identity: npc.identity, tone, lesson: sc.lesson });
  eq.localAnalysis = analyzeEqualityBehavior(state);
  const bonded = eq.relations[npc.id] >= FRIEND_BOND_THRESHOLD ? addFriendFromEncounter(state, npc) : null;
  if (eq.history.length > 200) eq.history.shift();

  state.turn?.lifeFeedLog?.push({
    age,
    monthTh: 'ตลอดปี',
    type: 'equality',
    title: `พบปะ: ${sc.title}`,
    message: `คุณเลือก "${t.label}" ดัชนีเมืองเท่าเทียม ${before} เป็น ${eq.townIndex}`
  });
  const funny = COMEDY[sc.id] || sc.aiGenerated;
  return { success: true, newFriend: bonded, tone, toneLabel: t.label, deltas, indexBefore: before, indexAfter: eq.townIndex, lesson: funny ? COMEDY_LESSON_PREFIX + sc.lesson : sc.lesson, message: `${funny ? COMEDY_RESULTS[tone] + ' • ' : ''}ดัชนีความเท่าเทียมของเมือง ${eq.townIndex}/100` };
}

export function summarizeEquality(state) {
  const eq = ensureEquality(state);
  const counts = { defend: 0, respect: 0, ignore: 0, disrespect: 0 };
  for (const h of eq.history) counts[h.tone] = (counts[h.tone] || 0) + 1;
  const lessons = [...new Set(eq.history.filter((h) => h.tone === 'ignore' || h.tone === 'disrespect').map((h) => h.lesson))].slice(0, 3);
  const friends = (state.relationships?.npcs || []).filter((n) => String(n.id).startsWith('friend_') || String(n.id).startsWith('classmate_'));
  const friendGroups = new Set(friends.map((n) => n.genderIdentity).filter(Boolean));
  return { townIndex: eq.townIndex, label: townIndexLabel(eq.townIndex), counts, total: eq.history.length, lessons, friendCount: friends.length, friendGroupCount: friendGroups.size };
}

const TONE_SCORE = { defend: 2, respect: 1, ignore: -0.5, disrespect: -2 };
export const CONTEXT_LABELS = { school: 'โรงเรียน', work: 'ที่ทำงาน', family: 'ครอบครัว', public: 'ที่สาธารณะ' };
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

export function getFocus(eq) {
  const ai = eq.aiCoach;
  const base = ai?.focus || eq.localAnalysis?.focus;
  return { identities: base?.identities || [], contexts: base?.contexts || [] };
}

/** วิเคราะห์พฤติกรรมของผู้เล่นจากประวัติการพบปะ (ทำงานในเครื่อง ไม่ต้องใช้ AI) */
export function analyzeEqualityBehavior(state) {
  const eq = ensureEquality(state);
  const hist = eq.history;
  const byIdentity = {};
  const byContext = {};
  for (const h of hist) {
    const sc = SCENARIOS.find((x) => x.id === h.scenarioId);
    const ctx = h.context || sc?.context;
    const v = TONE_SCORE[h.tone] ?? 0;
    (byIdentity[h.identity] ||= []).push(v);
    if (ctx) (byContext[ctx] ||= []).push(v);
  }
  const rank = (map) => Object.entries(map).map(([k, v]) => ({ key: k, avg: avg(v), count: v.length })).sort((a, b) => a.avg - b.avg);
  const ids = rank(byIdentity);
  const ctxs = rank(byContext);
  const weakIdentities = ids.filter((x) => x.avg < 0.5).slice(0, 3);
  const weakContexts = ctxs.filter((x) => x.avg < 0.5).slice(0, 2);
  const strongIdentities = [...ids].reverse().filter((x) => x.avg >= 1).slice(0, 2);
  const recent = hist.slice(-5).map((h) => TONE_SCORE[h.tone] ?? 0);
  const earlier = hist.slice(-10, -5).map((h) => TONE_SCORE[h.tone] ?? 0);
  const trend = earlier.length && recent.length ? Math.round((avg(recent) - avg(earlier)) * 100) / 100 : 0;
  const total = hist.length;
  const label = (id) => getIdentity(id).label;
  const parts = [];
  if (total < 3) parts.push('ยังมีข้อมูลน้อย ลองพบปะผู้คนในเมืองให้ครบอย่างน้อย 3 คนเพื่อให้วิเคราะห์ได้แม่นขึ้น');
  else {
    if (strongIdentities.length) parts.push(`คุณให้เกียรติ ${strongIdentities.map((x) => label(x.key)).join(' และ ')} ได้ดี`);
    if (weakIdentities.length) parts.push(`จุดที่ควรพัฒนาคือการตอบสนองต่อ ${weakIdentities.map((x) => label(x.key)).join(' และ ')}`);
    if (weakContexts.length) parts.push(`โดยเฉพาะเมื่ออยู่ใน${weakContexts.map((x) => CONTEXT_LABELS[x.key] || x.key).join(' และ ')}`);
    if (trend > 0.3) parts.push('แนวโน้มล่าสุดดีขึ้นอย่างชัดเจน');
    else if (trend < -0.3) parts.push('ช่วงหลังคุณเริ่มเมินเฉยหรือเหยียดมากขึ้น ลองทบทวนข้อคิดที่ผ่านมา');
    if (!weakIdentities.length && !weakContexts.length) parts.push('ภาพรวมคุณเคารพความแตกต่างได้สม่ำเสมอ เมืองจะให้โจทย์ที่ท้าทายขึ้น');
  }
  return {
    source: 'local', age: Number(state.profile?.age || 0), total, avgScore: Math.round(avg(hist.map((h) => TONE_SCORE[h.tone] ?? 0)) * 100) / 100, trend,
    weakIdentities: weakIdentities.map((x) => x.key), weakContexts: weakContexts.map((x) => x.key), strongIdentities: strongIdentities.map((x) => x.key),
    coachingTh: parts.join(' ') + (parts.length ? ' ' : '') + (total >= 3 ? 'เมืองจะปรับเหตุการณ์ในอนาคตให้ตรงกับจุดที่ควรฝึก' : ''),
    focus: { identities: weakIdentities.map((x) => x.key), contexts: weakContexts.map((x) => x.key) }
  };
}

export const FOCUS_IDENTITY_IDS = IDENTITY_IDS;
export const FOCUS_CONTEXT_IDS = Object.keys(CONTEXT_LABELS);
