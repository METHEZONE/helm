// helm web app: static UI + a small JSON API. `npm start` → http://localhost:4800
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cfg, root } from './config.js';
import { build, stats, tacks, chart, CAPTAINS, DIAL } from './fleet.js';
import { voyage, RULES, portfolio } from './agent.js';
import { byFlow } from './kiln.js';
import * as chain from './chain.js';

const PORT = +process.env.PORT || 4800;
const F = build();
const web = path.join(root, 'web');
const vdir = path.join(cfg.dataDir, 'voyages');
const readVoyages = () => (fs.existsSync(vdir) ? fs.readdirSync(vdir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(vdir, f), 'utf8'))) : []);
const recorded = () => { try { return JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'runs.json'), 'utf8')); } catch { return null; } };

// The regatta: every captain's real equity curve + Prime at every helm setting, with its tacks.
function regatta() {
  const curve = (r) => stats(r).curve.map((v) => +v.toFixed(4));
  const captains = CAPTAINS.map((c) => { const s = stats(F.fleet[c.id].r); return { ...c, curve: curve(F.fleet[c.id].r), multiple: s.multiple, cagr: s.cagr, maxDD: s.maxDD }; });
  const prime = DIAL.map((sigma) => {
    const p = F.prime(sigma), s = stats(p.r);
    const tk = p.log.slice(0, p.r.length).map((l, i, a) => (i && l.lead.join() !== a[i - 1].lead.join() ? { i, lead: l.lead } : null)).filter(Boolean);
    return { sigma, curve: curve(p.r), multiple: s.multiple, cagr: s.cagr, maxDD: s.maxDD, tacks: tk, lead: p.log.slice(0, p.r.length).map((l) => l.lead) };
  });
  const now = F.prime(0.5).now;
  return { weeks: [F.snap.weeks[F.start], ...F.weeks], captains, prime, now: { week: now.week, lead: now.lead, score: now.score }, assets: F.snap.assets };
}
const REGATTA = regatta();

let busy = false;
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.mp4': 'video/mp4' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/state') {
      return send(res, 200, { accounts: chain.publicAccounts(), explorer: cfg.explorer, rules: RULES, voyages: readVoyages(), runs: recorded(), assets: F.snap.assets, dataWeek: F.snap.weeks.at(-1), source: F.snap.source });
    }
    if (url.pathname === '/api/regatta') return send(res, 200, REGATTA);
    if (url.pathname === '/api/courses') { // the wheel: preview the odds of every course for any goal
      const q = Object.fromEntries(url.searchParams);
      return send(res, 200, chart(F, { multiple: +q.multiple, weeks: +q.weeks, maxDD: +q.dd, exclude: (q.ex || '').split(',').filter(Boolean) }).map(({ sigma, pHit, pBreach, p10, p50, p90, backtest }) => ({ sigma, pHit, pBreach, p10, p50, p90, backtest })));
    }
    if (url.pathname === '/api/logbook') { // straight from the ledger, not from our files
      const a = chain.publicAccounts();
      const [sailor, vault] = [await chain.logbook(a.sailor), await chain.logbook(a.vault)];
      const all = [...sailor.map((r) => ({ ...r, by: 'sailor' })), ...vault.map((r) => ({ ...r, by: 'helm vault' }))].sort((x, y) => x.ledger - y.ledger);
      return send(res, 200, { records: all, portfolio: await portfolioSafe() });
    }
    if (url.pathname === '/api/verify') { // re-derive a decision hash and compare with what's on-chain
      const v = readVoyages().find((x) => x.recordTx === url.searchParams.get('tx'));
      if (!v) return send(res, 404, { error: 'unknown record tx' });
      const facts = await chain.txFacts(v.recordTx);
      const local = crypto.createHash('sha256').update(JSON.stringify(v.decision)).digest('hex');
      return send(res, 200, { tx: v.recordTx, onChain: facts.record?.data?.dh, recomputed: local, match: facts.record?.data?.dh === local, validated: facts.validated, ledger: facts.ledger, decision: v.decision });
    }
    if (url.pathname === '/api/voyage' && req.method === 'POST') { // live run: streams every step as NDJSON
      if (busy) return send(res, 409, { error: 'a voyage is already under way' });
      let body = ''; for await (const ch of req) body += ch;
      const { text, id, amend } = JSON.parse(body || '{}');
      if (!text || text.length > 600) return send(res, 400, { error: 'tell helm your goal in under 600 characters' });
      const prev = amend ? readVoyages().filter((v) => v.id === amend).at(-1) : null;
      busy = true;
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
      try {
        const r = await voyage({ id: id || 'v' + Date.now().toString(36), text, amend: prev }, (e) => res.write(JSON.stringify(e) + '\n'));
        res.write(JSON.stringify({ type: 'result', result: { ...r, kilnByFlow: byFlow(r.kiln) } }) + '\n');
      } catch (e) { res.write(JSON.stringify({ type: 'error', error: String(e.message || e) }) + '\n'); }
      finally { busy = false; res.end(); }
      return;
    }
    let p = path.normalize(path.join(web, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!p.startsWith(web) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) return send(res, 404, 'not found', 'text/plain');
    return send(res, 200, fs.readFileSync(p), MIME[path.extname(p)] || 'application/octet-stream');
  } catch (e) { if (!res.headersSent) send(res, 500, { error: String(e.message || e) }); }
}).listen(PORT, () => console.log(`helm → http://localhost:${PORT}`));

async function portfolioSafe() {
  try { return await portfolio(chain.accounts()); } catch { return null; }
}
