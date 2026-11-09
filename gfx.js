// Procedural textures, materials and box geometry for TETHERED. Everything is generated at load time:
// no external image assets, so the whole game ships as a handful of static files.
import * as THREE from './three.module.js';

let Q = 'high'; export function setGfxQuality(q) { Q = q; }
const TEX = {}, MAT = {};
const rnd = (() => { let s = 1234567; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
function canvas(n = 256) { const c = document.createElement('canvas'); c.width = c.height = n; return [c, c.getContext('2d')]; }
function noise(g, n, a, col = '0,0,0') { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${col},${a * rnd()})`; const s = 1 + rnd() * 3; g.fillRect(rnd() * 256, rnd() * 256, s, s); } }
const MAKE = {
  brick(g) { g.fillStyle = '#d9a46c'; g.fillRect(0, 0, 256, 256); for (let r = 0; r < 8; r++) for (let c = 0; c < 4; c++) { const x = c * 64 + (r % 2) * 32, y = r * 32; const t = 200 + rnd() * 40; g.fillStyle = `rgb(${t},${t * 0.72 | 0},${t * 0.47 | 0})`; g.fillRect(x + 2, y + 2, 60, 28); g.fillRect(x - 254, y + 2, 60, 28); } noise(g, 2500, 0.18); g.strokeStyle = 'rgba(80,40,10,.35)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 253, 253); },
  grass(g) { g.fillStyle = '#7fae4a'; g.fillRect(0, 0, 256, 256); noise(g, 3000, 0.25, '40,80,20'); noise(g, 1500, 0.25, '200,230,120'); },
  moss(g) { g.fillStyle = '#6f9a46'; g.fillRect(0, 0, 256, 256); noise(g, 3500, 0.3, '30,60,20'); noise(g, 900, 0.3, '220,210,140'); },
  plank(g) { for (let i = 0; i < 4; i++) { const t = 150 + rnd() * 40; g.fillStyle = `rgb(${t},${t * 0.64 | 0},${t * 0.38 | 0})`; g.fillRect(0, i * 64, 256, 64); g.fillStyle = 'rgba(40,20,5,.5)'; g.fillRect(0, i * 64, 256, 3); for (let k = 0; k < 18; k++) { g.fillStyle = `rgba(60,30,10,${0.15 * rnd()})`; g.fillRect(0, i * 64 + rnd() * 64, 256, 1 + rnd() * 2); } g.fillStyle = 'rgba(30,20,10,.6)'; g.beginPath(); g.arc(20, i * 64 + 32, 3, 0, 7); g.arc(236, i * 64 + 32, 3, 0, 7); g.fill(); } },
  slate(g) { g.fillStyle = '#7d8a99'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '20,30,45'},${0.08 + rnd() * 0.08})`; g.beginPath(); const x = rnd() * 256, y = rnd() * 256; g.moveTo(x, y); g.lineTo(x + 40 + rnd() * 60, y + rnd() * 20 - 10); g.lineTo(x + 30, y + 20 + rnd() * 20); g.fill(); } noise(g, 2000, 0.2); },
  rust(g) { g.fillStyle = '#8d5a3a'; g.fillRect(0, 0, 256, 256); noise(g, 4000, 0.35, '60,25,10'); noise(g, 1500, 0.3, '220,140,70'); g.strokeStyle = 'rgba(30,15,5,.6)'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 252); g.strokeRect(2, 2, 124, 252); g.fillStyle = 'rgba(40,20,8,.8)'; for (const [x, y] of [[12, 12], [116, 12], [12, 244], [116, 244], [140, 12], [244, 12], [140, 244], [244, 244]]) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); } },
  grate(g) { g.fillStyle = '#4a4f55'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#2a2d31'; g.lineWidth = 6; for (let i = 0; i <= 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); } noise(g, 1500, 0.2, '200,120,60'); },
  metal(g) { const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, '#9aa3ad'); gr.addColorStop(1, '#6e7781'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); noise(g, 1500, 0.12); g.strokeStyle = 'rgba(20,25,30,.6)'; g.lineWidth = 3; g.strokeRect(2, 2, 252, 252); g.fillStyle = '#3b4148'; for (const x of [14, 242]) for (const y of [14, 242]) { g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill(); } },
  hazard(g) { g.fillStyle = '#f2b01e'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#1d1d1d'; for (let i = -256; i < 512; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 32 + 256, 256); g.lineTo(i + 256, 256); g.fill(); } noise(g, 1200, 0.2); },
  belt(g) { g.fillStyle = '#26282b'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#3a3d41'; for (let i = 0; i < 256; i += 32) g.fillRect(0, i, 256, 14); g.fillStyle = '#f2b01e'; g.fillRect(0, 0, 12, 256); g.fillRect(244, 0, 12, 256); g.fillStyle = 'rgba(255,255,255,.18)'; for (let i = 0; i < 256; i += 64) { g.beginPath(); g.moveTo(100, i + 10); g.lineTo(156, i + 10); g.lineTo(128, i + 40); g.fill(); } },
  snow(g) { g.fillStyle = '#eef6ff'; g.fillRect(0, 0, 256, 256); noise(g, 2500, 0.08, '120,150,190'); noise(g, 600, 0.5, '255,255,255'); },
  rock(g) { g.fillStyle = '#6c7480'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '230,240,255' : '20,25,35'},${0.06 + rnd() * 0.1})`; g.fillRect(rnd() * 256, rnd() * 256, 20 + rnd() * 60, 6 + rnd() * 12); } noise(g, 2000, 0.2); },
  ice(g) { const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#d8f3ff'); gr.addColorStop(1, '#9fd6f2'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1.5; for (let i = 0; i < 14; i++) { g.beginPath(); let x = rnd() * 256, y = rnd() * 256; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rnd() * 50 - 25; y += rnd() * 50 - 25; g.lineTo(x, y); } g.stroke(); } },
  marble(g) { g.fillStyle = '#f4efe6'; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(150,140,130,.25)'; g.lineWidth = 2; for (let i = 0; i < 10; i++) { g.beginPath(); let x = rnd() * 256, y = 0; g.moveTo(x, y); while (y < 256) { x += rnd() * 30 - 15; y += 20; g.lineTo(x, y); } g.stroke(); } g.strokeStyle = 'rgba(200,160,70,.8)'; g.lineWidth = 5; g.strokeRect(2.5, 2.5, 251, 251); },
  tiles(g) { g.fillStyle = '#efe7da'; g.fillRect(0, 0, 256, 256); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) { g.fillStyle = (r + c) % 2 ? '#e6dccb' : '#f7f1e7'; g.fillRect(c * 64 + 2, r * 64 + 2, 60, 60); } g.strokeStyle = 'rgba(200,160,70,.7)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 253, 253); },
  gold(g) { const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, '#ffe08a'); gr.addColorStop(0.5, '#e0a93a'); gr.addColorStop(1, '#ffd36a'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); noise(g, 900, 0.15, '120,70,10'); g.strokeStyle = 'rgba(120,70,10,.5)'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 252); },
  crystal(g) { const gr = g.createLinearGradient(0, 0, 256, 256); gr.addColorStop(0, '#b9a6ff'); gr.addColorStop(1, '#7de3ff'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 4; g.strokeRect(4, 4, 248, 248); g.beginPath(); g.moveTo(0, 128); g.lineTo(128, 0); g.lineTo(256, 128); g.lineTo(128, 256); g.closePath(); g.stroke(); },
  drum(g) { g.fillStyle = '#c8343c'; g.fillRect(0, 0, 256, 256); g.fillStyle = '#f6e7c8'; g.beginPath(); g.arc(128, 128, 100, 0, 7); g.fill(); g.strokeStyle = '#7a1a20'; g.lineWidth = 10; g.stroke(); g.fillStyle = '#c8343c'; g.font = 'bold 120px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('2', 128, 134); },
  plate(g) { g.fillStyle = '#2b3b52'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#7de3ff'; g.lineWidth = 12; g.strokeRect(16, 16, 224, 224); g.beginPath(); g.arc(128, 128, 60, 0, 7); g.stroke(); },
  cloud(g) { const gr = g.createRadialGradient(128, 128, 10, 128, 128, 126); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); },
  dot(g) { const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); },
  ring(g) { g.strokeStyle = 'white'; g.lineWidth = 14; g.beginPath(); g.arc(128, 128, 100, 0, 7); g.stroke(); g.lineWidth = 5; g.beginPath(); g.arc(128, 128, 70, 0, 7); g.stroke(); },
  shadow(g) { const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(0,0,0,.7)'); gr.addColorStop(0.7, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); },
  flag(g) { g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256); g.fillStyle = 'rgba(0,0,0,.12)'; for (let i = 0; i < 256; i += 32) g.fillRect(0, i, 256, 8); },
};
export function tex(name) {
  if (TEX[name]) return TEX[name]; const [c, g] = canvas(); (MAKE[name] || MAKE.rock)(g);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Q === 'low' ? 1 : 8; return TEX[name] = t;
}
// surface → [side texture, top texture, tint side, tint top, roughness, metalness, uv metres per repeat]
export const SURF = {
  sand: ['brick', 'moss', 0xffffff, 0xffffff, 0.9, 0, 2.5], stone: ['brick', 'moss', 0xffffff, 0xffffff, 0.9, 0, 2.5],
  wood: ['plank', 'plank', 0xffffff, 0xffffff, 0.8, 0, 2], slate: ['slate', 'grass', 0xffffff, 0xd6f0c0, 0.9, 0, 4],
  rust: ['rust', 'grate', 0xffffff, 0xffffff, 0.7, 0.2, 3], metal: ['metal', 'grate', 0xffffff, 0xd8dde3, 0.5, 0.3, 2.5],
  belt: ['metal', 'belt', 0xffffff, 0xffffff, 0.6, 0.2, 3], snow: ['rock', 'snow', 0xe8eef8, 0xffffff, 0.85, 0, 4],
  ice: ['ice', 'ice', 0xffffff, 0xffffff, 0.12, 0.05, 3], marble: ['marble', 'tiles', 0xffffff, 0xffffff, 0.35, 0, 3],
  gold: ['gold', 'tiles', 0xffffff, 0xfff1c8, 0.35, 0.3, 3], crystal: ['crystal', 'crystal', 0xffffff, 0xffffff, 0.2, 0.1, 2.6],
  plate: ['plate', 'plate', 0xffffff, 0xffffff, 0.5, 0.2, 1.6], drum: ['drum', 'drum', 0xffffff, 0xffffff, 0.6, 0, 2],
};
export function surfMats(key) {
  if (MAT[key]) return MAT[key]; const s = SURF[key] || SURF.stone; const M = Q === 'low' ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial;
  const mk = (t, tint) => { const o = { map: tex(t), color: tint, vertexColors: true }; if (M === THREE.MeshStandardMaterial) { o.roughness = s[4]; o.metalness = s[5]; } return new M(o); };
  const side = mk(s[0], s[2]), top = s[1] === s[0] && s[2] === s[3] ? side : mk(s[1], s[3]);
  if (key === 'ice') { for (const m of [side]) { m.transparent = true; m.opacity = 0.88; if (m.emissive) { m.emissive.set(0x4aa8d8); m.emissiveIntensity = 0.15; } } }
  if (key === 'crystal') { side.transparent = true; side.opacity = 0.85; if (side.emissive) { side.emissive.set(0x8f7dff); side.emissiveIntensity = 0.55; } }
  return MAT[key] = { side, top, uv: s[6] };
}

// geometry for one or many boxes: groups 0 = sides, 1 = tops. Vertex colours carry a soft height gradient
// (cheap ambient occlusion) so towers read clearly even without shadows.
export class BoxBatch {
  constructor() { this.s = { p: [], n: [], u: [], c: [] }; this.t = { p: [], n: [], u: [], c: [] }; }
  add(b, uvScale = 2.5, local = false, tint = 1) {
    const m = local ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : b.m, h = b.h, c = local ? { x: 0, y: 0, z: 0 } : b.c;
    const ax = [m[0], m[1], m[2]], ay = [m[3], m[4], m[5]], az = [m[6], m[7], m[8]];
    const W = (lx, ly, lz) => [c.x + ax[0] * lx + ay[0] * ly + az[0] * lz, c.y + ax[1] * lx + ay[1] * ly + az[1] * lz, c.z + ax[2] * lx + ay[2] * ly + az[2] * lz];
    const N = (nx, ny, nz) => [ax[0] * nx + ay[0] * ny + az[0] * nz, ax[1] * nx + ay[1] * ny + az[1] * nz, ax[2] * nx + ay[2] * ny + az[2] * nz];
    const faces = [ // [normal, u axis, v axis, half extents along n/u/v]
      [[0, 1, 0], [1, 0, 0], [0, 0, -1], h.y, h.x, h.z, 1], [[0, -1, 0], [1, 0, 0], [0, 0, 1], h.y, h.x, h.z, 0],
      [[1, 0, 0], [0, 0, -1], [0, 1, 0], h.x, h.z, h.y, 0], [[-1, 0, 0], [0, 0, 1], [0, 1, 0], h.x, h.z, h.y, 0],
      [[0, 0, 1], [1, 0, 0], [0, 1, 0], h.z, h.x, h.y, 0], [[0, 0, -1], [-1, 0, 0], [0, 1, 0], h.z, h.x, h.y, 0]];
    const H = h.y * 2;
    for (const [n, u, v, en, eu, ev, isTop] of faces) {
      const A = isTop && b.upright !== false ? this.t : this.s; const nn = N(...n);
      const corner = (su, sv) => { const lx = n[0] * en + u[0] * eu * su + v[0] * ev * sv, ly = n[1] * en + u[1] * eu * su + v[1] * ev * sv, lz = n[2] * en + u[2] * eu * su + v[2] * ev * sv; return [W(lx, ly, lz), (eu * su) / uvScale, (ev * sv) / uvScale, ly]; };
      const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
      for (const k of [0, 1, 2, 0, 2, 3]) { const [p, uu, vv, ly] = q[k]; A.p.push(...p); A.n.push(...nn); A.u.push(uu + 0.5, vv + 0.5);
        let shade = 1; if (!isTop) { const f = (ly + h.y) / H; shade = n[1] < -0.5 ? 0.45 : 0.42 + 0.58 * Math.min(1, Math.pow(f, 0.6) + (H < 3 ? 0.25 : 0)); } shade *= tint; A.c.push(shade, shade, shade); }
    }
  }
  geometry() { const g = new THREE.BufferGeometry(); const cat = (k) => [...this.s[k], ...this.t[k]];
    g.setAttribute('position', new THREE.Float32BufferAttribute(cat('p'), 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(cat('n'), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(cat('u'), 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(cat('c'), 3));
    const ns = this.s.p.length / 3, nt = this.t.p.length / 3; g.addGroup(0, ns, 0); g.addGroup(ns, nt, 1); g.computeBoundingSphere(); return g; }
}
export const spriteMat = (name, color = 0xffffff, add = false) => new THREE.SpriteMaterial({ map: tex(name), color, transparent: true, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
export function textSprite(text, o = {}) {
  const [c, g] = canvas(256); g.clearRect(0, 0, 256, 256); g.fillStyle = o.bg || 'rgba(15,20,35,.85)'; g.beginPath(); g.roundRect(28, 68, 200, 120, 30); g.fill(); g.strokeStyle = o.fg || '#ffd978'; g.lineWidth = 6; g.stroke();
  g.fillStyle = o.fg || '#ffd978'; g.font = `800 ${o.size || 64}px Outfit, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 130);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false })); s.scale.set(1.2, 1.2, 1); return s;
}
