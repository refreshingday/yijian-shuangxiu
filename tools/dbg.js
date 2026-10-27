// Prints the moments leading up to each AI crash. Usage: node tools/dbg.js [seed]
import { createState, step } from '../src/sim.js';
import { AIPilot, AI_PRESETS } from '../src/ai.js';

const s = createState(+process.argv[2] || 1003);
const bots = [new AIPilot(0, { ...AI_PRESETS.sharp, follow: 0 }), new AIPilot(1, { ...AI_PRESETS.sharp, follow: 1 })];
let prev = [{ steer: 0 }, { steer: 0 }];
const hist = [];
while (s.alive && s.t < 300) {
  const i0 = bots[0].update(s, prev[1]);
  const i1 = bots[1].update(s, prev[0]);
  prev = [i0, i1];
  step(s, prev);
  hist.push(`t=${s.t.toFixed(2)} z=${s.z.toFixed(1)} x=${s.x.toFixed(2)} vx=${s.vx.toFixed(1)} tgt=${bots[0].target}/${bots[1].target} y=${s.y.toFixed(2)} g=${s.grounded} j=${+!!i0.jump}${+!!i1.jump} st=${i0.steer.toFixed(2)},${i1.steer.toFixed(2)}`);
  for (const e of s.events) if (e.type === 'hit') {
    const o = s.course.obstaclesIn(s.z - 3, s.z + 30).map(o => `${o.type}@${o.z.toFixed(0)},${o.x}`).join(' ');
    console.log('HIT', e.obstacle, '\n ', hist.slice(-40).filter((_, i) => i % 3 === 0).join('\n  '), '\n  near:', o);
  }
  s.events.length = 0;
}
