import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_PATH ?? 'playwright'); }
catch { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const fixtures = JSON.parse(readFileSync('docs/verification/skill-fixtures.json', 'utf8'));
const browser = await playwright.chromium.launch({ executablePath: process.env.SKILLLUDO_BROWSER ?? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], checks = [], output = 'docs/verification';
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.addInitScript(() => { const Native = WebSocket; window.WebSocket = class extends Native { constructor(_url, protocols) { super('ws://127.0.0.1:3101', protocols); } }; });
async function click(name, board = false) {
  const point = await page.evaluate(({ name, board }) => {
    const node = findNode(board ? testGame.boardController.root : testGame.gameUI.runtimeRoot, name);
    if (!node) throw new Error(`Missing active node ${name}`);
    const camera = testCC.director.getScene().getChildByName('Canvas').getComponent(testCC.Canvas).cameraComponent;
    const p = camera.worldToScreen(node.worldPosition), canvas = document.querySelector('canvas'), rect = canvas.getBoundingClientRect();
    return { x: rect.left + p.x * rect.width / canvas.width, y: rect.top + (canvas.height - p.y) * rect.height / canvas.height };
  }, { name, board });
  await page.mouse.click(point.x, point.y); await page.waitForTimeout(100);
}
async function load(snapshot, playerId = 'RED') {
  await page.evaluate(({ snapshot, playerId }) => {
    testGame.resetPresentation(); testGame.playerId = playerId; window.sent = [];
    if (snapshot.reaction) snapshot.reaction.expiresAt = Date.now() + 15000;
    testGame.applySnapshot(snapshot);
  }, { snapshot, playerId });
}
const label = (name) => page.evaluate((name) => findNode(testGame.gameUI.runtimeRoot, name)?.getComponent(testCC.Label)?.string, name);
try {
  await page.goto(process.env.SKILLLUDO_PREVIEW_URL ?? 'http://127.0.0.1:7459');
  let ready = false;
  const deadline = Date.now() + 60000;
  while (!ready && Date.now() < deadline) {
    ready = await page.evaluate(async () => {
      try { window.testCC = await System.import('cc'); window.testGame = testCC.director.getScene()?.getChildByName('Canvas')?.getChildByName('GameSystem')?.getComponent('GameController'); return !!testGame?.playerId; } catch { return false; }
    });
    if (!ready) await page.waitForTimeout(250);
  }
  assert.ok(ready);
  await page.evaluate(() => {
    window.findNode = (node, name) => node.activeInHierarchy && (node.name === name ? node : node.children.map((n) => findNode(n, name)).find(Boolean));
    testGame.network.disconnect(); testGame.resetPresentation(); testGame.send = (type, data) => window.sent.push({ type, data });
  });
  await page.waitForTimeout(150);
  const base = structuredClone(fixtures.find((f) => f.name === 'britain').snapshot);
  const spectators = [{ id: 'S1', nickname: '观战一号', connected: true, spectating: true }, { id: 'S2', nickname: '观战二号', connected: true, spectating: true }];
  const room = { ...base, roomStatus: 'WAITING', phase: null, spectators };
  await load(room, 'S1');
  assert.match(await label('RoomPlayers'), /观战一号/);
  assert.match(await label('PreferenceDropdownText'), /观战/);
  await click('PreferenceDropdownButton'); await page.screenshot({ path: `${output}/lifecycle-room-spectators.png` });
  await click('观战（最多 2 人）Button');
  assert.equal(await page.evaluate(() => sent[0].data.color), 'SPECTATOR');
  await page.evaluate(() => testGame.gameUI.appendChatEntry({ kind: 'PUBLIC', content: '观战席收到的消息会在左下停留三十秒', senderNickname: '飞行员甲', timestamp: Date.now() }));
  assert.ok(await page.evaluate(() => { const entries = testGame.gameUI.overlays.entries; return entries[entries.length - 1].expiresAt - Date.now() > 29000; }));
  await page.screenshot({ path: `${output}/lifecycle-room-toast.png` });
  await page.evaluate(() => { testGame.gameUI.overlays.entries.forEach((e) => e.expiresAt = 0); testGame.gameUI.overlays.update(); });
  assert.equal(await page.evaluate(() => testGame.gameUI.overlays.toasts.children.length), 0);
  checks.push('Six-member lobby and spectator dropdown; incoming room chat expires after its 30-second deadline');

  await load({ ...base, spectators }, 'S1');
  for (const name of ['ROLL_DICE', 'AI_TAKEOVER', 'TECH_PAUSE']) assert.equal(await page.evaluate((name) => findNode(testGame.gameUI.runtimeRoot, name).getComponent(testCC.Button).interactable, name), false);
  await click('red-1-hit', true); assert.equal(await page.evaluate(() => sent.length), 0);
  checks.push('Spectators see all planes but cannot roll, enable trustee mode, request pauses or commit moves');

  await load(base);
  await page.evaluate(() => {
    const s = structuredClone(testGame.snapshot); s.lifecycle = { activity: { playerId: 'RED', key: 'test', deadline: testGame.network.serverNow() + 9000 } }; testGame.applySnapshot(s);
    testGame.gameUI.appendChatEntry({ kind: 'SYSTEM', content: '英国「日不落帝国」触发条件已满足', timestamp: Date.now() });
    testGame.network.handleMessage(JSON.stringify({ type: 'SKILL_READY', serverTime: Date.now(), data: { playerId: 'RED', skillIds: ['uk-sun'] } }));
  });
  assert.match(await label('InactivityWarning'), /将会在[89]秒后进入托管/);
  const pulses = [];
  for (const elapsed of [0, 300, 600, 900, 1200, 1500, 1800]) pulses.push(await page.evaluate((elapsed) => {
    const hud = testGame.gameUI.matchHud; hud.flashStarted = Date.now() - elapsed; hud.update(); return hud.flashOn;
  }, elapsed));
  assert.deepEqual(pulses, [true, false, true, false, true, false, false]);
  await page.screenshot({ path: `${output}/lifecycle-afk-toast.png` });
  checks.push('Server SKILL_READY flashes the faction button exactly three times; red inactivity warning appears below board');

  const pauseVote = { id: 100, initiatorId: 'BLUE', voterIds: ['RED', 'BLUE'], votes: { BLUE: true }, required: 2, expiresAt: Date.now() + 30000 };
  await load({ ...base, lifecycle: { pauseVote } });
  await page.screenshot({ path: `${output}/lifecycle-pause-vote.png` });
  await click('VoteYes'); assert.equal(await page.evaluate(() => sent[0].type), 'VOTE_PAUSE');
  await load({ ...base, lifecycle: { pause: { startedAt: Date.now(), endsAt: Date.now() + 120000 } } });
  assert.match(await label('PauseCountdown'), /暂停剩余 2:00|暂停剩余 1:59/);
  await page.evaluate(() => { testGame.onClickDie(0); testGame.onClickPiece('red-1'); testGame.onClickRollDice(); });
  assert.equal(await page.evaluate(() => sent.length), 0);
  await page.screenshot({ path: `${output}/lifecycle-pause.png` });
  await click('PausedChat'); assert.ok(await page.evaluate(() => testGame.gameUI.chatModal?.activeInHierarchy));
  await page.evaluate(() => testGame.gameUI.closeChatDialog());
  checks.push('Right-bottom pause vote submits real pointer input; paused modal blocks play and allows chat');

  const winner = { ...base, spectators, phase: 'WINNER_VOTE', rankings: ['RED'], lifecycle: { continueVote: { id: 101, voterIds: ['RED', 'YELLOW', 'BLUE', 'GREEN', 'S1', 'S2'], votes: {}, required: 5, expiresAt: Date.now() + 30000 } } };
  await load(winner, 'S1'); assert.equal(await label('WinnerTitle'), '英国获胜！');
  await page.screenshot({ path: `${output}/lifecycle-winner.png` });
  await click('VoteYes'); assert.equal(await page.evaluate(() => sent[0].type), 'VOTE_CONTINUE');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
  await page.screenshot({ path: `${output}/lifecycle-winner-portrait.png` });
  await load({ ...winner, roomStatus: 'FINISHED', phase: 'GAME_OVER', rankings: ['RED', 'BLUE'], lifecycle: { continuationUsed: true } }, 'S1');
  assert.match(await label('FinalRanking'), /第二名 · 中国/); await click('DismissWinner');
  assert.equal(await page.evaluate(() => !!testGame.gameUI.overlays.modal), false);
  checks.push('Champion modal accepts spectator continuation votes; final result shows champion and second place, with portrait layout');
  await page.setViewportSize({ width: 1280, height: 800 }); await page.waitForTimeout(350);

  for (const name of ['binding', 'checkpoint']) {
    const f = fixtures.find((f) => f.name === name); assert.ok(f);
    await load(f.snapshot, f.playerId);
    if (name === 'binding') {
      await click('Lock-red-1'); await click('ConfirmLocks');
      assert.equal(await page.evaluate(() => sent[0].data.skillId), 'uk-bind');
      await page.evaluate(() => testGame.gameUI.closeSkills());
    }
    await page.evaluate(async (f) => { await testGame.boardController.playMove(f.move); testGame.applySnapshot(f.after); }, f);
    assert.equal(await page.evaluate(() => testGame.snapshot.pieces.find((p) => p.id === 'red-1').boundTo), name === 'binding' ? 'green-1' : undefined);
    const error = await page.evaluate(() => {
      const board = testGame.boardController, piece = testGame.snapshot.pieces.find((p) => p.id === 'red-1'), actor = board.actors.get('red-1'), anchor = board.piecePoint(piece);
      return Math.hypot(actor.model.position.x - anchor.x, actor.model.position.y - (anchor.y + (piece.boundTo ? 26 * .6 : 0)));
    });
    assert.ok(error < .01); await page.screenshot({ path: `${output}/lifecycle-${name}.png` });
  }
  checks.push('British bind response and wormhole carrier animation; checkpoint drop ends on authoritative calibrated centres');
  assert.deepEqual(errors, []);
  const result = { status: 'passed', kind: 'Cocos pointer interaction and authority-generated binding fixtures', checks, errors };
  writeFileSync(`${output}/lifecycle-result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: `${output}/failure-lifecycle.png` }); console.error(error, errors); process.exitCode = 1; }
finally { await browser.close(); }
