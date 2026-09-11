import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_PATH ?? 'playwright'); }
catch { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const url = process.env.SKILLLUDO_WEB_URL ?? 'http://81.70.145.148';
const endpoint = process.env.SKILLLUDO_EXPECTED_SOCKET ?? url.replace(/^http/, 'ws').replace(/\/$/, '');
const output = process.env.SKILLLUDO_VERIFY_OUTPUT ?? 'docs/verification';
const artifactPrefix = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) ? 'local-preview' : 'published';
mkdirSync(output, { recursive: true });
const browser = await playwright.chromium.launch({ executablePath: process.env.SKILLLUDO_BROWSER ?? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const sockets = [];
const socketEvents = [];
const pages = [];
async function openPlayer() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  pages.push(page);
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  // Observe the actual application socket; there is no URL replacement or auth stub.
  page.on('websocket', (socket) => {
    sockets.push(socket.url().replace(/\/$/, ''));
    socketEvents.push({ event: 'created', at: Date.now() });
    socket.on('socketerror', (error) => socketEvents.push({ event: 'error', error, at: Date.now() }));
    socket.on('close', () => socketEvents.push({ event: 'close', at: Date.now() }));
  });
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  // Await imports explicitly: a Promise itself must not satisfy the polling predicate.
  let ready = false;
  const deadline = Date.now() + 60000;
  while (!ready && Date.now() < deadline) {
    ready = await page.evaluate(async () => {
      try {
        const cc = await System.import('cc');
        const game = cc.director.getScene()?.getChildByName('Canvas')?.getChildByName('GameSystem')?.getComponent('GameController');
        if (!game?.playerId) return false;
        window.testGame = game;
        return true;
      } catch { return false; }
    });
    if (!ready) await page.waitForTimeout(250);
  }
  assert.ok(ready, 'Cocos scene and real guest authentication must finish loading');
  assert.equal(await page.evaluate(() => testGame.serverUrl), endpoint);
  return page;
}
try {
  const a = await openPlayer();
  await a.screenshot({ path: `${output}/${artifactPrefix}-login.png` });
  const b = await openPlayer();
  const observer = process.argv.includes('--lifecycle') ? await openPlayer() : null;
  // The normal connection obtains a real guest identity; use it for a disposable room.
  await a.evaluate(() => testGame.onClickCreateRoom());
  await a.waitForFunction(() => testGame.snapshot?.roomStatus === 'WAITING');
  const roomId = await a.evaluate(() => testGame.snapshot.roomId);
  await b.evaluate((roomId) => testGame.onClickJoinRoom(roomId), roomId);
  await b.waitForFunction(() => testGame.snapshot?.players.length === 2);
  if (observer) {
    await observer.evaluate((roomId) => testGame.onClickJoinRoom(roomId), roomId);
    await observer.waitForFunction(() => testGame.snapshot?.roomStatus === 'WAITING');
    await observer.evaluate(() => testGame.gameUI.node.emit('color-preference', 'SPECTATOR'));
    await a.waitForFunction(() => testGame.snapshot.spectators?.length === 1 && testGame.snapshot.players.length === 2);
  }
  await a.evaluate(() => testGame.gameUI.node.emit('color-preference', 'GREEN'));
  await b.evaluate(() => testGame.gameUI.node.emit('color-preference', 'BLUE'));
  await a.waitForFunction(() => testGame.snapshot.players.some((player) => player.preferredColor === 'BLUE'));
  await a.evaluate(() => testGame.onClickReady());
  await b.evaluate(() => testGame.onClickReady());
  await a.waitForFunction(() => testGame.snapshot.players.every((player) => player.ready));
  await a.evaluate(() => testGame.onClickStartGame());
  await a.waitForFunction(() => testGame.snapshot?.phase === 'WAIT_ROLL' && !testGame.presentationBusy);
  assert.equal(await a.evaluate(() => testGame.snapshot.protocolVersion), 4);
  if (observer) {
    await observer.waitForFunction(() => testGame.snapshot?.phase === 'WAIT_ROLL');
    assert.equal(await observer.evaluate(() => testGame.snapshot.players.some((p) => p.id === testGame.playerId)), false);
    await observer.evaluate(() => testGame.gameUI.node.emit('chat-send', { content: '公网观战重连验收' }));
    await a.evaluate(() => testGame.gameUI.node.emit('ui-action', 'TECH_PAUSE'));
    await b.waitForFunction(() => !!testGame.snapshot?.lifecycle?.pauseVote);
    await b.evaluate(() => testGame.gameUI.node.emit('lifecycle-input', { type: 'VOTE_PAUSE', voteId: testGame.snapshot.lifecycle.pauseVote.id, agree: true }));
    await a.waitForFunction(() => !!testGame.snapshot?.lifecycle?.pause);
    const frozen = await a.evaluate(() => ({ pieces: testGame.snapshot.pieces, pause: testGame.snapshot.lifecycle.pause, playerId: testGame.playerId }));
    await a.reload();
    let restored = false; const reloadDeadline = Date.now() + 60000;
    while (!restored && Date.now() < reloadDeadline) {
      restored = await a.evaluate(async () => {
        try {
          const cc = await System.import('cc');
          const game = cc.director.getScene()?.getChildByName('Canvas')?.getChildByName('GameSystem')?.getComponent('GameController');
          if (!game?.snapshot?.lifecycle?.pause) return false;
          window.testGame = game; return true;
        } catch { return false; }
      });
      if (!restored) await a.waitForTimeout(250);
    }
    assert.ok(restored, 'page reload restores the paused game automatically');
    assert.deepEqual(await a.evaluate(() => ({ pieces: testGame.snapshot.pieces, pause: testGame.snapshot.lifecycle.pause, playerId: testGame.playerId })), frozen);
    await a.screenshot({ path: `${output}/${artifactPrefix}-pause-reconnect.png` });
    console.log('Public pause survives page reload; waiting for its real 120-second deadline.');
    await a.waitForFunction(() => !testGame.snapshot?.lifecycle?.pause, null, { timeout: 125000 });
    assert.deepEqual(await a.evaluate(() => testGame.snapshot.pieces), frozen.pieces);
    assert.equal(await a.evaluate(() => testGame.snapshot.players.find((p) => p.id === testGame.playerId).aiControlled), false);
  }
  const active = await a.evaluate(() => testGame.snapshot.currentPlayerId === testGame.playerId) ? a : b;
  await active.evaluate(() => testGame.onClickRollDice());
  await active.waitForFunction(() => testGame.snapshot.phase === 'WAIT_SELECT_DIE' && !testGame.presentationBusy, null, { timeout: 20000 });
  assert.equal(await active.evaluate(() => testGame.snapshot.diceChoices.length), 2);
  await active.screenshot({ path: `${output}/${artifactPrefix}-game.png` });
  await active.evaluate(() => testGame.onClickDie(0));
  assert.equal(await active.evaluate(() => testGame.snapshot.phase), 'WAIT_SELECT_DIE');
  await active.evaluate(() => {
    const option = testGame.selection.current(testGame.snapshot, testGame.playerId);
    if (option.movablePieceIds.length) testGame.onClickPiece(option.movablePieceIds[0]);
    else testGame.gameUI.node.emit('ui-action', 'ROLL_DICE');
  });
  await active.waitForFunction(() => testGame.snapshot.phase !== 'WAIT_SELECT_DIE' && !testGame.presentationBusy);
  assert.ok(sockets.length >= 2);
  assert.ok(sockets.every((socket) => socket === endpoint), JSON.stringify(sockets));
  assert.deepEqual(errors, []);
  const result = { status: 'passed', checkedAt: new Date().toISOString(), url, sockets, errors, checks: [artifactPrefix === 'published' ? 'real public page assets' : 'real local preview assets', 'unmodified automatic socket URL', 'protocol 4', 'real guest authentication', 'two-player room and colour preferences', 'start game', '3D dual dice and atomic selection', ...(observer ? ['real spectator joins and chats', 'unanimous human pause excludes spectator', 'page reload restores same identity and frozen position', 'real 120-second pause resumes without trustee takeover'] : [])] };
  writeFileSync(`${output}/${artifactPrefix}${observer ? '-lifecycle' : ''}-result.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error, { errors, sockets, socketEvents });
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `${output}/failure-published-${index}.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  for (const page of pages) await page.evaluate(() => { testGame.onClickLeaveRoom(); testGame.network.disconnect(); }).catch(() => {});
  await browser.close();
}
