// Online session protocol on top of net.js (PeerJS room codes, or manual offer/answer codes).
// Host is authoritative. Messages:
//   guest→host  hello{proto,version,name,color,skin,pid} · profile · ready{v} · in{a:[inputs]} · pause{on} · reset · leave · pong
//   host→guest  welcome{room,version} · reject{reason} · lobby{…} · start{settings,names,colors,skins,save?,snap} · s (snapshot) · pause · end · ping · toast
import { Net, PROTO } from './net.js';
import { VERSION } from './sim.js';

export const CODE_RE = /^[ACDEFGHJKLMNPQRSTUVWXYZ2345679]{5}$/;
const pid = (() => { try { let p = localStorage.getItem('tethered.pid'); if (!p) { p = 'p-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('tethered.pid', p); } return p; } catch (e) { return 'p-' + Math.random().toString(36).slice(2, 10); } })();
export const PID = pid;

export class Session {
  constructor(role, me, ev = {}) { this.role = role; this.me = me; this.ev = ev; this.net = new Net(); this.link = null; this.room = ''; this.lobby = null; this.inGame = false; this.closed = false; this.lastRx = 0; this.rtt = 0; this.hb = null; this.reconnecting = false; this.guestPid = null; this.manualId = null;
    // Host side: one link per guest, indexed by the slot they occupy (slot 0 is always the host).
    // `this.link` stays as the guest's single link to the host, and as slot 1 for a 2-player game,
    // so everything that only ever expects a partner keeps working.
    this.slots = [null, null, null, null]; this.maxPlayers = 2; this.slot = 0; }
  /** Host: links of every connected guest. */
  guestLinks() { return this.slots.filter(Boolean); }
  /** Host: broadcast to every guest. */
  sendAll(o) { for (const l of this.guestLinks()) l.send(o); }
  /** Host: which slot a link sits in, or -1. */
  slotOf(l) { return this.slots.indexOf(l); }
  setSignal(s) { this.net.signal = s || null; }
  setTurn(t) { if (t && t.urls) this.net.turn = { urls: t.urls.split(/[ ,]+/).filter(Boolean), username: t.username || undefined, credential: t.credential || undefined }; }
  status(text, kind = 'info') { this.ev.onStatus?.(text, kind); }
  // ───── host ─────
  async host(settings, resume) {
    this.maxPlayers = Math.max(2, Math.min(4, settings?.players || 2));
    this.lobby = { room: '', players: Array.from({ length: this.maxPlayers }, (_, i) => i === 0 ? { ...this.me, ready: true, here: true } : null), settings, resume: resume || null };
    this.net.onlink = l => this.hostAdopt(l);
    this.net.ondrop = id => { const i = this.slots.findIndex(l => l && l.id === id); if (i > 0) this.hostDrop(false, i); };
    this.net.onmsg = (id, m) => { const i = this.slots.findIndex(l => l && l.id === id); if (i > 0) this.hostMsg(m, i); else this.pendingMsg(id, m); };
    this.startHeartbeat();
    const want = resume?.roomCode && CODE_RE.test(resume.roomCode) ? resume.roomCode : Net.code();
    try { this.room = await this.net.hostRoom(want); }
    catch (e) { if (want === resume?.roomCode && /taken/.test(e.message)) { this.room = await this.net.hostRoom(Net.code()).catch(err => { this.status(err.message, 'error'); return ''; }); } else { this.status(e.message + ' You can still invite with a manual code.', 'error'); this.room = ''; } }
    this.lobby.room = this.room; this.pushLobby(); return this.room;
  }
  async manualInvite() { const o = await this.net.manualOffer(); this.manualId = o.id; return o.text; }
  async manualAccept(text) { if (!this.manualId) throw new Error('Make an invitation first.'); await this.net.manualAccept(this.manualId, text); }
  pendingMsg(id, m) { // a second link: only hello matters (to reject politely)
    const l = this.net.links.get(id); if (!l) return; if (m.t === 'hello') this.hostHello(l, m); }
  hostAdopt(l) { l._fresh = true; this.status('Someone is connecting…'); setTimeout(() => { if (l._fresh && l !== this.link) { l.send({ t: 'reject', reason: 'nohello' }); l.close(); } }, 8000); }
  hostHello(l, m) {
    l._fresh = false;
    if (m.proto !== PROTO || String(m.version).split('.')[0] !== VERSION.split('.')[0]) { l.send({ t: 'reject', reason: 'version', version: VERSION }); setTimeout(() => l.close(), 300); this.status(`A player with an incompatible version (${m.version}) tried to join.`, 'error'); return; }
    if (this.slotOf(l) > 0) return;                      // already seated
    // Someone reconnecting takes their old seat back; otherwise the first free one.
    let i = this.lobby.players.findIndex((p, k) => k > 0 && p && p.pid === m.pid && !p.here);
    if (i < 0) i = this.lobby.players.findIndex((p, k) => k > 0 && !p);
    if (i < 0) { l.send({ t: 'reject', reason: 'full' }); setTimeout(() => l.close(), 300); return; }
    const rejoin = !!(this.lobby.players[i] && this.lobby.players[i].pid === m.pid);
    this.slots[i] = l; if (i === 1) { this.link = l; this.guestPid = m.pid; }
    this.lastRx = performance.now();
    this.lobby.players[i] = { name: (m.name || ('Player ' + (i + 1))).slice(0, 16), color: m.color, skin: m.skin, ready: false, here: true, pid: m.pid };
    l.send({ t: 'welcome', room: this.room, version: VERSION, rejoin, slot: i, players: this.maxPlayers });
    this.status(rejoin ? `${this.lobby.players[i].name} reconnected.` : `${this.lobby.players[i].name} joined.`, 'ok');
    if (this.inGame) this.ev.onRejoin?.(this.lobby.players[i], rejoin, i); else this.pushLobby();
  }
  hostMsg(m, i = 1) {
    this.lastRx = performance.now();
    const l = this.slots[i];
    switch (m.t) {
      case 'hello': return this.hostHello(l, m);
      case 'profile': if (this.lobby.players[i]) { Object.assign(this.lobby.players[i], { name: (m.name || '').slice(0, 16) || ('Player ' + (i + 1)), color: m.color, skin: m.skin }); this.pushLobby(); } break;
      case 'ready': if (this.lobby.players[i]) { this.lobby.players[i].ready = !!m.v; this.pushLobby(); } break;
      case 'ping': l?.send({ t: 'pong', c: m.c }); break;
      case 'pong': this.rtt = (performance.now() - m.c) / 1000; break;
      case 'leave': this.status(`${this.lobby.players[i]?.name || 'A climber'} left the game.`, 'warn'); this.hostDrop(true, i); break;
      default: this.ev.onGameMsg?.(m, i);
    }
  }
  hostDrop(left, i = 1) { const was = this.slots[i]; this.slots[i] = null; if (i === 1) this.link = null; if (was) try { was.close(); } catch (e) { }
    if (this.lobby.players[i]) { this.lobby.players[i].here = false; this.lobby.players[i].ready = false; }
    if (!this.inGame) { this.lobby.players[i] = null; if (i === 1) this.guestPid = null; this.pushLobby(); }
    this.ev.onDrop?.(left, i); }
  pushLobby() { this.ev.onLobby?.(this.lobby); this.sendAll({ t: 'lobby', ...this.lobby, players: this.lobby.players.map(p => p && { name: p.name, color: p.color, skin: p.skin, ready: p.ready, here: p.here }) }); }
  /** Everyone expected has arrived and said they are ready. */
  canStart() { const ps = this.lobby?.players || []; return ps.length > 1 && ps.every((p, i) => i === 0 ? true : !!(p && p.here && p.ready)) && this.guestLinks().length === ps.length - 1; }
  /** Host: resize the party (2–4). Guests beyond the new size are dropped. */
  setPlayers(n) { n = Math.max(2, Math.min(4, n)); this.maxPlayers = n;
    for (let i = n; i < this.slots.length; i++) if (this.slots[i]) { try { this.slots[i].send({ t: 'reject', reason: 'full' }); this.slots[i].close(); } catch (e) { } this.slots[i] = null; }
    const ps = this.lobby.players; while (ps.length < n) ps.push(null); ps.length = n;
    this.lobby.settings.players = n; this.pushLobby(); }
  setSettings(s) { Object.assign(this.lobby.settings, s); this.pushLobby(); }
  setMe(me) { Object.assign(this.lobby.players[0], me); this.pushLobby(); }
  sendStart(msg) { this.inGame = true; this.sendAll({ t: 'start', ...msg }); }
  // ───── guest ─────
  async join(code) {
    code = (code || '').trim().toUpperCase(); if (!CODE_RE.test(code)) throw new Error('Invalid room code — codes are 5 letters/numbers (no I, O, 0, 1, B or 8).');
    this.room = code; this.net.onmsg = (id, m) => this.guestMsg(m); this.net.ondrop = () => this.guestDrop();
    this.status('Connecting to room ' + code + '…'); const l = await this.withTimeout(this.net.joinRoom(code), 20000, 'Connection timeout — the host did not answer. Check the code, or try a manual code.'); this.guestLinked(l);
  }
  async manualAnswer(offer) { this.net.onmsg = (id, m) => this.guestMsg(m); this.net.ondrop = () => this.guestDrop(); const a = await this.net.manualAnswer(offer); a.opened.then(l => this.guestLinked(l)).catch(e => this.ev.onError?.(e.message)); return a.text; }
  guestLinked(l) { this.link = l; this.lastRx = performance.now(); this.reconnecting = false; l.send({ t: 'hello', proto: PROTO, version: VERSION, pid, ...this.me }); this.startHeartbeat(); this.helloTimer = setTimeout(() => { if (!this.welcomed) this.ev.onError?.('The host did not respond (different game or version?).'); }, 8000); }
  guestMsg(m) {
    this.lastRx = performance.now();
    switch (m.t) {
      case 'welcome': this.welcomed = true; this.slot = m.slot ?? 1; this.maxPlayers = m.players || 2; clearTimeout(this.helloTimer); if (m.version !== VERSION) this.status(`Host runs ${m.version}, you run ${VERSION} (compatible).`, 'warn'); this.status(m.rejoin ? 'Reconnected!' : 'Connected to the host.', 'ok'); this.ev.onWelcome?.(m); break;
      case 'reject': this.closed = true; this.ev.onError?.(m.reason === 'version' ? `Incompatible game versions: the host runs TETHERED ${m.version}, you run ${VERSION}. Both players need the same version.` : m.reason === 'full' ? 'That room is full.' : 'The host refused the connection.'); this.close(); break;
      case 'lobby': this.lobby = m; this.ev.onLobby?.(m); break;
      case 'start': this.inGame = true; this.ev.onStart?.(m); break;
      case 'ping': this.link?.send({ t: 'pong', c: m.c }); break;
      case 'pong': this.rtt = (performance.now() - m.c) / 1000; break;
      case 'end': this.closed = true; this.ev.onEnd?.(m); break;
      default: this.ev.onGameMsg?.(m);
    }
  }
  guestDrop() { this.link = null; if (this.closed) return; this.ev.onDrop?.(); if (this.room && !this.reconnecting) this.reconnect(); }
  async reconnect() { // PeerJS rooms: retry the same code for up to 60 s
    this.reconnecting = true; const t0 = Date.now(); let n = 0;
    while (!this.closed && Date.now() - t0 < 60000) { n++; this.status(`Connection lost — reconnecting (attempt ${n})…`, 'warn');
      try { try { this.net.peer?.destroy(); } catch (e) { } const l = await this.withTimeout(this.net.joinRoom(this.room), 9000, 'timeout'); this.guestLinked(l); return; } catch (e) { await new Promise(r => setTimeout(r, 2500)); } }
    this.reconnecting = false; if (!this.closed) this.ev.onError?.('Connection lost. The host may have left — ask them for a new code.'); }
  send(o) { this.link?.send(o); }
  startHeartbeat() { clearInterval(this.hb); this.hb = setInterval(() => {
    if (this.role === 'host') { for (let i = 1; i < this.slots.length; i++) this.slots[i]?.send({ t: 'ping', c: performance.now() }); return; }
    if (!this.link) return; this.link.send({ t: 'ping', c: performance.now() });
    if (performance.now() - this.lastRx > 6000) { this.status('No data from the other player for 6 s — connection lost.', 'warn'); const l = this.link; this.link = null; try { l.close(); } catch (e) { } this.guestDrop(); } }, 1000); }
  withTimeout(p, ms, msg) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(msg)), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); }); }
  quality() { if (!this.link) return { q: 'bad', text: this.role === 'host' ? 'Partner offline' : 'Reconnecting…' }; const ms = Math.round(this.rtt * 1000); return { q: ms < 90 ? 'good' : ms < 200 ? 'ok' : 'bad', text: `${ms} ms` }; }
  close() { this.closed = true; clearInterval(this.hb); try { if (this.role === 'guest') this.link?.send({ t: 'leave' }); else this.sendAll({ t: 'end', reason: 'host-left' }); } catch (e) { } setTimeout(() => this.net.close(), 100); }
}
