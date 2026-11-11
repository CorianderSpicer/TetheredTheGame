// App shell: menus, lobby, same-screen setup, continue/load, settings, customize, results, and the game lifecycle
// (autosave, unsaved-change warnings, disconnect handling).
import { Game } from './game.js';
import { Input } from './input.js';
import { Hud, fmt } from './hud.js';
import { Audio } from './audio.js';
import { Profile, CHALLENGES } from './profile.js';
import { Session, CODE_RE } from './session.js';
import { qrSVG, scanQR } from './net.js';
import { Saves, FSA, Lock, download, readFile, newSaveId, fileName } from './save.js';
import { VERSION, MODES } from './sim.js';
import { ZONES, buildLevel, LEVELS } from './level.js';
import { SKINS, COLORS } from './char.js';
import { Renderer, CamRig, CHAIN_STYLES } from './render.js';
import { Rope } from './chain.js';
import { P as PC } from './player.js';

const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const prof = Profile.load(), S = prof.settings;
const canvas = $('#view'), input = new Input(canvas, { sens: S.sens }), audio = new Audio(S), hud = new Hud($('#hud'), S);
input.invert = S.invert; if (input.mobile) document.body.classList.add('touchmode');
input.bindTouch($('#touch'));
const app = { screen: 'title', game: null, session: null, meta: null, lastSave: 0, saveMsg: '', lobbySettings: { mode: 'normal', chainLen: 8, startZone: 0, players: 2, level: 'ascent' }, resume: null, returnTo: 'title' };
window.__app = app;
addEventListener('pointerdown', () => audio.unlock(), { once: false });
addEventListener('keydown', e => { audio.unlock(); if (e.code === 'KeyM' && !e.target.closest?.('input,textarea')) { S.muted = !S.muted; audio.apply(); Profile.save(); menuToast(S.muted ? 'Sound muted (M)' : 'Sound on'); } });

function menuToast(text, kind = '') { const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = text; $('#toastRoot').appendChild(t); setTimeout(() => t.classList.add('out'), 3500); setTimeout(() => t.remove(), 4100); }
$('#toastRoot').style.cssText = 'right:14px;bottom:20px';

// ═════ title background: the real mountain, slowly orbiting ═════
let bg = null;
function startBg() {
  if (bg || app.game) return; const L = buildLevel(); const R = new Renderer(canvas, L, { quality: S.quality === 'high' ? 'medium' : S.quality, p1: { color: prof.color, skin: prof.skin }, p2: { color: '#3fb6ff', skin: 'moss' }, chainStyle: prof.chainStyle });
  const c0 = L.cps[0], rope = new Rope(18), pls = [0, 1].map(i => ({ p: { ...c0.spawn[i] }, v: { x: 0, y: 0, z: 0 }, yaw: Math.PI * 0.85 + i * 0.6, anim: 'idle', animT: 0, speed: 0, moved: 0, grounded: true }));
  pls[0].p.x -= 0.4; pls[1].p.x += 0.4; let t0 = performance.now(), run = true; const cen = R.center;
  const loop = () => { if (!run) return; requestAnimationFrame(loop); const t = (performance.now() - t0) / 1000, dt = 1 / 60; const a = t * 0.05 + 2.2;
    R.cam.position.set(cen.x + Math.cos(a) * 250, 95 + Math.sin(t * 0.07) * 20, cen.z + Math.sin(a) * 250); R.cam.lookAt(cen.x, 42, cen.z);
    rope.step({ x: pls[0].p.x, y: pls[0].p.y + PC.waist, z: pls[0].p.z }, { x: pls[1].p.x, y: pls[1].p.y + PC.waist, z: pls[1].p.z }, 8, dt, L.world);
    R.frame({ players: pls, rope, chain: { tension: 0 }, t, cp: 0, cpReached: new Set([0]), relics: new Set(), zone: 0, state: 'play', groundY: [c0.pos.y, c0.pos.y], focus: { x: cen.x, y: 30, z: cen.z } }, dt); R.render(); };
  loop(); bg = { stop() { run = false; R.dispose(); } };
  addEventListener('resize', () => R.resize());
}
function stopBg() { if (bg) { bg.stop(); bg = null; } }

// ═════ screens ═════
function show(id) { $$('#ui > .screen').forEach(s => s.classList.toggle('hidden', s.id !== id)); app.screen = id; const fn = SCREENS[id]; fn?.(); audio.play('ui'); }
const SCREENS = { title: renderTitle, local: renderLocal, continue: renderContinue, settings: () => renderSettings($('#settings')), custom: renderCustom, join: renderJoin };
document.addEventListener('click', e => { const b = e.target.closest('[data-go],[data-act]'); if (!b) return; if (b.dataset.go) { if (b.dataset.go === 'host') return openHost(); show(b.dataset.go); } else ACT[b.dataset.act]?.(b); });
const ACT = {
  loadfile: () => $('#fileIn').click(),
  leaveLobby: () => { app.session?.close(); app.session = null; app.resume = null; Lock.release(); show('title'); },
  settingsBack: () => show(app.returnTo === 'pause' ? 'title' : 'title'),
};
function renderTitle() { setTimeout(() => { if (app.screen === 'title') startBg(); }, 30); Saves.list().then(l => { $('#contSub').textContent = l.length ? `${l.length} recovery snapshot${l.length > 1 ? 's' : ''} · latest ${new Date(l[0].updated).toLocaleString()}` : 'no saved climbs yet'; }).catch(() => { $('#contSub').textContent = 'saving unavailable in this browser'; });
  $('#titleFoot').textContent = `v${VERSION} · relics ${Profile.relicCount()}/10 · ${prof.best.normal ? 'best ' + fmt(prof.best.normal.time) : 'no summit yet'}`; }

// ═════ shared widgets ═════
function playerCard(el, who, p, onChange, title) {
  const skins = SKINS.map(s => `<button data-skin="${s.id}" class="${p.skin === s.id ? 'on' : ''} ${Profile.skinUnlocked(s.id) ? '' : 'lock'}" title="${Profile.skinUnlocked(s.id) ? s.name : 'Find ' + s.unlock + ' relics'}">${Profile.skinUnlocked(s.id) ? s.name : '🔒 ' + s.name}</button>`).join('');
  el.innerHTML = `<div class="lbl">${title}</div><label>Name</label><input data-f="name" maxlength="16" value="${esc(p.name)}" placeholder="${who === 0 ? 'Player 1' : 'Player 2'}"><label>Colour</label><div class="swatches">${COLORS.map(c => `<i data-c="${c}" style="background:${c}" class="${p.color === c ? 'on' : ''}"></i>`).join('')}</div><label>Skin</label><div class="chips">${skins}</div>`;
  el.querySelector('[data-f=name]').oninput = e => { p.name = e.target.value.slice(0, 16); onChange(p); };
  el.querySelectorAll('[data-c]').forEach(i => i.onclick = () => { p.color = i.dataset.c; el.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === i)); onChange(p); });
  el.querySelectorAll('[data-skin]').forEach(b => b.onclick = () => { if (!Profile.skinUnlocked(b.dataset.skin)) return menuToast('Find more relics to unlock this skin'); p.skin = b.dataset.skin; el.querySelectorAll('[data-skin]').forEach(x => x.classList.toggle('on', x === b)); onChange(p); });
}
function settingsCard(el, st, editable, onChange) {
  const zones = (buildLevel(st.level || 'ascent').zones).map((z, i) => `<option value="${i}" ${st.startZone === i ? 'selected' : ''} ${prof.unlockedZones.includes(i) ? '' : 'disabled'}>${z.sub}: ${z.name}${prof.unlockedZones.includes(i) ? '' : ' (locked)'}</option>`).join('');
  const desc = { normal: 'Checkpoints between and within zones. One fall → a rescue window; both fall → back to the checkpoint.', hardcore: 'No checkpoints. Any failed fall restarts the whole climb and the timer.', speedrun: 'Normal rules; the timer never stops, even when paused. Records + leaderboard-ready run file.', practice: 'Start in any zone you have reached before. Records are not kept.' };
  el.innerHTML = `<div class="lbl">Game settings ${editable ? '' : '(set by the host)'}</div><div class="lbl">Level</div><div class="chips" id="lvChips">${LEVELS.map(l => `<button data-lv="${l.id}" class="${(st.level || 'ascent') === l.id ? 'on' : ''}" ${editable ? '' : 'disabled'} title="${l.sub}">${l.name}<small>${'\u2605'.repeat(l.difficulty)}</small></button>`).join('')}</div>${st.players !== undefined ? `<div class="lbl">Climbers</div><div class="chips" id="sizeChips">${[2, 3, 4].map(n => `<button data-n="${n}" class="${st.players === n ? 'on' : ''}" ${editable ? '' : 'disabled'}>${n} players</button>`).join('')}</div>` : ''}<div class="chips" id="modeChips">${Object.entries(MODES).map(([k, n]) => `<button data-m="${k}" class="${st.mode === k ? 'on' : ''}" ${editable ? '' : 'disabled'}>${n}</button>`).join('')}</div><p class="small">${desc[st.mode]}</p>
    <label>Chain length: <b id="clv">${st.chainLen} m</b></label><input type="range" min="6" max="12" step="1" value="${st.chainLen}" id="chainLen" ${editable ? '' : 'disabled'}>
    <div ${st.mode === 'practice' ? '' : 'class="hidden"'}><label>Practice zone</label><select id="zoneSel" ${editable ? '' : 'disabled'}>${zones}</select></div>`;
  if (!editable) return;
  el.querySelectorAll('[data-lv]').forEach(b => b.onclick = () => { st.level = b.dataset.lv; if (st.level !== 'ascent') st.startZone = 0; onChange(st); settingsCard(el, st, editable, onChange); });
  el.querySelectorAll('[data-n]').forEach(b => b.onclick = () => { st.players = +b.dataset.n; onChange(st); settingsCard(el, st, editable, onChange); });
  el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { st.mode = b.dataset.m; if (st.mode !== 'practice') st.startZone = 0; onChange(st); settingsCard(el, st, editable, onChange); });
  el.querySelector('#chainLen').oninput = e => { st.chainLen = +e.target.value; el.querySelector('#clv').textContent = st.chainLen + ' m'; onChange(st); };
  el.querySelector('#zoneSel').onchange = e => { st.startZone = +e.target.value; onChange(st); };
}
const me = () => ({ name: prof.name || 'Player', color: prof.color, skin: prof.skin });
const signalServer = () => new URLSearchParams(location.search).get('signal') || S.signal || '';

// ═════ same-screen ═════
const local = { p: [{ name: prof.name || 'Player 1', color: prof.color, skin: prof.skin }, { name: 'Player 2', color: '#3fb6ff', skin: 'moss' }], st: { level: 'ascent', mode: 'normal', chainLen: 8, startZone: 0 } };
function renderLocal() {
  playerCard($('#lp0'), 0, local.p[0], p => { prof.name = p.name; prof.color = p.color; prof.skin = p.skin; Profile.save(); }, 'Player 1 · keyboard + mouse');
  playerCard($('#lp1'), 1, local.p[1], () => { }, 'Player 2 · arrows or gamepad');
  settingsCard($('#localSettings'), local.st, true, () => { });
}
$('#localStart').onclick = () => { if (local.p[0].color === local.p[1].color) local.p[1].color = COLORS.find(c => c !== local.p[0].color); startGame('local', { settings: { ...local.st }, players: local.p.map(p => ({ ...p, name: p.name || 'Player' })) }); };

// ═════ host ═════
async function openHost(resume) {
  show('host'); app.session?.close(); app.resume = resume || null;
  const st = app.lobbySettings; if (resume) { st.mode = resume.extra?.mode || 'normal'; st.chainLen = resume.chain.maximumLength; st.startZone = 0; }
  $('#roomCode').textContent = '·····'; $('#hostStatus').textContent = 'Creating room…'; $('#hostStatus').className = 'status'; $('#manualHost').classList.add('hidden');
  const rb = $('#resumeBox'); if (resume) { rb.classList.remove('hidden'); rb.innerHTML = `<div class="lbl">Resuming a saved climb</div><b>${esc(resume.host.name)} &amp; ${esc(resume.guest.name)}</b> · ${ZONES[resume.progress.level - 1].name} · ${resume.progress.checkpointId} · ${fmt(resume.progress.elapsedTime)} · ${MODES[resume.extra?.mode || 'normal']}<div class="small">Both players will be restored to their saved positions when you start. <a href="#" id="dropResume">Start a fresh climb instead</a></div>`; $('#dropResume').onclick = e => { e.preventDefault(); app.resume = null; rb.classList.add('hidden'); Lock.release(); }; } else rb.classList.add('hidden');
  const s = app.session = new Session('host', me(), {
    onStatus: (t, k) => { const el = $('#hostStatus'); el.textContent = t; el.className = 'status ' + k; if (app.game) hud.toast(t, k === 'error' || k === 'warn' ? 'warn' : ''); },
    onLobby: L => renderHostLobby(L),
    onGameMsg: m => hostGameMsg(m),
    onDrop: left => { if (app.game) partnerGone(left); },
    onRejoin: (p, same) => partnerBack(p, same),
  });
  s.setTurn(S.turn); s.setSignal(signalServer());
  renderHostSettings(); const code = await s.host(st, resume ? { roomCode: resume.roomCode } : null);
  if (s !== app.session) return; $('#roomCode').textContent = code || '—'; if (code) { $('#hostStatus').textContent = `Room ${code} is open. Waiting for player 2…`; $('#hostStatus').className = 'status ok'; }
}
function renderHostSettings() { settingsCard($('#hostSettings'), app.lobbySettings, true, st => { const s = app.session; if (!s) return; if (st.players && st.players !== s.maxPlayers) s.setPlayers(st.players); s.setSettings(st); }); playerCard($('#hostMe'), 0, prof, p => { Profile.save(); app.session?.setMe(me()); }, 'You'); }
function slotsHTML(L) { return L.players.map((p, i) => p ? `<div class="slot"><span class="sw" style="background:${p.color}"></span><span class="nm">P${i + 1} · ${esc(p.name)}</span><span class="st ${p.ready ? 'ready' : 'wait'}">${!p.here ? 'offline' : p.ready ? 'Ready' : 'Not ready'}</span></div>` : `<div class="slot empty"><span class="sw"></span><span class="nm">P${i + 1} · waiting…</span><span class="st">empty</span></div>`).join(''); }
function renderHostLobby(L) { $('#hostSlots').innerHTML = slotsHTML(L); const b = $('#hostStart'), ok = app.session?.canStart(); b.disabled = !ok; b.textContent = ok ? (app.resume ? 'Resume climb' : 'Start climb') : L.players[1] ? 'Waiting for player 2 to be ready…' : 'Waiting for player 2…'; }
$('#copyCode').onclick = () => { navigator.clipboard?.writeText($('#roomCode').textContent).then(() => menuToast('Room code copied')); };
$('#toggleManual').onclick = async () => { const m = $('#manualHost'); m.classList.toggle('hidden'); if (!m.classList.contains('hidden') && !$('#offerText').value) newInvite(); };
async function newInvite() { $('#offerText').value = 'Creating invite…'; try { const t = await app.session.manualInvite(); $('#offerText').value = t; $('#hostQR').innerHTML = qrSVG(t); } catch (e) { $('#offerText').value = ''; menuToast(e.message, 'warn'); } }
$('#newOffer').onclick = newInvite; $('#copyOffer').onclick = () => navigator.clipboard?.writeText($('#offerText').value).then(() => menuToast('Invite copied'));
$('#acceptAnswer').onclick = async () => { try { await app.session.manualAccept($('#answerText').value); $('#hostStatus').textContent = 'Answer accepted — connecting…'; } catch (e) { $('#hostStatus').textContent = e.message; $('#hostStatus').className = 'status error'; } };
$('#hostStart').onclick = () => {
  const s = app.session; if (!s?.canStart()) return; const L = s.lobby, st = { ...L.settings };
  // Everyone in the lobby, with duplicate colours nudged apart so the party stays readable.
  const used = [me().color];
  const players = L.players.map((p, i) => { if (i === 0) return { ...me() };
    let c = p.color; if (used.includes(c)) c = COLORS.find(x => !used.includes(x)) || c; used.push(c);
    return { name: p.name, color: c, skin: p.skin }; });
  const save = app.resume ? JSON.parse(JSON.stringify(app.resume)) : null; if (save) { save.host.name = players[0].name; save.guest.name = players[1]?.name || save.guest.name; }
  s.sendStart({ settings: st, names: players.map(p => p.name), colors: players.map(p => p.color), skins: players.map(p => p.skin), chainStyle: prof.chainStyle, save });
  startGame('host', { settings: st, players, save });
};
function hostGameMsg(m, slot = 1) { const g = app.game; if (!g) return; if (m.t === 'in') g.onGuestInput(m.a, slot); else if (m.t === 'pause') { g.togglePause(!!m.on); hud.toast(m.on ? `${g.sim.names[slot] || 'A climber'} paused` : 'Resumed'); } else if (m.t === 'reset') g.doReset('partner'); }
function partnerGone(left) { const g = app.game; if (!g || g.kind !== 'host') return; g.sim.paused = true; autosave('disconnect'); const room = app.session.room;
  waiting(left ? `${esc(g.sim.names[1])} left` : 'Partner disconnected', `The game is paused and a recovery snapshot was saved. ${room ? `Room <b>${room}</b> is still open — they can rejoin with the same code.` : 'They connected with a manual code, so return to the menu and resume from Continue Game with a new invite.'}`, [['Download save', () => doDownload()], ['Save & return to menu', () => endGame('title')]]); }
function partnerBack(p, same) { const g = app.game; if (!g) return; waitingOff(); const save = g.sim.toSave(app.meta); app.session.sendStart({ settings: { mode: g.sim.mode, chainLen: g.sim.chainLen, startZone: 0 }, names: g.sim.names, colors: g.cfg.colors, skins: g.cfg.skins, chainStyle: g.cfg.chainStyle, save, rejoin: true });
  hud.toast(`${p.name} is back!`); setTimeout(() => { if (app.game === g) { g.sim.paused = false; hud.pauseMenu(false, g); } }, 1500); }

// ═════ join ═════
let joinMe = null;
function renderJoin() { joinMe = joinMe || me(); playerCard($('#joinMe'), 1, joinMe, p => { prof.name = p.name; prof.color = p.color; prof.skin = p.skin; Profile.save(); app.session?.send({ t: 'profile', ...p }); }, 'You'); const live = !!(app.session && app.session.role === 'guest' && app.session.welcomed && app.session.link); $('#joinLobby').classList.toggle('hidden', !live); if (live) { app.ready = false; $('#readyBtn').textContent = 'Ready'; } else $('#joinStatus').textContent = ''; const q = new URLSearchParams(location.search).get('room'); if (q) $('#joinCode').value = q.toUpperCase(); }
function guestSession() {
  app.session?.close(); const s = app.session = new Session('guest', joinMe, {
    onStatus: (t, k) => { const el = $('#joinStatus'); el.textContent = t; el.className = 'status ' + k; if (app.game) { $('#waitText').textContent = t; } },
    onError: t => { const el = $('#joinStatus'); el.textContent = t; el.className = 'status error'; if (app.game) { endGame('join'); } menuToast(t, 'warn'); },
    onWelcome: () => { $('#joinLobby').classList.remove('hidden'); app.ready = false; $('#readyBtn').textContent = 'Ready'; },
    onLobby: L => { if (app.game && !L.inGame) { endGame('join', true); } $('#joinLobby').classList.remove('hidden'); $('#joinSlots').innerHTML = slotsHTML(L); const st = L.settings; $('#joinSettings').innerHTML = `Mode <b>${MODES[st.mode]}</b> · chain <b>${st.chainLen} m</b>${st.mode === 'practice' ? ` · starting in <b>${ZONES[st.startZone].name}</b>` : ''}${L.resume ? ' · <b>resuming a saved climb</b>' : ''}`; },
    onStart: m => { waitingOff(); if (app.game) stopGameOnly(); startGame('guest', { settings: m.settings, players: m.names.map((n, i) => ({ name: n, color: m.colors[i], skin: m.skins[i] })), save: m.save, chainStyle: m.chainStyle }); },
    onGameMsg: m => { const g = app.game; if (!g) return; if (m.t === 's') g.onSnapshot(m); else if (m.t === 'pause') { hud.pauseMenu(!!m.on, g); g.sim.paused = !!m.on; } else if (m.t === 'toast') hud.toast(m.text); },
    onDrop: () => { if (app.game) waiting('Connection lost', 'Trying to reconnect to the host…', [['Leave', () => { app.session?.close(); endGame('title'); }]]); },
    onEnd: m => { endGame('title'); menuToast(m.reason === 'host-left' ? 'The host ended the session.' : 'Session ended.', 'warn'); },
  }); s.setTurn(S.turn); s.setSignal(signalServer()); return s;
}
$('#joinGo').onclick = async () => { const code = $('#joinCode').value.trim().toUpperCase(); const st = $('#joinStatus'); if (!CODE_RE.test(code)) { st.textContent = 'Invalid room code — 5 characters, letters A–Z (no I, O, B) and digits 2–9.'; st.className = 'status error'; return; }
  const s = guestSession(); try { await s.join(code); } catch (e) { if (s !== app.session) return; st.textContent = /No lobby/.test(e.message) ? `Room ${code} was not found. Check the code — the host must keep their lobby open.` : e.message; st.className = 'status error'; } };
$('#joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('#joinGo').click(); });
$('#toggleManualJoin').onclick = () => $('#manualJoin').classList.toggle('hidden');
$('#answerGo').onclick = async () => { const s = guestSession(); try { const t = await s.manualAnswer($('#inviteText').value); $('#answerOut').value = t; $('#answerOut').classList.remove('hidden'); $('#copyAnswer').classList.remove('hidden'); $('#joinQR').innerHTML = qrSVG(t); $('#joinStatus').textContent = 'Send this answer code back to the host.'; } catch (e) { $('#joinStatus').textContent = e.message; $('#joinStatus').className = 'status error'; } };
$('#copyAnswer').onclick = () => navigator.clipboard?.writeText($('#answerOut').value).then(() => menuToast('Answer copied'));
$('#scanGo').onclick = async () => { const v = $('#scanVideo'); v.classList.remove('hidden'); try { const stop = await scanQR(v, text => { $('#inviteText').value = text; v.classList.add('hidden'); $('#answerGo').click(); }); setTimeout(() => { stop(); v.classList.add('hidden'); }, 60000); } catch (e) { v.classList.add('hidden'); menuToast('Camera unavailable: ' + e.message, 'warn'); } };
$('#readyBtn').onclick = () => { app.ready = !app.ready; app.session?.send({ t: 'ready', v: app.ready }); $('#readyBtn').textContent = app.ready ? 'Not ready' : 'Ready'; };

// ═════ continue / load ═════
async function renderContinue() {
  const list = $('#saveList'); list.innerHTML = '<div class="small">Loading…</div>'; let saves = []; try { saves = await Saves.list(); } catch (e) { list.innerHTML = `<div class="small">Saving is unavailable in this browser (${esc(e.message)}). Use Load Save File.</div>`; return; }
  list.innerHTML = saves.length ? '' : '<div class="small">No recovery snapshots in this browser yet.</div>';
  for (const r of saves) { const s = r.data, d = document.createElement('div'); d.className = 'save'; const lock = Lock.holder(s.saveId);
    d.innerHTML = `<div class="t">${esc(s.host.name)} &amp; ${esc(s.guest.name)} — ${ZONES[s.progress.level - 1]?.name || ''}</div><div class="b"><button class="primary" data-r="online">Resume online</button><button data-r="local">Same screen</button><button data-r="dl">Download</button><button data-r="del" class="danger">Delete</button></div>
      <div class="m">${s.progress.checkpointId} · ${fmt(s.progress.elapsedTime)} · ${MODES[s.extra?.mode || 'normal']} · altitude ${s.progress.heightReached.toFixed(0)} m · saved ${new Date(r.updated).toLocaleString()} · rev ${r.revision}${r.label ? ' · ' + esc(r.label) : ''}${lock ? ' · <b style="color:var(--hot)">open in another tab</b>' : ''}</div>`;
    d.querySelector('[data-r=online]').onclick = () => resumeSave(s, 'online'); d.querySelector('[data-r=local]').onclick = () => resumeSave(s, 'local'); d.querySelector('[data-r=dl]').onclick = () => { const n = download(s); menuToast('Downloaded ' + n); };
    d.querySelector('[data-r=del]').onclick = () => hud.confirm('Delete this recovery snapshot? (Downloaded files are not affected.)', 'Delete', async () => { await Saves.remove(s.saveId); renderContinue(); });
    list.appendChild(d); }
  const lb = $('#openLinked'); if (FSA.supported() && await FSA.restore()) { lb.classList.remove('hidden'); lb.textContent = `Open linked file (${FSA.name})`; lb.onclick = async () => { try { if (!(await FSA.granted(true))) throw new Error('Permission denied'); const f = await FSA.handle.getFile(); const { save } = await readFile(f); checkAndResume(save); } catch (e) { menuToast(e.message, 'warn'); } }; } else lb.classList.add('hidden');
}
$('#fileIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { const { save, warnings } = await readFile(f); for (const w of warnings) menuToast(w); checkAndResume(save); } catch (err) { menuToast('Could not load save: ' + err.message, 'warn'); } };
async function checkAndResume(save) {
  // conflicting versions of one session: never let an older copy silently replace a newer one
  let cur = null; try { cur = await Saves.get(save.saveId); } catch (e) { }
  const rev = save.extra?.revision || 0;
  const go = (s) => hud.confirm(`Resume ${s.host.name} & ${s.guest.name} at ${s.progress.checkpointId} (${fmt(s.progress.elapsedTime)})?`, 'Resume online', () => resumeSave(s, 'online'), 'Cancel');
  if (cur && cur.revision > rev) return hud.confirm(`This browser has a NEWER copy of this session (revision ${cur.revision}, ${new Date(cur.updated).toLocaleString()}) than the file (revision ${rev}). Loading the file would branch an older timeline.`, 'Use the newer copy', () => go(cur.data), 'Cancel');
  if (cur && cur.revision === rev && JSON.stringify(cur.data.progress) !== JSON.stringify(save.progress)) { save = JSON.parse(JSON.stringify(save)); save.saveId = newSaveId(); menuToast('The file conflicts with a local copy of the same revision — it will continue as a separate session.'); }
  go(save);
}
function resumeSave(save, how) {
  if (Lock.holder(save.saveId)) return menuToast('This session is already open in another tab.', 'warn');
  if (!Lock.take(save.saveId)) return menuToast('Could not lock this session.', 'warn');
  if (how === 'local') startGame('local', { settings: { mode: save.extra?.mode || 'normal', chainLen: save.chain.maximumLength, startZone: 0 }, players: [{ name: save.host.name, color: save.extra?.colors?.[0] || prof.color, skin: save.extra?.skins?.[0] || prof.skin }, { name: save.guest.name, color: save.extra?.colors?.[1] || '#3fb6ff', skin: save.extra?.skins?.[1] || 'moss' }], save });
  else openHost(save);
}

// ═════ settings ═════
function renderSettings(root) {
  const g = $('#setGfx', root), a = $('#setAudio', root), c = $('#setControls', root), n = $('#setNet', root);
  g.innerHTML = `<div class="lbl">Graphics</div><div class="chips">${['low', 'medium', 'high'].map(q => `<button data-q="${q}" class="${S.quality === q ? 'on' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div><p class="small">Low: no shadows, lower resolution — for tablets and older laptops.</p><label>Field of view: <b id="fovv">${S.fov}°</b></label><input type="range" min="50" max="90" value="${S.fov}" id="fov"><label><input type="checkbox" id="hints" ${S.hints ? 'checked' : ''}> Show tutorial hints</label>`;
  a.innerHTML = `<div class="lbl">Audio</div>${['master', 'music', 'sfx'].map(k => `<label>${k === 'sfx' ? 'Effects' : k === 'music' ? 'Music & ambience' : 'Master'}</label><input type="range" min="0" max="1" step="0.05" value="${S[k]}" data-v="${k}">`).join('')}<label><input type="checkbox" id="mute" ${S.muted ? 'checked' : ''}> Mute (M)</label>`;
  c.innerHTML = `<div class="lbl">Controls</div><label>Look sensitivity: <b id="sensv">${S.sens.toFixed(2)}</b></label><input type="range" min="0.3" max="2.5" step="0.05" value="${S.sens}" id="sens"><label><input type="checkbox" id="inv" ${S.invert ? 'checked' : ''}> Invert vertical look</label><p class="small">WASD · mouse · Space (hold = higher) · Shift sprint · E interact / hold to reel · R reset · Esc pause. Touch: stick, ⤒ jump, ⇧ sprint, E, drag to look. Gamepad: A jump, B sprint, X interact, Start pause.</p>`;
  const fsa = FSA.supported();
  n.innerHTML = `<div class="lbl">Saving</div>${fsa ? `<p class="small">Link a file on your computer and <b>Save Game</b> + autosaves will write into it (Chrome/Edge desktop).</p><div class="btns"><button id="linkFile">${FSA.name ? 'Linked: ' + esc(FSA.name) : 'Link a save file…'}</button>${FSA.name ? '<button id="unlinkFile">Unlink</button>' : ''}</div>` : `<p class="small">This browser cannot write files directly (Safari, iPad and Firefox). Use <b>Download Save</b> for files; recovery snapshots are kept automatically in this browser.</p>`}
    <div class="lbl" style="margin-top:14px">Signalling server</div><p class="small">Room codes use the free PeerJS cloud by default. To use your own PeerJS server enter it here (e.g. <code>myhost.com:9000/tethered</code>). Both players must use the same one.</p><input id="sigU" value="${esc(S.signal || '')}" placeholder="PeerJS cloud (default)">
    <div class="lbl" style="margin-top:14px">Network (optional TURN relay)</div><p class="small">Some networks block direct peer-to-peer connections. Add a TURN server you control to relay traffic.</p><label>TURN URLs</label><input id="turnU" value="${esc(S.turn.urls)}" placeholder="turn:turn.example.com:3478"><label>Username</label><input id="turnN" value="${esc(S.turn.username)}"><label>Credential</label><input id="turnC" type="password" value="${esc(S.turn.credential)}">`;
  const save = () => { Profile.save(); audio.apply(); input.sens = S.sens; input.invert = S.invert; hud.s = S; if (app.game) { app.game.R.setQuality(S.quality); app.game.R.cam.fov = S.fov; app.game.R.cam.updateProjectionMatrix(); } };
  g.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { S.quality = b.dataset.q; save(); renderSettings(root); });
  $('#fov', g).oninput = e => { S.fov = +e.target.value; $('#fovv', g).textContent = S.fov + '°'; save(); }; $('#hints', g).onchange = e => { S.hints = e.target.checked; save(); };
  a.querySelectorAll('[data-v]').forEach(r => r.oninput = () => { S[r.dataset.v] = +r.value; save(); }); $('#mute', a).onchange = e => { S.muted = e.target.checked; save(); };
  $('#sens', c).oninput = e => { S.sens = +e.target.value; $('#sensv', c).textContent = S.sens.toFixed(2); save(); }; $('#inv', c).onchange = e => { S.invert = e.target.checked; save(); };
  if (fsa) { $('#linkFile', n).onclick = async () => { try { await FSA.link(); menuToast('Linked ' + FSA.name); if (app.game) autosave('link'); renderSettings(root); } catch (e) { if (e.name !== 'AbortError') menuToast(e.message, 'warn'); } }; const u = $('#unlinkFile', n); if (u) u.onclick = async () => { await FSA.unlink(); renderSettings(root); }; }
  $('#sigU', n).oninput = e => { S.signal = e.target.value.trim(); save(); };
  for (const [id, k] of [['turnU', 'urls'], ['turnN', 'username'], ['turnC', 'credential']]) $('#' + id, n).oninput = e => { S.turn[k] = e.target.value.trim(); save(); };
}
FSA.restore();

// ═════ customize & records ═════
function renderCustom() {
  const look = $('#custLook'); playerCard(look, 0, prof, () => Profile.save(), 'Your climber');
  look.insertAdjacentHTML('beforeend', `<label>Chain</label><div class="chips">${CHAIN_STYLES.map(c => `<button data-ch="${c.id}" class="${prof.chainStyle === c.id ? 'on' : ''} ${Profile.chainUnlocked(c.id) ? '' : 'lock'}">${Profile.chainUnlocked(c.id) ? c.name : '🔒 ' + c.name + ' (' + c.unlock + ')'}</button>`).join('')}</div><p class="small">Skins and chains unlock as you find hidden relics.</p>`);
  look.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => { if (!Profile.chainUnlocked(b.dataset.ch)) return menuToast('Find more relics to unlock this chain'); prof.chainStyle = b.dataset.ch; Profile.save(); renderCustom(); });
  const b = prof.best, st = prof.stats; $('#custRecords').innerHTML = `<div class="lbl">Records</div><div class="bigstat"><div><b>${b.normal ? fmt(b.normal.time) : '—'}</b><span>Best normal</span></div><div><b>${b.speedrun ? fmt(b.speedrun.time) : '—'}</b><span>Best speedrun</span></div><div><b>${b.hardcore ? fmt(b.hardcore.time) : '—'}</b><span>Hardcore</span></div><div><b>${st.falls}</b><span>Total falls</span></div><div><b>${st.maxAlt.toFixed(0)} m</b><span>Highest altitude</span></div><div><b>${st.finishes}</b><span>Summits</span></div></div>
    <table style="margin-top:12px"><tr><th>Zone</th><th>Fastest</th></tr>${ZONES.map((z, i) => `<tr><td>${z.name}</td><td>${prof.zoneBest[i] ? fmt(prof.zoneBest[i]) : '—'}</td></tr>`).join('')}</table>
    <table style="margin-top:12px"><tr><th>#</th><th>Time</th><th>Mode</th><th>Falls</th><th>Team</th></tr>${prof.records.slice(0, 8).map((r, i) => `<tr><td>${i + 1}</td><td>${fmt(r.time)}</td><td>${r.mode}</td><td>${r.falls}</td><td>${esc(r.players.join(' & '))}</td></tr>`).join('') || '<tr><td colspan=5 class="small">No runs yet</td></tr>'}</table><div class="btns"><button id="expRec">Export records (JSON)</button></div>`;
  $('#expRec').onclick = () => { const blob = new Blob([JSON.stringify({ game: 'TETHERED', version: VERSION, exported: new Date().toISOString(), records: prof.records, best: prof.best, zoneBest: prof.zoneBest }, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tethered-records.json'; a.click(); };
  $('#custChallenges').innerHTML = `<div class="lbl">Challenges ${prof.challenges.length}/${CHALLENGES.length}</div>` + CHALLENGES.map(c => `<div class="ch ${prof.challenges.includes(c.id) ? 'done' : ''}"><i>${prof.challenges.includes(c.id) ? '✔' : '○'}</i><div>${c.name}<small>${c.desc}</small></div></div>`).join('');
  $('#custRelics').innerHTML = `<div class="lbl">Relics ${Profile.relicCount()}/10</div><p class="small">Ten glowing relics are hidden on the mountain — under bridges, on secret ledges and off the main route. Some sit on secret shortcuts.</p><div class="chips">${Array.from({ length: 10 }, (_, i) => `<button class="${prof.relics.includes('relic-' + (i + 1)) ? 'on' : 'lock'}">◆ ${ZONES[[0, 0, 1, 1, 2, 2, 3, 3, 4, 4][i]].sub}</button>`).join('')}</div>`;
}

// ═════ game lifecycle ═════
function startGame(kind, o) {
  stopBg(); audio.unlock(); $$('#ui > .screen').forEach(s => s.classList.add('hidden')); hud.show(true); $('#touch').classList.toggle('hidden', !input.mobile);
  const players = o.players; const resumed = !!o.save;
  if (kind !== 'guest') { const sid = o.save?.saveId || newSaveId(); if (!Lock.id || Lock.id !== sid) Lock.take(sid); app.meta = { saveId: sid, roomCode: app.session?.room || '', colors: players.map(p => p.color), skins: players.map(p => p.skin), chainStyle: o.chainStyle || prof.chainStyle }; }
  const g = app.game = new Game({ kind, canvas, input, hud, audio, settings: { ...o.settings, quality: S.quality, fov: S.fov }, names: players.map(p => p.name), colors: players.map(p => p.color), skins: players.map(p => p.skin), chainStyle: o.chainStyle || prof.chainStyle, save: o.save, ids: [kind === 'local' ? 'local-1' : 'host', kind === 'local' ? 'local-2' : 'guest'],
    link: app.session && kind !== 'local' ? { send: m => app.session.send(m) } : null,
    sendAll: app.session && kind === 'host' ? (m => app.session.sendAll(m)) : null,
    slot: kind === 'guest' ? (app.session?.slot ?? 1) : 0,
    players: players.length,
    connInfo: kind === 'local' ? null : () => app.session?.quality(),
    saveInfo: () => kind === 'guest' ? 'Host keeps the saves' : app.saveMsg,
    onCheckpoint: () => setTimeout(() => autosave('checkpoint'), 50), onZone: e => Profile.unlockZone(e.zone),
    onRelic: e => { if (Profile.addRelics([e.id])) { const sk = SKINS.find(s => s.unlock === Profile.relicCount()); if (sk) hud.toast(`Unlocked skin: ${sk.name}`); const cs = CHAIN_STYLES.find(c => c.unlock === Profile.relicCount()); if (cs) hud.toast(`Unlocked chain: ${cs.name}`); } },
    onFall: () => { prof.stats.falls++; Profile.save(); }, onVictory: v => setTimeout(() => results(v), 3500) });
  hud.setNames(g.sim.names, g.cfg.colors); g.start(); app.lastSave = performance.now(); app.saveMsg = resumed ? 'Resumed from save' : '';
  if (kind !== 'guest') { clearInterval(app.autoT); app.autoT = setInterval(() => autosave('interval'), 30000); setTimeout(() => autosave('start'), 1500); }
  prof.stats.runs++; Profile.save(); hud.onPause = (on, game) => buildPause(on, game);
  g.cfg.onRescue = () => Profile.noteRescue();
  if (input.mobile === false) canvas.requestPointerLock?.();
}
function stopGameOnly() { const g = app.game; if (!g) return; clearInterval(app.autoT); prof.stats.maxAlt = Math.max(prof.stats.maxAlt, g.sim.maxAlt); prof.stats.playTime += g.sim.elapsed; Profile.save(); g.stop(); app.game = null; hud.show(false); $('#pause').classList.add('hidden'); waitingOff(); document.exitPointerLock?.(); }
async function endGame(to = 'title', keepSession = false) {
  const g = app.game; if (g && g.kind !== 'guest' && g.sim.state !== 'victory') await autosave('menu');
  stopGameOnly(); if (!keepSession) { app.session?.close(); app.session = null; Lock.release(); } show(to);
}
async function autosave(reason) {
  const g = app.game; if (!g || g.kind === 'guest' || !app.meta) return; if (g.sim.state === 'respawning') return;
  const save = g.sim.toSave(app.meta); let where = 'this browser';
  try { await Saves.put(save, reason); } catch (e) { app.saveMsg = 'Autosave failed: ' + e.message; return; }
  try { if (await FSA.write(save, false)) where = FSA.name; } catch (e) { }
  app.lastSave = performance.now(); g.sim.dirty = false; app.saveMsg = `Autosaved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${where}`;
  return save;
}
async function manualSave() { const g = app.game; const save = g.sim.toSave(app.meta); try { await Saves.put(save, 'manual'); } catch (e) { return hud.toast('Save failed: ' + e.message, 'warn'); }
  let msg = 'Saved to this browser (Continue Game).'; if (FSA.handle) { try { if (await FSA.write(save, true)) msg = `Saved to ${FSA.name} and this browser.`; } catch (e) { msg += ' Linked file write failed: ' + e.message; } }
  app.lastSave = performance.now(); g.sim.dirty = false; app.saveMsg = 'Saved ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); hud.toast(msg); }
function doDownload() { const g = app.game; const save = g.sim.toSave(app.meta); const n = download(save); Saves.put(save, 'download').catch(() => { }); hud.toast(`Downloaded ${n} — a one-off copy; it does not update itself.`); }
function buildPause(on, g) {
  if (!on) { $('#pause').classList.add('hidden'); if (!input.mobile) canvas.requestPointerLock?.(); return; }
  document.exitPointerLock?.(); const m = $('#pauseMenu'); m.innerHTML = ''; const add = (t, fn, cls = '') => { const b = document.createElement('button'); b.textContent = t; b.className = cls; b.onclick = fn; m.appendChild(b); };
  $('#pauseNote').textContent = g.kind === 'guest' ? 'The game is paused for both players.' : g.sim.mode === 'speedrun' ? 'Speedrun: the timer keeps running while paused.' : g.kind === 'host' ? 'Paused for both players.' : '';
  add('Resume', () => g.togglePause(false), 'primary');
  if (g.kind !== 'guest') { add('Save Game', () => manualSave()); add('Download Save', () => doDownload()); }
  add('Settings', () => openSettingsOverlay());
  if (g.kind === 'host') add('Return to Lobby', () => hud.confirm('Return both players to the lobby? Progress is saved first and you can resume from the lobby.', 'Return to lobby', () => returnToLobby()));
  if (g.kind === 'local') add('Return to Menu', () => hud.confirm(unsavedText(), 'Save & leave', () => endGame('title')));
  if (g.kind === 'guest') add('Leave Game', () => hud.confirm('Leave this game? The host keeps the save.', 'Leave', () => { app.session?.close(); endGame('title'); }));
}
function unsavedText() { const s = Math.round((performance.now() - app.lastSave) / 1000); return `Leave to the main menu? A recovery snapshot will be saved now (last save ${s}s ago). Use Download Save if you want a file.`; }
async function returnToLobby() { const save = await autosave('lobby'); stopGameOnly(); const s = app.session; if (!s) return show('title'); s.inGame = false; if (save) app.resume = save; if (s.lobby.players[1]) s.lobby.players[1].ready = false; openHostAgain(); }
function openHostAgain() { show('host'); $('#roomCode').textContent = app.session.room || '—'; renderHostSettings(); const rb = $('#resumeBox'); if (app.resume) { rb.classList.remove('hidden'); rb.innerHTML = `<div class="lbl">Resume available</div>${ZONES[app.resume.progress.level - 1].name} · ${app.resume.progress.checkpointId} · ${fmt(app.resume.progress.elapsedTime)} <a href="#" id="dropResume">start fresh instead</a>`; $('#dropResume').onclick = e => { e.preventDefault(); app.resume = null; rb.classList.add('hidden'); }; } app.session.pushLobby(); renderHostLobby(app.session.lobby); }
function openSettingsOverlay() { const o = $('#settingsOverlay'); o.innerHTML = `<section class="screen panel"><header><button class="back" id="closeSet">‹</button><h2>Settings</h2></header><div class="grid2"><div class="card" id="setGfx"></div><div class="card" id="setAudio"></div><div class="card" id="setControls"></div><div class="card" id="setNet"></div></div></section>`; o.classList.remove('hidden'); renderSettings(o); $('#closeSet').onclick = () => o.classList.add('hidden'); }
function waiting(title, text, buttons) { $('#waitTitle').textContent = title; $('#waitText').innerHTML = text; const m = $('#waitMenu'); m.innerHTML = ''; for (const [t, fn] of buttons) { const b = document.createElement('button'); b.textContent = t; b.onclick = fn; m.appendChild(b); } $('#waiting').classList.remove('hidden'); document.exitPointerLock?.(); }
function waitingOff() { $('#waiting').classList.add('hidden'); }
function results(v) {
  const g = app.game; if (!g) return; const rec = { ...v, version: VERSION, saveId: app.meta?.saveId }; const out = g.kind !== 'guest' || true ? Profile.finish(rec) : { earned: [] };
  Profile.addRelics([...g.sim.relics]); app.lastRun = { game: 'TETHERED', version: VERSION, type: 'run-record', ...rec, chainLength: v.chain, relicsFound: [...g.sim.relics], checksum: null };
  app.lastRun.checksum = [...JSON.stringify({ ...app.lastRun, checksum: null })].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16);
  const kind = g.kind; app.again = { kind, settings: { mode: g.sim.mode, chainLen: g.sim.chainLen, startZone: 0 }, players: g.sim.names.map((n, i) => ({ name: n, color: g.cfg.colors[i], skin: g.cfg.skins[i] })) };
  stopGameOnly(); show('results'); if (app.meta) Saves.remove(app.meta.saveId).catch(() => { });
  $('#resBody').innerHTML = `<div class="bigstat"><div><b>${fmt(v.time)}</b><span>${out.newBest ? 'New personal best!' : 'Time'}</span></div><div><b>${v.falls}</b><span>Falls (${esc(v.names[0])} ${v.fallsEach[0]} · ${esc(v.names[1])} ${v.fallsEach[1]})</span></div><div><b>${v.relics}/10</b><span>Relics</span></div><div><b>${MODES[v.mode]}</b><span>Mode · chain ${v.chain} m</span></div></div>
    <table style="margin-top:12px"><tr><th>Zone</th><th>Split</th><th>Your best</th></tr>${ZONES.map((z, i) => `<tr><td>${z.name}</td><td>${v.splits[i] ? fmt(v.splits[i]) : '—'}</td><td>${prof.zoneBest[i] ? fmt(prof.zoneBest[i]) : '—'}</td></tr>`).join('')}</table>${out.earned.length ? `<p><b>Challenges completed:</b> ${out.earned.map(c => c.name).join(', ')}</p>` : ''}`;
  $('#resAgain').classList.toggle('hidden', kind !== 'local'); }
$('#resRecord').onclick = () => { const blob = new Blob([JSON.stringify(app.lastRun, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `tethered-run-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
$('#resAgain').onclick = () => { const a = app.again; if (a) startGame(a.kind, { settings: a.settings, players: a.players }); };
$('#resMenu').onclick = () => { app.session?.close(); app.session = null; Lock.release(); show('title'); };

// warn about unsaved progress; save what we can on the way out
addEventListener('beforeunload', e => { const g = app.game; if (g && g.kind !== 'guest' && g.sim.state !== 'victory') { autosave('unload'); e.preventDefault(); e.returnValue = 'Your climb is in progress. A recovery snapshot was just saved — leave anyway?'; return e.returnValue; } });
document.addEventListener('visibilitychange', () => { if (document.hidden && app.game) autosave('hidden'); });
addEventListener('resize', () => app.game?.R.resize());

// deep link: ?room=CODE opens Join
if (new URLSearchParams(location.search).get('room')) show('join'); else show('title');
