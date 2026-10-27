// 剑灵 — AI partner. It produces ONE player's input; the sim sums it with the partner's,
// exactly like a human. Knobs make it sloppy or stubborn for testing the argument mechanics.

import { birdX } from './course.js';
import { POWERS } from './powers.js';
import { isFlipped } from './sim.js';

export const AI_PRESETS = {
  sharp:    { reaction: 0.12, noise: 0.05, jumpSigma: 0.03, follow: 1.0, stubborn: 0.0 },
  normal:   { reaction: 0.2,  noise: 0.12, jumpSigma: 0.06, follow: 0.85, stubborn: 0.08 },
  stubborn: { reaction: 0.22, noise: 0.15, jumpSigma: 0.07, follow: 0.2, stubborn: 0.45 },
};

// lateral targets relative to where the sword is now (the sky has no edges)
const OFFSETS = [-12, -10.5, -9, -7.5, -6, -4.5, -3, -1.5, 0, 1.5, 3, 4.5, 6, 7.5, 9, 10.5, 12];
const near = [];
const vnear = [];

export class AIPilot {
  constructor(idx, opts = AI_PRESETS.normal, rng = Math.random) {
    this.idx = idx;
    this.o = { ...AI_PRESETS.normal, ...opts };
    this.rng = rng;
    this.target = 0;
    this.nextThink = 0;
    this.ignorePartner = false;
    this.handled = new Set();
    this.jumpNoise = new Map();
    this.boostHold = false;
    this.wantJumpAt = -1;
    this.lastShout = -9;
    this.shout = null;
    this.curseSince = -1;
    this.heard = { dir: 0, until: -1, boostUntil: -1, trustUntil: -1, skipPouchUntil: -1, jump: false };
  }

  // 传音 from the human partner: the AI (mostly) does what it's told
  hear(text, t) {
    const h = this.heard;
    if (this.rng() < this.o.stubborn) { this.pendingShout = '凭什么?'; this.lastShout = t; return; }
    if (text === '往左!') { h.dir = -1; h.until = t + 1.2; }
    else if (text === '往右!') { h.dir = 1; h.until = t + 1.2; }
    else if (text === '跳啊!') h.jump = true;
    else if (text === '冲!') h.boostUntil = t + 1.5;
    else if (text === '信我!') h.trustUntil = t + 3;
    else if (text === '别抢!') h.skipPouchUntil = t + 3;
    this.pendingShout = ['好!', '收到!', '行!'][Math.floor(this.rng() * 3)]; this.lastShout = t;
  }

  gauss() {
    const u = this.rng() || 1e-6, v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283 * v);
  }

  update(s, partnerInput) {
    const o = this.o;
    const out = { steer: 0, jump: false, boost: false };
    this.shout = this.pendingShout || null;
    this.pendingShout = null;
    if (!s.alive) return out;
    const h = this.heard;
    if (s.t >= this.nextThink && h.until > s.t) this.nextThink = s.t; // react to a call right away
    const v = Math.max(1, s.speed);
    const latFull = 6.2 * Math.sqrt(s.base / 14);

    // ---- think (reaction-limited) ----
    if (s.t >= this.nextThink) {
      this.nextThink = s.t + o.reaction * (0.7 + this.rng() * 0.6);
      this.ignorePartner = this.rng() < o.stubborn;
      const look = Math.min(48, Math.max(16, v * 1.4));
      s.course.obstaclesIn(s.z + 0.3, s.z + look, near, s.x, 24);
      s.course.vortexesIn(s.z + 0.3, s.z + look, vnear, s.x, 24);
      let best = this.target, bestCost = this.laneCost(s, this.target, v, partnerInput) - 0.15;
      for (const off of OFFSETS) {
        const c = Math.round((s.x + off) / 1.5) * 1.5;
        const cost = this.laneCost(s, c, v, partnerInput);
        if (cost < bestCost) { bestCost = cost; best = c; }
      }
      if (best !== this.target && Math.abs(best - this.target) > 2 && partnerInput &&
          Math.sign(partnerInput.steer) === -Math.sign(best - s.x) && Math.abs(partnerInput.steer) > 0.5) {
        this.shout = best > s.x ? '往右!' : '往左!';
      }
      this.target = best;
      this.eyeShout(s, v, partnerInput);
    }

    // ---- steer: aim total lateral velocity, compensate for partner unless being stubborn ----
    const desired = clamp((this.target - s.x) * 3.2 - s.vx * 0.15, -2 * latFull, 2 * latFull);
    let need = desired / latFull;
    const follow = this.ignorePartner ? 0 : h.trustUntil > s.t ? 1 : o.follow;
    if (partnerInput) need -= partnerInput.steer * follow;
    // If the partner is already pushing the right way, don't brake against them until we are nearly there.
    const err = this.target - s.x;
    if (partnerInput && !this.ignorePartner && Math.abs(err) > 0.6 &&
        Math.sign(partnerInput.steer) === Math.sign(err) && Math.sign(need) !== Math.sign(err)) need = 0;
    out.steer = clamp(need + this.gauss() * o.noise, -1, 1);
    if (Math.abs(out.steer) < 0.08) out.steer = 0;
    // 心魔 / 镜花水月 / 阴阳颠倒: it takes the AI a moment to realise its left/right are swapped too
    const cursed = isFlipped(s.fx, this.idx);
    if (cursed && this.curseSince < 0) this.curseSince = s.t;
    if (!cursed) this.curseSince = -1;
    if (cursed && s.t - this.curseSince > 0.8) out.steer = -out.steer;

    // ---- jump ----
    out.jump = this.decideJump(s, v, partnerInput);
    if (h.jump) { h.jump = false; if (!s.falling) out.jump = true; }

    // ---- boost ----
    const partnerBoost = partnerInput && partnerInput.boost;
    if (s.tribDist < 13 && s.qi > 25) this.boostHold = true;
    if (this.boostHold && (s.qi < 4 || s.tribDist > 24)) this.boostHold = false;
    out.boost = this.boostHold || h.boostUntil > s.t || (partnerBoost && s.qi > 12 && !this.ignorePartner);
    if (out.boost && !partnerBoost && s.tribDist < 10 && s.t - this.lastShout > 3) {
      this.shout = '一起冲!'; this.lastShout = s.t;
    }
    return out;
  }

  // 阴阳天眼: the AI tells its partner about what only it can see
  eyeShout(s, v, partnerInput) {
    if (this.shout || s.t - this.lastShout < 2 || !partnerInput) return;
    for (const ob of near) {
      if (ob.type !== 'rock' || ob.z - s.z > v * 1.6) continue;
      const inPath = Math.abs(ob.x - s.x - partnerInput.steer * 2) < ob.w + 1.2;
      if (ob.hidden && this.idx === 1 && inPath) { this.shout = '有暗石!'; this.lastShout = s.t; return; }
      if (ob.fake && this.idx === 0 && inPath) { this.shout = '是幻象，别躲!'; this.lastShout = s.t; return; }
    }
  }

  laneCost(s, cx, v, partnerInput) {
    let cost = Math.abs(cx - s.x) * 0.05;
    if (this.heard.until > s.t && Math.sign(cx - s.x) !== this.heard.dir) cost += 1.2;
    // A cooperative partner leans toward the side the other player is pushing.
    if (partnerInput && !this.ignorePartner && Math.abs(partnerInput.steer) > 0.5 &&
        Math.sign(cx - s.x) === -Math.sign(partnerInput.steer)) cost += this.o.follow * 0.6;
    const latFull = 12.4 * Math.sqrt(s.base / 14);
    for (const ob of near) {
      const dz = ob.z - s.z;
      const tArrive = dz / v;
      const w = Math.exp(-tArrive / 0.6);
      if (ob.type === 'stone') {
        if (Math.abs(ob.x - cx) < 1) cost -= 0.25 * w;
        continue;
      }
      if (ob.type === 'power') {
        const skip = this.heard.skipPouchUntil > s.t;
        if (Math.abs(ob.x - cx) < 1.4) cost += (POWERS[ob.kind].good && !skip ? -0.8 : 2.2) * w;
        continue;
      }
      if ((ob.type !== 'rock' && ob.type !== 'bird') || ob.fake) continue;
      const ox = ob.type === 'bird' ? birdX(ob, s.t + tArrive) : ob.x;
      if (Math.abs(ox - cx) < ob.w + 0.9) cost += 4 * w;
      // a lane we cannot reach before this row is no escape
      else if (Math.abs(cx - s.x) / latFull > tArrive + 0.05 && Math.abs(ox - s.x) < Math.abs(cx - s.x)) cost += 2 * w;
    }
    // vortices, chains and sword walls are cheaper to fly around than to jump, if there's room
    for (const g of vnear) {
      const w = Math.exp(-((g.z0 - s.z) / v) / 0.6);
      if (Math.abs(cx - g.x) < g.rx + 0.4) cost += 1.5 * w;
    }
    for (const ob of near) {
      if (ob.type !== 'bar' && ob.type !== 'gate') continue;
      const w = Math.exp(-((ob.z - s.z) / v) / 0.6);
      if (Math.abs(cx - ob.x) < ob.w + 0.6) cost += (ob.type === 'gate' ? 1.2 : 0.4) * w;
    }
    return cost;
  }

  decideJump(s, v, partnerInput) {
    if (s.falling) return false;
    // Partner just started a hop and a leap is needed: sync up.
    if (!s.grounded) {
      if (s.jumpBy !== this.idx && !s.upgraded && !s.secondUsed && s.t - s.jumpT0 < 0.15 && this.wantLeap(s, v)) {
        return this.rng() > 0.1; // occasionally miss the sync
      }
      return false;
    }
    // find next jump-requiring thing
    s.course.obstaclesIn(s.z + 0.2, s.z + v * 1.2, near, s.x, 16);
    let best = null;
    for (const ob of near) {
      if (ob.type !== 'bar' && ob.type !== 'gate') continue;
      if (Math.abs(ob.x - this.target) > ob.w + 0.6 && Math.abs(ob.x - s.x) > ob.w + 0.6) continue;
      const tt = (ob.z - s.z) / v;
      const lead = ob.type === 'gate' ? 0.44 : 0.3;
      if (!best || tt - lead < best.wait) best = { key: 'o' + ob.id, wait: tt - lead };
    }
    s.course.vortexesIn(s.z + 0.1, s.z + v * 1.2, vnear, s.x, 16);
    for (const g of vnear) {
      const half = Math.max(crossHalf(g, s.x), crossHalf(g, this.target));
      if (half <= 0) continue;
      const entry = (g.z0 + g.z1) / 2 - half;
      if (entry < s.z) continue;
      const tt = (entry - s.z) / v;
      const span = (2 * half) / v;
      const air = span > 0.5 ? 0.89 : 0.6;
      const lead = Math.max(0.03, (air - span) / 2);
      if (!best || tt - lead < best.wait) best = { key: 'g' + g.z0, wait: tt - lead };
    }
    if (!best) return false;
    if (!this.jumpNoise.has(best.key)) {
      this.jumpNoise.set(best.key, this.gauss() * this.o.jumpSigma);
      if (this.jumpNoise.size > 50) this.jumpNoise.delete(this.jumpNoise.keys().next().value);
    }
    if (best.wait + this.jumpNoise.get(best.key) <= 0 && !this.handled.has(best.key)) {
      this.handled.add(best.key);
      if (this.handled.size > 50) this.handled.delete(this.handled.values().next().value);
      if (this.wantLeap(s, v) && s.t - this.lastShout > 1.5) { this.shout = '跳啊!'; this.lastShout = s.t; }
      return true;
    }
    return false;
  }

  wantLeap(s, v) {
    s.course.obstaclesIn(s.z, s.z + v * 0.8, near, s.x, 14);
    for (const ob of near) if (ob.type === 'gate' && Math.abs(ob.x - s.x) < ob.w + 0.6) return true;
    s.course.vortexesIn(s.z, s.z + v * 0.8, vnear, s.x, 14);
    for (const g of vnear) if ((2 * crossHalf(g, s.x)) / v > 0.5) return true;
    return false;
  }
}

// Half the z-length of vortex g along the line at lateral position x (0 if x misses it).
function crossHalf(g, x) {
  const u = (x - g.x) / g.rx;
  if (Math.abs(u) >= 1) return 0;
  return ((g.z1 - g.z0) / 2) * Math.sqrt(1 - u * u);
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
