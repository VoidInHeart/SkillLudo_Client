import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve('build/wechatgame');
const read = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));
for (const file of ['game.js', 'game.json', 'project.config.json', 'src/settings.json', 'cocos-js/cc.js']) {
  assert.ok(existsSync(join(root, file)), `Missing build artifact: ${file}`);
}
const project = read('project.config.json'), game = read('game.json'), settings = read('src/settings.json');
assert.equal(project.compileType, 'game');
assert.equal(game.deviceOrientation, 'landscape');
assert.equal(settings.engine.debug, false, 'WeChat artifact must be a release build');
const files = [];
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else files.push({ path: relative(root, path).replaceAll('\\', '/'), bytes: statSync(path).size });
  }
}
visit(root);
const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
// This project intentionally uses a single local package. Count all files,
// including artwork, as a conservative budget before DevTools' own analysis.
const budgetBytes = 4 * 1024 * 1024;
assert.ok(totalBytes < budgetBytes, `Package exceeds the configured 4 MiB budget: ${totalBytes}`);
const report = {
  status: 'passed', platform: 'wechatgame', creator: settings.CocosEngine,
  releaseBuild: true, orientation: game.deviceOrientation,
  appIdConfigured: project.appid !== 'touristappid',
  fileCount: files.length, totalBytes, budgetBytes,
  largestFiles: files.sort((a, b) => b.bytes - a.bytes).slice(0, 6),
  validation: 'Static build and conservative package budget only; no WeChat device or upload verification.'
};
mkdirSync('docs/verification', { recursive: true });
writeFileSync('docs/verification/wechat-build-result.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
