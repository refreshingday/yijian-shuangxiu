// Pure, deterministic game simulation. y = 0 is cruising altitude; vortices pull you below it.
// No DOM, no Three.js — runs in node for soak tests.
// Player 0 = 阳 (male), player 1 = 阴 (female).

import { Course, baseSpeedAt, phaseAt, birdX } from './course.js';
import { POWERS, TIMED } from './powers.js';

export const DT = 1 / 60;
export const WIN_TIME = 240;

const G = 30;
const HOP_V = 9;        // single hop: peak ~1.35, air ~0.6s
const LEAP_V = 13.4;    // synced 腾空: peak ~3.0, air ~0.89s
const SYNC_WINDOW = 0.2;
const LAT_MAX = 6.2;    // lateral speed from ONE player at full steer
const QI_MAX = 100;

const DELAY_TICKS = 21; // 迟钝咒 input lag (~0.35s)
const CLOUD_Y = 1.7;    // 腾云 cruising height
const PULL_RANGE = 3.2; // how far outside a vortex rim its suction reaches
const PULL_SPEED = 4.2; // sideways drag at the rim (one player steering away is 6.2)

export function createState(seed) {
  return {
    seed,
    course: new Course(seed),
    t: 0, z: 0, x: 0, y: 0, vx: 0, vy: 0,
    speed: 0, speedScale: 1, base: 14,
    hp: 3, qi: 60, invuln: 0,
    tribDist: 32,
    grounded: true, falling: false,
    jumpT0: -9, jumpBy: -1, upgraded: false, secondUsed: false,
    lastJump: [-9, -9],
    steer: [0, 0], ema: [0, 0], boosting: [false, false],
    boostMode: 0,   // 0 none, 1 solo, 2 双修
    tug: 0,
    pull: 0,
    fx: Object.assign(Object.fromEntries(TIMED.map(k => [k, 0])), { shield: 0, masterWho: -1, curseWho: -1, mirrorWho: -1 }),
    inputLog: [],
    combo: 0, bonus: 0,
    alive: true, won: false, cause: '',
    phase: '筑基',
    consumed: new Set(),
    events: [],
    stones: 0,
    stats: {
      crashBlame: [0, 0],
      crashes: 0,
      tugTime: 0,
      soloQi: [0, 0],
      dualQi: 0,
      jumps: [0, 0],
      syncLeaps: 0,
      offsync: 0,
      lateBy: [0, 0],   // accumulated seconds a player was late to a pair jump
      lateCount: [0, 0],
      good: [0, 0],     // good 锦囊 grabbed
      bad: [0, 0],      // bad 锦囊 grabbed
      nearMiss: 0,
      bestCombo: 0,
    },
  };
}

const near = [];
const vnear = [];

export function step(s, inputs) {
  if (!s.alive) return;
  const dt = DT;
  s.t += dt;
  const fx = s.fx;
  for (const k of TIMED) if (fx[k] > 0) {
    fx[k] -= dt;
    if (fx[k] <= 0) { fx[k] = 0; s.events.push({ type: 'fxEnd', kind: k }); }
  }

  // 迟钝咒: play back inputs from a moment ago
  s.inputLog.push(inputs);
  if (s.inputLog.length > DELAY_TICKS + 1) s.inputLog.shift();
  if (fx.delay > 0 && s.inputLog.length > DELAY_TICKS) inputs = s.inputLog[0];

  // ---------- steering: final control is the SUM ----------
  let a = clamp(inputs[0].steer, -1, 1), b = clamp(inputs[1].steer, -1, 1);
  if (isFlipped(fx, 0)) a = -a;   // 心魔 / 镜花水月 / 阴阳颠倒: left/right swapped
  if (isFlipped(fx, 1)) b = -b;
  const master = fx.master > 0 || fx.usurp > 0;
  if (master) { if (fx.masterWho === 0) { a *= 2; b = 0; } else { b *= 2; a = 0; } } // 剑主令: one player steers alone
  s.steer[0] = a; s.steer[1] = b;
  const k = 1 - Math.exp(-dt / 0.25);
  s.ema[0] += (a - s.ema[0]) * k;
  s.ema[1] += (b - s.ema[1]) * k;
  s.tug = a * b < 0 ? Math.min(Math.abs(a), Math.abs(b)) : 0;
  if (s.tug > 0.3) s.stats.tugTime += dt;

  const base = baseSpeedAt(s.z);
  s.base = base;
  const lat = LAT_MAX * Math.sqrt(base / 14) * (fx.sticky > 0 ? 0.45 : 1);
  let targetVx = clamp(a + b, -2, 2) * lat;
  if (fx.drunk > 0) targetVx += Math.sin(s.t * 2.3) * 5 + Math.sin(s.t * 3.7) * 2.5; // 醉仙酿 sway
  s.vx += (targetVx - s.vx) * Math.min(1, dt * (fx.sticky > 0 ? 4 : 12));
  s.x += s.vx * dt;
  // 罡风漩涡 suction: flying low past a vortex drags the sword toward its eye
  s.pull = 0;
  if (s.y < 1.2 && fx.giant <= 0 && fx.cloud <= 0) {
    s.course.vortexesIn(s.z - 4, s.z + 10, vnear, s.x, 14);
    for (const g of vnear) {
      const hz = (g.z1 - g.z0) / 2, u = (s.z - g.z0 - hz) / (hz + 4);
      if (Math.abs(u) >= 1) continue;
      const rim = g.rx * Math.sqrt(1 - u * u), d = s.x - g.x, out = Math.abs(d) - rim;
      if (out > PULL_RANGE) continue;
      const k = Math.min(1, 1 - out / PULL_RANGE) * (1 - Math.abs(u) * 0.5);
      s.x -= Math.sign(d || 1) * k * PULL_SPEED * dt;
      s.pull = Math.max(s.pull, k);
    }
  }

  // ---------- jump ----------
  for (let i = 0; i < 2; i++) {
    if (!inputs[i].jump) continue;
    s.stats.jumps[i]++;
    s.lastJump[i] = s.t;
    if (s.falling) continue;
    if (master && i !== fx.masterWho) continue;
    if (s.grounded) {
      s.vy = HOP_V; s.grounded = false;
      s.jumpT0 = s.t; s.jumpBy = i; s.upgraded = false; s.secondUsed = false;
      if (master) {
        // the 剑主 leaps on their own
        s.vy = LEAP_V; s.upgraded = true;
        s.events.push({ type: 'leap', by: i, late: 0, combo: s.combo });
      } else s.events.push({ type: 'hop', by: i });
    } else if (i !== s.jumpBy && !s.upgraded && !s.secondUsed) {
      const late = s.t - s.jumpT0;
      if (late <= SYNC_WINDOW) {
        // act as if the leap had started at jumpT0, so perfect and late syncs behave the same
        s.vy = LEAP_V - G * late;
        s.upgraded = true;
        s.stats.syncLeaps++;
        s.stats.lateBy[i] += late; s.stats.lateCount[i]++;
        s.combo++;
        s.stats.bestCombo = Math.max(s.stats.bestCombo, s.combo);
        s.bonus += 30 * s.combo;
        s.events.push({ type: 'leap', by: i, late, combo: s.combo });
      } else {
        s.vy = Math.max(s.vy, 0) + 4.5;
        s.secondUsed = true;
        s.stats.offsync++;
        s.stats.lateBy[i] += late; s.stats.lateCount[i]++;
        s.combo = 0;
        s.events.push({ type: 'offsync', by: i, late });
      }
    }
  }

  // ---------- boost (shared 灵力) ----------
  const sealed = fx.seal > 0; // 封灵
  const bA = !sealed && inputs[0].boost && s.qi > 0, bB = !sealed && inputs[1].boost && s.qi > 0;
  s.boosting[0] = bA; s.boosting[1] = bB;
  const prevMode = s.boostMode;
  s.boostMode = bA && bB ? 2 : bA || bB ? 1 : 0;
  let boostMult = 1;
  if (s.boostMode === 2) {
    boostMult = 1.6;
    const d = 22 * dt; s.qi -= d; s.stats.dualQi += d;
  } else if (s.boostMode === 1) {
    boostMult = 1.3;
    const d = 30 * dt; s.qi -= d; s.stats.soloQi[bA ? 0 : 1] += d;
  } else {
    s.qi += 3.5 * dt;
  }
  s.qi = clamp(s.qi, 0, QI_MAX);
  if (s.boostMode === 2 && prevMode !== 2) s.events.push({ type: 'dualboost' });

  // ---------- forward motion ----------
  s.speedScale = Math.min(1, s.speedScale + 0.45 * dt);
  const tugSlow = 1 - 0.3 * s.tug;
  const slow = fx.slow > 0 ? 0.65 : 1;   // 定时符 slows the whole world, tribulation included
  const gust = fx.gust > 0 ? 1.5 : 1;   // 疾风乱流 shoves you forward
  s.speed = base * boostMult * s.speedScale * tugSlow * slow * gust;
  const zPrev = s.z;
  s.z += s.speed * dt;
  s.phase = phaseAt(s.z).name;
  if (s.invuln > 0) s.invuln -= dt;

  // ---------- vertical ----------
  // cruising height is 0; 腾云 lifts it so chains and vortices pass underneath
  const floor = fx.cloud > 0 ? CLOUD_Y : 0;
  const sucks = fx.giant <= 0 && floor === 0; // the 巨剑 is too big for a vortex to swallow
  if (s.grounded) {
    if (s.y < floor) s.y = Math.min(floor, s.y + 5 * dt);
    else if (s.y > floor) { s.grounded = false; s.vy = 0; }
  }
  if (s.grounded && sucks) {
    const v = s.course.vortexAt(s.x, s.z);
    if (v) { s.grounded = false; s.falling = true; s.vy = 0; s.fallVortex = v; }
  }
  if (s.grounded && fx.bounce > 0) {
    // 弹跳符: hops on its own; anyone pressing jump in time still turns it into a leap
    s.vy = HOP_V * 0.85; s.grounded = false;
    s.jumpT0 = s.t; s.jumpBy = -1; s.upgraded = false; s.secondUsed = false;
    s.events.push({ type: 'hop', by: -1 });
  }
  if (!s.grounded) {
    s.vy -= G * dt;
    s.y += s.vy * dt;
    if (s.y <= floor) {
      const v2 = sucks ? s.course.vortexAt(s.x, s.z) : null;
      if (!v2 && s.y > floor - 0.6 && !(s.falling && floor === 0 && s.y < -0.6)) {
        // landed (scraping the rim counts)
        s.y = floor; s.vy = 0; s.grounded = true; s.falling = false;
        s.events.push({ type: 'land' });
      } else if (v2 && !s.falling) {
        s.falling = true; s.fallVortex = v2;
      }
    }
    if (s.falling && s.y < -6) respawnFromFall(s);
  }

  // ---------- tribulation ----------
  const tf = 0.92 + 0.42 * Math.pow(Math.min(1, s.t / WIN_TIME), 1.5);
  s.tribDist += (s.speed - base * tf * slow) * dt;
  if (s.tribDist > 45) s.tribDist = 45;
  if (s.tribDist <= 0) return die(s, 'trib');

  // ---------- collisions ----------
  const magnet = fx.magnet > 0;
  s.course.obstaclesIn(zPrev - 2, s.z + 2, near, s.x, 12);
  for (const o of near) {
    if (s.consumed.has(o.id)) continue;
    const ox = o.type === 'bird' ? birdX(o, s.t) : o.x;
    const dx = Math.abs(ox - s.x);
    // 擦肩: passed a boulder by a hair
    if (o.type === 'rock' && !o.fake && o.z > zPrev && o.z <= s.z && dx > o.w + 0.35 && dx < o.w + 1.1 && s.y < 3) {
      s.stats.nearMiss++; s.bonus += 20; s.qi = Math.min(QI_MAX, s.qi + 5);
      s.events.push({ type: 'near' });
    }
    if (o.type === 'stone') {
      const reachZ = magnet ? 6 : o.d / 2 + 0.7, reachX = magnet ? 4.5 : o.w + 0.35, reachY = magnet ? 3 : 1.3;
      if (Math.abs(o.z - s.z) < reachZ && dx < reachX && Math.abs(s.y + 0.6 - o.y) < reachY) {
        s.consumed.add(o.id); s.stones++; s.qi = Math.min(QI_MAX, s.qi + 10);
        s.events.push({ type: 'stone', id: o.id });
      }
      continue;
    }
    if (Math.abs(o.z - s.z) > o.d / 2 + 0.7) continue;
    if (o.type === 'power') {
      if (dx < o.w + 0.6 && Math.abs(s.y + 0.6 - o.y) < 1.6) { s.consumed.add(o.id); grabPower(s, o, ox); }
      continue;
    }
    if (dx > o.w + 0.35 || o.fake) continue;
    const top = o.type === 'bird' ? 1.8 : o.h;
    if (s.y >= top) continue;
    s.consumed.add(o.id);
    if (s.boostMode === 2 || fx.giant > 0) { s.events.push({ type: 'smash', id: o.id }); continue; }
    if (s.invuln > 0) continue;
    if (fx.shield > 0) {
      fx.shield--; s.invuln = 1.0;
      s.events.push({ type: 'shieldBreak', id: o.id });
      continue;
    }
    hit(s, o, ox);
    if (!s.alive) return;
  }
  if (s.consumed.size > 400) {
    const minId = (Math.floor(s.z / 60) - 3) * 128 * 1000;
    for (const id of s.consumed) if (id < minId) s.consumed.delete(id);
  }

  if (s.t >= WIN_TIME) { s.won = true; s.alive = false; s.cause = 'win'; s.events.push({ type: 'win' }); }
}

// Is player i's left/right swapped right now? Two flips cancel out.
export function isFlipped(fx, i) {
  const n = (fx.curse > 0 && fx.curseWho === i) + (fx.mirror > 0 && fx.mirrorWho === i) + (fx.swap > 0);
  return n % 2 === 1;
}

// Whoever steered toward it grabbed it — that decides who 剑主令 / 心魔 / 篡位 land on.
function grabPower(s, o, ox) {
  const d = Math.sign(ox - s.x);
  const c0 = s.ema[0] * d, c1 = s.ema[1] * d;
  const by = Math.abs(c0 - c1) < 0.1 ? (o.id & 1) : c0 > c1 ? 0 : 1;
  const kind = o.kind, def = POWERS[kind], fx = s.fx;
  if (def.good) s.stats.good[by]++; else s.stats.bad[by]++;
  switch (kind) {
    case 'shield': fx.shield = Math.min(2, fx.shield + 1); break;
    case 'heal': if (s.hp < 3) s.hp++; else s.qi = QI_MAX; break;
    case 'spring': s.qi = QI_MAX; break;
    case 'repel': s.tribDist = Math.min(45, s.tribDist + 15); break;
    case 'drain': s.qi = 0; break;
    case 'thunder': s.tribDist = Math.max(4, s.tribDist - 10); break;
    case 'master': fx.master = def.time; fx.usurp = 0; fx.masterWho = by; break;
    case 'usurp': fx.usurp = def.time; fx.master = 0; fx.masterWho = 1 - by; break;
    case 'curse': fx.curse = def.time; fx.curseWho = by; break;
    case 'mirror': fx.mirror = def.time; fx.mirrorWho = 1 - by; break; // the mirror bounces it onto the partner
    default: fx[kind] = def.time;
  }
  s.events.push({ type: 'power', kind, by, good: def.good, id: o.id });
}

function blameDodge(s, ox) {
  const d = Math.sign(ox - s.x) || -Math.sign(s.vx) || 1;
  const c0 = Math.max(0, s.ema[0] * d), c1 = Math.max(0, s.ema[1] * d);
  // nobody steered into it: nobody steered away either
  if (c0 + c1 < 0.15) return [0.5, 0.5];
  return [c0 / (c0 + c1), c1 / (c0 + c1)];
}

function blameJump(s, needLeap) {
  const recent = i => s.t - s.lastJump[i] < 0.8;
  const r0 = recent(0), r1 = recent(1);
  if (!r0 && !r1) return [0.5, 0.5];
  if (r0 && !r1) return needLeap ? [0, 1] : [0.5, 0.5];
  if (r1 && !r0) return needLeap ? [1, 0] : [0.5, 0.5];
  // both pressed but it still failed: the later one was off
  return s.lastJump[0] > s.lastJump[1] ? [1, 0] : [0, 1];
}

function hit(s, o, ox) {
  const blame = o.type === 'rock' || o.type === 'bird' ? blameDodge(s, ox)
    : blameJump(s, o.type === 'gate');
  damage(s, blame, { type: 'hit', obstacle: o.type, id: o.id });
}

function damage(s, blame, ev) {
  s.hp--;
  s.stats.crashes++;
  s.stats.crashBlame[0] += blame[0];
  s.stats.crashBlame[1] += blame[1];
  s.invuln = 1.3;
  s.speedScale = 0.45;
  s.combo = 0;
  ev.blame = blame;
  s.events.push(ev);
  if (s.hp <= 0) die(s, 'hp');
}

function respawnFromFall(s) {
  const v = s.fallVortex;
  // a small vortex could have been flown around; a huge one is fairer to blame on the jump
  const wide = v && v.rx > 6.5;
  const blame = v && !wide ? blameDodge(s, v.x) : blameJump(s, wide && (v.z1 - v.z0) / s.base > 0.5);
  if (v) s.z = Math.max(s.z, v.z1 + 1);
  s.y = 0; s.vy = 0; s.grounded = true; s.falling = false;
  s.tribDist -= 4;
  if (s.fx.shield > 0) {
    s.fx.shield--; s.invuln = 1.2;
    s.events.push({ type: 'shieldBreak' });
    return;
  }
  damage(s, blame, { type: 'fall' });
  if (s.alive) s.invuln = 1.6;
}

function die(s, cause) {
  s.alive = false; s.cause = cause;
  s.events.push({ type: 'dead', cause });
}

export function score(s) {
  return Math.floor(s.z) + s.stones * 25 + s.bonus;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
