// Deterministic course generation. Everything is a pure function of (seed, z, x),
// so host and guest can build the identical sky from a shared seed.
// There is no ground and no edge: the sky is endless sideways. It is generated in tiles of 7 lanes
// (TILE wide) on demand around wherever the sword is, and no obstacle spans the whole sky — chains,
// sword walls and vortices just come longer or shorter, so there is always a way around.

import { rollPower } from './powers.js';

export const LANES = [-9, -6, -3, 0, 3, 6, 9]; // within one tile
export const TILE = 21;
const N = LANES.length;
const laneIdx = r => Math.floor(r() * N);
const CHUNK = 60;
const RUNWAY = 90; // empty start

// Phase thresholds in distance (speed ramps with distance, see baseSpeedAt)
export const PHASES = [
  { z: 0, name: '筑基', lvl: 0 },
  { z: 280, name: '金丹', lvl: 1 },
  { z: 920, name: '元婴', lvl: 2 },
  { z: 1740, name: '化神', lvl: 3 },
  { z: 3000, name: '渡劫', lvl: 4 },
];

export function phaseAt(z) {
  let p = PHASES[0];
  for (const ph of PHASES) if (z >= ph.z) p = ph;
  return p;
}

export function baseSpeedAt(z) {
  return 14 * Math.min(2, 1 + z / 4500);
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(seed, i) {
  let h = (seed * 374761393 + i * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return h ^ (h >>> 16);
}

// Obstacle types (all floating in the sky):
//  rock  – 浮石 floating boulder, must dodge sideways   (w = half width)
//  bird  – 妖禽, sweeps across lanes, dodge or leap      (x(t) = x + amp*sin(freq*t+ph))
//  bar   – 锁灵链 glowing chain at sword height, any hop clears (h = height)
//  gate  – 剑阵 wall of hovering swords, needs a synced 腾空 leap
//  stone – 灵石 pickup
//  阴阳天眼 (from 化神): rocks may be `fake` (幻象: no collision; only 师兄/阳 sees through them) or
//  `hidden` (暗石: real, but only 师妹/阴 can see them)
//  power – 锦囊 pouch; every one looks the same, the kind (see powers.js) is only revealed on pickup
// 罡风漩涡 downdraft vortices are stored separately as ellipses {z0, z1, x, rx}: anything at cruising
// height inside one gets sucked down. Small ones cover a lane or two, big ones most of a tile —
// shorter near their edges, so skimming the side with a hop also works.

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const shuffle = (r, arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// chains and sword walls come in random lengths (w = half-length) centred on a lane
const chain = (r, z) => ({ type: 'bar', z, x: pick(r, LANES), w: 3 + r() * 6, h: 0.8, d: 0.6 });
const wall = (r, z) => ({ type: 'gate', z, x: pick(r, LANES), w: 4 + r() * 7, h: 2.0, d: 0.8 });

// a row of boulders leaving `free` lane indexes open; `reach` limits it to lanes near the first free one
function row(o, z, free, reach = 99) {
  LANES.forEach((l, i) => { if (!free.includes(i) && Math.abs(i - free[0]) <= reach) o.push(rock(z, l)); });
}
function vortex(g, z, len, x, rx) { g.push({ z0: z, z1: z + len, x, rx }); }
function power(o, z, x, kind) { o.push({ type: 'power', kind, z, x, w: 0.9, h: 0, y: 0.8, d: 1.0 }); }


const PATTERNS = [
  { id: 'rocks', min: 0, w: 4, gen(r, z, o) {
      const n = 1 + Math.floor(r() * 2);
      for (const i of shuffle(r, LANES.map((_, k) => k)).slice(0, n)) o.push(rock(z, LANES[i]));
      return 12;
    } },
  { id: 'row', min: 0, w: 3, gen(r, z, o) {
      const a = laneIdx(r), b = Math.min(N - 1, a + (r() < 0.5 ? 1 : 0));
      row(o, z, [a, b, laneIdx(r)], 2 + Math.floor(r() * 3));
      stonesLine(o, z - 10, LANES[a], 3);
      // sometimes a 法宝 waits in the gap
      if (r() < 0.5) power(o, z, LANES[b], rollPower(r, phaseAt(z).lvl));
      return 14;
    } },
  { id: 'stones', min: 0, w: 2, gen(r, z, o) { stonesLine(o, z, pick(r, LANES), 5); return 16; } },
  { id: 'slalom', min: 1, w: 3, gen(r, z, o) {
      let free = laneIdx(r);
      for (let i = 0; i < 3; i++) {
        row(o, z + i * 13, [free], 2);
        free += free === 0 ? 1 : free === N - 1 ? -1 : r() < 0.5 ? -1 : 1;
      }
      return 40;
    } },
  { id: 'chain', min: 1, w: 3, gen(r, z, o) {
      const c = chain(r, z);
      o.push(c);
      const x = c.x;
      stonesArc(o, z, x);
      if (r() < 0.35) power(o, z + 8, x, rollPower(r, phaseAt(z).lvl));
      return 18;
    } },
  { id: 'vortex', min: 1, w: 3, gen(r, z, o, g) {
      const len = baseSpeedAt(z) * (0.38 + r() * 0.08);
      vortex(g, z, len, pick(r, LANES) + (r() - 0.5) * 2, 2.8 + r() * 1.4);
      return len + 12;
    } },
  { id: 'twinvortex', min: 1, w: 2, gen(r, z, o, g) {
      const len = baseSpeedAt(z) * 0.36;
      const a = laneIdx(r);
      const b = (a + 2 + Math.floor(r() * 3)) % N;
      vortex(g, z, len, LANES[a], 3.1);
      vortex(g, z + 11, len, LANES[b], 3.1);
      return len + 22;
    } },
  { id: 'power', min: 0, w: 4, gen(r, z, o) {
      const x = pick(r, LANES);
      stonesLine(o, z - 9, x, 3);
      power(o, z, x, rollPower(r, phaseAt(z).lvl));
      return 14;
    } },
  { id: 'funnel', min: 1, w: 2, gen(r, z, o) {
      // outer lanes close in, then the middle — drift with the gap
      row(o, z, [1, 2, 3, 4, 5]);
      const c = 2 + Math.floor(r() * 3);
      row(o, z + 12, [c, c + (r() < 0.5 ? -1 : 1)]);
      return 24;
    } },
  { id: 'rockchain', min: 2, w: 3, gen(r, z, o) {
      const a = laneIdx(r);
      row(o, z, [a, Math.min(N - 1, a + 1), laneIdx(r)], 3);
      o.push(chain(r, z + 12));
      return 24;
    } },
  { id: 'wall', min: 2, w: 3, gen(r, z, o) {
      const w = wall(r, z);
      o.push(w);
      stonesArc(o, z, w.x, 2.6);
      return 18;
    } },
  { id: 'birds', min: 2, w: 2, gen(r, z, o) {
      const n = 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) {
        o.push({ type: 'bird', z: z + i * 12, x: pick(r, [-4.5, -1.5, 1.5, 4.5]), w: 0.9, h: 3, d: 0.8,
          amp: 5.5, freq: 1.2 + r() * 0.8, ph: r() * 6.28 });
      }
      return 12 * n + 6;
    } },
  { id: 'widevortex', min: 2, w: 2, gen(r, z, o, g) {
      // covers three lanes; slip past on one side or hop it
      const len = baseSpeedAt(z) * 0.4;
      vortex(g, z, len, (r() < 0.5 ? -1 : 1) * (2 + r() * 3.5), 5.6 + r() * 1.0);
      return len + 14;
    } },
  { id: 'pouches', min: 1, w: 2, gen(r, z, o) {
      // two pouches side by side: pick one, or squeeze between and take neither
      const a = Math.floor(r() * (N - 1));
      const lvl = phaseAt(z).lvl;
      power(o, z, LANES[a], rollPower(r, lvl));
      power(o, z, LANES[a + 1], rollPower(r, lvl));
      return 14;
    } },
  { id: 'bigvortex', min: 3, w: 2, gen(r, z, o, g) {
      // a huge one: go around, leap it in the middle, or skim the thinner edge with a hop
      const len = baseSpeedAt(z) * (0.66 + r() * 0.06);
      vortex(g, z, len, pick(r, LANES), 7 + r() * 4);
      stonesArc(o, z + len / 2 - 4, pick(r, LANES), 2.4);
      return len + 14;
    } },
  { id: 'vortexrock', min: 3, w: 2, gen(r, z, o, g) {
      const len = baseSpeedAt(z) * 0.36;
      vortex(g, z, len, pick(r, LANES), 4.2);
      const a = Math.floor(r() * (N - 1));
      row(o, z + len + 9, [a, a + 1, laneIdx(r)]);
      return len + 20;
    } },
  { id: 'rockwallchain', min: 3, w: 2, gen(r, z, o) {
      const free = laneIdx(r);
      row(o, z, [free, (free + 3 + Math.floor(r() * 2)) % N]);
      o.push({ type: 'bar', z, x: LANES[free], w: 1.6, h: 0.8, d: 0.6 });
      return 16;
    } },
  { id: 'phantom', min: 3, w: 2.5, gen(r, z, o) {
      // a wall that is partly illusion: 师兄 sees which boulders are fake
      const a = laneIdx(r);
      const start = o.length;
      row(o, z, [a], 3);
      const rocks = o.slice(start);
      for (const k of shuffle(r, rocks.map((_, i) => i)).slice(0, 2 + Math.floor(r() * 2))) rocks[k].fake = true;
      return 16;
    } },
  { id: 'hidden', min: 3, w: 2, gen(r, z, o) {
      // 暗石 only 师妹 can see, sitting in otherwise open sky (sometimes on a 灵石 line)
      const lanes = shuffle(r, LANES.map((_, k) => k)).slice(0, 2 + Math.floor(r() * 2));
      for (const i of lanes) { o.push(rock(z + (r() - 0.5) * 6, LANES[i])); o[o.length - 1].hidden = true; }
      if (r() < 0.5) stonesLine(o, z - 12, LANES[lanes[0]], 4);
      return 14;
    } },
  { id: 'wallbird', min: 4, w: 2, gen(r, z, o) {
      const w = wall(r, z);
      o.push(w);
      o.push({ type: 'bird', z: z + 14, x: w.x, w: 0.9, h: 3, d: 0.8, amp: 7.5, freq: 1.8, ph: r() * 6.28 });
      return 26;
    } },
];

// Boulders get jittered position and size (from the chunk's rng) so the 7 lanes don't read as a grid.
let jit = null;
function rock(z, x) {
  if (!jit) return { type: 'rock', z, x, w: 1.15, h: 99, d: 1.0, s: 1 };
  const s = 0.85 + jit() * 0.4;
  return { type: 'rock', z: z + (jit() - 0.5) * 2.4, x: x + (jit() - 0.5) * 0.9, w: 1.15 * s, h: 99, d: 1.0, s };
}
function stonesLine(o, z, x, n) { for (let i = 0; i < n; i++) o.push({ type: 'stone', z: z + i * 3, x, w: 0.9, h: 0, y: 0.7, d: 0.8 }); }
function stonesArc(o, z, x, peak = 1.6) {
  for (let i = -2; i <= 2; i++) o.push({ type: 'stone', z: z + i * 2.5, x, w: 0.9, h: 0, y: 0.7 + peak * (1 - (i * i) / 5), d: 0.8 });
}

export class Course {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.chunks = new Map();
  }

  // chunk i along the flight, tile j sideways
  chunk(i, j = 0) {
    const key = i * 1024 + (j + 512);
    let c = this.chunks.get(key);
    if (c) return c;
    const z0 = i * CHUNK;
    const obs = [], gaps = [];
    if (z0 + CHUNK > RUNWAY) {
      const r = mulberry32(hash(hash(this.seed, i), j + 7777));
      const lvl = phaseAt(z0).lvl;
      const spacing = 12 - lvl * 2.4;
      let z = Math.max(z0, RUNWAY);
      // Patterns may spill past the chunk end; the next chunk starts after the spill.
      const prev = i > 0 ? this.chunk(i - 1, j) : null;
      if (prev && prev.end > z) z = prev.end;
      while (z < z0 + CHUNK) {
        const pool = PATTERNS.filter(p => p.min <= lvl);
        // newer patterns get extra weight so each phase feels different
        let tot = 0;
        for (const p of pool) tot += p.w * (p.min === lvl ? 1.6 : 1);
        let k = r() * tot, pat = pool[0];
        for (const p of pool) { k -= p.w * (p.min === lvl ? 1.6 : 1); if (k <= 0) { pat = p; break; } }
        jit = r;
        const used = pat.gen(r, z, obs, gaps);
        jit = null;
        z += used + spacing * (0.6 + r() * 0.8);
      }
      c = { obs, gaps, end: z };
    } else {
      c = { obs, gaps, end: z0 + CHUNK };
    }
    // shift the tile into place; ids stay unique per (chunk, tile) and grow with i (the sim prunes by id)
    const dx = j * TILE;
    obs.forEach((o, k) => { o.x += dx; o.id = (i * 128 + (((j % 64) + 64) % 64)) * 1000 + k; });
    for (const g of gaps) g.x += dx;
    this.chunks.set(key, c);
    // drop chunks far behind to bound memory
    if (this.chunks.size > 240) for (const k of this.chunks.keys()) if (Math.floor(k / 1024) < i - 4) this.chunks.delete(k);
    return c;
  }

  tiles(xc, half) {
    return [Math.floor((xc - half) / TILE + 0.5), Math.floor((xc + half) / TILE + 0.5)];
  }

  // All obstacles with z in [z0, z1) in the tiles covering xc ± half
  obstaclesIn(z0, z1, out = [], xc = 0, half = 24) {
    out.length = 0;
    const a = Math.max(0, Math.floor(z0 / CHUNK) - 1), b = Math.floor(z1 / CHUNK);
    const [ja, jb] = this.tiles(xc, half);
    for (let j = ja; j <= jb; j++) for (let i = a; i <= b; i++) for (const o of this.chunk(i, j).obs) if (o.z >= z0 && o.z < z1) out.push(o);
    return out;
  }

  vortexesIn(z0, z1, out = [], xc = 0, half = 24) {
    out.length = 0;
    const a = Math.max(0, Math.floor(z0 / CHUNK) - 1), b = Math.floor(z1 / CHUNK);
    const [ja, jb] = this.tiles(xc, half);
    for (let j = ja; j <= jb; j++) for (let i = a; i <= b; i++) for (const g of this.chunk(i, j).gaps) if (g.z1 > z0 && g.z0 < z1) out.push(g);
    return out;
  }

  // Centre line of the flight path in world space (x right, y up) and its slope along z.
  // Purely visual: the sim works in path-local coordinates, so bends never change difficulty.
  path(z, out = {}) {
    if (!this.ph) { const r = mulberry32(hash(this.seed, 99991)); this.ph = [r(), r(), r(), r()].map(v => v * 6.283); }
    const ph = this.ph;
    const k1 = 6.283 / 420, k2 = 6.283 / 170, k3 = 6.283 / 300, k4 = 6.283 / 120;
    const fx = 22 * Math.sin(z * k1 + ph[0]) + 9 * Math.sin(z * k2 + ph[1]);
    const fdx = 22 * k1 * Math.cos(z * k1 + ph[0]) + 9 * k2 * Math.cos(z * k2 + ph[1]);
    const fy = 6 * Math.sin(z * k3 + ph[2]) + 2.5 * Math.sin(z * k4 + ph[3]);
    const fdy = 6 * k3 * Math.cos(z * k3 + ph[2]) + 2.5 * k4 * Math.cos(z * k4 + ph[3]);
    // ease the bends in after the start
    const u = Math.min(1, Math.max(0, (z - 40) / 260));
    const e = u * u * (3 - 2 * u), de = u > 0 && u < 1 ? (6 * u * (1 - u)) / 260 : 0;
    out.x = e * fx; out.dx = e * fdx + de * fx;
    out.y = e * fy; out.dy = e * fdy + de * fy;
    return out;
  }

  vortexAt(x, z) {
    const i = Math.floor(z / CHUNK);
    const [ja, jb] = this.tiles(x, 12);
    for (let j = ja; j <= jb; j++) for (let k = Math.max(0, i - 1); k <= i; k++) for (const g of this.chunk(k, j).gaps) {
      if (z <= g.z0 || z >= g.z1) continue;
      const hz = (g.z1 - g.z0) / 2, u = (z - g.z0 - hz) / hz, v = (x - g.x) / g.rx;
      if (u * u + v * v < 1) return g;
    }
    return null;
  }
}

export function birdX(o, t) {
  return o.x + o.amp * Math.sin(o.freq * t + o.ph);
}
