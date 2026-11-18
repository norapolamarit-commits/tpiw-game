/**
 * js/core/utils.js
 * ฟังก์ชันคำนวณพื้นฐาน, ระบบสุ่ม RNG, ฟอร์แมตสกุลเงินบาท และการตรวจสอบเงื่อนไข
 */

/**
 * สุ่มจำนวนเต็มในช่วง [min, max] (รวมขอบทั้งสองฝั่ง)
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function randomInt(min, max) {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

/**
 * สุ่มทศนิยมในช่วง [min, max]
 * @param {number} min
 * @param {number} max
 * @param {number} [decimals=4]
 * @returns {number}
 */
export function randomFloat(min, max, decimals = 4) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const val = Math.random() * (high - low) + low;
  return Number(val.toFixed(decimals));
}

/**
 * ทอยโอกาสสำเร็จเป็นเปอร์เซ็นต์ (0 - 100)
 * @param {number} percent โอกาสสำเร็จ เช่น 35 คือ 35%
 * @returns {boolean}
 */
export function rollChance(percent) {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  return Math.random() * 100 < percent;
}

/**
 * สุ่มหยิบสมาชิก 1 ตัวจาก Array
 * @template T
 * @param {T[]} arr
 * @returns {T|null}
 */
export function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * สับเปลี่ยนลำดับสมาชิกใน Array (Fisher-Yates Shuffle) โดยไม่แก้ไข Array ต้นฉบับ
 * @template T
 * @param {T[]} arr
 * @returns {T[]}
 */
export function shuffleArray(arr) {
  if (!Array.isArray(arr)) return [];
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * สุ่มเลือกข้อมูลตามค่าน้ำหนัก (Weighted Random)
 * รองรับทั้ง Array ของ Object เช่น [{ id: 'a', weight: 20 }] หรือกำหนด key/callback เอง
 * @template T
 * @param {T[]} items รายการตัวเลือก
 * @param {string|((item: T) => number)} [weightSelector='weight'] ชื่อฟิลด์น้ำหนัก หรือฟังก์ชันดึงน้ำหนัก
 * @returns {T|null}
 */
export function weightedRandom(items, weightSelector = 'weight') {
  if (!Array.isArray(items) || items.length === 0) return null;

  const getWeight = typeof weightSelector === 'function'
    ? weightSelector
    : (item) => Number(item?.[weightSelector] ?? 0);

  let totalWeight = 0;
  const validItems = [];

  for (const item of items) {
    const w = getWeight(item);
    if (w > 0) {
      totalWeight += w;
      validItems.push({ item, weight: w });
    }
  }

  if (validItems.length === 0 || totalWeight <= 0) {
    return pickRandom(items);
  }

  let cursor = Math.random() * totalWeight;
  for (const entry of validItems) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.item;
    }
  }

  return validItems[validItems.length - 1].item;
}

/**
 * จำกัดค่าตัวเลขให้อยู่ในช่วง [min, max] (ค่าเริ่มต้น 0 - 100 สำหรับ Core Stats)
 * หาก max เป็น null หรือ undefined (เช่น แต้มบุญ merit ที่ไม่จำกัดเพดาน) จะจำกัดเฉพาะค่าต่ำสุด
 * @param {number} val
 * @param {number} [min=0]
 * @param {number|null} [max=100]
 * @returns {number}
 */
export function clampStat(val, min = 0, max = 100) {
  const num = Number.isFinite(Number(val)) ? Math.round(Number(val)) : 0;
  if (max === null || max === undefined) {
    return Math.max(min, num);
  }
  return Math.min(max, Math.max(min, num));
}

/**
 * ฟอร์แมตตัวเลขเป็นสกุลเงินบาทไทย
 * @param {number} amount จำนวนเงิน
 * @param {object} [options]
 * @param {boolean} [options.compact=false] แปลงเป็นหน่วยย่อ k / M / B หรือไม่
 * @param {boolean} [options.showPlus=false] แสดงเครื่องหมาย + นำหน้าค่าบวกหรือไม่
 * @param {boolean} [options.withSymbol=true] ต่อท้ายสัญลักษณ์ " ฿" หรือไม่
 * @returns {string} เช่น "12,500 ฿", "-3,000 ฿", "1.5M ฿"
 */
export function formatCurrency(amount, options = {}) {
  const {
    compact = false,
    showPlus = false,
    withSymbol = true
  } = options;

  const num = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const sign = num < 0 ? '-' : (showPlus && num > 0 ? '+' : '');
  const absVal = Math.abs(num);

  let formattedNumber;
  if (compact) {
    if (absVal >= 1_000_000_000) {
      formattedNumber = `${(absVal / 1_000_000_000).toFixed(absVal % 1_000_000_000 === 0 ? 0 : 2).replace(/\.?0+$/, '')}B`;
    } else if (absVal >= 1_000_000) {
      formattedNumber = `${(absVal / 1_000_000).toFixed(absVal % 1_000_000 === 0 ? 0 : 2).replace(/\.?0+$/, '')}M`;
    } else if (absVal >= 10_000) {
      formattedNumber = `${(absVal / 1_000).toFixed(absVal % 1_000 === 0 ? 0 : 1).replace(/\.0$/, '')}k`;
    } else {
      formattedNumber = Math.round(absVal).toLocaleString('th-TH');
    }
  } else {
    formattedNumber = Math.round(absVal).toLocaleString('th-TH');
  }

  return `${sign}${formattedNumber}${withSymbol ? ' ฿' : ''}`;
}

/**
 * ฟอร์แมตเงินบาทแบบย่อสำหรับแถบสถานะบนหน้าจอมือถือ
 * @param {number} amount
 * @returns {string}
 */
export function formatShortCurrency(amount) {
  return formatCurrency(amount, { compact: true, withSymbol: true });
}

/**
 * ดึงค่า Stat จาก playerState โดยรองรับทั้งโครงสร้าง playerState.stats[key] และ legacy alias (karma -> merit)
 * @param {object} playerState
 * @param {string} statKey
 * @returns {number}
 */
export function getPlayerStatValue(playerState, statKey) {
  if (!playerState) return 0;
  const normalizedKey = statKey === 'karma' ? 'merit' : statKey;

  if (normalizedKey === 'cash') {
    return Number(playerState.finance?.cash ?? playerState.cash ?? 0);
  }
  if (normalizedKey === 'net_worth') {
    return Number(playerState.finance?.netWorth ?? playerState.netWorth ?? 0);
  }
  if (playerState.stats && normalizedKey in playerState.stats) {
    return Number(playerState.stats[normalizedKey] ?? 0);
  }
  return Number(playerState[normalizedKey] ?? 0);
}

/**
 * รวบรวมป้ายสถานะ (Flags, Innate Traits, Talent Tags, Statuses) ทั้งหมดของผู้เล่นเป็น Set เดียวเพื่อเช็กเงื่อนไขได้รวดเร็ว
 * @param {object} playerState
 * @returns {Set<string>}
 */
export function getPlayerFlagSet(playerState) {
  const set = new Set();
  if (!playerState) return set;

  const sources = [
    playerState.flags,
    playerState.innateTraits,
    playerState.talentTags,
    playerState.statuses
  ];

  for (const src of sources) {
    if (Array.isArray(src)) {
      for (const item of src) {
        if (typeof item === 'string' && item) set.add(item);
      }
    } else if (src instanceof Set) {
      for (const item of src) set.add(item);
    }
  }
  return set;
}

/**
 * ตรวจสอบเงื่อนไขค่าสถานะและป้ายสถานะของผู้เล่น
 * รองรับทั้งการส่ง (reqStats, reqFlags, playerState) แบบมาตรฐาน
 * และรองรับ reqFlags ทั้งแบบ Array<string> หรือ Object { all, any, forbidden }
 *
 * @param {Record<string, number>|null|undefined} reqStats เช่น { intelligence: 60, health: 40 }
 * @param {string[]|{ all?: string[], any?: string[], forbidden?: string[] }|null|undefined} reqFlags
 * @param {object} playerState สถานะผู้เล่นปัจจุบัน
 * @param {object} [extraConditions={}] เงื่อนไขเสริม เช่น { reqAnyFlags: [], forbiddenFlags: [], minAge, maxAge, allowedClasses }
 * @returns {boolean}
 */
export function checkRequirement(reqStats, reqFlags, playerState, extraConditions = {}) {
  if (!playerState) return false;

  // 1. ตรวจสอบอายุ (ถ้ามีระบุใน extraConditions)
  const age = Number(playerState.profile?.age ?? playerState.age ?? 0);
  if (extraConditions.minAge !== undefined && age < extraConditions.minAge) return false;
  if (extraConditions.maxAge !== undefined && age > extraConditions.maxAge) return false;

  // 2. ตรวจสอบชนชั้นทางสังคม (ถ้ามีระบุ allowedClasses)
  if (Array.isArray(extraConditions.allowedClasses) && extraConditions.allowedClasses.length > 0) {
    const currentClass = playerState.profile?.currentClassId || playerState.profile?.spawnClassId;
    if (currentClass && !extraConditions.allowedClasses.includes(currentClass)) {
      return false;
    }
  }

  // 3. ตรวจสอบค่าสถานะขั้นต่ำ (reqStats)
  if (reqStats && typeof reqStats === 'object') {
    for (const [statKey, minVal] of Object.entries(reqStats)) {
      if (minVal === null || minVal === undefined) continue;
      const currentVal = getPlayerStatValue(playerState, statKey);
      if (currentVal < Number(minVal)) {
        return false;
      }
    }
  }

  // 4. ตรวจสอบป้ายสถานะ (Flags / Traits / Tags / Statuses)
  const activeFlags = getPlayerFlagSet(playerState);

  let reqAll = [];
  let reqAny = Array.isArray(extraConditions.reqAnyFlags) ? [...extraConditions.reqAnyFlags] : [];
  let forbidden = Array.isArray(extraConditions.forbiddenFlags) ? [...extraConditions.forbiddenFlags] : [];

  if (Array.isArray(reqFlags)) {
    reqAll = reqFlags;
  } else if (reqFlags && typeof reqFlags === 'object') {
    if (Array.isArray(reqFlags.all)) reqAll = reqFlags.all;
    if (Array.isArray(reqFlags.any)) reqAny.push(...reqFlags.any);
    if (Array.isArray(reqFlags.forbidden)) forbidden.push(...reqFlags.forbidden);
  }

  // ต้องมีครบทุกป้ายใน reqAll
  for (const flag of reqAll) {
    if (!activeFlags.has(flag)) return false;
  }

  // ต้องมีอย่างน้อย 1 ป้ายใน reqAny (กรณีที่ reqAny ไม่ได้ว่างเปล่า)
  if (reqAny.length > 0) {
    const hasAtLeastOne = reqAny.some((flag) => activeFlags.has(flag));
    if (!hasAtLeastOne) return false;
  }

  // ห้ามมีป้ายต้องห้ามใน forbidden
  for (const flag of forbidden) {
    if (activeFlags.has(flag)) return false;
  }

  return true;
}
