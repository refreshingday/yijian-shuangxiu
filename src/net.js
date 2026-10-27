// Peer-to-peer rooms over WebRTC via PeerJS (global `Peer`, loaded from CDN in index.html).
// The free public PeerJS broker is only used so the two browsers can find each other with a
// 4-character room code; after the handshake all game data goes directly between them.

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const PREFIX = 'yjsx-';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)];
  return s;
}

export function normalizeCode(s) {
  return (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

export class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // 'host' | 'guest'
    this.code = '';
    this.handlers = {};
  }

  on(type, fn) { this.handlers[type] = fn; return this; }
  emit(type, data) { const h = this.handlers[type]; if (h) h(data); }

  get connected() { return !!(this.conn && this.conn.open); }

  host(tries = 0) {
    if (typeof Peer === 'undefined') return this.emit('error', '联机组件加载失败，请检查网络');
    this.role = 'host';
    this.code = makeCode();
    const peer = this.peer = new Peer(PREFIX + this.code, { debug: 1 });
    peer.on('open', () => this.emit('hosting', this.code));
    peer.on('connection', conn => {
      if (this.connected) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); }); return; }
      this.attach(conn);
    });
    peer.on('error', e => {
      if (e.type === 'unavailable-id' && tries < 5) { peer.destroy(); this.host(tries + 1); return; }
      this.emit('error', describe(e));
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
  }

  join(code) {
    if (typeof Peer === 'undefined') return this.emit('error', '联机组件加载失败，请检查网络');
    this.role = 'guest';
    this.code = code;
    const peer = this.peer = new Peer({ debug: 1 });
    peer.on('open', () => this.attach(peer.connect(PREFIX + code, { reliable: true, serialization: 'json' })));
    peer.on('error', e => this.emit('error', describe(e)));
  }

  attach(conn) {
    this.conn = conn;
    conn.on('open', () => this.emit('connected'));
    conn.on('data', d => { if (d && d.t) this.emit(d.t, d); });
    conn.on('close', () => { if (this.conn === conn) { this.conn = null; this.emit('closed'); } });
    conn.on('error', () => {});
  }

  send(obj) { if (this.connected) this.conn.send(obj); }

  close() {
    const peer = this.peer;
    this.conn = null; this.peer = null; this.handlers = {};
    if (peer) try { peer.destroy(); } catch {}
  }
}

function describe(e) {
  switch (e.type) {
    case 'peer-unavailable': return '找不到这个房间，请检查房间号';
    case 'network': case 'server-error': case 'socket-error': case 'socket-closed': return '连不上联机服务器，请检查网络';
    case 'browser-incompatible': return '这个浏览器不支持联机';
    default: return `联机出错（${e.type || e}）`;
  }
}

// ---------------------------------------------------------------- state sync (host → guest)

// Fields of the sim state the guest needs to draw the world and the HUD.
const SNAP_KEYS = ['t', 'z', 'x', 'y', 'vx', 'vy', 'speed', 'base', 'hp', 'qi', 'invuln', 'tribDist', 'grounded', 'falling',
  'lastJump', 'steer', 'boosting', 'boostMode', 'tug', 'pull', 'fx', 'combo', 'bonus', 'alive', 'won', 'cause',
  'phase', 'stones', 'stats'];

export function makeSnap(s, events) {
  const st = {};
  for (const k of SNAP_KEYS) st[k] = s[k];
  return { t: 'snap', st, ev: events };
}

// Ids an event removes from the world, so the guest hides the same stones/pouches/smashed rocks.
export const CONSUMING = new Set(['stone', 'power', 'smash', 'hit', 'shieldBreak']);
