# 一剑双修

Two players, one flying sword. Both steer and the sword follows the **sum** of their inputs, so the game is built to make you argue. Browser 3D (Three.js), mobile-first, also plays on PC. There's no game server: online play is peer-to-peer.

## Run locally

Any static file server works. ES modules don't load from `file://`, so you need a server:

```bash
python -m http.server 8173
```

Then open http://localhost:8173.

## Modes

| Mode | What it is |
|---|---|
| 单人 + 剑灵 | You and an AI partner. The AI listens to your 传音 (往左/往右/跳啊/冲/信我/别抢). |
| 联机双人 | Create a room and share the 4-character code or invite link (`…/#ABCD`). The other player joins from any device. |
| 本地双人 | Two players on one keyboard (WASD vs arrow keys), or one phone (each takes a side). |
| 剑灵对练 | Watch two AIs play. Press `F` for 4× speed. |

## How online works

- [PeerJS](https://peerjs.com) is used for the handshake only. Its free public broker matches the two browsers by room code (`yjsx-<CODE>`).
- After the handshake, all game data flows directly between the two browsers over WebRTC.
- The host runs the simulation. The guest sends its input at 30 Hz and the host sends state snapshots at 20 Hz.
- Both sides build the identical course from a shared seed, so obstacles are never sent over the network.
- If the guest drops, an AI takes over the empty side. If the host drops, the guest returns to the menu.
- **Known limit:** some mobile carrier networks (symmetric NAT) can't connect peer-to-peer without a TURN relay. If a phone on 4G/5G can't join, try Wi-Fi. A TURN server can be added in the `new Peer(...)` options in `src/net.js` if needed.

## Deploy (GitHub Pages)

The game is plain static files with no build step:

1. Create a GitHub repository and push this folder to it.
2. In the repository, go to Settings → Pages → Deploy from branch → `main` / root.
3. Open `https://<user>.github.io/<repo>/`. HTTPS is required for some mobile features, and Pages provides it.

Netlify, Cloudflare Pages or any static host work the same way.

## Custom music

Put a looping track at `assets/bgm.mp3` and it replaces the generated music. Without one, the game plays its own generated score (古筝 / 笛子 / pad / percussion), which builds up as the 境界 rises.

## Dev tools

```bash
node tools/soak.js 40 normal
```

```bash
node tools/powers.js 10
```

- `soak.js` runs AI-vs-AI rounds headless and reports how long they survive (used to tune difficulty). Its presets are `sharp`, `normal` and `stubborn`.
- `powers.js` reports 锦囊 pickups per minute.

URL parameters for quick testing:
- `?mode=watch&autostart=1&fast=4`: watch two AIs at 4× speed.
- `&skip=90`: fast-forward 90 seconds.
- `&touch=1`: force the touch controls on a PC.

## Code map

- `src/sim.js`: deterministic simulation (runs in node too)
- `src/course.js`: seeded course and bending flight path
- `src/powers.js`: the 22 锦囊
- `src/ai.js`: AI partner 剑灵
- `src/render.js`: Three.js view
- `src/input.js`: keyboard and touch
- `src/ui.js`: HUD, 甩锅报告 and the share image
- `src/audio.js`: synthesized music and sound effects
- `src/net.js`: online rooms
- `src/main.js`: wiring and game modes
