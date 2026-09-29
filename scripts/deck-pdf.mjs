// docs/deck/deck.html → docs/helm-deck.pdf (10 pages, 1920×1080)
import { chromium } from '/Users/minsungpark/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto('file://' + process.cwd() + '/docs/deck/deck.html');
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
await p.pdf({ path: 'docs/helm-deck.pdf', width: '1920px', height: '1080px', printBackground: true, pageRanges: '1-10' });
for (let i = 0; i < 10; i++) { await p.evaluate((y) => window.scrollTo(0, y), i * 1080); await p.screenshot({ path: `/tmp/deck-${i + 1}.png`, clip: { x: 0, y: i * 1080, width: 1920, height: 1080 }, fullPage: true }); }
await b.close(); console.log('deck pdf done');
