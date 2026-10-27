// Headless AI-vs-AI runs to tune difficulty. Usage: node tools/soak.js [rounds] [preset]
import { createState, step, DT } from '../src/sim.js';
import { AIPilot, AI_PRESETS } from '../src/ai.js';

const rounds = +process.argv[2] || 30;
const preset = AI_PRESETS[process.argv[3] || 'normal'];
const times = [], causes = {}, stats = { crashes: 0, syncLeaps: 0, offsync: 0, hits: {} };
for (let r = 0; r < rounds; r++) {
  let seed = 1000 + r * 7919;
  const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const s = createState(1000 + r);
  const bots = [new AIPilot(0, { ...preset, follow: +(process.env.F0 ?? 0.5) }, rng), new AIPilot(1, { ...preset, follow: +(process.env.F1 ?? 0.5) }, rng)];
  let prev = [{ steer: 0, jump: false, boost: false }, { steer: 0, jump: false, boost: false }];
  while (s.alive) {
    const i0 = bots[0].update(s, prev[1]);
    const i1 = bots[1].update(s, prev[0]);
    prev = [i0, i1];
    step(s, prev);
    for (const e of s.events) if (e.type === 'hit' || e.type === 'fall') {
      const k = e.type === 'fall' ? 'fall' : e.obstacle;
      if (!stats.hits[k]) stats.hits[k] = 0;
      stats.hits[k] = (stats.hits[k] || 0) + 1;
    }
    s.events.length = 0;
    if (s.t > 600) break;
  }
  times.push(s.t);
  causes[s.cause] = (causes[s.cause] || 0) + 1;
  stats.syncLeaps += s.stats.syncLeaps; stats.offsync += s.stats.offsync;
}
times.sort((a, b) => a - b);
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
console.log('rounds', rounds, 'median', fmt(times[times.length >> 1]), 'min', fmt(times[0]), 'max', fmt(times[times.length - 1]));
console.log('p25', fmt(times[Math.floor(times.length * 0.25)]), 'p75', fmt(times[Math.floor(times.length * 0.75)]));
console.log('causes', causes, 'hits by type', stats.hits, 'syncLeaps', stats.syncLeaps, 'offsync', stats.offsync);
