// Two original stylized climbers built from simple primitives, with procedural animation for every state the
// controller reports (idle, walk, run, jump, fall, land, climb, hang, reel, anchor).
import * as THREE from './three.module.js';

export const SKINS = [
  { id: 'kip', name: 'Kip', unlock: 0, hat: 'helmet' }, { id: 'moss', name: 'Moss', unlock: 0, hat: 'beanie' },
  { id: 'scout', name: 'Scout', unlock: 2, hat: 'cap' }, { id: 'sprout', name: 'Sprout', unlock: 4, hat: 'leaf' },
  { id: 'monarch', name: 'Monarch', unlock: 7, hat: 'crown' }, { id: 'zenith', name: 'Zenith', unlock: 10, hat: 'halo' },
];
export const COLORS = ['#ff7a45', '#3fb6ff', '#ffd23f', '#7be36b', '#c780ff', '#ff5d8f', '#f5f5f5', '#2ee6c9'];

const lam = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.65, metalness: 0, ...o });
function capsule(r, len, mat, seg = 10) { const g = new THREE.CapsuleGeometry(r, len, 4, seg); g.translate(0, -len / 2 - r, 0); const m = new THREE.Mesh(g, mat); m.castShadow = true; return m; }

export class Climber {
  constructor({ color = '#ff7a45', skin = 'kip', name = 'Player', label = true } = {}) {
    this.root = new THREE.Group(); this.body = new THREE.Group(); this.root.add(this.body);
    this.mat = lam(color); this.dark = lam(new THREE.Color(color).multiplyScalar(0.55)); this.skinMat = lam('#ffe1c4'); this.bootMat = lam('#3a2f2a');
    // torso (rounded jacket) + belly
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.33, 0.34, 4, 14), this.mat); torso.position.y = 0.98; torso.scale.set(1, 1, 0.86); torso.castShadow = true; this.body.add(torso); this.torso = torso;
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.045, 6, 20), lam('#2c2c34', { roughness: 0.4 })); belt.rotation.x = Math.PI / 2; belt.position.y = 0.86; belt.scale.set(1, 0.86, 1); this.body.add(belt);
    // chain attach ring at the waist (glows)
    this.ringMat = new THREE.MeshStandardMaterial({ color: '#ffd978', emissive: '#ffb020', emissiveIntensity: 0.8, metalness: 0.8, roughness: 0.3 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.028, 8, 16), this.ringMat); ring.position.set(0, 0.88, 0.3); this.body.add(ring); this.ring = ring;
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.2), this.dark); pack.position.set(0, 1.05, -0.3); pack.castShadow = true; this.body.add(pack);
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.46, 10), lam('#e9d8b0')); roll.rotation.z = Math.PI / 2; roll.position.set(0, 1.33, -0.3); this.body.add(roll);
    // head
    this.head = new THREE.Group(); this.head.position.y = 1.42; this.body.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 16), this.skinMat); skull.castShadow = true; this.head.add(skull);
    const eyeM = new THREE.MeshBasicMaterial({ color: '#1b1b22' }); for (const x of [-0.1, 0.1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), eyeM); e.position.set(x, 0.03, 0.27); e.scale.set(1, 1.35, 0.6); this.head.add(e); }
    const cheekM = new THREE.MeshBasicMaterial({ color: '#ff9a8a', transparent: true, opacity: 0.6 }); for (const x of [-0.17, 0.17]) { const c = new THREE.Mesh(new THREE.CircleGeometry(0.04, 10), cheekM); c.position.set(x, -0.05, 0.262); c.rotation.y = x > 0 ? 0.55 : -0.55; this.head.add(c); }
    this.hatGroup = new THREE.Group(); this.head.add(this.hatGroup); this.setSkin(skin);
    // limbs (pivot groups)
    const limb = (x, y, r, len, mat, foot) => { const g = new THREE.Group(); g.position.set(x, y, 0); const m = capsule(r, len, mat); g.add(m); if (foot) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.12, 0.26), this.bootMat); f.position.set(0, -len - r * 2 + 0.05, 0.04); f.castShadow = true; g.add(f); } else { const h = new THREE.Mesh(new THREE.SphereGeometry(r * 1.25, 10, 8), this.skinMat); h.position.y = -len - r * 2; g.add(h); } this.body.add(g); return g; };
    this.armL = limb(-0.36, 1.2, 0.075, 0.34, this.mat); this.armR = limb(0.36, 1.2, 0.075, 0.34, this.mat);
    this.legL = limb(-0.15, 0.62, 0.095, 0.3, this.dark, true); this.legR = limb(0.15, 0.62, 0.095, 0.3, this.dark, true);
    this.blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.28, depthWrite: false })); this.blob.rotation.x = -Math.PI / 2; this.blob.renderOrder = 1; this.blobY = 0;
    this.t = 0; this.squash = 1; this.prevAnim = 'idle'; this.lean = 0;
  }
  setColor(c) { this.mat.color.set(c); this.dark.color.set(new THREE.Color(c).multiplyScalar(0.55)); }
  setSkin(id) {
    const g = this.hatGroup; while (g.children.length) g.remove(g.children[0]); const sk = SKINS.find(s => s.id === id) || SKINS[0]; this.skin = sk.id;
    const add = (geo, mat, p, r) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); if (r) m.rotation.set(...r); m.castShadow = true; g.add(m); return m; };
    if (sk.hat === 'helmet') { add(new THREE.SphereGeometry(0.325, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), lam('#f2f2f2', { roughness: 0.3 }), [0, 0.02, 0]); add(new THREE.TorusGeometry(0.2, 0.05, 8, 16, Math.PI), lam('#333a44', { metalness: 0.6, roughness: 0.3 }), [0, 0.16, 0.12], [0.35, 0, 0]);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.26), lam('#666'), [0.14, 0.36, -0.05], [0, 0, -0.3]); add(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: '#ff4f4f', emissive: '#ff2020', emissiveIntensity: 1 }), [0.18, 0.49, -0.05]); }
    else if (sk.hat === 'beanie') { add(new THREE.SphereGeometry(0.315, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), lam('#e8e1d2'), [0, 0.03, 0]); add(new THREE.TorusGeometry(0.29, 0.06, 8, 20), lam('#c9bfa9'), [0, 0.06, 0], [Math.PI / 2, 0, 0]); add(new THREE.SphereGeometry(0.09, 10, 8), lam('#f5efe2'), [0, 0.36, 0]);
      add(new THREE.TorusGeometry(0.24, 0.07, 8, 18), lam('#d94b4b'), [0, -0.3, 0], [Math.PI / 2, 0, 0]); add(new THREE.BoxGeometry(0.1, 0.32, 0.06), lam('#d94b4b'), [0.12, -0.45, 0.2], [0.2, 0, 0.2]); }
    else if (sk.hat === 'cap') { add(new THREE.SphereGeometry(0.315, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.45), lam('#2e6be6'), [0, 0.04, 0]); add(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 18, 1, false, -Math.PI / 2, Math.PI), lam('#2e6be6'), [0, 0.1, 0.16], [0.15, 0, 0]); }
    else if (sk.hat === 'leaf') { const lm = lam('#5bc250'); for (let k = 0; k < 3; k++) add(new THREE.SphereGeometry(0.12, 10, 6), lm, [Math.cos(k * 2.1) * 0.08, 0.36, Math.sin(k * 2.1) * 0.08], [0, k, 0.9]).scale.set(1, 0.25, 0.55); add(new THREE.CylinderGeometry(0.015, 0.015, 0.14), lm, [0, 0.3, 0]); }
    else if (sk.hat === 'crown') { const gm = new THREE.MeshStandardMaterial({ color: '#ffcf4a', metalness: 0.85, roughness: 0.25 }); add(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12, 1, true), gm, [0, 0.3, 0]); for (let k = 0; k < 6; k++) add(new THREE.ConeGeometry(0.045, 0.12, 4), gm, [Math.cos(k / 6 * 6.283) * 0.2, 0.41, Math.sin(k / 6 * 6.283) * 0.2]); }
    else if (sk.hat === 'halo') { add(new THREE.TorusGeometry(0.22, 0.03, 8, 24), new THREE.MeshStandardMaterial({ color: '#fff3b0', emissive: '#ffd85a', emissiveIntensity: 1.5 }), [0, 0.5, 0], [Math.PI / 2, 0, 0]); }
  }
  // pl: player state (interpolated), dt: frame time
  update(pl, dt, opts = {}) {
    this.t += dt; const a = pl.anim, at = pl.animT || 0, sp = pl.speed || 0; const R = this.root;
    R.position.set(pl.p.x, pl.p.y, pl.p.z); R.rotation.y = pl.yaw + Math.PI;
    const L = (x, y, k = 12) => x + (y - x) * Math.min(1, dt * k);
    let aL = 0, aR = 0, lL = 0, lR = 0, aZL = 0.12, aZR = -0.12, bob = 0, lean = 0, headX = 0, sq = 1;
    const ph = (pl.moved || 0) * (a === 'run' ? 1.55 : 1.9);
    if (a === 'walk' || a === 'run') { const amp = a === 'run' ? 1.0 : 0.65; lL = Math.sin(ph) * amp; lR = -lL; aL = -lL * 0.8; aR = -lR * 0.8; bob = Math.abs(Math.cos(ph)) * (a === 'run' ? 0.08 : 0.04); lean = a === 'run' ? 0.22 : 0.08; }
    else if (a === 'jump') { aL = aR = -2.6; aZL = 0.4; aZR = -0.4; lL = 0.6; lR = -0.2; lean = -0.05; sq = 1.06; }
    else if (a === 'fall') { const w = Math.sin(this.t * 18); aL = -2.2 + w * 0.6; aR = -2.2 - w * 0.6; aZL = 0.9; aZR = -0.9; lL = 0.4 + w * 0.4; lR = 0.4 - w * 0.4; headX = -0.2; }
    else if (a === 'land') { sq = 0.8; lL = lR = 0.5; aL = aR = 0.6; lean = 0.25; }
    else if (a === 'climb') { const w = Math.sin(at * 16); aL = -2.9 + w * 0.4; aR = -2.9 - w * 0.4; lL = 0.8 + w * 0.6; lR = 0.8 - w * 0.6; lean = 0.35; }
    else if (a === 'hang') { aL = aR = -3.0; aZL = 0.15; aZR = -0.15; lL = 0.2 + Math.sin(this.t * 3) * 0.2; lR = 0.2 - Math.sin(this.t * 3) * 0.2; headX = -0.3; }
    else if (a === 'reel') { const w = Math.sin(this.t * 9); aL = -1.2 + w * 0.6; aR = -1.2 - w * 0.6; lL = -0.5; lR = 0.5; lean = -0.32; }
    else if (a === 'anchor') { aL = aR = -1.0; aZL = 0.5; aZR = -0.5; lL = -0.3; lR = 0.3; lean = -0.15; }
    else { bob = Math.sin(this.t * 2.4) * 0.012; aL = Math.sin(this.t * 1.7) * 0.05; aR = -aL; }
    if (pl.stun > 0) { aZL = 1.3; aZR = -1.3; headX = 0.3; }
    this.armL.rotation.x = L(this.armL.rotation.x, aL); this.armR.rotation.x = L(this.armR.rotation.x, aR); this.armL.rotation.z = L(this.armL.rotation.z, aZL); this.armR.rotation.z = L(this.armR.rotation.z, aZR);
    this.legL.rotation.x = L(this.legL.rotation.x, lL, 16); this.legR.rotation.x = L(this.legR.rotation.x, lR, 16);
    this.lean = L(this.lean, lean, 8); this.body.rotation.x = this.lean; this.head.rotation.x = L(this.head.rotation.x, headX, 8);
    this.squash = L(this.squash, sq, 14); this.body.scale.set(1 / Math.sqrt(this.squash), this.squash, 1 / Math.sqrt(this.squash)); this.body.position.y = bob;
    this.ringMat.emissiveIntensity = 0.6 + (opts.tension || 0) * 1.6 + (pl.anchored ? 1 : 0);
    if (opts.groundY !== undefined) { this.blob.position.set(pl.p.x, opts.groundY + 0.03, pl.p.z); const h = Math.max(0, pl.p.y - opts.groundY); this.blob.material.opacity = Math.max(0, 0.32 - h * 0.03); this.blob.scale.setScalar(1 + h * 0.05); this.blob.visible = h < 12; }
  }
  // chain attach point in world space (front of the belt)
  attach(out) { this.ring.getWorldPosition(out); return out; }
}
