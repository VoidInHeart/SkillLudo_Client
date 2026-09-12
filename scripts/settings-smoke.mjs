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
const prefix = ['127.0.0.1', 'localhost'].includes(new URL(url).hostname) ? 'settings' : 'published-settings';
mkdirSync(output, { recursive: true });
const fixtures = JSON.parse(readFileSync('docs/verification/skill-fixtures.json', 'utf8'));
const browser = await playwright.chromium.launch({ executablePath: process.env.SKILLLUDO_BROWSER ?? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], checks = [];
async function initialize(page) {
  let ready = false;
  for (const deadline = Date.now() + 60000; !ready && Date.now() < deadline;) {
    ready = await page.evaluate(async () => {
      try { window.testCC = await System.import('cc'); window.testGame = testCC.director.getScene()?.getChildByName('Canvas')?.getChildByName('GameSystem')?.getComponent('GameController'); return !!testGame?.playerId; } catch { return false; }
    });
    if (!ready) await page.waitForTimeout(250);
  }
  assert.ok(ready);
  await page.evaluate(() => {
    testGame.network.disconnect(); testGame.send = () => {};
    window.findNode = (node, name) => node.activeInHierarchy && (node.name === name ? node : node.children.map((n) => findNode(n, name)).find(Boolean));
    window.bounds = (name) => {
      const canvasNode = testCC.director.getScene().getChildByName('Canvas'), node = findNode(canvasNode, name);
      if (!node) throw new Error(`Missing ${name}`);
      const ui = node.getComponent(testCC.UITransform), camera = canvasNode.getComponent(testCC.Canvas).cameraComponent;
      const canvas = document.querySelector('canvas'), rect = canvas.getBoundingClientRect();
      const points = [[0, 0], [ui.width, 0], [0, ui.height], [ui.width, ui.height]].map(([x, y]) => {
        const p = camera.worldToScreen(ui.convertToWorldSpaceAR(new testCC.Vec3(x - ui.width * ui.anchorX, y - ui.height * ui.anchorY)));
        return { x: rect.left + p.x * rect.width / canvas.width, y: rect.top + (canvas.height - p.y) * rect.height / canvas.height };
      });
      return { left: Math.min(...points.map((p) => p.x)), right: Math.max(...points.map((p) => p.x)), top: Math.min(...points.map((p) => p.y)), bottom: Math.max(...points.map((p) => p.y)) };
    };
  });
  await page.waitForTimeout(200);
}
async function click(page, name, mobile) {
  const b = await page.evaluate((name) => bounds(name), name), x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2;
  if (mobile) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
  await page.waitForTimeout(120);
}
async function checkSettings(page, mobile) {
  await click(page, 'SettingsGear', mobile);
  assert.equal(await page.evaluate(() => !!testGame.gameUI.settings.modal), true);
  const b = await page.evaluate(() => bounds('SettingsCard'));
  const viewport = page.viewportSize();
  assert.ok(b.left >= 0 && b.top >= 0 && b.right <= viewport.width && b.bottom <= viewport.height);
  await click(page, 'CloseSettings', mobile);
}
async function load(page, snapshot) {
  await page.evaluate((snapshot) => { testGame.playerId = snapshot.players[0].id; testGame.applySnapshot(snapshot); }, snapshot);
  await page.waitForTimeout(150);
}
async function append(page, content) {
  await page.evaluate((content) => testGame.gameUI.appendChatEntry({ kind: 'PUBLIC', senderNickname: '飞行员', content, timestamp: Date.now() }), content);
}
try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'phone' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 412, height: 820 } : { width: 1280, height: 800 }, deviceScaleFactor: mobile ? 3 : 2, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    await page.goto(url, { timeout: 90000 }); await initialize(page);
    assert.equal(await page.evaluate(() => testGame.gameUI.settings.chatToastsEnabled), true);
    await checkSettings(page, mobile);
    await page.evaluate(() => { testGame.gameUI.setAccountProfile({ playerId: testGame.playerId, nickname: '飞行员' }); testGame.gameUI.showHome(); });
    const boxes = await page.evaluate(() => ['技能图鉴Button', 'CREATE_ROOMButton', 'JOIN_ROOMButton', 'AccountAvatar'].map(bounds));
    assert.ok(boxes[0].top > Math.max(boxes[1].bottom, boxes[2].bottom), 'Encyclopedia must be below both room buttons');
    assert.ok(boxes[0].top >= boxes[3].bottom || boxes[0].right <= boxes[3].left, 'Encyclopedia must not cover profile');
    await page.screenshot({ path: `${output}/${prefix}-${name}-home.png` });
    await click(page, 'AccountAvatar', mobile);
    assert.equal(await page.evaluate(() => !!testGame.gameUI.accountDrawer), true);
    await checkSettings(page, mobile);
    await page.evaluate(() => testGame.gameUI.closeAccountDrawer());
    await click(page, '技能图鉴Button', mobile);
    assert.equal(await page.evaluate(() => testGame.gameUI.skills.mode), 'book');
    await checkSettings(page, mobile); await page.evaluate(() => testGame.gameUI.closeSkills());
    const game = structuredClone(fixtures.find((f) => f.name === 'britain').snapshot);
    await load(page, { ...game, roomStatus: 'WAITING', phase: null });
    await append(page, '房间消息仍可查看'); await checkSettings(page, mobile);
    await load(page, game);
    for (const content of ['新的战术消息', '飞机已经准备起飞', '这条浮窗更小更通透', '保留最新三条']) await append(page, content);
    const toast = await page.evaluate(() => {
      const nodes = testGame.gameUI.overlays.toasts.children, card = nodes[0], ui = card.getComponent(testCC.UITransform), g = card.getComponent(testCC.Graphics);
      return { count: nodes.length, width: ui.width, height: ui.height, color: { r: g.fillColor.r, a: g.fillColor.a } };
    });
    assert.equal(toast.count, 3); assert.equal(toast.width, 270); assert.equal(toast.height, 46);
    assert.ok(toast.color.a > 0 && toast.color.a < 180 && toast.color.r > 200);
    await page.screenshot({ path: `${output}/${prefix}-${name}-toasts.png` });
    await click(page, 'SettingsGear', mobile);
    if (mobile) await click(page, 'ChatToastsToggle', mobile);
    else {
      const b = await page.evaluate(() => bounds('ChatToastsToggle')), y = (b.top + b.bottom) / 2;
      await page.mouse.move(b.right - 16, y); await page.mouse.down(); await page.mouse.move(b.left + 16, y, { steps: 8 }); await page.mouse.up();
    }
    assert.equal(await page.evaluate(() => testGame.gameUI.settings.chatToastsEnabled), false);
    assert.equal(await page.evaluate(() => testGame.gameUI.overlays.toasts.children.length), 0, 'Disabling removes visible messages immediately');
    await page.screenshot({ path: `${output}/${prefix}-${name}-off.png` });
    await click(page, 'CloseSettings', mobile);
    await append(page, '关闭浮窗后仍保存聊天记录');
    assert.equal(await page.evaluate(() => testGame.gameUI.overlays.toasts.children.length), 0);
    await page.evaluate(() => testGame.gameUI.showChatDialog(testGame.snapshot, testGame.playerId));
    assert.equal(await page.evaluate(() => testGame.gameUI.chatLinesRoot.getComponentsInChildren(testCC.Label).some((label) => label.string.includes('关闭浮窗后仍保存聊天记录'))), true);
    await checkSettings(page, mobile); await page.evaluate(() => testGame.gameUI.closeChatDialog());
    await click(page, 'SettingsGear', mobile); await click(page, 'ChatToastsToggle', mobile); await click(page, 'CloseSettings', mobile);
    assert.equal(await page.evaluate(() => testGame.gameUI.overlays.toasts.children.length), 0, 'Enabling must not replay hidden messages');
    await append(page, '重新开启后显示新消息');
    assert.equal(await page.evaluate(() => testGame.gameUI.overlays.toasts.children.length), 1);
    await page.evaluate(() => { testGame.gameUI.overlays.entries.forEach((entry) => entry.expiresAt = 0); testGame.gameUI.overlays.update(); });
    assert.equal(await page.evaluate(() => testGame.gameUI.overlays.toasts.children.length), 0);
    await load(page, { ...game, lifecycle: { pause: { startedAt: Date.now(), endsAt: Date.now() + 120000 } } });
    await checkSettings(page, mobile);
    await load(page, { ...game, roomStatus: 'FINISHED', phase: 'GAME_OVER', rankings: [game.players[0].id], lifecycle: {} });
    await checkSettings(page, mobile);
    await click(page, 'SettingsGear', mobile); await click(page, 'ChatToastsToggle', mobile);
    await page.setViewportSize(mobile ? { width: 820, height: 412 } : { width: 800, height: 1280 }); await page.waitForTimeout(450);
    assert.equal(await page.evaluate(() => testGame.gameUI.settings.chatToastsEnabled), false);
    await click(page, 'CloseSettings', mobile);
    await page.evaluate(() => testCC.sys.localStorage.removeItem('skillLudo.roomId'));
    await page.reload(); await initialize(page);
    assert.equal(await page.evaluate(() => testGame.gameUI.settings.chatToastsEnabled), false, 'Preference survives full reload');
    await checkSettings(page, mobile);
    checks.push(`${name}: encyclopedia/profile placement; gear in auth/home/room/game/chat/skills/pause/winner; compact translucent toasts; click/drag toggle; history retained; no replay; expiration; rotation and reload persistence`);
    console.log(`${name}: settings and toast checks passed`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/${prefix}-result.json`, JSON.stringify({ status: 'passed', checkedAt: new Date().toISOString(), url, checks, errors, validation: 'Cocos pointer interactions with isolated game snapshots, desktop DPR 2 and mobile emulation DPR 3; no physical WeChat device test.' }, null, 2) + '\n');
} finally { await browser.close(); }
