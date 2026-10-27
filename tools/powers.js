// Counts how often each 法宝 is grabbed in AI runs. Usage: node tools/powers.js [rounds]
import { createState, step } from '../src/sim.js';
import { AIPilot, AI_PRESETS } from '../src/ai.js';

const counts = {}, rounds = +process.argv[2] || 10;
let time = 0;
for (let r = 0; r < rounds; r++) {
  const s = createState(500 + r);
  const bots = [new AIPilot(0, { ...AI_PRESETS.normal, follow: 0.5 }), new AIPilot(1, { ...AI_PRESETS.normal, follow: 0.5 })];
  let prev = [{ steer: 0 }, { steer: 0 }];
  while (s.alive) {
    prev = [bots[0].update(s, prev[1]), bots[1].update(s, prev[0])];
    step(s, prev);
    for (const e of s.events) if (e.type === 'power') counts[e.kind] = (counts[e.kind] || 0) + 1;
    s.events.length = 0;
  }
  time += s.t;
}
console.log('per minute:', Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, +(v / (time / 60)).toFixed(2)])));
