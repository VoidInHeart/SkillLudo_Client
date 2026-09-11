import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_PATH ?? 'playwright'); }
catch { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const url = process.env.SKILLLUDO_WEB_URL ?? 'http://127.0.0.1:7459';
const output = process.env.SKILLLUDO_VERIFY_OUTPUT ?? 'docs/verification';
mkdirSync(output, { recursive: true });
const publicPage = !['127.0.0.1', 'localhost'].includes(new URL(url).hostname);
const prefix = publicPage ? 'published-viewport' : 'viewport';
const fixtures = JSON.parse(readFileSync('docs/verification/skill-fixtures.json', 'utf8'));
const browser = await playwright.chromium.launch({ executablePath: process.env.SKILLLUDO_BROWSER ?? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], results = [];
const cases = [
  { name: 'desktop', width: 1280, height: 800, dpr: 1 },
  { name: 'desktop-hidpi', width: 1280, height: 800, dpr: 2 },
  { name: 'desktop-fractional', width: 1536, height: 864, dpr: 1.25 },
  { name: 'wechat-portrait', width: 412, height: 820, dpr: 3, mobile: true },
  { name: 'wechat-landscape', width: 820, height: 412, dpr: 3, mobile: true },
  { name: 'small-phone', width: 320, height: 568, dpr: 2, mobile: true },
  { name: 'tablet', width: 1024, height: 768, dpr: 2, mobile: true },
];
async function tap(page, name, mobile) {
  const bounds = await page.evaluate((name) => viewportBounds(name), name);
  assert.ok(bounds, `Missing active control ${name}`);
  const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
  if (mobile) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await page.waitForTimeout(120);
}
async function fits(page, names) {
  const metrics = await page.evaluate((names) => {
    const canvas = document.querySelector('canvas');
    return { window: [innerWidth, innerHeight], dpr: devicePixelRatio, buffer: [canvas.width, canvas.height], rect: canvas.getBoundingClientRect().toJSON(), visible: testCC.view.getVisibleSize(), lobby: testGame.gameUI.lobbySize, bounds: Object.fromEntries(names.map((name) => [name, viewportBounds(name)])) };
  }, names);
  const [width, height] = metrics.window;
  assert.ok(Math.abs(metrics.rect.width - width) < 2 && Math.abs(metrics.rect.height - height) < 2, `Canvas must fit CSS viewport at DPR ${metrics.dpr}: ${JSON.stringify(metrics)}`);
  assert.ok(Math.abs(metrics.rect.x) < 2 && Math.abs(metrics.rect.y) < 2, 'Canvas origin must be visible');
  assert.ok(Math.abs(metrics.lobby.width - metrics.visible.width) < 0.1 && Math.abs(metrics.lobby.height - metrics.visible.height) < 0.1, 'Lobby must use the settled design size');
  for (const [name, b] of Object.entries(metrics.bounds)) {
    assert.ok(b && b.left >= -2 && b.top >= -2 && b.right <= width + 2 && b.bottom <= height + 2, `${name} cropped: ${JSON.stringify(b)} in ${width}x${height}`);
  }
  return metrics;
}
try {
  for (const scenario of cases) {
    const { name, width, height, dpr, mobile = false } = scenario;
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile,
      ...(name.startsWith('wechat') ? { userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.62' } : {}) });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${name}: ${error}`));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`${name}: ${message.text()}`); });
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    let ready = false;
    for (const deadline = Date.now() + 60000; !ready && Date.now() < deadline;) {
      ready = await page.evaluate(async () => {
        try { window.testCC = await System.import('cc'); window.testGame = testCC.director.getScene()?.getChildByName('Canvas')?.getChildByName('GameSystem')?.getComponent('GameController'); return !!testGame?.playerId; } catch { return false; }
      });
      if (!ready) await page.waitForTimeout(250);
    }
    assert.ok(ready, `${name}: Cocos and guest authentication loaded`);
    await page.evaluate(() => {
      // Test presentation fixtures after a normal load; never submit test accounts or games.
      testGame.network.disconnect(); window.viewportCommands = [];
      testGame.send = (type, data) => viewportCommands.push({ type, data });
      window.viewportFind = (node, name) => node.activeInHierarchy && (node.name === name ? node : node.children.map((n) => viewportFind(n, name)).find(Boolean));
      window.viewportBounds = (name) => {
        const root = testCC.director.getScene().getChildByName('Canvas'), node = viewportFind(root, name);
        if (!node) return null;
        const ui = node.getComponent(testCC.UITransform), camera = root.getComponent(testCC.Canvas).cameraComponent;
        const canvas = document.querySelector('canvas'), rect = canvas.getBoundingClientRect();
        const corners = [[0, 0], [ui.width, 0], [0, ui.height], [ui.width, ui.height]].map(([x, y]) => {
          const world = ui.convertToWorldSpaceAR(new testCC.Vec3(x - ui.anchorX * ui.width, y - ui.anchorY * ui.height));
          const p = camera.worldToScreen(world);
          return { x: rect.left + p.x * rect.width / canvas.width, y: rect.top + (canvas.height - p.y) * rect.height / canvas.height };
        });
        return { left: Math.min(...corners.map((p) => p.x)), right: Math.max(...corners.map((p) => p.x)), top: Math.min(...corners.map((p) => p.y)), bottom: Math.max(...corners.map((p) => p.y)) };
      };
    });
    await page.waitForTimeout(200);
    const initial = await fits(page, ['AccountPageCard', 'AuthBrand', 'LoginUsername', 'LoginPassword', '登录账号Button', '技能图鉴Button']);
    await page.screenshot({ path: `${output}/${prefix}-${name}-login.png` });
    await tap(page, 'AuthTabREGISTER', mobile);
    assert.equal(await page.evaluate(() => testGame.gameUI.authMode), 'REGISTER');
    await fits(page, ['RegisterUsername', 'RegisterPassword', 'RegisterNickname', '创建账号Button']);
    await tap(page, 'RegisterUsername', mobile);
    const input = page.locator('input.cocosEditBox:visible');
    await input.waitFor({ state: 'visible' });
    await input.fill('viewport_probe');
    const inputId = await page.evaluate(() => testGame.gameUI.authFormRoot.getChildByName('RegisterUsername').uuid);
    await input.press('Tab');
    await page.setViewportSize({ width: height, height: width });
    await page.waitForTimeout(650);
    await fits(page, ['AccountPageCard', 'RegisterUsername', 'RegisterPassword', 'RegisterNickname', '创建账号Button', '技能图鉴Button']);
    assert.equal(await page.evaluate(() => testGame.gameUI.authFormRoot.getChildByName('RegisterUsername').getComponent(testCC.EditBox).string), 'viewport_probe', 'Rotation must preserve typed input');
    assert.equal(await page.evaluate(() => testGame.gameUI.authFormRoot.getChildByName('RegisterUsername').uuid), inputId, 'Rotation must preserve the live EditBox instance');
    await tap(page, 'AuthTabLOGIN', mobile);
    assert.equal(await page.evaluate(() => testGame.gameUI.authMode), 'LOGIN');
    await page.setViewportSize({ width, height }); await page.waitForTimeout(500);
    await page.evaluate(() => testGame.gameUI.showHome());
    await fits(page, ['NationalLudoTitle', 'CREATE_ROOMButton', 'JOIN_ROOMButton', '技能图鉴Button']);
    await tap(page, 'CREATE_ROOMButton', mobile);
    assert.equal(await page.evaluate(() => viewportCommands.at(-1)?.type), 'CREATE_ROOM', 'Pointer coordinates must hit the actual Cocos control');
    const snapshot = structuredClone(fixtures.find((f) => f.name === 'britain').snapshot);
    await page.evaluate((snapshot) => {
      snapshot.roomStatus = 'WAITING'; snapshot.phase = null;
      testGame.gameUI.render(snapshot, snapshot.players[0].id);
    }, snapshot);
    await fits(page, ['RoomTitle', 'RoomPlayers', 'PreferenceDropdownButton', 'READYButton', 'START_GAMEButton', 'CHATButton', 'LEAVE_ROOMButton']);
    await page.setViewportSize({ width: height, height: width }); await page.waitForTimeout(500);
    await fits(page, ['RoomTitle', 'RoomPlayers', 'PreferenceDropdownButton', 'READYButton', 'START_GAMEButton', 'CHATButton', 'LEAVE_ROOMButton']);
    assert.match(await page.evaluate(() => testGame.gameUI.roomTitleLabel.string), /房间/);
    await tap(page, 'PreferenceDropdownButton', mobile);
    assert.equal(await page.evaluate(() => !!testGame.gameUI.preferenceMenu?.isValid), true);
    await tap(page, '不限Button', mobile);
    await page.setViewportSize({ width, height }); await page.waitForTimeout(500);
    await page.evaluate((snapshot) => { testGame.playerId = snapshot.players[0].id; testGame.applySnapshot(snapshot); }, snapshot);
    await page.waitForTimeout(200);
    await fits(page, ['LudoRuntimeBoard', 'ROLL_DICE', 'TECH_PAUSE']);
    await page.screenshot({ path: `${output}/${prefix}-${name}-game.png` });
    await tap(page, 'Die-0-hit', mobile);
    const option = await page.evaluate(() => testGame.selection.current(testGame.snapshot, testGame.playerId));
    assert.equal(option?.dieIndex, 0, 'Physical die must accept the correct pointer coordinates');
    assert.ok(option.movablePieceIds.length > 0);
    await tap(page, `${option.movablePieceIds[0]}-hit`, mobile);
    assert.equal(await page.evaluate(() => viewportCommands.at(-1)?.type), 'COMMIT_MOVE', 'Physical plane tap must commit the chosen move');
    results.push({ ...scenario, status: 'passed', initial });
    console.log(`${name}: initial layout, DPR, input, rotation, lobby and physical dice/plane hit targets passed`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  const result = { status: 'passed', checkedAt: new Date().toISOString(), url, errors, cases: results, validation: 'Browser emulation with real canvas pointer input and isolated game snapshots; not a physical WeChat device test.' };
  writeFileSync(`${output}/${prefix}-result.json`, JSON.stringify(result, null, 2) + '\n');
} finally { await browser.close(); }
