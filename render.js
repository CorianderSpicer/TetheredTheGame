// Rendering: sky, light, fog, the merged static world, obstacle meshes, decor, the two climbers, the chain,
// particles and the camera rig. Reads simulation state; never writes it.
import * as THREE from './three.module.js';
import { BoxBatch, surfMats, tex, spriteMat, textSprite, setGfxQuality } from './gfx.js';
import { Climber } from './char.js';
import { ZONES } from './level.js';

const PAL = [ // sky top, horizon, fog, sun, hemi ground
  ['#5aa6e8', '#ffdcae', '#f0d2a6', '#fff0d0', '#a07850'], ['#3f86d4', '#d8ecff', '#c4dbeb', '#ffffff', '#5d7088'],
  ['#5d6f99', '#f2b27c', '#cf9f7f', '#ffd2a0', '#6b4a35'], ['#76aee6', '#f4f9ff', '#e2edf8', '#fff8ee', '#9ab0c8'], ['#3550b8', '#ffc4a2', '#ffd7c2', '#fff0c8', '#c09080']];
export const CHAIN_STYLES = [{ id: 'steel', name: 'Steel', color: '#c9d2dc', metal: 0.9, unlock: 0 }, { id: 'rope', name: 'Rope', color: '#c9a06a', metal: 0, unlock: 0 }, { id: 'gold', name: 'Gold', color: '#ffcf4a', metal: 0.95, unlock: 3 }, { id: 'neon', name: 'Neon', color: '#3cf2ff', metal: 0.2, unlock: 6, glow: true }, { id: 'rose', name: 'Rose Quartz', color: '#ff8fc0', metal: 0.5, unlock: 9, glow: true }];
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), C = (h) => new THREE.Color(h);
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

export class Renderer {
  constructor(canvas, L, opts = {}) {
    this.L = L; this.q = opts.quality || 'high'; setGfxQuality(this.q);
    const r = this.r = new THREE.WebGLRenderer({ canvas, antialias: this.q !== 'low', powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = this.q !== 'low'; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene(); this.cam = new THREE.PerspectiveCamera(opts.fov || 62, 1, 0.1, 900);
    this.fog = this.scene.fog = new THREE.Fog(0xffffff, 60, 330);
    this.boxMeshes = new Map(); this.fx = []; this.t = 0; this.mixPal = PAL[0].map(C);
    this.sky(); this.lights(); this.envMap(); this.world(); this.massif(); this.decor(); this.dynamics(); this.markers(); this.particles();
    const party = opts.party && opts.party.length ? opts.party : [opts.p1 || {}, opts.p2 || {}];
    this.chars = party.map(o => new Climber(o || {})); for (const c of this.chars) { this.scene.add(c.root); this.scene.add(c.blob); }
    this.chainMesh(opts.chainStyle || 'steel'); this.resize();
  }
  setQuality(q) { this.q = q; const pr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.25 : 0.8); this.r.setPixelRatio(pr); this.r.shadowMap.enabled = q !== 'low'; this.sun.castShadow = q !== 'low';
    const s = q === 'high' ? 2048 : 1024; if (this.sun.shadow.mapSize.x !== s) { this.sun.shadow.mapSize.set(s, s); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; } this.fog.far = q === 'low' ? 220 : 330; this.decorGroup.visible = true; this.resize(); }
  resize() { const w = this.r.domElement.clientWidth || innerWidth, h = this.r.domElement.clientHeight || innerHeight; this.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q === 'high' ? 2 : this.q === 'medium' ? 1.25 : 0.8)); this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }

  sky() {
    const g = new THREE.SphereGeometry(800, 32, 16); this.skyU = { top: { value: C('#5aa6e8') }, hor: { value: C('#ffdcae') }, sun: { value: v3().set(0.4, 0.6, 0.3).normalize() }, sunC: { value: C('#fff0d0') } };
    const m = new THREE.ShaderMaterial({ uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vd; void main(){ vd = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 sun; uniform vec3 sunC; varying vec3 vd; void main(){ float h = clamp(vd.y,-1.0,1.0); vec3 c = mix(hor, top, pow(max(h,0.0),0.55)); c = mix(c, hor*0.92, smoothstep(0.0,-0.25,h)); float s = max(dot(vd, sun),0.0); c += sunC * (pow(s,600.0)*2.5 + pow(s,12.0)*0.25); gl_FragColor = vec4(c,1.0); }' });
    this.skyMesh = new THREE.Mesh(g, m); this.skyMesh.renderOrder = -1; this.scene.add(this.skyMesh);
  }
  envMap() { // soft image-based light so metals (bell, gold, chain) reflect a sky instead of rendering black
    const pm = new THREE.PMREMGenerator(this.r), es = new THREE.Scene(), g = new THREE.SphereGeometry(10, 32, 16), col = [], p = g.attributes.position, top = C('#8cc4ff'), hor = C('#ffe2bd'), gnd = C('#6b5a48');
    for (let i = 0; i < p.count; i++) { const y = p.getY(i) / 10; const c = y > 0 ? hor.clone().lerp(top, Math.pow(y, 0.6)) : hor.clone().lerp(gnd, Math.min(1, -y * 3)); col.push(c.r, c.g, c.b); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); es.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const sunM = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.5, 4.5) })); sunM.position.copy(this.sunDirInit).multiplyScalar(8); es.add(sunM);
    this.scene.environment = pm.fromScene(es, 0.02).texture; this.scene.environmentIntensity = 0.55; pm.dispose(); }
  lights() {
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0xa07850, 0.8); this.scene.add(this.hemi);
    const s = this.sun = new THREE.DirectionalLight(0xfff0d0, 2.6); s.castShadow = this.q !== 'low'; const ss = this.q === 'high' ? 2048 : 1024; s.shadow.mapSize.set(ss, ss);
    const sc = s.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 160; s.shadow.bias = -0.0004; s.shadow.normalBias = 0.04; this.scene.add(s, s.target);
    this.sunDir = v3().set(0.45, 0.75, 0.35).normalize(); this.sunDirInit = this.sunDir.clone();
  }
  world() {
    const batches = {}; for (const b of this.L.statics) { if (b.vis === 'anchor' || b.vis === 'bellhang') continue; const k = b.mat; (batches[k] ||= new BoxBatch()).add(b, surfMats(k).uv, false, b.vis === 'cliff' ? 0.92 : 1); }
    this.statics = []; for (const [k, bb] of Object.entries(batches)) { const m = surfMats(k); const mesh = new THREE.Mesh(bb.geometry(), [m.side, m.top]); mesh.castShadow = mesh.receiveShadow = true; this.scene.add(mesh); this.statics.push(mesh); }
    // anchors: post + ring
    const postM = new THREE.MeshStandardMaterial({ color: '#59616b', metalness: 0.8, roughness: 0.35 }); this.anchorRings = [];
    for (const o of this.L.obs) if (o.type === 'anchor') { const g = new THREE.Group(); g.position.set(o.pos.x, o.pos.y, o.pos.z);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.1, 10), postM); post.position.y = 0.55; post.castShadow = true; g.add(post);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 20), new THREE.MeshStandardMaterial({ color: '#ffd978', emissive: '#ffb020', emissiveIntensity: 0.8, metalness: 0.8, roughness: 0.3 })); ring.position.y = 1.15; g.add(ring); this.anchorRings.push({ ring, o });
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 32), new THREE.MeshBasicMaterial({ color: '#ffd978', transparent: true, opacity: 0.45, depthWrite: false })); halo.rotation.x = -Math.PI / 2; halo.position.y = 0.03; g.add(halo); this.scene.add(g); }
    // summit bell
    const bp = this.L.bell.pos, bell = new THREE.Group(); bell.position.set(bp.x, bp.y, bp.z); const gold = new THREE.MeshStandardMaterial({ color: '#ffcf4a', metalness: 0.9, roughness: 0.25, emissive: '#5a3a00', emissiveIntensity: 0.3 });
    const prof = []; for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(0.15 + Math.pow(t, 2.2) * 1.0, 2.2 - t * 1.6)); } const bm = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), gold); bm.position.y = 1.4; bm.castShadow = true; bell.add(bm); this.bellMesh = bm;
    const marbleM = new THREE.MeshStandardMaterial({ map: tex('marble'), roughness: 0.35 }); for (const x of [-1.8, 1.8]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 4.4, 14), marbleM); p.position.set(x, 2.2, 0); p.castShadow = true; bell.add(p); } const top = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.5, 1.0), gold); top.position.y = 4.4; bell.add(top); this.scene.add(bell);
  }
  massif() {
    // central peak: radius at each height keeps clear of every platform near that height
    const xs = this.L.statics.filter(b => b.vis !== 'cliff'); let cx = 0, cz = 0; for (const z of this.L.zones) { cx += z.frame.o.x; cz += z.frame.o.z; } cx /= this.L.zones.length; cz /= this.L.zones.length;
    cx += 30; cz += 10; this.center = { x: cx, z: cz };
    const H = [], R = []; for (let y = -60; y <= 130; y += 10) { let md = 999; for (const b of xs) { if (b.aabb.y1 < y - 14 || b.aabb.y0 > y + 14) continue; const dx = Math.max(0, Math.abs(b.c.x - cx) - (b.aabb.x1 - b.aabb.x0) / 2), dz = Math.max(0, Math.abs(b.c.z - cz) - (b.aabb.z1 - b.aabb.z0) / 2); md = Math.min(md, Math.hypot(dx, dz)); }
      H.push(y); R.push(Math.max(6, Math.min(90, md - 9))); }
    const top = this.L.summitY + 40; const pts = []; for (let i = 0; i < H.length; i++) pts.push(new THREE.Vector2(R[i] * (H[i] > top - 60 ? Math.max(0.05, (top - H[i]) / 60) : 1), H[i])); pts.push(new THREE.Vector2(0.01, top));
    const g = new THREE.LatheGeometry(pts, 56).toNonIndexed(); const p = g.attributes.position, rnd = rng(7), col = [];
    const zc = [C('#c9935a'), C('#6f7c8c'), C('#7a5a46'), C('#e9f1fb'), C('#ffffff')];
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const a = Math.atan2(z, x), n = Math.sin(a * 5 + y * 0.07) * 3 + Math.sin(a * 13 - y * 0.15) * 1.6 + Math.sin(y * 0.3) * 1.2; const r = Math.hypot(x, z); const k = r > 0.5 ? (r + n) / r : 1; p.setXYZ(i, x * k, y, z * k); }
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); const zi = Math.max(0, Math.min(4, (y - 2) / 17)); const a = Math.floor(zi), b = Math.min(4, a + 1); const c = zc[a].clone().lerp(zc[b], zi - a); const j = 0.9 + rnd() * 0.2; col.push(c.r * j, c.g * j, c.b * j); }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 })); m.position.set(cx, 0, cz); m.receiveShadow = true; this.scene.add(m); this.massifMesh = m;
    // far ring of mountains + ground haze
    const ring = new THREE.Group(); const mm = new THREE.MeshStandardMaterial({ color: '#8a9bb4', flatShading: true, roughness: 1 }); const rr = rng(3);
    for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2 + rr() * 0.2, d = 380 + rr() * 180, h = 80 + rr() * 160; const c = new THREE.Mesh(new THREE.ConeGeometry(60 + rr() * 70, h, 7), mm); c.position.set(cx + Math.cos(a) * d, -60 + h / 2, cz + Math.sin(a) * d); c.rotation.y = rr() * 3; ring.add(c); }
    this.scene.add(ring); const gnd = new THREE.Mesh(new THREE.CircleGeometry(900, 40), new THREE.MeshStandardMaterial({ color: '#7c8f6a', roughness: 1 })); gnd.rotation.x = -Math.PI / 2; gnd.position.set(cx, -60, cz); this.scene.add(gnd);
  }
  decor() {
    const G = this.decorGroup = new THREE.Group(); this.scene.add(G); const rnd = rng(11), M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true, ...o });
    const kinds = { trunk: [new THREE.CylinderGeometry(0.18, 0.26, 2, 6), M('#6b4a2e')], blob: [new THREE.IcosahedronGeometry(1.3, 0), M('#6fae4a')], pine: [new THREE.ConeGeometry(1.2, 3.4, 7), M('#3f7d52')], snowpine: [new THREE.ConeGeometry(1.2, 3.4, 7), M('#dfeefa')],
      rock: [new THREE.DodecahedronGeometry(1, 0), M('#8b8f96')], column: [new THREE.CylinderGeometry(0.5, 0.55, 1, 10), M('#e2c08f')], mcol: [new THREE.CylinderGeometry(0.45, 0.45, 1, 14), M('#f2ede3', { flatShading: false, roughness: 0.4 })],
      pipe: [new THREE.CylinderGeometry(0.35, 0.35, 1, 10), M('#7f5f48', { metalness: 0.5, roughness: 0.5, flatShading: false })], tank: [new THREE.CylinderGeometry(1.6, 1.6, 4, 16), M('#9c6a45', { metalness: 0.4, roughness: 0.6, flatShading: false })],
      spike: [new THREE.ConeGeometry(0.5, 2.6, 5), M('#bfe6ff', { transparent: true, opacity: 0.9, roughness: 0.2, emissive: '#2a6c9a', emissiveIntensity: 0.2 })], island: [new THREE.ConeGeometry(3, 5, 7), M('#a58a6c')], cap: [new THREE.CylinderGeometry(0.62, 0.62, 0.3, 14), M('#ffcf4a', { metalness: 0.8, roughness: 0.3, flatShading: false })] };
    const list = {}; const put = (k, x, y, z, sx, sy, sz, ry = 0, rx = 0) => (list[k] ||= []).push([x, y, z, sx, sy, sz, ry, rx]);
    for (const z of this.L.zones) { const f = z.frame, k = z.idx; const n = this.q === 'low' ? 22 : 46;
      for (let i = 0; i < n; i++) { const lz = rnd() * 175, side = rnd() < 0.7 ? -1 : 1, lx = side < 0 ? -(9 + rnd() * 26) : 10 + rnd() * 8, ly = -6 - rnd() * 22 + (rnd() < 0.3 ? 14 : 0); const p = f.pt(lx, ly + lz * 0.12, lz), s = 0.7 + rnd() * 1.3;
        if (k !== 4) put('island', p.x, p.y - 0.2, p.z, s * 0.55, -s * 0.6, s * 0.55, rnd() * 3);
        if (k === 0) { if (rnd() < 0.5) { put('column', p.x, p.y + 2 * s, p.z, s, 4 * s * (0.4 + rnd()), s); } else { put('trunk', p.x, p.y + s, p.z, s, s, s); put('blob', p.x, p.y + 2.6 * s, p.z, s, s, s, rnd() * 3); } }
        else if (k === 1) { if (rnd() < 0.6) { put('pine', p.x, p.y + 1.7 * s, p.z, s, s, s); put('trunk', p.x, p.y + 0.3 * s, p.z, s * 0.7, s * 0.4, s * 0.7); } else put('rock', p.x, p.y, p.z, s * 2, s * 1.4, s * 2, rnd() * 3); }
        else if (k === 2) { if (rnd() < 0.5) put('pipe', p.x, p.y + 6, p.z, 1.2 * s, 12 * s, 1.2 * s, 0, rnd() < 0.5 ? Math.PI / 2 : 0); else put('tank', p.x, p.y + 2 * s, p.z, s, s, s); }
        else if (k === 3) { if (rnd() < 0.55) { put('snowpine', p.x, p.y + 1.7 * s, p.z, s, s, s); } else put('spike', p.x, p.y + 1.3 * s, p.z, s, s * 1.5, s, rnd() * 3, (rnd() - 0.5) * 0.4); }
        else { const q = f.pt(side < 0 ? -(14 + rnd() * 50) : 14 + rnd() * 30, -8 - rnd() * 30 + lz * 0.1, lz + rnd() * 40 - 20); put('island', q.x, q.y, q.z, s * 1.5, -s * 1.4, s * 1.5, rnd() * 3); put('blob', q.x, q.y + 0.6 * s, q.z, s * 1.4, s * 0.8, s * 1.4); if (rnd() < 0.6) { put('mcol', p.x, p.y + 6, p.z, s, 12 * s, s); put('cap', p.x, p.y + 6 + 6 * s, p.z, s, s, s); } }
      } }
    // ruins colonnade on the start plaza & temple colonnade at the top
    const f0 = this.L.zones[0].frame; for (const [x, z, h] of [[-7.4, -2, 4], [-7.4, 4, 2.2], [-7.4, 10, 3.4], [7.4, -2, 3], [7.4, 10, 1.4]]) { const p = f0.pt(x, 0, z); put('column', p.x, p.y + h / 2, p.z, 1, h, 1); }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = v3(), ps = v3();
    for (const [k, arr] of Object.entries(list)) { const [g, mat] = kinds[k]; const im = new THREE.InstancedMesh(g, mat, arr.length); arr.forEach((a, i) => { e.set(a[7], a[6], 0); q.setFromEuler(e); m4.compose(ps.set(a[0], a[1], a[2]), q, sc.set(a[3], a[4], a[5])); im.setMatrixAt(i, m4); }); im.castShadow = false; im.receiveShadow = true; G.add(im); }
    // cloud sea under the temple
    const cg = new THREE.BufferGeometry(), cp = [], cy = (this.L.zones[this.L.zones.length - 1] || this.L.zones[0]).y0 - 9; for (let i = 0; i < (this.q === 'low' ? 160 : 380); i++) { const a = rnd() * Math.PI * 2, d = 20 + rnd() * 320; cp.push(this.center.x + Math.cos(a) * d, cy + rnd() * 6 - 3, this.center.z + Math.sin(a) * d); }
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); const clouds = new THREE.Points(cg, new THREE.PointsMaterial({ map: tex('cloud'), size: 46, transparent: true, depthWrite: false, opacity: 0.85, color: '#fff6ee', sizeAttenuation: true })); this.scene.add(clouds);
    // flags show the wind
    this.flags = []; const fm = new THREE.MeshStandardMaterial({ map: tex('flag'), color: '#ff5d5d', side: THREE.DoubleSide, roughness: 0.8 }), pm = new THREE.MeshStandardMaterial({ color: '#5a4a3a' });
    for (const w of this.L.winds) { const n = 3; for (let i = 0; i < n; i++) { const x = w.x0 + (w.x1 - w.x0) * (0.2 + 0.6 * i / (n - 1)), z = w.z0 + (w.z1 - w.z0) * (0.2 + 0.6 * i / (n - 1)); const g = new THREE.Group(); g.position.set(x, w.y0 + 3, z);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3), pm); pole.position.y = 1.5; g.add(pole); const fg = new THREE.PlaneGeometry(1.4, 0.6, 8, 1); fg.translate(0.7, 0, 0); const fl = new THREE.Mesh(fg, fm); fl.position.y = 2.7; g.add(fl); this.scene.add(g); this.flags.push({ g, fl, w, base: fg.attributes.position.array.slice() }); } }
  }
  dynamics() {
    for (const o of this.L.obs) for (const b of o.boxes) {
      let mesh; const vis = b.vis || 'box';
      if (vis === 'icicle') { mesh = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.8, 6).rotateX(Math.PI), new THREE.MeshStandardMaterial({ color: '#d8f3ff', roughness: 0.15, transparent: true, opacity: 0.9, emissive: '#5ab6e8', emissiveIntensity: 0.25 })); o.shadowMesh = new THREE.Mesh(new THREE.CircleGeometry(0.9, 18), new THREE.MeshBasicMaterial({ map: tex('shadow'), transparent: true, depthWrite: false, color: '#3366aa' })); o.shadowMesh.rotation.x = -Math.PI / 2; this.scene.add(o.shadowMesh); }
      else if (vis === 'drum') { mesh = new THREE.Group(); const body = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.05, 0.3, 24), new THREE.MeshStandardMaterial({ color: '#c8343c', roughness: 0.5 })); const top = new THREE.Mesh(new THREE.CircleGeometry(0.92, 24), new THREE.MeshStandardMaterial({ map: tex('drum'), emissive: '#ff6040', emissiveIntensity: 0 })); top.rotation.x = -Math.PI / 2; top.position.y = 0.155; mesh.add(body, top); mesh.userData.top = top; }
      else if (vis === 'plate') { mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.85, 0.12, 24), new THREE.MeshStandardMaterial({ map: tex('plate'), emissive: '#3fdcff', emissiveIntensity: 0.1, roughness: 0.4 })); }
      else if (vis === 'hammer') { mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 2.0, 16).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex('hazard'), metalness: 0.4, roughness: 0.5 })); }
      else if (vis === 'leverpost') { mesh = new THREE.Group(); const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), new THREE.MeshStandardMaterial({ map: tex('metal'), metalness: 0.3, roughness: 0.5 })); base.position.y = -0.35; const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0), new THREE.MeshStandardMaterial({ color: '#555' })); stick.position.y = 0.1; const knob = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshStandardMaterial({ color: '#e33', emissive: '#a00', emissiveIntensity: 0.4 })); knob.position.y = 0.6; const arm = new THREE.Group(); arm.add(stick, knob); arm.position.y = -0.3; mesh.add(base, arm); mesh.userData.arm = arm; mesh.userData.knob = knob; }
      else { const bb = new BoxBatch(); const m = surfMats(b.mat); bb.add(b, m.uv, true); mesh = new THREE.Mesh(bb.geometry(), [m.side, m.top]); if (vis === 'vanish') { const mm = m.side.clone(); mm.transparent = true; mesh.material = [mm, mm]; } if (vis === 'belt') { } }
      mesh.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); this.scene.add(mesh); this.boxMeshes.set(b, mesh);
    }
  }
  markers() {
    this.marks = []; const add = (o, text, at, fg) => { const s = textSprite(text, { fg }); s.position.set(at.x, at.y, at.z); this.scene.add(s); this.marks.push({ s, o, base: at.y }); return s; };
    for (const o of this.L.obs) {
      if (o.type === 'drums') { const p = o.pads; add(o, 'JUMP!', { x: (p[0].x + p[1].x) / 2, y: p[0].y + 3.2, z: (p[0].z + p[1].z) / 2 }, '#ff8a6a'); }
      if (o.type === 'plates') for (const p of o.pl) add(o, '1+1', { x: p.x, y: p.y + 2.6, z: p.z }, '#7de3ff');
      if (o.type === 'lever') for (const p of o.levers) add(o, 'E', { x: p.x, y: p.y + 2.2, z: p.z }, '#ffd978');
      if (o.type === 'anchor') add(o, 'E', { x: o.pos.x, y: o.pos.y + 2.3, z: o.pos.z }, '#ffd978');
      if (o.type === 'elevator' || o.type === 'ferry') add(o, '2P', { x: o.a.x, y: o.a.y + 3, z: o.a.z }, '#9cff8a');
    }
    // checkpoints: flag + pad ring
    this.cpMeshes = this.L.cps.map(c => { const g = new THREE.Group(); g.position.set(c.pos.x, c.pos.y, c.pos.z); const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 8), new THREE.MeshStandardMaterial({ color: '#d8d8d8', metalness: 0.7, roughness: 0.3 })); pole.position.set(2.6, 1.6, 0); pole.castShadow = true;
      const fg = new THREE.PlaneGeometry(1.3, 0.8, 6, 1); fg.translate(0.65, 0, 0); const flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ color: '#8a8a8a', side: THREE.DoubleSide, emissive: '#000', roughness: 0.7 })); flag.position.set(2.6, 2.75, 0);
      const ring = new THREE.Mesh(new THREE.RingGeometry(c.r - 0.35, c.r, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(pole, flag, ring); this.scene.add(g); return { g, flag, ring, base: fg.attributes.position.array.slice() }; });
    // relics
    const rg = new THREE.OctahedronGeometry(0.32, 0), rm = new THREE.MeshStandardMaterial({ color: '#7df3ff', emissive: '#22b8ff', emissiveIntensity: 1.2, metalness: 0.3, roughness: 0.2 });
    this.relicMeshes = this.L.relics.map(r => { const m = new THREE.Mesh(rg, rm); m.position.set(r.pos.x, r.pos.y, r.pos.z); const glow = new THREE.Sprite(spriteMat('dot', 0x7df3ff, true)); glow.scale.set(1.6, 1.6, 1); m.add(glow); this.scene.add(m); return m; });
  }
  particles() {
    const N = this.q === 'low' ? 300 : 900; const g = new THREE.BufferGeometry(); this.pp = new Float32Array(N * 3); this.pc = new Float32Array(N * 3); this.pv = new Float32Array(N * 3); this.pl = new Float32Array(N);
    g.setAttribute('position', new THREE.BufferAttribute(this.pp, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.pc, 3)); this.pN = N; this.pi = 0;
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.35, map: tex('dot'), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); this.pts.frustumCulled = false; this.scene.add(this.pts);
    // ambient (snow / motes / embers) around the camera
    const M = this.q === 'low' ? 150 : 500, ag = new THREE.BufferGeometry(); this.ap = new Float32Array(M * 3); for (let i = 0; i < M * 3; i++) this.ap[i] = (Math.random() - 0.5) * 60; ag.setAttribute('position', new THREE.BufferAttribute(this.ap, 3));
    this.amb = new THREE.Points(ag, new THREE.PointsMaterial({ size: 0.18, map: tex('dot'), transparent: true, depthWrite: false, color: '#ffffff', opacity: 0.8 })); this.amb.frustumCulled = false; this.scene.add(this.amb);
    // wind streaks
    const W = 120, wg = new THREE.BufferGeometry(); this.wp = new Float32Array(W * 6); wg.setAttribute('position', new THREE.BufferAttribute(this.wp, 3)); this.wl = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false })); this.wl.frustumCulled = false; this.scene.add(this.wl); this.wseed = Array.from({ length: W }, () => [Math.random(), Math.random(), Math.random()]);
  }
  burst(at, color = '#ffffff', n = 24, speed = 4, up = 2, life = 0.9) { const c = C(color); for (let k = 0; k < n; k++) { const i = this.pi = (this.pi + 1) % this.pN; this.pp[i * 3] = at.x; this.pp[i * 3 + 1] = at.y; this.pp[i * 3 + 2] = at.z; const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random()); this.pv[i * 3] = Math.cos(a) * s; this.pv[i * 3 + 1] = up * (0.4 + Math.random()); this.pv[i * 3 + 2] = Math.sin(a) * s; this.pl[i] = life * (0.6 + Math.random() * 0.6); this.pc[i * 3] = c.r; this.pc[i * 3 + 1] = c.g; this.pc[i * 3 + 2] = c.b; } }
  chainMesh(style) {
    if (this.links) { this.scene.remove(this.links); this.links.geometry.dispose(); }
    const st = CHAIN_STYLES.find(s => s.id === style) || CHAIN_STYLES[0]; this.chainStyle = st;
    const g = st.id === 'rope' ? new THREE.CylinderGeometry(0.05, 0.05, 0.24, 6).rotateX(Math.PI / 2) : new THREE.TorusGeometry(0.085, 0.026, 6, 12).scale(1, 1.5, 1).rotateX(Math.PI / 2);
    const m = new THREE.MeshStandardMaterial({ color: st.color, metalness: st.metal, roughness: 0.35, emissive: st.glow ? st.color : '#000000', emissiveIntensity: st.glow ? 0.6 : 0 });
    this.links = new THREE.InstancedMesh(g, m, 80); this.links.castShadow = true; this.links.frustumCulled = false; this.linkMat = m; this.scene.add(this.links);
  }

  // ───── per frame ─────
  frame(view, dt) {
    this.t += dt; const L = this.L;
    // dynamic boxes
    for (const [b, mesh] of this.boxMeshes) { mesh.position.set(b.c.x, b.c.y, b.c.z); mesh.rotation.set(b.rot.x, b.rot.y, b.rot.z, 'YXZ'); mesh.visible = b.solid || b.vis === 'plate' || b.ent?.type === 'icicle' && b.c.y < b.ent.top.y + 5 || (b.ent?.type === 'bridge' && b.c.y > b.prevC.y - 30);
      const o = b.ent; if (!o) continue;
      if (o.type === 'vanish') { const s = o.state, m = mesh.material[0]; m.opacity = s === 'off' ? 0.12 : s === 'warn' ? 0.45 + 0.4 * Math.abs(Math.sin(this.t * 22)) : 0.92; mesh.visible = true; if (m.emissiveIntensity !== undefined) m.emissiveIntensity = s === 'off' ? 0.05 : 0.55; }
      if (o.type === 'drums' && mesh.userData.top) { const i = o.boxes.indexOf(b); mesh.userData.top.material.emissiveIntensity = (o.lit[i] ? 0.5 : 0) + o.flash * 2 + 0.15 * Math.sin(this.t * 4); }
      if (o.type === 'plates' && b.vis === 'plate') { const i = o.boxes.indexOf(b); mesh.material.emissiveIntensity = o.on[i] ? 1.6 : 0.15 + 0.1 * Math.sin(this.t * 3); }
      if (o.type === 'lever' && b.vis === 'leverpost') { const i = o.boxes.indexOf(b) - 1; mesh.userData.arm.rotation.x = o.held[i] ? 0.9 : -0.5; mesh.userData.knob.material.emissiveIntensity = o.held[i] ? 1.5 : 0.3; }
      if (o.type === 'icicle' && o.shadowMesh) { o.shadowMesh.visible = !!o.shadow; o.shadowMesh.position.set(o.top.x, o.fy + 0.05, o.top.z); o.shadowMesh.material.opacity = o.warn ? 0.5 + 0.4 * Math.sin(this.t * 20) : 0.8; }
    }
    // belts scroll
    const bt = tex('belt'); bt.offset.y = (this.t * 1.2) % 1;
    // markers bob, fade when far
    for (const m of this.marks) { m.s.position.y = m.base + Math.sin(this.t * 2 + m.base) * 0.15; const d = this.cam.position.distanceTo(m.s.position); m.s.material.opacity = d < 30 ? 1 : Math.max(0, 1 - (d - 30) / 20); m.s.visible = m.s.material.opacity > 0.01 && !(m.o.type === 'plates' && m.o.open); }
    for (const a of this.anchorRings) a.ring.rotation.y += dt * 1.5;
    // checkpoints
    this.cpMeshes.forEach((m, i) => { const on = view.cpReached?.has(i), cur = view.cp === i; m.flag.material.color.set(on ? (L.zones[L.cps[i].zone]?.color || '#ffd978') : '#8a8a8a'); m.flag.material.emissive.set(cur ? '#553300' : '#000'); m.ring.material.opacity = cur ? 0.5 + 0.2 * Math.sin(this.t * 3) : on ? 0.28 : 0.15;
      const p = m.flag.geometry.attributes.position; for (let k = 0; k < p.count; k++) { const x = m.base[k * 3]; p.setZ(k, Math.sin(x * 4 - this.t * 6) * 0.08 * x); } p.needsUpdate = true; });
    this.relicMeshes.forEach((m, i) => { m.visible = !view.relics?.has(L.relics[i].id); m.rotation.y += dt * 2; m.position.y = L.relics[i].pos.y + Math.sin(this.t * 2 + i) * 0.15; });
    for (const f of this.flags) { const s = f.w.strength(view.t); const ang = Math.atan2(-f.w.dir.z, f.w.dir.x); f.fl.rotation.y = ang; const p = f.fl.geometry.attributes.position; for (let k = 0; k < p.count; k++) { const x = f.base[k * 3]; p.setZ(k, Math.sin(x * 5 - this.t * (4 + s)) * 0.06 * x * (1 + s * 0.15)); p.setY(k, f.base[k * 3 + 1] - x * Math.max(0, 0.5 - s * 0.05)); } p.needsUpdate = true; }
    this.bellMesh.rotation.z = view.state === 'victory' ? Math.sin(this.t * 5) * 0.35 : Math.sin(this.t * 0.8) * 0.03;
    // players
    const ten = view.chain?.tension || 0;
    view.players.forEach((pl, i) => { const ch = this.chars[i]; if (!ch) return; ch.update(pl, dt, { tension: ten, groundY: view.groundY?.[i] }); ch.root.visible = true; });
    for (let i = view.players.length; i < this.chars.length; i++) { this.chars[i].root.visible = false; this.chars[i].blob.visible = false; }
    // chain links along every rope in the line (one per linked pair)
    if (view.ropes && view.ropes.length) { let n = 0; for (const r of view.ropes) n = this.drawChain(r, ten, view.chain?.state, n); this.links.count = n; }
    else this.drawChain(view.rope, ten, view.chain?.state);
    // particles
    for (let i = 0; i < this.pN; i++) { if (this.pl[i] <= 0) { this.pp[i * 3 + 1] = -9999; continue; } this.pl[i] -= dt; this.pv[i * 3 + 1] -= 9 * dt; this.pp[i * 3] += this.pv[i * 3] * dt; this.pp[i * 3 + 1] += this.pv[i * 3 + 1] * dt; this.pp[i * 3 + 2] += this.pv[i * 3 + 2] * dt; const k = Math.max(0, Math.min(1, this.pl[i])); this.pc[i * 3] *= 0.985; this.pc[i * 3 + 1] *= 0.985; this.pc[i * 3 + 2] *= 0.985; if (k <= 0) this.pp[i * 3 + 1] = -9999; }
    this.pts.geometry.attributes.position.needsUpdate = true; this.pts.geometry.attributes.color.needsUpdate = true;
    this.ambient(view, dt); this.atmosphere(view, dt);
  }
  drawChain(rope, ten, state, startAt) {
    const append = startAt !== undefined; const im = this.links; if (!rope) { if (!append) im.count = 0; return startAt || 0; } const pts = rope.p, seg = 0.2; let n = startAt || 0, carry = 0; const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = v3(), a = v3(), b = v3(), d = v3(), z = v3(0, 0, 1), sc = v3(1, 1, 1), r = new THREE.Quaternion(), X = v3(0, 0, 1);
    for (let i = 0; i < pts.length - 1 && n < 80; i++) { a.set(pts[i].x, pts[i].y, pts[i].z); b.set(pts[i + 1].x, pts[i + 1].y, pts[i + 1].z); d.subVectors(b, a); const len = d.length(); if (len < 1e-4) continue; d.divideScalar(len); q.setFromUnitVectors(z, d);
      let s = carry; while (s < len && n < 80) { up.copy(a).addScaledVector(d, s); r.setFromAxisAngle(X, (n % 2) * Math.PI / 2); const qq = q.clone().multiply(r); m4.compose(up, qq, sc); im.setMatrixAt(n++, m4); s += seg; } carry = s - len; }
    if (!append) im.count = n; im.instanceMatrix.needsUpdate = true; const hot = Math.max(0, ten - 0.75) * 4; this.linkMat.emissive.set(hot > 0.05 ? '#ff3020' : this.chainStyle.glow ? this.chainStyle.color : '#000'); this.linkMat.emissiveIntensity = hot > 0.05 ? Math.min(1.2, hot) * (0.6 + 0.4 * Math.sin(this.t * 20)) : this.chainStyle.glow ? 0.6 : 0;
    return n;
  }
  ambient(view, dt) {
    const z = view.zone ?? 0, c = this.cam.position, a = this.ap, N = a.length / 3; const fall = z === 3 ? 2.2 : z === 4 ? -0.15 : z === 2 ? 0.6 : 0.25, drift = z === 1 ? -3 : 0.3; const col = ['#fff1c8', '#ffffff', '#ffb070', '#ffffff', '#ffe6a8'][z];
    this.amb.material.color.set(col); this.amb.material.size = z === 3 ? 0.22 : 0.12; this.amb.material.opacity = z === 3 ? 0.9 : 0.6;
    for (let i = 0; i < N; i++) { a[i * 3 + 1] -= fall * dt * (0.6 + (i % 7) * 0.1); a[i * 3] += Math.sin(this.t + i) * 0.3 * dt + drift * dt * 0.3; for (let k = 0; k < 3; k++) { const cc = k === 0 ? c.x : k === 1 ? c.y : c.z; if (a[i * 3 + k] < cc - 30) a[i * 3 + k] += 60; else if (a[i * 3 + k] > cc + 30) a[i * 3 + k] -= 60; } }
    this.amb.geometry.attributes.position.needsUpdate = true;
    // wind streaks inside the nearest gusting volume
    let w = null, wd = 1e9; for (const ww of this.L.winds) { const cx = (ww.x0 + ww.x1) / 2, cz = (ww.z0 + ww.z1) / 2, d = Math.hypot(cx - c.x, cz - c.z); if (d < wd) { wd = d; w = ww; } }
    if (w && wd < 60) { const s = w.strength(view.t); this.wl.material.opacity = Math.min(0.55, s / 14); const p = this.wp; this.wseed.forEach((sd, i) => { sd[0] = (sd[0] + dt * (0.25 + s * 0.08)) % 1; const x = w.x1 - (w.x1 - w.x0) * sd[0] * (w.dir.x < 0 ? 1 : -1) * 1, y = w.y0 + (w.y1 - w.y0) * sd[1], zz = w.z0 + (w.z1 - w.z0) * sd[2];
      const xx = w.dir.x < 0 ? w.x1 - (w.x1 - w.x0) * sd[0] : w.dir.x > 0 ? w.x0 + (w.x1 - w.x0) * sd[0] : w.x0 + (w.x1 - w.x0) * sd[2]; const z2 = w.dir.z < 0 ? w.z1 - (w.z1 - w.z0) * sd[0] : w.dir.z > 0 ? w.z0 + (w.z1 - w.z0) * sd[0] : zz; const L = 0.6 + s * 0.12;
      p[i * 6] = xx; p[i * 6 + 1] = y; p[i * 6 + 2] = z2; p[i * 6 + 3] = xx + w.dir.x * L; p[i * 6 + 4] = y; p[i * 6 + 5] = z2 + w.dir.z * L; }); this.wl.geometry.attributes.position.needsUpdate = true; } else this.wl.material.opacity = 0;
  }
  atmosphere(view, dt) {
    // blend palette by focus altitude between zone bases
    const y = view.focus.y, Z = this.L.zones; let k = 0; for (let i = 0; i < Z.length; i++) if (y >= Z[i].y0 - 4) k = i; const nx = Math.min(Z.length - 1, k + 1); const span = k === nx ? 1 : Z[nx].y0 - Z[k].y0; const f = k === nx ? 0 : Math.max(0, Math.min(1, (y - Z[k].y0 - span * 0.55) / (span * 0.45)));
    const tgt = PAL[k].map((c, i) => C(c).lerp(C(PAL[nx][i]), f)); this.mixPal.forEach((c, i) => c.lerp(tgt[i], Math.min(1, dt * 1.5)));
    const [top, hor, fog, sun, gnd] = this.mixPal; this.skyU.top.value.copy(top); this.skyU.hor.value.copy(hor); this.skyU.sunC.value.copy(sun); this.fog.color.copy(fog); this.r.setClearColor(fog); this.hemi.color.copy(top).lerp(C('#ffffff'), 0.6); this.hemi.groundColor.copy(gnd); this.sun.color.copy(sun);
    const fp = view.focus; this.sun.position.set(fp.x + this.sunDir.x * 70, fp.y + this.sunDir.y * 70, fp.z + this.sunDir.z * 70); this.sun.target.position.set(fp.x, fp.y, fp.z); this.skyU.sun.value.copy(this.sunDir); this.skyMesh.position.copy(this.cam.position);
    if (view.fx) { this.fog.near = 60 * (1 - view.fx.fall * 0.6); }
  }
  render() { this.r.render(this.scene, this.cam); }
  dispose() { this.r.dispose(); this.scene.traverse(o => { o.geometry?.dispose?.(); }); }
}

// third-person camera rig with wall avoidance
export class CamRig {
  constructor() { this.yaw = Math.PI; this.pitch = -0.32; this.dist = 7.5; this.pos = v3(); this.tgt = v3(); this.init = false; this.shake = 0; this.cine = null; }
  update(cam, focus, dt, world, o = {}) {
    const want = v3(focus.x, focus.y + 1.5, focus.z); if (!this.init) { this.tgt.copy(want); this.init = true; } this.tgt.lerp(want, Math.min(1, dt * 9));
    let dist = (o.dist || this.dist), pitch = this.pitch;
    const cp = Math.cos(pitch), dir = v3(Math.sin(this.yaw) * cp, -Math.sin(pitch), Math.cos(this.yaw) * cp);
    let d = dist; if (world) { const hit = world.raycast(this.tgt.x, this.tgt.y, this.tgt.z, dir.x, dir.y, dir.z, dist + 0.3); if (hit.box && hit.t < dist + 0.3) d = Math.max(1.2, hit.t - 0.35); }
    this.cur = this.cur === undefined ? d : (d < this.cur ? d : this.cur + (d - this.cur) * Math.min(1, dt * 3)); const p = v3().copy(this.tgt).addScaledVector(dir, this.cur);
    if (this.cine) { const c = this.cine; c.t += dt; const k = Math.min(1, c.t / c.dur), e = k * k * (3 - 2 * k); p.lerpVectors(c.from, p, e); const look = v3().lerpVectors(c.look, this.tgt, e); cam.position.copy(p); cam.lookAt(look); if (k >= 1) this.cine = null; }
    else if (o.orbit) { const a = performance.now() / 4000; cam.position.set(o.orbit.x + Math.sin(a) * 13, o.orbit.y + 6, o.orbit.z + Math.cos(a) * 13); cam.lookAt(o.orbit.x, o.orbit.y + 2, o.orbit.z); }
    else { cam.position.copy(p); cam.lookAt(this.tgt); }
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2); cam.position.x += (Math.random() - 0.5) * this.shake * 0.4; cam.position.y += (Math.random() - 0.5) * this.shake * 0.4; }
  }
  // camera yaw convention matches the controller: forward = (-sin yaw, -cos yaw)
  intro(from, look, dur = 4) { this.cine = { from: v3(from.x, from.y, from.z), look: v3(look.x, look.y, look.z), t: 0, dur }; }
}
