// Input: keyboard + mouse (pointer lock), touch (virtual stick, buttons, drag to look) and gamepads.
// Produces per-player input frames {f, s, yaw, sprint, jump, jp, use, up}. jp/up are press counters, which
// survive packet loss and frame-rate differences better than edge flags.
export class Input {
  constructor(el, opts = {}) {
    this.el = el; this.keys = new Set(); this.look = { dx: 0, dy: 0 }; this.sens = opts.sens || 1; this.invert = false; this.locked = false; this.enabled = true;
    this.cnt = [{ jp: 0, up: 0, rs: 0, ps: 0 }, { jp: 0, up: 0, rs: 0, ps: 0 }]; this.prevPad = [{}, {}]; this.touch = { x: 0, y: 0, active: false, jump: false, sprint: false, use: false, id: null, lookId: null, lx: 0, ly: 0 };
    this.local2 = false; this.onPause = null; this.onReset = null; this.mobile = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    addEventListener('keydown', e => this.kd(e)); addEventListener('keyup', e => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousedown', () => { if (!this.mobile && this.enabled && !this.locked) el.requestPointerLock?.(); });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
    addEventListener('mousemove', e => { if (this.locked) { this.look.dx += e.movementX; this.look.dy += e.movementY; } });
  }
  kd(e) {
    if (!this.enabled) return; const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    if (!this.keys.has(e.code)) {
      if (e.code === 'Space') this.cnt[0].jp++; if (e.code === 'KeyE') this.cnt[0].up++;
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause?.(); if (e.code === 'KeyR') this.onReset?.();
      if (this.local2) { if (e.code === 'Enter' || e.code === 'Numpad0' || e.code === 'ControlRight') this.cnt[1].jp++; if (e.code === 'Slash' || e.code === 'NumpadDecimal' || e.code === 'Period') this.cnt[1].up++; }
    }
    this.keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  }
  // touch controls: element ids from index.html
  bindTouch(root) {
    const stick = root.querySelector('#stick'), knob = root.querySelector('#knob'); const T = this.touch;
    const btn = (id, key) => { const b = root.querySelector(id); const on = e => { e.preventDefault(); T[key] = true; b.classList.add('on'); if (key === 'jump') this.cnt[0].jp++; if (key === 'use') this.cnt[0].up++; }; const off = e => { e.preventDefault(); T[key] = false; b.classList.remove('on'); };
      b.addEventListener('touchstart', on, { passive: false }); b.addEventListener('touchend', off, { passive: false }); b.addEventListener('touchcancel', off, { passive: false }); b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); };
    btn('#tJump', 'jump'); btn('#tSprint', 'sprint'); btn('#tUse', 'use');
    root.querySelector('#tPause').addEventListener('click', () => this.onPause?.());
    const sr = () => stick.getBoundingClientRect();
    stick.addEventListener('touchstart', e => { e.preventDefault(); const t = e.changedTouches[0]; T.id = t.identifier; T.active = true; this.moveStick(t, sr(), knob); }, { passive: false });
    addEventListener('touchmove', e => { for (const t of e.changedTouches) { if (t.identifier === T.id) this.moveStick(t, sr(), knob); else if (t.identifier === T.lookId) { this.look.dx += (t.clientX - T.lx) * 2.2; this.look.dy += (t.clientY - T.ly) * 2.2; T.lx = t.clientX; T.ly = t.clientY; } } }, { passive: true });
    const end = e => { for (const t of e.changedTouches) { if (t.identifier === T.id) { T.id = null; T.active = false; T.x = T.y = 0; knob.style.transform = ''; } if (t.identifier === T.lookId) T.lookId = null; } };
    addEventListener('touchend', end); addEventListener('touchcancel', end);
    this.el.addEventListener('touchstart', e => { for (const t of e.changedTouches) if (T.lookId === null || T.lookId === undefined) { T.lookId = t.identifier; T.lx = t.clientX; T.ly = t.clientY; } }, { passive: true });
    T.lookId = null;
  }
  moveStick(t, r, knob) { const cx = r.left + r.width / 2, cy = r.top + r.height / 2, R = r.width / 2; let dx = (t.clientX - cx) / R, dy = (t.clientY - cy) / R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } this.touch.x = dx; this.touch.y = dy; knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`; }
  pads() { return (navigator.getGamepads?.() || []).filter(p => p && p.connected); }
  // consume accumulated look delta (radians)
  takeLook(pad) { let dx = this.look.dx * 0.0024 * this.sens, dy = this.look.dy * 0.0024 * this.sens * (this.invert ? -1 : 1); this.look.dx = this.look.dy = 0;
    if (pad) { const rx = Math.abs(pad.axes[2]) > 0.15 ? pad.axes[2] : 0, ry = Math.abs(pad.axes[3]) > 0.15 ? pad.axes[3] : 0; dx += rx * 0.045 * this.sens; dy += ry * 0.035 * this.sens * (this.invert ? -1 : 1); } return { dx, dy }; }
  padFrame(pad, i) { const c = this.cnt[i], pv = this.prevPad[i], b = k => !!pad.buttons[k]?.pressed; const A = b(0), X = b(2), st = b(9);
    if (A && !pv.A) c.jp++; if (X && !pv.X) c.up++; if (st && !pv.st) this.onPause?.(); pv.A = A; pv.X = X; pv.st = st;
    const ax = Math.abs(pad.axes[0]) > 0.18 ? pad.axes[0] : 0, ay = Math.abs(pad.axes[1]) > 0.18 ? pad.axes[1] : 0; return { f: -ay, s: ax, sprint: b(1) || b(10) || b(6), jump: A, use: X || b(7) }; }
  // player 0 (keyboard/mouse/touch/pad0) and player 1 (local same-screen: arrows or second pad)
  frame(i, camYaw) {
    const K = c => this.keys.has(c), c = this.cnt[i], pads = this.pads(); let f = 0, s = 0, sprint = false, jump = false, use = false;
    if (i === 0) { f = (K('KeyW') ? 1 : 0) - (K('KeyS') ? 1 : 0); s = (K('KeyD') ? 1 : 0) - (K('KeyA') ? 1 : 0); sprint = K('ShiftLeft') || (!this.local2 && K('ShiftRight')); jump = K('Space'); use = K('KeyE');
      if (!this.local2) { f += (K('ArrowUp') ? 1 : 0) - (K('ArrowDown') ? 1 : 0); s += (K('ArrowRight') ? 1 : 0) - (K('ArrowLeft') ? 1 : 0); }
      const T = this.touch; if (T.active) { f = -T.y; s = T.x; } if (T.sprint) sprint = true; if (T.jump) jump = true; if (T.use) use = true;
      const pad = this.local2 ? (pads.length > 1 ? pads[0] : null) : pads[0]; if (pad) { const p = this.padFrame(pad, 0); if (p.f || p.s) { f = p.f; s = p.s; } sprint ||= p.sprint; jump ||= p.jump; use ||= p.use; } }
    else { f = (K('ArrowUp') ? 1 : 0) - (K('ArrowDown') ? 1 : 0); s = (K('ArrowRight') ? 1 : 0) - (K('ArrowLeft') ? 1 : 0); sprint = K('ShiftRight'); jump = K('Enter') || K('Numpad0') || K('ControlRight'); use = K('Slash') || K('NumpadDecimal') || K('Period');
      const pad = pads.length > 1 ? pads[1] : pads[0]; if (pad && this.local2) { const p = this.padFrame(pad, 1); if (p.f || p.s) { f = p.f; s = p.s; } sprint ||= p.sprint; jump ||= p.jump; use ||= p.use; } }
    f = Math.max(-1, Math.min(1, f)); s = Math.max(-1, Math.min(1, s));
    return { f, s, yaw: camYaw, sprint, jump, jp: c.jp, use, up: c.up };
  }
}
