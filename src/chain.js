// XRPL Testnet: tokenized assets, AMM pools, and helm's on-chain logbook (native Memos).
import { Client, Wallet, convertStringToHex, convertHexToString, getBalanceChanges } from 'xrpl';
import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';

export const BASE = 'USD'; // hUSD: the testnet dollar issued by helm's mint account

let client;
export async function api() {
  if (client?.isConnected()) return client;
  client = new Client(cfg.xrplWs);
  await client.connect();
  return client;
}
export const close = () => client?.isConnected() && client.disconnect();

// ---- accounts --------------------------------------------------------------------------------
export function accounts() {
  const k = JSON.parse(fs.readFileSync(cfg.keysFile, 'utf8'));
  return Object.fromEntries(Object.entries(k).map(([role, seed]) => [role, Wallet.fromSeed(seed)]));
}
export function saveAccounts(wallets) {
  fs.mkdirSync(path.dirname(cfg.keysFile), { recursive: true });
  fs.writeFileSync(cfg.keysFile, JSON.stringify(Object.fromEntries(Object.entries(wallets).map(([r, w]) => [r, w.seed])), null, 2));
  fs.writeFileSync(path.join(cfg.dataDir, 'accounts.json'), JSON.stringify(Object.fromEntries(Object.entries(wallets).map(([r, w]) => [r, w.address])), null, 2));
}
export const publicAccounts = () => JSON.parse(fs.readFileSync(path.join(cfg.dataDir, 'accounts.json'), 'utf8'));

export async function fund() {
  const c = await api();
  for (let i = 0; i < 4; i++) {
    try { return (await c.fundWallet(null, { faucetHost: cfg.faucetHost })).wallet; }
    catch (e) { if (i === 3) throw e; await new Promise((r) => setTimeout(r, 3000)); }
  }
}

// ---- tx plumbing ------------------------------------------------------------------------------
// Every helm record: Memo{ MemoType: "helm/<type>", MemoData: compact JSON }.
const memo = (type, obj) => ({ Memo: { MemoType: convertStringToHex('helm/' + type), MemoData: convertStringToHex(JSON.stringify(obj)) } });
export function decodeMemo(memos = []) {
  for (const { Memo: m } of memos) {
    try {
      const t = convertHexToString(m.MemoType || '');
      if (t.startsWith('helm/')) return { type: t.slice(5), data: JSON.parse(convertHexToString(m.MemoData || '')) };
    } catch {}
  }
  return null;
}

export async function submit(wallet, tx, { allowPartial = false } = {}) {
  const c = await api();
  const res = await c.submitAndWait({ Account: wallet.address, ...tx }, { wallet, autofill: true });
  const code = res.result.meta.TransactionResult;
  if (code !== 'tesSUCCESS' && !(allowPartial && code === 'tecKILLED')) throw new Error(`${tx.TransactionType} failed: ${code}`);
  return { hash: res.result.hash, ledger: res.result.ledger_index, code, meta: res.result.meta };
}

// 15 significant digits max for issued amounts; never exponent notation.
export const amt = (x) => { const s = Number(x).toPrecision(12); return String(Number(s).toFixed(Math.max(0, 11 - Math.floor(Math.log10(Math.abs(Number(s)) || 1))))).replace(/\.?0+$/, ''); };
export const iou = (currency, value, issuer) => ({ currency, issuer, value: amt(value) });

export const trust = (w, currency, issuer) => submit(w, { TransactionType: 'TrustSet', LimitAmount: { currency, issuer, value: '1000000000000' } });
export const pay = (w, to, amount, type, obj) => submit(w, { TransactionType: 'Payment', Destination: to, Amount: amount, ...(type ? { Memos: [memo(type, obj)] } : {}) });
export const record = (w, type, obj) => submit(w, { TransactionType: 'AccountSet', Memos: [memo(type, obj)] });

// ---- market state (read from the ledger) ------------------------------------------------------
export async function ammInfo(currency, issuer) {
  const c = await api();
  const r = await c.request({ command: 'amm_info', asset: { currency: BASE, issuer }, asset2: { currency, issuer }, ledger_index: 'validated' });
  const a = r.result.amm, usd = +(a.amount.currency === BASE ? a.amount.value : a.amount2.value), qty = +(a.amount.currency === BASE ? a.amount2.value : a.amount.value);
  return { account: a.account, usd, qty, price: usd / qty, fee: a.trading_fee / 1e5 };
}

export async function holdings(address, issuer) {
  const c = await api();
  const r = await c.request({ command: 'account_lines', account: address, peer: issuer, ledger_index: 'validated' });
  return Object.fromEntries(r.result.lines.map((l) => [l.currency, +l.balance]));
}

// Swap on the XRPL DEX/AMM: sell exactly `sell` of one token for at least `minBuy` of another.
// OfferCreate + tfImmediateOrCancel + tfSell → fills against the AMM pool now or not at all.
export async function swap(w, issuer, sellCur, sellQty, buyCur, minBuy, type, obj) {
  const res = await submit(w, {
    TransactionType: 'OfferCreate', Flags: 0x00020000 | 0x00080000,
    TakerGets: iou(sellCur, sellQty, issuer), TakerPays: iou(buyCur, minBuy, issuer), Memos: [memo(type, obj)],
  }, { allowPartial: true });
  const mine = getBalanceChanges(res.meta).find((b) => b.account === w.address)?.balances || [];
  const delta = Object.fromEntries(mine.filter((b) => b.currency !== 'XRP').map((b) => [b.currency, +b.value]));
  return { ...res, sold: -(delta[sellCur] || 0), bought: delta[buyCur] || 0 };
}

// Every helm record an account has written, oldest first. The chain is the logbook.
export async function logbook(address, { limit = 400 } = {}) {
  const c = await api(); const out = []; let marker;
  do {
    const r = await c.request({ command: 'account_tx', account: address, limit: 200, forward: true, marker });
    for (const t of r.result.transactions) {
      const tx = t.tx_json || t.tx; if (!tx || !t.validated || tx.Account !== address) continue;
      const rec = decodeMemo(tx.Memos); if (!rec) continue;
      out.push({ hash: t.hash, ledger: t.ledger_index, time: t.close_time_iso, tx: tx.TransactionType, ...rec });
    }
    marker = r.result.marker;
  } while (marker && out.length < limit);
  return out;
}

export async function txFacts(hash) {
  const c = await api();
  const r = await c.request({ command: 'tx', transaction: hash });
  const tx = r.result.tx_json || r.result;
  return { hash, validated: r.result.validated, ledger: r.result.ledger_index, account: tx.Account, type: tx.TransactionType, record: decodeMemo(tx.Memos), result: r.result.meta?.TransactionResult };
}
