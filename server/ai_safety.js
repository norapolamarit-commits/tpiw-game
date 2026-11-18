const THAI = /[\u0E00-\u0E7F]/u;
const FORBIDDEN = [
  /ผิดปกติ|วิปริต|น่ารังเกียจ|ป่วยจิต|เป็นโรค|เบี่ยงเบน|ผิดเพศ|แปลงเพศเพื่อหลอก/u,
  /เหี้ย|สัส|ควย|หี|เย็ด|แม่ง|อีดอก/u,
  /โป๊|เปลือย|ร่วมเพศ|มีเซ็กซ์|ล่วงละเมิดทางเพศ/u,
  /https?:\/\/|www\.|@[\w.-]+|\b\w+[.-]?\w+@\w+\.\w+\b/iu,
  /(?:โทร|เบอร์|เลขบัตร|ที่อยู่|บ้านเลขที่)\s*[:：]?\s*\d{5,}/u,
  /\p{Extended_Pictographic}/u
];
const ROMANCE = /จีบ|เป็นแฟน|จูบ|เดต|เดท|หมั้น|แต่งงาน|แอบคบ|กิ๊ก|รักใคร่|ชอบเธอแบบแฟน/u;

export function assertSafeAiText(text, { age = 18, maxLength = 500 } = {}) {
  if (typeof text !== 'string' || !THAI.test(text) || text.length > maxLength || FORBIDDEN.some((pattern) => pattern.test(text))) throw new Error('ข้อความ AI ไม่ผ่านตัวกรองเนื้อหา');
  if (Number(age) < 16 && ROMANCE.test(text)) throw new Error('เนื้อหาโรแมนติกไม่เหมาะกับอายุผู้เล่น');
  return text;
}
