// The mountain. Five zones, each authored in its own local frame (x = sideways, +x faces the massif, z = forward,
// y = up) and chained end-to-start, turning 90° each time so the route spirals up around the central peak.
// Jump distances are kept inside what the controller can do: ≤3.2 m gaps walking, ≤4.6 m sprinting, ≤1.3 m rises
// (≤2.7 m with a ledge grab). `test.mjs` checks the main route against those limits.
import { Box, World } from './physics.js';
import * as O from './obstacles.js';

export class Frame {
  constructor(x, y, z, yaw) { this.o = { x, y, z }; this.yaw = yaw; this.c = Math.cos(yaw); this.s = Math.sin(yaw); }
  pt(x, y, z) { return { x: this.o.x + x * this.c + z * this.s, y: this.o.y + y, z: this.o.z - x * this.s + z * this.c }; }
  dir(x, z) { return { x: x * this.c + z * this.s, z: -x * this.s + z * this.c }; }
}

export const ZONES = [
  { key: 'ruins', name: 'The Ruins', sub: 'Zone 1', mat: 'sand', color: '#e8b27a' },
  { key: 'cliffs', name: 'The Windy Cliffs', sub: 'Zone 2', mat: 'slate', color: '#8fb8d8' },
  { key: 'works', name: 'The Industrial Complex', sub: 'Zone 3', mat: 'rust', color: '#e07b39' },
  { key: 'frozen', name: 'The Frozen Peak', sub: 'Zone 4', mat: 'snow', color: '#bfe3ff' },
  { key: 'temple', name: 'The Sky Temple', sub: 'Zone 5', mat: 'marble', color: '#ffd978' },
];

export function buildLevel() {
  const L = { world: new World(), obs: [], winds: [], cps: [], relics: [], hints: [], zones: [], path: [], bell: null, statics: [] };
  let zi = 0, fr = null, nid = 0;
  const addS = (o) => { const b = new Box(o); b.zone = zi; L.world.addStatic(b); L.statics.push(b); return b; };
  // platform with its TOP at `top`; o.h thickness, o.col → extend down as a pillar; o.path marks the main route
  const P = (x, top, z, w, d, o = {}) => { const h = o.col ? o.col : (o.h || 1.0); const c = fr.pt(x, top - h / 2, z);
    const b = addS({ x: c.x, y: c.y, z: c.z, w, h, d, ry: fr.yaw + (o.ry || 0), mat: o.mat || ZONES[zi].mat, belt: o.belt ? fr.dir(o.belt[0], o.belt[1]) : null, vis: o.vis || (o.col ? 'pillar' : 'plat') });
    if (o.path !== false && !o.deco) L.path.push({ zone: zi, x, top, z, w, d, b, kind: o.kind || 'plat' }); return b; };
  const deco = (x, top, z, w, d, h, mat, vis) => P(x, top, z, w, d, { h, mat, vis: vis || 'wall', path: false, deco: true });
  const ob = (o) => { o.zone = zi; L.obs.push(o); for (const b of o.boxes) { b.zone = zi; L.world.addDynamic(b); } return o; };
  const id = (t) => `${ZONES[zi].key}-${t}-${++nid}`;
  const cp = (x, y, z, label) => { const n = L.cps.length + 1; const p = fr.pt(x, y, z), a = fr.pt(x - 1.3, y, z), b = fr.pt(x + 1.3, y, z);
    L.cps.push({ id: 'checkpoint-' + String(n).padStart(2, '0'), idx: n - 1, zone: zi, label, pos: p, spawn: [a, b], yaw: fr.yaw + Math.PI, r: 4.2 }); };
  const relic = (x, y, z, secret = true) => L.relics.push({ id: 'relic-' + (L.relics.length + 1), zone: zi, pos: fr.pt(x, y + 0.9, z), secret });
  const hint = (x0, x1, y0, y1, z0, z1, text, icon) => { const a = fr.pt(x0, y0, z0), b = fr.pt(x1, y1, z1); L.hints.push({ zone: zi, text, icon, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), y0: a.y, y1: b.y, z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z) }); };
  const anchor = (x, y, z) => { const p = fr.pt(x, y, z); const a = { id: 'anchor-' + L.obs.filter(o => o.type === 'anchor').length, type: 'anchor', pos: p, boxes: [], update() { }, reset() { }, pack() { return null; }, stateful: false, zone: zi };
    addS({ ...fr.pt(x, y + 0.55, z), w: 0.36, h: 1.1, d: 0.36, ry: fr.yaw, mat: 'metal', vis: 'anchor' }); L.obs.push(a); return a; };
  const zone = (k, x, y, z, yaw) => { zi = k; fr = new Frame(x, y, z, yaw); L.zones.push({ ...ZONES[k], idx: k, frame: fr, y0: y, killY: y - 24 }); };

  // ═════ ZONE 1 · THE RUINS ═════
  zone(0, -40, 0, -80, 0);
  P(0, 0, 4, 16, 14, { h: 3, kind: 'start' }); cp(0, 0, 2, 'Base Camp');
  hint(-8, 8, -1, 6, -3, 11, 'WASD move · SPACE jump (hold = higher) · SHIFT sprint · drag/mouse to look', 'move');
  [[0, 1, 13.25], [1, 2, 16.75], [0, 3, 20.25], [-1, 4, 23.75]].forEach(([x, t, z]) => P(x, t, z, 3, 2.5, { col: t + 6 }));
  hint(-6, 6, 0, 8, 11, 25, 'You are chained together. Drift too far apart and the chain yanks you back.', 'chain');
  P(0, 4, 31.5, 1.4, 13, { h: 0.5, mat: 'wood', vis: 'plank', kind: 'narrow' });
  P(0, 4, 42.5, 10, 9, { col: 10 });
  // secret: ledge under the narrow bridge
  P(-4, 1.2, 33, 2.5, 4, { col: 6, path: false }); P(-4.2, 2.8, 36.5, 1.6, 1.6, { col: 6, path: false }); relic(-4, 1.2, 32.5);
  [[-1, 4.8, 49], [1.2, 5.6, 52.5], [-0.8, 6.4, 56], [1, 7.2, 59.5]].forEach(([x, t, z]) => P(x, t, z, 1.8, 1.8, { col: t + 8, kind: 'hop' }));
  P(0, 7.2, 66, 12, 10, { col: 12 }); cp(0, 7.2, 65, 'Broken Arch');
  P(5.5, 9.6, 63, 1.4, 1.4, { col: 3, path: false }); relic(5.5, 9.6, 63);
  hint(-6, 6, 6, 12, 61, 71, 'Collapsing bridge ahead. Once it starts to go, keep moving — together.', 'run');
  ob(new O.Bridge(id('bridge'), fr, { x: 0, top: 7.2, z0: 71, len: 14, n: 8, w: 2.2, first: 0.9, each: 0.32 }));
  L.path.push({ zone: 0, x: 0, top: 7.2, z: 78, w: 2.2, d: 14, kind: 'bridge' });
  P(0, 7.2, 89.5, 12, 9, { col: 12 });
  P(0, 11.2, 100, 12, 12, { h: 5, kind: 'pullup' });
  hint(-6, 6, 6, 12, 85, 94, 'Too high alone! One stands by the wall, the other jumps onto their head and grabs the ledge.', 'boost');
  hint(-6, 6, 10, 16, 94, 99, 'Hold E to reel in the chain and haul your partner up.', 'reel');
  [[0, 11.6, 108.5], [1.5, 12.0, 112.3], [-1, 12.4, 116.1], [0.5, 12.8, 119.9]].forEach(([x, t, z]) => { ob(new O.FallTile(id('crumble'), fr, { at: [x, t - 0.45, z], w: 2.6, d: 2.6 })); L.path.push({ zone: 0, x, top: t, z, w: 2.6, d: 2.6, kind: 'crumble' }); });
  P(0, 13.2, 126, 12, 8, { col: 14 });
  for (let k = 0; k < 6; k++) P(k % 2 ? -1.2 : 1.2, 14.4 + 1.2 * k, 133.25 + 4 * k, 3, 2.5, { col: 8 + k });
  P(0, 20.4, 160, 12, 10, { col: 18 });
  deco(14, 30, 72, 6, 144, 60, 'sand', 'cliff');

  // ═════ ZONE 2 · THE WINDY CLIFFS ═════
  let e = fr.pt(0, 20.4, 160); zone(1, e.x, e.y, e.z, Math.PI / 2);
  cp(0, 0, 0, 'Cliff Gate');
  P(0, 0, 17, 2.2, 22, { h: 1.2, kind: 'ledge' }); deco(3.6, 9, 17.75, 4.6, 22.5, 14, 'slate', 'cliff');
  L.winds.push(new O.Wind(id('wind'), fr, { x0: -7, x1: 1.5, y0: -3, y1: 6, z0: 6, z1: 28, dir: [-1, 0], base: 1, gust: 10.5, period: 4.6, len: 1.7 }));
  hint(-5, 5, -1, 6, -5, 10, 'GUSTS push you off the ledge. Watch the flags — hold E to brace.', 'wind');
  P(-3.2, -3.5, 20, 2, 3, { col: 4, path: false }); P(-3.2, -1.9, 23.5, 1.4, 1.4, { col: 4, path: false }); relic(-3.2, -3.5, 20);
  P(-1, 0.6, 31, 5, 6, { col: 10 });
  ob(new O.Mover(id('mover'), fr, { a: [0, 0.2, 38], b: [0, 0.2, 46], w: 3.5, d: 3.5, period: 6.5 })); L.path.push({ zone: 1, x: 0, top: 0.6, z: 42, w: 3.5, d: 11.5, kind: 'mover' });
  P(0, 1.2, 54, 6, 8, { col: 10 });
  ob(new O.Mover(id('mover'), fr, { a: [-5, 0.8, 62], b: [6, 0.8, 62], w: 3.5, d: 3.5, period: 7, phase: 0.25 })); L.path.push({ zone: 1, x: 0, top: 1.2, z: 62, w: 3.5, d: 3.5, kind: 'mover' });
  P(6, 2.0, 68, 6, 6, { col: 10 });
  P(6, 2.0, 82, 2.4, 22, { h: 0.6, mat: 'wood', vis: 'plank', kind: 'narrow' });
  for (let k = 0; k < 3; k++) ob(new O.Hammer(id('hammer'), fr, { pivot: [6, 8.2, 76 + 6 * k], len: 5.4, period: 2.8, phase: k / 3, hazard: 9 }));
  for (const zz of [73, 91]) { deco(2.5, 8.6, zz, 0.6, 0.6, 8.6, 'wood', 'post'); deco(9.5, 8.6, zz, 0.6, 0.6, 8.6, 'wood', 'post'); }
  deco(6, 8.8, 82, 7.6, 19, 0.5, 'wood', 'beam');
  hint(2, 10, 1, 8, 68, 75, 'Swinging hammers. Wait for the gap, then go.', 'time');
  P(6, 2.0, 98, 10, 10, { col: 12 }); cp(6, 2.0, 97, 'Hammer Hold');
  P(10.5, 3.2, 104.5, 1.6, 1.4, { col: 6, path: false }); P(10.5, 4.4, 106.8, 1.6, 1.4, { col: 6, path: false });
  P(9, 5.6, 110, 8, 2.2, { h: 0.8, kind: 'overhang', path: false }); deco(13.5, 5.6, 110, 2, 3, 14, 'slate', 'pillar');
  anchor(6, 5.6, 110); relic(12, 5.6, 110, false);
  hint(1, 11, 1, 9, 93, 103, 'ANCHOR: one climbs the pegs and clips onto the post (E). The other walks off the edge and swings across.', 'anchor');
  P(6, 1.6, 123.6, 9, 14, { col: 12, kind: 'swingland' });
  ob(new O.Drums(id('drums'), fr, { pads: [[4, 1.6, 127.5], [8, 1.6, 127.5]], v: 21, fwd: [0, 0, 4.2] }));
  P(6, 10.5, 136, 12, 10, { h: 9, kind: 'drumtop' });
  hint(1, 11, 2, 9, 120, 131, 'DRUMS: both stand on a drum and JUMP at the same moment.', 'drums');
  [[6, 11.3, 144], [4.5, 12.1, 147.5], [6, 12.9, 151], [7.5, 13.7, 154.5]].forEach(([x, t, z]) => P(x, t, z, 2, 2, { col: 8, kind: 'hop' }));
  L.winds.push(new O.Wind(id('wind'), fr, { x0: -1, x1: 13, y0: 10, y1: 20, z0: 141, z1: 156, dir: [-1, 0], base: 1, gust: 8, period: 3.8, len: 1.3, phase: 0.4 }));
  P(6, 14.5, 161, 12, 10, { col: 16 });
  deco(16, 20, 82.5, 6, 135, 50, 'slate', 'cliff');

  // ═════ ZONE 3 · THE INDUSTRIAL COMPLEX ═════
  e = fr.pt(6, 14.5, 161); zone(2, e.x, e.y, e.z, Math.PI);
  cp(0, 0, 0, 'Boiler Gate');
  P(0, 0, 15, 3, 18, { mat: 'belt', belt: [0, -3.0], vis: 'belt', kind: 'belt' });
  P(0, 0, 29.5, 3, 11, { mat: 'belt', belt: [-2.4, 0], vis: 'belt', kind: 'belt' });
  hint(-4, 4, -1, 6, 4, 34, 'Conveyors fight you — sprint against the flow, and keep away from the edge.', 'belt');
  ob(new O.Rotor(id('rotor'), fr, { c: [0, 0, 43], speed: 0.35, parts: [{ w: 10, h: 0.8, d: 10, y: -0.4, mat: 'metal', vis: 'disc', spin: 1 }, { w: 0.5, h: 0.5, d: 9.6, y: 0.55, hazard: 8, vis: 'sweeper', spin: 3 }, { w: 0.8, h: 1.6, d: 0.8, y: 0.8, vis: 'hub', spin: 1 }] }));
  L.path.push({ zone: 2, x: 0, top: 0, z: 43, w: 10, d: 10, kind: 'disc' });
  hint(-5, 5, -1, 6, 35, 50, 'Rotating machinery: jump the sweeper arm.', 'jump');
  P(0, 0, 53.5, 8, 7, { col: 8 }); cp(0, 0, 53.5, 'Turbine Deck');
  P(0, 0, 66, 3, 18, { kind: 'corridor', mat: 'metal' }); deco(4, 2.6, 66, 3, 18, 5.2, 'rust', 'housing');
  for (let k = 0; k < 3; k++) ob(new O.Door(id('piston'), fr, { closed: [4.2, 1.1, 61 + 5 * k], open: [0.1, 1.1, 61 + 5 * k], w: 2.8, h: 2.2, d: 1.6, period: 3, openFor: 0.45, travel: 0.16, phase: k / 3, hazard: 9, vis: 'piston', mat: 'rust' }));
  ob(new O.Door(id('door'), fr, { closed: [0, 1.6, 75.3], open: [0, 5.1, 75.3], w: 3.2, h: 3.2, d: 0.6, period: 5, openFor: 2.2, travel: 0.45, vis: 'blast' }));
  deco(-2.1, 4.8, 75.3, 1, 1, 4.8, 'rust', 'post'); deco(2.1, 4.8, 75.3, 1, 1, 4.8, 'rust', 'post'); deco(0, 5.6, 75.3, 5.2, 1, 0.8, 'rust', 'beam');
  hint(-3, 3, -1, 5, 55, 60, 'Pistons slam on a beat. The blast door at the end only opens for a moment.', 'time');
  P(-3, -1.4, 66, 0.8, 16, { h: 0.8, mat: 'metal', vis: 'pipe', path: false }); relic(-3, -1.4, 67);
  P(0, 0, 79, 9, 8, { col: 8 }); P(0, 0, 91, 9, 8, { col: 8 });
  deco(0, 3.1, 85, 9, 6, 1.0, 'rust', 'duct');
  ob(new O.LeverBridge(id('lever'), fr, { levers: [[3, 0, 82.2], [3, 0, 87.8]], inn: [0, -0.4, 78.8], out: [0, -0.225, 85], w: 2.2, d: 4.4 }));
  L.path.push({ zone: 2, x: 0, top: 0, z: 85, w: 2.2, d: 4.4, kind: 'leverbridge' });
  hint(-4.5, 4.5, -1, 5, 75.6, 83, 'LEVER: hold E to extend the bridge while your partner crosses. Then they hold the far lever for you.', 'lever');
  ob(new O.Lift(id('elevator'), fr, { a: [0, -0.3, 98.5], b: [0, 13.7, 98.5], w: 4, d: 4, need: 2, speed: 2.6 }));
  L.path.push({ zone: 2, x: 0, top: 0, z: 98.5, w: 4, d: 4, kind: 'lift' });
  for (const [x, z] of [[-2.4, 96.2], [2.4, 96.2], [-2.4, 100.8], [2.4, 100.8]]) deco(x, 17, z, 0.4, 0.4, 17.6, 'rust', 'post');
  hint(-4.5, 4.5, -1, 5, 87, 101, 'This elevator only moves with BOTH of you aboard.', 'lift');
  P(0, 14, 106, 10, 10, { col: 6 }); ob(new O.Plates(id('plates'), fr, { plates: [[-3.2, 14, 104], [3.2, 14, 104]], gate: [0, 15.6, 111.3], gw: 4, gh: 3.2 }));
  deco(3.5, 17.2, 111.3, 3, 0.6, 3.2, 'rust', 'wall'); deco(-3.5, 17.2, 111.3, 3, 0.6, 3.2, 'rust', 'wall');
  P(-4, 15.2, 102, 1.2, 1.2, { h: 1.2, mat: 'wood', vis: 'crate', path: false }); relic(-4, 15.2, 102);
  hint(-5, 5, 13, 19, 101, 111, 'Two pressure plates. Hold both down together to open the gate.', 'plates');
  P(0, 14, 117, 3.4, 11, { h: 1, mat: 'metal' });
  [[14, 125, 0], [16, 128.5, 0.5], [18, 132, 0]].forEach(([t, z, ph]) => { ob(new O.Mover(id('lift'), fr, { a: [0, t - 0.4, z], b: [0, t + 2.6, z], w: 2.6, d: 2.6, period: 5, phase: ph, hold: 0.3 })); L.path.push({ zone: 2, x: 0, top: t + 1.5, z, w: 2.6, d: 2.6, kind: 'vlift' }); });
  P(0, 21, 138, 10, 8, { col: 10 });
  deco(10, 16, 75, 6, 110, 46, 'rust', 'cliff');

  // ═════ ZONE 4 · THE FROZEN PEAK ═════
  e = fr.pt(0, 21, 138); zone(3, e.x, e.y, e.z, Math.PI * 1.5);
  cp(0, 0, 0, 'Frostline');
  P(0, 0, 13, 9, 16, { mat: 'ice', vis: 'ice', kind: 'ice' });
  hint(-4.5, 4.5, -1, 5, 5, 21, 'ICE: you slide. Start and stop early.', 'ice');
  [[-1.5, 1, 24.5], [1.5, 2, 28.5], [-1, 3, 32.5]].forEach(([x, t, z]) => P(x, t, z, 3, 3, { col: 6, mat: 'ice', vis: 'ice' }));
  P(0, 3, 39, 8, 8, { col: 8 });
  ob(new O.Sway(id('beam'), fr, { at: [0, 2.8, 50], w: 0.6, d: 14, amp: 0.09, period: 3.4, mat: 'wood' })); L.path.push({ zone: 3, x: 0, top: 3, z: 50, w: 0.6, d: 14, kind: 'beam' });
  hint(-4, 4, 2, 8, 35, 43, 'Balance beam. One at a time — and mind the chain.', 'beam');
  P(0, 3, 61, 8, 8, { col: 8 });
  P(0, 3, 76, 3.2, 22, { h: 1 }); deco(0, 10.5, 76, 5, 22, 1, 'snow', 'roof'); deco(2.6, 7, 76, 1.2, 22, 8, 'snow', 'cliff');
  for (let k = 0; k < 5; k++) ob(new O.Icicle(id('icicle'), fr, { at: [k % 2 ? 0.6 : -0.6, 9.2, 69 + 4 * k], floor: 3, period: 3.6, phase: k * 0.37 % 1 }));
  hint(-2, 2, 2, 8, 64, 70, 'Falling ice! Shadows warn you where it will land.', 'icicle');
  P(0, 3, 92, 10, 10, { col: 10 }); cp(0, 3, 92, 'Icefall Camp');
  ob(new O.Lift(id('ferry'), fr, { a: [0, 2.7, 99.5], b: [0, 2.7, 122.5], w: 3.6, d: 3.6, need: 2, speed: 2.4, ferry: true }));
  L.path.push({ zone: 3, x: 0, top: 3, z: 111, w: 3.6, d: 26, kind: 'ferry' });
  L.winds.push(new O.Wind(id('wind'), fr, { x0: -8, x1: 8, y0: 1, y1: 12, z0: 100, z1: 122, dir: [-1, 0], base: 0.5, gust: 6, period: 5, len: 1.6 }));
  hint(-5, 5, 2, 8, 87, 98, 'The sled only moves while you BOTH ride it. Stay on together.', 'ferry');
  P(0, 3, 129, 9, 8, { col: 10 });
  [[1.5, 3.6, 136.5], [-1.2, 4.2, 140.6], [1, 4.8, 144.7]].forEach(([x, t, z]) => P(x, t, z, 2.6, 2.6, { col: 5, mat: 'ice', vis: 'ice', kind: 'hop' }));
  P(-4.5, 3.6, 137, 2.6, 2.6, { col: 5, mat: 'ice', vis: 'ice', path: false }); relic(-4.5, 3.6, 137);
  [[-0.5, 5.4, 148.8], [1, 6.0, 152.9]].forEach(([x, t, z]) => { ob(new O.FallTile(id('crumble'), fr, { at: [x, t - 0.45, z], w: 2.6, d: 2.6, mat: 'ice' })); L.path.push({ zone: 3, x, top: t, z, w: 2.6, d: 2.6, kind: 'crumble' }); });
  P(0, 6.6, 160, 10, 9, { col: 10 }); relic(4.2, 6.6, 163, false);
  [[2.5, 7.8, 167.5], [-0.5, 9.0, 171.5], [2, 10.2, 175.5]].forEach(([x, t, z]) => P(x, t, z, 3, 3, { col: 6 }));
  P(0, 11.4, 182, 12, 10, { col: 14 });
  deco(12, 18, 92, 6, 150, 44, 'snow', 'cliff');

  // ═════ ZONE 5 · THE SKY TEMPLE ═════
  e = fr.pt(0, 11.4, 182); zone(4, e.x, e.y, e.z, Math.PI * 2);
  cp(0, 0, 0, 'Temple Steps');
  [[1, 9.5, 0], [-1, 13.3, 1], [1, 17.1, 0], [-1, 20.9, 1], [1, 24.7, 0]].forEach(([x, z, g]) => { ob(new O.Vanish(id('vanish'), fr, { at: [x, -0.3, z], w: 2.6, d: 2.6, group: g, period: 4.4 })); L.path.push({ zone: 4, x, top: 0, z, w: 2.6, d: 2.6, kind: 'vanish' }); });
  ob(new O.Vanish(id('vanish'), fr, { at: [-4.4, -0.3, 17.1], w: 2.2, d: 2.2, group: 1, period: 4.4 })); relic(-4.4, 0, 17.1);
  hint(-5, 5, -1, 5, -5, 7, 'Phantom tiles fade in and out. Hop when the next one glows solid.', 'vanish');
  P(0, 0, 31.5, 8, 8, { col: 10 });
  [[1, 0.8, 38], [-1, 1.6, 41], [1.2, 2.4, 44.2], [-0.8, 3.2, 47.4], [0.6, 4.0, 50.6]].forEach(([x, t, z]) => P(x, t, z, 1.2, 1.2, { col: 6, kind: 'hop' }));
  P(0, 4, 57, 10, 10, { col: 10 }); cp(-3.5, 4, 53, 'Sun Dais');
  ob(new O.Rotor(id('rotor'), fr, { c: [0, 4, 57], speed: 1.15, parts: [{ w: 0.5, h: 0.5, d: 9.6, y: 0.55, hazard: 8, vis: 'sweeper', spin: 1 }, { w: 0.9, h: 2.2, d: 0.9, y: 1.1, vis: 'hub', spin: 1 }] }));
  P(0, 4, 72, 3.2, 20, { mat: 'marble' }); deco(-2.2, 7.5, 72, 1.2, 20, 3.5, 'marble', 'wall'); deco(2.2, 7.5, 72, 1.2, 20, 3.5, 'marble', 'wall');
  for (let k = 0; k < 3; k++) ob(new O.Door(id('door'), fr, { closed: [0, 5.6, 66 + 6 * k], open: [0, 8.9, 66 + 6 * k], w: 3.2, h: 3.2, d: 0.5, period: 4, openFor: 1.7, phase: -k * 0.22, travel: 0.35, vis: 'templedoor', mat: 'gold' }));
  hint(-5, 5, 3, 9, 52, 62, 'Timed doors open in a wave — run when the first one lifts.', 'time');
  P(0, 4, 86, 10, 8, { col: 10 });
  P(0, 8.2, 95, 10, 10, { h: 5, kind: 'pullup' });
  hint(-5, 5, 3, 9, 82, 90, 'Another wall. Boost your partner up, then get hauled up (hold E).', 'boost');
  P(6.2, 9.4, 101.2, 1.6, 1.4, { col: 5, path: false }); P(6.2, 10.6, 103.4, 1.6, 1.4, { col: 5, path: false });
  P(5, 11.8, 107.4, 8, 2.2, { h: 0.8, path: false }); deco(9.5, 11.8, 107.4, 2, 3, 12, 'marble', 'pillar'); anchor(1.5, 11.8, 107.4); relic(8, 11.8, 107.4, false);
  hint(-5, 9, 7, 13, 90, 100, 'Final swing: anchor on the arch post (E), your partner swings to the far terrace.', 'anchor');
  P(1, 7.8, 118.25, 9, 9.5, { col: 10, kind: 'swingland' });
  ob(new O.Drums(id('drums'), fr, { pads: [[-1, 7.8, 119.5], [3, 7.8, 119.5]], v: 21, fwd: [0, 0, 4.2] }));
  hint(-4, 6, 7, 13, 113, 123, 'One last leap — JUMP TOGETHER from the drums.', 'drums');
  P(1, 16.5, 130, 14, 14, { h: 9, mat: 'gold', kind: 'summit' });
  L.bell = { pos: fr.pt(1, 16.5, 132), r: 4.5 };
  addS({ ...fr.pt(1, 20.2, 132), w: 0.5, h: 0.5, d: 0.5, mat: 'gold', vis: 'bellhang' });
  deco(11, 20, 77, 6, 125, 36, 'marble', 'cliff');
  L.summitY = L.bell.pos.y; L.startY = L.cps[0].pos.y;
  return L;
}

// gap/rise feasibility of the main route (used by tests and the dev overlay)
export function routeReport(L) {
  const out = [];
  for (let i = 1; i < L.path.length; i++) {
    const a = L.path[i - 1], b = L.path[i]; if (a.zone !== b.zone) continue;
    const gz = Math.max(0, (b.z - b.d / 2) - (a.z + a.d / 2)), gx = Math.max(0, Math.abs(b.x - a.x) - (a.w + b.w) / 2);
    out.push({ i, from: a.kind, to: b.kind, zone: a.zone, gap: Math.hypot(gz, gx), rise: b.top - a.top });
  }
  return out;
}
