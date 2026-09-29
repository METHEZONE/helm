// One-time testnet world: a mint that tokenizes 9 asset classes + a testnet dollar, an exchange
// that seeds one AMM pool per asset at the latest real market price, a sailor (the user) with savings,
// and the helm vault the agent is allowed to trade in. `npm run setup`.
import { load } from './market.js';
import { close, fund, accounts, saveAccounts, submit, trust, pay, iou, BASE, ammInfo } from './chain.js';

const DEPTH = 5_000_000;      // hUSD per pool side, deep enough that a $10k trade moves price ~0.2%
const SAVINGS = 50_000;       // sailor's starting testnet dollars

const snap = load();
const price = Object.fromEntries(snap.assets.map((a) => [a.code, snap.prices[a.code].at(-1)]));
const currencies = [BASE, ...snap.assets.map((a) => a.code)];

// `--new-sailor`: keep the mint, exchange and pools; give a fresh sailor + empty vault (a clean voyage history).
if (process.argv.includes('--new-sailor')) {
  const { mint, exchange } = accounts();
  const [sailor, vault] = [await fund(), await fund()];
  saveAccounts({ mint, exchange, sailor, vault });
  for (const c of currencies) await trust(vault, c, mint.address);
  await trust(sailor, BASE, mint.address);
  const s = await pay(mint, sailor.address, iou(BASE, SAVINGS, mint.address));
  console.log('new sailor', sailor.address, 'vault', vault.address, 'funded', s.hash);
  await close(); process.exit(0);
}

const [mint, exchange, sailor, vault] = [await fund(), await fund(), await fund(), await fund()];
saveAccounts({ mint, exchange, sailor, vault });
console.log('accounts', { mint: mint.address, exchange: exchange.address, sailor: sailor.address, vault: vault.address });

await submit(mint, { TransactionType: 'AccountSet', SetFlag: 8 }); // DefaultRipple: tokens can flow through AMMs
for (const w of [exchange, vault]) for (const c of currencies) await trust(w, c, mint.address);
await trust(sailor, BASE, mint.address);

await pay(mint, exchange.address, iou(BASE, DEPTH * snap.assets.length, mint.address));
for (const a of snap.assets) {
  await pay(mint, exchange.address, iou(a.code, DEPTH / price[a.code], mint.address));
  const r = await submit(exchange, { TransactionType: 'AMMCreate', Amount: iou(BASE, DEPTH, mint.address), Amount2: iou(a.code, DEPTH / price[a.code], mint.address), TradingFee: 100 });
  const info = await ammInfo(a.code, mint.address);
  console.log('pool', a.code, 'price', info.price.toPrecision(6), 'tx', r.hash);
}
const s = await pay(mint, sailor.address, iou(BASE, SAVINGS, mint.address));
console.log('sailor funded', SAVINGS, 'hUSD', s.hash);
await close();
