// In-game HUD (DOM overlay): names, chain tension, altitude, checkpoints, timer, falls, connection, prompts,
// hints, banners, toasts, rescue countdown, fall/respawn overlay, name labels and the pause/confirm dialogs.
const $ = (s, r = document) => r.querySelector(s);
const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60), cs = Math.floor((t * 100) % 100); return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`; };
export { fmt };
const PROMPTS = { anchor: 'E — clip onto the anchor', unanchor: 'E — unclip from the anchor', lever: 'Hold E — pull the lever', leverheld: 'Holding the lever…', reeling: 'Reeling in the chain…', bell: 'E — ring the summit bell!', bellwait: 'Wait for your partner at the bell' };
const ICON = { move: '🕹️', chain: '⛓️', run: '💨', boost: '🧗', reel: '🪝', wind: '🌬️', time: '⏱️', anchor: '⚓', drums: '🥁', belt: '⚙️', jump: '⤴️', lever: '🎚️', lift: '🛗', plates: '⬛', ice: '🧊', beam: '🪵', icicle: '❄️', ferry: '🛷', vanish: '✨' };

export class Hud {
  constructor(root, settings) { this.root = root; this.s = settings; this.el = {}; for (const id of ['hName0', 'hName1', 'hTen', 'hTenBar', 'hTenTxt', 'hAlt', 'hAltMax', 'hCps', 'hTime', 'hFalls', 'hConn', 'hPrompt', 'hHint', 'hBanner', 'hToasts', 'hRescue', 'hFall', 'hWhite', 'hLabels', 'hZone', 'hSave', 'hMode', 'hRelics']) this.el[id] = $('#' + id, root); this.labels = []; this.bannerT = 0; this.lastHint = null; this.hintSeen = new Set(); }
  show(on) { this.root.classList.toggle('hidden', !on); }
  banner(title, sub) { const b = this.el.hBanner; b.innerHTML = `<div class="bt">${title}</div><div class="bs">${sub || ''}</div>`; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
  toast(text, kind = '') { const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = text; this.el.hToasts.appendChild(t); setTimeout(() => t.classList.add('out'), 3200); setTimeout(() => t.remove(), 3800); while (this.el.hToasts.children.length > 4) this.el.hToasts.firstChild.remove(); }
  fallBanner(title, sub) { const f = this.el.hFall; f.innerHTML = `<div class="ft">${title}</div><div class="fs">${sub}</div>`; f.classList.remove('show'); void f.offsetWidth; f.classList.add('show'); }
  pauseMenu(on, game) { $('#pause').classList.toggle('hidden', !on); this.onPause?.(on, game); }
  confirm(text, ok, fn, cancel = 'Cancel') { const d = $('#confirm'); $('#confirmText').textContent = text; $('#confirmOk').textContent = ok; $('#confirmNo').textContent = cancel; d.classList.remove('hidden'); const close = () => d.classList.add('hidden'); $('#confirmOk').onclick = () => { close(); fn(); }; $('#confirmNo').onclick = close; }
  setNames(names, colors) {
    // The strip is authored for two; for a bigger party we build the extra slots and chain glyphs
    // on the fly so three and four climbers all show up.
    const row = this.el.hName0?.parentElement;
    if (row) {
      row.innerHTML = names.map((n, i) => `${i ? '<span class="link">⛓</span>' : ''}<span id="hName${i}"></span>`).join('');
      names.forEach((n, i) => { this.el['hName' + i] = row.querySelector('#hName' + i); });
    }
    names.forEach((n, i) => { const el = this.el['hName' + i]; if (el) el.innerHTML = `<i style="background:${colors[i]}"></i>${n}`; });
    this.el.hLabels.innerHTML = '';
    this.labels = names.map((n, i) => { const d = document.createElement('div'); d.className = 'plabel'; this.el.hLabels.appendChild(d);
      d.innerHTML = `<b style="color:${colors[i]}">P${i + 1}</b> ${n}`; return { d }; });
  }
  update(g, pls, dt) {
    const S = g.sim, E = this.el, me = g.me;
    // tension
    const t = Math.min(1.2, S.chain.tension || 0), st = S.chain.state; E.hTenBar.style.width = `${Math.min(100, t * 100)}%`; E.hTen.dataset.state = st; E.hTenTxt.textContent = st === 'slack' ? 'Slack' : st === 'tight' ? 'Tight' : st === 'taut' ? 'TAUT!' : 'STRAINED!';
    E.hTen.classList.toggle('warn', t > 0.9); E.hTen.querySelector('.len').textContent = `${S.Le.toFixed(1)} / ${S.chainLen} m`;
    const alt = S.altitude(pls[me]); E.hAlt.textContent = `${Math.max(0, alt).toFixed(0)} m`; E.hAltMax.textContent = `best ${S.maxAlt.toFixed(0)} m · summit ${(S.L.summitY - S.L.startY).toFixed(0)} m`;
    E.hTime.textContent = fmt(S.elapsed); E.hTime.classList.toggle('speed', S.mode === 'speedrun');
    E.hFalls.innerHTML = `Falls <b>${S.fallsTotal}</b> <span>${S.names[0]} ${S.falls[0]} · ${S.names[1]} ${S.falls[1]}</span>`;
    E.hRelics.textContent = `◆ ${S.relics.size}/${S.L.relics.length}`;
    if (this._cp !== S.cp + ':' + S.cpReached.size) { this._cp = S.cp + ':' + S.cpReached.size; E.hCps.innerHTML = S.L.cps.map((c, i) => `<i class="${i === S.cp ? 'cur' : S.cpReached.has(i) ? 'on' : ''}" title="${c.label}"></i>`).join('') + '<i class="summit" title="Summit"></i>'; }
    E.hZone.textContent = S.L.zones[S.zone].name; E.hMode.textContent = S.mode === 'normal' ? '' : S.mode.toUpperCase();
    // connection
    const c = g.cfg.connInfo?.(); if (c) { E.hConn.className = 'conn ' + c.q; E.hConn.innerHTML = `<i></i>${c.text}`; E.hConn.style.display = ''; } else E.hConn.style.display = 'none';
    const sv = g.cfg.saveInfo?.(); E.hSave.textContent = sv || '';
    // prompt + hint (the local player's)
    const pr = S.prompt?.[me]; E.hPrompt.textContent = pr ? PROMPTS[pr] || '' : ''; E.hPrompt.classList.toggle('show', !!pr);
    const hi = S.hint?.[me]; if (hi !== this.lastHint) { this.lastHint = hi; const h = hi !== null && hi !== undefined ? S.L.hints[hi] : null; if (h && this.s.hints !== false) { const txt = h.icon === 'move' && document.body.classList.contains('touchmode') ? 'Left stick move · ⤒ jump · ⇧ sprint · E interact · drag the screen to look' : h.text; E.hHint.innerHTML = `<span>${ICON[h.icon] || '💡'}</span>${txt}`; E.hHint.classList.add('show'); } else E.hHint.classList.remove('show'); }
    // rescue countdown
    if (S.rescue) { E.hRescue.classList.add('show'); E.hRescue.innerHTML = `<b>${S.names[S.rescue.who]}</b> is falling — rescue in <span>${S.rescue.left.toFixed(1)}s</span>`; } else E.hRescue.classList.remove('show');
    E.hWhite.style.opacity = g.fx.white * 0.9; this.root.style.setProperty('--fall', g.fx.fall.toFixed(3));
    // labels over heads
    pls.forEach((pl, i) => { const L = this.labels[i]; if (!L) return; const p = g.project({ x: pl.p.x, y: pl.p.y + 2.25, z: pl.p.z }); const vis = p.vis && p.x > -0.1 && p.x < 1.1 && p.y > -0.1 && p.y < 1.1 && (i !== me || g.kind === 'local'); L.d.style.display = vis ? '' : 'none'; if (vis) L.d.style.transform = `translate(${(p.x * innerWidth).toFixed(0)}px, ${(p.y * innerHeight).toFixed(0)}px) translate(-50%, -100%)`; });
    g.audio.footsteps(pls, me, g.R.cam.position);
  }
}
