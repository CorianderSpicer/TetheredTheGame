// Browser save system:
//  • Download Save  → a JSON file (tethered-save-YYYY-MM-DD-HHMM.json). A downloaded file is a one-off copy; it is
//    never updated afterwards.
//  • Recovery snapshots → IndexedDB, written automatically (every 30 s, at checkpoints, before leaving to the menu,
//    when the partner disconnects, when the tab is hidden).
//  • Linked save file → File System Access API (Chrome/Edge desktop): the host picks a file once; "Save Game" and
//    autosaves then write into that file. Safari / iPad / Firefox fall back to download + IndexedDB.
//  • Session lock → one tab per session (localStorage heartbeat), and revision numbers stop an older copy of a
//    session from silently replacing a newer one.
import { validateSave, migrate } from './save-core.js';
export { validateSave, migrate };

const DB = 'tethered', STORE = 'saves', META = 'meta';
function idb() { return new Promise((res, rej) => { if (!('indexedDB' in window)) return rej(new Error('IndexedDB unavailable')); const r = indexedDB.open(DB, 2); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'saveId' }); if (!d.objectStoreNames.contains(META)) d.createObjectStore(META); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function tx(store, mode, fn) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); let out; Promise.resolve(fn(s)).then(v => { out = v; }); t.oncomplete = () => { d.close(); res(out); }; t.onerror = () => { d.close(); rej(t.error); }; }); }
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const newSaveId = () => 'tth-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
export const TAB = Math.random().toString(36).slice(2);

export const Saves = {
  async put(save, label) { const rec = { saveId: save.saveId, updated: Date.now(), revision: save.extra?.revision || 0, label: label || '', data: save };
    const cur = await this.get(save.saveId).catch(() => null); if (cur && cur.revision > rec.revision) throw new Error('A newer copy of this session already exists in this browser.');
    await tx(STORE, 'readwrite', s => req(s.put(rec))); return rec; },
  async get(id) { return tx(STORE, 'readonly', s => req(s.get(id))); },
  async list() { const all = await tx(STORE, 'readonly', s => req(s.getAll())); return (all || []).sort((a, b) => b.updated - a.updated); },
  async remove(id) { return tx(STORE, 'readwrite', s => req(s.delete(id))); },
  async setMeta(k, v) { return tx(META, 'readwrite', s => req(s.put(v, k))); },
  async getMeta(k) { return tx(META, 'readonly', s => req(s.get(k))); },
};

export function fileName(d = new Date()) { const p = n => String(n).padStart(2, '0'); return `tethered-save-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`; }
export function download(save) { const blob = new Blob([JSON.stringify(save, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fileName(); document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return a.download; }
export async function readFile(file) { if (file.size > 2e6) throw new Error('That file is too large to be a TETHERED save.'); let s; try { s = JSON.parse(await file.text()); } catch (e) { throw new Error('That file is not valid JSON.'); } s = migrate(s); const v = validateSave(s); if (!v.ok) throw new Error(v.error); return { save: s, warnings: v.warnings }; }

// ── File System Access: a writable linked file ──
export const FSA = {
  supported: () => typeof window.showSaveFilePicker === 'function',
  handle: null, name: '',
  async link() { const h = await window.showSaveFilePicker({ suggestedName: 'tethered-session.json', types: [{ description: 'TETHERED save', accept: { 'application/json': ['.json'] } }] }); this.handle = h; this.name = h.name; try { await Saves.setMeta('fsa', h); } catch (e) { } return h.name; },
  async restore() { if (!this.supported()) return null; try { const h = await Saves.getMeta('fsa'); if (h) { this.handle = h; this.name = h.name; } } catch (e) { } return this.handle; },
  async granted(ask) { const h = this.handle; if (!h) return false; const o = { mode: 'readwrite' }; if ((await h.queryPermission?.(o)) === 'granted') return true; if (ask && (await h.requestPermission?.(o)) === 'granted') return true; return false; },
  async write(save, ask = false) { if (!this.handle || !(await this.granted(ask))) return false; const w = await this.handle.createWritable(); await w.write(JSON.stringify(save, null, 2)); await w.close(); return true; },
  async unlink() { this.handle = null; this.name = ''; try { await Saves.setMeta('fsa', null); } catch (e) { } },
};

// ── one tab per session ──
export const Lock = {
  key: id => 'tethered.lock.' + id, timer: null, id: null,
  holder(id) { try { const v = JSON.parse(localStorage.getItem(this.key(id)) || 'null'); if (v && v.tab !== TAB && Date.now() - v.t < 6000) return v; } catch (e) { } return null; },
  take(id) { if (this.holder(id)) return false; this.release(); this.id = id; const beat = () => { try { localStorage.setItem(this.key(id), JSON.stringify({ tab: TAB, t: Date.now() })); } catch (e) { } }; beat(); this.timer = setInterval(beat, 2000); return true; },
  release() { if (this.timer) clearInterval(this.timer); this.timer = null; if (this.id) { try { const v = JSON.parse(localStorage.getItem(this.key(this.id)) || 'null'); if (v?.tab === TAB) localStorage.removeItem(this.key(this.id)); } catch (e) { } } this.id = null; },
};
