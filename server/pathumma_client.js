export const PATHUMMA_URL = 'https://api.aiforthai.in.th/textqa/completion';

/** AIforThai textqa.generate sends form fields and an Apikey header. */
export async function callPathumma({ system, user, temperature = 0.4, maxTokens = 1024 }, { fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const key = env.PATHUMMA_API_KEY;
  if (!key) throw new Error('ยังไม่ได้ตั้งค่า PATHUMMA_API_KEY');
  const body = new URLSearchParams({
    instruction: `${user}\n\nตอบเป็น JSON object เท่านั้น`,
    system_prompt: system,
    max_new_tokens: String(maxTokens),
    temperature: String(temperature),
    return_json: 'false'
  });
  const response = await fetchImpl(env.PATHUMMA_API_URL || PATHUMMA_URL, {
    method: 'POST',
    headers: { Apikey: key, 'X-lib': 'ai4thai-lib', 'content-type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Pathumma ตอบกลับสถานะ ${response.status}`);
  const data = await response.json();
  const content = data?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Pathumma ไม่ส่งข้อความกลับมา');
  return content.replace(/<think>[\s\S]*?<\/think>/g, '');
}
