// The chain. Two separate pieces:
//  • tether(): the gameplay constraint, run ONLY by the authoritative simulation (host, or local same-screen).
//    It is a one-sided distance constraint between the two waists, solved with mass-like weights so an anchored
//    or braced player holds firm and an airborne player swings. Position and velocity corrections are capped and
//    damped, so nothing ever explodes.
//  • Rope: a Verlet rope hung between the two attach points for visuals (and for the rattle sound). It collides
//    with level geometry so it drapes over ledges instead of cutting through them.
import { P, waist } from './player.js';

export const CH = { minLen: 2.2, reelIn: 3.2, reelOut: 4.5, maxCorr: 0.45, slackAt: 0.72, warnAt: 0.9 };

export function weight(pl, inp) {
  if (pl.anchored) return 0;
  if (pl.reel) return 0.06;
  if (pl.grounded) { const moving = inp && Math.hypot(inp.f || 0, inp.s || 0) > 0.2; return pl.onHead ? 0.6 : moving ? 0.4 : 0.2; }
  return 1;
}

// returns {d, tension (0..1+), state, taut}
export function tether(A, B, Le, inA, inB, dt) {
  const a = waist(A), b = waist(B); let dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z; const d = Math.hypot(dx, dy, dz) || 1e-6;
  const ratio = d / Le, out = { d, tension: Math.max(0, Math.min(1.25, (ratio - CH.slackAt) / (1 - CH.slackAt))), state: ratio < CH.slackAt ? 'slack' : ratio < CH.warnAt ? 'tight' : 'taut', taut: false, nx: dx / d, ny: dy / d, nz: dz / d };
  if (d <= Le) return out;
  out.taut = true; out.state = d > Le * 1.08 ? 'strained' : 'taut';
  const nx = dx / d, ny = dy / d, nz = dz / d; let wA = weight(A, inA), wB = weight(B, inB), W = wA + wB;
  if (W < 1e-6) { wA = wB = 0.5; W = 1; } // both pinned (two anchors): split so it can never lock up
  const ex = Math.min(d - Le, CH.maxCorr) * 0.85;
  A.p.x += nx * ex * wA / W; A.p.y += ny * ex * wA / W; A.p.z += nz * ex * wA / W;
  B.p.x -= nx * ex * wB / W; B.p.y -= ny * ex * wB / W; B.p.z -= nz * ex * wB / W;
  // remove separating velocity along the chain (inelastic) and damp a little of the swing jitter
  const vrel = (B.v.x - A.v.x) * nx + (B.v.y - A.v.y) * ny + (B.v.z - A.v.z) * nz;
  if (vrel > 0) { const j = vrel * 1.02; A.v.x += nx * j * wA / W; A.v.y += ny * j * wA / W; A.v.z += nz * j * wA / W; B.v.x -= nx * j * wB / W; B.v.y -= ny * j * wB / W; B.v.z -= nz * j * wB / W; }
  // a grounded player being dragged loses footing if the pull is strong and mostly horizontal
  for (const [pl, s, w] of [[A, 1, wA], [B, -1, wB]]) if (pl.grounded && w > 0.1 && d - Le > 0.6) pl.dragged = (pl.dragged || 0) + dt; else pl.dragged = 0;
  return out;
}

// visual rope
export class Rope {
  constructor(n = 18) { this.n = n; this.p = []; this.o = []; for (let i = 0; i <= n; i++) { this.p.push({ x: 0, y: 0, z: 0 }); this.o.push({ x: 0, y: 0, z: 0 }); } this.init = false; this.motion = 0; }
  reset(a, b) { for (let i = 0; i <= this.n; i++) { const t = i / this.n; for (const k of ['x', 'y', 'z']) { this.p[i][k] = this.o[i][k] = a[k] + (b[k] - a[k]) * t; } this.p[i].y -= Math.sin(t * Math.PI) * 0.5; this.o[i].y = this.p[i].y; } this.init = true; }
  step(a, b, len, dt, world) {
    if (!this.init) this.reset(a, b);
    const n = this.n, seg = len / n, g = -16 * dt * dt; let mot = 0;
    for (let i = 1; i < n; i++) { const p = this.p[i], o = this.o[i]; const vx = (p.x - o.x) * 0.985, vy = (p.y - o.y) * 0.985, vz = (p.z - o.z) * 0.985; o.x = p.x; o.y = p.y; o.z = p.z; p.x += vx; p.y += vy + g; p.z += vz; mot += Math.abs(vx) + Math.abs(vy) + Math.abs(vz); }
    this.motion = mot / dt / n;
    const P0 = this.p[0], PN = this.p[n]; P0.x = a.x; P0.y = a.y; P0.z = a.z; PN.x = b.x; PN.y = b.y; PN.z = b.z;
    const direct = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), rest = Math.max(seg, direct / n * 1.0);
    for (let it = 0; it < 10; it++) {
      for (let i = 0; i < n; i++) {
        const p = this.p[i], q = this.p[i + 1]; const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, d = Math.hypot(dx, dy, dz) || 1e-6, e = (d - Math.max(seg, rest)) / d;
        if (e <= 0 && d > seg * 0.5) continue; // links are not rigid rods: they only resist stretching
        const wp = i === 0 ? 0 : 0.5, wq = i + 1 === n ? 0 : 0.5, ws = wp + wq || 1;
        p.x += dx * e * wp / ws; p.y += dy * e * wp / ws; p.z += dz * e * wp / ws; q.x -= dx * e * wq / ws; q.y -= dy * e * wq / ws; q.z -= dz * e * wq / ws;
      }
      if (world && (it & 3) === 3) for (let i = 1; i < n; i++) world.pushSphere(this.p[i], 0.07);
    }
  }
}
export const attach = pl => ({ x: pl.p.x, y: pl.p.y + P.waist, z: pl.p.z });
