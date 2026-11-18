/**
 * ตรวจสอบความถูกต้องเชิงโครงสร้างของไฟล์ฐานข้อมูลเกมก่อน merge
 * - ตรวจ JSON ทุกไฟล์ตาม DATA_MANIFEST
 * - ตรวจจำนวน events ให้ตรงกับ total_events และ quota_breakdown.total
 * - ตรวจ event_id ซ้ำ และ choices / choice_id ที่หายหรือซ้ำภายใน event
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_MANIFEST } from '../js/core/db.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const errors = [];
const seenEventIds = new Map();
let filesChecked = 0;
let eventsChecked = 0;
let choicesChecked = 0;

for (const [manifestKey, filename] of Object.entries(DATA_MANIFEST)) {
  const filePath = resolve(projectRoot, 'data', filename);
  let data;

  try {
    data = JSON.parse(await readFile(filePath, 'utf8'));
    filesChecked += 1;
  } catch (error) {
    errors.push(`[${manifestKey}] ${filename}: อ่านหรือ parse JSON ไม่สำเร็จ: ${error.message}`);
    continue;
  }

  // ไฟล์หลักบางชุด (เช่น Core Rules, Traits, Market) ไม่ใช่ Event Pool
  // ตรวจ event-specific fields เฉพาะไฟล์ที่มี events property
  if (data.events === undefined) continue;
  if (!Array.isArray(data.events)) {
    errors.push(`[${manifestKey}] ${filename}: events ต้องเป็น array`);
    continue;
  }

  const actualCount = data.events.length;
  if (data.total_events !== actualCount) {
    errors.push(`[${manifestKey}] ${filename}: total_events ระบุ ${data.total_events} แต่พบจริง ${actualCount}`);
  }
  if (
    data.quota_breakdown &&
    Object.hasOwn(data.quota_breakdown, 'total') &&
    data.quota_breakdown.total !== actualCount
  ) {
    errors.push(`[${manifestKey}] ${filename}: quota_breakdown.total ระบุ ${data.quota_breakdown.total} แต่พบจริง ${actualCount}`);
  }

  for (const [eventIndex, event] of data.events.entries()) {
    eventsChecked += 1;
    const eventId = event?.event_id;

    if (typeof eventId !== 'string' || eventId.trim() === '') {
      errors.push(`[${filename}] events[${eventIndex}]: event_id ว่างหรือไม่ถูกต้อง`);
    } else if (seenEventIds.has(eventId)) {
      errors.push(`[${filename}] event_id ซ้ำ "${eventId}" (พบก่อนหน้าใน ${seenEventIds.get(eventId)})`);
    } else {
      seenEventIds.set(eventId, filename);
    }

    if (!Array.isArray(event?.choices) || event.choices.length === 0) {
      errors.push(`[${filename}] ${eventId || `events[${eventIndex}]`}: ไม่มี choices ที่ใช้งานได้`);
      continue;
    }
    if (event.choices.length < 3) {
      errors.push(`[${filename}] ${eventId}: ต้องมีอย่างน้อย 3 choices (พบ ${event.choices.length})`);
    }

    const choiceIds = new Set();
    for (const [choiceIndex, choice] of event.choices.entries()) {
      choicesChecked += 1;
      const choiceId = choice?.choice_id;
      if (typeof choiceId !== 'string' || choiceId.trim() === '') {
        errors.push(`[${filename}] ${eventId}: choices[${choiceIndex}] ไม่มี choice_id`);
      } else if (choiceIds.has(choiceId)) {
        errors.push(`[${filename}] ${eventId}: choice_id ซ้ำ "${choiceId}"`);
      } else {
        choiceIds.add(choiceId);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`พบปัญหาฐานข้อมูล ${errors.length} รายการ:\n- ${errors.join('\n- ')}`);
  process.exitCode = 1;
} else {
  console.log(`ตรวจผ่าน: ${filesChecked} files, ${eventsChecked} events, ${choicesChecked} choices`);
}
