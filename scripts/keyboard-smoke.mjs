import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const url = process.env.SKILLLUDO_WEB_URL ?? 'http://127.0.0.1:7459';
const output = process.env.SKILLLUDO_VERIFY_OUTPUT ?? 'docs/verification'; mkdirSync(output, { recursive: true });
const baseline = process.argv.includes('--expect-regression');
const prefix = baseline ? 'keyboard-baseline' : url.includes('127.0.0.1') ? 'keyboard' : 'published-keyboard';
const fixtures = JSON.parse(readFileSync('docs/verification/skill-fixtures.json', 'utf8'));
const browser = await playwright.chromium.launch({ executablePath: join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const checks = [], errors = [];
try {
  for (const platform of ['android', 'ios']) {
    const userAgent = platform === 'android' ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.50'
      : 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1 MicroMessenger/8.0.50';
    const context = await browser.newContext({ viewport: { width: 412, height: 820 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      const Native = WebSocket; window.WebSocket = class extends Native { constructor(_url, protocols) { super('ws://127.0.0.1:3101', protocols); } };
    });
    await page.goto(url);
    let ready = false;
    for (const end = Date.now() + 60000; !ready && Date.now() < end;) {
      ready = await page.evaluate(async () => { try { window.cc = await System.import('cc'); window.gc = cc.director.getScene()?.getChildByName('Canvas')?.getChildByName('GameSystem')?.getComponent('GameController'); return !!gc?.playerId; } catch { return false; } });
      if (!ready) await page.waitForTimeout(150);
    }
    assert.ok(ready);
    await page.evaluate(() => {
      gc.network.disconnect(); gc.send = () => {}; gc.resetPresentation();
      window.focusEvents = [];
      for (const type of ['focusin', 'focusout']) document.addEventListener(type, (event) => { if (event.target.matches?.('.cocosEditBox')) focusEvents.push({ type, id: event.target.id }); });
      window.findNode = (n, name) => n.activeInHierarchy && (n.name === name ? n : n.children.map((child) => findNode(child, name)).find(Boolean));
      window.nodePoint = (name) => {
        const canvasNode = cc.director.getScene().getChildByName('Canvas'), node = findNode(canvasNode, name);
        if (!node) throw new Error(`Missing ${name}`);
        const point = canvasNode.getComponent(cc.Canvas).cameraComponent.worldToScreen(node.worldPosition);
        const canvas = document.querySelector('canvas'), rect = canvas.getBoundingClientRect();
        return { x: rect.left + point.x * rect.width / canvas.width, y: rect.top + (canvas.height - point.y) * rect.height / canvas.height };
      };
    });
    async function tap(name) { const p = await page.evaluate((name) => nodePoint(name), name); await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(120); }
    async function keyboardHeight(height) {
      if (platform === 'ios') await page.evaluate((height) => {
        Object.defineProperty(visualViewport, 'height', { configurable: true, value: height });
        visualViewport.dispatchEvent(new Event('resize'));
      }, height);
      else await page.setViewportSize({ width: 412, height });
    }
    async function typing(name) {
      await page.evaluate((name) => { window.typingField = name; }, name);
      await tap(name);
      const initial = name === 'JoinRoomId' ? '12' : 'keyboard_1', character = name === 'JoinRoomId' ? '3' : 'x';
      await page.locator('input:focus,textarea:focus').fill(initial);
      const before = await page.evaluate(() => {
        window.originalInput = document.activeElement;
        const canvas = document.querySelector('canvas');
        return { events: focusEvents.length, canvas: canvas.getBoundingClientRect().toJSON(), buffer: [canvas.width, canvas.height], input: originalInput.getBoundingClientRect().toJSON() };
      });
      // Simulate the layout-viewport changes produced by Android keyboard and
      // IME candidate rows. Browser device emulation alone never opens a keyboard.
      for (const height of [550, 350, 525, 480]) {
        await keyboardHeight(height); await page.waitForTimeout(300);
        const state = await page.evaluate((from) => ({ sameInput: document.activeElement === originalInput, events: focusEvents.slice(from), canvas: document.querySelector('canvas').getBoundingClientRect().toJSON(), buffer: [document.querySelector('canvas').width, document.querySelector('canvas').height], input: originalInput.getBoundingClientRect().toJSON(), field: nodePoint(window.typingField), viewport: { innerHeight, height: visualViewport.height, top: visualViewport.offsetTop, scale: visualViewport.scale } }), before.events);
        assert.equal(state.events.filter((event) => event.type === 'focusout').length, 0, `${platform}/${name}: keyboard resize must not blur/refocus the input: ${JSON.stringify(state)}`);
        assert.ok(state.sameInput, `${platform}/${name}: original input retains focus`);
        assert.ok(Math.abs(state.canvas.height - before.canvas.height) < 2, `${platform}/${name}: keyboard must not shrink the game canvas`);
        assert.deepEqual(state.buffer, before.buffer, `${platform}/${name}: render buffer must remain stable to prevent stretching`);
        assert.ok(state.input.top >= -2 && state.input.bottom <= height - 10, `${platform}/${name}: active input stays fully above keyboard: ${JSON.stringify(state)}`);
        assert.ok(Math.abs(state.field.y - (state.input.top + state.input.bottom) / 2) < 3, `${platform}/${name}: native text must align with its canvas field: ${JSON.stringify(state)}`);
        await page.keyboard.type(character);
      }
      assert.equal(await page.locator('input:focus,textarea:focus').inputValue(), initial + character.repeat(4));
      if (['RegisterNickname', 'SkillDescription', 'FeedbackContent', 'ChatInput'].includes(name)) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.imeSetComposition', { text: '中文', selectionStart: 2, selectionEnd: 2 });
        await keyboardHeight(430); await page.waitForTimeout(200);
        await cdp.send('Input.insertText', { text: '中文' });
        assert.equal(await page.locator('input:focus,textarea:focus').inputValue(), initial + character.repeat(4) + '中文');
        assert.equal(await page.evaluate((from) => focusEvents.slice(from).filter((event) => event.type === 'focusout').length, before.events), 0);
        await cdp.detach();
      }
      await page.screenshot({ path: `${output}/${prefix}-${platform}-${name}.png` });
      await page.locator('input:focus,textarea:focus').blur();
      if (platform === 'ios') await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
      await page.setViewportSize({ width: 412, height: 820 }); await page.waitForTimeout(900);
      const restored = await page.evaluate(() => ({ canvas: document.querySelector('canvas').getBoundingClientRect().toJSON(), focused: document.activeElement.matches?.('.cocosEditBox') }));
      assert.ok(!restored.focused); assert.ok(Math.abs(restored.canvas.height - 820) < 2 && Math.abs(restored.canvas.y) < 2);
      checks.push(`${platform}/${name}: ${platform === 'ios' ? 'visual' : 'layout'} viewport/IME resize retains focus, typing and canvas; blur restores viewport`);
    }
    await typing('LoginUsername'); await typing('LoginPassword');
    await tap('LoginUsername'); await page.locator('input:focus').fill('switch_user');
    await keyboardHeight(550); await page.waitForTimeout(300);
    await page.keyboard.press('Tab'); await page.waitForTimeout(300);
    assert.equal(await page.locator('input:focus').getAttribute('type'), 'password');
    await page.locator('input:focus').fill('switch_password');
    await keyboardHeight(350); await page.waitForTimeout(300);
    assert.equal(await page.locator('input:focus').inputValue(), 'switch_password');
    assert.equal(await page.evaluate(() => document.getElementById('GameDiv').hasAttribute('data-mobile-editing')), true);
    await page.locator('input:focus').blur();
    if (platform === 'ios') await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
    await page.setViewportSize({ width: 412, height: 820 }); await page.waitForTimeout(900);
    checks.push(`${platform}: switching between fields keeps the same keyboard layout lock`);
    await tap('LoginUsername'); await page.locator('input:focus').fill('rotate_user');
    const rotationStart = await page.evaluate(() => focusEvents.length);
    await page.setViewportSize({ width: 820, height: 412 }); await page.waitForTimeout(650);
    const rotated = await page.evaluate((from) => ({
      events: focusEvents.slice(from), canvas: document.querySelector('canvas').getBoundingClientRect().toJSON(),
      locked: document.getElementById('GameDiv').hasAttribute('data-mobile-editing'),
      value: findNode(cc.director.getScene(), 'LoginUsername').getComponent(cc.EditBox).string,
    }), rotationStart);
    assert.equal(rotated.locked, false); assert.equal(rotated.value, 'rotate_user');
    assert.deepEqual(rotated.events.map((e) => e.type), ['focusout'], 'Real rotation ends editing once without reopening the keyboard');
    assert.ok(Math.abs(rotated.canvas.width - 820) < 2 && Math.abs(rotated.canvas.height - 412) < 2 && Math.abs(rotated.canvas.y) < 2);
    await page.setViewportSize({ width: 412, height: 820 }); await page.waitForTimeout(650);
    checks.push(`${platform}: rotation ends editing once, preserves text and fits the new viewport`);
    await tap('AuthTabREGISTER'); await typing('RegisterNickname');
    await page.evaluate(() => { gc.gameUI.setAccountProfile({ playerId: 'u_keyboard', nickname: '测试' }); gc.gameUI.showHome(); gc.gameUI.showJoinRoomDialog(); });
    await typing('JoinRoomId');
    await page.evaluate(() => gc.gameUI.closeJoinRoomDialog());
    await page.evaluate(() => gc.gameUI.showSubmission('COUNTRY')); await typing('SkillDescription');
    await page.evaluate(() => { gc.gameUI.submissions.close(); gc.gameUI.showSubmission('FEEDBACK'); }); await typing('FeedbackContent');
    await page.evaluate((snapshot) => { gc.gameUI.submissions.close(); gc.playerId = snapshot.players[0].id; gc.applySnapshot(snapshot); gc.gameUI.showChatDialog(snapshot, gc.playerId); }, fixtures[0].snapshot);
    await typing('ChatInput');
    await page.evaluate(() => gc.gameUI.closeChatDialog());
    await page.setViewportSize({ width: 820, height: 412 }); await page.waitForTimeout(650);
    assert.ok(await page.evaluate(() => cc.view.getVisibleSize().width > cc.view.getVisibleSize().height));
    await context.close();
  }
  assert.ok(!baseline, 'Expected baseline to reproduce the bug'); assert.deepEqual(errors, []);
  const result = { status: 'passed', checkedAt: new Date().toISOString(), url, checks, errors, scope: 'Android/iOS WeChat UA, layout/visual viewport keyboard resize and CDP Chinese IME composition in Chromium; not physical devices or WebKit' };
  writeFileSync(`${output}/${prefix}-result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  if (!baseline || !String(error).includes('keyboard resize must not blur/refocus the input')) throw error;
  const result = { status: 'reproduced', url, error: String(error), checks, errors };
  writeFileSync(`${output}/${prefix}-result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
