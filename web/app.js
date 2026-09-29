// helm UI — vanilla JS. One renderer consumes voyage events, live (streamed from the agent) or replayed.
const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const usd = (x) => '$' + Math.round(x).toLocaleString('en-US');
const pct = (x, d = 0) => (x * 100).toFixed(d) + '%';
const short = (h) => h.slice(0, 10) + '…' + h.slice(-4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COURSE = { 0.04: 'Anchored', 0.08: 'Harbor breeze', 0.12: 'Light air', 0.18: 'Steady breeze', 0.25: 'Fresh breeze', 0.35: 'Brisk', 0.5: 'Strong wind', 0.7: 'Full sail' };
const DIAL = Object.keys(COURSE).map(Number);
const CAPTAIN = { harbor: 'Harbor', lighthouse: 'Lighthouse', ballast: 'Ballast', tradewind: 'Trade Wind', monsoon: 'Monsoon', corsair: 'Corsair' };
const CAP_COLOR = { harbor: '#7fa9bd', lighthouse: '#c46a3c', ballast: '#5d8f86', tradewind: '#2f6fb3', monsoon: '#1fae8f', corsair: '#d9534f' };
let S = { state: null, regatta: null, goal: null, courses: null, chosen: null, lastVoyage: null, amend: null };

function toast(t) { const x = $('#toast'); x.textContent = t; x.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => x.classList.remove('on'), 2600); }

// ------------------------------------------------------------------ the sea
const sea = { amp: 1, speed: 1, dark: 0, t: { amp: 1, speed: 1, dark: 0 } };
function setSea(o) { Object.assign(sea.t, o); }
(function drawSea() {
  const c = $('#sea'), g = c.getContext('2d');
  const bands = [
    { y: 0.02, a: 5, f: 0.011, s: 0.25, col: ['#7fd3d6', '#3d7fae'] },
    { y: 0.16, a: 8, f: 0.009, s: 0.4, col: ['#4fb3d6', '#2b5fa6'] },
    { y: 0.34, a: 11, f: 0.007, s: 0.6, col: ['#2f8fd8', '#1d3f8a'] },
    { y: 0.55, a: 14, f: 0.0055, s: 0.85, col: ['#2466c0', '#162f6e'] },
    { y: 0.76, a: 17, f: 0.0045, s: 1.1, col: ['#1c4fa3', '#0f2556'] },
  ];
  let t0 = performance.now();
  function frame(now) {
    const dt = (now - t0) / 1000; t0 = now;
    for (const k of ['amp', 'speed', 'dark']) sea[k] += (sea.t[k] - sea[k]) * Math.min(1, dt * 1.2);
    const W = (c.width = c.clientWidth * devicePixelRatio), H = (c.height = c.clientHeight * devicePixelRatio);
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const w = W / devicePixelRatio, h = H / devicePixelRatio, T = now / 1000;
    bands.forEach((b, i) => {
      const y0 = b.y * h, A = b.a * sea.amp;
      const grad = g.createLinearGradient(0, y0 - A, 0, h);
      grad.addColorStop(0, mix(b.col[0], '#2c3440', sea.dark * 0.6)); grad.addColorStop(1, mix(b.col[1], '#141a24', sea.dark * 0.6));
      g.fillStyle = grad; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w + 8; x += 8) {
        const y = y0 + Math.sin(x * b.f + T * b.s * sea.speed + i) * A + Math.sin(x * b.f * 2.3 - T * b.s * 0.7 * sea.speed + i * 2) * A * 0.35;
        g.lineTo(x, y);
      }
      g.lineTo(w, h); g.closePath(); g.fill();
      // brush strokes on the crests
      g.strokeStyle = `rgba(255,255,255,${0.16 + 0.05 * i})`; g.lineWidth = 1.4; g.lineCap = 'round';
      for (let x = (i * 57) % 90; x < w; x += 90 + i * 13) {
        const y = y0 + Math.sin(x * b.f + T * b.s * sea.speed + i) * A + 3;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y - 3, x + 28 + i * 4, y + 1); g.stroke();
      }
    });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
function mix(a, b, k) { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const A = p(a), B = p(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`; }

const ship = $('#ship');
function sailTo(leftPct, { flip = false, rig = '' } = {}) { ship.style.left = leftPct + '%'; ship.classList.toggle('flip', flip); ship.classList.remove('reef', 'full'); if (rig) ship.classList.add(rig); }
function storm(on) { document.body.classList.toggle('storm', on); setSea(on ? { amp: 2.4, speed: 2.2, dark: 1 } : { amp: 1, speed: 1, dark: 0 }); }

// ------------------------------------------------------------------ navigation
document.querySelectorAll('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.page)));
function show(page) {
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.page === page));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === page));
  const onVoyage = page === 'voyage';
  ship.style.opacity = onVoyage ? 1 : 0.25; $('#island').style.opacity = onVoyage ? 1 : 0.3;
  if (page === 'regatta') race.start();
  if (page === 'logbook') loadLogbook();
}

// ------------------------------------------------------------------ compose
const EXAMPLES = [
  ['$10k → $15k in 3 yrs, no memecoins', 'I have $10,000 saved. I want it to become $15,000 in 3 years. I can live with a 30% dip, but no memecoins please.'],
  ['House deposit by 2029', 'I have $20,000 for a house deposit and need $26,000 by December 2029. Please keep any drop under 15%.'],
  ['Go bold for 5 years', 'Put $5,000 to work for 5 years. I want $12,000. I am bold, dips up to 35% are fine.'],
  ['10× by next October', 'Turn $10,000 into $100,000 by next October. I cannot stomach losing more than 15%.'],
];
EXAMPLES.forEach(([label, text]) => { const b = el('button', '', label); b.onclick = () => { $('#goal').value = text; S.amend = null; }; $('#examples').append(b); });
const rec = el('div', 'chips'); rec.style.marginTop = '-6px';
rec.append(el('span', 'fine', 'Recorded on testnet:'));
[['v1', 0, 'Normal voyage'], ['v1', 1, 'Budget changed'], ['v2', 0, 'Impossible goal']].forEach(([id, n, label], i) => {
  const b = el('button', '', `R${i + 1} · ${label}`); b.onclick = () => replay(id, n); rec.append(b);
});
$('#examples').after(rec);
$('#go').onclick = () => live($('#goal').value.trim());

// ------------------------------------------------------------------ voyage renderer
function resetHud(text) {
  $('#compose').classList.add('away'); $('#hud').classList.add('on');
  $('#words').innerHTML = `<small>${S.amend ? 'Change of plans' : 'The sailor said'}</small>“${text}”`;
  $('#steps').innerHTML = ''; $('#logTitle').textContent = 'Setting out';
  $('#verdict').className = 'card'; $('#verdict').innerHTML = '';
  ['#dTarget', '#dBy', '#dPct', '#kStake', '#kNeed', '#kDD'].forEach((s) => ($(s).textContent = '—'));
  $('#dOdds').classList.remove('bad'); $('#cone').innerHTML = '';
  if (!S.amend) { $('#sails').innerHTML = ''; $('#wind').innerHTML = ''; }
  storm(false); sailTo(S.amend ? 36 : 12); S.tacked = false; pending(true);
}
const NEXT = { listen: 'Kiln is reading your words…', intake: 'Signing the charter on XRPL…', charter: 'Reading it back from the ledger…', read: 'Charting courses across 24,000 simulated voyages…', chart: 'Kiln navigator is choosing a course…', navigate: 'Settling on XRPL…', board: 'Planning the sails…', plan: 'Swapping on the XRPL AMM…', trade: 'Swapping on the XRPL AMM…', record: 'Wrapping up…' };
function pending(on, after) { const p = $('#pending'); if (p) p.remove(); if (!on) return; const x = el('div', 'step pending', `<div class="ic"><span class="spin"></span></div><div><div class="d">${NEXT[after] || 'Listening…'}</div></div>`); x.id = 'pending'; $('#steps').append(x); $('#steps').scrollTop = 1e6; }
function step(kind, title, detail = '', meta = '') {
  const icon = { ai: 'AI', chain: '⛓', code: 'ƒ', stop: '!' }[kind] || '·';
  const tag = { ai: '<span class="tag ai">Kiln LLM</span>', chain: '<span class="tag chain">XRPL</span>', code: '<span class="tag code">code</span>', stop: '' }[kind] || '';
  const s = el('div', 'step ' + kind, `<div class="ic">${icon}</div><div><b>${title}</b>${tag}${detail ? `<div class="d">${detail}</div>` : ''}${meta ? `<div class="meta">${meta}</div>` : ''}</div>`);
  $('#steps').append(s); $('#steps').scrollTop = 1e6;
}
const txLink = (h) => `<a href="${S.state.explorer}${h}" target="_blank">tx ${short(h)}</a>`;
const kilnMeta = (c) => (c ? `${c.model} · ${c.prompt}→${c.completion} tok · ${c.ms} ms · ≤${c.joulesMax} J` : '');

function renderGoal(g) {
  S.goal = g;
  $('#dTarget').textContent = usd(g.target);
  $('#dBy').textContent = 'by ' + new Date(g.deadline).toLocaleDateString('en-US', { month: 'short', year: 'numeric', day: 'numeric' });
  $('#kStake').textContent = usd(g.stake); $('#kDD').textContent = pct(g.maxDrawdown);
}
function renderCone(course) {
  const g = S.goal, svg = $('#cone'); if (!g || !course) return;
  const W = 316, H = 118, n = 40, lo = Math.min(course.p10, 1) * 0.92, hi = Math.max(course.p90, g.target / g.stake) * 1.04;
  const y = (m) => H - 14 - ((Math.log(m) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (H - 26);
  const path = (q) => Array.from({ length: n + 1 }, (_, i) => { const f = i / n; const m = Math.exp(f * Math.log(course.p50) + Math.sqrt(f) * (Math.log(q) - Math.log(course.p50))); return `${(f * W).toFixed(1)},${y(m).toFixed(1)}`; });
  const up = path(course.p90), dn = path(course.p10), md = path(course.p50);
  const ty = y(g.target / g.stake);
  svg.innerHTML = `
    <path d="M${up.join(' L')} L${dn.reverse().join(' L')} Z" fill="rgba(47,143,216,.16)" />
    <path d="M${md.join(' L')}" fill="none" stroke="#2f8fd8" stroke-width="2.4" stroke-linecap="round" />
    <line x1="0" x2="${W}" y1="${ty}" y2="${ty}" stroke="#e7a92b" stroke-width="2" stroke-dasharray="5 5" />
    <text x="${W - 4}" y="${ty - 6}" text-anchor="end" font-size="11" font-weight="700" fill="#a56f00">destination ${usd(g.target)}</text>
    <line x1="0" x2="${W}" y1="${y(1)}" y2="${y(1)}" stroke="rgba(18,48,90,.25)" stroke-width="1" />
    <text x="4" y="${y(1) + 13}" font-size="10.5" fill="#7b8fa8">today ${usd(g.stake)}</text>
    <text x="${W - 4}" y="${H - 2}" text-anchor="end" font-size="10.5" fill="#7b8fa8">p10–p90 of 3,000 simulated voyages</text>`;
}
function renderSails(weights) {
  const box = $('#sails'); box.innerHTML = '';
  const rows = Object.entries(weights).filter(([, w]) => w > 0.004).sort((a, b) => b[1] - a[1]);
  for (const [c, w] of rows) {
    const a = S.state.assets.find((x) => x.code === c);
    const r = el('div', 'bar', `<span>${a ? a.name.replace(' (memecoin)', '').replace('Korea Treasury 10Y (국고채)', 'Korea 10Y 국채') : c}</span><div class="track"><div class="fill" style="width:0;background:${a?.color || '#999'}"></div></div><span class="v num">${pct(w)}</span>`);
    box.append(r); requestAnimationFrame(() => (r.querySelector('.fill').style.width = pct(w, 1)));
  }
}
function renderWind(lead, score) {
  $('#wind').innerHTML = lead.map((id) => { const s = score?.find(([x]) => x === id); return `<span class="cap">⛵ ${CAPTAIN[id]}${s ? ` <i>+${pct(s[1], 1)} / 8 wk</i>` : ''}</span>`; }).join('');
}
function setOdds(p, good) { $('#dPct').textContent = pct(p); $('#dOdds').classList.toggle('bad', !good); }

// the wheel ---------------------------------------------------------------
const wheel = $('#wheel');
(function spokes() {
  const g = $('#spokes');
  for (let i = 0; i < 8; i++) g.insertAdjacentHTML('beforeend', `<g transform="rotate(${i * 45})">
    <rect x="-4.5" y="-96" width="9" height="96" rx="3" fill="#8a4f22" /><rect x="-1.5" y="-94" width="3" height="90" fill="#d9a066" opacity=".6" />
    <rect x="-6.5" y="-124" width="13" height="32" rx="6.5" fill="${i === 0 ? '#c2452d' : '#9a5a26'}" stroke="#5a3214" stroke-width="1.5" /></g>`);
})();
const angleOf = (sigma) => -150 + (DIAL.indexOf(sigma) / (DIAL.length - 1)) * 300;
let wheelAngle = 0;
function turnWheel(sigma, instant) { wheel.classList.toggle('drag', !!instant); wheelAngle = angleOf(sigma); wheel.style.transform = `rotate(${wheelAngle}deg)`; }
function heading(sigma, chosen) {
  const c = S.courses?.find((x) => x.sigma === sigma);
  const good = c && c.pBreach <= S.state.rules.maxBreach && c.pHit >= S.state.rules.minHit;
  const kn = c && S.weeks ? ((c.p50 ** (52 / S.weeks) - 1) * 100).toFixed(1) : null;
  $('#heading').innerHTML = c ? `${chosen ? '⚓ ' : ''}<b>${COURSE[sigma]}</b> · ${kn} kn · <span class="${good ? 'h-odds' : ''}" style="${good ? '' : 'color:var(--warn)'}">${pct(c.pHit)} arrive</span> · ${pct(c.pBreach)} risk of a >${pct(S.goal.maxDrawdown)} dip` : `<b>${COURSE[sigma]}</b>`;
  if (c) { renderCone(c); if (!chosen) setOdds(c.pHit, good); }
}
let drag = null;
wheel.addEventListener('pointerdown', (e) => { if (!S.courses) return; drag = { x: e.clientX, a: wheelAngle }; wheel.setPointerCapture(e.pointerId); wheel.classList.add('drag'); });
wheel.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const a = Math.max(-150, Math.min(150, drag.a + (e.clientX - drag.x) * 0.9));
  wheel.style.transform = `rotate(${a}deg)`; wheelAngle = a;
  const idx = Math.round(((a + 150) / 300) * (DIAL.length - 1)); heading(DIAL[idx]);
  ship.classList.remove('reef', 'full'); ship.classList.add(idx < 3 ? 'reef' : idx > 5 ? 'full' : 'x');
});
wheel.addEventListener('pointerup', () => { if (!drag) return; drag = null; const idx = Math.round(((wheelAngle + 150) / 300) * (DIAL.length - 1)); turnWheel(DIAL[idx]); wheel.classList.remove('drag'); });

async function sweepWheel() { for (const s of DIAL) { turnWheel(s, true); heading(s); await sleep(140); } }

async function handle(e) {
  pending(!['result', 'error', 'done'].includes(e.type), e.type);
  switch (e.type) {
    case 'listen': step('ai', 'Listening to your words'); sailTo(S.amend ? 40 : 18); break;
    case 'intake': {
      const g = e.goal; renderGoal(g);
      step('ai', 'Understood your destination', `${usd(g.stake)} → <b>${usd(g.target)}</b> by ${g.deadline} · max dip ${pct(g.maxDrawdown)}${g.exclude.length ? ` · no ${g.exclude.join(', ')}` : ''} · ${g.tone}`, kilnMeta(e.call));
      break;
    }
    case 'charter': step('chain', e.hash && S.amend ? 'You signed the amended charter' : 'You signed the voyage charter', 'Your terms, readable by anyone, on the ledger.', txLink(e.hash)); break;
    case 'read': step('chain', 'helm read the charter back from the ledger', 'It acts on what you signed — not on what it was told.', `ledger #${e.ledger}`); break;
    case 'chart': {
      const sea = e.sea; S.courses = sea.courses;
      $('#kNeed').textContent = (sea.requiredCagr * 100).toFixed(1) + ' kn'; S.weeks = sea.weeks;
      renderWind(e.wind.lead, e.wind.score); S.wind = e.wind.score;
      const best = [...sea.courses].filter((c) => c.safe).sort((a, b) => b.pHit - a.pHit)[0];
      step('code', `Charted ${sea.courses.length} courses × 3,000 simulated voyages`, `You need <b>${pct(sea.requiredCagr, 1)} a year</b>. ${best ? `Best safe course: ${COURSE[best.sigma]}, ${pct(best.pHit)} to arrive.` : 'No course keeps your dip limit.'} ${sea.viable ? '' : '<b style="color:var(--warn)">No course has odds on your side.</b>'}`, '0 tokens · real 2022–2026 prices, block bootstrap');
      await sweepWheel();
      break;
    }
    case 'navigate': {
      const sail = e.decision === 'SAIL';
      step(sail ? 'ai' : 'stop', sail ? `Navigator sets course: ${COURSE[e.sigma]}` : 'Navigator declines this voyage', `<b>${e.headline}</b> — ${e.why || e.message}`, kilnMeta(e.call));
      for (const gnote of e.guard || []) step('code', 'Guard', gnote);
      if (sail) {
        const c = S.courses.find((x) => x.sigma === e.sigma); S.chosen = c;
        turnWheel(e.sigma); heading(e.sigma, true); setOdds(c.pHit, true);
        $('#logTitle').textContent = COURSE[e.sigma];
      } else {
        const best = [...S.courses].sort((a, b) => b.pHit - a.pHit)[0];
        setOdds(best.pHit, false); turnWheel(0.04); heading(0.04);
        $('#logTitle').textContent = 'Staying in harbor';
        storm(true); sailTo(29, { flip: true, rig: 'reef' });
        $('#sails').innerHTML = `<p class="fine" style="font-size:13px;line-height:1.5">Nothing moved. Your ${usd(S.goal.stake)} stays in your own wallet — helm never boards money for a voyage it won't sail.</p>`;
      }
      S.nav = e;
      break;
    }
    case 'board': step('chain', `You boarded ${usd(e.usd)} into the helm vault`, 'The only account helm can trade from.', txLink(e.hash)); break;
    case 'plan': {
      const crypto = ['BTC', 'ETH', 'SOL', 'DOG'].reduce((s, c) => s + (e.weights[c] || 0), 0);
      step('code', 'Trimming the sails', `Follow ${e.lead.map((x) => CAPTAIN[x]).join(' + ')} at ${pct(e.exposure)} sail; the rest waits in T‑bills. Crypto ${pct(crypto)} of the ship.`);
      renderSails(e.weights); renderWind(e.lead, S.wind);
      const idx = DIAL.indexOf(S.chosen?.sigma ?? 0.35);
      sailTo(S.amend ? 50 : 34, { rig: idx < 3 ? 'reef' : idx > 5 ? 'full' : '' });
      break;
    }
    case 'trade': { const t = e.trade;
      if (t.a === 'SELL' && !S.tacked) { S.tacked = true; ship.classList.remove('tacking'); void ship.offsetWidth; ship.classList.add('tacking'); toast('Tacking — helm switches position'); } step('chain', `${t.a === 'BUY' ? 'Bought' : 'Sold'} ${t.asset.replace(' (memecoin)', '')} · ${usd(t.usd)}`, `XRPL AMM swap, ${t.qty.toPrecision(4)} ${t.c} @ ${usd(t.price)}`, txLink(t.hash)); break; }
    case 'record': step('chain', e.decision === 'SAIL' ? 'Decision written to the logbook' : 'Decline written to the logbook', `Decision hash ${e.dh.slice(0, 16)}… — anyone can re‑check it.`, txLink(e.hash)); break;
    case 'result': finish(e.result); break;
    case 'error': step('stop', 'Voyage interrupted', e.error); toast(e.error); $('#go').disabled = false; break;
  }
}

function finish(r) {
  S.lastVoyage = r;
  const v = $('#verdict');
  const sail = r.decision.decision === 'SAIL';
  if (sail) {
    sailTo(S.amend ? 62 : 52, { rig: ship.classList.contains('reef') ? 'reef' : ship.classList.contains('full') ? 'full' : '' });
    v.className = 'card on';
    v.innerHTML = `<div class="eyebrow">⚓ Under way · ${r.execution.trades.length} trades settled on XRPL</div><h2>${r.nav.headline}</h2><p>${r.nav.message}</p>
      <div class="row"><button class="cta" id="amendBtn">Life changed? Re‑plan</button><button class="cta ghost" id="lbBtn">Open logbook</button><button class="cta ghost" id="newBtn">New destination</button></div>`;
    $('#newBtn').onclick = () => { S.amend = null; $('#compose').classList.remove('away'); $('#hud').classList.remove('on'); v.className = 'card'; sailTo(12); };
    $('#amendBtn').onclick = () => { S.amend = r.id; $('#compose').classList.remove('away'); $('#hud').classList.remove('on'); v.className = 'card'; $('#goal').value = 'Good news — I got a bonus and I am adding $3,000. Same goal: $15,000, same date. I would rather sleep well now.'; $('#goal').focus(); };
  } else {
    v.className = 'card on stop';
    const c = r.decision.counters;
    v.innerHTML = `<div class="eyebrow">Declined · recorded on‑chain, no money moved</div><h2>${r.nav.headline}</h2><p>${r.nav.message}</p>
      <div class="alts">
        ${c.sameDeadline ? `<button class="alt" data-t="${c.sameDeadline.target}"><b>${usd(c.sameDeadline.target)}</b><span>same date, same dip limit · even odds</span></button>` : ''}
        ${c.sameTarget ? `<button class="alt"><b>${new Date(c.sameTarget.deadline).getFullYear()}</b><span>same target, later landfall · ${pct(c.sameTarget.odds)} odds</span></button>` : `<button class="alt"><b>Not in 25 yrs</b><span>${usd(r.goal.target)} with a ${pct(r.goal.maxDrawdown)} dip limit</span></button>`}
      </div><div class="row"><button class="cta ghost" id="lbBtn">Open logbook</button><button class="cta ghost" id="againBtn">New destination</button></div>`;
    $('#againBtn').onclick = () => { S.amend = null; $('#compose').classList.remove('away'); $('#hud').classList.remove('on'); v.className = 'card'; storm(false); sailTo(12); };
  }
  $('#lbBtn').onclick = () => show('logbook');
  $('#go').disabled = false;
}

async function live(text) {
  if (!text) return;
  $('#go').disabled = true; resetHud(text);
  const r = await fetch('/api/voyage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, amend: S.amend, id: S.amend || undefined }) });
  if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || 'failed'); $('#go').disabled = false; return; }
  const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) await handle(JSON.parse(line)); }
  }
}

// Replay a recorded testnet voyage with its real events (gaps compressed for watching).
async function replay(id, n) {
  const v = S.state.voyages.filter((x) => x.id === id)[n]; // files are time-ordered: v1[0] = first run, v1[1] = re-plan
  if (!v) return toast('No recorded voyage yet — run it live.');
  S.amend = n > 0 ? id : null;
  resetHud(v.text); $('#go').disabled = true;
  let prev = 0;
  for (const e of v.log) { await sleep(Math.max(320, Math.min(1100, e.at - prev))); prev = e.at; await handle(e); }
  await handle({ type: 'result', result: v });
}

// ------------------------------------------------------------------ regatta
const race = (() => {
  const cv = $('#raceCanvas'), g = cv.getContext('2d');
  let sigma = 0.7, prog = 1, playing = false, limit = 0.3;
  const dial = $('#dial');
  const lim = $('#limit');
  [0.15, 0.2, 0.3, 0.4].forEach((L) => { const b = el('button', L === limit ? 'on' : '', `${pct(L)} dip`); b.onclick = () => { limit = L; lim.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); draw(); }; lim.append(b); });
  DIAL.forEach((s) => { const b = el('button', s === sigma ? 'on' : '', COURSE[s]); b.onclick = () => { sigma = s; dial.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); draw(); }; dial.append(b); });
  $('#scrub').oninput = (e) => { prog = e.target.value / 1000; playing = false; draw(); };
  $('#play').onclick = () => play();
  function series() {
    const R = S.regatta, P = R.prime.find((p) => p.sigma === sigma);
    return { R, P, lines: [...R.captains.map((c) => ({ id: c.id, name: c.name, style: c.style, curve: c.curve, color: CAP_COLOR[c.id] })), { id: 'prime', name: 'Agora Prime', style: `${COURSE[sigma]} · tacks between captains`, curve: P.curve, color: '#e7a92b', prime: true }] };
  }
  function draw() {
    if (!S.regatta) return;
    const { R, P, lines } = series();
    const W = (cv.width = cv.clientWidth * devicePixelRatio), H = (cv.height = cv.clientHeight * devicePixelRatio);
    g.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    const w = W / devicePixelRatio, h = H / devicePixelRatio, n = P.curve.length, upto = Math.max(1, Math.round(prog * (n - 1)));
    const all = lines.flatMap((l) => l.curve), lo = Math.log(Math.min(...all) * 0.95), hi = Math.log(Math.max(...all) * 1.05);
    const X = (i) => 46 + (i / (n - 1)) * (w - 200), Y = (v) => h - 26 - ((Math.log(v) - lo) / (hi - lo)) * (h - 44);
    g.clearRect(0, 0, w, h);
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, 'rgba(255,255,255,.35)'); bg.addColorStop(1, 'rgba(47,143,216,.10)');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.font = '600 11px Instrument Sans'; g.fillStyle = '#7b8fa8'; g.strokeStyle = 'rgba(18,48,90,.08)'; g.lineWidth = 1;
    for (const m of [0.6, 0.8, 1, 1.5, 2, 3]) { if (Math.log(m) < lo || Math.log(m) > hi) continue; g.beginPath(); g.moveTo(46, Y(m)); g.lineTo(w - 154, Y(m)); g.stroke(); g.fillText(m + '×', 8, Y(m) + 4); }
    R.weeks.forEach((wk, i) => { if (wk.slice(5, 7) === '01' && R.weeks[i - 1]?.slice(5, 7) !== '01') { g.fillText(wk.slice(0, 4), X(i) - 12, h - 8); g.beginPath(); g.moveTo(X(i), 14); g.lineTo(X(i), h - 26); g.stroke(); } });
    for (const l of lines) l.sank = capsize(l.curve, limit);
    let sunkN = 0;
    // limit line hint
    for (const l of lines) {
      const end = l.sank != null ? Math.min(l.sank, upto) : upto;
      g.strokeStyle = l.color; g.lineWidth = l.prime ? 4.5 : 2.2; g.globalAlpha = l.prime ? 1 : 0.85; g.lineJoin = 'round'; g.setLineDash([]);
      g.beginPath(); for (let i = 0; i <= end; i++) i ? g.lineTo(X(i), Y(l.curve[i])) : g.moveTo(X(i), Y(l.curve[i])); g.stroke();
      if (l.sank != null && upto > l.sank) { // after capsizing: a ghost of what it would have done
        g.globalAlpha = 0.22; g.lineWidth = 1.5; g.setLineDash([3, 4]);
        g.beginPath(); for (let i = l.sank; i <= upto; i++) i > l.sank ? g.lineTo(X(i), Y(l.curve[i])) : g.moveTo(X(i), Y(l.curve[i])); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
        const x = X(l.sank), y = Y(l.curve[l.sank]);
        g.save(); g.translate(x, y); g.rotate(Math.PI); boat(g, 0, 0, l.color, 1.1); g.restore();
        g.fillStyle = '#c2542d'; g.font = '700 11px Instrument Sans'; g.fillText(`✕ ${l.name}`, x - 20, y + 22 + 13 * sunkN++);
      }
      g.globalAlpha = 1;
    }
    // tacks
    for (const t of P.tacks) { if (t.i > upto) continue; const x = X(t.i), y = Y(P.curve[t.i]); g.fillStyle = '#e0442e'; g.beginPath(); g.moveTo(x, y - 4); g.lineTo(x, y - 18); g.lineTo(x + 9, y - 14); g.lineTo(x, y - 11); g.fill(); g.strokeStyle = '#12305a'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y - 2); g.lineTo(x, y - 18); g.stroke(); }
    // boats at the heads + labels
    const heads = lines.filter((l) => l.sank == null || l.sank >= upto).map((l) => ({ ...l, v: l.curve[upto], y: Y(l.curve[upto]) })).sort((a, b) => a.y - b.y);
    let lastY = -99;
    for (const l of heads) {
      const x = X(upto); boat(g, x, l.y, l.color, l.prime ? 1.5 : 1);
      const ly = Math.max(l.y, lastY + 14); lastY = ly;
      g.fillStyle = l.prime ? '#8a5b00' : '#3c5a80'; g.font = `${l.prime ? 800 : 600} ${l.prime ? 12.5 : 11}px Instrument Sans`; g.fillText(`${l.name} ${l.v.toFixed(2)}×`, x + 14, ly + 4);
    }
    $('#raceDate').textContent = R.weeks[upto];
    $('#scrub').value = Math.round(prog * 1000);
    board(lines, upto, P);
  }
  function capsize(c, L) { let pk = 0; for (let i = 0; i < c.length; i++) { pk = Math.max(pk, c[i]); if (1 - c[i] / pk > L) return i; } return null; }
  function boat(g, x, y, col, s) { g.save(); g.translate(x, y); g.scale(s, s); g.fillStyle = '#7c2c1d'; g.beginPath(); g.moveTo(-8, 1); g.lineTo(8, 1); g.lineTo(5, 5); g.lineTo(-5, 5); g.fill(); g.fillStyle = col; g.beginPath(); g.moveTo(0, -12); g.lineTo(7, 0); g.lineTo(0, 0); g.fill(); g.fillStyle = '#fbf7e9'; g.beginPath(); g.moveTo(-1, -10); g.lineTo(-7, 0); g.lineTo(-1, 0); g.fill(); g.restore(); }
  function board(lines, upto, P) {
    const rows = lines.map((l) => { let pk = 0, dd = 0; for (let i = 0; i <= upto; i++) { pk = Math.max(pk, l.curve[i]); dd = Math.max(dd, 1 - l.curve[i] / pk); } const sunk = l.sank != null && l.sank <= upto; return { ...l, v: l.curve[upto], dd, sunk }; }).sort((a, b) => (a.sunk - b.sunk) || b.v - a.v);
    const following = P.lead[Math.min(upto, P.lead.length - 1)] || [];
    $('#lb').innerHTML = rows.map((r, i) => `<div class="lb ${r.prime ? 'prime' : ''} ${r.sunk ? 'sunk' : ''}"><span class="rk">${r.sunk ? '✕' : i + 1}</span><span class="nm"><b style="color:${r.prime ? '#8a5b00' : 'inherit'}">${r.prime ? '★ ' : ''}${r.name}${!r.prime && following.includes(r.id) ? ' <span style="color:#e0442e">⚑ followed</span>' : ''}</b><span>${r.sunk ? `capsized ${S.regatta.weeks[r.sank].slice(0, 7)} — broke your ${pct(limit)} dip limit` : r.style}</span></span><span class="x num">${r.v.toFixed(2)}×</span><span class="dd num">−${pct(r.dd)}</span></div>`).join('') + `<p class="fine" style="margin-top:8px">× = growth since Apr 2022 · −% = worst dip so far · ${P.tacks.filter((t) => t.i <= upto).length} tacks by Prime</p>`;
  }
  async function play() { if (playing) return; playing = true; for (prog = 0.02; prog <= 1 && playing; prog += 0.0045) { draw(); await sleep(28); } prog = 1; playing = false; draw(); }
  return { start: () => { document.fonts.ready.then(() => requestAnimationFrame(draw)); }, play, draw, set: (s) => { sigma = s; draw(); } };
})();
addEventListener('resize', () => race.draw());

// ------------------------------------------------------------------ logbook
async function loadLogbook() {
  const [j, st] = await Promise.all([fetch('/api/logbook').then((r) => r.json()), fetch('/api/state').then((r) => r.json())]);
  S.state = st;
  const words = (r) => {
    const d = r.data;
    if (r.type === 'charter' || r.type === 'amend') return `${usd(d.stake)} → ${usd(d.target)} by ${d.by} · max dip ${pct(d.dd)}${d.ex?.length ? ' · no ' + d.ex.join(',') : ''}`;
    if (r.type === 'board') return `${usd(d.usd)} into the vault`;
    if (r.type === 'trim') return `${d.a} ${d.c} ${usd(d.usd)} · AMM swap`;
    if (r.type === 'log') return `SAIL · ${COURSE[d.s] || d.s} · ${pct(d.p)} odds · ${d.n} trades · follow ${d.lead.map((x) => CAPTAIN[x]).join('+')}`;
    if (r.type === 'decline') return `DECLINE · counter-offers: ${d.alt?.sameDeadline ? usd(d.alt.sameDeadline.target) + ' same date' : ''}${d.alt?.sameTarget ? ' / same target by ' + d.alt.sameTarget.deadline : ''}`;
    return JSON.stringify(d);
  };
  $('#chainRows').innerHTML = j.records.slice().reverse().map((r) => `<tr><td><span class="pill ${r.type}">${r.type}</span><div class="fine mono" style="margin-top:4px">${r.data.v}</div></td><td>${r.by}</td><td>${words(r)}${['log', 'decline'].includes(r.type) ? ` <button class="verify" data-tx="${r.hash}">verify</button>` : ''}</td><td>${txLink(r.hash)}<div class="fine">#${r.ledger}</div></td></tr>`).join('');
  document.querySelectorAll('.verify').forEach((b) => (b.onclick = async () => {
    const v = await (await fetch('/api/verify?tx=' + b.dataset.tx)).json();
    b.textContent = v.match ? '✓ hash matches ledger' : '✗ mismatch'; b.classList.toggle('ok', !!v.match);
    toast(v.match ? `Decision re-hashed: ${v.recomputed.slice(0, 12)}… = on-chain` : 'hash mismatch');
  }));
  const flows = {};
  for (const v of S.state.voyages) for (const c of v.kiln) { const f = (flows[c.flow] ||= { calls: 0, p: 0, c: 0, ms: 0, j: 0 }); f.calls++; f.p += c.prompt; f.c += c.completion; f.ms += c.ms; f.j += c.joulesMax; }
  const tot = Object.values(flows).reduce((a, f) => ({ calls: a.calls + f.calls, tok: a.tok + f.p + f.c, j: a.j + f.j }), { calls: 0, tok: 0, j: 0 });
  $('#kTotals').innerHTML = `<div><span>Kiln calls</span><strong>${tot.calls}</strong></div><div><span>Tokens</span><strong>${tot.tok.toLocaleString()}</strong></div><div><span>≤ Energy</span><strong>${(tot.j / 1000).toFixed(1)} kJ</strong></div>`;
  $('#kilnRows').innerHTML = Object.entries(flows).map(([k, f]) => `<tr><td><b>${k}</b></td><td>${f.calls}</td><td class="mono">${f.p} / ${f.c}</td><td class="mono">${Math.round(f.ms / f.calls)} ms avg</td><td class="mono">${f.j.toFixed(0)} J</td></tr>`).join('') + `<tr><td><b>chart · guard · trades · records</b></td><td>—</td><td class="mono">0 / 0</td><td class="mono">code</td><td class="mono">0 J</td></tr>`;
  $('#kNote').innerHTML = `Two LLM calls per voyage: <b>intake</b> (words → goal) and <b>navigate</b> (choose a course or decline, and explain it). Everything with a number — 24,000 simulated voyages, the guard, trade sizing, every swap — is code. Energy is an estimate: FuriosaAI RNGD TDP 180 W × measured wall‑clock latency, one card per call; Kiln exposes no power telemetry.`;
  $('#holdRows').innerHTML = (j.portfolio?.rows || []).map((r) => { const a = S.state.assets.find((x) => x.code === r.code); return `<tr><td><b>${a ? a.name : 'hUSD (testnet dollar)'}</b></td><td class="mono">${r.qty < 1e-6 ? "0" : r.qty.toPrecision(6)} ${r.code}</td><td class="mono" style="text-align:right">${usd(r.usd)}</td></tr>`; }).join('') + (j.portfolio ? `<tr><td><b>Total</b></td><td></td><td class="mono" style="text-align:right"><b>${usd(j.portfolio.total)}</b></td></tr>` : '');
}

// ------------------------------------------------------------------ boot
(async () => {
  const [st, rg] = await Promise.all([fetch('/api/state').then((r) => r.json()), fetch('/api/regatta').then((r) => r.json())]);
  S.state = st; S.regatta = rg;
  $('#walletChip').textContent = 'sailor ' + st.accounts.sailor.slice(0, 6) + '…' + st.accounts.sailor.slice(-4);
  const m = st.voyages[0]?.kiln?.[0]?.model; if (m) $('#kilnChip').textContent = 'Kiln NPU · ' + m;
  turnWheel(0.35);
  const q = new URLSearchParams(location.search);
  if (q.get('page')) show(q.get('page'));
  if (q.get('replay')) { const [id, n] = q.get('replay').split(':'); replay(id, +n || 0); }
})();
