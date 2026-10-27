# 《一剑双修》 Two Cultivators, One Sword — Game Plan

> Working title. A 2-player co-op runner in a 修仙 world: two cultivators share one flying sword, and **the sword obeys the sum of both players' inputs**. It's built to make players argue, then laugh about it.

---

## 1. Pitch in one paragraph

A male and a female cultivator (each player picks one) stand on one flying sword above a sea of clouds. They fly through open sky across **7 (invisible) lanes** along a path that bends left/right/up/down, at a fixed cruising altitude, so it plays like a land runner: dodge 浮石 floating boulders and 妖禽 birds left/right, hop over 锁灵链 chains, leap the 剑阵 sword walls, and jump across 罡风漩涡 downdraft vortices or get sucked down. Both players steer the sword and the result is their inputs added together. If one pushes left and the other pushes right, the sword shakes and goes nowhere. A 天劫 thunder-tribulation cloud chases from behind, so you can't just play it safe and slow. A round lasts about 2–4 minutes. At the end, a 甩锅报告 (blame report) shows exactly whose fault it was.

---

## 2. Core rules

### 2.1 Shared controls (the main mechanic)

| Action | Per-player input | How the two inputs combine | Why it causes arguments |
|---|---|---|---|
| **Steer** | Analog value −1 … +1 | `lateral = (a + b) × k`. One player alone gets **half** the turning speed. | Fast dodges need both players. When you disagree, the inputs cancel and the sword shakes. |
| **Jump** | Tap | **Synced** (both press within 200 ms) = big leap 腾空. **One player only** = small hop. **Both press, off-sync** = hop followed by a weak second hop. | "Jump NOW!" "I did!" The game lets you see who was early or late. |
| **Boost** 灵力冲刺 | Hold | Both players draw from **one shared 灵力 pool**. Both boosting together = 双修爆发: 1.6× speed plus short invincibility. One boosting alone = 1.3× speed and drains faster. | "Who wasted all the qi?!" The blame report will say. |

**Feedback that makes the arguments clear:**
- Each character leans in their own input direction, and an arrow under each one shows that player's live input.
- When inputs oppose, the sword vibrates, makes a 剑鸣 screech, and spits sparks. The 拉扯 tug-of-war meter fills.
- Each jump shows a small timing pip per player ("早 0.12s" / "晚 0.31s").

### 2.2 Health, losing and winning

- **3 × 护体真元** (hearts). Hitting an obstacle costs 1. Falling through a gap costs 1, and you respawn on the road.
- **天劫雷云** chases from behind. A distance gauge shows how close it is. Slow play, hits and shaking all let it close in; boosting pushes it back. If it catches you, the round ends instantly.
- **Losing:** hearts reach 0, or the tribulation catches you.
- **Winning (rare):** survive until **4:00** and you 渡劫成功 → 飞升 (ascension cutscene). The difficulty is tuned so most teams die between 2 and 4 minutes.
- **Score:** distance + 灵石 collected × 双修 sync multiplier.

### 2.3 Pacing (fast tempo, a round lasts 2–4 min)

| Time | Phase | What's new | Base speed |
|---|---|---|---|
| 0:00–0:20 | 筑基 | Wide road, rocks only, slow tribulation. Players learn the controls. | 1.0× |
| 0:20–1:00 | 金丹 | Low 剑气 barriers (jump), gaps, 灵石 lines | 1.15× |
| 1:00–1:45 | 元婴 | Tall gates (need the **synced** big jump), road narrows, moving 妖禽 birds | 1.3× |
| 1:45–2:45 | 化神 | **阴阳幻象** (2.4), **心魔** events (2.5), lightning strike zones | 1.5× |
| 2:45–4:00 | 渡劫 | The tribulation accelerates, mixed patterns get dense, the road forks | 1.7×→2.0× |

Obstacles come from hand-authored **patterns** of 2–5 s each, drawn by phase from a seeded RNG. That keeps the rhythm readable and stops it feeling like random noise.

### 2.4 锦囊 add-ons (built in M1)
22 kinds of pouch that all look identical, about 60% of them bad, roughly 5 grabbed per minute. Whoever steered toward one "grabbed" it, and that decides who 剑主令 / 心魔 / 篡位 land on. The list is in `src/powers.js`.

### 2.5 Creative "make them argue" systems

1. **阴阳天眼 (asymmetric vision).** The ☯ fits 修仙 双修 well. From 化神 onward, some obstacles are **幻象**:
   - 阴-only obstacles: only the 阴 (female) player sees them. To the other player they look like empty road.
   - 阳 fakes: the 阳 (male) player sees that a scary-looking wall is an illusion you can fly through. The 阴 player sees it as solid.
   - Result: one player has to *call it out* and the other has to *trust them*. Expect "There's nothing there!" / "TRUST ME!"
2. **心魔入侵.** For 5 s, one random player's left and right are reversed. A purple aura marks it, but only that player's screen shows "心魔: 左右颠倒". The partner just sees them steering the wrong way.
3. **分道 forks.** The road splits in two. One branch has 灵石 for the 阳 player and the other has 灵石 for the 阴 player, and each player's personal score counts on the blame report. You still have to agree on one branch or crash into the divider.
4. **双修 sync meter.** When both inputs point the same way, this meter fills and the score multiplier rises (×1 → ×3), and at full you get a one-hit shield. Cooperation pays, so wasting it hurts.
5. **Quick taunts 传音.** Four one-tap shouts float above your character: 「往左!」「跳啊!」「别冲!」「信我!」. They work during voice calls too, and they're fun when the players sit next to each other.
6. **甩锅报告 (blame report, end screen).** This is a key feature:
   - Crashes caused, decided by whose input pushed the sword into the obstacle
   - Seconds spent fighting each other (拉扯时间)
   - 灵力 wasted on solo boosts
   - Jump timing: average early/late per player
   - Personal 灵石
   - The game gives each player a title, e.g. 「猪队友」「背锅侠」「定海神针」「灵力败家子」「天选之人」
   - A share button exports a screenshot image of the report.

---

## 3. Platforms & controls

**Mobile first (landscape recommended, portrait supported).**

| | Mobile | PC |
|---|---|---|
| Steer | Drag on the left half of the screen; horizontal offset from the touch-down point gives an analog −1…+1 | A / D or ← / → (digital ±1, smoothed) |
| Jump | 「跳」 button, right side | Space / W / ↑ |
| Boost | 「冲」 hold button, right side | Shift |
| Taunt | Small ☯ button that opens a radial menu | 1–4 |

Other mobile requirements: haptics on hits (`navigator.vibrate`), fullscreen with orientation lock where supported, safe-area insets, no browser pinch-zoom or scroll, and a capped pixel ratio for performance.

**PC dev mode, local 2P:** in this mode the left player uses A/D + W + Shift and the right player uses ←/→ + ↑ + Ctrl, on one keyboard. This makes it fast to test the shared-control feel without a network.

---

## 4. Single-player test AI 剑灵

The AI plays as the partner. It is also a test harness.

- **Perception:** reads obstacles ahead within a look-ahead window that scales with speed. It sees what its gender is allowed to see, so the 阴阳 rules apply to it too.
- **Decision:** picks a target lateral position and jump times from the pattern data. Its output is the *per-player* input, so it goes through the same summing path as a human.
- **Personality knobs** (URL params or a debug panel):
  - `reaction` (ms delay), `noise` (steering jitter), `jumpTiming` (σ of jump error)
  - `stubborn` (0–1): the chance it commits to its own plan and ignores what you do, for testing the argument mechanics
  - `follow` (0–1): how much it mirrors your input direction, i.e. a cooperative partner
- **Taunts:** the AI uses 传音 too ("跳啊!") when its plan disagrees with yours.
- **Soak mode:** `?bot=2` runs AI vs AI headless-ish at 4× speed and logs death times. Use it to tune difficulty so the median death lands at about 2:30–3:00.

---

## 5. Networking: P2P, no game server

### 5.1 The honest constraint
Browser P2P uses WebRTC, and WebRTC needs a *signaling* step to exchange connection offers. Plan:
- Use **PeerJS** with its free public broker (`0.peerjs.com`) **for signaling only**. After the handshake, all game traffic is direct peer to peer. We host nothing.
- Use public Google STUN servers for NAT traversal.
- **Risk:** about 10–20% of mobile carrier NAT combinations (symmetric NAT, some 4G/5G networks) can't connect without a TURN relay. Mitigations:
  1. Show a clear error that suggests trying Wi-Fi.
  2. A config slot for an optional TURN server, such as a free Metered/OpenRelay tier, added later only if needed.
- Fallback if the public broker is down: copy-paste/QR exchange of the offer and answer. This is a stretch goal.

### 5.2 Rooms
- **Room code:** 4 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, with confusing characters (0 O 1 I L) removed. That gives about 810k codes.
- **Host** creates the peer id `yjsx-<CODE>`. If the id is taken, the host gets a new code.
- **Guest** types the code and connects to `yjsx-<CODE>`.
- **Lobby:** both players pick 男/女 (阳/阴). A side one player has taken is locked for the other. Both tap 准备 to start, and the host shows a 3-2-1 countdown.
- An invite link `…/#ABCD` auto-fills the code, so players can share it in WeChat or WhatsApp.

### 5.3 Sync model: host-authoritative + shared seed
- The host runs the simulation at a fixed **60 Hz**.
- At game start, the host sends a **seed**. Both clients generate the identical course locally, so obstacles never need to be sent.
- **Guest → host:** input packets `{seq, steer, jump, boost, taunt}` at 30 Hz, plus edge events (jump pressed) with timestamps.
- **Host → guest:** state snapshots at 20 Hz `{t, z, x, y, vy, hp, qi, sync, tribDist, flags}` plus reliable events (hit, 心魔 target, death). The guest interpolates with a 100 ms buffer.
- **Fairness:** the host delays its own input by about half the RTT, so host and guest inputs reach the simulation with similar lag. Otherwise the host "wins" every tug-of-war.
- **Responsiveness:** each player's own lean arrow and character lean are predicted locally right away, so input always feels instant even though the sword moves on the host's authority.
- **Pause/disconnect:** the game pauses on a lost connection. The guest gets 15 s to rejoin with the same code; after that, the AI 剑灵 takes over the empty side.

---

## 6. Tech stack & structure

- **No build step.** Plain ES modules with an import map, served as static files. Hosting: GitHub Pages, Netlify or Cloudflare Pages. HTTPS is needed for some mobile APIs.
- **Three.js** (pinned version via CDN) and **PeerJS** (pinned via CDN).
- Art is **procedural low-poly** built from Three.js primitives, so there are no asset files at first:
  - Characters: stylized robes (阳 = white/azure, 阴 = pale pink/lilac), hair bun or long hair, ribbons that sway with a spring sim and lean with input
  - Sword: glowing blade with a trail ribbon
  - World: gradient sky shader, instanced cloud sea, floating peaks in the distance, fog, golden-hour light
- **Performance budget:** under 120 draw calls, instanced obstacles, object pooling, `devicePixelRatio` capped at 1.5, and auto-lowering quality below 45 fps.
- **Audio:** synthesized with WebAudio (guzheng-like pluck, wind, 剑鸣 screech, thunder). No files needed.

```
飞剑/
  index.html          — canvas, HUD/menus DOM, import map
  css/style.css
  src/
    main.js           — boot, scene/state machine (menu → lobby → game → report)
    sim.js            — deterministic game sim (pure: state + inputs → state)
    course.js         — seeded RNG + pattern library + phase table
    render.js         — Three.js scene, characters, sword, world, FX
    input.js          — touch/keyboard → per-player {steer, jump, boost}
    net.js            — PeerJS rooms, messages, interpolation, input delay
    ai.js             — 剑灵 partner bot + soak mode
    ui.js             — HUD, lobby, taunts, blame report
    audio.js          — WebAudio synths
    stats.js          — blame tracking (attribution per crash/boost/jump)
```

`sim.js` is kept pure and deterministic, so the same code runs local 2P, AI and network host modes, and AI soak tests can run it faster than real time.

---

## 7. Milestones

| # | Milestone | Done when |
|---|---|---|
| M1 | **Feel prototype** | Sword runner with placeholder boxes, summed steering/jump/boost, obstacles, gaps, hearts and tribulation. Playable with local 2P keyboard + AI partner on PC. |
| M2 | **Mobile + UI** | Touch controls, HUD, gender select, menus, landscape/portrait, 60 fps on a mid-range phone |
| M3 | **P2P rooms** | Create/join by 4-char code, invite link, lobby, host-authoritative play between phone and PC |
| M4 | **Argument systems** | 阴阳幻象, 心魔, forks, sync meter, taunts, blame report + share image |
| M5 | **Art & audio pass** | Procedural characters, world, FX, sound. Tune difficulty with AI soak runs (median death 2:30–3:00) |
| M6 | **Deploy** | GitHub Pages, tested on iOS Safari + Android Chrome + desktop Chrome |

---

## 8. Open decisions

1. **UI language:** 中文 only, or 中文 + English toggle? (Default: 中文 with an English toggle.)
2. **Same gender allowed?** The plan locks one 男 + one 女, because 阴阳 vision depends on it. Alternative: decouple gender (cosmetic) from 阴/阳 role (auto-assigned).
3. **Hosting:** GitHub Pages is assumed.
4. **TURN fallback:** ship without one at first and add it only if testing shows connection failures.
