// All sound is synthesized with WebAudio — no asset files needed.
// Background music is a small generative arrangement in D 宫 pentatonic: string pad, 古筝 arpeggios,
// 笛子 melody, bass and percussion, layered in as the 境界 rises and sped up with the sword.
// Drop a track at assets/bgm.mp3 and it is used instead of the generated music.

const PENTA = [0, 2, 4, 7, 9]; // 宫商角徵羽

// pentatonic scale degree → MIDI, degree 0 = D4
const deg2midi = d => 62 + 12 * Math.floor(d / 5) + PENTA[((d % 5) + 5) % 5];
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// 4-bar loop: Bm – A – D – E (roots for bass/pad, arpeggio base degree)
const BARS = [
  { root: 47, arp: 4 },
  { root: 45, arp: 3 },
  { root: 50, arp: 0 },
  { root: 52, arp: 1 },
];
const ARP = [0, 2, 4, 5, 7, 5, 4, 2];

// 笛子 phrases: [degree | null for rest, length in 16ths]; each phrase is 2 bars
const PHRASES = {
  A1: [[7, 4], [8, 2], [7, 2], [5, 4], [6, 4], [5, 6], [3, 2], [4, 8]],
  A2: [[5, 4], [4, 2], [3, 2], [2, 4], [3, 4], [1, 6], [2, 2], [0, 8]],
  B1: [[8, 4], [9, 4], [10, 6], [9, 2], [8, 4], [7, 4], [8, 8]],
  B2: [[7, 4], [5, 2], [6, 2], [7, 4], [5, 4], [4, 4], [3, 4], [5, 8]],
};
const SONG = [['A1', 'A2'], ['A1', 'A2'], ['B1', 'B2'], ['A1', 'A2']];

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.5;
  }

  gainValue() { return this.muted ? 0 : this.volume * 1.4; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.gainValue();
    this.master.connect(c.destination);

    // noise buffer, shared
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // wind
    const wn = c.createBufferSource(); wn.buffer = this.noise; wn.loop = true;
    this.windF = c.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 500; this.windF.Q.value = 0.7;
    this.windG = c.createGain(); this.windG.gain.value = 0;
    wn.connect(this.windF).connect(this.windG).connect(this.master); wn.start();

    // tug screech 剑鸣
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 880;
    const lfo = c.createOscillator(); lfo.frequency.value = 23;
    const lfoG = c.createGain(); lfoG.gain.value = 40;
    lfo.connect(lfoG).connect(o.frequency);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 4;
    this.tugG = c.createGain(); this.tugG.gain.value = 0;
    o.connect(f).connect(this.tugG).connect(this.master); o.start(); lfo.start();

    // music bus: dry + hall reverb → gentle compressor → master
    this.musicOut = c.createGain(); this.musicOut.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.musicOut.connect(comp).connect(this.master);
    this.dry = c.createGain(); this.dry.gain.value = 0.9;
    this.dry.connect(this.musicOut);
    this.verb = c.createConvolver();
    this.verb.buffer = this.makeImpulse(2.8);
    this.verbIn = c.createGain(); this.verbIn.gain.value = 1;
    const verbOut = c.createGain(); verbOut.gain.value = 0.55;
    this.verbIn.connect(this.verb).connect(verbOut).connect(this.musicOut);

    this.step16 = 0; this.nextStep = 0; this.lastMidi = null;

    // optional real track
    fetch('assets/bgm.mp3').then(r => (r.ok ? r.arrayBuffer() : null))
      .then(b => b && c.decodeAudioData(b))
      .then(buf => { if (buf) this.bgmBuf = buf; })
      .catch(() => {});
  }

  makeImpulse(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    return buf;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = this.gainValue();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.gainValue();
  }

  // continuous params each frame
  update(s, playing) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = playing ? s.speed : 0;
    this.windG.gain.setTargetAtTime(Math.min(0.25, sp * 0.007), t, 0.1);
    this.windF.frequency.setTargetAtTime(300 + sp * 25, t, 0.1);
    this.tugG.gain.setTargetAtTime(playing ? s.tug * s.tug * 0.07 : 0, t, 0.04);
    this.musicOut.gain.setTargetAtTime(playing ? 0.6 : 0, t, playing ? 0.3 : 0.15);
    if (this.bgmBuf) {
      if (!this.bgmSrc) {
        this.bgmSrc = this.ctx.createBufferSource();
        this.bgmSrc.buffer = this.bgmBuf; this.bgmSrc.loop = true;
        this.bgmSrc.connect(this.dry); this.bgmSrc.start();
      }
      this.bgmSrc.playbackRate.setTargetAtTime(1 + Math.min(0.08, Math.max(0, (sp - 14) * 0.004)), t, 0.5);
    } else if (playing) this.music(s);
  }

  // ---------------------------------------------------------------- generative score
  music(s) {
    const c = this.ctx;
    const lvl = s.phase === '筑基' ? 0 : s.phase === '金丹' ? 1 : s.phase === '元婴' ? 2 : s.phase === '化神' ? 3 : 4;
    const bpm = 92 + Math.min(1, Math.max(0, (s.speed - 14) / 14)) * 36;
    const dur16 = 60 / bpm / 4;
    if (this.nextStep < c.currentTime) this.nextStep = c.currentTime + 0.06;
    while (this.nextStep < c.currentTime + 0.15) {
      this.playStep(this.step16++, this.nextStep, dur16, lvl);
      this.nextStep += dur16;
    }
  }

  playStep(n, when, d16, lvl) {
    const inBar = n % 16, barN = Math.floor(n / 16), bar = BARS[barN % 4];
    const phrase = Math.floor(barN / 2) % 2, section = Math.floor(barN / 4) % SONG.length;

    // pad: open fifths, swells each bar
    if (inBar === 0) {
      for (const m of [bar.root + 12, bar.root + 19, bar.root + 24]) this.pad(m, when, d16 * 16 + 0.4);
      if (barN % 4 === 0 && lvl >= 2) this.cymbal(when, 0.05);
    }
    // bass
    if (lvl >= 1 && (inBar === 0 || inBar === 8 || (lvl >= 3 && (inBar === 6 || inBar === 14)))) {
      this.bass(bar.root, when, d16 * 5);
    }
    // 古筝: 8ths early, 16ths from 元婴
    const every = lvl >= 2 ? 1 : 2;
    if (inBar % every === 0) {
      const k = (inBar / every) % ARP.length;
      const deg = bar.arp + ARP[k] + (lvl >= 4 && inBar >= 8 ? 5 : 0);
      this.zheng(deg2midi(deg), when, 0.055 + (inBar % 4 === 0 ? 0.02 : 0), (Math.random() - 0.5) * 0.7);
    }
    // glissando run into each 4-bar phrase
    if (barN % 4 === 3 && inBar === 12) {
      for (let i = 0; i < 8; i++) this.zheng(deg2midi(3 + i), when + i * d16 * 0.5, 0.035, 0.3);
    }
    // 笛子 melody from 金丹
    if (lvl >= 1) {
      const name = SONG[section][phrase], notes = PHRASES[name];
      const pos = (barN % 2) * 16 + inBar;
      let acc = 0;
      for (const [deg, len] of notes) {
        if (acc === pos && deg !== null) this.dizi(deg2midi(deg), when, len * d16);
        acc += len;
      }
    }
    // percussion
    if (lvl >= 1 && (inBar === 4 || inBar === 12 || (lvl >= 3 && inBar === 14))) this.woodblock(when, 0.08);
    if (lvl >= 2 && (inBar === 0 || (lvl >= 3 && inBar === 10))) this.taiko(when, 0.32);
    if (lvl >= 4 && inBar % 2 === 1) this.shaker(when, 0.025);
  }

  voiceOut(g, pan, send) {
    const c = this.ctx;
    let node = g;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); node = p; }
    node.connect(this.dry);
    if (send) { const sg = c.createGain(); sg.gain.value = send; node.connect(sg).connect(this.verbIn); }
  }

  pad(midi, when, dur) {
    const c = this.ctx, f = mtof(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.022, when + 0.6);
    g.gain.setValueAtTime(0.022, when + dur - 0.4);
    g.gain.linearRampToValueAtTime(0, when + dur);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.5;
    for (const det of [-7, 6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(when); o.stop(when + dur + 0.05);
    }
    lp.connect(g);
    this.voiceOut(g, 0, 0.6);
  }

  bass(midi, when, dur) {
    const c = this.ctx, f = mtof(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.16, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, when + dur);
    for (const [type, mul, amp] of [['sine', 1, 1], ['triangle', 2, 0.25]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f * mul;
      const og = c.createGain(); og.gain.value = amp;
      o.connect(og).connect(g); o.start(when); o.stop(when + dur + 0.02);
    }
    this.voiceOut(g, 0, 0.1);
  }

  // 古筝: bright pluck with the little pitch "吟" bend on attack
  zheng(midi, when, vol, pan = 0) {
    const c = this.ctx, f = mtof(midi), dur = 1.4;
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.004);
    g.gain.exponentialRampToValueAtTime(vol * 0.3, when + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0005, when + dur);
    for (const [type, mul, amp] of [['triangle', 1, 1], ['sine', 2, 0.45], ['sine', 3, 0.18], ['sine', 4.02, 0.08]]) {
      const o = c.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f * mul * 1.025, when);
      o.frequency.exponentialRampToValueAtTime(f * mul, when + 0.07);
      const og = c.createGain(); og.gain.value = amp;
      o.connect(og).connect(g); o.start(when); o.stop(when + dur);
    }
    this.voiceOut(g, pan, 0.35);
  }

  // 笛子: breathy sine lead with delayed vibrato and portamento from the previous note
  dizi(midi, when, dur) {
    const c = this.ctx, f = mtof(midi), from = this.lastMidi ? mtof(this.lastMidi) : f;
    this.lastMidi = midi;
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.06, when + 0.05);
    g.gain.setValueAtTime(0.055, when + Math.max(0.06, dur - 0.08));
    g.gain.linearRampToValueAtTime(0, when + dur + 0.04);
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(from, when);
    o.frequency.exponentialRampToValueAtTime(f, when + 0.05);
    const vib = c.createOscillator(); vib.frequency.value = 5.6;
    const vg = c.createGain(); vg.gain.setValueAtTime(0, when); vg.gain.linearRampToValueAtTime(f * 0.007, when + Math.min(0.3, dur));
    vib.connect(vg).connect(o.frequency);
    const o2 = c.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const o2g = c.createGain(); o2g.gain.value = 0.12;
    o.connect(g); o2.connect(o2g).connect(g);
    for (const x of [o, o2, vib]) { x.start(when); x.stop(when + dur + 0.06); }
    // breath at the attack
    const n = c.createBufferSource(); n.buffer = this.noise;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 2;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.03, when); ng.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
    n.connect(bp).connect(ng).connect(g); n.start(when, Math.random()); n.stop(when + 0.13);
    this.voiceOut(g, 0.1, 0.45);
  }

  taiko(when, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(120, when); o.frequency.exponentialRampToValueAtTime(45, when + 0.25);
    const g = c.createGain(); g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.45);
    o.connect(g); o.start(when); o.stop(when + 0.5);
    const n = c.createBufferSource(); n.buffer = this.noise;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
    const ng = c.createGain(); ng.gain.setValueAtTime(vol * 0.5, when); ng.gain.exponentialRampToValueAtTime(0.001, when + 0.12);
    n.connect(lp).connect(ng).connect(g);
    n.start(when, Math.random()); n.stop(when + 0.15);
    this.voiceOut(g, 0, 0.25);
  }

  woodblock(when, vol) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 1150;
    const g = c.createGain(); g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    o.connect(g); o.start(when); o.stop(when + 0.07);
    this.voiceOut(g, -0.3, 0.2);
  }

  cymbal(when, vol) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
    const g = c.createGain(); g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.001, when + 1.2);
    n.connect(hp).connect(g); n.start(when, Math.random()); n.stop(when + 1.25);
    this.voiceOut(g, 0.35, 0.5);
  }

  shaker(when, vol) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
    const g = c.createGain(); g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.001, when + 0.05);
    n.connect(hp).connect(g); n.start(when, Math.random()); n.stop(when + 0.06);
    this.voiceOut(g, 0.4, 0);
  }

  // ---------------------------------------------------------------- sound effects (dry, straight to master)
  pluck(midi, when, vol = 0.12, dur = 0.9) {
    const c = this.ctx;
    const f = mtof(midi);
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0008, when + dur);
    for (const [mul, amp] of [[1, 1], [2, 0.35], [3, 0.12]]) {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f * mul;
      const og = c.createGain(); og.gain.value = amp;
      o.connect(og).connect(g); o.start(when); o.stop(when + dur);
    }
    g.connect(this.master);
  }

  noiseHit(dur, freq, vol, type = 'lowpass') {
    const c = this.ctx, t = c.currentTime;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f).connect(g).connect(this.master); n.start(t); n.stop(t + dur);
  }

  sweep(f0, f1, dur, vol, type = 'sine') {
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur);
  }

  event(e) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (e.type) {
      case 'hop': this.sweep(300, 600, 0.15, 0.12); break;
      case 'leap': this.sweep(400, 1200, 0.3, 0.14); [0, 4, 7].forEach((n, i) => this.pluck(81 + n, t + i * 0.04, 0.08, 0.6)); break;
      case 'offsync': this.sweep(500, 260, 0.25, 0.12, 'square'); break;
      case 'stone': this.pluck(81 + PENTA[Math.floor(Math.random() * 5)], t, 0.1, 0.5); break;
      case 'hit': this.noiseHit(0.35, 600, 0.6); this.sweep(140, 50, 0.3, 0.5); break;
      case 'fall': this.sweep(700, 90, 0.8, 0.18, 'triangle'); break;
      case 'smash': this.noiseHit(0.25, 2400, 0.35, 'highpass'); this.pluck(93, t, 0.1, 0.4); break;
      case 'dualboost': [0, 2, 4, 7, 9].forEach((n, i) => this.pluck(69 + n, t + i * 0.035, 0.09, 0.7)); break;
      case 'thunder': this.noiseHit(1.4, 220, 0.5 * (e.power || 1)); break;
      case 'dead': this.noiseHit(1.8, 180, 0.8); this.sweep(300, 40, 1.5, 0.3, 'sawtooth'); break;
      case 'win': [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.pluck(69 + n, t + i * 0.09, 0.12, 1.4)); break;
      case 'power':
        if (!e.good) { this.sweep(300, 90, 0.7, 0.2, 'sawtooth'); this.sweep(310, 95, 0.7, 0.15, 'sawtooth'); }
        else [0, 2, 4, 7, 9, 12].forEach((n, i) => this.pluck(76 + n, t + i * 0.03, 0.1, 0.6));
        break;
      case 'shieldBreak': this.noiseHit(0.4, 3000, 0.35, 'highpass'); this.pluck(88, t, 0.12, 0.8); break;
      case 'near': this.noiseHit(0.18, 1800, 0.18, 'bandpass'); break;
      case 'taunt': this.pluck(e.by === 0 ? 74 : 81, t, 0.08, 0.3); break;
      case 'count': this.pluck(e.go ? 81 : 69, t, 0.15, 0.5); break;
    }
  }
}
