import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import dns from 'node:dns';
// Kiln sits behind a Cloudflare edge that can take >250 ms to accept; Node's happy-eyeballs
// gives each address only 250 ms and then fails with ETIMEDOUT. Prefer IPv4, one patient attempt.
dns.setDefaultResultOrder('ipv4first');
net.setDefaultAutoSelectFamily(false);
export const root = path.resolve(import.meta.dirname, '..');
try { // tiny .env loader, no dependency
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
export const cfg = {
  dataDir: path.join(root, 'data'),
  keysFile: path.join(root, '.keys', 'accounts.json'),
  xrplWs: process.env.XRPL_WS || 'wss://s.altnet.rippletest.net:51233',
  faucetHost: 'faucet.altnet.rippletest.net',
  explorer: 'https://testnet.xrpl.org/transactions/',
  kilnKey: process.env.KILN_API_KEY,
  kilnBase: process.env.KILN_BASE_URL || 'https://api.bricksum.com/v1',
  // The brief asks for gpt-oss-120b. On 2026-09-30 Kiln answers 404 model_not_found for it
  // (GET /v1/models serves qwen3-32b and deepseek-v4.1-flash), so we probe it first and fall back.
  kilnModel: process.env.KILN_MODEL || 'gpt-oss-120b',
  kilnFallback: process.env.KILN_FALLBACK_MODEL || 'qwen3-32b',
  // Energy ASSUMPTION (Kiln exposes no power telemetry): FuriosaAI RNGD card TDP.
  // energy upper bound per call = TDP × measured wall-clock latency (as if the card served only us).
  npuWatts: Number(process.env.NPU_WATTS || 180),
};
