import { createState, step, score, DT } from './sim.js';
import { AIPilot, AI_PRESETS } from './ai.js';
import { Renderer } from './render.js';
import { InputManager, isTouch } from './input.js';
import { Audio } from './audio.js';
import { HUD, NAMES, showEnd, shareReport, TAUNTS } from './ui.js';
import { Net, normalizeCode, makeSnap, CONSUMING } from './net.js';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);

const renderer = new Renderer($('gl'));
const hud = new HUD();
const audio = new Audio();

const settings = {
  mode: params.get('mode') || 'solo',   // solo | online | local2 | watch
  gender: +(params.get('gender') ?? 0), // the (first) local player's side: 0 师兄/阳, 1 师妹/阴
  ai: params.get('ai') || 'normal',
};

let sim, input = null, ais = [], prevInputs, locals = [];
let phase = 'menu';           // menu | count | play | end
let paused = false, countT = 0, endT = 0, speedMul = 1, acc = 0, lastPhaseName = '';
const NO_INPUT = { steer: 0, jump: false, boost: false };

// online session: net + who we are; `game` is set while a networked round runs
let net = null, lobby = null, game = null;

// ---------------------------------------------------------------- attract mode behind the menu
function startDemo() {
  sim = createState((Math.random() * 1e9) | 0);
  ais = [new AIPilot(0, { ...AI_PRESETS.sharp, follow: 0.5 }), new AIPilot(1, { ...AI_PRESETS.sharp, follow: 0.5 })];
  prevInputs = [NO_INPUT, NO_INPUT];
  locals = [];
  renderer.viewer = -1;
}

// ---------------------------------------------------------------- game setup
// opts.online = { role: 'host' | 'guest', me }, opts.seed for networked rounds
function startGame(opts = {}) {
  audio.init();
  if (input) input.dispose();
  const onl = opts.online;
  const g = onl ? onl.me : settings.gender, o = 1 - g;
  sim = createState(opts.seed ?? ((Math.random() * 1e9) | 0));
  ais = [];
  locals = [];
  game = null;
  let labels;
  if (onl) {
    locals = [{ player: g, keymap: 'solo', pad: 'full' }];
    labels = [0, 1].map(i => `${NAMES[i]}${i === g ? '（你）' : '（道侣）'}`);
    game = { role: onl.role, me: g, other: o, remote: { ...NO_INPUT }, remoteJump: false, pending: [], ticks: 0, target: null, sendT: 0 };
    renderer.viewer = g;
  } else if (settings.mode === 'solo') {
    locals = [{ player: g, keymap: 'solo', pad: 'full' }];
    ais = [new AIPilot(o, AI_PRESETS[settings.ai])];
    labels = [0, 1].map(i => `${NAMES[i]}${i === g ? '（你）' : '（剑灵）'}`);
    renderer.viewer = g;
  } else if (settings.mode === 'local2') {
    locals = [{ player: g, keymap: 'left', pad: 'left' }, { player: o, keymap: 'right', pad: 'right' }];
    const side = isTouch ? ['左', '右'] : ['WASD', '方向键'];
    labels = [0, 1].map(i => `${NAMES[i]}（${i === g ? side[0] : side[1]}）`);
    renderer.viewer = -1;
  } else {
    ais = [new AIPilot(0, { ...AI_PRESETS[settings.ai], follow: 0.5 }), new AIPilot(1, { ...AI_PRESETS[settings.ai], follow: 0.5 })];
    labels = ['师兄（剑灵）', '师妹（剑灵）'];
    renderer.viewer = -1;
  }
  speedMul = settings.mode === 'watch' && !onl ? +(params.get('fast') || 1) : 1;
  input = new InputManager(locals, $('touch'));
  prevInputs = [NO_INPUT, NO_INPUT];
  hud.setLabels(labels);
  hud.labels = labels;
  hud.lastHp = -1;
  buildTaunts();
  for (const id of ['menu', 'end', 'lobby', 'pause']) $(id).classList.add('hidden');
  $('touch').classList.remove('hidden');
  hud.show(true);
  phase = 'count'; countT = 3.0; paused = false; acc = 0; lastPhaseName = '';
  // debug: ?skip=N fast-forwards N seconds (AI-only modes)
  const skip = +(params.get('skip') || 0);
  if (skip && !locals.length) { while (sim.alive && sim.t < skip) tick(false); countT = 0.01; }
  $('againBtn').disabled = game?.role === 'guest';
  $('againBtn').textContent = game?.role === 'guest' ? '等房主开局' : '再来一局';
  showCount(3);
}

function showCount(n) {
  const c = $('countdown');
  c.classList.remove('hidden');
  c.innerHTML = `<span>${n > 0 ? n : '起!'}</span>`;
  audio.event({ type: 'count', go: n <= 0 });
}

// ---------------------------------------------------------------- sim tick (local and host)
function tick(live) {
  const inputs = [null, null];
  if (live && input) for (const l of locals) inputs[l.player] = input.read(l.player);
  if (game && game.role === 'host') {
    inputs[game.other] = { steer: game.remote.steer, jump: game.remoteJump, boost: game.remote.boost };
    game.remoteJump = false;
  }
  for (const ai of ais) {
    const other = 1 - ai.idx;
    const partner = inputs[other] || prevInputs[other];
    inputs[ai.idx] = ai.update(sim, partner);
    if (live && ai.shout) hud.shout(ai.idx, ai.shout);
  }
  for (let i = 0; i < 2; i++) if (!inputs[i]) inputs[i] = NO_INPUT;
  prevInputs = inputs;
  step(sim, inputs);
  for (const e of sim.events) handleSimEvent(e, live);
  if (game && game.role === 'host') {
    game.pending.push(...sim.events);
    // 20 Hz snapshots, plus one immediately when the round ends
    if (++game.ticks % 3 === 0 || !sim.alive) { net.send(makeSnap(sim, game.pending)); game.pending = []; }
  }
  sim.events.length = 0;
}

function handleSimEvent(e, live) {
  renderer.handleEvent(e, sim);
  if (e.type === 'smash') renderer.markSmashed(e.id);
  if (live) { audio.event(e); hud.event(e, sim); }
}

// ---------------------------------------------------------------- guest: follow the host's snapshots
function applySnap(d) {
  if (!game || game.role !== 'guest') return;
  const st = d.st;
  for (const k in st) if (k !== 'z' && k !== 'x' && k !== 'y' && k !== 't') sim[k] = st[k];
  if (!game.target) { sim.z = st.z; sim.x = st.x; sim.y = st.y; sim.t = st.t; }
  game.target = { z: st.z, x: st.x, y: st.y, t: st.t, at: performance.now() };
  for (const e of d.ev) {
    if (CONSUMING.has(e.type) && e.id != null) sim.consumed.add(e.id);
    handleSimEvent(e, true);
  }
  if (phase === 'count' && st.t > 0) { phase = 'play'; $('countdown').classList.add('hidden'); }
}

function guestFrame(dt) {
  const tg = game.target;
  // our own input goes to the host every frame (jumps immediately)
  const inp = input.read(game.me);
  game.sendT += dt;
  if (inp.jump || game.sendT > 1 / 30) { net.send({ t: 'in', steer: inp.steer, jump: inp.jump, boost: inp.boost }); game.sendT = 0; }
  game.localSteer = inp.steer;
  if (!tg) return;
  // extrapolate from the last snapshot, but not far if the host goes quiet (lag)
  const ahead = Math.min(0.5, (performance.now() - tg.at) / 1000);
  const tz = tg.z + (sim.alive ? sim.speed * ahead : 0);
  if (Math.abs(tz - sim.z) > 15) sim.z = tz;
  else sim.z += (sim.alive ? sim.speed * dt : 0) + (tz - sim.z) * Math.min(1, dt * 6);
  sim.x += (tg.x - sim.x) * Math.min(1, dt * 15);
  sim.y += (tg.y - sim.y) * Math.min(1, dt * 20);
  sim.t = tg.t + (sim.alive ? ahead : 0);
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (phase === 'menu') {
    acc += dt;
    while (acc >= DT) { tick(false); acc -= DT; }
    if (!sim.alive) startDemo();
  } else if (phase === 'count' && !paused) {
    const before = Math.ceil(countT);
    countT -= dt;
    if (Math.ceil(countT) !== before && countT > -0.5) showCount(Math.ceil(countT));
    if (countT <= 0 && !(game && game.role === 'guest')) { phase = 'play'; setTimeout(() => $('countdown').classList.add('hidden'), 500); }
    if (input) input.update(dt);
    if (game && game.role === 'guest') guestFrame(dt);
  } else if (phase === 'play' && !paused) {
    input.update(dt);
    if (game && game.role === 'guest') guestFrame(dt);
    else {
      acc += dt * speedMul;
      let n = 0;
      while (acc >= DT && n++ < 40) { tick(true); acc -= DT; }
    }
    if (!sim.alive) { phase = 'end'; endT = 1.4; }
  } else if (phase === 'end') {
    if (game && game.role === 'guest') guestFrame(dt);
    endT -= dt;
    if (endT <= 0 && $('end').classList.contains('hidden')) {
      showEnd(sim, hud.labels, score(sim));
      $('end').classList.remove('hidden');
      $('touch').classList.add('hidden');
    }
  }

  const playing = phase === 'play' && !paused;
  if (phase !== 'menu' && sim.phase !== lastPhaseName) announcePhase(sim.phase);
  hud.me = renderer.viewer;
  const steer = game && game.role === 'guest' ? sim.steer.map((v, i) => (i === game.me ? game.localSteer || 0 : v)) : sim.steer;
  renderer.update(sim, paused ? 0 : dt, { steer, onThunder: p => phase !== 'menu' && audio.event({ type: 'thunder', power: p }) });
  if (phase !== 'menu') {
    hud.update(sim, dt);
    for (let i = 0; i < 2; i++) {
      const p = renderer.screenPos(i);
      hud.placeBubble(i, p.x + (i === 0 ? -46 : 46), p.y);
    }
  }
  audio.update(sim, playing);
  requestAnimationFrame(frame);
}

function announcePhase(name) {
  const first = lastPhaseName === '';
  lastPhaseName = name;
  if (first) return;
  hud.toast(`境界突破 · ${name}`, 'gold');
  if (name === '化神' && settings.mode !== 'watch') {
    hud.toast('阴阳天眼开启：师妹看得见暗石，师兄看得穿幻象', 'blame');
  }
}

// ---------------------------------------------------------------- 传音 taunts
function buildTaunts() {
  const box = $('taunts');
  box.innerHTML = '';
  const me = game ? game.me : settings.mode === 'solo' ? settings.gender : -1;
  if (me < 0) return;
  TAUNTS.forEach((text, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<kbd>${i + 1}</kbd>${text}`;
    b.addEventListener('pointerdown', e => { e.preventDefault(); taunt(text); });
    box.appendChild(b);
  });
}

function taunt(text) {
  if (phase !== 'play' && phase !== 'count') return;
  const me = game ? game.me : settings.gender;
  hud.shout(me, text);
  audio.event({ type: 'taunt', by: me });
  if (game) net.send({ t: 'taunt', by: me, text });
  for (const ai of ais) if (ai.idx !== me) ai.hear(text, sim.t);
}

// ---------------------------------------------------------------- online rooms
function openNet() {
  if (net) net.close();
  net = new Net();
  net.on('error', msg => { lobbyStatus(msg); if (!lobby || !lobby.connected) $('lobbyStartBtn').classList.add('hidden'); })
    .on('in', d => { if (game && game.role === 'host') { game.remote.steer = +d.steer || 0; game.remote.boost = !!d.boost; if (d.jump) game.remoteJump = true; } })
    .on('snap', applySnap)
    .on('taunt', d => { hud.shout(d.by, d.text); audio.event({ type: 'taunt', by: d.by }); })
    .on('full', () => lobbyStatus('房间已满'));
  return net;
}

function showLobby() {
  for (const id of ['menu', 'end', 'pause']) $(id).classList.add('hidden');
  hud.show(false);
  $('lobby').classList.remove('hidden');
  phase = 'menu';
  game = null;
  if (input) { input.dispose(); input = null; }
  renderLobby();
}

function renderLobby() {
  const L = lobby;
  $('roomCode').textContent = L.code || '····';
  const hostG = L.hostG;
  const me = L.role === 'host' ? hostG : 1 - hostG;
  const who = i => (!L.connected && i !== me) ? '等待加入…' : i === me ? '你' : '道侣';
  $('role0').textContent = who(0);
  $('role1').textContent = who(1);
  $('swapBtn').classList.toggle('hidden', L.role !== 'host');
  $('lobbyStartBtn').classList.toggle('hidden', !(L.role === 'host' && L.connected));
  $('copyLinkBtn').classList.toggle('hidden', !L.code);
}

function lobbyStatus(text) { $('lobbyStatus').textContent = text; }

function hostRoom() {
  audio.init();
  lobby = { role: 'host', code: '', hostG: settings.gender, connected: false };
  showLobby();
  lobbyStatus('正在创建房间…');
  openNet()
    .on('hosting', code => { lobby.code = code; renderLobby(); lobbyStatus('把房间号发给道侣，等待加入…'); history.replaceState(null, '', `#${code}`); })
    .on('connected', () => { lobby.connected = true; renderLobby(); lobbyStatus('道侣已加入！准备好就开始'); net.send({ t: 'lobby', hostG: lobby.hostG }); })
    .on('closed', onPeerLeft);
  net.host();
}

function joinRoom(code) {
  code = normalizeCode(code);
  if (code.length !== 4) { $('codeInput').focus(); return; }
  audio.init();
  lobby = { role: 'guest', code, hostG: 1 - settings.gender, connected: false };
  showLobby();
  lobbyStatus('正在加入…');
  openNet()
    .on('connected', () => { lobby.connected = true; renderLobby(); lobbyStatus('已加入，等待房主开始'); })
    .on('lobby', d => { lobby.hostG = d.hostG; renderLobby(); })
    .on('start', d => { lobby.hostG = d.hostG; startGame({ online: { role: 'guest', me: 1 - d.hostG }, seed: d.seed }); })
    .on('closed', onPeerLeft);
  net.join(code);
}

function hostStart() {
  if (!lobby || lobby.role !== 'host' || !net.connected) return;
  const seed = (Math.random() * 1e9) | 0;
  net.send({ t: 'start', seed, hostG: lobby.hostG });
  startGame({ online: { role: 'host', me: lobby.hostG }, seed });
}

function onPeerLeft() {
  if (!lobby) return;
  lobby.connected = false;
  if (game && game.role === 'host' && phase !== 'menu') {
    // the round goes on: 剑灵 takes the empty side
    ais = [new AIPilot(game.other, AI_PRESETS.normal)];
    game = null;
    hud.toast('道侣断线 · 剑灵接管', 'bad');
    $('againBtn').disabled = false;
    return;
  }
  if (game && game.role === 'guest' && phase !== 'menu') {
    hud.toast('房主断线了', 'bad');
    setTimeout(() => { leaveOnline(); toMenu(); }, 2500);
    return;
  }
  if (lobby.role === 'host') { renderLobby(); lobbyStatus('道侣离开了，等待新的道侣…'); }
  else { lobbyStatus('房主关闭了房间'); }
}

function leaveOnline() {
  if (net) { net.close(); net = null; }
  lobby = null; game = null;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

$('hostBtn').addEventListener('click', hostRoom);
$('joinBtn').addEventListener('click', () => joinRoom($('codeInput').value));
$('codeInput').addEventListener('input', e => { e.target.value = normalizeCode(e.target.value); });
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(e.target.value); e.stopPropagation(); });
$('lobbyStartBtn').addEventListener('click', hostStart);
$('lobbyLeaveBtn').addEventListener('click', () => { leaveOnline(); toMenu(); });
$('swapBtn').addEventListener('click', () => {
  lobby.hostG = 1 - lobby.hostG;
  settings.gender = lobby.hostG;
  renderLobby();
  net.send({ t: 'lobby', hostG: lobby.hostG });
});
$('copyLinkBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#${lobby.code}`;
  try {
    if (navigator.share && isTouch) await navigator.share({ title: '一剑双修', text: `来一起御剑！房间号 ${lobby.code}`, url });
    else { await navigator.clipboard.writeText(url); lobbyStatus('邀请链接已复制'); }
  } catch {}
});

// ---------------------------------------------------------------- menu wiring
function syncMenu() {
  document.querySelectorAll('.seg').forEach(seg => {
    const name = seg.dataset.name;
    seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === String(settings[name])));
  });
  const m = settings.mode;
  $('genderField').classList.toggle('hidden', m === 'watch');
  $('aiField').classList.toggle('hidden', m === 'local2' || m === 'online');
  $('onlineField').classList.toggle('hidden', m !== 'online');
  $('startBtn').classList.toggle('hidden', m === 'online');
  $('genderLabel').textContent = m === 'local2' ? (isTouch ? '左边的玩家是' : '用 WASD 的玩家是') : m === 'online' ? '你想当（房主决定，加入者自动是另一位）' : '你是';
  $('genderHint').textContent = m === 'local2' ? '另一位自动成为对方（一男一女，不可重复）' : '另一位自动成为你的道侣（一男一女，不可重复）';
  const tauntKeys = '<kbd>1</kbd>-<kbd>6</kbd> 传音';
  $('keysHelp').innerHTML = m === 'local2'
    ? (isTouch ? '两人各握手机一侧：拖动条转向，「跳」「冲」按钮。'
      : `左边：<kbd>A</kbd><kbd>D</kbd> 转向 · <kbd>W</kbd>/<kbd>Space</kbd> 跳 · <kbd>Shift左</kbd>/<kbd>S</kbd> 冲<br>右边：<kbd>←</kbd><kbd>→</kbd> 转向 · <kbd>↑</kbd>/<kbd>Enter</kbd> 跳 · <kbd>↓</kbd>/<kbd>Shift右</kbd> 冲`)
    : (isTouch ? '左半屏拖动转向；右边「跳」「冲」按钮；右侧小按钮传音。'
      : `<kbd>A</kbd><kbd>D</kbd>/<kbd>←</kbd><kbd>→</kbd> 转向 · <kbd>W</kbd>/<kbd>↑</kbd>/<kbd>Space</kbd> 跳 · <kbd>Shift</kbd>/<kbd>S</kbd> 冲 · ${tauntKeys} · <kbd>P</kbd> 暂停 · <kbd>-</kbd><kbd>=</kbd> 音量${m === 'watch' ? ' · <kbd>F</kbd> 快进' : ''}`);
}

document.querySelectorAll('.seg').forEach(seg => {
  seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const v = b.dataset.v;
    settings[seg.dataset.name] = seg.dataset.name === 'gender' ? +v : v;
    syncMenu();
  });
});

$('startBtn').addEventListener('click', () => startGame());
$('againBtn').addEventListener('click', () => (lobby && lobby.role === 'host' && net && net.connected ? hostStart() : !game ? startGame() : null));
$('menuBtn').addEventListener('click', () => { if (lobby && net && net.connected) showLobby(); else { leaveOnline(); toMenu(); } });
$('quitBtn').addEventListener('click', () => { leaveOnline(); toMenu(); });
$('pauseBtn').addEventListener('click', () => setPaused(true));
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('muteChk').addEventListener('change', e => audio.setMuted(e.target.checked));
$('shareBtn').addEventListener('click', () => shareReport(sim, hud.labels, score(sim)));

// 全屏横屏 on phones
if (isTouch && document.fullscreenEnabled) $('fsBtn').classList.remove('hidden');
$('fsBtn').addEventListener('click', async () => {
  try {
    await document.documentElement.requestFullscreen();
    await screen.orientation?.lock?.('landscape');
  } catch {}
});

// Volume: one setting shared by the menu, pause and in-game sliders, remembered per browser. Default 50%.
// In game: 🔊 button, or - / = keys.
const VOL_SLIDERS = ['volMenu', 'volPause', 'volHud'];
function setVolume(pct, save = true) {
  audio.setVolume(pct / 100);
  for (const id of VOL_SLIDERS) { $(id).value = pct; $(id + 'Out').textContent = `${pct}%`; }
  $('volBtn').textContent = pct === 0 ? '🔇' : pct < 40 ? '🔉' : '🔊';
  if (save) try { localStorage.setItem('yjsx-volume', String(pct)); } catch {}
}
for (const id of VOL_SLIDERS) $(id).addEventListener('input', e => setVolume(+e.target.value));
$('volBtn').addEventListener('click', () => $('volPop').classList.toggle('hidden'));
function nudgeVolume(d) {
  const pct = Math.max(0, Math.min(100, Math.round(audio.volume * 100) + d));
  setVolume(pct);
  if (phase !== 'menu') hud.toast(`音量 ${pct}%`, 'small');
}
let savedVol = 50;
try { const v = localStorage.getItem('yjsx-volume'); if (v !== null && !isNaN(+v)) savedVol = +v; } catch {}
setVolume(savedVol, false);
// ?mute=1 starts muted (handy for testing)
if (params.get('mute')) { audio.setMuted(true); $('muteChk').checked = true; }

function toMenu() {
  if (input) { input.dispose(); input = null; }
  for (const id of ['end', 'pause', 'countdown', 'lobby']) $(id).classList.add('hidden');
  hud.show(false);
  $('menu').classList.remove('hidden');
  paused = false;
  phase = 'menu';
  game = null;
  startDemo();
  syncMenu();
}

// Online rounds can't freeze time for the other player: the pause panel opens but the game keeps going.
function setPaused(p) {
  if (phase !== 'play' && phase !== 'count') return;
  $('pause').classList.toggle('hidden', !p);
  if (game) return;
  paused = p;
  if (!p) last = performance.now();
}

addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.code === 'KeyP' || e.code === 'Escape') setPaused($('pause').classList.contains('hidden'));
  if (e.code === 'KeyF' && settings.mode === 'watch' && phase === 'play') speedMul = speedMul === 1 ? 4 : 1;
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') nudgeVolume(-10);
  if (e.code === 'Equal' || e.code === 'NumpadAdd') nudgeVolume(10);
  const d = /^Digit([1-6])$/.exec(e.code);
  if (d && $('taunts').children.length) taunt(TAUNTS[+d[1] - 1]);
  if ((e.code === 'Enter' || e.code === 'Space') && phase === 'menu' && !lobby && settings.mode !== 'online' && !e.repeat) { e.preventDefault(); startGame(); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && settings.mode !== 'watch' && !game) setPaused(true); });

window.__sim = () => sim; // debug hooks for testing
window.__game = () => ({ phase, paused, countT, speedMul, online: game && { role: game.role, me: game.me, remote: game.remote } });
window.__pause = p => setPaused(p);
window.__r = renderer;

// invite link: …/#ABCD opens straight into joining that room
const hashCode = normalizeCode(location.hash.slice(1));
if (hashCode.length === 4) { settings.mode = 'online'; $('codeInput').value = hashCode; }
syncMenu();
startDemo();
if (params.get('autostart')) startGame();
requestAnimationFrame(frame);
