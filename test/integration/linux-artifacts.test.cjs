// Exercise the generated containers, including AppImage runtime and tar wrapper.
// Publication is deliberately separate from these local checks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
assert.equal(process.platform, 'linux');
const artifacts = path.resolve(process.env.COMISCOPIO_LINUX_ARTIFACTS || path.join(root, 'release'));
const { version } = require('../../package.json');
const appImage = path.join(artifacts, `Comiscopio-${version}.AppImage`);
const archive = path.join(artifacts, `comiscopio-${version}.tar.gz`);
for (const file of [appImage, archive]) assert.ok(fs.statSync(file).size > 0, `Missing artifact: ${file}`);
const reports = path.resolve(process.env.COMISCOPIO_TEST_REPORTS || 'test-results/linux-artifacts');
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed (${result.signal || result.status})`);
}
function check(binary, label, extra = {}) {
  console.log(`Testing Linux artifact: ${label}`);
  run(process.execPath, [path.join(__dirname, 'packaged-app.test.cjs')], {
    ...process.env, ...extra, COMISCOPIO_APP_BINARY: binary,
    COMISCOPIO_TEST_REPORTS: path.join(reports, label),
  });
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-tar-test-'));
try {
  run('tar', ['-xzf', archive, '-C', temporary]);
  const candidates = [path.join(temporary, 'comiscopio'), ...fs.readdirSync(temporary)
    .filter(entry => fs.statSync(path.join(temporary, entry)).isDirectory())
    .map(entry => path.join(temporary, entry, 'comiscopio'))];
  const wrapper = candidates.find(file => fs.existsSync(file));
  assert.ok(wrapper, 'Archive contains no Comiscopio launcher');
  check(wrapper, 'tar-gz');
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
check(appImage, 'appimage', { APPIMAGE_EXTRACT_AND_RUN: '1' });
