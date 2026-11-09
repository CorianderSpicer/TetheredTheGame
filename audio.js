// All sound is synthesized with WebAudio at runtime (no audio files): footsteps, jumps, landings, chain rattle,
// tension warning, falls, checkpoints, ambience per zone and a short victory tune. Volume buses + mute.
export class Audio {
  constructor(settings) { this.s = settings; this.ctx = null; this.amb = null; this.zoneIdx = 0; this.rattleT = 0; this.warnT = 0; this.stepT = [0, 0]; }
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.connect(c.destination); this.sfx = c.createGain(); this.music = c.createGain(); this.ambBus = c.createGain(); this.sfx.connect(this.master); this.music.connect(this.master); this.ambBus.connect(this.master);
    const len = c.sampleRate * 2, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = b; this.apply();
  }
  apply() { if (!this.ctx) return; const s = this.s, m = s.muted ? 0 : s.master; this.master.gain.value = m; this.sfx.gain.value = s.sfx; this.music.gain.value = s.music; this.ambBus.gain.value = s.music * 0.8; }
  get t() { return this.ctx.currentTime; }
  pan(rel) { const c = this.ctx; const g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null; let vol = 1, pan = 0;
    if (rel) { const d = Math.hypot(rel.x, rel.y, rel.z); vol = Math.max(0, 1 - d / 60); const yaw = rel.yaw || 0; const rx = Math.cos(yaw) * rel.x - Math.sin(yaw) * rel.z; pan = Math.max(-1, Math.min(1, rx / (Math.abs(rx) + 6))); }
    g.gain.value = vol; if (p) { p.pan.value = pan; g.connect(p); p.connect(this.sfx); } else g.connect(this.sfx); return g; }
  osc(type, f0, f1, dur, vol, out, at = 0) { const c = this.ctx, o = c.createOscillator(), g = c.createGain(), t = this.t + at; o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05); }
  noise(dur, vol, out, f = 1200, q = 0.8, type = 'bandpass', at = 0, f1) { const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain(), t = this.t + at; s.buffer = this.noiseBuf; s.loop = true; fl.type = type; fl.frequency.setValueAtTime(f, t); if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur); fl.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(fl); fl.connect(g); g.connect(out); s.start(t, Math.random()); s.stop(t + dur + 0.05); }
  play(name, rel, k = 1) {
    if (!this.ctx || this.s.muted) return; const o = this.pan(rel);
    switch (name) {
      case 'jump': this.osc('triangle', 260, 620, 0.16, 0.25, o); this.noise(0.08, 0.12, o, 2500); break;
      case 'land': this.noise(0.18, 0.35 * (0.4 + k), o, 380, 0.7, 'lowpass'); this.osc('sine', 120, 50, 0.16, 0.3 * k, o); break;
      case 'step': this.noise(0.05, 0.09 * k, o, rel?.surf === 'snow' ? 2600 : rel?.surf === 'metal' || rel?.surf === 'rust' ? 3600 : 900, 1.2); if (rel?.surf === 'metal' || rel?.surf === 'rust') this.osc('square', 1900, 1700, 0.04, 0.02, o); break;
      case 'hit': this.noise(0.25, 0.5, o, 500, 0.6, 'lowpass'); this.osc('square', 220, 90, 0.2, 0.15, o); this.osc('triangle', 1400, 1100, 0.4, 0.08, o); break;
      case 'climb': this.noise(0.12, 0.12, o, 1400, 1); break;
      case 'checkpoint': [523, 659, 784, 1046].forEach((f, i) => this.osc('triangle', f, f, 0.5, 0.18, o, i * 0.09)); this.osc('sine', 1568, 1568, 1.2, 0.06, o, 0.36); break;
      case 'relic': [1318, 1568, 1976, 2637].forEach((f, i) => this.osc('sine', f, f, 0.35, 0.12, o, i * 0.06)); break;
      case 'slip': this.osc('sine', 700, 300, 0.3, 0.1, o); break;
      case 'warn': this.osc('square', 660, 660, 0.12, 0.08, o); this.osc('square', 880, 880, 0.12, 0.08, o, 0.16); break;
      case 'saved': [392, 494, 587].forEach(f => this.osc('triangle', f, f, 0.6, 0.12, o)); break;
      case 'fall': this.osc('sine', 1300, 160, 1.3, 0.22, o); this.noise(1.4, 0.25, o, 600, 0.5, 'bandpass', 0, 200); break;
      case 'launch': this.osc('sine', 80, 40, 0.5, 0.5, o); this.osc('sawtooth', 200, 900, 0.5, 0.1, o); this.noise(0.4, 0.3, o, 300, 0.5, 'lowpass'); break;
      case 'crack': for (let i = 0; i < 4; i++) this.noise(0.05, 0.2, o, 2000 + Math.random() * 2000, 2, 'bandpass', i * 0.06); break;
      case 'creak': this.osc('sawtooth', 140, 90, 0.6, 0.06, o); this.noise(0.5, 0.08, o, 700, 4); break;
      case 'gate': case 'mech': this.osc('sawtooth', 70, 110, 0.9, 0.08, o); this.noise(0.9, 0.08, o, 400, 1, 'lowpass'); break;
      case 'clip': this.osc('square', 2200, 1800, 0.05, 0.08, o); this.osc('triangle', 3000, 2800, 0.2, 0.05, o, 0.03); break;
      case 'rattle': { const f = 2400 + Math.random() * 2600; this.noise(0.03, 0.05 * k, o, f, 6); this.osc('sine', f * 1.3, f * 1.25, 0.08, 0.012 * k, o); break; }
      case 'tension': this.osc('square', 980, 980, 0.07, 0.05, o); break;
      case 'strain': this.osc('sawtooth', 95, 80, 0.35, 0.05, o); break;
      case 'victory': [523, 659, 784].forEach((f, i) => this.osc('triangle', f, f * 1.001, 2.4, 0.12, o, i * 0.03)); break;
      case 'ui': this.osc('triangle', 880, 990, 0.06, 0.06, o); break;
    }
  }
  // chain rattle from rope motion + tension warning beeps
  chain(motion, tension, state) {
    if (!this.ctx) return; const n = performance.now() / 1000;
    const rate = Math.min(22, motion * 2.2); if (rate > 1.5 && n > this.rattleT) { this.play('rattle', null, Math.min(1, rate / 10)); this.rattleT = n + 1 / rate * (0.6 + Math.random() * 0.8); }
    if (tension > 0.92 && n > this.warnT) { this.play(state === 'strained' ? 'strain' : 'tension'); this.warnT = n + (state === 'strained' ? 0.5 : 0.42); }
  }
  footsteps(pls, me, cam) { if (!this.ctx) return; pls.forEach((pl, i) => { if (!pl.grounded || pl.speed < 0.8) return; const stride = pl.speed > 6.3 ? 1.35 : 1.0; const d = pl.moved || 0; if (d - this.stepT[i] > stride || d < this.stepT[i]) { this.stepT[i] = d; const rel = { x: pl.p.x - cam.x, y: pl.p.y - cam.y, z: pl.p.z - cam.z, surf: pl.gmat }; this.play('step', rel, i === me ? 1 : 0.7); } }); }
  // looping ambience per zone (wind / machinery / blizzard / temple pad)
  startAmbient() { if (!this.ctx || this.amb) return; const c = this.ctx; const src = c.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true; const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 500; const g = c.createGain(); g.gain.value = 0.12; src.connect(fl); fl.connect(g); g.connect(this.ambBus); src.start();
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.13; lg.gain.value = 180; lfo.connect(lg); lg.connect(fl.frequency); lfo.start();
    const hum = c.createOscillator(), hf = c.createBiquadFilter(), hg = c.createGain(); hum.type = 'sawtooth'; hum.frequency.value = 55; hf.type = 'lowpass'; hf.frequency.value = 160; hg.gain.value = 0; hum.connect(hf); hf.connect(hg); hg.connect(this.ambBus); hum.start();
    const pad = [261.6, 329.6, 392, 523.2].map(f => { const o = c.createOscillator(), og = c.createGain(); o.type = 'sine'; o.frequency.value = f; og.gain.value = 0; o.connect(og); og.connect(this.ambBus); o.start(); return og; });
    this.amb = { src, fl, g, lfo, hum, hg, pad }; this.zone(this.zoneIdx); }
  zone(i) { this.zoneIdx = i; const a = this.amb; if (!a) return; const t = this.t + 2, set = (p, v) => p.linearRampToValueAtTime(v, t);
    set(a.g.gain, [0.08, 0.2, 0.07, 0.24, 0.06][i]); set(a.fl.frequency, [500, 900, 380, 1500, 700][i]); set(a.hg.gain, i === 2 ? 0.05 : 0); a.pad.forEach(g => set(g.gain, i === 4 ? 0.012 : 0)); }
  stopAmbient() { const a = this.amb; if (!a) return; try { a.src.stop(); a.lfo.stop(); a.hum.stop(); } catch (e) { } for (const g of a.pad) g.disconnect(); this.amb = null; }
  victoryMusic() { if (!this.ctx) return; const out = this.music, seq = [[523, 0], [659, 0.25], [784, 0.5], [1046, 0.75], [988, 1.25], [784, 1.5], [880, 1.75], [1046, 2.25], [1175, 2.75], [1318, 3.0], [1046, 3.5], [1568, 4.0]]; for (const [f, at] of seq) { this.osc('triangle', f, f, 0.45, 0.12, out, at); this.osc('sine', f / 2, f / 2, 0.5, 0.06, out, at); } [261, 329, 392].forEach(f => this.osc('sine', f, f, 4.5, 0.05, out, 0.0)); [349, 440, 523].forEach(f => this.osc('sine', f, f, 2.5, 0.05, out, 2.0)); [392, 494, 587, 784].forEach(f => this.osc('sine', f, f, 3, 0.05, out, 4.0)); }
}
