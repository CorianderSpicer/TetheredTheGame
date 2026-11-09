// Peer-to-peer networking. Two ways to connect, both WebRTC data channels, no game server:
//  1) Room code via the free public PeerJS signalling broker (needs internet for the handshake only).
//  2) Fully manual: the host's "offer" and the joiner's "answer" are exchanged by QR code or copy/paste.
// Topology is a star: the host is authoritative and relays. Without a TURN relay, some networks (symmetric NAT,
// some carrier-grade / corporate networks) cannot connect at all — see README.
const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];
export const PROTO = 'tethered-v1';
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function pack(obj) { const txt = JSON.stringify(obj); if (typeof CompressionStream === 'function') { const cs = new Blob([txt]).stream().pipeThrough(new CompressionStream('deflate-raw')); return 'DA1.' + b64u(await new Response(cs).arrayBuffer()); } return 'DA0.' + b64u(new TextEncoder().encode(txt)); }
async function unpack(s) { s = s.trim().replace(/\s+/g, ''); const [h, body] = [s.slice(0, 4), s.slice(4)]; const bytes = unb64u(body);
  if (h === 'DA1.') { const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return JSON.parse(await new Response(ds).text()); }
  if (h === 'DA0.') return JSON.parse(new TextDecoder().decode(bytes)); throw new Error('Not a Tethered connection code'); }
const slimSDP = sdp => sdp.split('\r\n').filter(l => l && !/^a=(extmap|rtcp-fb|ssrc|msid|ice-options:trickle)/.test(l)).join('\r\n') + '\r\n';
function waitIce(pc, ms = 3500) { return new Promise(res => { if (pc.iceGatheringState === 'complete') return res(); const t = setTimeout(res, ms); pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } }); }); }

class Link { // wraps a PeerJS DataConnection or a raw RTCDataChannel
  constructor(kind, ch, id) { this.kind = kind; this.ch = ch; this.id = id; this.open = false; this.onmsg = null; this.onclose = null; this.lastRx = performance.now(); }
  send(o) { if (!this.open) return; try { if (this.kind === 'peer') this.ch.send(o); else this.ch.send(JSON.stringify(o)); } catch (e) { /* closed mid-send */ } }
  close() { try { this.ch.close(); } catch (e) { } this._closed(); }
  _rx(o) { this.lastRx = performance.now(); if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return; } } this.onmsg?.(o); }
  _closed() { if (!this.open && this._dead) return; this.open = false; this._dead = true; this.onclose?.(); }
}
export class Net {
  constructor() { this.links = new Map(); this.host = false; this.peer = null; this.pending = new Map(); this.turn = null; this.signal = null; this.onlink = null; this.ondrop = null; this.onmsg = null; this.seq = 0; }
  ice() { return this.turn?.urls ? [...ICE, this.turn] : ICE; }
  // optional self-hosted PeerJS signalling server ('host:port/path', 'https://host/path'); blank = PeerJS public cloud
  peerOpts() { const s = (this.signal || '').trim(); const base = { config: { iceServers: this.ice() }, debug: 0 }; if (!s) return base; try { const u = new URL(/^https?:/.test(s) ? s : 'http://' + s); return { ...base, host: u.hostname, port: +(u.port || (u.protocol === 'https:' ? 443 : 80)), path: u.pathname || '/', secure: u.protocol === 'https:', key: u.searchParams.get('key') || 'peerjs' }; } catch (e) { return base; } }
  _adopt(link) { link.onmsg = m => this.onmsg?.(link.id, m); link.onclose = () => { if (this.links.get(link.id) === link) { this.links.delete(link.id); this.ondrop?.(link.id); } }; this.links.set(link.id, link); this.onlink?.(link); }
  send(id, o) { this.links.get(id)?.send(o); }
  broadcast(o, except) { for (const [id, l] of this.links) if (id !== except) l.send(o); }
  // ── PeerJS room codes ──
  static code() { const A = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679'; let s = ''; for (let i = 0; i < 5; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }
  hostRoom(code) { return new Promise((res, rej) => { if (!window.Peer) return rej(new Error('PeerJS failed to load')); this.host = true;
    const p = this.peer = new window.Peer(`${PROTO}-${code}`, this.peerOpts()); const to = setTimeout(() => rej(new Error('Signalling server did not answer (offline?) — use Manual / QR instead.')), 12000);
    p.on('open', () => { clearTimeout(to); res(code); }); p.on('error', e => { clearTimeout(to); rej(new Error(e.type === 'unavailable-id' ? 'That room code is taken — try again.' : e.type === 'network' || e.type === 'server-error' ? 'Cannot reach the signalling server — use Manual / QR.' : String(e.message || e.type))); });
    p.on('connection', conn => { const l = new Link('peer', conn, 'p' + (++this.seq)); conn.on('open', () => { l.open = true; this._adopt(l); }); conn.on('data', d => l._rx(d)); conn.on('close', () => l._closed()); conn.on('error', () => l._closed()); }); }); }
  joinRoom(code) { return new Promise((res, rej) => { if (!window.Peer) return rej(new Error('PeerJS failed to load')); this.host = false;
    const p = this.peer = new window.Peer(this.peerOpts()); const to = setTimeout(() => rej(new Error('Could not reach the host. Check the code, or try Manual / QR (TURN may be needed on this network).')), 20000);
    p.on('error', e => { clearTimeout(to); rej(new Error(e.type === 'peer-unavailable' ? 'No lobby with that code.' : e.type === 'network' || e.type === 'server-error' ? 'Cannot reach the signalling server — use Manual / QR.' : String(e.message || e.type))); });
    p.on('open', () => { const conn = p.connect(`${PROTO}-${code.toUpperCase()}`, { reliable: true, serialization: 'json' }); const l = new Link('peer', conn, 'host');
      conn.on('open', () => { clearTimeout(to); l.open = true; this._adopt(l); res(l); }); conn.on('data', d => l._rx(d)); conn.on('close', () => l._closed()); conn.on('error', () => l._closed()); }); }); }
  // ── manual offer / answer (QR or copy-paste) ──
  async manualOffer() { this.host = true; const pc = new RTCPeerConnection({ iceServers: this.ice() }); const dc = pc.createDataChannel('da', { ordered: true }); const id = 'm' + (++this.seq); const l = new Link('rtc', dc, id); l.pc = pc;
    dc.onopen = () => { l.open = true; this._adopt(l); this.pending.delete(id); }; dc.onmessage = e => l._rx(e.data); dc.onclose = () => l._closed();
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) l._closed(); };
    await pc.setLocalDescription(await pc.createOffer()); await waitIce(pc); this.pending.set(id, l);
    return { id, text: await pack({ v: 1, k: 'o', id, sdp: slimSDP(pc.localDescription.sdp) }) }; }
  async manualAccept(id, answerText) { const l = this.pending.get(id); if (!l) throw new Error('That invitation expired — make a new one.'); const a = await unpack(answerText); if (a.k !== 'a') throw new Error('That is not an answer code.'); if (a.id && a.id !== id) throw new Error('That answer belongs to a different invitation.'); await l.pc.setRemoteDescription({ type: 'answer', sdp: a.sdp }); }
  async manualAnswer(offerText) { this.host = false; const o = await unpack(offerText); if (o.k !== 'o') throw new Error('That is not an invitation code.'); const pc = new RTCPeerConnection({ iceServers: this.ice() }); const l = new Link('rtc', null, 'host'); l.pc = pc;
    const opened = new Promise((res, rej) => { pc.ondatachannel = e => { const dc = l.ch = e.channel; dc.onopen = () => { l.open = true; this._adopt(l); res(l); }; dc.onmessage = ev => l._rx(ev.data); dc.onclose = () => l._closed(); }; pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') { rej(new Error('Connection failed (NAT/firewall). Both devices on the same Wi-Fi usually works; otherwise a TURN server is needed.')); l._closed(); } }; });
    await pc.setRemoteDescription({ type: 'offer', sdp: o.sdp }); await pc.setLocalDescription(await pc.createAnswer()); await waitIce(pc);
    return { text: await pack({ v: 1, k: 'a', id: o.id, sdp: slimSDP(pc.localDescription.sdp) }), opened }; }
  close() { for (const l of this.links.values()) l.close(); for (const l of this.pending.values()) l.close(); this.links.clear(); this.pending.clear(); try { this.peer?.destroy(); } catch (e) { } this.peer = null; }
}
// QR helpers (qrcode-generator + jsQR, both loaded as classic scripts)
export function qrSVG(text) { if (!window.qrcode) return ''; const q = window.qrcode(0, 'L'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 3, margin: 2, scalable: true }); }
export async function scanQR(video, onText) { // camera scanner; returns a stop() function
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); video.srcObject = stream; video.setAttribute('playsinline', ''); await video.play();
  const cv = document.createElement('canvas'), g = cv.getContext('2d', { willReadFrequently: true }); let live = true;
  const tick = () => { if (!live) return; if (video.readyState >= 2) { const w = cv.width = Math.min(640, video.videoWidth), h = cv.height = Math.round(video.videoHeight * w / video.videoWidth); g.drawImage(video, 0, 0, w, h); const r = window.jsQR?.(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' }); if (r?.data?.startsWith('DA')) { stop(); onText(r.data); return; } } requestAnimationFrame(tick); };
  const stop = () => { live = false; stream.getTracks().forEach(t => t.stop()); video.srcObject = null; }; tick(); return stop; }
export { pack, unpack };
