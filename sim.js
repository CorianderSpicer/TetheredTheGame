// Authoritative game simulation: two players, the chain, obstacles, checkpoints, falls & rescue, modes, relics,
// victory. Runs on the host (online), on the single device (same-screen co-op) and in Node tests. The guest runs a
// Sim in replica mode for prediction of its own character only (see net-game.js).
import { buildLevel, ZONES, LEVELS, levelOf } from './level.js';
import { newPlayer, stepPlayer, waist, P } from './player.js';
import { tether, CH } from './chain.js';

export const VERSION = '1.0.0';
export const DT = 1 / 60;
export const MODES = { normal: 'Normal', hardcore: 'Hardcore', speedrun: 'Speedrun', practice: 'Practice' };
export const RESCUE_TIME = 9, DANGER_DROP = 6.0;

export class Sim {
  constructor(opts = {}) {
    this.level = levelOf(opts.level).id; this.L = buildLevel(this.level); this.world = this.L.world; this.t = 0; this.tick = 0;
    this.mode = opts.mode || 'normal'; this.chainLen = opts.chainLen || 8; this.Le = this.chainLen;
    // Party size. The rope runs in a line: 0—1—2—3, so every extra climber adds one more link to
    // drag around, which is the whole difficulty curve of a bigger group.
    this.n = Math.max(2, Math.min(4, opts.n || (opts.names?.length) || 2));
    const N = this.n, fill = (v) => Array.from({ length: N }, () => (typeof v === 'function' ? v() : v));
    this.players = Array.from({ length: N }, (_, i) => newPlayer(i, 0, 0, 0));
    this.names = opts.names || Array.from({ length: N }, (_, i) => 'Player ' + (i + 1));
    this.ids = opts.ids || Array.from({ length: N }, (_, i) => (i === 0 ? 'host' : 'guest' + (i > 1 ? i : '')));
    this.inputs = fill(() => ({})); this.cp = 0; this.cpReached = new Set([0]); this.elapsed = 0; this.running = true; this.paused = false;
    this.state = 'play'; this.stateT = 0; this.rescue = null; this.falls = fill(0); this.fallsTotal = 0; this.maxAlt = 0;
    this.relics = new Set(); this.events = []; this.zone = 0; this.splits = []; this.zoneEnter = [0]; this.chain = { tension: 0, state: 'slack', d: 0, taut: false };
    this.links = Array.from({ length: Math.max(1, N - 1) }, () => ({ tension: 0, state: 'slack', d: 0, taut: false }));
    this.reelers = fill(false); this.useHeld = fill(false); this.lastUse = fill(0); this.prompt = fill(null); this.hint = fill(null);
    this.startZone = opts.startZone || 0; this.victory = null; this.revision = 0; this.dirty = false; this.lastSaveT = 0; this.launchedAt = 0;
    this.respawn(this.mode === 'practice' ? Math.max(0, this.L.cps.findIndex(c => c.zone === this.startZone)) : 0, true);
    if (this.mode === 'practice') { for (let i = 0; i <= this.cp; i++) this.cpReached.add(i); this.zoneEnter = [0]; }
  }
  /** Spawn mark for player `i`, interpolated/extrapolated from the checkpoint's authored pair. */
  spawnAt(c, i) {
    const [a, b] = c.spawn; if (this.n <= 2) return c.spawn[i] || a;
    const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, hx = (b.x - a.x) / 2, hz = (b.z - a.z) / 2;
    const k = this.n === 1 ? 0 : (i / (this.n - 1)) * 2 - 1;      // -1 … +1 across the pair
    const spread = 1.25;                                          // widen a touch so 4 fit
    return { x: mx + hx * k * spread, y: a.y, z: mz + hz * k * spread };
  }
  /** Everyone this player is roped to (their neighbours in the line). */
  neighbours(i) { const o = []; if (i > 0) o.push(this.players[i - 1]); if (i < this.n - 1) o.push(this.players[i + 1]); return o; }

  ev(type, at, extra) { this.events.push({ type, at: at ? { x: +at.x.toFixed(2), y: +at.y.toFixed(2), z: +at.z.toFixed(2) } : null, ...extra }); }
  altitude(pl) { return pl.p.y - this.L.startY; }
  setInput(i, inp) { this.inputs[i] = inp; }

  respawn(cpIdx = this.cp, initial = false) {
    const c = this.L.cps[cpIdx]; this.cp = cpIdx;
    // Checkpoints author two spawn marks; for a bigger party we spread everyone along that same
    // axis (and a little past it) so nobody spawns inside anybody else.
    this.players.forEach((pl, i) => { const s = this.spawnAt(c, i), jp = pl.lastJp; Object.assign(pl, newPlayer(i, s.x, s.y + 0.02, s.z, c.yaw)); pl.lastJp = jp; });
    for (const o of this.L.obs) o.reset(); this.Le = this.chainLen; this.rescue = null; this.state = 'play'; this.stateT = 0;
    if (!initial) this.ev('respawn', c.pos, { cp: cpIdx });
  }

  // fixed step
  step() {
    if (!this.running || this.paused) return;
    const dt = DT; this.t += dt; this.tick++; this.stateT += dt;
    if (this.state === 'victory') { this.animIdle(dt); return; }
    if (this.state === 'respawning') { if (this.stateT > 1.6) this.respawn(this.mode === 'hardcore' ? 0 : this.cp); else { this.animIdle(dt); return; } }
    if (this.state !== 'intro') this.elapsed += dt;
    for (const o of this.L.obs) for (const b of o.boxes) b.beginStep();
    for (const o of this.L.obs) o.update(this.t, dt, this, true);
    for (const o of this.L.obs) for (const b of o.boxes) { b.endStep(dt); }
    // interactions decided before movement: anchors, levers, reeling
    for (let i = 0; i < this.n; i++) this.interact(i);
    for (const o of this.L.obs) if (o.type === 'lever') o.held = o.levers.map((_, k) => this.players.some(pl => pl.leverAt && pl.leverAt[0] === o && pl.leverAt[1] === k) ? 1 : 0);
    const pre = this.players.map(pl => ({ ...pl.p }));
    for (let i = 0; i < this.n; i++) {
      const pl = this.players[i], others = this.players.filter((_, k) => k !== i);
      // riding on someone's head: follow whoever you are actually standing on
      if (pl.onHead) { const h = pl.headOf != null ? this.players[pl.headOf] : null; if (h) { pl.p.x += h.p.x - (h._px ?? h.p.x); pl.p.z += h.p.z - (h._pz ?? h.p.z); } }
      stepPlayer(pl, this.inputs[i], { dt, t: this.t, world: this.world, wind: p => this.windAt(p, pl), others, ev: (type, who, k) => this.onPlayerEv(type, who, k), hanging: p => this.isHanging(p) });
      if (pl.anchored) { const a = this.L.obs.find(o => o.id === pl.anchored); pl.p.x = a.pos.x + pl.anchorOff.x; pl.p.z = a.pos.z + pl.anchorOff.z; pl.p.y = Math.max(pl.p.y, a.pos.y); pl.v.x = pl.v.z = 0; }
    }
    this.players.forEach((pl, i) => { pl._px = pre[i].x; pl._pz = pre[i].z; });
    // chain length: reeling in shortens it, otherwise it pays back out
    const reeling = this.players.some(p => p.reel);
    if (reeling) this.Le = Math.max(CH.minLen, this.Le - CH.reelIn * dt); else this.Le = Math.min(this.chainLen, this.Le + CH.reelOut * dt);
    // Solve the rope link by link along the line. Two passes: with three or four climbers a single
    // pass lets a correction at one end undo the one before it and the party jitters.
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < this.n - 1; i++)
        this.links[i] = tether(this.players[i], this.players[i + 1], this.Le, this.inputs[i], this.inputs[i + 1], dt);
    // The HUD and the old save format want a single chain reading: report the worst link.
    this.chain = this.links.reduce((w, l) => (l.tension > w.tension ? l : w), this.links[0]);
    for (const pl of this.players) pl.tautAir = false;
    for (let i = 0; i < this.n - 1; i++) if (this.links[i].taut) { this.players[i].tautAir = true; this.players[i + 1].tautAir = true; }
    // being hauled by a reeling neighbour against a wall → climb assist (pull-up)
    for (let i = 0; i < this.n; i++) {
      const pl = this.players[i]; if (!pl.wall || pl.grounded) continue;
      for (const [k, sign] of [[i - 1, -1], [i, 1]]) {        // link below us, link above us
        const lk = this.links[k]; if (!lk || !lk.taut) continue;
        const o = this.players[sign > 0 ? i + 1 : i - 1]; if (!o?.reel) continue;
        const up = sign > 0 ? lk.ny : -lk.ny;
        if (up > 0.15) pl.assist = 0.15;
      }
    }
    this.rules(dt);
  }
  animIdle(dt) { for (const pl of this.players) { pl.animT += dt; } }

  windAt(p, pl) { let x = 0, z = 0, any = false; for (const w of this.L.winds) if (w.inside(p)) { const s = w.strength(this.t); x += w.dir.x * s; z += w.dir.z * s; any = true; }
    if (!any) return null; const k = pl.reel ? 0.35 : 1; return { x: x * k, y: 0, z: z * k }; }
  isHanging(pl) { // dangling under whichever neighbour is holding the rope taut above you
    return this.neighbours(pl.id).some((o, k) => { const lk = this.links[Math.min(pl.id, o.id)]; return lk?.taut && !pl.grounded && pl.p.y < o.p.y - 1.5 && Math.abs(pl.v.y) < 4; }); }

  onPlayerEv(type, pl, k) {
    if (type === 'jump') { for (const o of this.L.obs) if (o.type === 'drums') o.onJump(pl, this); this.ev('jump', pl.p, { who: pl.id }); }
    else if (type === 'land') this.ev('land', pl.p, { who: pl.id, k: +(k || 0).toFixed(1) });
    else if (type === 'hit') this.ev('hit', pl.p, { who: pl.id });
    else if (type === 'climb') this.ev('climb', pl.p, { who: pl.id });
  }

  // E: anchor posts and levers when near, otherwise hold to reel in / brace
  interact(i) {
    const pl = this.players[i], inp = this.inputs[i] || {}, held = !!inp.use, pressed = (inp.up || 0) !== this.lastUse[i];
    if (pressed) this.lastUse[i] = inp.up || 0;
    pl.reel = false; this.prompt[i] = null;
    // anchor
    let near = null, nd = 1.7; for (const o of this.L.obs) if (o.type === 'anchor') { const d = Math.hypot(o.pos.x - pl.p.x, o.pos.z - pl.p.z); if (d < nd && Math.abs(o.pos.y - pl.p.y) < 1.2) { nd = d; near = o; } }
    if (pl.anchored) { this.prompt[i] = 'unanchor'; if (pressed) { pl.anchored = null; this.ev('unclip', pl.p, { who: i }); } return; }
    if (near) { this.prompt[i] = 'anchor'; if (pressed && pl.grounded) { pl.anchored = near.id; const dx = pl.p.x - near.pos.x, dz = pl.p.z - near.pos.z, d = Math.hypot(dx, dz) || 1; pl.anchorOff = { x: dx / d * 0.55, z: dz / d * 0.55 }; this.ev('clip', near.pos, { who: i }); } return; }
    // levers: being near one and holding E keeps it pulled
    pl.leverAt = null; for (const o of this.L.obs) if (o.type === 'lever') for (let k = 0; k < o.levers.length; k++) { const l = o.levers[k]; if (Math.hypot(l.x - pl.p.x, l.z - pl.p.z) < 1.9 && Math.abs(l.y - pl.p.y) < 1.3) { this.prompt[i] = held ? 'leverheld' : 'lever'; if (held) pl.leverAt = [o, k]; return; } }
    // bell
    const bell = this.L.bell; if (bell && Math.hypot(bell.pos.x - pl.p.x, bell.pos.z - pl.p.z) < bell.r && Math.abs(pl.p.y - bell.pos.y) < 2) {
      const both = this.players.every(p => Math.hypot(bell.pos.x - p.p.x, bell.pos.z - p.p.z) < bell.r + 0.5 && Math.abs(p.p.y - bell.pos.y) < 2);
      this.prompt[i] = both ? 'bell' : 'bellwait'; if (both && pressed) this.win(); return; }
    if (held && pl.grounded && pl.stun <= 0) { pl.reel = true; this.prompt[i] = 'reeling'; }
    else if (held && !pl.grounded) { /* holding E in the air does nothing */ }
  }

  rules(dt) {
    const L = this.L;
    // zone + altitude tracking
    for (const pl of this.players) { const alt = this.altitude(pl); if (alt > this.maxAlt) this.maxAlt = alt; }
    const zNow = Math.max(...this.players.map(pl => this.zoneOf(pl)));
    if (zNow > this.zone && this.players.every(pl => this.zoneOf(pl) >= zNow)) { this.splits[this.zone] = +(this.elapsed - (this.zoneEnter[this.zone] || 0)).toFixed(2); this.zone = zNow; this.zoneEnter[zNow] = this.elapsed; this.ev('zone', null, { zone: zNow }); }
    // checkpoints: BOTH players must stand at the flag
    if (this.mode !== 'hardcore') for (const c of L.cps) { if (c.idx <= this.cp) continue;
      if (this.players.every(pl => Math.hypot(pl.p.x - c.pos.x, pl.p.z - c.pos.z) < c.r && Math.abs(pl.p.y - c.pos.y) < 2.5 && pl.grounded)) { this.cp = c.idx; this.cpReached.add(c.idx); this.ev('checkpoint', c.pos, { cp: c.idx, id: c.id }); this.dirty = true; } }
    // relics
    for (const r of L.relics) if (!this.relics.has(r.id)) for (const pl of this.players) if (Math.hypot(pl.p.x - r.pos.x, pl.p.y + 0.9 - r.pos.y, pl.p.z - r.pos.z) < 1.2) { this.relics.add(r.id); this.ev('relic', r.pos, { id: r.id, who: pl.id }); break; }
    // hints shown per player
    for (let i = 0; i < this.n; i++) { const p = this.players[i].p; this.hint[i] = null; for (const h of L.hints) if (p.x > h.x0 && p.x < h.x1 && p.z > h.z0 && p.z < h.z1 && p.y > h.y0 - 1 && p.y < h.y1 + 1) { this.hint[i] = L.hints.indexOf(h); break; } }
    // falls
    const killY = L.zones[L.cps[this.cp].zone].killY;
    for (const pl of this.players) { const drop = pl.lastGroundY - pl.p.y; const was = pl.danger; const swing = this.neighbours(pl.id).some(o => o.anchored) && !pl.anchored; pl.danger = !pl.grounded && ((drop > DANGER_DROP && !swing) || pl.p.y < killY); if (pl.danger && !was) this.ev('slip', pl.p, { who: pl.id }); }
    if (this.state === 'play') {
      const deep = this.players.some(pl => pl.p.y < killY - 30);
      if (this.players.every(pl => pl.danger) || deep) return this.fail('both');
      const d = this.players.find(pl => pl.danger);
      if (d) { if (!this.rescue) { this.rescue = { who: d.id, left: RESCUE_TIME }; this.ev('rescue', d.p, { who: d.id }); } }
      if (this.rescue) { const r = this.players[this.rescue.who]; if (r.grounded) { this.ev('saved', r.p, { who: r.id }); this.rescue = null; } else { this.rescue.left -= dt; if (this.rescue.left <= 0) return this.fail('rescue'); } }
    }
  }
  zoneOf(pl) { let z = 0; for (const zz of this.L.zones) { const f = zz.frame; const dx = pl.p.x - f.o.x, dz = pl.p.z - f.o.z, dy = pl.p.y - f.o.y; if (dy > -2 && Math.hypot(dx, dz) < 9) z = Math.max(z, zz.idx); } return Math.max(z, this.L.cps[this.cp].zone); }
  fail(why) {
    const who = why === 'both' ? [0, 1] : [this.rescue?.who ?? 0];
    for (const w of who) this.falls[w]++; this.fallsTotal++;
    this.state = 'respawning'; this.stateT = 0; this.rescue = null; this.ev('fall', this.players[who[0]].p, { why, who });
    if (this.mode === 'hardcore') { this.ev('hardreset'); this.elapsed = 0; this.zone = 0; this.zoneEnter = [0]; this.splits = []; this.cp = 0; }
    this.dirty = true;
  }
  win() { this.state = 'victory'; this.stateT = 0; this.splits[this.zone] = +(this.elapsed - (this.zoneEnter[this.zone] || 0)).toFixed(2);
    this.victory = { time: +this.elapsed.toFixed(2), falls: this.fallsTotal, fallsEach: [...this.falls], relics: this.relics.size, mode: this.mode, chain: this.chainLen, splits: [...this.splits], names: [...this.names], date: new Date().toISOString() }; this.ev('victory', this.L.bell.pos); this.dirty = true; }

  // ── snapshots (host → guest) ──
  snapPlayer(pl) { const r = v => Math.round(v * 1000) / 1000; return [r(pl.p.x), r(pl.p.y), r(pl.p.z), r(pl.v.x), r(pl.v.y), r(pl.v.z), r(pl.yaw), pl.grounded ? 1 : 0, pl.anim, r(pl.animT), pl.anchored || 0, pl.reel ? 1 : 0, pl.danger ? 1 : 0, pl.stun > 0 ? 1 : 0, r(pl.lastGroundY), pl.lastJp, r(pl.landT), pl.onHead ? 1 : 0, pl.gbox ? (pl.gbox._i ?? -1) : -1]; }
  snapshot(acks) {
    const ob = []; for (const o of this.L.obs) if (o.stateful) ob.push(o.pack());
    const ev = this.events; this.events = [];
    return { t: 's', k: this.tick, time: +this.t.toFixed(4), ack: acks, pl: this.players.map(p => this.snapPlayer(p)), ch: [+this.Le.toFixed(3), +this.chain.tension.toFixed(3), this.chain.state, this.chainLen],
      g: [this.state, +this.stateT.toFixed(2), this.cp, +this.elapsed.toFixed(2), this.fallsTotal, this.falls[0], this.falls[1], +this.maxAlt.toFixed(1), this.zone, this.rescue ? this.rescue.who : -1, this.rescue ? +this.rescue.left.toFixed(2) : 0, this.paused ? 1 : 0, this.mode],
      rl: [...this.relics], ob, ev, pr: this.prompt, hi: this.hint, vic: this.victory };
  }
  static applyPlayer(pl, a, world) { pl.p.x = a[0]; pl.p.y = a[1]; pl.p.z = a[2]; pl.v.x = a[3]; pl.v.y = a[4]; pl.v.z = a[5]; pl.yaw = a[6]; pl.grounded = !!a[7]; pl.anim = a[8]; pl.animT = a[9]; pl.anchored = a[10] || null; pl.reel = !!a[11]; pl.danger = !!a[12]; pl.stun = a[13] ? 0.2 : 0; pl.lastGroundY = a[14]; pl.lastJp = a[15]; pl.landT = a[16]; pl.onHead = !!a[17]; pl.gbox = a[18] >= 0 && world ? world.dynamic[a[18]] : null; }
  applySnapshot(s, skip = -1) {
    this.t = s.time; this.tick = s.k;
    s.pl.forEach((a, i) => { if (i !== skip) Sim.applyPlayer(this.players[i], a, this.world); });
    [this.Le, this.chain.tension, this.chain.state, this.chainLen] = s.ch;
    const g = s.g; this.state = g[0]; this.stateT = g[1]; this.cp = g[2]; this.elapsed = g[3]; this.fallsTotal = g[4]; this.falls = [g[5], g[6]]; this.maxAlt = g[7]; this.zone = g[8]; this.rescue = g[9] >= 0 ? { who: g[9], left: g[10] } : null; this.paused = !!g[11]; this.mode = g[12];
    for (let i = 0; i <= this.cp; i++) this.cpReached.add(i);
    this.relics = new Set(s.rl); let k = 0; for (const o of this.L.obs) if (o.stateful) o.unpack(s.ob[k++]);
    this.prompt = s.pr; this.hint = s.hi; this.victory = s.vic;
  }
  // geometry for a replica at time t (guest): deterministic obstacles from t, stateful ones from the last snapshot
  poseObstacles(t, dt) { for (const o of this.L.obs) for (const b of o.boxes) b.beginStep(); for (const o of this.L.obs) o.update(t, dt, this, false); for (const o of this.L.obs) for (const b of o.boxes) b.endStep(dt); }

  // ── save format (see save.js) ──
  toSave(meta) {
    const pj = (pl, i) => ({ playerId: this.ids[i], name: this.names[i], position: { x: +pl.p.x.toFixed(3), y: +pl.p.y.toFixed(3), z: +pl.p.z.toFixed(3) }, rotation: { x: 0, y: +pl.yaw.toFixed(4), z: 0 }, velocity: { x: +pl.v.x.toFixed(3), y: +pl.v.y.toFixed(3), z: +pl.v.z.toFixed(3) } });
    const c = this.L.cps[this.cp];
    return { gameVersion: VERSION, saveId: meta.saveId, roomCode: meta.roomCode || '', timestamp: new Date().toISOString(),
      host: pj(this.players[0], 0), guest: pj(this.players[1], 1),
      // 3rd/4th climbers ride alongside the original two keys so old saves still load.
      ...(this.n > 2 ? { party: this.players.slice(2).map((pl, k) => pj(pl, k + 2)) } : {}),
      chain: { maximumLength: this.chainLen, tension: +this.chain.tension.toFixed(3), state: this.chain.state },
      progress: { level: this.zone + 1, checkpointId: c.id, heightReached: +this.maxAlt.toFixed(2), elapsedTime: +this.elapsed.toFixed(2) },
      extra: { revision: ++this.revision, mode: this.mode, zoneName: this.L.zones[this.zone]?.name || '', level: this.level, falls: { total: this.fallsTotal, host: this.falls[0], guest: this.falls[1], ...(this.n > 2 ? { party: this.falls.slice(2) } : {}) }, relics: [...this.relics], checkpointsReached: [...this.cpReached], splits: this.splits, simTime: +this.t.toFixed(3), currentLength: +this.Le.toFixed(3), colors: meta.colors || null, skins: meta.skins || null, chainStyle: meta.chainStyle || null, victory: this.victory } };
  }
  fromSave(s) {
    // Saves carry which climb they belong to; rebuild that level before restoring anything else.
    const lv = levelOf(s.extra?.level || 'ascent').id;
    if (lv !== this.level) { this.level = lv; this.L = buildLevel(lv); this.world = this.L.world; }
    this.chainLen = Math.max(6, Math.min(12, s.chain.maximumLength)); this.Le = this.chainLen;
    const cpi = this.L.cps.findIndex(c => c.id === s.progress.checkpointId); this.cp = Math.max(0, cpi);
    this.respawn(this.cp, true);
    const put = (pl, j) => { pl.p.x = j.position.x; pl.p.y = j.position.y; pl.p.z = j.position.z; pl.v.x = j.velocity.x; pl.v.y = j.velocity.y; pl.v.z = j.velocity.z; pl.yaw = j.rotation.y; pl.lastGroundY = pl.p.y; };
    put(this.players[0], s.host); put(this.players[1], s.guest);
    const party = s.party || [];
    for (let i = 2; i < this.n; i++) if (party[i - 2]) put(this.players[i], party[i - 2]);
    this.names = [s.host.name, s.guest.name, ...party.map(j => j.name)].slice(0, this.n);
    this.ids = [s.host.playerId, s.guest.playerId, ...party.map(j => j.playerId)].slice(0, this.n);
    this.elapsed = s.progress.elapsedTime; this.maxAlt = s.progress.heightReached; this.zone = Math.max(0, Math.min(this.L.zones.length - 1, s.progress.level - 1)); this.zoneEnter[this.zone] = this.elapsed;
    const x = s.extra || {}; this.mode = x.mode || this.mode; this.revision = x.revision || 0; if (x.falls) { this.fallsTotal = x.falls.total || 0; this.falls = [x.falls.host || 0, x.falls.guest || 0, ...(x.falls.party || [])].slice(0, this.n); while (this.falls.length < this.n) this.falls.push(0); }
    this.relics = new Set(x.relics || []); for (const c of x.checkpointsReached || []) this.cpReached.add(c); for (let i = 0; i <= this.cp; i++) this.cpReached.add(i); this.splits = x.splits || [];
    if (typeof x.simTime === 'number') this.t = x.simTime; if (typeof x.currentLength === 'number') this.Le = Math.min(this.chainLen, x.currentLength);
    // a resumed position mid-air or inside a moving obstacle is unsafe: if nobody is supported, settle at the checkpoint
    this.state = 'play';
  }
}
export { P, ZONES, LEVELS };
