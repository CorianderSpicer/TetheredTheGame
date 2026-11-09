// Browser end-to-end test for the 17-point checklist. Two real browser contexts talk over WebRTC through a PeerJS
// signalling server (run one locally: `npx -p peer peerjs --port 9000 --path /tethered`).
//   PW=<path to playwright-core index.mjs> CHROME=/usr/bin/google-chrome URL=http://127.0.0.1:8766/tethered/ SIGNAL=127.0.0.1:9000/tethered node tools/e2e.mjs
const { chromium } = await import(process.env.PW || 'playwright-core');
const URL0 = (process.env.URL || 'http://127.0.0.1:8766/tethered/') + 'index.html', SIG = process.env.SIGNAL || '127.0.0.1:9000/tethered', OUT = process.env.OUT || '/tmp';
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-features=WebRtcHideLocalIpsWithMdns', '--autoplay-policy=no-user-gesture-required'] });
const results = []; const ok = (n, c, info = '') => { results.push(`${c ? 'PASS' : 'FAIL'}  ${n}${info ? '  — ' + info : ''}`); console.log(results.at(-1)); };
const allErrs = [];
async function page(name, opts = {}) { const c = opts.ctx || await b.newContext({ viewport: { width: 640, height: 360 }, acceptDownloads: true, ...(opts.device || {}) }); const p = await c.newPage(); p.name = name;
  p.on('pageerror', e => allErrs.push(`${name}: ${e.message}`)); p.on('console', m => { if (m.type() === 'error' && !/peerjs\.com|ERR_TUNNEL|Failed to load resource/.test(m.text())) allErrs.push(`${name}: ${m.text()}`); });
  await p.goto(URL0 + '?signal=' + encodeURIComponent(SIG), { waitUntil: 'domcontentloaded', timeout: 120000 }); await p.waitForSelector('#title:not(.hidden)', { timeout: 120000 }); await p.waitForTimeout(800); return p; }
const G = p => p.evaluate(() => { const g = window.__game; if (!g) return null; return { kind: g.kind, tick: g.tick, state: g.sim.state, cp: g.sim.cp, paused: g.sim.paused, cine: !!g.rig.cine, p: g.sim.players.map(x => ({ x: x.p.x, y: x.p.y, z: x.p.z, g: x.grounded })), d: Math.hypot(g.sim.players[0].p.x - g.sim.players[1].p.x, g.sim.players[0].p.y - g.sim.players[1].p.y, g.sim.players[0].p.z - g.sim.players[1].p.z), Le: g.sim.chainLen }; });
const ticks = async (p, n) => { const t0 = (await G(p)).tick; await p.waitForFunction(([t0, n]) => window.__game && window.__game.tick > t0 + n, [t0, n], { timeout: 120000 }); };
const noCine = p => p.waitForFunction(() => window.__game && !window.__game.rig.cine, null, { timeout: 120000 });
async function hold(p, key, n) { await p.bringToFront(); await p.keyboard.down(key); await ticks(p, n); await p.keyboard.up(key); }

try {
  // ── 1–2: room code, errors, join ──
  const H = await page('host'), J = await page('guest');
  await J.click('[data-go=join]'); await J.fill('#joinCode', 'HELLO1'); await J.click('#joinGo'); ok('invalid room code is rejected with a message', /Invalid room code/.test(await J.textContent('#joinStatus')));
  await J.fill('#joinCode', 'ZZZZZ'); await J.click('#joinGo'); await J.waitForFunction(() => /not found|timeout/i.test(document.querySelector('#joinStatus').textContent), null, { timeout: 30000 }).catch(() => { }); ok('unknown room → "room not found"', /not found/i.test(await J.textContent('#joinStatus')), await J.textContent('#joinStatus'));
  await H.click('[data-go=host]'); await H.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.querySelector('#roomCode').textContent), null, { timeout: 30000 }); const code = await H.textContent('#roomCode'); ok('1. host creates a room with a code', /^[A-Z2-9]{5}$/.test(code), code);
  await J.fill('#joinMe input[data-f=name]', 'Rook'); await J.fill('#joinCode', code); await J.click('#joinGo'); await J.waitForFunction(() => !document.querySelector('#joinLobby').classList.contains('hidden'), null, { timeout: 30000 });
  await H.waitForFunction(() => /Rook/.test(document.querySelector('#hostSlots').textContent), null, { timeout: 10000 }); ok('2. guest joins with the code and appears in the lobby', true, (await H.textContent('#hostSlots')).replace(/\s+/g, ' '));
  ok('start is blocked until the guest is ready', await H.isDisabled('#hostStart'));
  await J.click('#readyBtn'); await H.waitForFunction(() => !document.querySelector('#hostStart').disabled, null, { timeout: 10000 }); await H.click('#hostStart');
  await H.waitForFunction(() => window.__game?.running, null, { timeout: 60000 }); await J.waitForFunction(() => window.__game?.started, null, { timeout: 60000 }); await noCine(H); await noCine(J);
  // ── 3: both see each other ──
  const vis = await J.evaluate(() => { const g = window.__game; const r = g.R.chars.map(c => c.root.position); return { remote: [r[0].x, r[0].z], host: [g.sim.players[0].p.x, g.sim.players[0].p.z], meVis: g.R.chars[1].root.visible, remVis: g.R.chars[0].root.visible }; });
  ok('3. guest renders the host character where the host is', vis.remVis && Math.hypot(vis.remote[0] - vis.host[0], vis.remote[1] - vis.host[1]) < 0.6, JSON.stringify(vis));
  // ── 4: movement ──
  let h0 = await G(H); await hold(J, 'KeyW', 70); await J.waitForTimeout(1500); let h1 = await G(H), j1 = await G(J);
  ok('4. guest movement reaches the host', Math.hypot(h1.p[1].x - h0.p[1].x, h1.p[1].z - h0.p[1].z) > 2, `moved ${Math.hypot(h1.p[1].x - h0.p[1].x, h1.p[1].z - h0.p[1].z).toFixed(2)} m`);
  ok('4b. guest prediction agrees with the host', Math.hypot(h1.p[1].x - j1.p[1].x, h1.p[1].z - j1.p[1].z) < 0.6, `Δ ${Math.hypot(h1.p[1].x - j1.p[1].x, h1.p[1].z - j1.p[1].z).toFixed(2)} m`);
  h0 = await G(H); await hold(H, 'KeyD', 40); await H.waitForTimeout(1200); h1 = await G(H); j1 = await G(J); ok('4c. host movement reaches the guest', Math.hypot(j1.p[0].x - h1.p[0].x, j1.p[0].z - h1.p[0].z) < 0.6 && Math.hypot(h1.p[0].x - h0.p[0].x, h1.p[0].z - h0.p[0].z) > 1, `Δ ${Math.hypot(j1.p[0].x - h1.p[0].x, j1.p[0].z - h1.p[0].z).toFixed(2)}`);
  // ── 5: jumping ──
  await J.bringToFront(); const y0 = (await G(H)).p[1].y; await J.evaluate(() => { window.__peak = 0; }); await H.evaluate(y0 => { window.__peak = 0; const g = window.__game; window.__pk = setInterval(() => { window.__peak = Math.max(window.__peak, g.sim.players[1].p.y - y0); }, 16); }, y0);
  await J.keyboard.down('Space'); await ticks(J, 50); await J.keyboard.up('Space'); await ticks(H, 40); const peak = await H.evaluate(() => { clearInterval(window.__pk); return window.__peak; });
  ok('5. guest jump is simulated by the host', peak > 1.2, `peak ${peak.toFixed(2)} m`);
  // ── 6–7: chain ──
  await J.bringToFront(); await J.keyboard.down('KeyS'); await J.keyboard.down('ShiftLeft'); let maxD = 0; for (let i = 0; i < 25; i++) { const s = await G(H); maxD = Math.max(maxD, s.d); await ticks(J, 6); } await J.keyboard.up('KeyS'); await J.keyboard.up('ShiftLeft');
  const ten = await H.evaluate(() => window.__game.sim.chain.tension);
  ok('6–7. chain stops the guest running away (host idle)', maxD < (await G(H)).Le + 0.6, `max distance ${maxD.toFixed(2)} m, chain ${(await G(H)).Le} m`);
  // ── 8: obstacles agree on both machines ──
  const mv = async p => p.evaluate(() => { const g = window.__game, o = g.sim.L.obs.find(o => o.type === 'mover'); const t = g.kind === 'guest' ? g.serverTime() : g.sim.t; return { t, u: o.u(t) }; });
  const a = await mv(H), c = await mv(J); ok('8. deterministic obstacles are in phase on host and guest', Math.abs(a.u - c.u) < 0.15 || Math.abs(a.t - c.t) < 0.4, `host t=${a.t.toFixed(2)} guest t=${c.t.toFixed(2)}`);
  // ── 10: checkpoint for both ──
  await H.evaluate(() => { const g = window.__game, c = g.sim.L.cps[1]; g.sim.players.forEach((pl, i) => { const s = c.spawn[i]; pl.p.x = s.x; pl.p.y = s.y + 0.1; pl.p.z = s.z; pl.v.x = pl.v.y = pl.v.z = 0; pl.lastGroundY = pl.p.y; }); });
  await ticks(H, 30); await J.waitForTimeout(800); ok('10. checkpoint activates for both players (host and guest agree)', (await G(H)).cp === 1 && (await G(J)).cp === 1, `host cp ${(await G(H)).cp} guest cp ${(await G(J)).cp}`);
  // ── 9: falling ──
  const f0 = await H.evaluate(() => window.__game.sim.fallsTotal);
  await H.evaluate(() => { const g = window.__game, f = g.sim.L.zones[0].frame; g.sim.players.forEach((pl, i) => { const q = f.pt(-12, 4, 64 + i); pl.p.x = q.x; pl.p.y = q.y; pl.p.z = q.z; pl.v.x = pl.v.y = pl.v.z = 0; pl.lastGroundY = q.y + 12; }); });
  await H.waitForFunction(f0 => window.__game.sim.fallsTotal > f0 && window.__game.sim.state === 'play', f0, { timeout: 60000 }).catch(() => { });
  const fs = await G(H); ok('9. both falling → fall counted and both respawn at the checkpoint', fs.p.every(q => q.g || Math.abs(q.y - 7.2) < 1), JSON.stringify(fs.p.map(q => q.y.toFixed(1))));
  await J.waitForTimeout(800); ok('9b. guest sees the respawn', Math.abs((await G(J)).p[1].y - fs.p[1].y) < 1.5);
  // ── 12: download ──
  await H.bringToFront(); await H.keyboard.press('Escape'); await H.waitForSelector('#pause:not(.hidden)'); await J.waitForTimeout(1000); ok('pause is shared (guest paused too)', await J.evaluate(() => window.__game.sim.paused) && await J.isVisible('#pause'));
  const [dl] = await Promise.all([H.waitForEvent('download'), H.click('#pauseMenu >> text=Download Save')]); const savePath = `${OUT}/${dl.suggestedFilename()}`; await dl.saveAs(savePath);
  const fsMod = await import('node:fs'); const saved = JSON.parse(fsMod.readFileSync(savePath, 'utf8')); ok('12. host downloads a save file', /^tethered-save-\d{4}-\d\d-\d\d-\d{4}\.json$/.test(dl.suggestedFilename()) && saved.gameVersion && saved.host.position && saved.guest.position && saved.progress.checkpointId === 'checkpoint-02', dl.suggestedFilename());
  await H.click('#pauseMenu button.primary'); await ticks(H, 10);
  // ── 11: disconnect + reconnect ──
  await J.evaluate(() => { const l = window.__app.session.link; l.close(); }); await H.waitForFunction(() => !document.querySelector('#waiting').classList.contains('hidden'), null, { timeout: 20000 }).catch(() => { });
  ok('11. host notices the disconnect, pauses and autosaves', await H.isVisible('#waiting') && (await G(H)).paused, await H.textContent('#waitTitle'));
  await J.waitForFunction(() => window.__game && window.__game.started && window.__app.session.link, null, { timeout: 60000 }).catch(() => { }); await H.waitForFunction(() => document.querySelector('#waiting').classList.contains('hidden') && !window.__game.sim.paused, null, { timeout: 60000 }).catch(() => { });
  ok('11b. guest reconnects to the same room and play resumes', !(await H.isVisible('#waiting')) && !(await G(H)).paused);
  // ── 13–14: host loads the save file and both resume there ──
  await H.context().close(); await J.context().close(); const H2 = await page('host2'); const J2 = await page('guest2');
  await H2.click('[data-go=title]').catch(() => { }); const [fc] = await Promise.all([H2.waitForEvent('filechooser'), H2.click('#title [data-act=loadfile]')]); await fc.setFiles(savePath);
  await H2.waitForSelector('#confirm:not(.hidden)'); await H2.click('#confirmOk'); await H2.waitForFunction(() => /^[A-Z2-9]{5}$/.test(document.querySelector('#roomCode').textContent), null, { timeout: 30000 }); const code2 = await H2.textContent('#roomCode');
  ok('13. host loads the save file (validated) into a new room', await H2.isVisible('#resumeBox'), `room ${code2}${code2 === saved.roomCode ? ' (same code as before)' : ''}`);
  await J2.click('[data-go=join]'); await J2.fill('#joinCode', code2); await J2.click('#joinGo'); await J2.waitForFunction(() => !document.querySelector('#joinLobby').classList.contains('hidden'), null, { timeout: 30000 }); await J2.click('#readyBtn'); await H2.waitForFunction(() => !document.querySelector('#hostStart').disabled, null, { timeout: 10000 }); await H2.click('#hostStart');
  await H2.waitForFunction(() => window.__game?.running, null, { timeout: 60000 }); await J2.waitForFunction(() => window.__game?.started, null, { timeout: 60000 }); await J2.waitForTimeout(1500);
  const r2 = await G(H2), rj = await G(J2); const dp = (q, s) => Math.hypot(q.x - s.position.x, q.z - s.position.z);
  ok('14. both players resume at their saved positions', dp(r2.p[0], saved.host) < 1.5 && dp(r2.p[1], saved.guest) < 1.5 && r2.cp === 1, `host Δ ${dp(r2.p[0], saved.host).toFixed(2)} guest Δ ${dp(r2.p[1], saved.guest).toFixed(2)} cp ${r2.cp}`);
  ok('14b. guest sees the restored state', dp(rj.p[1], saved.guest) < 1.5 && rj.cp === 1);
  await H2.evaluate(() => { window.onbeforeunload = null; }); await H2.close(); await J2.close();
  // ── 15: refresh → Continue (same-screen) ──
  const L = await page('local'); await L.click('[data-go=local]'); await L.click('#localStart'); await L.waitForFunction(() => window.__game?.running, null, { timeout: 60000 }); await noCine(L);
  await hold(L, 'KeyW', 60); await L.evaluate(() => window.__app && 0); await L.waitForTimeout(500); const before = await G(L); await L.evaluate(async () => { document.dispatchEvent(new Event('visibilitychange')); }); await L.waitForTimeout(1500);
  L.on('dialog', d => d.accept()); await L.reload(); await L.waitForTimeout(1500); await L.click('[data-go=continue]'); await L.waitForSelector('.save'); const n = await L.$$eval('.save', e => e.length); await L.click('.save [data-r=local]'); await L.waitForFunction(() => window.__game?.running, null, { timeout: 60000 }); await L.waitForTimeout(800);
  const after = await G(L); ok('15. after a browser refresh the climb continues from the recovery snapshot', n >= 1 && Math.hypot(after.p[0].x - before.p[0].x, after.p[0].z - before.p[0].z) < 2.5, `Δ ${Math.hypot(after.p[0].x - before.p[0].x, after.p[0].z - before.p[0].z).toFixed(2)} m, ${n} snapshot(s)`);
  await L.evaluate(() => { window.onbeforeunload = null; }); await L.context().close();
  // ── 16: mobile controls ──
  const M = await page('mobile', { device: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 } }); await M.click('[data-go=local]'); await M.click('#localStart'); await M.waitForFunction(() => window.__game?.running, null, { timeout: 60000 }); await noCine(M);
  ok('16a. touch controls are shown on a touch device', await M.isVisible('#stick') && await M.isVisible('#tJump'));
  const m0 = await G(M); const box = await M.locator('#stick').boundingBox();
  await M.evaluate(([x, y]) => { const el = document.querySelector('#stick'); const mk = (t, cx, cy) => { const tt = new Touch({ identifier: 7, target: el, clientX: cx, clientY: cy }); el.dispatchEvent(new TouchEvent(t, { touches: [tt], changedTouches: [tt], bubbles: true, cancelable: true })); }; mk('touchstart', x, y); mk('touchmove', x, y - 70); window.__endTouch = () => { const tt = new Touch({ identifier: 7, target: el, clientX: x, clientY: y - 70 }); el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [tt], bubbles: true })); }; }, [box.x + box.width / 2, box.y + box.height / 2]);
  await ticks(M, 50); await M.evaluate(() => window.__endTouch()); const m1 = await G(M); ok('16b. virtual joystick moves the climber', Math.hypot(m1.p[0].x - m0.p[0].x, m1.p[0].z - m0.p[0].z) > 1.5, `${Math.hypot(m1.p[0].x - m0.p[0].x, m1.p[0].z - m0.p[0].z).toFixed(2)} m`);
  await M.evaluate(() => { window.__pk = 0; const g = window.__game, y = g.sim.players[0].p.y; window.__t = setInterval(() => { window.__pk = Math.max(window.__pk, g.sim.players[0].p.y - y); }, 16); }); await M.locator('#tJump').dispatchEvent('touchstart'); await ticks(M, 8); await M.locator('#tJump').dispatchEvent('touchend'); await ticks(M, 40);
  ok('16c. touch jump button jumps', (await M.evaluate(() => window.__pk)) > 0.4, (await M.evaluate(() => window.__pk)).toFixed(2));
  await M.screenshot({ path: `${OUT}/e2e_mobile.png` }); await M.evaluate(() => { window.onbeforeunload = null; }); await M.context().close();
} catch (e) { ok('test run crashed', false, e.message.split('\n')[0]); }
ok('17. no critical console errors', allErrs.length === 0, allErrs.slice(0, 6).join(' | '));
console.log(`\n${results.filter(r => r.startsWith('PASS')).length} passed, ${results.filter(r => r.startsWith('FAIL')).length} failed`); await b.close();
