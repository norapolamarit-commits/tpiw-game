import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { generateAiProposal, proposalToCard } from './ai_event.js';
import { CoachRequestSchema, generateEqualityCoaching, validateCoach } from './ai_equality.js';
import { DialogueRequestSchema, ScenarioRequestSchema, generateDialogue, generateScenario, validateDialogue, validateScenario } from './ai_content.js';
import { RANDOM_EVENT_TEMPLATES, toLegacyEventCard } from '../js/engine/random_event_templates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };

const RequestSchema = z.object({
  runId: z.string().max(120), age: z.number().int().min(0).max(100),
  profile: z.record(z.string(), z.unknown()),
  stats: z.record(z.string(), z.unknown()),
  finance: z.record(z.string(), z.unknown()),
  careerAndEdu: z.record(z.string(), z.unknown()),
  partner: z.record(z.string(), z.unknown()).nullable().optional(),
  recentEvents: z.array(z.record(z.string(), z.unknown())).max(12),
  memories: z.array(z.record(z.string(), z.unknown())).max(20),
  npcs: z.array(z.record(z.string(), z.unknown())).max(30),
  eligibleCategories: z.array(z.string()).min(1).max(12),
  continuityConstraints: z.array(z.string()).max(20)
});

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readBody(request) {
  let body = '';
  for await (const part of request) {
    body += part;
    if (body.length > 100_000) throw new Error('คำขอมีขนาดใหญ่เกินไป');
  }
  return JSON.parse(body);
}

export async function handleAiRequest(request, response, generator = generateAiProposal) {
  let context;
  try {
    context = RequestSchema.parse(await readBody(request));
  } catch {
    json(response, 400, { error: 'ข้อมูลเกมไม่ถูกต้อง' });
    return;
  }
  try {
    const proposal = await generator(context);
    const card = proposalToCard(proposal, `ai_${context.runId}_${context.age}`, context.age);
    json(response, 200, { event: card, aiGenerated: true });
  } catch {
    const template = RANDOM_EVENT_TEMPLATES.find((event) =>
      event.minAge <= context.age && event.maxAge >= context.age && context.eligibleCategories.includes(event.category)
    );
    json(response, 200, { event: template ? toLegacyEventCard(template) : null, aiGenerated: false });
  }
}

export async function handleCoachRequest(request, response, generator = generateEqualityCoaching) {
  let context;
  try {
    context = CoachRequestSchema.parse(await readBody(request));
  } catch {
    json(response, 400, { error: 'ข้อมูลไม่ถูกต้อง' });
    return;
  }
  try {
    json(response, 200, { aiGenerated: true, coach: validateCoach(await generator(context), context.age) });
  } catch {
    json(response, 200, { aiGenerated: false, coach: null });
  }
}

export async function handleContentRequest(request, response, kind, generators = { scenario: generateScenario, dialogue: generateDialogue }) {
  const schema = kind === 'scenario' ? ScenarioRequestSchema : DialogueRequestSchema;
  let context;
  try { context = schema.parse(await readBody(request)); } catch { json(response, 400, { error: 'ข้อมูลไม่ถูกต้อง' }); return; }
  try { const data = await generators[kind](context); json(response, 200, { aiGenerated: true, data: kind === 'scenario' ? validateScenario(data, context.age) : validateDialogue(data, context.age) }); }
  catch { json(response, 200, { aiGenerated: false, data: null }); }
}

export function createGameServer() {
  return http.createServer(async (request, response) => {
    if (['/api/random-event', '/api/equality-coach', '/api/ai-scenario', '/api/ai-dialogue'].includes(request.url) && request.method === 'POST') {
      const origin = request.headers.origin;
      let sameOrigin = true;
      if (origin) {
        try { sameOrigin = new URL(origin).host === request.headers.host; }
        catch { sameOrigin = false; }
      }
      if (!sameOrigin) {
        json(response, 403, { error: 'ไม่อนุญาตคำขอจากเว็บไซต์อื่น' });
        return;
      }
      if (request.url === '/api/equality-coach') await handleCoachRequest(request, response);
      else if (request.url === '/api/ai-scenario') await handleContentRequest(request, response, 'scenario');
      else if (request.url === '/api/ai-dialogue') await handleContentRequest(request, response, 'dialogue');
      else await handleAiRequest(request, response);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405); response.end(); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
    catch { response.writeHead(400); response.end(); return; }
    const target = path.resolve(ROOT, `.${pathname === '/' ? '/index.html' : pathname}`);
    const relative = path.relative(ROOT, target);
    if (!target.startsWith(`${ROOT}${path.sep}`) || relative.split(path.sep).some((segment) => segment.startsWith('.') || segment === 'node_modules' || segment === 'server')) {
      response.writeHead(404); response.end(); return;
    }
    try {
      const data = await fs.readFile(target);
      response.writeHead(200, { 'content-type': `${MIME[path.extname(target)] || 'application/octet-stream'}; charset=utf-8` });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(404); response.end(); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createGameServer().listen(PORT, HOST, () => console.log(`เกมพร้อมเล่นที่ http://${HOST}:${PORT}`));
}
