// Track A, end to end on XRPL Testnet + Kiln: a normal voyage, the same voyage re-run after the
// budget changes, and a voyage helm declines because the goal can't be met. `npm run voyages`.
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { voyage } from './agent.js';
import { byFlow, calls } from './kiln.js';
import { close } from './chain.js';

const print = (e) => {
  if (e.type === 'intake') console.log('  intake   ', JSON.stringify(e.goal));
  if (e.type === 'charter') console.log('  charter  ', e.hash);
  if (e.type === 'navigate') console.log('  navigate ', e.decision, e.sigma, '—', e.headline, e.guard.length ? '[guard] ' + e.guard.join('; ') : '');
  if (e.type === 'trade') console.log('  trade    ', e.trade.a, e.trade.c, '$' + e.trade.usd, e.trade.hash);
  if (e.type === 'record') console.log('  record   ', e.decision, e.hash);
};

const runs = [];
console.log('R1 normal voyage'); runs.push(await voyage({ id: 'v1', text: 'I have $10,000 saved. I want it to become $15,000 in 3 years. I can live with a 30% dip, but no memecoins please.' }, print));
console.log('R2 budget changed'); runs.push(await voyage({ id: 'v1', text: 'Good news — I got a bonus and I am adding $3,000. Same goal: $15,000, same date. I would rather sleep well now.', amend: runs[0] }, print));
console.log('R3 impossible goal'); runs.push(await voyage({ id: 'v2', text: 'Turn $10,000 into $100,000 by next October. I cannot stomach losing more than 15%.' }, print));

const summary = { at: new Date().toISOString(), runs: runs.map((r, i) => ({ run: ['R1-normal', 'R2-budget', 'R3-decline'][i], id: r.id, decision: r.decision.decision, sigma: r.decision.sigma, odds: r.decision.odds, charterTx: r.charterTx, fundingTx: r.fundingTx, recordTx: r.recordTx, trades: r.execution?.trades.map((t) => ({ a: t.a, c: t.c, usd: t.usd, hash: t.hash })) || [], kiln: byFlow(r.kiln), portfolio: r.portfolio.total })), kilnByFlow: byFlow(calls), kilnCalls: calls };
fs.writeFileSync(path.join(cfg.dataDir, 'runs.json'), JSON.stringify(summary, null, 2));
console.log('kiln by flow', summary.kilnByFlow);
await close();
