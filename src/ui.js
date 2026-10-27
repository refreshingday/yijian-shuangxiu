// HUD, toasts, speech bubbles and the 甩锅报告.

import { POWERS, TIMED } from './powers.js';

const $ = id => document.getElementById(id);
export const NAMES = ['师兄', '师妹'];
const CLS = ['y', 'n'];

export class HUD {
  constructor() {
    this.el = $('hud');
    this.hearts = $('hearts');
    this.phase = $('phase');
    this.timer = $('timer');
    this.trib = $('trib');
    this.tribFill = $('tribFill');
    this.dist = $('dist');
    this.stones = $('stones');
    this.qiWrap = $('qiWrap');
    this.qiFill = $('qiFill');
    this.qiLabel = $('qiLabel');
    this.tugWarn = $('tugWarn');
    this.fxChips = $('fxChips');
    this.fxHtml = '';
    this.lastNearT = -9;
    this.toasts = $('toasts');
    this.vignette = $('vignette');
    this.meters = [document.querySelector('.m0 .meter-fill'), document.querySelector('.m1 .meter-fill')];
    this.meterLabels = [document.querySelector('.m0 label'), document.querySelector('.m1 label')];
    this.bubbles = [$('bubble0'), $('bubble1')];
    this.bubbleT = [0, 0];
    this.hitFlash = 0;
    this.lastHp = -1;
  }

  setLabels(labels) {
    labels.forEach((l, i) => { this.meterLabels[i].textContent = l; });
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  update(s, dt) {
    if (s.hp !== this.lastHp) {
      this.lastHp = s.hp;
      this.hearts.innerHTML = [0, 1, 2].map(i => `<span class="${i < s.hp ? '' : 'lost'}">❤️</span>`).join('');
    }
    this.phase.textContent = s.phase;
    const t = Math.min(240, s.t);
    this.timer.innerHTML = `${fmt(t)} <small>/ 4:00</small>`;
    const close = Math.max(0, Math.min(1, 1 - s.tribDist / 45));
    this.tribFill.style.width = `${close * 100}%`;
    this.trib.classList.toggle('danger', s.tribDist < 12);
    this.dist.textContent = `${Math.floor(s.z)} 丈`;
    this.stones.textContent = `灵石 ${s.stones}`;
    this.qiFill.style.width = `${s.qi}%`;
    this.qiWrap.classList.toggle('solo', s.boostMode === 1);
    this.qiWrap.classList.toggle('dual', s.boostMode === 2);
    this.qiLabel.textContent = s.boostMode === 2 ? '双修爆发!' : s.boostMode === 1 ? '独自冲刺…' : '灵力';
    this.tugWarn.classList.toggle('on', s.tug > 0.45);
    const fx = s.fx, chips = [];
    if (fx.shield > 0) chips.push(['good', `金钟罩${fx.shield > 1 ? ' ×' + fx.shield : ''}`]);
    for (const k of TIMED) {
      if (fx[k] <= 0) continue;
      const name = k === 'master' || k === 'usurp' ? `${NAMES[fx.masterWho]}掌剑` : k === 'curse' ? `${NAMES[fx.curseWho]}心魔` : POWERS[k].name;
      chips.push([POWERS[k].good ? 'good' : 'bad', `${name} ${Math.ceil(fx[k])}s`]);
    }
    const html = chips.map(([c, t]) => `<span class="chip ${c}">${t}</span>`).join('');
    if (html !== this.fxHtml) { this.fxHtml = html; this.fxChips.innerHTML = html; }
    for (let i = 0; i < 2; i++) {
      const v = s.steer[i];
      const m = this.meters[i];
      m.style.left = v >= 0 ? '50%' : `${50 + v * 50}%`;
      m.style.width = `${Math.abs(v) * 50}%`;
    }
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2);
    const tribV = Math.max(0, 1 - s.tribDist / 16);
    this.vignette.classList.toggle('hit', this.hitFlash > 0.05);
    this.vignette.style.opacity = Math.max(this.hitFlash, tribV * (0.6 + Math.sin(s.t * 10) * 0.2));
    for (let i = 0; i < 2; i++) {
      if (this.bubbleT[i] > 0) { this.bubbleT[i] -= dt; if (this.bubbleT[i] <= 0) this.bubbles[i].classList.remove('on'); }
    }
  }

  placeBubble(i, x, y) {
    const b = this.bubbles[i];
    b.style.left = `${x}px`; b.style.top = `${y}px`;
  }

  shout(i, text) {
    const b = this.bubbles[i];
    b.textContent = text;
    b.classList.add('on');
    this.bubbleT[i] = 1.2;
  }

  toast(html, cls = '') {
    const d = document.createElement('div');
    d.className = `toast ${cls}`;
    d.innerHTML = html;
    this.toasts.appendChild(d);
    while (this.toasts.children.length > 3) this.toasts.firstChild.remove();
    setTimeout(() => d.remove(), 1150);
  }

  event(e, s) {
    switch (e.type) {
      case 'leap': this.toast(e.combo >= 2 ? `腾空! 默契 ×${e.combo}` : '腾空!', 'gold'); if (e.late > 0.06) this.toast(`<span class="${CLS[e.by]}">${NAMES[e.by]}</span> 慢了 ${e.late.toFixed(2)}s`, 'small'); break;
      case 'offsync': this.toast(`不同步! <span class="${CLS[e.by]}">${NAMES[e.by]}</span> 慢了 ${e.late.toFixed(2)}s`, 'small bad'); break;
      case 'dualboost': this.toast('双修爆发!', 'gold'); break;
      case 'power': {
        const who = `<span class="${CLS[e.by]}">${NAMES[e.by]}</span>`, other = `<span class="${CLS[1 - e.by]}">${NAMES[1 - e.by]}</span>`;
        const def = POWERS[e.kind];
        const line = e.kind === 'master' ? `${who} 独掌飞剑 · ${other} 靠边站`
          : e.kind === 'usurp' ? `${who} 抢的锦囊 → ${other} 独掌飞剑!`
          : e.kind === 'curse' ? `${who} 左右颠倒!`
          : `${who} 抢到 · ${def.desc}`;
        this.toast(`${def.good ? '吉' : '凶'} · ${def.name}!`, def.good ? 'gold' : 'bad');
        this.toast(line, 'blame');
        break;
      }
      case 'shieldBreak': this.toast('金钟罩 碎!', 'gold'); break;
      case 'near': if (s.t - this.lastNearT > 0.8) { this.lastNearT = s.t; this.toast('擦肩!', 'small'); } break;
      case 'fxEnd': if (e.kind === 'master' || e.kind === 'usurp') this.toast('剑主令 结束 · 重新一起操控', 'small'); else if (!POWERS[e.kind].good) this.toast(`${POWERS[e.kind].name} 消散`, 'small'); break;
      case 'smash': this.toast('碎!', 'gold small'); break;
      case 'hit':
      case 'fall': {
        this.hitFlash = 1;
        const [a, b] = e.blame;
        this.toast(e.type === 'fall' ? '卷入漩涡!' : '撞!', 'bad');
        this.toast(`锅: <span class="y">${NAMES[0]} ${Math.round(a * 100)}%</span> · <span class="n">${NAMES[1]} ${Math.round(b * 100)}%</span>`, 'blame');
        if (navigator.vibrate && navigator.userActivation?.hasBeenActive) navigator.vibrate(120);
        break;
      }
    }
    if (e.type === 'stone' && s.stones % 10 === 0) this.toast(`灵石 ×${s.stones}`, 'small');
  }
}

export function fmt(t) {
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- 甩锅报告

const endTitle = s => s.won ? '渡劫飞升' : s.cause === 'trib' ? '天劫追身' : '护体破碎';
const endSub = s => s.won ? '两位道友心意相通，同登仙途！' : s.cause === 'trib' ? '太慢了……雷云吞没了飞剑。' : '飞剑撞得七零八落。';

// [label, value(i), badness(i)] per player
function reportRows(st) {
  const lateAvg = i => st.lateCount[i] ? st.lateBy[i] / st.lateCount[i] : 0;
  return [
    ['撞击之锅', i => st.crashBlame[i].toFixed(1), i => st.crashBlame[i]],
    ['独自冲刺耗灵力', i => Math.round(st.soloQi[i]), i => st.soloQi[i]],
    ['跳跃次数', i => st.jumps[i], () => 0],
    ['同跳慢半拍', i => `${lateAvg(i).toFixed(2)}s`, i => lateAvg(i)],
    ['抢到凶锦囊', i => st.bad[i], i => st.bad[i]],
    ['抢到吉锦囊', i => st.good[i], () => 0],
  ];
}

const pairTitle = st => st.tugTime > 8 ? `合称：「同床异梦」—— 互相拉扯了 ${st.tugTime.toFixed(0)} 秒`
  : st.syncLeaps >= 8 && st.offsync <= 2 ? '合称：「心有灵犀」' : '';

export function showEnd(s, labels, score) {
  const st = s.stats;
  $('endTitle').textContent = endTitle(s);
  $('endSub').textContent = endSub(s);
  $('endStats').innerHTML = `
    <div><b>${fmt(Math.min(240, s.t))}</b>坚持</div>
    <div><b>${Math.floor(s.z)}</b>丈</div>
    <div><b>${s.stones}</b>灵石</div>
    <div><b>${score}</b>得分</div>`;

  const rows = reportRows(st);
  let html = `<div></div><div class="h y">${labels[0]}</div><div class="h n">${labels[1]}</div>`;
  for (const [name, f, w] of rows) {
    const worse = w(0) > w(1) ? 0 : w(1) > w(0) ? 1 : -1;
    html += `<div>${name}</div><div class="v ${worse === 0 ? 'worse' : ''}">${f(0)}</div><div class="v ${worse === 1 ? 'worse' : ''}">${f(1)}</div>`;
  }
  html += `<div>互相拉扯</div><div class="v" style="grid-column: span 2">${st.tugTime.toFixed(1)} 秒</div>`;
  html += `<div>擦肩而过 / 最高默契</div><div class="v" style="grid-column: span 2">${st.nearMiss} / ×${st.bestCombo}</div>`;
  html += `<div>腾空成功 / 不同步</div><div class="v" style="grid-column: span 2">${st.syncLeaps} / ${st.offsync}</div>`;

  const t = titles(s);
  html += `<div class="titles">
    <div class="title-card y"><b>${t[0][0]}</b>${labels[0]} · ${t[0][1]}</div>
    <div class="title-card n"><b>${t[1][0]}</b>${labels[1]} · ${t[1][1]}</div></div>`;
  const pair = pairTitle(st);
  if (pair) html += `<div class="pair">${pair}</div>`;
  $('blame').innerHTML = html;
}

// 分享战报: draw the report onto a canvas and hand it to the share sheet (or download it).
export async function shareReport(s, labels, score) {
  await document.fonts.ready;
  const W = 720, H = 1080, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const bg = x.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#3a2a5a'); bg.addColorStop(0.45, '#c88a8a'); bg.addColorStop(1, '#f3d9c4');
  x.fillStyle = bg; x.fillRect(0, 0, W, H);
  x.fillStyle = 'rgba(255,250,242,0.94)';
  roundRect(x, 40, 40, W - 80, H - 80, 28); x.fill();
  const brush = '"Ma Shan Zheng", "Noto Serif SC", serif', serif = '"Noto Serif SC", serif';
  x.textAlign = 'center'; x.fillStyle = '#3a2a5a';
  x.font = `64px ${brush}`; x.fillText('一剑双修', W / 2, 130);
  x.font = `48px ${brush}`; x.fillStyle = s.won ? '#b07a10' : '#8a3a4a'; x.fillText(endTitle(s), W / 2, 200);
  x.font = `22px ${serif}`; x.fillStyle = '#7a6a8a'; x.fillText(endSub(s), W / 2, 240);
  const st = s.stats;
  const big = [[fmt(Math.min(240, s.t)), '坚持'], [`${Math.floor(s.z)}`, '丈'], [`${s.stones}`, '灵石'], [`${score}`, '得分']];
  big.forEach(([v, l], i) => {
    const cx = 110 + i * 167;
    x.fillStyle = '#2b2448'; x.font = `bold 34px ${serif}`; x.fillText(v, cx, 310);
    x.fillStyle = '#7a6a8a'; x.font = `18px ${serif}`; x.fillText(l, cx, 338);
  });
  x.font = `36px ${brush}`; x.fillStyle = '#8a3a4a'; x.fillText('甩锅报告', W / 2, 400);
  x.font = `bold 20px ${serif}`;
  x.fillStyle = '#3d6fb0'; x.fillText(labels[0], 440, 440);
  x.fillStyle = '#b2557f'; x.fillText(labels[1], 600, 440);
  let y = 480;
  for (const [name, f, w] of reportRows(st)) {
    const worse = w(0) > w(1) ? 0 : w(1) > w(0) ? 1 : -1;
    x.textAlign = 'left'; x.fillStyle = '#2b2448'; x.font = `22px ${serif}`; x.fillText(name, 90, y);
    x.textAlign = 'center';
    for (let i = 0; i < 2; i++) {
      x.fillStyle = worse === i ? '#ff4a6a' : '#2b2448';
      x.font = `${worse === i ? 'bold ' : ''}22px ${serif}`;
      x.fillText(String(f(i)), i ? 600 : 440, y);
    }
    y += 40;
  }
  x.textAlign = 'left'; x.fillStyle = '#2b2448'; x.font = `22px ${serif}`;
  x.fillText(`互相拉扯 ${st.tugTime.toFixed(1)} 秒 · 腾空 ${st.syncLeaps} 次 · 最高默契 ×${st.bestCombo}`, 90, y + 10);
  const t = titles(s);
  t.forEach(([title, why], i) => {
    const bx = 80 + i * 290;
    const g = x.createLinearGradient(bx, 0, bx + 270, 0);
    g.addColorStop(0, i ? '#b2557f' : '#3d6fb0'); g.addColorStop(1, i ? '#ff7ab8' : '#5aa8ff');
    x.fillStyle = g; roundRect(x, bx, y + 50, 270, 130, 18); x.fill();
    x.textAlign = 'center'; x.fillStyle = '#fff';
    x.font = `44px ${brush}`; x.fillText(title, bx + 135, y + 110);
    x.font = `18px ${serif}`; x.fillText(labels[i], bx + 135, y + 140);
    x.fillText(why.slice(0, 16), bx + 135, y + 164);
  });
  const pair = pairTitle(st);
  if (pair) { x.fillStyle = '#8a3a4a'; x.font = `22px ${serif}`; x.fillText(pair, W / 2, y + 230); }
  x.fillStyle = '#9a8aa8'; x.font = `18px ${serif}`; x.fillText('两人一剑 · 同心御剑 · 吵架飞升', W / 2, H - 70);

  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], '一剑双修战报.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: '一剑双修战报' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function roundRect(x, l, t, w, h, r) {
  x.beginPath();
  x.moveTo(l + r, t); x.arcTo(l + w, t, l + w, t + h, r); x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r); x.arcTo(l, t, l + w, t, r); x.closePath();
}

// 传音: quick shouts
export const TAUNTS = ['往左!', '往右!', '跳啊!', '冲!', '别抢!', '信我!'];

function titles(s) {
  const st = s.stats;
  const out = [];
  const lateAvg = i => st.lateCount[i] ? st.lateBy[i] / st.lateCount[i] : 0;
  for (let i = 0; i < 2; i++) {
    const o = 1 - i;
    const blame = st.crashBlame[i], other = st.crashBlame[o];
    if (st.crashes === 0) out.push(['天作之合', '一次都没撞']);
    else if (blame >= other * 1.5 && blame >= 1.5) out.push(['猪队友', `${blame.toFixed(1)} 次撞击算你头上`]);
    else if (st.bad[i] >= 3 && st.bad[i] > st.bad[o]) out.push(['霉运缠身', `开出 ${st.bad[i]} 个凶锦囊`]);
    else if (st.soloQi[i] > 80 && st.soloQi[i] > st.soloQi[o] * 1.5) out.push(['灵力败家子', `独自烧掉 ${Math.round(st.soloQi[i])} 灵力`]);
    else if (lateAvg(i) > 0.09 && lateAvg(i) > lateAvg(o)) out.push(['慢半拍', `平均晚 ${lateAvg(i).toFixed(2)}s`]);
    else if (other >= blame * 1.5 && other >= 1.5) out.push(['背锅侠', '被拖累了']);
    else if (st.good[i] >= 3 && st.good[i] >= st.good[o] * 2) out.push(['锦鲤附体', `开出 ${st.good[i]} 个吉锦囊`]);
    else if (st.jumps[i] > st.jumps[o] * 1.6 && st.jumps[i] > 20) out.push(['跳跳虎', `跳了 ${st.jumps[i]} 次`]);
    else out.push(['定海神针', '稳']);
  }
  return out;
}
