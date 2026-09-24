// Run against an extracted Windows package, with no MSYS2 in PATH.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron } = require('playwright-core');
assert.equal(process.platform, 'win32');
const root = path.resolve(__dirname, '../..');
const binary = path.resolve(process.env.COMISCOPIO_APP_BINARY);
const workerBinary = path.join(path.dirname(binary), 'resources/native/bin/comiscopio-worker.exe');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-process-test-'));
const helper = path.join(temporary, 'blocked-helper.exe');
const input = path.join(root, '.cache/fixtures/abydos.cba');
const reports = path.resolve(process.env.COMISCOPIO_TEST_REPORTS || 'test-results/windows-processes');
fs.mkdirSync(reports, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
const windows = process.env.SystemRoot || 'C:\\Windows';
env.Path = `${windows}\\System32;${windows};${windows}\\System32\\WindowsPowerShell\\v1.0`;
const results = [];
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function until(predicate, message, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) { assert.ok(Date.now() < deadline, message); await delay(25); }
}
function stopDescendants(pids) {
  if (pids) for (const pid of Object.values(pids)) if (alive(pid)) process.kill(pid, 'SIGKILL');
}
before(() => {
  assert.ok(fs.existsSync(input), 'Run npm run test:fixtures first');
  // The framework compiler builds only this tiny fixture, not the application.
  const compiler = path.join(windows, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const result = spawnSync(compiler, ['/nologo', '/target:exe', `/out:${helper}`,
    path.join(root, 'test/fixtures/windows/blocked-helper.cs')], { env, encoding: 'utf8', windowsHide: true });
  fs.writeFileSync(path.join(reports, 'compile-helper.log'), (result.stdout || '') + (result.stderr || ''));
  assert.ifError(result.error);
  assert.equal(result.status, 0, 'Could not compile the blocked-helper fixture');
});
after(() => {
  fs.writeFileSync(path.join(reports, 'results.json'), JSON.stringify(results, null, 2));
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

test('force-stopping the ACE worker terminates its blocked helper and descendant', { timeout: 45000 }, async () => {
  const marker = path.join(temporary, 'force.json');
  const child = spawn(workerBinary, ['--input', input, '--output', path.join(temporary, 'output'), '--backend', 'ace'], {
    env: { ...env, COMISCOPIO_ACE_HELPER_BINARY: helper, COMISCOPIO_CANCEL_MARKER: marker },
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let diagnostics = '', closed = false, failure, pids;
  child.stdout.resume(); child.stdin.on('error', () => {});
  child.stderr.on('data', data => { diagnostics += data; });
  child.on('error', error => { failure = error; closed = true; });
  const exit = new Promise(resolve => child.on('close', (code, signal) => { closed = true; resolve({ code, signal }); }));
  try {
    await until(() => fs.existsSync(marker) || closed, 'Blocked helper did not start');
    assert.ifError(failure); assert.ok(!closed, diagnostics);
    pids = JSON.parse(fs.readFileSync(marker));
    assert.ok(alive(pids.helper) && alive(pids.descendant), 'Both descendants must be alive before cancellation');
    const started = Date.now(); child.kill('SIGKILL');
    await until(() => closed, 'Worker did not terminate', 5000);
    await until(() => !alive(pids.helper) && !alive(pids.descendant), 'Descendants survived forced termination', 5000);
    results.push({ mode: 'force', worker: child.pid, ...pids, elapsedMs: Date.now() - started, ...await exit, allExited: true });
  } finally {
    if (!closed) { child.kill('SIGKILL'); await exit; }
    stopDescendants(pids);
    fs.writeFileSync(path.join(reports, 'force.log'), diagnostics);
  }
});

test('closing the last window stops blocked ACE descendants and removes its output', { timeout: 165000 }, async () => {
  const marker = path.join(temporary, 'app.json');
  const cache = path.join(os.tmpdir(), 'comiscopio');
  const previous = new Set(fs.existsSync(cache) ? fs.readdirSync(cache) : []);
  let application, pids;
  try {
    application = await _electron.launch({ executablePath: binary,
      args: [`--user-data-dir=${path.join(temporary, 'chromium')}`], timeout: 120000,
      env: { ...env, COMISCOPIO_CONFIG_DIR: path.join(temporary, 'config'),
        COMISCOPIO_ACE_HELPER_BINARY: helper, COMISCOPIO_CANCEL_MARKER: marker },
    });
    const page = await application.firstWindow(); await page.locator('app-viewer').waitFor();
    await application.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, input);
    await page.keyboard.press('Control+o');
    await until(() => fs.existsSync(marker), 'Blocked helper did not start in the app');
    pids = JSON.parse(fs.readFileSync(marker));
    assert.ok(alive(pids.helper) && alive(pids.descendant));
    const outputs = fs.readdirSync(cache).filter(name => !previous.has(name));
    assert.equal(outputs.length, 1, 'Expected exactly one new reading session');
    const closed = application.waitForEvent('close', { timeout: 15000 });
    const started = Date.now();
    await page.evaluate(() => window.electronAPI.send('window-close')).catch(error => {
      if (!error.message.includes('Target page, context or browser has been closed')) throw error;
    });
    await closed;
    await until(() => !alive(pids.helper) && !alive(pids.descendant), 'Descendants survived application exit', 5000);
    for (const output of outputs) assert.ok(!fs.existsSync(path.join(cache, output)), 'Reading output survived application exit');
    results.push({ mode: 'last-window-close', ...pids, elapsedMs: Date.now() - started, allExited: true, removedDirectories: outputs });
  } finally {
    if (application) await application.close();
    stopDescendants(pids);
    const logs = path.join(temporary, 'config/logs');
    if (fs.existsSync(logs)) fs.cpSync(logs, path.join(reports, 'logs'), { recursive: true });
  }
});
