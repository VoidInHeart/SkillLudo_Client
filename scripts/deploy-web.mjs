import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const host = args.find((arg) => arg.startsWith('--host='))?.slice(7) ?? 'SEBaseline';
if (!/^[a-zA-Z0-9_.@-]+$/.test(host) || host.startsWith('-')) throw new Error('Invalid SSH host');
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { cwd: root, windowsHide: true, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result.stdout?.trim();
}

if (!args.includes('--skip-build')) {
  if (process.platform !== 'win32') throw new Error('Build web-desktop in Creator first, then use --skip-build on macOS/Linux.');
  run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/build-cocos.ps1')]);
}
const build = join(root, 'build/web-desktop');
if (!existsSync(join(build, 'index.html'))) throw new Error('Missing build/web-desktop/index.html');
const revision = run('git', ['rev-parse', 'HEAD'], true);
const sourceDirty = !!run('git', ['status', '--porcelain', '--untracked-files=normal'], true);
const release = `${revision.slice(0, 12)}-${Date.now()}`;
const staging = join(root, 'temp/web-publish', release);
mkdirSync(staging, { recursive: true });
cpSync(build, join(staging, 'public'), { recursive: true });
cpSync(join(root, 'deploy'), join(staging, 'deploy'), { recursive: true });
writeFileSync(join(staging, 'public/version.json'), JSON.stringify({ revision, release, sourceDirty, packagedAt: new Date().toISOString() }) + '\n');
let rawBytes = 0;
let transferBytes = 0;
function compress(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) compress(path);
    else if (entry.isFile()) {
      const raw = readFileSync(path);
      rawBytes += raw.length;
      if (/^\.(js|json|css|html|svg|wasm)$/.test(extname(path))) {
        const zipped = gzipSync(raw, { level: 9 });
        if (zipped.length < raw.length) { writeFileSync(path + '.gz', zipped); transferBytes += zipped.length; }
        else transferBytes += raw.length;
      } else transferBytes += raw.length;
    } else throw new Error(`Unsupported build entry: ${path}`);
  }
}
compress(join(staging, 'public'));
const archive = join(staging, 'web.tar.gz');
run('tar', ['-czf', archive, '-C', staging, 'public', 'deploy']);
console.log(JSON.stringify({ release, revision, sourceDirty, rawBytes, transferBytes, archive }));
if (!args.includes('--package-only')) {
  const remoteDirectory = `/opt/skillludo/web/releases/${release}`;
  run('ssh', ['-o', 'BatchMode=yes', host, `sudo -n mkdir -p '${remoteDirectory}' && sudo -n chown "$(id -u):$(id -g)" '${remoteDirectory}'`]);
  run('scp', [archive, `${host}:${remoteDirectory}/web.tar.gz`]);
  run('ssh', ['-o', 'BatchMode=yes', host, `cd '${remoteDirectory}' && tar -xzf web.tar.gz && sudo -n bash deploy/install-web.sh '${release}'`]);
}
