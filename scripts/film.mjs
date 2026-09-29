// Records the demo: drives the real UI (live Kiln + XRPL runs) and captures frames via CDP screencast.
// node scripts/film.mjs → /tmp/helm-film/frames + timeline.json ; scripts/cut.sh renders the mp4.
import { chromium } from '/Users/minsungpark/.npm-global/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';

const OUT = '/tmp/helm-film';
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT + '/frames', { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
// headless Chrome shows viewport−87px; 987 → exactly 1600×900 visible
const p = await b.newPage({ viewport: { width: 1600, height: 987 }, deviceScaleFactor: 1 });
p.on('pageerror', (e) => console.log('pageerror', e.message));
const cdp = await p.context().newCDPSession(p);
const frames = []; let n = 0;
cdp.on('Page.screencastFrame', async (f) => {
  const file = `${OUT}/frames/${String(n++).padStart(6, '0')}.jpg`;
  fs.writeFileSync(file, Buffer.from(f.data, 'base64')); frames.push({ file, t: f.metadata.timestamp });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
const t0 = Date.now(); const marks = [];
const mark = (m) => { marks.push({ m, t: (Date.now() - t0) / 1000 }); console.log(((Date.now() - t0) / 1000).toFixed(1), m); };
const wait = (ms) => p.waitForTimeout(ms);

await p.goto('http://localhost:4800/?film=1');
await p.evaluate(() => document.fonts.ready);
await p.addStyleTag({ content: `
  /* headless Chrome paints only the top 900 px of the 987 px layout: pin fixed layers to that */
  #world, main, #film { bottom: 87px !important; } header { top: 0; }
  #cap { pointer-events: none; position: fixed; left: 28px; bottom: 113px; max-width: 560px; z-index: 60; background: rgba(18,48,90,.92); color: #fbf7e9; padding: 14px 20px 15px; border-radius: 16px; font: 500 19px/1.42 'Instrument Sans'; box-shadow: 0 18px 40px -18px rgba(0,0,0,.6); transition: opacity .4s, transform .4s; }
  #cap.off { opacity: 0; transform: translateY(8px); }
  #cap.hi { left: 84px; bottom: auto; top: 318px; max-width: 520px; }
  #cap b { color: #f6e27a; font-weight: 700; }
  #cap small { display: block; font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: #9fe3cf; margin-bottom: 4px; font-weight: 700; }
  #film { pointer-events: none; position: fixed; inset: 0; z-index: 70; display: grid; place-items: center; text-align: center; background: rgba(251,247,233,.18); backdrop-filter: blur(3px); transition: opacity .8s; }
  #film.off { opacity: 0; pointer-events: none; }
  #film h1 { font: italic 600 150px/0.9 Fraunces; letter-spacing: -0.04em; color: #12305a; margin: 0; }
  #film h2 { font: 600 44px/1.15 Fraunces; letter-spacing: -0.02em; color: #12305a; margin: 0 auto; max-width: 1100px; }
  #film p { font: 500 22px/1.5 'Instrument Sans'; color: #3c5a80; margin: 22px auto 0; max-width: 900px; }
  #film .tag { font: 700 13px 'Instrument Sans'; letter-spacing: .16em; text-transform: uppercase; color: #7b8fa8; margin-bottom: 18px; }
  #film em { color: #b8452a; }
  #film .row { display: flex; gap: 12px; justify-content: center; margin-top: 26px; flex-wrap: wrap; }
  #film .row span { background: rgba(251,247,233,.85); border: 1px solid rgba(18,48,90,.12); padding: 9px 16px; border-radius: 999px; font: 600 16px 'Instrument Sans'; color: #12305a; }
` });
await p.evaluate(() => { const c = document.createElement('div'); c.id = 'cap'; c.className = 'off'; document.body.append(c); const f = document.createElement('div'); f.id = 'film'; f.className = 'off'; document.body.append(f); });
let capHi = false;
const cap = async (html, label = '') => { await p.evaluate(([h, l, hi]) => { const c = document.getElementById('cap'); c.innerHTML = (l ? `<small>${l}</small>` : '') + h; c.className = (h ? '' : 'off') + (hi ? ' hi' : ''); }, [html, label, capHi]); };
const card = async (html) => { await p.evaluate((h) => { const f = document.getElementById('film'); if (h) f.innerHTML = `<div>${h}</div>`; f.className = h ? '' : 'off'; }, html); };
const stepsWith = (txt, timeout = 120000) => p.waitForFunction((t) => [...document.querySelectorAll('#steps .step b')].some((b) => b.textContent.includes(t)), txt, { timeout });

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
await p.evaluate(() => { document.getElementById('compose').classList.add('away'); });

// 1 — title
mark('title');
await card(`<div class="tag">GWDC 2026 · FuriosaAI × Bricksum · Challenge A</div><h1>helm</h1><p>Set a destination. An AI navigator steers your money there — across T‑bills, 국채, stocks, REITs, gold and crypto — and tells you when it can't.</p><div class="row"><span>Kiln NPU inference</span><span>XRPL Testnet AMMs</span><span>every decision on‑chain</span></div>`);
await wait(6500);
await card(`<div class="tag">The problem</div><h2>There are a hundred ways to grow money,<br/>and nobody knows which one wins <em>next</em>.</h2><p>So people pick one, ride it into a crash, and sell at the bottom. helm makes switching strategy — tacking — the whole game.</p>`);
await wait(6500);
await card('');

// 2 — Agora Prime regatta
mark('regatta');
await p.click('nav button[data-page="regatta"]'); await wait(900); capHi = true;
await cap('Six rule‑based <b>captains</b> sail 4½ years of real weekly prices. <b>Agora Prime</b> follows whichever two have the wind — and tacks ⚑ when the lead changes.', 'Agora Prime · the regatta');
await p.evaluate(() => { document.getElementById('scrub').value = 0; document.getElementById('scrub').dispatchEvent(new Event('input')); });
await wait(1200); await p.click('#play'); await wait(8000);
await cap('Your <b>dip limit</b> is the rule of the game: cross it and you capsize — that\'s where real people panic‑sell. At 30%, the flashy captains sink. <b>Prime finishes first: 2.62×.</b>', 'Capsizing is losing');
await wait(6000);
await p.click('#limit button:nth-child(2)'); await p.click('#dial button:nth-child(5)'); await wait(600);
await cap('Tighten the limit to 20% and lower Prime\'s sail — it still arrives, 1.71×, while only the timid captains stay afloat.', 'Same captains, less sail');
await wait(5500);
await p.click('#limit button:nth-child(3)'); await p.click('#dial button:nth-child(8)'); await cap(''); capHi = false;

// 3 — R1 normal voyage (live)
mark('r1');
await p.click('nav button[data-page="voyage"]'); await wait(500);
await p.evaluate(() => { document.getElementById('compose').classList.remove('away'); document.getElementById('goal').value = ''; });
await cap('A real person, real words. Everything that follows runs <b>live</b>: Kiln inference and XRPL Testnet transactions.', 'Run 1 · a normal voyage');
await p.type('#goal', 'I have $10,000 saved. I want it to become $15,000 in 3 years. I can live with a 30% dip, but no memecoins please.', { delay: 16 });
await wait(600); await p.click('#go');
await stepsWith('Understood your destination');
await cap('<b>Kiln LLM · intake</b> turns words into a goal. Code checks every number — dates are computed in code, never trusted to the model.', 'Run 1 · live');
await stepsWith('read the charter back');
await cap('You sign the <b>charter</b> on XRPL. helm reads it back from the ledger and acts on what you signed.', 'Run 1 · live');
await stepsWith('Charted');
await cap('Code charts 8 courses × 3,000 simulated voyages on real prices. 0 tokens. Then the <b>Kiln navigator</b> picks a course — and a guard makes sure it\'s viable.', 'Run 1 · live');
await stepsWith('Decision written', 180000);
await cap('Each sail trim is an <b>XRPL AMM swap</b> from the vault, and the decision hash is written to the logbook.', 'Run 1 · settled on‑chain');
await p.waitForSelector('#verdict.on'); await wait(4500);

// 4 — R2 budget changed (live)
mark('r2');
await p.click('#amendBtn'); await wait(700);
await cap('Life happens. You get a bonus and add <b>$3,000</b> — same destination, same date.', 'Run 2 · the budget changed');
await p.evaluate(() => { document.getElementById('goal').value = ''; });
await p.type('#goal', 'Good news — I got a bonus and I am adding $3,000. Same goal: $15,000, same date. I would rather sleep well now.', { delay: 16 });
await wait(500); await p.click('#go');
await stepsWith('Charted');
await cap('More money aboard means you need fewer knots. helm re‑charts from the vault\'s <b>on‑chain holdings</b>…', 'Run 2 · live');
await stepsWith('Navigator sets course');
await cap('…and chooses a calmer course. Watch it <b>tack</b>: sell crypto, buy T‑bills — the least risk that still gets you there.', 'Run 2 · adapting');
await stepsWith('Decision written', 180000);
await p.waitForSelector('#verdict.on'); await wait(4500);

// 5 — R3 decline (live)
mark('r3');
await p.click('#newBtn'); await wait(700);
await cap('Now a goal no honest advisor should accept.', 'Run 3 · an impossible goal');
await p.evaluate(() => { document.getElementById('goal').value = ''; });
await p.type('#goal', 'Turn $10,000 into $100,000 by next October. I cannot stomach losing more than 15%.', { delay: 16 });
await wait(500); await p.click('#go');
await stepsWith('Navigator declines', 120000);
await cap('900% a year inside a 15% dip limit: every course has <b>0% odds</b>. helm declines — no money moves — and offers what <b>is</b> reachable.', 'Run 3 · declined, and recorded');
await p.waitForSelector('#verdict.on'); await wait(6000);

// 6 — logbook
mark('logbook');
await p.click('#lbBtn'); await wait(2500);
await cap('Every charter, trade and decision — including the decline — is readable from the ledger. <b>Verify</b> re‑hashes a decision and compares it with the chain.', 'Evidence');
await p.waitForSelector('.verify'); await wait(1200);
const vs = await p.$$('.verify'); for (const v of vs.slice(0, 3)) { await v.click(); await wait(900); }
await wait(2500);
await cap('Two Kiln calls per voyage; everything with a number is code. Token use and an energy upper bound are logged per flow.', 'Kiln · per flow');
await wait(5000);
await cap('');

// 7 — outro
mark('outro');
await card(`<div class="tag">helm</div><h2>Money grows fastest when you never capsize.</h2><p>Agora Prime switches strategy for you, on real odds, inside the line you drew — and every move is on the ledger.</p><div class="row"><span>github.com/METHEZONE/helm</span><span>Kiln · qwen3‑32b</span><span>XRPL Testnet</span></div>`);
await wait(7000);
mark('end');
await cdp.send('Page.stopScreencast');
fs.writeFileSync(OUT + '/timeline.json', JSON.stringify({ frames: frames.map((f) => ({ file: f.file, t: f.t })), marks }, null, 1));
await b.close();
console.log('frames', frames.length);
