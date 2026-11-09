// The running game: fixed-step loop, the three drivers (same-screen, online host, online guest), camera, effects,
// HUD/audio hooks and save hooks. Menus and the lobby live in ui.js / session.js.
import { Sim, DT, VERSION } from './sim.js';
import { stepPlayer, newPlayer, P } from './player.js';
import { tether, Rope, attach } from './chain.js';
import { Renderer, CamRig } from './render.js';
import * as THREE from './three.module.js';

const now = () => performance.now();
const lerp = (a, b, k) => a + (b - a) * k;
const lerpAng = (a, b, k) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * k; };
const clonePl = pl => ({ ...pl, p: { ...pl.p }, v: { ...pl.v } });

export class Game {
  // cfg: { kind: 'local'|'host'|'guest', canvas, input, hud, audio, settings:{mode,chainLen,startZone,quality,fov}, names, colors, skins, chainStyle, save?, link?, onEnd }
  constructor(cfg) {
    this.cfg = cfg; this.kind = cfg.kind; this.input = cfg.input; this.hud = cfg.hud; this.audio = cfg.audio; this.me = this.kind === 'guest' ? 1 : 0;
    const st = cfg.settings; this.sim = new Sim({ mode: st.mode, chainLen: st.chainLen, startZone: st.startZone || 0, names: cfg.names, ids: cfg.ids });
    if (cfg.save) this.sim.fromSave(cfg.save);
    this.R = new Renderer(cfg.canvas, this.sim.L, { quality: st.quality, fov: st.fov, p1: { color: cfg.colors[0], skin: cfg.skins[0], name: cfg.names[0] }, p2: { color: cfg.colors[1], skin: cfg.skins[1], name: cfg.names[1] }, chainStyle: cfg.chainStyle });
    this.R.setQuality(st.quality); this.rig = new CamRig(); this.rope = new Rope(18); this.acc = 0; this.last = now(); this.running = false; this.fx = { fall: 0, flash: 0, white: 0 };
    this.prevP = this.sim.players.map(p => ({ ...p.p })); this.groundY = [0, 0]; this.tick = 0; this.events = []; this.sendQ = [];
    this.input.local2 = this.kind === 'local'; this.input.onPause = () => this.togglePause(); this.input.onReset = () => this.askReset();
    // guest state
    this.hist = []; this.seq = 0; this.snaps = []; this.err = { x: 0, y: 0, z: 0 }; this.tOff = null; this.rtt = 0.08; this.lastSnapAt = 0; this.lastAck = -1;
    // host state
    this.gq = []; this.gLast = 0; this.gInput = {}; this.gProc = 0;
    this.rig.yaw = this.sim.L.cps[this.sim.cp].yaw || 0; this.lastCam = this.rig.yaw;
    this.intro = !cfg.save && (this.sim.cp === 0);
    window.__game = this;
  }
  start() {
    this.running = true; this.last = now(); const c = this.sim.L.cps[this.sim.cp], s = this.sim.L.bell.pos;
    if (this.intro) { this.rig.intro({ x: s.x + 30, y: s.y + 25, z: s.z - 40 }, s, 3.6); this.hud.banner('TETHERED', 'Two players. One chain. One way up.'); }
    else this.hud.banner(this.sim.L.zones[c.zone].name, c.label);
    this.audio.startAmbient(); requestAnimationFrame(t => this.loop(t));
  }
  stop() { this.running = false; this.audio.stopAmbient(); this.R.dispose(); window.__game = null; }

  // ───── input & commands ─────
  camYaw() { return this.rig.yaw; }
  togglePause(force) {
    const want = force !== undefined ? force : !this.sim.paused; if (this.sim.state === 'victory') return;
    if (this.kind === 'guest') { this.cfg.link?.send({ t: 'pause', on: want }); this.hud.pauseMenu(want, this); return; }
    this.sim.paused = want; this.hud.pauseMenu(want, this); this.cfg.onPauseChange?.(want);
    if (this.kind === 'host') this.cfg.link?.send({ t: 'pause', on: want, by: 0 });
  }
  askReset() { if (this.sim.state !== 'play') return; this.hud.confirm('Reset both players to the last checkpoint?', 'Reset', () => { if (this.kind === 'guest') this.cfg.link?.send({ t: 'reset' }); else this.doReset('you'); }); }
  doReset(by) { this.sim.respawn(this.sim.mode === 'hardcore' ? 0 : this.sim.cp); this.hud.toast(by === 'partner' ? `${this.sim.names[1]} reset to the checkpoint` : 'Reset to checkpoint'); }

  // ───── main loop ─────
  loop(t) {
    if (!this.running) return; requestAnimationFrame(tt => this.loop(tt));
    const n = now(); let dt = Math.min(0.1, (n - this.last) / 1000); this.last = n; this.acc += dt;
    const pads = this.input.pads(); const look = this.input.takeLook(this.kind === 'local' && pads.length < 2 ? null : pads[0]);
    if (this.rig.cine && this.input.keys.size && this.rig.cine.t > 0.6) this.rig.cine.t = Math.max(this.rig.cine.t, this.rig.cine.dur - 0.5);
    if (!this.rig.cine && this.sim.state !== 'victory') { this.rig.yaw -= look.dx; this.rig.pitch = Math.max(-1.1, Math.min(0.35, this.rig.pitch - look.dy)); }
    let steps = 0; while (this.acc >= DT && steps < 6) { this.fixed(); this.acc -= DT; steps++; } if (steps === 6) this.acc = 0;
    this.draw(dt, this.kind === 'guest' ? 1 : this.acc / DT);
    this.net(dt);
  }
  fixed() {
    this.tick++; const S = this.sim;
    if (this.kind === 'guest') return this.guestStep();
    this.prevP = S.players.map(p => ({ ...p.p }));
    const i0 = this.rig.cine ? { yaw: this.camYaw(), jp: this.input.cnt[0].jp, up: this.input.cnt[0].up } : this.input.frame(0, this.camYaw());
    S.setInput(0, i0);
    if (this.kind === 'local') S.setInput(1, this.rig.cine ? { yaw: this.camYaw(), jp: this.input.cnt[1].jp, up: this.input.cnt[1].up } : this.input.frame(1, this.camYaw()));
    else this.hostTakeGuestInput();
    S.step(); if (S.paused && S.mode === 'speedrun' && S.state === 'play') S.elapsed += DT;
    if (S.events.length) { for (const e of S.events) this.onEvent(e); if (this.kind === 'host') this.sendQ.push(...S.events); S.events = []; }
    if (this.kind === 'host' && this.tick % 3 === 0) this.sendSnapshot();
  }

  // ───── host ─────
  hostTakeGuestInput() {
    while (this.gq.length > 8) this.gq.shift(); // never let latency pile up
    const next = this.gq.shift(); if (next) { this.gInput = next; this.gProc = next.seq; }
    this.sim.setInput(1, this.gInput);
  }
  onGuestInput(arr) { for (const a of arr) { if (a[0] <= this.gLast) continue; this.gLast = a[0]; this.gq.push({ seq: a[0], f: a[1], s: a[2], yaw: a[3], sprint: !!(a[4] & 1), jump: !!(a[4] & 2), use: !!(a[4] & 4), jp: a[5], up: a[6] }); } }
  sendSnapshot() { const s = this.sim.snapshot([0, this.gProc]); s.ev = this.sendQ; this.sendQ = []; this.cfg.link?.send(s); }

  // ───── guest ─────
  serverTime() { if (this.tOff === null) return this.sim.t; return (now() / 1000) + this.tOff; }
  guestStep() {
    const S = this.sim, me = S.players[1]; this.prevP = S.players.map(p => ({ ...p.p }));
    if (!this.started) return;
    const inp = this.rig.cine ? { f: 0, s: 0, sprint: false, jump: false, use: false, yaw: this.camYaw(), jp: this.input.cnt[0].jp, up: this.input.cnt[0].up } : this.input.frame(0, this.camYaw()); inp.seq = ++this.seq; this.hist.push(inp); if (this.hist.length > 240) this.hist.shift();
    this.outIn = this.outIn || []; this.outIn.push([inp.seq, +inp.f.toFixed(2), +inp.s.toFixed(2), +inp.yaw.toFixed(3), (inp.sprint ? 1 : 0) | (inp.jump ? 2 : 0) | (inp.use ? 4 : 0), inp.jp, inp.up]);
    if (S.paused || S.state !== 'play') return; // host decides everything during respawn / pause / victory
    const t = this.serverTime(); S.poseObstacles(t, DT); this.predict(me, inp);
  }
  predict(me, inp) {
    const S = this.sim, other = this.remoteNow || S.players[0];
    stepPlayer(me, inp, { dt: DT, t: S.t, world: S.world, wind: p => S.windAt(p, me), others: [other], hanging: p => S.chain.taut && !p.grounded });
    // local approximation of the chain: only our side moves (the host resolves the real constraint)
    const ghost = clonePl(other); ghost.anchored = 'x'; tether(ghost, me, S.Le, {}, inp, DT);
  }
  onSnapshot(s) {
    const S = this.sim, me = S.players[1], tNow = now() / 1000;
    if (this.lastSnapK !== undefined && s.k <= this.lastSnapK) return; this.lastSnapK = s.k;
    const off = s.time - tNow + this.rtt / 2; this.tOff = this.tOff === null ? off : this.tOff + (off - this.tOff) * 0.1; if (Math.abs(off - this.tOff) > 0.5) this.tOff = off;
    const before = { ...me.p }, wasState = S.state;
    S.applySnapshot(s, 1); this.snaps.push({ at: now(), pl: s.pl[0] }); while (this.snaps.length > 30) this.snaps.shift();
    for (const e of s.ev || []) this.onEvent(e);
    if (!this.started) { this.started = true; }
    // reconcile own character: authoritative state at the acknowledged input, then replay the rest
    const ack = s.ack[1]; Sim.applyPlayer(me, s.pl[1], S.world); this.hist = this.hist.filter(h => h.seq > ack);
    if (S.state === 'play' && !S.paused) { const t = this.serverTime(); for (const h of this.hist) { this.predict(me, h); } }
    const ex = before.x - me.p.x, ey = before.y - me.p.y, ez = before.z - me.p.z;
    if (Math.hypot(ex, ey, ez) > 3 || wasState !== S.state) this.err = { x: 0, y: 0, z: 0 }; else { this.err.x += ex; this.err.y += ey; this.err.z += ez; }
    this.lastSnapAt = now();
  }
  remoteInterp() { // render the host 100 ms in the past between buffered snapshots
    const rt = now() - 100, b = this.snaps; if (!b.length) return null; let i = b.length - 1; while (i > 0 && b[i - 1].at > rt) i--;
    const A = b[Math.max(0, i - 1)], B = b[i]; const k = B.at === A.at ? 1 : Math.max(0, Math.min(1, (rt - A.at) / (B.at - A.at)));
    const pl = newPlayer(0, 0, 0, 0); Sim.applyPlayer(pl, B.pl, this.sim.world); pl.p.x = lerp(A.pl[0], B.pl[0], k); pl.p.y = lerp(A.pl[1], B.pl[1], k); pl.p.z = lerp(A.pl[2], B.pl[2], k); pl.yaw = lerpAng(A.pl[6], B.pl[6], k); pl.moved = (this._rm || 0) + Math.hypot(pl.p.x - (this._rp?.x ?? pl.p.x), pl.p.z - (this._rp?.z ?? pl.p.z)); this._rm = pl.moved; this._rp = { ...pl.p }; pl.speed = Math.hypot(B.pl[3], B.pl[5]);
    return pl;
  }

  // ───── networking tick (send inputs 30 Hz, heartbeat) ─────
  net(dt) {
    const L = this.cfg.link; if (!L) return; this.netT = (this.netT || 0) + dt; this.hbT = (this.hbT || 0) + dt;
    if (this.kind === 'guest' && this.outIn?.length && this.netT >= 1 / 30) { this.netT = 0; const recent = this.hist.slice(-6).map(inp => [inp.seq, +inp.f.toFixed(2), +inp.s.toFixed(2), +inp.yaw.toFixed(3), (inp.sprint ? 1 : 0) | (inp.jump ? 2 : 0) | (inp.use ? 4 : 0), inp.jp, inp.up]); L.send({ t: 'in', a: recent }); this.outIn = []; }
  }

  // ───── events → fx/audio/hud ─────
  onEvent(e) {
    const A = this.audio, H = this.hud, R = this.R, S = this.sim, who = e.who ?? 0, mine = who === this.me || this.kind === 'local';
    const at = e.at || S.players[who]?.p; const rel = at ? this.relPos(at) : null;
    switch (e.type) {
      case 'jump': A.play('jump', rel); break;
      case 'land': A.play('land', rel, Math.min(1, (e.k || 6) / 18)); R.burst({ x: at.x, y: at.y + 0.1, z: at.z }, '#d8c8b0', 10, 2.5, 1, 0.5); if ((e.k || 0) > 14) this.rig.shake = 0.5; break;
      case 'hit': A.play('hit', rel); R.burst({ x: at.x, y: at.y + 1, z: at.z }, '#ffd23f', 18, 5, 3, 0.6); this.rig.shake = 0.8; break;
      case 'climb': A.play('climb', rel); break;
      case 'checkpoint': A.play('checkpoint'); H.banner('Checkpoint', S.L.cps[e.cp].label); R.burst({ x: at.x, y: at.y + 1, z: at.z }, '#ffd978', 60, 6, 6, 1.4); this.cfg.onCheckpoint?.(e); break;
      case 'relic': A.play('relic'); H.toast(`Relic found! (${S.relics.size}/${S.L.relics.length})`); R.burst(at, '#7df3ff', 40, 4, 4, 1); this.cfg.onRelic?.(e); break;
      case 'zone': { const z = S.L.zones[e.zone]; H.banner(z.name, z.sub); A.zone(e.zone); this.cfg.onZone?.(e); break; }
      case 'slip': A.play('slip', rel); break;
      case 'rescue': H.toast(`${S.names[who]} is dangling! Haul them up — hold E`, 'warn'); A.play('warn'); break;
      case 'saved': H.toast(`${S.names[who]} is safe!`); A.play('saved'); this.cfg.onRescue?.(); break;
      case 'fall': A.play('fall'); this.fx.fall = 1; H.fallBanner(e.why === 'both' ? 'You both fell!' : `${S.names[e.who[0]]} fell!`, S.mode === 'hardcore' ? 'Hardcore — back to the bottom' : 'Back to the checkpoint'); this.rig.shake = 1; this.cfg.onFall?.(e); break;
      case 'respawn': this.fx.white = 1; this.rope.init = false; this.err = { x: 0, y: 0, z: 0 }; break;
      case 'launch': A.play('launch'); R.burst({ x: at.x, y: at.y + 0.5, z: at.z }, '#ff8a6a', 60, 6, 8, 1.1); break;
      case 'crack': A.play('crack', rel); break;
      case 'creak': A.play('creak', rel); break;
      case 'gate': A.play('gate', rel); H.toast('Gate open!'); break;
      case 'bridge': A.play('mech', rel); break;
      case 'lift': A.play('mech', rel); break;
      case 'clip': A.play('clip', rel); H.toast(`${S.names[who]} anchored`); break;
      case 'unclip': A.play('clip', rel); break;
      case 'victory': A.play('victory'); A.victoryMusic(); this.cfg.onVictory?.(S.victory); break;
      case 'hardreset': H.toast('Hardcore: the run restarts from the base', 'warn'); break;
    }
  }
  relPos(at) { const c = this.R.cam.position; return { x: at.x - c.x, y: at.y - c.y, z: at.z - c.z, yaw: this.rig.yaw }; }

  // ───── draw ─────
  draw(dt, alpha) {
    const S = this.sim, R = this.R; let pls;
    if (this.kind === 'guest') {
      const me = clonePl(S.players[1]); const k = Math.max(0, 1 - dt * 8); this.err.x *= k; this.err.y *= k; this.err.z *= k; me.p.x += this.err.x; me.p.y += this.err.y; me.p.z += this.err.z;
      const rem = this.remoteInterp() || clonePl(S.players[0]); this.remoteNow = rem; pls = [rem, me];
    } else pls = S.players.map((pl, i) => { const c = clonePl(pl); const a = this.prevP[i]; if (a) { c.p.x = lerp(a.x, pl.p.x, alpha); c.p.y = lerp(a.y, pl.p.y, alpha); c.p.z = lerp(a.z, pl.p.z, alpha); } return c; });
    // ground shadow height under each player
    pls.forEach((pl, i) => { const h = S.world.raycast(pl.p.x, pl.p.y + 0.5, pl.p.z, 0, -1, 0, 30); this.groundY[i] = h.box ? pl.p.y + 0.5 - h.t : -999; });
    // rope between the rendered attach points
    const wa = { x: pls[0].p.x, y: pls[0].p.y + P.waist, z: pls[0].p.z }, wb = { x: pls[1].p.x, y: pls[1].p.y + P.waist, z: pls[1].p.z };
    this.rope.step(wa, wb, S.Le, Math.min(dt, 1 / 30), this.R.q === 'low' ? null : S.world);
    this.audio.chain(this.rope.motion, S.chain.tension, S.chain.state);
    // camera
    const focus = this.kind === 'local' ? { x: (pls[0].p.x + pls[1].p.x) / 2, y: (pls[0].p.y + pls[1].p.y) / 2, z: (pls[0].p.z + pls[1].p.z) / 2 } : pls[this.me].p;
    const sep = Math.hypot(pls[0].p.x - pls[1].p.x, pls[0].p.y - pls[1].p.y, pls[0].p.z - pls[1].p.z);
    this.rig.update(R.cam, focus, dt, S.world, { dist: this.kind === 'local' ? 7.5 + sep * 0.55 : 7.2, orbit: S.state === 'victory' ? S.L.bell.pos : null });
    this.fx.fall = Math.max(0, this.fx.fall - dt * 0.7); this.fx.white = Math.max(0, this.fx.white - dt * 1.4);
    R.frame({ players: pls, rope: this.rope, chain: S.chain, t: this.kind === 'guest' ? this.serverTime() : S.t, cp: S.cp, cpReached: S.cpReached, relics: S.relics, zone: S.zone, state: S.state, groundY: this.groundY, focus, fx: this.fx }, dt);
    R.render();
    this.hud.update(this, pls, dt);
  }
  // project a world point to screen (for name labels)
  project(p) { const v = new THREE.Vector3(p.x, p.y, p.z).project(this.R.cam); return { x: (v.x + 1) / 2, y: (1 - v.y) / 2, vis: v.z < 1 }; }
}
