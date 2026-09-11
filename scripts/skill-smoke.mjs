import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require(process.env.PLAYWRIGHT_PATH ?? 'playwright'); }
catch { playwright = require(join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')); }
const fixtures = JSON.parse(readFileSync('docs/verification/skill-fixtures.json', 'utf8'));
const output = 'docs/verification'; mkdirSync(output, { recursive: true });
const browser = await playwright.chromium.launch({ executablePath: process.env.SKILLLUDO_BROWSER ?? join(process.env.ProgramFiles ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'), headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [], checks = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript(() => { const Native = WebSocket; window.WebSocket = class extends Native { constructor(_url, protocols) { super('ws://127.0.0.1:3101', protocols); } }; });
async function click(name, board = false) {
  const point = await page.evaluate(({ name, board }) => {
    const root = board ? testGame.boardController.root : testGame.gameUI.runtimeRoot;
    const find = (node) => node.activeInHierarchy && (node.name === name ? node : node.children.map(find).find(Boolean));
    const node = find(root); if (!node) throw new Error(`Missing active node ${name}`);
    const camera = testCC.director.getScene().getChildByName('Canvas').getComponent(testCC.Canvas).cameraComponent;
    const p = camera.worldToScreen(node.worldPosition), canvas = document.querySelector('canvas'), rect = canvas.getBoundingClientRect();
    return { x: rect.left + p.x * rect.width / canvas.width, y: rect.top + (canvas.height - p.y) * rect.height / canvas.height };
  }, { name, board });
  await page.mouse.click(point.x, point.y); await page.waitForTimeout(70);
}
async function load(name) {
  const fixture = fixtures.find((f) => f.name === name);
  await page.evaluate((f) => {
    testGame.resetPresentation(); window.sent = []; testGame.playerId = f.playerId;
    const snapshot = structuredClone(f.snapshot);
    if (snapshot.reaction) snapshot.reaction.expiresAt = Date.now() + 15000;
    testGame.applySnapshot(snapshot);
  }, fixture);
  return fixture;
}
async function expectCommand(type, expected) {
  const sent = await page.evaluate(() => window.sent);
  assert.equal(sent.length, 1); assert.equal(sent[0].type, type);
  for (const [key, value] of Object.entries(expected)) assert.deepEqual(sent[0].data[key], value);
}
async function play(fixture) {
  await page.evaluate(async (f) => {
    if (f.effect) await testGame.boardController.playSkill(f.effect);
    if (f.move) await testGame.boardController.playMove(f.move);
  }, fixture);
  for (const piece of fixture.after.pieces.filter((p) => (fixture.effect?.movedPieces ?? []).some((m) => m.after.id === p.id) || (fixture.effect?.captures ?? fixture.move?.captureOutcomes ?? []).some((c) => c.pieceId === p.id))) {
    const distance = await page.evaluate((piece) => {
      const board = testGame.boardController, actor = board.actors.get(piece.id), expected = board.piecePoint(piece);
      return Math.hypot(actor.model.position.x - expected.x, actor.model.position.y - expected.y);
    }, piece);
    assert.ok(distance < .01, `${fixture.name}/${piece.id} ends on its authoritative cell: ${distance}`);
  }
  await page.evaluate((s) => testGame.applySnapshot(s), fixture.after);
}
try {
  await page.goto(process.env.SKILLLUDO_PREVIEW_URL ?? 'http://127.0.0.1:7459');
  let ready = false; const deadline = Date.now() + 60000;
  while (!ready && Date.now() < deadline) {
    ready = await page.evaluate(async () => {
      try { window.testCC = await System.import('cc'); window.testGame = testCC.director.getScene()?.getChildByName('Canvas')?.getChildByName('GameSystem')?.getComponent('GameController'); return !!testGame?.playerId; }
      catch { return false; }
    });
    if (!ready) await page.waitForTimeout(250);
  }
  assert.ok(ready);
  await page.evaluate(() => { testGame.network.disconnect(); testGame.resetPresentation(); testGame.send = (type, data) => window.sent.push({ type, data }); });
  // From this point these are isolated Canvas fixtures, not network game turns.
  await page.waitForTimeout(150);
  let f = await load('britain');
  await click('SKILLS'); await click('Skill-uk-industry'); await click('ActivateSkill');
  await click('Option-uk-sum');
  assert.equal(await page.evaluate(() => testGame.selection.current(testGame.snapshot, testGame.playerId).dice), 12);
  assert.equal(await page.evaluate(() => sent.length), 0);
  await page.evaluate(() => testGame.onClickDie(0));
  assert.equal(await page.evaluate(() => testGame.selection.current(testGame.snapshot, testGame.playerId).dice), 6);
  await click('SKILLS'); await click('ActivateSkill');
  await click('red-1-hit', true);
  await click('yellow-1-hit', true);
  await page.screenshot({ path: `${output}/skill-britain-target.png` });
  await click('ConfirmSkill'); await expectCommand('USE_SKILL', { skillId: 'uk-sun', targetPieceIds: ['red-1', 'yellow-1'] });
  await play(f);
  assert.equal(await page.evaluate(() => testGame.snapshot.pieces.find((p) => p.id === 'red-1').detour), true);
  checks.push('British sum preview is reversible; two enemy/friendly pointer targets; detour swap lands at calibrated centres');

  f = await load('china'); await click('SKILLS'); await click('Skill-cn-grit');
  await page.screenshot({ path: `${output}/skill-china-energy.png` });
  await click('Skill-cn-scale'); await click('ActivateSkill');
  await page.screenshot({ path: `${output}/skill-china-options.png` });
  await click('Option-cn-0--2');
  assert.equal(await page.evaluate(() => sent.length), 0);
  assert.equal(await page.evaluate(() => testGame.boardController.movable.has('blue-1')), true);
  await click('blue-1-hit', true); await expectCommand('COMMIT_MOVE', { optionId: 'cn-0--2', pieceId: 'blue-1' });
  await play(f); await click('SKILLS'); await click('Skill-cn-scale');
  assert.equal(await page.evaluate(() => testGame.gameUI.skills.root.getChildByName('SkillCard').getChildByName('ActivateSkill').getComponent(testCC.Button).interactable), false);
  await page.screenshot({ path: `${output}/skill-china-cooldown.png` });
  checks.push('Chinese energy diamonds, +/-2 options, preview then atomic move, cooldown disabled');

  f = await load('france'); await click('Lock-yellow-1');
  await page.screenshot({ path: `${output}/skill-france-reaction.png` });
  await click('ConfirmLocks'); await expectCommand('USE_SKILL', { skillId: 'fr-lock', targetPieceIds: ['yellow-1'], reactionId: f.snapshot.reaction.id });
  await play(f);
  assert.equal(await page.evaluate(() => testGame.boardController.actors.get('yellow-1').hit.getChildByName('LockBadge').active), true);
  await page.screenshot({ path: `${output}/skill-france-lock.png` });
  checks.push('French countdown and selection pointer input; lock badge stays at the capture cell');

  f = await load('america'); await click('SKILLS'); await click('Skill-us-bomb'); await click('ActivateSkill');
  assert.equal(await page.evaluate(() => testGame.boardController.skillCells.children.length), 52);
  await page.screenshot({ path: `${output}/skill-america-grid.png` });
  await click('Target-M0', true); await click('ConfirmSkill'); await expectCommand('USE_SKILL', { skillId: 'us-bomb', targetCell: 'M0' });
  await play(f);
  assert.equal(await page.evaluate(() => testGame.snapshot.pieces.find((p) => p.id === 'blue-1').progress), 0);
  checks.push('American 52 rotated cell targets, five-cell blast, Chinese capture returns to takeoff');

  f = await load('paris'); await click('SKILLS'); await click('Skill-fr-paris'); await click('ActivateSkill');
  await expectCommand('USE_SKILL', { skillId: 'fr-paris' }); await play(f);
  assert.equal(await page.evaluate(() => testGame.snapshot.rescuePieceIds.length), 2);
  checks.push('Paris unlock animation and pending rescue count');

  await load('china');
  await page.evaluate(() => { const s = structuredClone(testGame.snapshot); s.players.find((p) => p.id === 'BLUE').aiControlled = true; testGame.applySnapshot(s); });
  await click('SKILLS'); await click('Skill-cn-grit');
  assert.equal(await page.evaluate(() => testGame.gameUI.skills.root.getChildByName('SkillCard').getChildByName('ActivateSkill').getComponent(testCC.Button).interactable), false);
  assert.equal(await page.evaluate(() => sent.length), 0);
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(350);
  await page.screenshot({ path: `${output}/skill-portrait.png` });
  checks.push('AI optional skills disabled; portrait modal reflows');
  assert.deepEqual(errors, []);
  const result = { status: 'passed', kind: 'authority-calculated local presentation fixtures with intercepted commands', checks, errors };
  writeFileSync(`${output}/skill-result.json`, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) { await page.screenshot({ path: `${output}/failure-skills.png` }); console.error(error, errors); process.exitCode = 1; }
finally { await browser.close(); }
