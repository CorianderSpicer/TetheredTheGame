// Local profile: settings, personal records, unlocks (zones for Practice, skins, chain styles), relics and
// challenge objectives. Stored in localStorage; every read/write is guarded so a blocked storage never breaks play.
import { SKINS } from './char.js';
import { CHAIN_STYLES } from './render.js';
const KEY = 'tethered.profile.v1';
export const CHALLENGES = [
  { id: 'summit', name: 'First Ascent', desc: 'Ring the summit bell in any mode.' },
  { id: 'clean', name: 'Sure Footed', desc: 'Reach the summit with 5 falls or fewer.' },
  { id: 'flawless', name: 'Flawless', desc: 'Reach the summit without a single fall.' },
  { id: 'hardcore', name: 'No Second Chances', desc: 'Finish a Hardcore run.' },
  { id: 'speed20', name: 'Rope Burn', desc: 'Finish under 20:00 (Speedrun mode).' },
  { id: 'speed12', name: 'Free Solo… Ish', desc: 'Finish under 12:00 (Speedrun mode).' },
  { id: 'relics5', name: 'Treasure Hunters', desc: 'Find 5 relics.' },
  { id: 'relics10', name: 'Every Last One', desc: 'Find all 10 relics.' },
  { id: 'shortchain', name: 'Short Leash', desc: 'Finish with the chain set to 6 m.' },
  { id: 'rescue', name: 'Got You!', desc: 'Rescue a dangling partner 10 times.' },
];
const def = () => ({ name: '', color: '#ff7a45', skin: 'kip', chainStyle: 'steel', settings: { quality: matchMedia('(pointer: coarse)').matches ? 'medium' : 'high', master: 0.8, music: 0.6, sfx: 0.9, muted: false, sens: 1, invert: false, fov: 62, hints: true, turn: { urls: '', username: '', credential: '' } },
  stats: { runs: 0, finishes: 0, falls: 0, rescues: 0, maxAlt: 0, playTime: 0 }, best: {}, zoneBest: [], records: [], relics: [], unlockedZones: [0], challenges: [] });
export const Profile = {
  d: def(),
  load() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) { const d = def(); this.d = { ...d, ...v, settings: { ...d.settings, ...(v.settings || {}) }, stats: { ...d.stats, ...(v.stats || {}) } }; } } catch (e) { } return this.d; },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.d)); } catch (e) { } },
  relicCount() { return this.d.relics.length; },
  skinUnlocked(id) { const s = SKINS.find(k => k.id === id); return !s || this.relicCount() >= s.unlock || (s.unlock === 0); },
  chainUnlocked(id) { const s = CHAIN_STYLES.find(k => k.id === id); return !s || this.relicCount() >= s.unlock; },
  addRelics(ids) { let n = 0; for (const id of ids) if (!this.d.relics.includes(id)) { this.d.relics.push(id); n++; } if (n) this.save(); return n; },
  unlockZone(z) { if (!this.d.unlockedZones.includes(z)) { this.d.unlockedZones.push(z); this.d.unlockedZones.sort(); this.save(); } },
  complete(id) { if (!this.d.challenges.includes(id)) { this.d.challenges.push(id); this.save(); return CHALLENGES.find(c => c.id === id); } return null; },
  // a finished run → records + challenge checks; returns {newBest, earned[]}
  finish(v) {
    const d = this.d, out = { newBest: false, earned: [] }; d.stats.finishes++; const key = v.mode;
    if (v.mode !== 'practice') { if (!d.best[key] || v.time < d.best[key].time) { d.best[key] = { time: v.time, falls: v.falls, date: v.date, partner: v.names }; out.newBest = true; }
      v.splits.forEach((s, i) => { if (s > 0 && (!d.zoneBest[i] || s < d.zoneBest[i])) d.zoneBest[i] = s; });
      d.records.push({ version: v.version, mode: v.mode, time: v.time, falls: v.falls, relics: v.relics, chain: v.chain, splits: v.splits, players: v.names, date: v.date, saveId: v.saveId || null }); d.records.sort((a, b) => a.time - b.time); d.records = d.records.slice(0, 25); }
    const e = (id) => { const c = this.complete(id); if (c) out.earned.push(c); };
    e('summit'); if (v.falls <= 5) e('clean'); if (v.falls === 0) e('flawless'); if (v.mode === 'hardcore') e('hardcore'); if (v.mode === 'speedrun' && v.time < 1200) e('speed20'); if (v.mode === 'speedrun' && v.time < 720) e('speed12'); if (v.chain <= 6) e('shortchain');
    if (this.relicCount() >= 5) e('relics5'); if (this.relicCount() >= 10) e('relics10'); this.save(); return out;
  },
  noteRescue() { this.d.stats.rescues++; if (this.d.stats.rescues >= 10) this.complete('rescue'); this.save(); },
};
