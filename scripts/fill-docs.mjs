// Fills README.md and the deck with the recorded runs (data/voyages/*.json) — no hand-copied hashes.
import fs from 'node:fs';
const X = 'https://testnet.xrpl.org/transactions/';
const acc = JSON.parse(fs.readFileSync('data/accounts.json', 'utf8'));
const V = fs.readdirSync('data/voyages').filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync('data/voyages/' + f, 'utf8')));
const COURSE = { 0.04: 'Anchored', 0.08: 'Harbor breeze', 0.12: 'Light air', 0.18: 'Steady breeze', 0.25: 'Fresh breeze', 0.35: 'Brisk', 0.5: 'Strong wind', 0.7: 'Full sail' };
const CAP = { harbor: 'Harbor', lighthouse: 'Lighthouse', ballast: 'Ballast', tradewind: 'Trade Wind', monsoon: 'Monsoon', corsair: 'Corsair' };
const usd = (x) => '$' + Math.round(x).toLocaleString('en-US');
const tx = (h) => `[\`${h.slice(0, 12)}…\`](${X}${h})`;
const names = ['R1 · normal voyage', 'R2 · re-run: the budget changed', 'R3 · re-run: a goal that can\'t be met'];

let runs = '';
V.forEach((v, i) => {
  const d = v.decision, g = v.goal;
  runs += `### ${names[i] || v.id}\n\n> “${v.text}”\n\n`;
  runs += `**Parsed goal:** ${usd(g.stake)} → ${usd(g.target)} by ${g.deadline}, max dip ${Math.round(g.maxDrawdown * 100)}%${g.exclude.length ? `, excluded ${g.exclude.join(', ')}` : ''}, tone ${g.tone}. Needs ${(v.sea.requiredCagr * 100).toFixed(1)}%/yr.  \n`;
  runs += d.decision === 'SAIL'
    ? `**Decision: SAIL · ${COURSE[d.sigma]} (σ ${d.sigma})** · ${Math.round(d.odds * 100)}% odds of arriving · Prime follows ${d.lead.map((x) => CAP[x]).join(' + ')} · vault after: ${usd(v.portfolio.total)}  \n`
    : `**Decision: DECLINE** · best course odds ${Math.round(Math.max(...v.sea.courses.map((c) => c.pHit)) * 100)}% · counter‑offers: ${d.counters.sameDeadline ? `${usd(d.counters.sameDeadline.target)} by the same date (even odds)` : ''}${d.counters.sameTarget ? `; ${usd(g.target)} by ${d.counters.sameTarget.deadline}` : `; ${usd(g.target)} not reachable within 25 years at this dip limit`} · **no money moved**  \n`;
  runs += `**Navigator said:** “${v.nav.message}”${v.nav.guard.length ? `  \n**Guard:** ${v.nav.guard.join('; ')}` : ''}\n\n`;
  runs += `| # | Step | By | Detail | Proof |\n|---|---|---|---|---|\n`;
  let n = 0;
  const kiln = (flow) => v.kiln.find((c) => c.flow === flow);
  for (const e of v.log) {
    if (e.type === 'intake') { const c = kiln('intake'); runs += `| ${++n} | intake | Kiln \`${c.model}\` | ${c.prompt}→${c.completion} tokens (${c.reasoning} reasoning), ${c.ms} ms, ≤${c.joulesMax} J | \`${c.id}\` |\n`; }
    if (e.type === 'charter') runs += `| ${++n} | ${v.fundingTx || i === 0 ? 'charter' : i === 1 ? 'amend' : 'charter'} | sailor | signed terms (memo \`helm/${e.charter && i === 1 ? 'amend' : 'charter'}\`) | ${tx(e.hash)} |\n`;
    if (e.type === 'read') runs += `| ${++n} | read back | helm | charter found in sailor's ledger history, ledger #${e.ledger} | — |\n`;
    if (e.type === 'chart') runs += `| ${++n} | chart | code | 8 courses × 3,000 voyages, 0 tokens | — |\n`;
    if (e.type === 'navigate') { const c = kiln('navigate'); runs += `| ${++n} | navigate | Kiln \`${c.model}\` | ${e.decision}${e.sigma ? ' σ ' + e.sigma : ''} · ${c.prompt}→${c.completion} tokens, ${c.ms} ms, ≤${c.joulesMax} J | \`${c.id}\` |\n`; }
    if (e.type === 'board') runs += `| ${++n} | board | sailor → vault | ${usd(e.usd)} hUSD (memo \`helm/board\`) | ${tx(e.hash)} |\n`;
    if (e.type === 'trade') runs += `| ${++n} | trim | vault ⇄ AMM | ${e.trade.a} ${e.trade.c} ${usd(e.trade.usd)} (${e.trade.qty.toPrecision(5)} ${e.trade.c}) | ${tx(e.trade.hash)} |\n`;
    if (e.type === 'record') runs += `| ${++n} | record | vault | ${e.decision} + decision hash \`${e.dh.slice(0, 16)}…\` (memo \`helm/${e.decision === 'SAIL' ? 'log' : 'decline'}\`) | ${tx(e.hash)} |\n`;
  }
  runs += `\n`;
});

const flows = {}; const all = V.flatMap((v) => v.kiln);
for (const c of all) { const f = (flows[c.flow] ||= { calls: 0, p: 0, c: 0, r: 0, ms: 0, j: 0 }); f.calls++; f.p += c.prompt; f.c += c.completion; f.r += c.reasoning; f.ms += c.ms; f.j += c.joulesMax; }
let kiln = `| Flow | Calls | Prompt tokens | Completion tokens | Reasoning tokens | Avg latency | Energy (est., 1 card) |\n|---|---|---|---|---|---|---|\n`;
for (const [k, f] of Object.entries(flows)) kiln += `| **${k}** | ${f.calls} | ${f.p} | ${f.c} | ${f.r} | ${Math.round(f.ms / f.calls)} ms | ${f.j.toFixed(0)} J |\n`;
const T = Object.values(flows).reduce((a, f) => ({ calls: a.calls + f.calls, tok: a.tok + f.p + f.c, j: a.j + f.j }), { calls: 0, tok: 0, j: 0 });
kiln += `| chart · guard · sizing · swaps · records | — | 0 | 0 | 0 | code | 0 J |\n| **total, 3 runs** | **${T.calls}** | | | | | **${(T.j / 1000).toFixed(2)} kJ** (${T.tok.toLocaleString()} tokens) |\n\n`;
kiln += `<details><summary>Every Kiln call (id, flow, tokens, latency)</summary>\n\n| time (UTC) | run | flow | model | id | in→out | ms |\n|---|---|---|---|---|---|---|\n`;
V.forEach((v, i) => v.kiln.forEach((c) => (kiln += `| ${c.at} | R${i + 1} | ${c.flow} | ${c.model} | \`${c.id}\` | ${c.prompt}→${c.completion} | ${c.ms} |\n`)));
kiln += `\n</details>\n`;

const accounts = ['sailor', 'vault', 'mint', 'exchange'].map((r) => `${r} [\`${acc[r].slice(0, 8)}…\`](https://testnet.xrpl.org/accounts/${acc[r]})`).join(' · ');
const put = (s, key, body) => { const re = new RegExp(`<!--${key}-->[\\s\\S]*?(<!--/${key}-->|$(?![\\s\\S]))`); const block = `<!--${key}-->\n${body}\n<!--/${key}-->`; return s.includes(`<!--/${key}-->`) ? s.replace(new RegExp(`<!--${key}-->[\\s\\S]*?<!--/${key}-->`), block) : s.replace(`<!--${key}-->`, block); };
let r = fs.readFileSync('README.md', 'utf8');
r = put(r, 'RUNS', runs); r = put(r, 'KILN', kiln);
r = r.includes('<!--/ACCOUNTS-->') ? r.replace(/<!--ACCOUNTS-->[\s\S]*?<!--\/ACCOUNTS-->/, `<!--ACCOUNTS-->${accounts}<!--/ACCOUNTS-->`) : r.replace('<!--ACCOUNTS-->', `<!--ACCOUNTS-->${accounts}<!--/ACCOUNTS-->`);
fs.writeFileSync('README.md', r);

// deck slide 7
let deck = fs.readFileSync('docs/deck/deck.html', 'utf8');
const rows = V.map((v, i) => {
  const d = v.decision, trades = v.execution?.trades || [];
  const did = d.decision === 'SAIL' ? `<b style="color:#1f8a6a">SAIL · ${COURSE[d.sigma]}</b> · ${Math.round(d.odds * 100)}% odds · ${trades.map((t) => `${t.a === 'BUY' ? '+' : '−'}${t.c}`).join(' ')}` : `<b style="color:#c2542d">DECLINE</b> · 0% odds · offers ${usd(d.counters.sameDeadline?.target || 0)} same date · no money moved`;
  const n = 1 + (v.fundingTx ? 1 : 0) + trades.length + 1;
  return `<tr><td><b>R${i + 1}</b></td><td style="font-size:21px;max-width:560px">“${v.text}”</td><td style="font-size:22px">${did}</td><td class="mono" style="font-size:19px">${n} txs · ${v.recordTx.slice(0, 10)}…</td></tr>`;
}).join('\n');
deck = deck.replace(/<tbody id="runs">[\s\S]*?<\/tbody>/, `<tbody id="runs">\n${rows}\n</tbody>`);
const kc = Object.entries(flows).map(([k, f]) => `<div class="card"><h3>${k}</h3><p><b>${f.calls}</b> calls · ${(f.p + f.c).toLocaleString()} tokens · ${(f.ms / f.calls / 1000).toFixed(1)} s avg · ≤${(f.j / 1000).toFixed(1)} kJ</p></div>`).join('') + `<div class="card"><h3>code + chain</h3><p>24,000 simulated voyages, guard, sizing, every swap and record: <b>0 tokens</b>.</p></div>`;
deck = deck.replace(/<div class="grid g3" style="margin-top:34px" id="kiln">[\s\S]*?<\/div>\n  <div class="brand">/, `<div class="grid g3" style="margin-top:34px" id="kiln">${kc}</div>\n  <div class="brand">`);
fs.writeFileSync('docs/deck/deck.html', deck);
console.log('filled', V.length, 'runs;', T.calls, 'kiln calls');
