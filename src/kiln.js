// Kiln API (Bricksum NPU cloud, OpenAI-compatible). Every call is tagged with a flow and logged:
// tokens, latency, and an energy upper bound (card TDP × wall-clock), so the README can report per flow.
import { cfg } from './config.js';

export const calls = [];
let model = null;

async function raw(m, messages, max_tokens) {
  const t0 = Date.now();
  const r = await fetch(cfg.kilnBase + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + cfg.kilnKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: m, messages, max_tokens, temperature: 0 }),
    signal: AbortSignal.timeout(45000), // a hung socket must not freeze a voyage; ask() retries
  });
  return { status: r.status, body: await r.json().catch(() => ({})), ms: Date.now() - t0 };
}

export async function activeModel() {
  if (model) return model;
  const probe = await raw(cfg.kilnModel, [{ role: 'user', content: 'ping' }], 1).catch((e) => ({ status: 0, body: { error: { code: String(e.cause?.code || e.name) } } }));
  model = probe.status === 200 ? cfg.kilnModel : cfg.kilnFallback;
  if (model !== cfg.kilnModel) console.warn(`[kiln] ${cfg.kilnModel} → HTTP ${probe.status} ${probe.body?.error?.code || ''}; using ${model}`);
  return model;
}

// One JSON-returning call. `/no_think` stops Qwen3 from spending hundreds of hidden reasoning tokens.
export async function ask(flow, system, user, max_tokens = 400) {
  const m = await activeModel();
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user + '\n/no_think' }];
  let r;
  for (let i = 0; i < 4; i++) { // retry network blips and 429/5xx; never retry a 4xx answer
    r = await raw(m, messages, max_tokens).catch((e) => ({ status: 0, body: { error: String(e.cause?.code || e) }, ms: 0 }));
    if (r.status === 200 || (r.status >= 400 && r.status < 500 && r.status !== 429)) break;
    await new Promise((x) => setTimeout(x, 2000 * (i + 1)));
  }
  if (r.status !== 200) throw new Error(`Kiln ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
  const u = r.body.usage || {};
  const text = (r.body.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const call = {
    at: new Date().toISOString(), flow, model: m, id: r.body.id, ms: r.ms,
    prompt: u.prompt_tokens || 0, completion: u.completion_tokens || 0, reasoning: u.completion_tokens_details?.reasoning_tokens || 0,
    joulesMax: +((cfg.npuWatts * r.ms) / 1000).toFixed(1),
  };
  calls.push(call);
  const j = text.match(/\{[\s\S]*\}/);
  let json = null; try { json = j && JSON.parse(j[0]); } catch {}
  return { json, text, call };
}

export function byFlow(list = calls) {
  const out = {};
  for (const c of list) {
    const f = (out[c.flow] ||= { calls: 0, prompt: 0, completion: 0, reasoning: 0, ms: 0, joulesMax: 0 });
    f.calls++; f.prompt += c.prompt; f.completion += c.completion; f.reasoning += c.reasoning; f.ms += c.ms; f.joulesMax = +(f.joulesMax + c.joulesMax).toFixed(1);
  }
  return out;
}
