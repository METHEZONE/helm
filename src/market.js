// Market snapshot: 5 years of weekly closes for every asset class helm can hold.
// Source: Yahoo Finance chart API (adjusted close). Run `npm run market` to refresh;
// the committed data/market.json is what every run and the UI use (reproducible).
import fs from 'node:fs';

export const ASSETS = [
  { code: 'UST', name: 'US Treasury Bills', kind: 'Government bond', symbol: 'BIL', color: '#8fb8c9' },
  { code: 'KTB', name: 'Korea Treasury 10Y (국고채)', kind: 'Government bond', symbol: '148070.KS', krw: true, color: '#6f9fb0' },
  { code: 'SPX', name: 'S&P 500', kind: 'Equity index', symbol: 'SPY', color: '#2f6fb3' },
  { code: 'RET', name: 'US REITs', kind: 'Real estate', symbol: 'VNQ', color: '#c46a3c' },
  { code: 'GLD', name: 'Gold', kind: 'Commodity', symbol: 'GLD', color: '#e2b23a' },
  { code: 'BTC', name: 'Bitcoin', kind: 'Crypto', symbol: 'BTC-USD', color: '#f08a24' },
  { code: 'ETH', name: 'Ether', kind: 'Crypto', symbol: 'ETH-USD', color: '#5b6ad0' },
  { code: 'SOL', name: 'Solana', kind: 'Crypto', symbol: 'SOL-USD', color: '#1fae8f' },
  { code: 'DOG', name: 'Dogecoin (memecoin)', kind: 'Memecoin', symbol: 'DOGE-USD', color: '#d9534f' },
];

const FILE = new URL('../data/market.json', import.meta.url);

async function series(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1wk`;
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`${symbol}: HTTP ${r.status}`);
  const res = (await r.json()).chart.result[0];
  const close = res.indicators.adjclose?.[0]?.adjclose || res.indicators.quote[0].close;
  const out = new Map();
  res.timestamp.forEach((t, i) => {
    if (close[i] == null) return;
    // Align every venue on the Monday of its week (KRX/crypto stamps differ by timezone).
    const d = new Date((t + 43200) * 1000); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    out.set(d.toISOString().slice(0, 10), close[i]);
  });
  return out;
}

export async function refresh() {
  const fx = await series('KRW=X');
  const raw = {};
  for (const a of ASSETS) raw[a.code] = await series(a.symbol);
  let weeks = [...raw.UST.keys()].filter((w) => ASSETS.every((a) => raw[a.code].has(w)) && fx.has(w)).sort();
  // Drop the current, unfinished week so every row is a real weekly close.
  weeks = weeks.slice(0, -1);
  const prices = {};
  for (const a of ASSETS) prices[a.code] = weeks.map((w) => +(a.krw ? raw[a.code].get(w) / fx.get(w) : raw[a.code].get(w)).toPrecision(8));
  const snap = { source: 'Yahoo Finance weekly adjusted close (KTB converted KRW->USD with KRW=X)', fetchedAt: new Date().toISOString(), weeks, assets: ASSETS, prices };
  fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(snap));
  return snap;
}

export const load = () => JSON.parse(fs.readFileSync(FILE, 'utf8'));

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await refresh();
  console.log(`${s.weeks.length} weeks ${s.weeks[0]} → ${s.weeks.at(-1)}`);
  for (const a of ASSETS) { const p = s.prices[a.code]; console.log(a.code.padEnd(4), (p.at(-1) / p[0]).toFixed(2) + 'x'); }
}
