// Collision world for TETHERED.
// Every solid is an oriented box (OBB). Static boxes live in a uniform grid; moving boxes (owned by obstacles)
// are tested every step. Characters are vertical capsules approximated by three stacked spheres, which keeps the
// solver simple, deterministic and identical on host and guest (needed for prediction). No external engine:
// see README "Why not Rapier" — the game needs one fixed-step authoritative solver that also runs in Node tests.

export const CELL = 8;

// rotation matrix (column axes) from Euler XYZ in radians
export function axesFromEuler(rx = 0, ry = 0, rz = 0, out = new Float64Array(9)) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  // R = Ry * Rx * Rz  (yaw, then pitch, then roll) — columns are the box's local X, Y, Z axes in world space
  const m00 = cy * cz + sy * sx * sz, m01 = -cy * sz + sy * sx * cz, m02 = sy * cx;
  const m10 = cx * sz, m11 = cx * cz, m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz, m21 = sy * sz + cy * sx * cz, m22 = cy * cx;
  out[0] = m00; out[1] = m10; out[2] = m20;
  out[3] = m01; out[4] = m11; out[5] = m21;
  out[6] = m02; out[7] = m12; out[8] = m22;
  return out;
}

export class Box {
  constructor(o) {
    this.id = o.id || null;
    this.c = { x: o.x || 0, y: o.y || 0, z: o.z || 0 };
    this.h = { x: o.w / 2, y: o.h / 2, z: o.d / 2 };
    this.rot = { x: o.rx || 0, y: o.ry || 0, z: o.rz || 0 };
    this.m = axesFromEuler(this.rot.x, this.rot.y, this.rot.z);
    this.mat = o.mat || 'stone';     // surface: stone, wood, metal, ice, belt, marble, snow, plate…
    this.ent = o.ent || null;        // owning obstacle (moving / stateful) or null
    this.solid = o.solid !== false;  // obstacles toggle this (vanishing platforms, fallen bridges)
    this.hazard = o.hazard || 0;     // knockback strength for hammers / beams / pistons
    this.belt = o.belt || null;      // conveyor surface velocity {x,z}
    this.vis = o.vis || null;        // render hints
    this.vel = { x: 0, y: 0, z: 0 };  // surface linear velocity (moving boxes)
    this.prevC = { ...this.c }; this.prevM = Float64Array.from(this.m);
    this.aabb = { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 };
    this.upright = true; this.updateAABB();
  }
  set(x, y, z, rx, ry, rz) {
    this.c.x = x; this.c.y = y; this.c.z = z;
    if (rx !== undefined) { this.rot.x = rx; this.rot.y = ry; this.rot.z = rz; axesFromEuler(rx, ry, rz, this.m); }
    this.updateAABB();
  }
  beginStep() { this.prevC.x = this.c.x; this.prevC.y = this.c.y; this.prevC.z = this.c.z; this.prevM.set(this.m); }
  endStep(dt) { this.vel.x = (this.c.x - this.prevC.x) / dt; this.vel.y = (this.c.y - this.prevC.y) / dt; this.vel.z = (this.c.z - this.prevC.z) / dt; }
  updateAABB() {
    const m = this.m, h = this.h, a = this.aabb;
    const ex = Math.abs(m[0]) * h.x + Math.abs(m[3]) * h.y + Math.abs(m[6]) * h.z;
    const ey = Math.abs(m[1]) * h.x + Math.abs(m[4]) * h.y + Math.abs(m[7]) * h.z;
    const ez = Math.abs(m[2]) * h.x + Math.abs(m[5]) * h.y + Math.abs(m[8]) * h.z;
    a.x0 = this.c.x - ex; a.x1 = this.c.x + ex; a.y0 = this.c.y - ey; a.y1 = this.c.y + ey; a.z0 = this.c.z - ez; a.z1 = this.c.z + ez;
    this.upright = Math.abs(m[4]) > 0.985;
  }
  top() { return this.c.y + this.h.y * this.m[4]; }
  // world point → local
  toLocal(px, py, pz, o) { const m = this.m, dx = px - this.c.x, dy = py - this.c.y, dz = pz - this.c.z; o.x = dx * m[0] + dy * m[1] + dz * m[2]; o.y = dx * m[3] + dy * m[4] + dz * m[5]; o.z = dx * m[6] + dy * m[7] + dz * m[8]; return o; }
  // carry: where a point riding this box moved since beginStep()
  carry(p) {
    const pm = this.prevM, m = this.m, dx = p.x - this.prevC.x, dy = p.y - this.prevC.y, dz = p.z - this.prevC.z;
    const lx = dx * pm[0] + dy * pm[1] + dz * pm[2], ly = dx * pm[3] + dy * pm[4] + dz * pm[5], lz = dx * pm[6] + dy * pm[7] + dz * pm[8];
    p.x = this.c.x + lx * m[0] + ly * m[3] + lz * m[6]; p.y = this.c.y + lx * m[1] + ly * m[4] + lz * m[7]; p.z = this.c.z + lx * m[2] + ly * m[5] + lz * m[8];
  }
  yawDelta() { const a0 = Math.atan2(this.prevM[6], this.prevM[8]), a1 = Math.atan2(this.m[6], this.m[8]); let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
}

const L = { x: 0, y: 0, z: 0 };
// sphere vs OBB. Writes contact to out {nx,ny,nz,pen}. Returns true on contact.
export function sphereBox(px, py, pz, r, b, out) {
  const a = b.aabb; if (px + r < a.x0 || px - r > a.x1 || py + r < a.y0 || py - r > a.y1 || pz + r < a.z0 || pz - r > a.z1) return false;
  b.toLocal(px, py, pz, L); const h = b.h;
  const qx = Math.max(-h.x, Math.min(h.x, L.x)), qy = Math.max(-h.y, Math.min(h.y, L.y)), qz = Math.max(-h.z, Math.min(h.z, L.z));
  let dx = L.x - qx, dy = L.y - qy, dz = L.z - qz; const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > r * r) return false;
  let nx, ny, nz, pen;
  if (d2 > 1e-10) { const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; nz = dz / d; pen = r - d; }
  else { // centre inside the box: leave through the nearest face
    const fx = h.x - Math.abs(L.x), fy = h.y - Math.abs(L.y), fz = h.z - Math.abs(L.z);
    if (fy <= fx && fy <= fz) { nx = 0; ny = L.y >= 0 ? 1 : -1; nz = 0; pen = fy + r; }
    else if (fx <= fz) { nx = L.x >= 0 ? 1 : -1; ny = 0; nz = 0; pen = fx + r; }
    else { nx = 0; ny = 0; nz = L.z >= 0 ? 1 : -1; pen = fz + r; }
  }
  const m = b.m;
  out.nx = nx * m[0] + ny * m[3] + nz * m[6]; out.ny = nx * m[1] + ny * m[4] + nz * m[7]; out.nz = nx * m[2] + ny * m[5] + nz * m[8]; out.pen = pen;
  return true;
}

// ray vs OBB, returns distance or Infinity
export function rayBox(ox, oy, oz, dx, dy, dz, maxT, b) {
  const m = b.m, rx = ox - b.c.x, ry = oy - b.c.y, rz = oz - b.c.z; let t0 = 0, t1 = maxT;
  for (let k = 0; k < 3; k++) {
    const ax = m[k * 3], ay = m[k * 3 + 1], az = m[k * 3 + 2], e = k === 0 ? b.h.x : k === 1 ? b.h.y : b.h.z;
    const o = rx * ax + ry * ay + rz * az, d = dx * ax + dy * ay + dz * az;
    if (Math.abs(d) < 1e-9) { if (o < -e || o > e) return Infinity; continue; }
    let ta = (-e - o) / d, tb = (e - o) / d; if (ta > tb) { const s = ta; ta = tb; tb = s; }
    if (ta > t0) t0 = ta; if (tb < t1) t1 = tb; if (t0 > t1) return Infinity;
  }
  return t0;
}

export class World {
  constructor() { this.static = []; this.dynamic = []; this.grid = new Map(); this.stamp = 0; this._q = []; }
  key(i, j, k) { return (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512); }
  addStatic(b) { this.static.push(b); b._s = 0; const a = b.aabb;
    for (let i = Math.floor(a.x0 / CELL); i <= Math.floor(a.x1 / CELL); i++) for (let j = Math.floor(a.y0 / CELL); j <= Math.floor(a.y1 / CELL); j++) for (let k = Math.floor(a.z0 / CELL); k <= Math.floor(a.z1 / CELL); k++) {
      const key = this.key(i, j, k); let c = this.grid.get(key); if (!c) this.grid.set(key, c = []); c.push(b); } return b; }
  addDynamic(b) { b._i = this.dynamic.length; this.dynamic.push(b); b._s = 0; return b; }
  // candidates overlapping an AABB
  query(x0, y0, z0, x1, y1, z1) {
    const out = this._q; out.length = 0; const s = ++this.stamp;
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(y0 / CELL); j <= Math.floor(y1 / CELL); j++) for (let k = Math.floor(z0 / CELL); k <= Math.floor(z1 / CELL); k++) {
      const c = this.grid.get(this.key(i, j, k)); if (!c) continue;
      for (const b of c) { if (b._s === s) continue; b._s = s; const a = b.aabb; if (a.x1 < x0 || a.x0 > x1 || a.y1 < y0 || a.y0 > y1 || a.z1 < z0 || a.z0 > z1) continue; out.push(b); } }
    for (const b of this.dynamic) { if (!b.solid) continue; const a = b.aabb; if (a.x1 < x0 || a.x0 > x1 || a.y1 < y0 || a.y0 > y1 || a.z1 < z0 || a.z0 > z1) continue; out.push(b); }
    return out;
  }
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const x1 = ox + dx * maxT, y1 = oy + dy * maxT, z1 = oz + dz * maxT;
    const c = this.query(Math.min(ox, x1), Math.min(oy, y1), Math.min(oz, z1), Math.max(ox, x1), Math.max(oy, y1), Math.max(oz, z1));
    let best = maxT, hit = null; for (const b of c) { if (!b.solid) continue; const t = rayBox(ox, oy, oz, dx, dy, dz, best, b); if (t < best) { best = t; hit = b; } }
    return { t: best, box: hit };
  }
  // used by the rope: push a small sphere out of geometry
  pushSphere(p, r) { const c = this.query(p.x - r, p.y - r, p.z - r, p.x + r, p.y + r, p.z + r); const o = {}; let hit = false;
    for (const b of c) { if (!b.solid) continue; if (sphereBox(p.x, p.y, p.z, r, b, o)) { p.x += o.nx * o.pen; p.y += o.ny * o.pen; p.z += o.nz * o.pen; hit = true; } } return hit; }
}
