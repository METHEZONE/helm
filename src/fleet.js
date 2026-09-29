// The fleet: six rule-based strategy captains, and Agora Prime — the admiral that
// moves your capital to whichever captains have the wind (recent momentum) right now.
// Pure code, 0 LLM tokens. Every number the agent talks about comes from here.
import { load } from './market.js';

const COST = 0.002;      // swap cost per unit of turnover (AMM fee + slippage)
const WARM = 26;         // weeks of history before anyone trades
const LOOK = 12;         // captains' momentum / volatility window (weeks)
const PRIME_LOOK = 8;    // Prime's window for ranking captains (weeks)
const TACK_MARGIN = 0.08; // new pair must lead the current pair by 8 pts before Prime tacks

export const CAPTAINS = [
  { id: 'harbor', name: 'Harbor', style: 'Treasuries only — US T-bills + Korea 10Y', risk: 1 },
  { id: 'lighthouse', name: 'Lighthouse', style: 'Income: stocks, bonds, REITs, gold', risk: 2 },
  { id: 'ballast', name: 'Ballast', style: 'All-weather: inverse-volatility across 6 classes', risk: 2 },
  { id: 'tradewind', name: 'Trade Wind', style: 'Cross-asset momentum: top 3 trending, else T-bills', risk: 3 },
  { id: 'monsoon', name: 'Monsoon', style: 'Crypto trend: BTC/ETH/SOL above 20-week average', risk: 4 },
  { id: 'corsair', name: 'Corsair', style: 'Degen: SOL + memecoin on 4-week momentum', risk: 5 },
];

const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

export function build(snap = load()) {
  const codes = snap.assets.map((a) => a.code);
  const P = snap.prices, T = snap.weeks.length;
  const ret = Object.fromEntries(codes.map((c) => [c, P[c].map((p, t) => (t ? p / P[c][t - 1] - 1 : 0))]));
  const mom = (c, t, n) => P[c][t] / P[c][t - n] - 1;
  const vol = (c, t, n) => std(ret[c].slice(t - n + 1, t + 1));
  const sma = (c, t, n) => mean(P[c].slice(t - n + 1, t + 1));
  const w0 = () => Object.fromEntries(codes.map((c) => [c, 0]));

  // Each captain: weights to hold from close of week t to close of week t+1, using data ≤ t only.
  const rules = {
    harbor: () => ({ ...w0(), UST: 0.5, KTB: 0.5 }),
    lighthouse: () => ({ ...w0(), SPX: 0.4, KTB: 0.3, RET: 0.2, GLD: 0.1 }),
    ballast: (t) => {
      const set = ['UST', 'KTB', 'SPX', 'RET', 'GLD', 'BTC'], inv = set.map((c) => 1 / Math.max(vol(c, t, LOOK), 1e-4));
      const s = inv.reduce((a, b) => a + b, 0), w = w0(); set.forEach((c, i) => (w[c] = inv[i] / s)); return w;
    },
    tradewind: (t) => {
      const w = w0(), up = codes.filter((c) => c !== 'UST').map((c) => [c, mom(c, t, LOOK)]).filter(([, m]) => m > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
      up.forEach(([c]) => (w[c] = 1 / 3)); w.UST += 1 - up.length / 3; return w;
    },
    monsoon: (t) => {
      const w = w0(), on = ['BTC', 'ETH', 'SOL'].filter((c) => P[c][t] > sma(c, t, 20));
      on.forEach((c) => (w[c] = 1 / 3)); w.UST += 1 - on.length / 3; return w;
    },
    corsair: (t) => {
      const w = w0(), on = ['SOL', 'DOG'].filter((c) => mom(c, t, 4) > 0);
      on.forEach((c) => (w[c] = 0.5)); w.UST += 1 - on.length / 2; return w;
    },
  };

  // Backtest one weight function → weekly returns (after turnover cost) and the weights path.
  const run = (fn) => {
    const r = [], W = []; let prev = null;
    for (let t = WARM; t < T - 1; t++) {
      const w = fn(t); W.push(w);
      const turn = prev ? codes.reduce((s, c) => s + Math.abs(w[c] - prev[c]), 0) / 2 : 1;
      r.push(codes.reduce((s, c) => s + w[c] * ret[c][t + 1], 0) - turn * COST);
      // drift weights with the market for next week's turnover calc
      const g = codes.reduce((s, c) => s + w[c] * (1 + ret[c][t + 1]), 0);
      prev = Object.fromEntries(codes.map((c) => [c, (w[c] * (1 + ret[c][t + 1])) / g]));
    }
    return { r, W };
  };

  const fleet = Object.fromEntries(CAPTAINS.map((c) => [c.id, { ...c, ...run(rules[c.id]) }]));
  const capW = (id, k) => fleet[id].W[k] || rules[id](WARM + k); // k past the backtest = this week's live plan

  // Agora Prime: every week, rank captains by their own trailing PRIME_LOOK-week return (momentum)
  // and follow the top two that are moving forward (none → shelter in Harbor). It only tacks
  // when the new pair leads the current one by more than TACK_MARGIN, so it doesn't churn.
  // `sigma` is the helm's risk dial: target annualised volatility. Exposure is scaled down
  // when the followed blend has been rougher than that; the rest waits in T-bills.
  // `exclude`: asset classes the sailor forbade; their weight waits in T-bills instead.
  const prime = (sigma, exclude = []) => {
    const log = []; let lead = ['harbor'];
    const step = (t) => {
      const k = t - WARM;
      let score = [];
      if (k >= PRIME_LOOK) {
        score = CAPTAINS.map((c) => [c.id, fleet[c.id].r.slice(k - PRIME_LOOK, k).reduce((g, x) => g * (1 + x), 1) - 1]).sort((a, b) => b[1] - a[1]);
        const best = score.filter(([, s]) => s > 0).slice(0, 2).map(([id]) => id);
        if (!best.length) best.push('harbor');
        const avg = (ids) => mean(ids.map((id) => score.find(([x]) => x === id)[1]));
        if (best.join() !== lead.join() && avg(best) - avg(lead) > TACK_MARGIN) lead = best;
      }
      const mix = Object.fromEntries(lead.map((id) => [id, 1 / lead.length]));
      const full = w0();
      for (const id of lead) for (const c of codes) full[c] += mix[id] * capW(id, k)[c];
      // Ex-ante risk of exactly what we're about to hold: its volatility over the last 12 and
      // last 52 weeks, whichever is larger — a calm quarter in crypto can't talk us into full sail.
      const volOf = (n) => { n = Math.min(t, n); return std(Array.from({ length: n }, (_, i) => codes.reduce((s, c) => s + full[c] * ret[c][t - n + 1 + i], 0))) * Math.sqrt(52); };
      const exposure = Math.min(1, sigma / Math.max(volOf(LOOK), volOf(52), 1e-4));
      const weights = Object.fromEntries(codes.map((c) => [c, full[c] * exposure]));
      weights.UST += 1 - exposure;
      for (const c of exclude) { weights.UST += weights[c]; weights[c] = 0; }
      log.push({ week: snap.weeks[t], lead: [...lead], exposure, weights, score });
      return weights;
    };
    const { r, W } = run(step);
    step(T - 1); // log.at(-1) = the live plan, decided on the newest weekly close
    return { r, W, log, now: log.at(-1) };
  };

  return { snap, codes, fleet, prime, weeks: snap.weeks.slice(WARM + 1), start: WARM };
}

export function stats(r) {
  let v = 1, peak = 1, dd = 0; const curve = [1];
  for (const x of r) { v *= 1 + x; peak = Math.max(peak, v); dd = Math.max(dd, 1 - v / peak); curve.push(v); }
  const years = r.length / 52;
  return { multiple: v, cagr: v ** (1 / years) - 1, maxDD: dd, vol: std(r) * Math.sqrt(52), curve };
}

// Tacks = weeks where Prime changed which captains it follows.
export const tacks = (log) => log.reduce((n, p, i) => n + (i && p.lead.join() !== log[i - 1].lead.join() ? 1 : 0), 0);

// Deterministic PRNG so every quote is reproducible.
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Monte Carlo: block-bootstrap Prime's real weekly returns (8-week blocks keep momentum regimes).
// Returns probability of reaching `target`×, probability the voyage ever breaches maxDD, and percentiles.
export function simulate(r, weeks, target, maxDD, { paths = 3000, block = 8, seed = 42 } = {}) {
  const rand = rng(seed); let hit = 0, breach = 0; const finals = [];
  for (let p = 0; p < paths; p++) {
    let v = 1, peak = 1, bad = false;
    for (let w = 0; w < weeks; ) {
      const s = Math.floor(rand() * (r.length - block));
      for (let j = 0; j < block && w < weeks; j++, w++) { v *= 1 + r[s + j]; peak = Math.max(peak, v); if (1 - v / peak > maxDD) bad = true; }
    }
    if (v >= target) hit++; if (bad) breach++; finals.push(v);
  }
  finals.sort((a, b) => a - b);
  const q = (x) => finals[Math.floor(x * (paths - 1))];
  return { pHit: hit / paths, pBreach: breach / paths, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
}

export const DIAL = [0.04, 0.08, 0.12, 0.18, 0.25, 0.35, 0.5, 0.7]; // helm risk settings (target vol)

// Chart every course the helm can steer (each risk setting) for a given goal.
export function chart(F, { multiple, weeks, maxDD, exclude = [] }) {
  return DIAL.map((sigma) => {
    const p = F.prime(sigma, exclude), s = stats(p.r);
    return { sigma, backtest: { cagr: s.cagr, maxDD: s.maxDD, multiple: s.multiple, tacks: tacks(p.log) }, ...simulate(p.r, weeks, multiple, maxDD) };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const F = build();
  console.log('weeks', F.weeks[0], '→', F.weeks.at(-1));
  for (const c of CAPTAINS) { const s = stats(F.fleet[c.id].r); console.log(c.name.padEnd(11), 'x' + s.multiple.toFixed(2), 'cagr', (s.cagr * 100).toFixed(1) + '%', 'maxDD', (s.maxDD * 100).toFixed(1) + '%'); }
  for (const sg of DIAL) { const p = F.prime(sg), s = stats(p.r); console.log(('Prime σ' + sg).padEnd(11), 'x' + s.multiple.toFixed(2), 'cagr', (s.cagr * 100).toFixed(1) + '%', 'maxDD', (s.maxDD * 100).toFixed(1) + '%', 'vol', (s.vol * 100).toFixed(0) + '%', 'tacks', tacks(p.log)); }
  // self-checks
  const any = F.prime(0.25);
  for (const w of any.W) { const s = Object.values(w).reduce((a, b) => a + b, 0); if (Math.abs(s - 1) > 1e-9 || Object.values(w).some((x) => x < -1e-12)) throw new Error('weights must be long-only and sum to 1'); }
  const easy = simulate(any.r, 52, 0.5, 0.99), hard = simulate(any.r, 52, 100, 0.99);
  if (easy.pHit < 0.99 || hard.pHit > 0.01) throw new Error('simulate sanity failed');
  console.log('self-check ok');
}
