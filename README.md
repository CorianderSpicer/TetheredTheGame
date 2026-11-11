# TETHERED

*Two to four players. One chain. One way up.*

TETHERED is an original co-op climbing platformer for the browser. Two, three or four stylized climbers are roped together in a line and climb to ring the summit bell. You can play on one screen or online over WebRTC.

**Three separate levels**, picked from the menu before you start. Each is its own mountain with its own base camp and its own bell — not one continuous run:

| Level | Difficulty | What it is |
|---|---|---|
| **The Ascent** | ★ | The original climb: five zones, base camp to the sky temple. ~84 m, 11 checkpoints, all 10 relics. |
| **The Storm Spire** | ★★ | Short and mean. Permanent gusts, fall-away tiles, an off-centre sweeper, moving platforms. |
| **The Void Causeway** | ★★★ | Almost nothing to stand on. Timed doors, a vertical lift, hammers, and a lever bridge someone has to hold while everyone else crosses. |

**Party size.** The host picks 2, 3 or 4 climbers in the lobby before starting. The rope runs in a line — 1—2—3—4 — so every extra climber is one more link to drag, one more person who can pull you off a ledge, and one more who can anchor and hold the whole party. Three and four players are meaningfully harder than two, which is the point.

No build step and no server code are needed. The game is a folder of static files (HTML, CSS and ES modules).

---

## 1. Implemented features

### Core
- **Third-person controller:**
  - acceleration and deceleration, sprint, coyote time and jump buffering;
  - hold-for-higher jumps (variable height);
  - air control that keeps swing momentum, ground detection and step-up;
  - ledge mantling, standing on your partner's head, and smooth facing.
- **Animations** (procedural): idle, walk, run, jump, fall, land (squash), climb, hang, reel, anchor and stunned.
- **Two original characters**, *Kip* (helmet and antenna) and *Moss* (beanie and scarf):
  - 8 colours and 6 skins (4 of them unlocked by relics);
  - P1/P2 name labels and a glowing chain ring on the belt.
- **Camera:** smooth third-person rig with wall avoidance, an intro fly-over, screen shake, and an orbit shot at the summit. On a shared screen it frames both players.

### The chain
- **The rope.** It is a Verlet rope of 18 segments drawn with up to 80 instanced links. It drapes and swings, collides with level geometry, and glows red under strain.
- **The tether constraint.** It is a one-sided distance constraint between the two waists, solved **only by the authoritative simulation**:
  - Position and velocity corrections are capped and damped, so it cannot explode.
  - Weights decide who moves:
    - an anchored player weighs 0;
    - holding E (bracing/reeling) gives 0.06;
    - standing still gives 0.2;
    - walking gives 0.4;
    - airborne gives 1.
  - This produces real swinging, dragging and catching.
- **Hold E to reel in.** The effective length shrinks to 2.2 m and the climber braces. A partner who is pulled against a wall gets a climb assist, which is how players pull each other up ledges.
- **Anchor posts.** Press E to clip in; the post holds you in place while your partner swings.
- **Chain length** is set by the host (6–12 m).
- **HUD tension meter** shows Slack, Tight, TAUT! or STRAINED!, with a pulsing warning and a beeping sound.

### Level: five zones and ten checkpoints

Summit altitude is 84 m. The ten main-route relics are marked with ◆; five more checkpoints sit between and within zones.

| Zone | Highlights |
|---|---|
| 1 The Ruins | Steps, a narrow bridge, column hops, a collapsing bridge, a 4 m pull-up wall, crumbling tiles. Secret ledge under the bridge ◆ |
| 2 The Windy Cliffs | Gusting wind ledge (watch the flags), moving platforms, three swinging hammers, an anchor and swing gap, sync-jump drums, a windy pillar climb |
| 3 The Industrial Complex | Conveyors, a rotating turbine with a sweeper arm, piston crushers, a timed blast door, a two-lever bridge under a low duct, a co-op elevator, twin pressure plates, vertical lifts. Secret maintenance pipe ◆ |
| 4 The Frozen Peak | Slippery ice field, a swaying balance beam, falling icicles with shadow warnings, a tandem sled (moves only with both aboard), crosswind, ice floats, cracking tiles |
| 5 The Sky Temple | Phantom tiles that fade in and out, precision pillars, a rotating beam, a wave of timed doors, a second pull-up, the final anchor swing, final drums, the summit bell |

### Obstacles (all 15 work in the simulation)

| # | Obstacle | Where |
|---|---|---|
| 1 | Moving platforms | `Mover` |
| 2 | Falling platforms | `FallTile` |
| 3 | Rotating beams | `Rotor` sweeper |
| 4 | Swinging hammers | `Hammer` |
| 5 | Collapsing bridges | `Bridge` |
| 6 | Wind zones | `Wind`: drags grounded players and shoves airborne ones |
| 7 | Conveyor belts | belt surfaces |
| 8 | Slippery ice | ice surfaces with low acceleration and friction |
| 9 | Timed doors | `Door` |
| 10 | Elevators | `Lift` |
| 11 | Balance beams | `Sway` |
| 12 | Jump puzzles | hop and pillar sequences |
| 13 | Chain anchor points | anchor posts |
| 14 | Swing gaps | zone 2 and zone 5 |
| 15 | Disappearing platforms | `Vanish` |

There are also piston crushers and icicles.

### Co-op mechanics
Each mechanic has 3D markers and HUD hints:
- **Lever hold:** one player holds a lever to extend a bridge; levers sit on both sides.
- **Anchor:** one player clips in while the other swings.
- **Simultaneous jump:** jump off both drums within 0.45 s to be launched; a lone jump is just a normal jump.
- **Swing and stabilize.**
- **Two pressure plates:** both must be held to open a gate.
- **Pull-up walls:** boost your partner by letting them stand on your head, then they reel you up.
- **Moving-platform coordination:** a tandem sled, and an elevator that needs both players.

### Falls
- **Danger** means an airborne player has dropped more than 6 m from their last footing, or has passed the zone's kill height. Swinging from an anchored partner does not count.
- **One player in danger.** A 9-second rescue window opens with a red banner and a countdown. Reel them up or let them land somewhere. If time runs out, both reset to the checkpoint.
- **Both in danger** means both fall. A dramatic fall overlay plays, then both respawn at the checkpoint after 1.6 s.
- **Statistics tracked:**
  - falls in total and per player;
  - checkpoints reached;
  - highest altitude;
  - best times overall and per zone (splits).

### Modes
- **Normal.**
- **Hardcore:** no checkpoints; any failed fall restarts the climb and the timer.
- **Speedrun:** the timer never stops, even when paused. Records are kept, and finishing gives a leaderboard-ready run file.
- **Practice:** start in any zone you have reached before; no records.

### Replayability
- Personal bests for each mode and fastest zone splits, with the top 25 runs exportable as JSON.
- Total falls and highest altitude.
- 10 hidden relics, two of them on secret shortcut routes.
- Skins and chain styles (Steel, Rope, Gold, Neon, Rose Quartz) unlock as you collect relics.
- 10 challenge objectives.

### UI
- **Main menu:** Play Together, Host Game, Join Game, Continue Game, Load Save File, Customize, Settings, Credits. The background is a live 3D orbit of the mountain.
- **Lobby:**
  - room code, a manual/QR invite, two player slots with names and colours;
  - connection status, a ready flag, and host-only mode, chain-length and zone settings;
  - Start is blocked until the guest is ready.
- **HUD:**
  - names and a chain link icon, the tension meter, altitude with your best and the summit height;
  - zone name, checkpoint pips, timer and mode, falls per player, relics;
  - connection quality (ping), save status, context prompts ("E — clip onto the anchor") and tutorial hints;
  - banners, toasts, the rescue countdown, the fall overlay, and name labels over heads.
- **Pause:** Resume, Save Game, Download Save, Settings, and Return to Lobby (host) or Return to Menu (same screen). The guest gets Leave Game.
- **Results:** time, falls, relics, splits against your bests, challenges earned, and a run-record download.

### Visuals
- **Rendering:** ACES tone mapping, soft shadows that follow the action, and a sky shader plus fog palette that blends per zone as you climb.
- **Lighting:** image-based light from the sky environment, so metals, the bell and gold read correctly.
- **Textures:** procedural for every surface; no image files.
- **Decor:** floating rock islands, colonnades, pines, tanks and pipes, ice spikes and a cloud sea, all instanced.
- **Particles:** ambient snow, dust and embers, wind streaks in gust zones, waving flags, and bursts for landings, checkpoints, relics and launches.

### Audio
All sound is synthesized with WebAudio:
- footsteps (by surface: stone, metal, snow), jump, land, climb;
- chain rattle driven by the rope's motion, a tension beep and a strain groan;
- slip, fall whistle, hits, checkpoint chime, relic sparkle, launch boom, creaks, cracks, gates and machinery;
- ambience per zone (wind, factory hum, blizzard, temple pad) and a victory tune.

Master, music and effects volumes can be set separately, with mute on M.

### Input
- **Keyboard and mouse:** pointer lock is used for mouse look.
- **Touch:** a virtual stick plus jump, sprint, E and pause buttons; drag to look.
- **Gamepads:** both players are supported on one screen.

### Performance
- The static world is merged into one mesh per surface type (about 15 draw calls).
- Decor and chain links are instanced, giving about 170 draw calls in total.
- Quality has three settings:
  - **Low:** no shadows and about 0.8× pixel ratio.
  - **Medium:** 1024 shadow map and 1.25× pixel ratio.
  - **High:** 2048 shadow map and 2× pixel ratio.
- Field of view and look sensitivity are adjustable.
- Resizing is handled, and renderers and geometry are disposed when you leave a game.

---

## 2. Files

| File | Purpose |
|---|---|
| `index.html`, `style.css` | Page, menus, HUD and overlays |
| `main.js` | App shell: screens, lobby UI, same-screen setup, continue/load, settings, customize, results, game lifecycle, autosave, unsaved-change warnings |
| `game.js` | The running game: fixed 60 Hz loop and three drivers (same screen, online host, online guest with prediction and interpolation); events to effects, audio and HUD |
| `sim.js` | **Authoritative simulation**: players, chain, obstacles, interactions, checkpoints, falls and rescue, modes, relics, victory, snapshots, save mapping |
| `physics.js` | Collision world: oriented boxes, uniform grid, sphere-vs-box, raycast, moving-platform carry |
| `player.js` | Character controller (pure function of state and input) |
| `chain.js` | Tether constraint (gameplay) and Verlet rope (visual) |
| `obstacles.js` | All obstacles and co-op devices (deterministic or stateful, with pack/unpack) |
| `level.js` | The five zones, checkpoints, relics, hints and the route-feasibility report |
| `render.js` | three.js scene: sky, lights, environment, merged world, massif, decor, obstacle meshes, markers, particles, chain links, camera rig |
| `char.js` | The two climbers, skins and procedural animation |
| `gfx.js` | Procedural textures, materials and box-geometry batching |
| `input.js` | Keyboard, mouse, touch and gamepad input to per-player input frames |
| `hud.js` | HUD and dialogs |
| `audio.js` | Synthesized audio |
| `net.js` | WebRTC transport: PeerJS room codes, a manual offer/answer (QR or copy-paste) fallback, optional TURN, optional self-hosted signalling |
| `session.js` | Online protocol: hello and version check, lobby, ready/start, heartbeat, reconnection, error messages |
| `save.js`, `save-core.js` | Save format and validation, JSON download and import, IndexedDB recovery snapshots, File System Access linked file, one-tab session lock, revision conflict checks |
| `profile.js` | Settings, records, unlocks, challenges (localStorage) |
| `test.mjs` | Node tests of the simulation (77 checks, no browser) |
| `tools/e2e.mjs` | Two-browser end-to-end test of the 17-point checklist (27 checks) |
| `three.module.js`, `peerjs.min.js`, `qrcode.js`, `jsQR.js`, `fonts/` | Vendored libraries and fonts (MIT, Apache-2.0, SIL OFL) |

---

## 3. Installation
Nothing to install. To run the tests you need Node 18+:

```
node test.mjs                          # simulation tests
npm i -D playwright-core peer          # only for the browser E2E test
```

## 4. Running locally
ES modules need to be served over HTTP; opening the file directly will not work. From this folder, run any static server:

```
python3 -m http.server 8000
# or: npx serve .
```

Then open `http://localhost:8000/`.
- **Play Together:** both players on one keyboard, or with gamepads.
- **Online:** open the game on two devices or browsers, choose Host Game on one and Join Game on the other.

## 5. Hosting online
Upload the folder to any static host: GitHub Pages, Netlify, Cloudflare Pages, itch.io (HTML5) or S3. GitHub Pages steps:
1. Put these files in a repository.
2. Go to Settings › Pages, pick the branch and the root folder.
3. Open `https://<you>.github.io/<repo>/`.

HTTPS is required for WebRTC, the clipboard, QR camera scanning and the File System Access API. All of these hosts provide it.

A deep link `…/index.html?room=ABCDE` opens Join with the code filled in.

## 6. PeerJS and networking requirements
- **Topology:** the host's browser is the server. The guest sends inputs at 30 Hz (sequence-numbered and sent redundantly). The host simulates at a fixed 60 Hz and sends snapshots at 20 Hz:
  - positions, velocities, rotations and grounded/animation state;
  - chain length, tension and state;
  - stateful obstacles, checkpoint, timer and falls;
  - pause, respawn, victory and events.
- **Guest side:** the guest predicts its own climber and reconciles with the acknowledged input. It renders the host 100 ms in the past by interpolation.
  - It keeps deterministic obstacles in phase by estimating the host's clock.
  - Only the host resolves the chain, so the two sides never fight over it.
- **Heartbeat:** a ping every second; 6 s of silence is treated as connection lost.
  - A guest who joined with a room code automatically retries the same room for 60 s.
  - The host pauses, saves a recovery snapshot and keeps the room open.
  - When the guest returns, the host resends the full state.
- **Signalling.** PeerJS only brokers the handshake; game traffic is peer-to-peer.
  - By default the game uses the free public PeerJS cloud (`0.peerjs.com`). It needs internet access, and its availability is not guaranteed.
  - For reliability, run your own server: `npx -p peer peerjs --port 9000 --path /tethered`, or the `peer` npm package behind HTTPS. Enter it under Settings › Network › Signalling server (e.g. `signal.example.com:443/tethered`), or pass `?signal=host:port/path` in the URL. Both players must use the same server.
- **No signalling at all:** use **Manual / QR invite**.
  1. The host shares an invite code or QR.
  2. The guest pastes or scans it and returns an answer code.
  3. This needs no server and works on the same Wi-Fi with no internet. Automatic reconnection is not possible on this path; resume from the save instead.
- **NAT:** direct WebRTC fails on some networks (symmetric NAT, some mobile carriers and corporate firewalls). Add a TURN relay you control under Settings › Network (URL, username, credential).
- **Errors shown to players:**
  - invalid room code;
  - room not found;
  - connection timeout;
  - signalling server unreachable;
  - incompatible game versions (the major version must match);
  - room full;
  - player disconnected or left;
  - connection lost (with reconnect attempts);
  - host ended the session.

## 7. Saving, exporting and importing
- **Download Save** (pause menu, host or same screen):
  - Writes `tethered-save-YYYY-MM-DD-HHMM.json`.
  - It follows the required structure: `gameVersion`, `saveId`, `roomCode`, `timestamp`, `host` and `guest` (with `playerId`, `name`, `position`, `rotation`, `velocity`), `chain` (`maximumLength`, `tension`, `state`) and `progress` (`level`, `checkpointId`, `heightReached`, `elapsedTime`).
  - An `extra` block adds the revision, mode, falls, relics, checkpoints reached, splits, the sim clock, the current reel length, colours, skins and chain style.
  - **A downloaded file is a one-off copy. It is never updated afterwards.**
- **Load Save File** (main menu or Continue):
  - Validates the structure, types and ranges, and checks the major version.
  - If this browser has a *newer revision* of the same session, it offers that instead of rolling back.
  - A same-revision file that differs becomes a separate session.
  - It then opens a **new room**; it tries to reuse the saved room code. Your partner joins again, and both climbers are restored to their saved positions, with the checkpoint, chain length, timer, falls and relics.
  - The same save can also be resumed on one screen.
- **Recovery snapshots (automatic)** are kept in IndexedDB:
  - every 30 s, at each checkpoint;
  - before returning to the menu or lobby;
  - when the partner disconnects;
  - when the tab is hidden or closed.

  They appear under **Continue Game**, which survives a refresh.
- **Save Game** (pause) writes a snapshot immediately.
- **Linked save file** (Settings › Saving, Chrome/Edge desktop): pick a file once with the File System Access API. *Save Game* and autosaves then overwrite that file whenever the browser grants permission. Safari, iPad and Firefox do not support this API, so the game falls back to Download Save plus the IndexedDB snapshots.
- **Conflicts:** a session can only be open in one tab at a time (localStorage heartbeat lock). Revision numbers stop an older copy from overwriting a newer one.
- **Unsaved changes:** the HUD shows the last autosave time, leaving to the menu asks first, and closing the tab mid-climb triggers the browser's leave warning (after saving a snapshot).

## 8. Known limitations
- **Physics engine.** The game uses a purpose-built deterministic kinematic solver (capsules made of spheres against oriented boxes) instead of Rapier. The host, the guest's prediction and the Node tests all need the *same* fixed-step code, and all level geometry is boxes. The chain's *gameplay* constraint is a straight-line distance between the climbers. The *visual* rope collides with geometry, but the chain does not wrap around corners or posts in gameplay.
- **Swing gaps can be skipped.** A brave sprint jump from the anchor overhang can skip the intended swing. That is deliberate leeway, not a bug.
- **Online play.** Two players only. Room codes depend on a PeerJS signalling server. Manual/QR connections cannot auto-reconnect. Some networks need TURN. Only the host can save; the guest gets nothing to download.
- **Guest prediction.** It approximates the chain locally, so near full tension a guest may see a small correction when the host's result arrives.
- **Testing.** Tests were run in headless Chromium with software WebGL. Real-device frame rates (phones and tablets especially) were not measured; use Low quality on weaker devices. Safari and Firefox were not tested here.
- **Audio** starts after the first click or tap (browser autoplay rules).
- **Records** are stored per browser. The run-record JSON is "leaderboard-ready", but there is no online leaderboard service.

## Tests
```
node test.mjs
PW=$(node -p "require.resolve('playwright-core')") URL=http://127.0.0.1:8000/ SIGNAL=127.0.0.1:9000/tethered node tools/e2e.mjs
```

`test.mjs` covers:
- that all 64 ordinary route jumps land with real physics;
- jump heights, speeds and the tether limit;
- head-boost, mantle and pull-up;
- both swing gaps, the drums, the lever bridge, the elevator, the plates, wind and bracing;
- the rescue window, respawn and hardcore reset;
- each obstacle;
- snapshots and saves.

`tools/e2e.mjs` covers:
- room create and join, the invalid-code and room-not-found errors;
- seeing each other, movement and jump sync, the chain limit, obstacle phase;
- checkpoints and falls on both clients, shared pause, save download;
- disconnect and reconnect, loading the save into a new room with both players restored;
- refresh-and-continue, mobile stick and jump;
- console errors.
