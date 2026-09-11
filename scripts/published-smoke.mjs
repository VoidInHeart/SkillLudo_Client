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
  await a.screenshot({ path: `${output}/published-login.png` });
  const b = await openPlayer();
  // The normal connection obtains a real guest identity; use it for a disposable room.
  await a.evaluate(() => testGame.onClickCreateRoom());
  await a.waitForFunction(() => testGame.snapshot?.roomStatus === 'WAITING');
  const roomId = await a.evaluate(() => testGame.snapshot.roomId);
  await b.evaluate((roomId) => testGame.onClickJoinRoom(roomId), roomId);
  await b.waitForFunction(() => testGame.snapshot?.players.length === 2);
  await a.evaluate(() => testGame.gameUI.node.emit('color-preference', 'GREEN'));
  await b.evaluate(() => testGame.gameUI.node.emit('color-preference', 'BLUE'));
  await a.waitForFunction(() => testGame.snapshot.players.some((player) => player.preferredColor === 'BLUE'));
  await a.evaluate(() => testGame.onClickReady());
  await b.evaluate(() => testGame.onClickReady());
  await a.waitForFunction(() => testGame.snapshot.players.every((player) => player.ready));
  await a.evaluate(() => testGame.onClickStartGame());
  await a.waitForFunction(() => testGame.snapshot?.phase === 'WAIT_ROLL' && !testGame.presentationBusy);
  const active = await a.evaluate(() => testGame.snapshot.currentPlayerId === testGame.playerId) ? a : b;
  await active.evaluate(() => testGame.onClickRollDice());
  await active.waitForFunction(() => testGame.snapshot.phase === 'WAIT_SELECT_DIE' && !testGame.presentationBusy, null, { timeout: 20000 });
  assert.equal(await active.evaluate(() => testGame.snapshot.diceChoices.length), 2);
  await active.screenshot({ path: `${output}/published-game.png` });
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
  const result = { status: 'passed', checkedAt: new Date().toISOString(), url, sockets, errors, checks: ['real public page assets', 'unmodified automatic socket URL', 'real guest authentication', 'two-player room and colour preferences', 'start game', '3D dual dice and selection'] };
  writeFileSync(`${output}/published-result.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error, { errors, sockets, socketEvents });
  for (const [index, page] of pages.entries()) await page.screenshot({ path: `${output}/failure-published-${index}.png` }).catch(() => {});
  process.exitCode = 1;
} finally {
  for (const page of pages) await page.evaluate(() => { testGame.onClickLeaveRoom(); testGame.network.disconnect(); }).catch(() => {});
  await browser.close();
}
