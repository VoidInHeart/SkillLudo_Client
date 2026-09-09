import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_PATH ?? 'playwright'); }
catch { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const browser = await playwright.chromium.launch({ executablePath: process.env.SKILLLUDO_BROWSER ?? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
const output = 'docs/verification'; mkdirSync(output, { recursive: true });
const url = process.argv.find((arg) => arg.startsWith('--url='))?.slice(6) ?? process.env.SKILLLUDO_PREVIEW_URL ?? 'http://localhost:7456';
async function openPlayer(name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript((endpoint) => {
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket { constructor(_url, protocols) { super(endpoint, protocols); } };
  }, process.env.SKILLLUDO_TEST_SERVER ?? 'ws://127.0.0.1:3101');
  const page = await context.newPage();
  const record = (error) => { const text = String(error); if (!errors.includes(text) && errors.length < 20) errors.push(text); };
  page.on('pageerror', record);
  page.on('console', (message) => { if (message.type() === 'error') record(message.text()); });
  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.waitForFunction(async () => {
    try {
      const cc = await System.import('cc');
      const controller = cc.director.getScene()?.getChildByName('Canvas')?.getChildByName('GameSystem')?.getComponent('GameController');
      if (!controller?.playerId) return false;
      return true;
    } catch { return false; }
  }, { timeout: 30000 });
  await page.evaluate(async (name) => {
    window.testCC = await System.import('cc');
    window.testGame = testCC.director.getScene().getChildByName('Canvas').getChildByName('GameSystem').getComponent('GameController');
    window.testPoint = (node) => {
      const canvasNode = testCC.director.getScene().getChildByName('Canvas');
      const camera = canvasNode.getComponent(testCC.Canvas).cameraComponent;
      const p = camera.worldToScreen(node.worldPosition);
      const canvas = document.querySelector('canvas'), rect = canvas.getBoundingClientRect();
      return { x: rect.left + p.x * rect.width / canvas.width, y: rect.top + (canvas.height - p.y) * rect.height / canvas.height };
    };
    window.testFind = (node, name) => node.name === name ? node : node.children.map((child) => testFind(child, name)).find(Boolean);
    if (typeof testGame.onClickDie !== 'function') throw new Error('Stale Creator preview scripts; use a fresh web-desktop build.');
    testGame.gameUI.setAccountProfile({ playerId: testGame.playerId, nickname: name }); testGame.gameUI.showHome();
  }, name);
  return page;
}
async function settled(page, phase) { await page.waitForFunction((phase) => testGame.snapshot?.phase === phase && !testGame.presentationBusy, phase, { timeout: 15000 }); }
async function clickAt(page, readPoint) { const p = await page.evaluate(readPoint); await page.mouse.click(p.x, p.y); }
try {
  const a = await openPlayer('飞行员甲');
  if (process.argv.includes('--viewport-only')) {
    const metrics = () => ({ window: [innerWidth, innerHeight], buffer: [document.querySelector('canvas').width, document.querySelector('canvas').height], visible: testCC.view.getVisibleSize(), screen: testCC.screen.windowSize, frame: document.querySelector('#GameDiv').getBoundingClientRect().toJSON(), container: document.querySelector('#Cocos3dGameContainer').getBoundingClientRect().toJSON(), policy: testCC.view.getResolutionPolicy()._id, hud: testGame.gameUI.matchHud.root.position });
    console.log('before', await a.evaluate(metrics));
    await a.setViewportSize({ width: 390, height: 844 }); await a.waitForTimeout(700);
    console.log('after', await a.evaluate(metrics));
    await browser.close(); process.exit(0);
  }
  await a.screenshot({ path: `${output}/home.png` });
  const b = await openPlayer('飞行员乙');
  await a.evaluate(() => testGame.onClickCreateRoom());
  await a.waitForFunction(() => testGame.snapshot?.roomStatus === 'WAITING');
  const roomId = await a.evaluate(() => testGame.snapshot.roomId);
  await b.evaluate((room) => testGame.onClickJoinRoom(room), roomId);
  await b.waitForFunction(() => testGame.snapshot?.players.length === 2);
  await a.evaluate(() => testGame.gameUI.node.emit('color-preference', 'GREEN'));
  await b.evaluate(() => testGame.gameUI.node.emit('color-preference', 'BLUE'));
  await a.waitForFunction(() => testGame.snapshot.players[1].preferredColor === 'BLUE');
  await a.screenshot({ path: `${output}/room-preferences.png` });
  await a.evaluate(() => testGame.onClickReady()); await b.evaluate(() => testGame.onClickReady());
  await a.waitForFunction(() => testGame.snapshot.players.every((p) => p.ready));
  await a.evaluate(() => testGame.onClickStartGame());
  await settled(a, 'WAIT_ROLL'); await settled(b, 'WAIT_ROLL');
  await a.screenshot({ path: `${output}/game-green.png` });
  await b.screenshot({ path: `${output}/game-blue.png` });
  await a.evaluate(() => testGame.onClickRollDice(6));
  await a.waitForFunction(() => testGame.boardController.dice.actors[0].model.active);
  await a.waitForTimeout(330); await a.screenshot({ path: `${output}/dice-airborne.png` });
  await settled(a, 'WAIT_SELECT_DIE');
  await a.screenshot({ path: `${output}/dice-choice.png` });
  const beforeReconnect = await a.evaluate(() => ({ rollId: testGame.snapshot.rollId, pair: testGame.snapshot.diceChoices }));
  await a.evaluate(async () => { await testGame.network.connect(testGame.serverUrl); });
  await a.waitForTimeout(400);
  await settled(a, 'WAIT_SELECT_DIE');
  assert.deepEqual(await a.evaluate(() => ({ rollId: testGame.snapshot.rollId, pair: testGame.snapshot.diceChoices })), beforeReconnect);
  assert.equal(await a.evaluate(() => testGame.boardController.dice.actors.every((actor) => actor.model.active)), true);
  // Select the physical die and plane through the actual Canvas hit regions.
  await clickAt(a, () => testPoint(testGame.boardController.dice.actors[0].hit));
  await settled(a, 'WAIT_SELECT_PIECE');
  await clickAt(a, () => testPoint(testGame.boardController.actors.get(testGame.snapshot.movablePieceIds[0]).hit));
  await a.waitForFunction(() => testGame.gameUI.moveConfirmModal?.isValid);
  await a.screenshot({ path: `${output}/move-confirmation.png` });
  await clickAt(a, () => testPoint(testFind(testGame.gameUI.moveConfirmModal, '确认移动Button')));
  await settled(a, 'WAIT_ROLL');
  await a.screenshot({ path: `${output}/after-takeoff.png` });
  const state = await a.evaluate(() => ({ pieces: testGame.snapshot.pieces, render: { actors: testGame.boardController.actors.size, meshVertices: testGame.boardController.scene3D.meshes.die().struct.vertexBundles[0].view.count }, phase: testGame.snapshot.phase, room: testGame.snapshot.roomId }));
  // The following are explicitly local presentation fixtures, not network turns.
  const fixtures = JSON.parse(readFileSync(`${output}/motion-fixtures.json`, 'utf8'));
  for (const fixture of fixtures) {
    await a.evaluate((fixture) => {
      const board = testGame.boardController;
      board.cancelAnimations(); board.setLocalColor('GREEN');
      board.applySnapshot({ ...testGame.snapshot, pieces: fixture.pieces, diceChoices: null, movablePieceIds: [], movePreviews: {} });
      window.motionDone = false;
      board.playMove(fixture.result).then(() => { window.motionDone = true; });
    }, fixture);
    await a.waitForTimeout(fixture.name === 'wormhole' ? 1040 : fixture.name === 'capture' ? 400 : 330);
    await a.screenshot({ path: `${output}/${fixture.name}-motion.png` });
    await a.waitForFunction(() => motionDone, null, { timeout: 10000 });
    const footprint = await a.evaluate((fixture) => {
      const board = testGame.boardController, actor = board.actors.get('GREEN-1');
      const expected = board.piecePoint({ ...fixture.pieces[0], progress: fixture.result.toProgress, state: fixture.result.reachedFinish ? 'FINISHED' : 'MAIN_PATH' });
      return Math.hypot(actor.model.position.x - expected.x, actor.model.position.y - expected.y);
    }, fixture);
    assert.ok(footprint < 0.01, `${fixture.name} must land exactly on its anchor: ${footprint}`);
  }
  await a.evaluate(() => { testGame.boardController.applySnapshot(testGame.snapshot); testGame.boardController.setLocalColor('BLUE'); testGame.boardController.applySnapshot(testGame.snapshot); });
  const calibration = { key: 'blue-airport-1', index: 1, total: 96, single: true, position: { x: 240, y: 230 } };
  await a.evaluate((target) => {
    testGame.boardController.node.off('calibration-save');
    testGame.boardController.node.on('calibration-save', (data) => { window.savedCalibration = data; });
    testGame.boardController.startCalibration(target);
  }, calibration);
  const start = await a.evaluate(() => testPoint(testGame.boardController.calibration.marker));
  await a.mouse.move(start.x, start.y); await a.mouse.down(); await a.mouse.move(start.x + 20, start.y - 15, { steps: 6 }); await a.mouse.up();
  const canonical = await a.evaluate(() => testGame.boardController.fromView(testGame.boardController.calibration.marker.position));
  await a.screenshot({ path: `${output}/calibration-rotated.png` });
  await clickAt(a, () => testPoint(testGame.boardController.calibration.panel.getChildByName('确认')));
  await a.waitForFunction(() => window.savedCalibration);
  const saved = await a.evaluate(() => savedCalibration);
  assert.ok(Math.abs(saved.x - canonical.x) < 0.01 && Math.abs(saved.y - canonical.y) < 0.01);
  assert.ok(Math.abs(saved.x - 240) > 1, 'Drag must change canonical position');
  await a.evaluate(() => { testGame.boardController.stopCalibration(); testGame.boardController.setLocalColor('GREEN'); testGame.boardController.applySnapshot(testGame.snapshot); });
  await a.setViewportSize({ width: 390, height: 844 });
  await a.waitForTimeout(500); await a.screenshot({ path: `${output}/game-portrait.png` });
  const portrait = await a.evaluate(() => ({ size: testCC.view.getVisibleSize(), scaleX: testCC.view.getScaleX(), scaleY: testCC.view.getScaleY(), hudX: testGame.gameUI.matchHud.root.position.x }));
  assert.ok(portrait.size.height > portrait.size.width && Math.abs(portrait.scaleX - portrait.scaleY) < 0.01 && portrait.hudX === 0, 'Portrait must reflow without stretching');
  writeFileSync(`${output}/preview-result.json`, JSON.stringify({ errors, checks: ['real socket color preferences', 'two local perspectives', 'physical die and plane pointer input', 'move confirmation pointer input', 'pending dice reconnect', 'four authority-calculated motion fixtures', 'exact motion endpoints', 'rotated manual calibration drag and inverse', 'portrait resize'], state }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ status: 'passed', screenshots: 14, ...state.render }));
} catch (error) {
  for (const [i, context] of browser.contexts().entries()) for (const page of context.pages()) {
    await page.screenshot({ path: `${output}/failure-${i}.png` });
    console.log('Boot diagnostics', await page.evaluate(async () => ({ url: location.href, scene: typeof System === 'undefined' ? null : (await System.import('cc')).director.getScene()?.name, canvas: !!document.querySelector('canvas'), errors: document.querySelector('#error')?.textContent })).catch(String));
  }
  writeFileSync(`${output}/preview-errors.json`, JSON.stringify({ error: String(error), browserErrors: errors }, null, 2));
  console.error(error, errors);
  process.exitCode = 1;
} finally { await browser.close(); }
