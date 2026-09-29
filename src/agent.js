// helm's navigator. The sailor states a destination in plain words; the agent reads the chain,
// charts every course the fleet can sail, decides (sail / decline), and executes on XRPL.
//   LLM (Kiln): intake (words → goal) · navigate (choose a course or decline, explain it)
//   code:       chain reads, backtest + Monte Carlo odds, guard, trade sizing, swaps, records
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { ask, calls } from './kiln.js';
import { build, chart, CAPTAINS } from './fleet.js';
import * as chain from './chain.js';

export const RULES = { maxBreach: 0.2, minHit: 0.5, dust: 25, slippage: 0.02 };
const NOW = new Date('2026-09-30T00:00:00Z');
const F = build();
const ASSET = Object.fromEntries(F.snap.assets.map((a) => [a.code, a]));
const sha = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const weeksTo = (iso) => Math.max(1, Math.round((new Date(iso) - NOW) / (7 * 864e5)));
const usd = (x) => '$' + Math.round(x).toLocaleString('en-US');
export const NAMES = { 0.04: 'Anchored', 0.08: 'Harbor breeze', 0.12: 'Light air', 0.18: 'Steady breeze', 0.25: 'Fresh breeze', 0.35: 'Brisk', 0.5: 'Strong wind', 0.7: 'Full sail' };

// ---- LLM flow 1: intake ------------------------------------------------------------------------
const INTAKE = `You turn a person's money goal into JSON for an investing agent. Today is 2026-09-30.
Asset classes: ${F.snap.assets.map((a) => `${a.code}=${a.name}`).join(', ')}.
Return ONLY JSON: {"stake":number USD invested now,"target":number USD wanted,"months":number of months from today or null,"deadline":"YYYY-MM-DD" only if an exact date or month is named else null,"maxDrawdown":number 0-1 (largest dip they accept),"exclude":[asset codes they refuse],"tone":"cautious"|"balanced"|"bold"}
If this is a change to an existing goal, start from CURRENT and apply only what changed (e.g. "adding $3,000" → stake = current stake + 3000). Missing drawdown → 0.25.`;

async function intake(text, current) {
  const { json, call } = await ask('intake', INTAKE, (current ? `CURRENT: ${JSON.stringify(current)}\n` : '') + `SAILOR: ${text}`, 160);
  // Code validates what the model extracted; the model never gets to invent a number we act on unchecked.
  const g = json || {};
  // Date arithmetic stays in code: "in 3 years" → months:36 → a date. Exact dates pass through.
  const byMonths = +g.months > 0 ? new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + Math.round(+g.months), NOW.getUTCDate())).toISOString().slice(0, 10) : null;
  const goal = {
    stake: +g.stake, target: +g.target, deadline: byMonths || String(g.deadline || current?.deadline || '').slice(0, 10),
    maxDrawdown: Math.min(0.9, Math.max(0.02, +g.maxDrawdown || 0.25)),
    exclude: (Array.isArray(g.exclude) ? g.exclude : []).filter((c) => ASSET[c] && c !== 'UST'),
    tone: ['cautious', 'balanced', 'bold'].includes(g.tone) ? g.tone : 'balanced',
  };
  if (!(goal.stake > 0 && goal.target > 0 && !isNaN(new Date(goal.deadline)))) throw new Error('intake: could not read a stake, target and deadline from: ' + text);
  return { goal, call };
}

// ---- code: chart the sea ---------------------------------------------------------------------
function chartSea(goal) {
  const weeks = weeksTo(goal.deadline), multiple = goal.target / goal.stake;
  const courses = chart(F, { multiple, weeks, maxDD: goal.maxDrawdown, exclude: goal.exclude }).map((c) => ({
    ...c, safe: c.pBreach <= RULES.maxBreach, viable: c.pBreach <= RULES.maxBreach && c.pHit >= RULES.minHit,
  }));
  const safe = courses.filter((c) => c.safe);
  const best = safe.sort((a, b) => b.pHit - a.pHit)[0] || null;
  // Counter-offers, computed (not imagined): what IS reachable if something gives.
  const counters = {};
  if (best) counters.sameDeadline = { target: Math.floor((goal.stake * best.p50) / 100) * 100, sigma: best.sigma, odds: 0.5 };
  for (let w = weeks + 13; w <= 52 * 25; w += 13) {
    const c = chart(F, { multiple, weeks: w, maxDD: goal.maxDrawdown, exclude: goal.exclude }).find((x) => x.pBreach <= RULES.maxBreach && x.pHit >= RULES.minHit);
    if (c) { counters.sameTarget = { deadline: new Date(+NOW + w * 7 * 864e5).toISOString().slice(0, 10), sigma: c.sigma, odds: +c.pHit.toFixed(2) }; break; }
  }
  return { weeks, multiple, requiredCagr: multiple ** (52 / weeks) - 1, courses, viable: courses.some((c) => c.viable), counters };
}

// ---- LLM flow 2: navigate ------------------------------------------------------------------
const NAV = `You are helm, a navigator that grows a person's savings toward their goal across bonds, stocks, REITs, gold and crypto.
You receive: the goal, the person's own words, every course (risk setting) the fleet can sail with its simulated odds, and today's wind (which strategy captains Agora Prime follows).
Rules: you may only SAIL on a course marked viable. If none is viable you must DECLINE — say so plainly and offer the counter-offers given (use their exact numbers).
Among viable courses, prefer the calmest one whose odds are good enough for this person's tone; bold people may take the highest odds.
Speak like a trusted navigator: call courses by their name (e.g. "Brisk"), never say sigma or σ, never promise an outcome — give the arrival odds and the risk of a dip beyond their limit as exact %.
Return ONLY JSON: {"decision":"SAIL"|"DECLINE","sigma":number or null,"headline":"≤10 words","message":"2-3 sentences to the person, plain words, cite odds as %","why":"1 sentence on the course choice"}`;

async function navigate(text, goal, sea, wind) {
  const table = sea.courses.map((c) => `${NAMES[c.sigma]} (σ${c.sigma}): reach ${Math.round(c.pHit * 100)}%, dip>${Math.round(goal.maxDrawdown * 100)}% ${Math.round(c.pBreach * 100)}%, median ${usd(goal.stake * c.p50)}, bad-case(p10) ${usd(goal.stake * c.p10)}${c.viable ? ' VIABLE' : ''}`).join('\n');
  const user = `WORDS: ${text}\nGOAL: ${usd(goal.stake)} → ${usd(goal.target)} by ${goal.deadline} (needs ${(sea.requiredCagr * 100).toFixed(1)}%/yr), max dip ${Math.round(goal.maxDrawdown * 100)}%, excluded: ${goal.exclude.join(',') || 'none'}, tone: ${goal.tone}
COURSES:\n${table}
COUNTER-OFFERS: ${JSON.stringify(sea.counters)}
WIND: Prime follows ${wind.lead.map((id) => CAPTAINS.find((c) => c.id === id).name).join(' + ')}; captains' 8-week momentum: ${wind.score.map(([id, s]) => `${id} ${(s * 100).toFixed(1)}%`).join(', ')}`;
  const { json, call } = await ask('navigate', NAV, user, 260);
  const d = json || {};
  // Guard: the model chooses, code enforces. Any inconsistency is overridden and logged.
  const guard = [];
  let decision = d.decision === 'SAIL' ? 'SAIL' : 'DECLINE';
  let course = sea.courses.find((c) => c.sigma === +d.sigma);
  if (decision === 'SAIL' && !sea.viable) { decision = 'DECLINE'; guard.push('model chose SAIL but no course is viable → DECLINE'); }
  if (decision === 'SAIL' && !course?.viable) { course = sea.courses.filter((c) => c.viable).sort((a, b) => a.sigma - b.sigma)[0]; guard.push(`model's course σ${d.sigma} not viable → calmest viable σ${course.sigma}`); }
  if (decision === 'DECLINE' && sea.viable) guard.push('model declined although a viable course exists (allowed: declining is always safe)');
  // The explanation is guarded too: every % the model tells the person must be a real figure for
  // the decision taken (models happily borrow another course's odds). Anything else is corrected.
  const chosen = decision === 'SAIL' ? course : null;
  const pc = (x) => Math.round(x * 100);
  const allowed = new Set([pc(goal.maxDrawdown), pc(sea.requiredCagr), ...(chosen ? [pc(chosen.pHit), pc(chosen.pBreach)] : [0, ...sea.courses.map((c) => pc(c.pHit)), ...Object.values(sea.counters).map((c) => pc(c.odds))])]);
  const fix = (t) => String(t || '').replace(/(\d+(?:\.\d+)?)\s?%/g, (m, n) => {
    if (allowed.has(Math.round(+n))) return m;
    const to = chosen ? pc(chosen.pHit) : 0;
    guard.push(`explanation said ${n}% — not a figure for this decision; corrected to ${to}%`);
    return `${to}%`;
  });
  const fixA = (t) => fix(t).replace(/\ban (?=(?:[0-79]|1[02-79])\d?%)/g, 'a '); // "an 82%" → "a 76%"
  return { decision, course: chosen, headline: fixA(d.headline), message: fixA(d.message), why: fixA(d.why), guard, call };
}

// ---- code: trim the sails (turn target weights into swaps) ------------------------------------
async function trimSails(acct, weights, exclude, voyage, dh, on) {
  const issuer = acct.mint.address;
  const hold = await chain.holdings(acct.vault.address, issuer);
  const prices = {};
  for (const c of F.codes) prices[c] = (await chain.ammInfo(c, issuer)).price;           // read the pools, not our CSV
  const value = (hold.USD || 0) + F.codes.reduce((s, c) => s + (hold[c] || 0) * prices[c], 0);
  const delta = F.codes.map((c) => [c, weights[c] * value - (hold[c] || 0) * prices[c]]).filter(([, d]) => Math.abs(d) >= RULES.dust);
  const trades = [];
  // Sells first so buys are funded; every leg re-checked by the guard before it is signed.
  for (const [c, d] of delta.sort((a, b) => a[1] - b[1])) {
    const sell = d < 0;
    if (!sell && exclude.includes(c)) throw new Error(`guard: ${c} is excluded by the sailor`);
    const cash = (await chain.holdings(acct.vault.address, issuer)).USD || 0;
    const spend = sell ? 0 : Math.min(d, cash);
    if (!sell && spend < RULES.dust) continue;
    const qty = sell ? Math.min(-d / prices[c], hold[c] || 0) : spend;
    const min = sell ? qty * prices[c] * (1 - RULES.slippage) : (spend / prices[c]) * (1 - RULES.slippage);
    const leg = { v: voyage, a: sell ? 'SELL' : 'BUY', c, usd: +Math.abs(sell ? qty * prices[c] : spend).toFixed(2), dh: dh.slice(0, 16) };
    const r = sell ? await chain.swap(acct.vault, issuer, c, qty, 'USD', min, 'trim', leg) : await chain.swap(acct.vault, issuer, 'USD', spend, c, min, 'trim', leg);
    const t = { ...leg, asset: ASSET[c].name, qty: sell ? r.sold : r.bought, price: prices[c], hash: r.hash, result: r.code };
    trades.push(t); on({ type: 'trade', trade: t });
  }
  return { valueBefore: value, trades };
}

export async function portfolio(acct) {
  const issuer = acct.mint.address, hold = await chain.holdings(acct.vault.address, issuer);
  const rows = [{ code: 'USD', qty: hold.USD || 0, usd: hold.USD || 0 }];
  for (const c of F.codes) if ((hold[c] || 0) > 1e-9) { const p = (await chain.ammInfo(c, issuer)).price; rows.push({ code: c, qty: hold[c], usd: hold[c] * p, price: p }); }
  return { total: rows.reduce((s, r) => s + r.usd, 0), rows };
}

// ---- the whole voyage -------------------------------------------------------------------------
// spec: { id, text, amend?: previous voyage (same vault, conditions changed) }
export async function voyage(spec, on = () => {}) {
  const acct = chain.accounts();
  const k0 = calls.length, t0 = Date.now();
  const step = (type, data) => { const e = { type, at: Date.now() - t0, ...data }; on(e); return e; };
  const log = [];

  step('listen', { text: spec.text });
  const { goal } = await intake(spec.text, spec.amend?.goal);
  log.push(step('intake', { goal, call: calls.at(-1) }));

  // Sailor signs the charter on-chain (their words are hashed, the terms are readable).
  const charter = { v: spec.id, stake: goal.stake, target: goal.target, by: goal.deadline, dd: goal.maxDrawdown, ex: goal.exclude, words: sha(spec.text).slice(0, 16) };
  const ch = await chain.record(acct.sailor, spec.amend ? 'amend' : 'charter', charter);
  log.push(step('charter', { hash: ch.hash, charter }));

  // The agent reads the charter back from the ledger — that, not the request, is what it acts on.
  const book = await chain.logbook(acct.sailor.address);
  const signed = book.filter((r) => ['charter', 'amend'].includes(r.type) && r.data.v === spec.id).at(-1);
  if (!signed || signed.hash !== ch.hash) throw new Error('charter not found on-chain');
  log.push(step('read', { from: 'sailor logbook', hash: signed.hash, ledger: signed.ledger }));

  const sea = chartSea(goal);
  const wind = F.prime(0.5, goal.exclude).now;
  log.push(step('chart', { sea: { ...sea, courses: sea.courses.map(({ backtest, ...c }) => ({ ...c, backtest })) }, wind: { lead: wind.lead, score: wind.score, week: wind.week } }));

  const nav = await navigate(spec.text, goal, sea, wind);
  log.push(step('navigate', { decision: nav.decision, sigma: nav.course?.sigma ?? null, headline: nav.headline, message: nav.message, why: nav.why, guard: nav.guard, call: calls.at(-1) }));

  const decision = { v: spec.id, goal, decision: nav.decision, sigma: nav.course?.sigma ?? null, odds: nav.course ? +nav.course.pHit.toFixed(3) : null, counters: sea.counters, lead: wind.lead, rules: RULES, dataWeek: wind.week };
  const dh = sha(decision);
  let execution = null, funding = null;

  if (nav.decision === 'SAIL') {
    const have = (await portfolio(acct)).total;
    const topUp = goal.stake - have;
    if (topUp > 1) { // the sailor boards the stake (or the top-up) into the vault
      funding = await chain.pay(acct.sailor, acct.vault.address, chain.iou('USD', topUp, acct.mint.address), 'board', { v: spec.id, usd: +topUp.toFixed(2) });
      log.push(step('board', { hash: funding.hash, usd: topUp }));
    }
    const plan = F.prime(nav.course.sigma, goal.exclude).now;
    log.push(step('plan', { weights: plan.weights, lead: plan.lead, exposure: plan.exposure }));
    execution = await trimSails(acct, plan.weights, goal.exclude, spec.id, dh, (e) => log.push(step(e.type, e)));
  }

  const rec = await chain.record(acct.vault, nav.decision === 'SAIL' ? 'log' : 'decline', {
    v: spec.id, d: nav.decision, s: decision.sigma, p: decision.odds, lead: wind.lead, dh, ...(nav.decision === 'DECLINE' ? { alt: sea.counters } : { n: execution.trades.length }),
  });
  log.push(step('record', { hash: rec.hash, decision: nav.decision, dh }));

  const result = { id: spec.id, text: spec.text, goal, decision, decisionHash: dh, nav: { headline: nav.headline, message: nav.message, why: nav.why, guard: nav.guard },
    sea, charterTx: ch.hash, fundingTx: funding?.hash || null, recordTx: rec.hash, execution, portfolio: await portfolio(acct), kiln: calls.slice(k0), log, ms: Date.now() - t0 };
  fs.mkdirSync(path.join(cfg.dataDir, 'voyages'), { recursive: true });
  // one file per run (an amended voyage keeps its id, so the timestamp keeps both runs)
  fs.writeFileSync(path.join(cfg.dataDir, 'voyages', `${t0}-${spec.id}.json`), JSON.stringify({ ...result, startedAt: new Date(t0).toISOString() }, null, 2));
  step('done', { id: spec.id });
  return result;
}
