// Keyboard + touch → per-player {steer, jump, boost}. Jump is an edge latched until the sim consumes it.

const KEYMAPS = {
  // one human: everything works
  solo: { left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'], jump: ['KeyW', 'ArrowUp', 'Space'], boost: ['ShiftLeft', 'ShiftRight', 'KeyS', 'ArrowDown'] },
  // two humans on one keyboard
  left: { left: ['KeyA'], right: ['KeyD'], jump: ['KeyW', 'Space'], boost: ['ShiftLeft', 'KeyS'] },
  right: { left: ['ArrowLeft'], right: ['ArrowRight'], jump: ['ArrowUp', 'Enter'], boost: ['ArrowDown', 'ShiftRight'] },
};

export const isTouch = matchMedia('(pointer: coarse)').matches || /[?&]touch=1/.test(location.search);

class PlayerInput {
  constructor(keymap) {
    this.km = keymap;
    this.steer = 0;
    this.touchSteer = null;
    this.touchBoost = false;
    this.jumpLatch = false;
  }
}

export class InputManager {
  // locals: [{ player: 0|1, keymap: 'solo'|'left'|'right', pad: 'full'|'left'|'right' }]
  constructor(locals, touchLayer) {
    this.keys = new Set();
    this.players = new Map();
    for (const l of locals) this.players.set(l.player, new PlayerInput(KEYMAPS[l.keymap]));
    this.onKeyDown = e => {
      if (e.repeat) { if (this.isGameKey(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      for (const p of this.players.values()) if (p.km.jump.includes(e.code)) p.jumpLatch = true;
      if (this.isGameKey(e.code)) e.preventDefault();
    };
    this.onKeyUp = e => this.keys.delete(e.code);
    this.onBlur = () => this.keys.clear();
    addEventListener('keydown', this.onKeyDown);
    addEventListener('keyup', this.onKeyUp);
    addEventListener('blur', this.onBlur);

    this.touchLayer = touchLayer;
    touchLayer.innerHTML = '';
    if (isTouch) for (const l of locals) this.buildPad(l.player, l.pad, touchLayer);
  }

  isGameKey(code) {
    for (const p of this.players.values()) for (const k of Object.values(p.km)) if (k.includes(code)) return true;
    return false;
  }

  dispose() {
    removeEventListener('keydown', this.onKeyDown);
    removeEventListener('keyup', this.onKeyUp);
    removeEventListener('blur', this.onBlur);
    this.touchLayer.innerHTML = '';
  }

  buildPad(player, layout, root) {
    const p = this.players.get(player);
    const pad = document.createElement('div');
    pad.className = `pad pad-${layout} p${player}`;
    pad.innerHTML = `
      <div class="steer-zone"><div class="steer-track"><div class="steer-knob"></div></div><span class="pad-hint">左右拖动</span></div>
      <div class="pad-btns">
        <button class="btn-boost">冲</button>
        <button class="btn-jump">跳</button>
      </div>`;
    root.appendChild(pad);
    const zone = pad.querySelector('.steer-zone');
    const knob = pad.querySelector('.steer-knob');
    let id = null, x0 = 0;
    const range = 55;
    const move = e => {
      const v = Math.max(-1, Math.min(1, (e.clientX - x0) / range));
      p.touchSteer = Math.abs(v) < 0.08 ? 0 : v;
      knob.style.transform = `translateX(${v * range}px)`;
    };
    zone.addEventListener('pointerdown', e => {
      if (id !== null) return;
      id = e.pointerId; x0 = e.clientX; zone.setPointerCapture(id);
      zone.classList.add('active');
      move(e);
    });
    zone.addEventListener('pointermove', e => { if (e.pointerId === id) move(e); });
    const end = e => {
      if (e.pointerId !== id) return;
      id = null; p.touchSteer = 0; knob.style.transform = '';
      zone.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const jump = pad.querySelector('.btn-jump');
    jump.addEventListener('pointerdown', e => { e.preventDefault(); p.jumpLatch = true; jump.classList.add('on'); });
    const jumpUp = () => jump.classList.remove('on');
    jump.addEventListener('pointerup', jumpUp); jump.addEventListener('pointercancel', jumpUp); jump.addEventListener('pointerleave', jumpUp);

    const boost = pad.querySelector('.btn-boost');
    const bOn = e => { e.preventDefault(); p.touchBoost = true; boost.classList.add('on'); };
    const bOff = () => { p.touchBoost = false; boost.classList.remove('on'); };
    boost.addEventListener('pointerdown', bOn);
    boost.addEventListener('pointerup', bOff); boost.addEventListener('pointercancel', bOff); boost.addEventListener('pointerleave', bOff);
  }

  // Called once per frame with frame dt — smooths digital keys into an analog-ish steer.
  update(dt) {
    for (const p of this.players.values()) {
      const held = list => list.some(k => this.keys.has(k));
      const target = (held(p.km.right) ? 1 : 0) - (held(p.km.left) ? 1 : 0);
      if (p.touchSteer !== null && p.touchSteer !== 0) p.steer = p.touchSteer;
      else {
        const rate = target === 0 ? 14 : 9;
        p.steer += Math.sign(target - p.steer) * Math.min(Math.abs(target - p.steer), rate * dt);
      }
    }
  }

  // Called once per sim step.
  read(player) {
    const p = this.players.get(player);
    const out = {
      steer: p.steer,
      jump: p.jumpLatch,
      boost: p.km.boost.some(k => this.keys.has(k)) || p.touchBoost,
    };
    p.jumpLatch = false;
    return out;
  }

  peekSteer(player) { return this.players.get(player).steer; }
}
