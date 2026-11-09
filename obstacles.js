// Obstacles and co-op devices. Each one owns dynamic Boxes and exposes:
//   update(t, dt, sim, auth)  — auth=true on the authoritative side (host / local); replicas only pose geometry
//   pack() / unpack(a)        — stateful obstacles only: compact state for snapshots and save files
//   reset()                   — called on respawn so bridges, crumbling tiles etc. are whole again
// Deterministic obstacles (movers, rotors, hammers, doors, vanishing tiles, icicles, wind) are pure functions of
// the shared simulation clock t, so host and guest agree without sending them at all.
import { Box } from './physics.js';

const ease = x => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);
const TAU = Math.PI * 2;

class Ob {
  constructor(id, type, fr) { this.id = id; this.type = type; this.fr = fr; this.boxes = []; this.stateful = false; }
  box(o) { const b = new Box({ ...o, ent: this }); this.boxes.push(b); return b; }
  update() { } reset() { } pack() { return null; } unpack() { }
  // which players stand on one of our boxes
  riders(sim) { const r = []; for (const pl of sim.players) if (pl.grounded && pl.gbox && pl.gbox.ent === this) r.push(pl); return r; }
}

// world-space helpers from a zone frame
function W(fr, x, y, z) { return fr.pt(x, y, z); }

export class Mover extends Ob { // platform ping-pong between a and b (local coords), period seconds
  constructor(id, fr, o) { super(id, 'mover', fr); this.a = W(fr, ...o.a); this.b = W(fr, ...o.b); this.T = o.period || 6; this.ph = o.phase || 0; this.hold = o.hold ?? 0.18;
    this.b0 = this.box({ x: this.a.x, y: this.a.y, z: this.a.z, w: o.w, h: o.h || 0.8, d: o.d, ry: fr.yaw, mat: o.mat || 'metal', vis: o.vis }); }
  u(t) { const x = ((t / this.T + this.ph) % 1 + 1) % 1, h = this.hold; const k = x < 0.5 ? (x - h / 2) / (0.5 - h) : 1 - (x - 0.5 - h / 2) / (0.5 - h); return ease(k); }
  update(t) { const k = this.u(t), a = this.a, b = this.b; this.b0.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k); }
}

export class Rotor extends Ob { // spinning disc and/or sweeper arm about a vertical axis
  constructor(id, fr, o) { super(id, 'rotor', fr); this.c = W(fr, ...o.c); this.w = o.speed; this.parts = [];
    for (const p of o.parts) { const b = this.box({ x: 0, y: 0, z: 0, w: p.w, h: p.h, d: p.d, mat: p.mat || 'metal', hazard: p.hazard || 0, vis: p.vis }); this.parts.push({ b, oy: p.y, r: p.r || 0, a0: p.a0 || 0, spin: p.spin ?? 1 }); }
    this.update(0); }
  update(t) { for (const p of this.parts) { const a = this.fr.yaw + p.a0 + t * this.w * p.spin; const x = this.c.x + Math.sin(a) * p.r, z = this.c.z + Math.cos(a) * p.r; p.b.set(x, this.c.y + p.oy, z, 0, a, 0); } }
}

export class Hammer extends Ob { // pendulum: pivot, swinging across the local X axis
  constructor(id, fr, o) { super(id, 'hammer', fr); this.pv = W(fr, ...o.pivot); this.len = o.len; this.amp = o.amp || 1.15; this.T = o.period || 2.8; this.ph = o.phase || 0;
    this.arm = this.box({ x: 0, y: 0, z: 0, w: 0.28, h: o.len, d: 0.28, mat: 'wood', vis: 'arm', solid: true });
    this.head = this.box({ x: 0, y: 0, z: 0, w: o.hw || 1.1, h: o.hh || 1.1, d: o.hd || 2.0, mat: 'metal', hazard: o.hazard || 10, vis: 'hammer' }); this.update(0); }
  angle(t) { return this.amp * Math.sin((t / this.T + this.ph) * TAU); }
  update(t) { const a = this.angle(t), yaw = this.fr.yaw, s = Math.sin(a), c = Math.cos(a);
    // swing in the plane spanned by world up and the zone's local X axis
    const ax = Math.cos(yaw), az = -Math.sin(yaw); const at = (r) => ({ x: this.pv.x + ax * s * r, y: this.pv.y - c * r, z: this.pv.z + az * s * r });
    const m = at(this.len / 2), h = at(this.len); this.arm.set(m.x, m.y, m.z, 0, yaw, a); this.head.set(h.x, h.y, h.z, 0, yaw, a); }
}

export class Door extends Ob { // timed door / crusher: slides between closed and open on a cycle
  constructor(id, fr, o) { super(id, 'door', fr); this.cl = W(fr, ...o.closed); this.op = W(fr, ...o.open); this.T = o.period || 5; this.openFor = o.openFor || 2; this.ph = o.phase || 0; this.tr = o.travel || 0.35;
    this.b0 = this.box({ ...this.cl, w: o.w, h: o.h, d: o.d, ry: fr.yaw, mat: o.mat || 'metal', hazard: o.hazard || 0, vis: o.vis || 'door' }); }
  k(t) { const x = ((t / this.T + this.ph) % 1 + 1) % 1 * this.T, tr = this.tr; if (x < tr) return ease(x / tr); if (x < tr + this.openFor) return 1; if (x < 2 * tr + this.openFor) return 1 - ease((x - tr - this.openFor) / tr); return 0; }
  warn(t) { const x = ((t / this.T + this.ph) % 1 + 1) % 1 * this.T; return x > this.tr + this.openFor - 0.7 && x < this.tr + this.openFor; }
  update(t) { const k = this.k(t), a = this.cl, b = this.op; this.b0.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k); }
}

export class Vanish extends Ob { // tiles that disappear on a cycle (group 0/1 alternate), flickering before they go
  constructor(id, fr, o) { super(id, 'vanish', fr); this.T = o.period || 5; this.ph = o.group ? 0.5 : 0; this.b0 = this.box({ ...W(fr, ...o.at), w: o.w, h: o.h || 0.6, d: o.d, ry: fr.yaw, mat: 'crystal', vis: 'vanish' }); }
  phase(t) { return ((t / this.T + this.ph) % 1 + 1) % 1; }
  update(t) { const x = this.phase(t); this.b0.solid = x < 0.6; this.state = x < 0.6 ? (x > 0.43 ? 'warn' : 'on') : 'off'; }
}

export class Sway extends Ob { // balance beam rocking about its long axis
  constructor(id, fr, o) { super(id, 'sway', fr); this.at = W(fr, ...o.at); this.amp = o.amp || 0.1; this.T = o.period || 3.2; this.b0 = this.box({ ...this.at, w: o.w, h: o.h || 0.4, d: o.d, ry: fr.yaw, mat: o.mat || 'ice', vis: 'beam' }); }
  update(t) { this.b0.set(this.at.x, this.at.y, this.at.z, 0, this.fr.yaw, this.amp * Math.sin(t / this.T * TAU)); }
}

export class Icicle extends Ob { // drops from a ceiling on a fixed schedule; shadow warning on the floor
  constructor(id, fr, o) { super(id, 'icicle', fr); this.top = W(fr, ...o.at); this.floor = o.floor; this.T = o.period || 4; this.ph = o.phase || 0; this.drop = this.top.y - (W(fr, 0, o.floor, 0).y);
    this.b0 = this.box({ ...this.top, w: 0.7, h: 1.6, d: 0.7, mat: 'ice', hazard: 7, vis: 'icicle' }); this.fy = W(fr, 0, o.floor, 0).y; }
  phase(t) { return ((t / this.T + this.ph) % 1 + 1) % 1 * this.T; }
  update(t) { const x = this.phase(t), fall = 0.9; let y; this.warn = x > this.T - 1.1; if (x < fall) { const tt = x; y = this.top.y - 0.5 * 30 * tt * tt; } else y = this.top.y + 50;
    if (y < this.fy + 0.8) { y = this.top.y + 50; } this.b0.solid = x < fall && y < this.top.y + 10; this.b0.set(this.top.x, y, this.top.z); this.shadow = this.warn || x < fall; }
}

// ───── stateful ─────
export class FallTile extends Ob { // crumbles 0.7 s after someone lands, falls, respawns
  constructor(id, fr, o) { super(id, 'fall', fr); this.stateful = true; this.home = W(fr, ...o.at); this.delay = o.delay || 0.7; this.back = o.back || 4.5; this.s = 0; this.k = 0; this.y = 0;
    this.b0 = this.box({ ...this.home, w: o.w, h: o.h || 0.9, d: o.d, ry: fr.yaw, mat: o.mat || 'stone', vis: 'crumble' }); }
  update(t, dt, sim, auth) {
    if (auth) { if (this.s === 0 && this.riders(sim).length) { this.s = 1; this.k = 0; sim.ev('crack', this.home); } else if (this.s === 1) { this.k += dt; if (this.k > this.delay) { this.s = 2; this.k = 0; this.vy = 0; } }
      else if (this.s === 2) { this.k += dt; if (this.k > this.back) { this.s = 0; this.k = 0; } } }
    const shake = this.s === 1 ? Math.sin(this.k * 70) * 0.05 : 0; const dy = this.s === 2 ? -0.5 * 20 * Math.min(this.k, 2.5) ** 2 : 0;
    this.b0.solid = !(this.s === 2 && this.k > 1.6); this.b0.set(this.home.x + shake, this.home.y + dy, this.home.z); }
  reset() { this.s = 0; this.k = 0; } pack() { return [this.s, +this.k.toFixed(2)]; } unpack(a) { this.s = a[0]; this.k = a[1]; }
}

export class Bridge extends Ob { // collapsing bridge: first footstep starts a sequential collapse
  constructor(id, fr, o) { super(id, 'bridge', fr); this.stateful = true; this.n = o.n; this.s = 0; this.k = 0; this.first = o.first || 0.9; this.each = o.each || 0.3; this.homes = [];
    const len = o.len, seg = len / o.n; for (let i = 0; i < o.n; i++) { const h = W(fr, o.x, o.top - 0.25, o.z0 + seg * (i + 0.5)); this.homes.push(h); this.box({ ...h, w: o.w, h: 0.5, d: seg - 0.06, ry: fr.yaw, mat: 'wood', vis: 'plank' }); } }
  update(t, dt, sim, auth) {
    if (auth) { if (this.s === 0 && this.riders(sim).length) { this.s = 1; this.k = 0; sim.ev('creak', this.homes[0]); } else if (this.s === 1) { this.k += dt; if (this.k > this.first + this.each * this.n + 3) { this.s = 2; } } }
    for (let i = 0; i < this.n; i++) { const b = this.boxes[i], h = this.homes[i]; const ft = this.s === 1 ? this.k - this.first - this.each * i : this.s === 2 ? 99 : -1;
      const shake = this.s === 1 && ft > -0.35 && ft < 0 ? Math.sin(ft * 90 + i) * 0.04 : 0; const dy = ft > 0 ? -0.5 * 22 * Math.min(ft, 2.2) ** 2 : 0;
      b.solid = !(ft > 1.2); b.set(h.x + shake, h.y + dy, h.z, ft > 0 ? Math.min(ft, 2) * 0.6 * (i % 2 ? 1 : -1) : 0, this.fr.yaw, 0); }
  }
  reset() { this.s = 0; this.k = 0; } pack() { return [this.s, +this.k.toFixed(2)]; } unpack(a) { this.s = a[0]; this.k = a[1]; }
}

export class Lift extends Ob { // elevator / ferry: travels a→b while its condition holds, returns when empty
  constructor(id, fr, o) { super(id, o.ferry ? 'ferry' : 'elevator', fr); this.stateful = true; this.a = W(fr, ...o.a); this.b = W(fr, ...o.b); this.speed = o.speed || 2.5; this.need = o.need || 1; this.u = 0; this.wait = 0;
    this.len = Math.hypot(this.b.x - this.a.x, this.b.y - this.a.y, this.b.z - this.a.z); this.b0 = this.box({ ...this.a, w: o.w, h: o.h || 0.6, d: o.d, ry: fr.yaw, mat: 'metal', vis: o.ferry ? 'ferry' : 'lift' }); this.dir = 0; }
  update(t, dt, sim, auth) {
    if (auth) { const n = this.riders(sim).length; this.ready = n; if (n >= this.need) { this.wait = 1.6; this.dir = 1; } else if (this.u > 0) { this.wait -= dt; this.dir = this.wait > 0 ? 0 : -1; } else this.dir = 0;
      const prev = this.u; this.u = Math.max(0, Math.min(1, this.u + this.dir * this.speed * dt / this.len)); if (prev === 0 && this.u > 0) sim.ev('lift', this.a); }
    const k = ease(this.u) * 0.35 + this.u * 0.65, a = this.a, b = this.b; this.b0.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k); }
  reset() { this.u = 0; this.wait = 0; this.dir = 0; } pack() { return [+this.u.toFixed(4), this.dir, this.ready || 0]; } unpack(a) { this.u = a[0]; this.dir = a[1]; this.ready = a[2]; }
}

export class LeverBridge extends Ob { // retractable bridge that only extends while somebody holds one of its levers
  constructor(id, fr, o) { super(id, 'lever', fr); this.stateful = true; this.levers = o.levers.map(l => W(fr, ...l)); this.held = [0, 0]; this.u = 0; this.grace = 0;
    this.out = W(fr, ...o.out); this.inn = W(fr, ...o.inn); this.b0 = this.box({ ...this.inn, w: o.w, h: 0.45, d: o.d, ry: fr.yaw, mat: 'metal', vis: 'leverbridge' });
    for (const l of this.levers) this.box({ ...l, y: l.y + 0.5, w: 0.3, h: 1.0, d: 0.3, ry: fr.yaw, mat: 'metal', vis: 'leverpost' }); }
  update(t, dt, sim, auth) {
    if (auth) { const any = this.held[0] || this.held[1]; if (any) this.grace = 0.7; else this.grace -= dt; const tgt = this.grace > 0 ? 1 : 0; const prev = this.u; this.u += Math.sign(tgt - this.u) * Math.min(Math.abs(tgt - this.u), dt * (tgt ? 0.8 : 0.45)); if (prev < 0.02 && this.u >= 0.02) sim.ev('bridge', this.out); }
    const a = this.inn, b = this.out, k = this.u; this.b0.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k); }
  reset() { this.u = 0; this.held = [0, 0]; this.grace = 0; } pack() { return [+this.u.toFixed(3), this.held[0], this.held[1]]; } unpack(a) { this.u = a[0]; this.held = [a[1], a[2]]; }
}

export class Plates extends Ob { // two pressure plates → latch a gate open
  constructor(id, fr, o) { super(id, 'plates', fr); this.stateful = true; this.pl = o.plates.map(p => W(fr, ...p)); this.size = 1.6; this.on = [0, 0]; this.k = 0; this.open = 0;
    for (const p of this.pl) this.box({ ...p, y: p.y + 0.06, w: this.size, h: 0.12, d: this.size, ry: fr.yaw, mat: 'plate', vis: 'plate', solid: false });
    this.gc = W(fr, ...o.gate); this.go = { ...this.gc, y: this.gc.y + o.gh + 0.2 }; this.gate = this.box({ ...this.gc, w: o.gw, h: o.gh, d: 0.6, ry: fr.yaw, mat: 'metal', vis: 'gate' }); }
  update(t, dt, sim, auth) {
    if (auth) { this.on = this.pl.map(p => sim.players.some(pl => pl.grounded && Math.abs(pl.p.x - p.x) < this.size / 2 + 0.15 && Math.abs(pl.p.z - p.z) < this.size / 2 + 0.15 && Math.abs(pl.p.y - p.y) < 0.6) ? 1 : 0);
      if (!this.open) { if (this.on[0] && this.on[1]) { this.k += dt; if (this.k > 0.6) { this.open = 1; sim.ev('gate', this.gc); } } else this.k = 0; } }
    const g = this.gate, tgt = this.open ? 1 : 0; this.gk = (this.gk || 0) + (tgt - (this.gk || 0)) * Math.min(1, dt * 3); const k = this.gk;
    g.set(this.gc.x, this.gc.y + (this.go.y - this.gc.y) * k, this.gc.z); g.solid = k < 0.85; }
  reset() { this.on = [0, 0]; this.k = 0; this.open = 0; this.gk = 0; } pack() { return [this.on[0], this.on[1], this.open]; } unpack(a) { this.on = [a[0], a[1]]; this.open = a[2]; }
}

export class Drums extends Ob { // sync-jump pads: both leave their pads within 0.45 s → big launch
  constructor(id, fr, o) { super(id, 'drums', fr); this.stateful = true; this.pads = o.pads.map(p => W(fr, ...p)); this.r = 1.1; this.v = o.v || 20; this.fwd = o.fwd || [0, 0, 3.4]; this.lit = [0, 0]; this.flash = 0;
    const f = o.fwd || [0, 0, 3.4], c = Math.cos(fr.yaw), s = Math.sin(fr.yaw); this.fv = { x: f[0] * c + f[2] * s, z: -f[0] * s + f[2] * c };
    for (const p of this.pads) this.box({ ...p, y: p.y + 0.15, w: 2.0, h: 0.3, d: 2.0, ry: fr.yaw, mat: 'drum', vis: 'drum' }); this.lastJump = [-9, -9]; this.who = [null, null]; }
  padOf(pl) { for (let i = 0; i < 2; i++) { const p = this.pads[i]; if (Math.hypot(pl.p.x - p.x, pl.p.z - p.z) < this.r + 0.2 && Math.abs(pl.p.y - (p.y + 0.3)) < 0.5) return i; } return -1; }
  onJump(pl, sim) { const i = this.padOf(pl); if (i < 0) return; this.lastJump[i] = sim.t; this.who[i] = pl; const j = 1 - i;
    if (this.who[j] && this.who[j] !== pl && sim.t - this.lastJump[j] < 0.45) { for (const q of [pl, this.who[j]]) { q.v.y = this.v; q.v.x = this.fv.x; q.v.z = this.fv.z; q.launch = 1.0; q.jumping = false; } this.flash = 1; sim.ev('launch', this.pads[0]); this.who = [null, null]; this.lastJump = [-9, -9]; } }
  update(t, dt, sim, auth) { if (auth) this.lit = [0, 1].map(i => sim.players.some(pl => pl.grounded && this.padOf(pl) === i) ? 1 : 0); this.flash = Math.max(0, this.flash - dt * 2); }
  reset() { this.lit = [0, 0]; this.lastJump = [-9, -9]; this.who = [null, null]; } pack() { return [this.lit[0], this.lit[1], +this.flash.toFixed(2)]; } unpack(a) { this.lit = [a[0], a[1]]; this.flash = a[2]; }
}

export class Wind { // deterministic gusting wind volume (axis-aligned in world)
  constructor(id, fr, o) { this.id = id; this.type = 'wind'; const a = fr.pt(o.x0, o.y0, o.z0), b = fr.pt(o.x1, o.y1, o.z1); this.x0 = Math.min(a.x, b.x); this.x1 = Math.max(a.x, b.x); this.y0 = Math.min(a.y, b.y); this.y1 = Math.max(a.y, b.y); this.z0 = Math.min(a.z, b.z); this.z1 = Math.max(a.z, b.z);
    const c = Math.cos(fr.yaw), s = Math.sin(fr.yaw); this.dir = { x: o.dir[0] * c + o.dir[1] * s, z: -o.dir[0] * s + o.dir[1] * c }; this.base = o.base || 1; this.gust = o.gust || 10; this.T = o.period || 4.5; this.len = o.len || 1.6; this.ph = o.phase || 0; }
  inside(p) { return p.x > this.x0 && p.x < this.x1 && p.y > this.y0 && p.y < this.y1 && p.z > this.z0 && p.z < this.z1; }
  strength(t) { const x = ((t / this.T + this.ph) % 1 + 1) % 1 * this.T, L = this.len; const g = x < L ? Math.sin(x / L * Math.PI) : 0; return this.base + this.gust * g; }
  warn(t) { const x = ((t / this.T + this.ph) % 1 + 1) % 1 * this.T; return x > this.T - 0.9 || x < this.len; }
  update() { } reset() { } pack() { return null; }
}
