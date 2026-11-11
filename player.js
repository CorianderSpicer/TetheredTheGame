// Third-person character controller. Pure data in, pure data out — the host, the guest's prediction and the
// Node tests all run exactly this code at the fixed 60 Hz step.
import { sphereBox } from './physics.js';

export const P = {
  r: 0.38, height: 1.72, waist: 0.95,
  g: -24, term: -42, jumpV: 9.0, jumpCut: 0.5,
  walk: 5.2, sprint: 7.8, reelWalk: 1.4,
  accG: 46, decG: 54, accIce: 7, decIce: 2.2, accAir: 15,
  coyote: 0.12, buffer: 0.13, groundNy: 0.55,
  stepUp: 0.42, mantleUp: 1.05, mantleV: 6.2,
};
const SPH = [P.r, 0.86, P.height - P.r]; // sphere centre heights above the feet

export function newPlayer(id, x, y, z, yaw = 0) {
  return {
    id, p: { x, y, z }, v: { x: 0, y: 0, z: 0 }, yaw, grounded: false, gbox: null, gmat: 'stone', groundNy: 1,
    coyote: 0, buf: 0, lastJp: 0, lastUp: 0, jumping: false, onHead: false, headOf: null,
    anim: 'idle', animT: 0, landT: 0, airT: 0, climbT: 0, lastGroundY: y, stun: 0,
    anchored: null, reel: false, wall: null, wallTop: 0, sprinting: false, speed: 0,
    danger: false, fell: 0, jumpedAt: -9, launch: 0, moved: 0, bodyPush: null,
  };
}

const C = { nx: 0, ny: 0, nz: 0, pen: 0 }, ZV = { x: 0, y: 0, z: 0 };
// one fixed step. input: {f,s,yaw,sprint,jump(held),jp(press counter),use(held)}; env: {world, t, wind(p)->vec, dt}
export function stepPlayer(pl, inp, env) {
  const dt = env.dt, W = env.world;
  pl.animT += dt; if (pl.stun > 0) pl.stun -= dt; if (pl.landT > 0) pl.landT -= dt; if (pl.launch > 0) pl.launch -= dt;
  // ride whatever we stood on last step (moving platforms, rotating discs, elevators)
  if (pl.grounded && pl.gbox && pl.gbox.ent) { pl.gbox.carry(pl.p); pl.yaw += pl.gbox.yawDelta(); }
  if (pl.grounded && pl.gbox && pl.gbox.belt) { pl.p.x += pl.gbox.belt.x * dt; pl.p.z += pl.gbox.belt.z * dt; }

  const ice = pl.grounded && pl.gmat === 'ice';
  let f = inp.f || 0, s = inp.s || 0; const len = Math.hypot(f, s); if (len > 1) { f /= len; s /= len; }
  if (pl.stun > 0 || pl.anchored) { f = 0; s = 0; }
  const cy = Math.cos(inp.yaw || 0), sy = Math.sin(inp.yaw || 0);
  // camera yaw convention: forward = (-sin yaw, -cos yaw), right = (cos yaw, -sin yaw)
  const dx = -sy * f + cy * s, dz = -cy * f - sy * s, mag = Math.hypot(dx, dz);
  pl.sprinting = !!inp.sprint && mag > 0.2 && !pl.reel;
  const top = pl.reel ? P.reelWalk : pl.sprinting ? P.sprint : P.walk;
  const tx = dx * top, tz = dz * top;
  if (pl.grounded) {
    const acc = mag > 0.05 ? (ice ? P.accIce : P.accG) : (ice ? P.decIce : P.decG);
    const ex = tx - pl.v.x, ez = tz - pl.v.z, el = Math.hypot(ex, ez), mx = acc * dt;
    if (el > mx) { pl.v.x += ex / el * mx; pl.v.z += ez / el * mx; } else { pl.v.x = tx; pl.v.z = tz; }
  } else if (mag <= 0.05) {
    // no stick in the air: gentle drag so small landings are controllable (but never while the chain is swinging you)
    if (!pl.tautAir && pl.launch <= 0) { const hs = Math.hypot(pl.v.x, pl.v.z), k = hs > 1e-4 ? Math.max(0, hs - 5 * dt) / hs : 0; pl.v.x *= k; pl.v.z *= k; }
  } else {
    // air control never brakes momentum you already have (swings, launches); it adds speed up to the run speed
    // along the stick direction and trims sideways drift only at normal jump speeds
    const ux = dx / mag, uz = dz / mag, along = pl.v.x * ux + pl.v.z * uz, hs = Math.hypot(pl.v.x, pl.v.z);
    if (along < top * mag) { const k = Math.min(P.accAir * dt, top * mag - along); pl.v.x += ux * k; pl.v.z += uz * k; }
    if (hs < top * 1.15) { const lx = pl.v.x - ux * along, lz = pl.v.z - uz * along, ll = Math.hypot(lx, lz); if (ll > 1e-4) { const k = Math.min(ll, P.accAir * 0.6 * dt) / ll; pl.v.x -= lx * k; pl.v.z -= lz * k; } }
  }
  if (mag > 0.05 && !pl.anchored) { const want = Math.atan2(-dx, -dz); let d = want - pl.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; pl.yaw += d * Math.min(1, dt * (pl.grounded ? 14 : 6)); }

  // wind zones and other ambient forces
  // wind: shoves airborne players; drags grounded ones along (friction can't cancel it — brace or walk into it)
  const w = env.wind ? env.wind(pl.p) : null; if (w) { if (pl.grounded) { const k = ice ? 0.4 : 0.25; pl.p.x += w.x * k * dt; pl.p.z += w.z * k * dt; } else { pl.v.x += w.x * dt; pl.v.y += (w.y || 0) * dt; pl.v.z += w.z * dt; } }

  // jump: buffered press + coyote time; releasing early cuts the arc (adjustable height)
  if ((inp.jp || 0) !== pl.lastJp) { pl.lastJp = inp.jp || 0; pl.buf = P.buffer; }
  if (pl.buf > 0) pl.buf -= dt;
  if (pl.grounded) pl.coyote = P.coyote; else if (pl.coyote > 0) pl.coyote -= dt;
  if (pl.buf > 0 && pl.coyote > 0 && pl.stun <= 0 && !pl.anchored && !pl.reel) {
    const up = pl.gbox && pl.gbox.ent ? Math.max(0, pl.gbox.vel.y) : 0;
    pl.v.y = P.jumpV + up * 0.6; pl.buf = 0; pl.coyote = 0; pl.grounded = false; pl.jumping = true; pl.jumpedAt = env.t; pl.anim = 'jump'; pl.animT = 0; env.ev?.('jump', pl);
  }
  if (pl.jumping && !inp.jump && pl.v.y > 2 && pl.launch <= 0) { pl.v.y *= P.jumpCut; pl.jumping = false; }
  if (pl.v.y <= 0) pl.jumping = false;

  // mantle / climb: pushing into a ledge whose top is within reach lifts the character over it
  if (pl.climbT > 0) { pl.climbT -= dt; pl.v.y = Math.max(pl.v.y, P.mantleV); if (pl.wall) { pl.v.x -= pl.wall.nx * 3 * dt * 6; pl.v.z -= pl.wall.nz * 3 * dt * 6; } }
  else if (pl.wall && !pl.grounded && mag > 0.3 && pl.stun <= 0 && !pl.anchored) {
    const into = -(dx * pl.wall.nx + dz * pl.wall.nz) / mag, h = pl.wallTop - pl.p.y;
    if (into > 0.45 && h > 0.25 && h < P.mantleUp && pl.v.y < 5) { pl.climbT = Math.min(0.35, (h + 0.25) / P.mantleV + 0.05); pl.anim = 'climb'; pl.animT = 0; env.ev?.('climb', pl); }
  }
  if (pl.assist > 0) { pl.assist -= dt; if (pl.wall) { pl.v.y = Math.max(pl.v.y, 4.2); pl.anim = 'climb'; } }

  pl.v.y = Math.max(P.term, pl.v.y + P.g * dt);
  if (pl.grounded && !pl.jumping && pl.v.y < 0) pl.p.y -= 0.05; // stick to the floor over small dips & descending lifts

  // integrate with sub-steps so nothing tunnels through thin platforms
  const sp = Math.hypot(pl.v.x, pl.v.y, pl.v.z), n = Math.min(4, 1 + Math.floor(sp * dt / 0.22)), h = dt / n;
  const wasGround = pl.grounded, vyBefore = pl.v.y; pl.grounded = false; pl.gbox = null; pl.wall = null; pl.onHead = false; pl.headOf = null;
  for (let k = 0; k < n; k++) { pl.p.x += pl.v.x * h; pl.p.y += pl.v.y * h; pl.p.z += pl.v.z * h; collide(pl, W, env); }
  if (env.others) for (const o of env.others) bodyContact(pl, o);
  if (pl.grounded) { pl.lastGroundY = pl.p.y; pl.airT = 0; } else pl.airT += dt;

  // animation state
  const hs = Math.hypot(pl.v.x, pl.v.z); pl.speed = hs;
  if (pl.grounded && !wasGround && vyBefore < -6) { pl.landT = Math.min(0.32, -vyBefore / 50); env.ev?.('land', pl, -vyBefore); }
  let a;
  if (pl.anchored) a = 'anchor'; else if (pl.climbT > 0 || (pl.assist > 0 && pl.wall)) a = 'climb';
  else if (pl.grounded) a = pl.reel ? 'reel' : pl.landT > 0.05 ? 'land' : hs > 6.3 ? 'run' : hs > 0.6 ? 'walk' : 'idle';
  else a = env.hanging?.(pl) ? 'hang' : pl.v.y > 0.5 ? 'jump' : 'fall';
  if (a !== pl.anim) { pl.anim = a; pl.animT = 0; }
  pl.moved += hs * dt;
}

function collide(pl, W, env) {
  const p = pl.p, r = P.r;
  const cand = W.query(p.x - r - 0.1, p.y - 0.1, p.z - r - 0.1, p.x + r + 0.1, p.y + P.height + 0.1, p.z + r + 0.1);
  for (let it = 0; it < 3; it++) {
    let any = false;
    for (let si = 0; si < 3; si++) {
      for (const b of cand) {
        if (!b.solid) continue;
        if (!sphereBox(p.x, p.y + SPH[si], p.z, r, b, C)) continue;
        any = true;
        // horizontal hit near the feet on a low ledge → step up instead of stopping
        if (si === 0 && C.ny < 0.3 && C.ny > -0.3 && b.upright && (pl.grounded || pl.coyote > 0)) {
          const lift = b.top() - p.y; if (lift > 0 && lift < P.stepUp) { p.y += lift + 0.001; continue; }
        }
        p.x += C.nx * C.pen; p.y += C.ny * C.pen; p.z += C.nz * C.pen;
        // floors move us by carrying (see top of stepPlayer), so ground contacts use absolute velocity;
        // walls / ceilings of moving boxes use relative velocity so they shove the player
        const ground = C.ny > P.groundNy, bv = ground ? ZV : b.vel, rvx = pl.v.x - bv.x, rvy = pl.v.y - bv.y, rvz = pl.v.z - bv.z, vn = rvx * C.nx + rvy * C.ny + rvz * C.nz;
        if (vn < 0) { pl.v.x -= C.nx * vn; pl.v.y -= C.ny * vn; pl.v.z -= C.nz * vn; }
        if (ground) { pl.grounded = true; pl.gbox = b; pl.gmat = b.mat; pl.groundNy = C.ny; }
        else if (C.ny > -0.4) { pl.wall = { nx: C.nx, nz: C.nz }; pl.wallTop = b.upright ? b.top() : -1e9; }
        if (b.hazard) { // hammers, sweepers, pistons: shove the player along the obstacle's motion
          const hb = b.vel, k = b.hazard, hv = Math.hypot(hb.x, hb.z) + 0.001; pl.v.x += (C.nx * 0.5 + hb.x / hv) * k; pl.v.z += (C.nz * 0.5 + hb.z / hv) * k; pl.v.y = Math.max(pl.v.y, k * 0.45);
          if (pl.stun <= 0) env.ev?.('hit', pl, k); pl.stun = 0.45; pl.grounded = false;
        }
      }
    }
    if (!any) break;
  }
}

// players are solid to each other; standing on your partner's head counts as ground
function bodyContact(a, b) {
  const dx = a.p.x - b.p.x, dz = a.p.z - b.p.z, dy = a.p.y - b.p.y, hd = Math.hypot(dx, dz), R = P.r * 2;
  if (hd >= R || Math.abs(dy) >= P.height) return;
  if (dy > P.height - 0.55 && a.v.y <= b.v.y + 0.5) { a.p.y = b.p.y + P.height; if (a.v.y < b.v.y) a.v.y = Math.max(0, b.v.y); a.grounded = true; a.onHead = true; a.headOf = b.id; a.gbox = null; a.gmat = 'body'; return; }
  if (dy < -(P.height - 0.55)) return; // b is on our head; b resolves it
  const nx = hd > 1e-4 ? dx / hd : 1, nz = hd > 1e-4 ? dz / hd : 0, pen = (R - hd) * 0.5;
  a.p.x += nx * pen; a.p.z += nz * pen; const vn = a.v.x * nx + a.v.z * nz; if (vn < 0) { a.v.x -= nx * vn * 0.5; a.v.z -= nz * vn * 0.5; }
}
export const waist = pl => ({ x: pl.p.x, y: pl.p.y + P.waist, z: pl.p.z });
