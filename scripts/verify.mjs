// Read-only audit, no keys needed: for every recorded voyage, re-hash the decision JSON and compare it
// with the decision hash (`dh`) the vault wrote on XRPL Testnet; also check each swap tx is validated.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { txFacts, close } from '../src/chain.js';
const files = fs.readdirSync('data/voyages').filter((f) => f.endsWith('.json')).sort();
let ok = true;
for (const f of files) {
  const v = JSON.parse(fs.readFileSync('data/voyages/' + f, 'utf8'));
  const local = crypto.createHash('sha256').update(JSON.stringify(v.decision)).digest('hex');
  const rec = await txFacts(v.recordTx);
  const match = rec.validated && rec.record?.data?.dh === local;
  const swaps = await Promise.all((v.execution?.trades || []).map((t) => txFacts(t.hash)));
  const swapsOk = swaps.every((s) => s.validated && s.record?.type === 'trim');
  ok &&= match && swapsOk;
  console.log(`${match && swapsOk ? '✓' : '✗'} ${v.id} ${v.decision.decision.padEnd(7)} record ${v.recordTx.slice(0, 12)}… dh ${local.slice(0, 16)}… ${match ? 'matches ledger' : 'MISMATCH'} · ${swaps.length} swaps ${swapsOk ? 'validated' : 'NOT validated'}`);
}
await close();
process.exit(ok ? 0 : 1);
