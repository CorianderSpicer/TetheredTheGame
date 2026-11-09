// Save-file format and validation (shared by the browser save system and the Node tests).
import { VERSION } from './sim.js';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isVec = v => v && isNum(v.x) && isNum(v.y) && isNum(v.z);
const isStr = v => typeof v === 'string';

export function major(v) { return parseInt(String(v).split('.')[0], 10); }

// older or minimal files (e.g. the 1.0 example) get the optional `extra` block filled in
export function migrate(s) {
  if (!s || typeof s !== 'object') return s;
  s = JSON.parse(JSON.stringify(s));
  s.extra = Object.assign({ revision: 0, mode: 'normal', falls: { total: 0, host: 0, guest: 0 }, relics: [], checkpointsReached: [], splits: [] }, s.extra || {});
  return s;
}

export function validateSave(s) {
  const err = (m) => ({ ok: false, error: m });
  if (!s || typeof s !== 'object' || Array.isArray(s)) return err('Not a save file (expected a JSON object).');
  if (!isStr(s.gameVersion)) return err('Missing "gameVersion".');
  if (major(s.gameVersion) !== major(VERSION)) return err(`This save is from TETHERED ${s.gameVersion}; this build is ${VERSION} and cannot read it.`);
  if (!isStr(s.saveId) || !s.saveId) return err('Missing "saveId".');
  if (!isStr(s.roomCode)) return err('Missing "roomCode".');
  if (!isStr(s.timestamp) || isNaN(Date.parse(s.timestamp))) return err('"timestamp" is not an ISO date.');
  for (const k of ['host', 'guest']) {
    const p = s[k]; if (!p || typeof p !== 'object') return err(`Missing "${k}".`);
    if (!isStr(p.playerId) || !isStr(p.name)) return err(`"${k}" needs playerId and name.`);
    for (const v of ['position', 'rotation', 'velocity']) if (!isVec(p[v])) return err(`"${k}.${v}" must be {x,y,z} numbers.`);
    if (Math.abs(p.position.y) > 2000 || Math.abs(p.position.x) > 5000 || Math.abs(p.position.z) > 5000) return err(`"${k}.position" is outside the world.`);
  }
  const c = s.chain; if (!c || !isNum(c.maximumLength) || c.maximumLength < 2 || c.maximumLength > 30 || !isNum(c.tension) || !isStr(c.state)) return err('"chain" block is invalid.');
  const g = s.progress; if (!g || !isNum(g.level) || g.level < 1 || g.level > 5 || !isStr(g.checkpointId) || !/^checkpoint-\d\d$/.test(g.checkpointId) || !isNum(g.heightReached) || !isNum(g.elapsedTime) || g.elapsedTime < 0) return err('"progress" block is invalid.');
  const warnings = []; if (s.gameVersion !== VERSION) warnings.push(`Saved with ${s.gameVersion}, loading in ${VERSION}.`);
  if (c.maximumLength < 6 || c.maximumLength > 12) warnings.push('Chain length will be clamped to 6–12 m.');
  return { ok: true, warnings };
}
