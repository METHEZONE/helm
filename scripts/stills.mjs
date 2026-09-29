// README/deck screenshots from the real UI (replays the recorded testnet voyages).
import { chromium } from '/Users/minsungpark/.npm-global/lib/node_modules/playwright/index.mjs';
import fs from 'node:fs';
fs.mkdirSync('docs/img', { recursive: true });
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1600, height: 987 }, deviceScaleFactor: 2 }); // visible 1600×900
const shot = (name, clip = { x: 0, y: 0, width: 1600, height: 900 }) => p.screenshot({ path: `docs/img/${name}.png`, clip });
const U = 'http://localhost:4800/';
// headless Chrome paints only the top 900 px of the 987 px layout: pin fixed layers to that
const go = async (url) => { await p.goto(url); await p.addStyleTag({ content: '#world, main { bottom: 87px !important; }' }); await p.evaluate(() => document.fonts.ready); };
await go(U);
const ids = await p.evaluate(async () => (await (await fetch('/api/state')).json()).voyages.map((v) => v.id));
const [r1] = ids;
await go(U + `?replay=${r1}:0`); await p.waitForSelector('#verdict.on', { timeout: 60000 }); await p.waitForTimeout(3500); await shot('voyage');
await go(U + `?replay=${r1}:1`); await p.waitForSelector('#verdict.on', { timeout: 60000 }); await p.waitForTimeout(3500); await shot('replan');
await go(U + `?replay=${ids.at(-1)}:0`); await p.waitForSelector('#verdict.on', { timeout: 60000 }); await p.waitForTimeout(4000); await shot('decline');
await go(U + '?page=regatta'); await p.waitForTimeout(2500); await shot('regatta');
const c = await p.$('#raceCanvas'); const bb = await c.boundingBox(); await shot('regatta-chart', { x: bb.x, y: bb.y, width: bb.width, height: bb.height });
await go(U + '?page=logbook'); await p.waitForTimeout(6000);
for (const v of (await p.$$('.verify')).slice(0, 2)) { await v.click(); await p.waitForTimeout(1200); }
await shot('logbook');
await go(U); await p.waitForTimeout(2000); await shot('home');
await b.close();
console.log('stills done');
