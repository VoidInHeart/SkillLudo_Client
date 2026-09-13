import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const browser = await playwright.chromium.launch({ executablePath: join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const output = 'docs/verification', checks = [], errors = []; mkdirSync(output, { recursive: true });
try {
  for (const mobile of [false, true]) {
    const name = mobile ? 'phone' : 'desktop';
    const context = await browser.newContext({ viewport: mobile ? { width: 412, height: 820 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 3 : 2 });
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { const Native = WebSocket; window.WebSocket = class extends Native { constructor(_url, protocols) { super('ws://127.0.0.1:3101', protocols); } }; });
    await page.goto(process.env.SKILLLUDO_WEB_URL ?? 'http://127.0.0.1:7459');
    let ready = false;
    for (const deadline = Date.now() + 60000; !ready && Date.now() < deadline;) {
      ready = await page.evaluate(async () => { try { window.cc = await System.import('cc'); window.gc = cc.director.getScene()?.getChildByName('Canvas')?.getChildByName('GameSystem')?.getComponent('GameController'); return !!gc?.playerId; } catch { return false; } });
      if (!ready) await page.waitForTimeout(150);
    }
    assert.ok(ready);
    await page.evaluate(() => {
      gc.network.disconnect(); gc.send = () => {}; gc.resetPresentation(); gc.gameUI.setAccountProfile({ playerId: 'u_test-author', nickname: '投稿测试' }); gc.gameUI.showHome(); window.submitted = [];
      gc.gameUI.node.off('submission-send', gc.handleSubmission, gc); gc.gameUI.node.on('submission-send', (data) => submitted.push(structuredClone(data)));
      window.find = (n, name) => n.activeInHierarchy && (n.name === name ? n : n.children.map((c) => find(c, name)).find(Boolean));
      window.bounds = (name) => {
        const canvasNode = cc.director.getScene().getChildByName('Canvas'), node = find(canvasNode, name); if (!node) throw new Error(`Missing ${name}`);
        const ui = node.getComponent(cc.UITransform), camera = canvasNode.getComponent(cc.Canvas).cameraComponent;
        const canvas = document.querySelector('canvas'), rect = canvas.getBoundingClientRect();
        const corners = [[0, 0], [ui.width, ui.height]].map(([x, y]) => {
          const p = camera.worldToScreen(ui.convertToWorldSpaceAR(new cc.Vec3(x - ui.width * ui.anchorX, y - ui.height * ui.anchorY)));
          return { x: rect.left + p.x * rect.width / canvas.width, y: rect.top + (canvas.height - p.y) * rect.height / canvas.height };
        }); return { left: corners[0].x, right: corners[1].x, top: corners[1].y, bottom: corners[0].y };
      };
    });
    async function click(name) {
      const b = await page.evaluate((name) => bounds(name), name), x = (b.left + b.right) / 2, y = (b.top + b.bottom) / 2;
      if (mobile) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y);
      await page.waitForTimeout(100);
    }
    async function fill(name, value) { await click(name); const input = page.locator('input:focus,textarea:focus'); await input.fill(value); await input.blur(); await page.waitForTimeout(80); }
    const positions = await page.evaluate(() => [bounds('AccountAvatar'), bounds('DIY新的国家卡片Button')]);
    assert.ok(positions[1].top >= positions[0].bottom);
    await click('DIY新的国家卡片Button');
    await fill('CountryName', '天海共和国'); await fill('CountryDescription', '自由航行的群岛国家');
    await fill('SkillName', '顺风'); await fill('SkillTrigger', '选择点数后'); await fill('SkillDescription', '可以让点数增加 1。\n修改后不再重投。');
    await click('SkillType'); await click('Type-COOLDOWN'); await fill('SkillCooldown', '每 3 个正常回合一次');
    await click('AddSkill'); await fill('SkillName', '最后航线'); await fill('SkillDescription', '每局一次，重新选择目的地。'); await click('SkillType'); await click('Type-LIMITED');
    await click('PreviousSkill'); assert.equal(await page.evaluate(() => gc.gameUI.submissions.inputs.get('SkillName').string), '顺风');
    if (mobile) {
      await page.setViewportSize({ width: 820, height: 412 }); await page.waitForTimeout(450);
      assert.equal(await page.evaluate(() => gc.gameUI.submissions.inputs.get('SkillDescription').string), '可以让点数增加 1。\n修改后不再重投。');
      await page.setViewportSize({ width: 412, height: 820 }); await page.waitForTimeout(450);
    }
    const bounds = await page.evaluate(() => window.bounds('SubmissionCard')), viewport = page.viewportSize();
    assert.ok(bounds.left >= 0 && bounds.top >= 0 && bounds.right <= viewport.width && bounds.bottom <= viewport.height);
    await page.screenshot({ path: `${output}/submission-${name}-editor.png` });
    await click('PreviewSubmission'); await page.screenshot({ path: `${output}/submission-${name}-review.png` });
    await click('SendSubmission'); await click('SendSubmission');
    let messages = await page.evaluate(() => submitted); assert.equal(messages.length, 1); assert.equal(messages[0].draft.country.skills.length, 2); assert.equal(messages[0].draft.country.skills[0].type, 'COOLDOWN');
    await page.evaluate(() => gc.gameUI.showSubmissionResult({ status: 'ERROR', message: '模拟未收到确认' }));
    await click('SendSubmission'); messages = await page.evaluate(() => submitted); assert.equal(messages.length, 2); assert.equal(messages[0].id, messages[1].id);
    await page.evaluate(() => gc.gameUI.showSubmissionResult({ id: submitted[0].id, status: 'SENT', message: '提交成功' }));
    await click('CloseReview'); await click('DIY新的国家卡片Button'); assert.equal(await page.evaluate(() => gc.gameUI.submissions.inputs.get('CountryName').string), '天海共和国');
    await click('CloseSubmission'); await click('SettingsGear'); await click('FeedbackButton');
    await fill('FeedbackContent', '反馈：法国锁定后棋子选择体验\n希望增加提示。'); await click('PreviewSubmission'); await click('SendSubmission');
    messages = await page.evaluate(() => submitted); assert.equal(messages[2].draft.kind, 'FEEDBACK'); assert.ok(messages[2].draft.content.includes('法国'));
    await page.evaluate(() => gc.gameUI.showSubmissionResult({ id: submitted[2].id, status: 'SENT', message: '提交成功' }));
    await page.screenshot({ path: `${output}/submission-${name}-feedback.png` });
    await click('CloseReview'); await click('DIY新的国家卡片Button');
    await page.evaluate(() => {
      const dialog = gc.gameUI.submissions;
      dialog.skills = Array.from({ length: 6 }, () => ({ name: '技能', type: 'COOLDOWN', trigger: '中'.repeat(100), description: '文'.repeat(600), cooldown: '三'.repeat(60) }));
      dialog.index = 0; dialog.renderSkill();
    });
    await click('PreviewSubmission');
    assert.equal(await page.evaluate(() => gc.gameUI.submissions.review.active), false);
    assert.ok(await page.evaluate(() => gc.gameUI.submissions.notice.string.includes('过长')));
    checks.push(`${name}: real pointer/keyboard country designer, dropdown, multi-skill navigation, preview, deduplicated retries, saved draft, settings feedback and UTF-8 size limit${mobile ? ', rotation and DPR3' : ''}`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  const result = { status: 'passed', scope: 'Cocos UI with intercepted submission commands; no external email', checks, errors };
  writeFileSync(`${output}/submission-result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
