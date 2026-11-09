// Node tests for the simulation core: run `node test.mjs`. No browser needed.
import { Sim, DT } from './sim.js';
import { routeReport } from './level.js';
import { P } from './player.js';
import { validateSave, migrate } from './save-core.js';

let pass = 0, fail = 0; const out = [];
const ok = (name, cond, info = '') => { if (cond) pass++; else fail++; out.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const jpc = [0, 0], upc = [0, 0];
function inp(s, i, o = {}) { const pl = s.players[i]; let f = 0, yaw = 0; if (o.to) { const dx = o.to.x - pl.p.x, dz = o.to.z - pl.p.z; if (Math.hypot(dx, dz) > (o.stop ?? 0.25)) { f = 1; yaw = Math.atan2(-dx, -dz); } }
  if (o.jump) jpc[i]++; if (o.press) upc[i]++; return { f, s: 0, yaw, sprint: !!o.sprint, jump: !!o.jumpHeld || !!o.jump, jp: jpc[i], use: !!o.use, up: upc[i] }; }
function run(s, sec, f) { const n = Math.round(sec / DT); for (let k = 0; k < n; k++) { const r = f ? f(k * DT) : null; s.setInput(0, r?.[0] || inp(s, 0)); s.setInput(1, r?.[1] || inp(s, 1)); s.step(); } }
const mk = (o) => { const s = new Sim(o); s.players.forEach((p, i) => p.lastJp = jpc[i]); s.lastUse = [...upc]; return s; };
const place = (pl, p, dy = 0.05) => { pl.p.x = p.x; pl.p.y = p.y + dy; pl.p.z = p.z; pl.v.x = pl.v.y = pl.v.z = 0; pl.lastGroundY = pl.p.y; pl.grounded = false; };
const zp = (s, z, x, y, zz) => s.L.zones[z].frame.pt(x, y, zz);
const dist = (a, b) => Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y, a.p.z - b.p.z);

// 1 · level and route
{ const s = mk(); const rr = routeReport(s.L); const designed = new Set(['pullup', 'swingland', 'drumtop', 'lift', 'vlift', 'summit', 'leverbridge']);
  const bad = rr.filter(r => (r.gap > 3.2 || r.rise > 1.35) && !designed.has(r.to) && !designed.has(r.from) && !(r.gap === 4 && r.zone === 2));
  ok('route gaps/rises within controller limits', bad.length === 0, bad.map(b => JSON.stringify(b)).join(' '));
  ok('5 zones, 10 checkpoints, 10 relics', s.L.zones.length === 5 && s.L.cps.length === 10 && s.L.relics.length === 10);
  const types = new Set(s.L.obs.map(o => o.type)); for (const t of ['mover', 'rotor', 'hammer', 'door', 'vanish', 'sway', 'icicle', 'fall', 'bridge', 'elevator', 'ferry', 'lever', 'plates', 'drums', 'anchor']) ok('obstacle type present: ' + t, types.has(t));
  ok('wind zones present', s.L.winds.length >= 3); ok('ice + conveyor surfaces', s.L.statics.some(b => b.mat === 'ice') && s.L.statics.some(b => b.belt));
}
// 1b · every ordinary step of the main route can actually be made with a running jump (real physics)
{ const skip = new Set(['pullup', 'swingland', 'drumtop', 'lift', 'vlift', 'summit', 'leverbridge', 'mover', 'disc', 'ferry', 'overhang', 'corridor']); const fails = []; let n = 0;
  const L0 = mk().L;
  const attempt = (a, b, sp) => {
    const s = mk(); const [A, B] = s.players; const f = s.L.zones[a.zone].frame; for (const o of s.L.obs) { if (o.type === 'bridge' || o.type === 'fall') o.update = () => { }; if (o.type === 'vanish') o.phase = () => 0.1; if (o.type === 'hammer' || o.type === 'door') { o.angle = () => 1.5; o.k = () => 1; } } for (const w of s.L.winds) w.strength = () => 0; s.chainLen = s.Le = 60;
    const dz = b.z - a.z, dx = b.x - a.x, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len; const ex = Math.min(ux ? a.w / 2 / Math.abs(ux) : 1e9, uz ? a.d / 2 / Math.abs(uz) : 1e9);
    const st = f.pt(a.x + ux * (ex - 0.45), a.top, a.z + uz * (ex - 0.45)), goal = f.pt(b.x, b.top, b.z), dir = f.dir(ux, uz);
    place(A, st, 0.02); place(B, f.pt(a.x - ux * 1.2, a.top, a.z - uz * 1.2), 0.3); A.v.x = dir.x * sp; A.v.z = dir.z * sp; A.grounded = true; A.coyote = 0.1;
    let landed = false; run(s, 2.4, t => { if (t > 0.3 && A.grounded && Math.abs(A.p.y - goal.y) < 0.25) landed = true; return [inp(s, 0, { to: goal, stop: 0.12, sprint: sp > 6, jump: t === 0, jumpHeld: true }), inp(s, 1)]; });
    return landed ? null : `${a.zone}:${a.kind}@${a.z}→${b.kind}@${b.z} (y ${A.p.y.toFixed(1)} vs ${goal.y.toFixed(1)})`; };
  for (let i = 1; i < L0.path.length; i++) { const a = L0.path[i - 1], b = L0.path[i]; if (a.zone !== b.zone || skip.has(a.kind) || skip.has(b.kind)) continue; if (a.zone === 2 && b.z - a.z > 11.9 && b.z - a.z < 12.1) continue; n++;
    const r1 = attempt(a, b, 5.2); if (r1) { const r2 = attempt(a, b, 7.8); if (r2) fails.push(r2); } }
  ok(`all ${n} ordinary route jumps land`, fails.length === 0, fails.join(' | ')); }
// 2 · controller basics
{ const s = mk(); run(s, 1); ok('players rest on the start plaza', s.players.every(p => p.grounded && Math.abs(p.p.y) < 0.02));
  const A = s.players[0], y0 = A.p.y; let peak = 0; run(s, 1.2, t => { peak = Math.max(peak, A.p.y - y0); return [inp(s, 0, { jump: t === 0, jumpHeld: true })]; });
  ok('full jump height ≈ 1.6–1.75 m', peak > 1.55 && peak < 1.78, peak.toFixed(2));
  peak = 0; run(s, 1.2, t => { peak = Math.max(peak, A.p.y - y0); return [inp(s, 0, { jump: t === 0, jumpHeld: t < 0.08 })]; });
  ok('short tap gives a lower jump', peak < 1.2, peak.toFixed(2));
  const z0 = A.p.z; run(s, 1.0, () => [inp(s, 0, { to: { x: A.p.x, z: A.p.z + 50 } }), inp(s, 1, { to: { x: s.players[1].p.x, z: s.players[1].p.z + 50 } })]); ok('walks at ~5.2 m/s', Math.abs(A.speed - 5.2) < 0.3, A.speed.toFixed(2));
  run(s, 0.4, () => [inp(s, 0, { to: { x: A.p.x, z: A.p.z + 50 }, sprint: true }), inp(s, 1, { to: { x: s.players[1].p.x, z: s.players[1].p.z + 50 }, sprint: true })]); ok('sprints at ~7.8 m/s', Math.abs(A.speed - 7.8) < 0.4, A.speed.toFixed(2));
}
// 3 · tether: cannot separate indefinitely
{ const s = mk(); const [A, B] = s.players; let maxD = 0; run(s, 6, () => { maxD = Math.max(maxD, dist(A, B)); return [inp(s, 0, { to: { x: A.p.x - 30, z: A.p.z }, sprint: true }), inp(s, 1, { to: { x: B.p.x + 30, z: B.p.z }, sprint: true })]; });
  ok('players never separate beyond chain + 0.5 m', maxD < s.chainLen + 0.5, maxD.toFixed(2));
  ok('tension reads taut when stretched', s.chain.tension > 0.9 && (s.chain.state === 'taut' || s.chain.state === 'strained'), s.chain.state);
  let fin = true; run(s, 3, () => { if (![A.p.x, A.p.y, B.p.x, B.v.x].every(Number.isFinite) || Math.abs(A.v.x) > 30) fin = false; return [inp(s, 0, { to: { x: A.p.x - 30, z: A.p.z }, sprint: true }), inp(s, 1, { to: { x: B.p.x + 30, z: B.p.z }, sprint: true })]; });
  ok('no instability under sustained opposite pulls', fin);
}
// 4 · pull-up wall (zone 1): boost on the partner's head, mantle, then reel the partner up
{ const s = mk(); const [A, B] = s.players; const base = zp(s, 0, 0, 7.2, 93.0), top = zp(s, 0, 0, 11.2, 98);
  place(A, base); place(B, zp(s, 0, 0, 7.2, 91.6)); run(s, 0.5);
  let onHead = false; run(s, 0.9, t => { if (B.onHead) onHead = true; return [inp(s, 0), inp(s, 1, { to: A.p, stop: 0.05, jump: t > 0.0 && t < 0.02, jumpHeld: true })]; });
  run(s, 0.4, () => { if (B.onHead) onHead = true; return [inp(s, 0), inp(s, 1, { to: A.p, stop: 0.05 })]; });
  ok('partner can stand on the other player\'s head', onHead, `B dy ${(B.p.y - A.p.y).toFixed(2)}`);
  run(s, 1.4, t => [inp(s, 0), inp(s, 1, { to: { x: top.x, z: top.z + 3 }, jump: t < 0.02, jumpHeld: true })]);
  ok('boosted player mantles the 4 m wall', B.grounded && B.p.y > 11.0, `B y=${B.p.y.toFixed(2)}`);
  run(s, 1.0, () => [inp(s, 0), inp(s, 1, { to: { x: top.x, z: top.z + 2 } })]);
  let up = false; run(s, 7, () => { if (A.grounded && A.p.y > 11) up = true; return [inp(s, 0, { to: { x: top.x, z: top.z } }), inp(s, 1, { use: true })]; });
  ok('holding E reels the partner up the wall', up, `A y=${A.p.y.toFixed(2)} Le=${s.Le.toFixed(2)}`);
}
// 5 · anchor + swing gap (zone 2)
{ const s = mk(); const [A, B] = s.players; const an = s.L.obs.find(o => o.type === 'anchor' && o.zone === 1); place(A, { x: an.pos.x + 0.6 * Math.sin(Math.PI / 2), y: an.pos.y, z: an.pos.z }); place(B, zp(s, 1, 6, 2.0, 101.5)); run(s, 0.5);
  run(s, 0.1, t => [inp(s, 0, { press: t === 0 }), inp(s, 1)]);
  ok('E clips onto the anchor post', !!A.anchored);
  const land = zp(s, 1, 6, 1.6, 123.6); let landed = false;
  run(s, 6, () => { if (B.grounded && Math.abs(B.p.y - land.y) < 0.3 && B.p.z !== 0 && Math.abs(zLocal(s, 1, B) - 123.6) < 7.5) landed = true; return [inp(s, 0), inp(s, 1, { to: { x: land.x, z: land.z }, jump: false })]; });
  ok('swinging partner reaches the far terrace', landed, `B local z=${zLocal(s, 1, B).toFixed(2)} y=${B.p.y.toFixed(2)}`);
  ok('anchored player did not move', Math.hypot(A.p.x - an.pos.x, A.p.z - an.pos.z) < 0.8);
}
// 5b · second swing (zone 5) + the anchor following with a jump; final drums
{ const s = mk(); const [A, B] = s.players; const an = s.L.obs.find(o => o.type === 'anchor' && o.zone === 4); place(A, { x: an.pos.x, y: an.pos.y, z: an.pos.z - 0.6 }); place(B, zp(s, 4, 1.5, 8.2, 99.4)); run(s, 0.5);
  run(s, 0.1, t => [inp(s, 0, { press: t === 0 }), inp(s, 1)]); const land = zp(s, 4, 1.5, 7.8, 118); let landed = false;
  run(s, 6, () => { if (B.grounded && Math.abs(B.p.y - land.y) < 0.3) landed = true; return [inp(s, 0), inp(s, 1, { to: land })]; });
  ok('zone-5 swing reaches the far terrace', landed, `B y=${B.p.y.toFixed(2)} z=${zLocal(s, 4, B).toFixed(2)}`);
  run(s, 0.1, t => [inp(s, 0, { press: t === 0 }), inp(s, 1)]); ok('E unclips from the anchor', !A.anchored);
  run(s, 2.5, t => [inp(s, 0, { to: land, sprint: true, jump: t > 0.25 && t < 0.27, jumpHeld: true }), inp(s, 1)]);
  ok('anchor player can follow by jumping down', A.grounded && Math.abs(A.p.y - land.y) < 0.3, `A y=${A.p.y.toFixed(2)}`);
  const d = s.L.obs.find(o => o.type === 'drums' && o.zone === 4); place(A, { ...d.pads[0], y: d.pads[0].y + 0.3 }); place(B, { ...d.pads[1], y: d.pads[1].y + 0.3 }); run(s, 0.6);
  run(s, 2.4, t => [inp(s, 0, { jump: t === 0, jumpHeld: true }), inp(s, 1, { jump: t === 0, jumpHeld: true })]);
  ok('final drums launch both onto the summit', A.grounded && B.grounded && A.p.y > s.L.bell.pos.y - 0.3, `${A.p.y.toFixed(1)} vs ${s.L.bell.pos.y}`);
}
function zLocal(s, z, pl) { const f = s.L.zones[z].frame, dx = pl.p.x - f.o.x, dz = pl.p.z - f.o.z; return dx * f.s + dz * f.c; }
// 6 · drums need a simultaneous jump
{ const s = mk(); const [A, B] = s.players; const d = s.L.obs.find(o => o.type === 'drums' && o.zone === 1); place(A, { ...d.pads[0], y: d.pads[0].y + 0.3 }); place(B, { ...d.pads[1], y: d.pads[1].y + 0.3 }); run(s, 0.6);
  let peak = 0; run(s, 1.0, t => { peak = Math.max(peak, A.p.y); return [inp(s, 0, { jump: t === 0, jumpHeld: true }), inp(s, 1)]; });
  ok('a lone jump on a drum is a normal jump', peak - d.pads[0].y < 2.4, (peak - d.pads[0].y).toFixed(2));
  run(s, 0.6); run(s, 2.4, t => [inp(s, 0, { jump: t === 0, jumpHeld: true }), inp(s, 1, { jump: t > 0.15 && t < 0.17, jumpHeld: true })]);
  const q = zp(s, 1, 6, 10.5, 136); ok('synchronised jump launches both onto the cliff', A.p.y > q.y - 0.2 && B.p.y > q.y - 0.2 && A.grounded && B.grounded, `${A.p.y.toFixed(1)} / ${B.p.y.toFixed(1)} vs ${q.y}`);
}
// 7 · lever bridge, elevator, plates (zone 3)
{ const s = mk(); const [A, B] = s.players; const lv = s.L.obs.find(o => o.type === 'lever'); place(A, lv.levers[0]); place(B, zp(s, 2, 0, 0, 81.5)); run(s, 0.5);
  run(s, 2.5, () => [inp(s, 0, { use: true }), inp(s, 1)]); ok('holding a lever extends the bridge', lv.u > 0.95, lv.u.toFixed(2));
  run(s, 3.2, () => [inp(s, 0, { use: true }), inp(s, 1, { to: zp(s, 2, 0, 0, 89) })]); ok('partner crosses the lever bridge', zLocal(s, 2, B) > 87, zLocal(s, 2, B).toFixed(1));
  run(s, 3, () => [inp(s, 0), inp(s, 1)]); ok('bridge retracts when released', lv.u < 0.2, lv.u.toFixed(2));
  const el = s.L.obs.find(o => o.type === 'elevator'); place(A, { ...el.a, y: el.a.y + 0.3 }); place(B, zp(s, 2, 0, 0, 92)); run(s, 2); ok('elevator waits for both players', el.u < 0.01);
  place(B, { x: el.a.x + 1, y: el.a.y + 0.3, z: el.a.z }); run(s, 7); ok('elevator rises with both aboard', el.u > 0.99 && A.p.y > el.b.y - 0.1, `u=${el.u.toFixed(2)} Ay=${A.p.y.toFixed(1)}`);
  const pl = s.L.obs.find(o => o.type === 'plates'); place(A, pl.pl[0]); place(B, { x: pl.pl[1].x + 4, y: pl.pl[1].y, z: pl.pl[1].z }); run(s, 1.5); ok('one plate is not enough', !pl.open);
  place(B, pl.pl[1]); run(s, 1.5); ok('both plates open the gate', pl.open === 1 && !pl.gate.solid);
}
// 8 · falling, rescue window, respawn, checkpoints for both
{ const s = mk(); const [A, B] = s.players; const c2 = s.L.cps[1]; place(A, c2.pos); place(B, { x: c2.pos.x + 1, y: c2.pos.y, z: c2.pos.z }); run(s, 0.5);
  ok('checkpoint activates only when both are there', s.cp === 1);
  const s2 = mk(); const [a2, b2] = s2.players; place(a2, s2.L.cps[1].pos); place(b2, { x: s2.L.cps[1].pos.x + 9, y: s2.L.cps[1].pos.y, z: s2.L.cps[1].pos.z }); run(s2, 0.5); ok('one player alone does not take the checkpoint', s2.cp === 0);
  // B walks off the side of terrace B (zone 1) while A braces → rescue window
  const edge = zp(s, 0, -5.6, 7.2, 66); place(B, edge); place(A, zp(s, 0, -2.5, 7.2, 66)); run(s, 0.3);
  run(s, 2.2, () => [inp(s, 0), inp(s, 1, { to: zp(s, 0, -20, 0, 66) })]);
  ok('one player falling opens a rescue window', !!s.rescue && s.rescue.who === 1, JSON.stringify(s.rescue));
  ok('braced partner is not dragged off', A.grounded);
  const before = s.falls[1]; run(s, 9.5, () => [inp(s, 0), inp(s, 1)]); ok('failed rescue resets both to the checkpoint', s.falls[1] === before + 1 && s.state === 'play' && Math.abs(B.p.y - s.L.cps[s.cp].pos.y) < 0.5, `${s.state} cp${s.cp}`);
  // successful rescue
  place(B, edge); place(A, zp(s, 0, -2.5, 7.2, 66)); run(s, 0.3); run(s, 2.2, () => [inp(s, 0, { use: true }), inp(s, 1, { to: zp(s, 0, -20, 0, 66) })]);
  let saved = false; run(s, 7, () => { if (!s.rescue && B.grounded) saved = true; return [inp(s, 0, { use: true }), inp(s, 1, { to: zp(s, 0, 0, 7.2, 66) })]; });
  ok('reeling a dangling partner back up rescues them', saved, `B y=${B.p.y.toFixed(1)}`);
  // both fall
  place(A, zp(s, 0, -5.6, 7.2, 64)); place(B, zp(s, 0, -5.6, 7.2, 67)); const f0 = s.fallsTotal; run(s, 3.5, () => [inp(s, 0, { to: zp(s, 0, -30, 0, 64) }), inp(s, 1, { to: zp(s, 0, -30, 0, 67) })]);
  ok('both falling respawns at the checkpoint', s.fallsTotal === f0 + 1 && s.players.every(p => p.p.y > 7));
}
// 9 · obstacles behave
{ const s = mk(); const [A, B] = s.players; const br = s.L.obs.find(o => o.type === 'bridge'); place(A, br.homes[1], 0.3); place(B, zp(s, 0, 0, 7.2, 68)); run(s, 0.3); ok('stepping on the bridge starts the collapse', br.s === 1);
  run(s, 5); ok('collapsed planks fall away', br.boxes.every(b => !b.solid));
  const ft = s.L.obs.find(o => o.type === 'fall'); place(A, ft.home, 0.5); run(s, 0.4); ok('crumbling tile triggers', ft.s >= 1); run(s, 2.6); ok('crumbling tile falls', !ft.b0.solid || ft.b0.c.y < ft.home.y - 2); run(s, 5); ok('crumbling tile respawns', ft.s === 0 && ft.b0.solid);
  const mv = s.L.obs.find(o => o.type === 'mover'); s.t = 0; place(A, { ...mv.a, y: mv.a.y + 0.4 }, 0.02); place(B, { ...mv.a, x: mv.a.x + 1.2, y: mv.a.y + 0.4 }, 0.02); run(s, 3.2);
  ok('moving platform carries its rider', Math.hypot(A.p.x - mv.b0.c.x, A.p.z - mv.b0.c.z) < 1.0 && A.grounded, `${(A.p.x - mv.b0.c.x).toFixed(2)},${(A.p.z - mv.b0.c.z).toFixed(2)}`);
  const hm = s.L.obs.find(o => o.type === 'hammer'); let hit = false; place(A, { x: hm.pv.x, y: hm.pv.y - 6.2, z: hm.pv.z }); place(B, zp(s, 1, 6, 2, 70)); run(s, 3, () => { if (A.stun > 0) hit = true; return null; }); ok('hammer knocks a player standing in its path', hit);
  const belt = s.L.statics.find(b => b.belt && Math.abs(b.belt.x) + Math.abs(b.belt.z) > 2.9); place(A, { x: belt.c.x, y: belt.top(), z: belt.c.z }); place(B, { x: belt.c.x, y: belt.top(), z: belt.c.z + 0.01 }); B.p.x += 0.9;
  const p0 = { ...A.p }; run(s, 1); const moved = (A.p.x - p0.x) * belt.belt.x + (A.p.z - p0.z) * belt.belt.z; ok('conveyor carries a standing player', moved > 1.5, moved.toFixed(2));
  const ice = s.L.statics.find(b => b.mat === 'ice' && b.h.z > 6); place(A, { x: ice.c.x, y: ice.top(), z: ice.c.z }); place(B, { x: ice.c.x, y: ice.top(), z: ice.c.z + 3 }); run(s, 0.4);
  run(s, 0.8, () => [inp(s, 0, { to: { x: A.p.x + 40, z: A.p.z } })]); const v0 = A.speed; run(s, 0.4); ok('ice keeps you sliding after letting go', A.speed > v0 * 0.35, `${v0.toFixed(2)}→${A.speed.toFixed(2)}`);
  const vn = s.L.obs.find(o => o.type === 'vanish'); let on = 0, off = 0; for (let k = 0; k < 440; k++) { s.step(); vn.b0.solid ? on++ : off++; } ok('phantom tiles vanish part of the time', on > 0 && off > 0, `${on}/${off}`);
  const ic = s.L.obs.find(o => o.type === 'icicle'); let fell = false; for (let k = 0; k < 300; k++) { s.step(); if (ic.b0.solid && ic.b0.c.y < ic.top.y - 1) fell = true; } ok('icicles drop on schedule', fell);
  const fe = s.L.obs.find(o => o.type === 'ferry'); place(A, { ...fe.a, y: fe.a.y + 0.3 }); place(B, { x: fe.a.x + 1, y: fe.a.y + 0.3, z: fe.a.z }); run(s, 4); ok('tandem sled moves with both aboard', fe.u > 0.2, fe.u.toFixed(2));
}
// 9b · wind pushes grounded players; bracing (hold E) resists
{ const drift = (brace) => { const s = mk(); const [A, B] = s.players; const w = s.L.winds[0]; const at = zp(s, 1, 0, 0, 12); place(A, at); place(B, zp(s, 1, 0, 0, 8)); run(s, 0.3); const x0 = { ...A.p };
    let t = s.t; while (w.strength(s.t) < w.base + w.gust * 0.9) { run(s, 1 / 60, () => [inp(s, 0, { use: brace }), inp(s, 1, { use: true })]); if (s.t - t > 6) break; }
    run(s, 0.5, () => [inp(s, 0, { use: brace }), inp(s, 1, { use: true })]); return Math.hypot(A.p.x - x0.x, A.p.z - x0.z); };
  const d0 = drift(false), d1 = drift(true); ok('wind gusts drag a standing player toward the edge', d0 > 0.5, d0.toFixed(2)); ok('bracing with E resists the wind', d1 < d0 * 0.6, `${d1.toFixed(2)} vs ${d0.toFixed(2)}`); }
// 10 · snapshot round-trip + save validation
{ const s = mk(); run(s, 1, () => [inp(s, 0, { to: { x: 0, z: 30 } }), inp(s, 1)]); const snap = JSON.parse(JSON.stringify(s.snapshot([0, 0])));
  const r = mk(); r.applySnapshot(snap); ok('snapshot restores players', Math.abs(r.players[0].p.z - s.players[0].p.z) < 1e-3 && r.cp === s.cp);
  const sv = s.toSave({ saveId: 'abc', roomCode: 'QWERT' }); const v = validateSave(JSON.parse(JSON.stringify(sv))); ok('save matches the required structure', v.ok, v.error || '');
  const r2 = mk(); r2.fromSave(sv); ok('save restores positions and progress', Math.abs(r2.players[0].p.z - s.players[0].p.z) < 1e-2 && r2.elapsed === sv.progress.elapsedTime);
  ok('rejects a wrong-major version', !validateSave({ ...sv, gameVersion: '2.0' }).ok);
  ok('rejects a broken file', !validateSave({ gameVersion: '1.0', host: {} }).ok);
  ok('accepts the minimal 1.0 example from the spec', validateSave(migrate({ gameVersion: '1.0', saveId: 'x', roomCode: 'r', timestamp: new Date().toISOString(), host: { playerId: 'h', name: 'Player 1', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }, guest: { playerId: 'g', name: 'Player 2', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }, chain: { maximumLength: 8, tension: 0, state: 'slack' }, progress: { level: 1, checkpointId: 'checkpoint-01', heightReached: 0, elapsedTime: 0 } })).ok);
}
// 11 · hardcore resets the whole run
{ const s = mk({ mode: 'hardcore' }); const [A, B] = s.players; place(A, s.L.cps[1].pos); place(B, { ...s.L.cps[1].pos, x: s.L.cps[1].pos.x + 1 }); run(s, 0.5); ok('hardcore ignores checkpoints', s.cp === 0);
  s.elapsed = 50; place(A, zp(s, 0, -5.6, 7.2, 64)); place(B, zp(s, 0, -5.6, 7.2, 67)); run(s, 3.5, () => [inp(s, 0, { to: zp(s, 0, -30, 0, 64) }), inp(s, 1, { to: zp(s, 0, -30, 0, 67) })]);
  ok('hardcore fall restarts from the base with the timer reset', s.elapsed < 3 && A.p.y < 1, `t=${s.elapsed.toFixed(1)} y=${A.p.y.toFixed(1)}`);
}
// 12 · bell / victory
{ const s = mk(); const [A, B] = s.players; const b = s.L.bell.pos; place(A, { x: b.x - 1, y: b.y, z: b.z }); place(B, { x: b.x + 1, y: b.y, z: b.z }); run(s, 0.4); run(s, 0.2, t => [inp(s, 0, { press: t === 0 }), inp(s, 1)]);
  ok('ringing the bell together wins', s.state === 'victory' && !!s.victory);
}
console.log(out.join('\n')); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
