// Frames (CDP screencast, variable rate) → 1080p H.264 with an ocean ambience bed.
// If the take is longer than MAX seconds, only the live-run stretches are sped up (captions say "live").
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const DIR = '/tmp/helm-film', MAX = 172, OUT = process.argv[2] || 'docs/helm-demo.mp4';
const { frames, marks } = JSON.parse(fs.readFileSync(DIR + '/timeline.json', 'utf8'));
const t0 = frames[0].t; // screencast starts right before the first mark, so frame clock ≈ mark clock (±0.2 s)
const markT = Object.fromEntries(marks.map((m) => [m.m, m.t]));
const wall0 = markT.title; // first mark ≈ first frame
const dur = frames.map((f, i) => (i < frames.length - 1 ? frames[i + 1].t - f.t : 0.5));
const rel = frames.map((f) => f.t - t0 + wall0);
const live = (x) => x >= markT.r1 && x < markT.logbook;
const total = dur.reduce((a, b) => a + b, 0), liveT = dur.reduce((a, d, i) => a + (live(rel[i]) ? d : 0), 0);
const k = total > MAX ? Math.max(0.35, (MAX - (total - liveT)) / liveT) : 1;
console.log({ total: total.toFixed(1), liveT: liveT.toFixed(1), speed: (1 / k).toFixed(2) + 'x on live runs' });
let list = '', out = 0;
frames.forEach((f, i) => { const d = dur[i] * (live(rel[i]) ? k : 1); out += d; list += `file '${f.file}'\nduration ${d.toFixed(4)}\n`; });
list += `file '${frames.at(-1).file}'\n`;
fs.writeFileSync(DIR + '/list.txt', list);
const D = out.toFixed(2);
execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', DIR + '/list.txt',
  '-f', 'lavfi', '-i', `anoisesrc=color=brown:amplitude=0.6:duration=${D}`,
  '-filter_complex', `[0:v]scale=1920:1080:flags=lanczos,fps=30,format=yuv420p[v];[1:a]lowpass=f=700,highpass=f=60,tremolo=f=0.12:d=0.8,volume=0.5,afade=t=in:d=2,afade=t=out:st=${(out - 3).toFixed(2)}:d=3[a]`,
  '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', OUT], { stdio: 'inherit' });
console.log('wrote', OUT, D + 's');
