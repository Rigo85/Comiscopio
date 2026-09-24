// Build artifacts are tested locally and in Actions before upload/publication.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');
assert.equal(process.platform, 'win32');
const root = path.resolve(__dirname, '../..');
const { version } = require('../../package.json');
const artifacts = path.resolve(process.env.COMISCOPIO_WINDOWS_ARTIFACTS || path.join(root, 'release'));
const reports = path.resolve(process.env.COMISCOPIO_TEST_REPORTS || path.join(root, 'test-results/windows-artifacts'));
const archive = path.join(artifacts, `Comiscopio-${version}-win.zip`);
const portable = path.join(artifacts, `Comiscopio ${version}.exe`);
for (const file of [archive, portable]) assert.ok(fs.statSync(file).size > 0, `Missing artifact: ${file}`);
fs.mkdirSync(reports, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-win-artifacts-'));
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
const windows = process.env.SystemRoot || 'C:\\Windows';
env.Path = `${windows}\\System32;${windows};${windows}\\System32\\WindowsPowerShell\\v1.0`;
function run(label, command, args, extra = {}) {
  const fd = fs.openSync(path.join(reports, label + '.log'), 'w');
  const started = Date.now();
  let result;
  try { result = spawnSync(command, args, { cwd: root, env: { ...env, ...extra }, windowsHide: true,
    stdio: ['ignore', fd, fd], timeout: 600000 }); } finally { fs.closeSync(fd); }
  fs.writeFileSync(path.join(reports, label + '-result.json'), JSON.stringify({
    status: result.status, signal: result.signal, error: result.error?.message,
    pid: result.pid, elapsedMs: Date.now() - started,
  }, null, 2));
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${label} failed; see ${path.join(reports, label + '.log')}`);
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function checkPortable() {
  const profile = path.join(temporary, 'portable-profile');
  const config = path.join(profile, 'config');
  const cache = path.join(os.tmpdir(), 'comiscopio');
  const previous = new Set(fs.existsSync(cache) ? fs.readdirSync(cache) : []);
  const port = await freePort();
  const started = Date.now();
  const child = spawn(portable, [`--user-data-dir=${path.join(profile, 'chromium')}`,
    `--remote-debugging-port=${port}`, path.join(root, '.cache/fixtures/abydos.cba')], {
    env: { ...env, COMISCOPIO_CONFIG_DIR: config }, windowsHide: true, stdio: 'ignore',
  });
  let closed = false, failure, browser;
  child.on('error', error => { failure = error; });
  const exit = new Promise(resolve => child.on('close', code => { closed = true; resolve(code); }));
  try {
    const deadline = Date.now() + 150000;
    while (!browser && Date.now() < deadline) {
      assert.ifError(failure); assert.ok(!closed, 'Portable launcher exited before opening');
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 1000 }); } catch { await delay(250); }
    }
    assert.ok(browser, 'Portable did not expose a window before timeout');
    let page;
    while (!page && Date.now() < deadline) {
      page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('file:'));
      if (!page) await delay(100);
    }
    assert.ok(page, 'Portable window missing');
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    async function rendered(index) {
      await page.waitForFunction(index => {
        const image = document.querySelector(`img.viewer-image[alt="Página ${index}"]`);
        return image?.complete && image.naturalWidth > 0 && image.currentSrc === image.src &&
          new URL(image.src).pathname === `/${index - 1}` && !document.querySelector('.viewer-error,.viewer-loading');
      }, index, { timeout: 60000 });
      await page.locator('img.viewer-image').first().evaluate(image => image.decode());
    }
    await rendered(1); const firstImageMs = Date.now() - started;
    await page.keyboard.press('End'); await rendered(2);
    await page.locator('app-viewer').click({ button: 'right', position: { x: 450, y: 200 } });
    await page.getByText('Acerca de...', { exact: true }).click();
    await page.locator('.about-modal').waitFor();
    assert.equal(await page.locator('.about-row').filter({ hasText: 'Version' }).locator('.about-value').innerText(), version);
    await page.locator('.about-close').click();
    const state = await page.evaluate(() => ({ text: document.body.innerText, image: document.querySelector('img.viewer-image').src }));
    await page.screenshot({ path: path.join(reports, 'portable-ace.png') });
    const hash = new URL(state.image).hostname;
    const outputs = fs.readdirSync(cache).filter(name => name.startsWith(hash + '-') && !previous.has(name));
    assert.equal(outputs.length, 1);
    await page.evaluate(() => window.electronAPI.send('window-close')).catch(error => {
      if (!error.message.includes('Target page, context or browser has been closed')) throw error;
    });
    const closeDeadline = Date.now() + 15000;
    while (!closed && Date.now() < closeDeadline) await delay(50);
    assert.ok(closed, 'Portable launcher did not terminate');
    assert.equal(await exit, 0);
    for (const output of outputs) assert.ok(!fs.existsSync(path.join(cache, output)), 'Portable left a reading cache behind');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(reports, 'portable.json'), JSON.stringify({ version, firstImageMs,
      elapsedMs: Date.now() - started, state, removedDirectories: outputs, passed: true }, null, 2));
  } finally {
    if (!closed && child.pid) {
      // Only terminate the process tree launched by this test, including its wrapper.
      spawnSync(path.join(windows, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
      await exit;
    }
    const logs = path.join(config, 'logs');
    if (fs.existsSync(logs)) fs.cpSync(logs, path.join(reports, 'portable-logs'), { recursive: true });
    if (browser?.isConnected()) await browser.close();
  }
}
(async () => {
  let failed = false;
  try {
    const extracted = path.join(temporary, 'zip');
    // Environment variables preserve spaces/Unicode without interpolating PowerShell source.
    run('extract-zip', path.join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:COMISCOPIO_TEST_ZIP -DestinationPath $env:COMISCOPIO_TEST_EXTRACT'],
      { COMISCOPIO_TEST_ZIP: archive, COMISCOPIO_TEST_EXTRACT: extracted });
    const binary = path.join(extracted, 'Comiscopio.exe');
    assert.ok(fs.existsSync(binary), 'ZIP contains no Comiscopio executable');
    for (const [label, script, extra] of [
      ['zip-readers', 'test/workers/native.test.cjs', { COMISCOPIO_NATIVE_DIR: path.join(extracted, 'resources/native') }],
      ['zip-interface', 'test/integration/packaged-app.test.cjs', {}],
      ['zip-processes', 'test/integration/windows-processes.test.cjs', {}],
    ]) run(label, process.execPath, [path.join(root, script)], {
      COMISCOPIO_APP_BINARY: binary, COMISCOPIO_TEST_REPORTS: path.join(reports, label), ...extra,
    });
    await checkPortable();
    fs.writeFileSync(path.join(reports, 'completed.json'), JSON.stringify({ version, archive, portable, passed: true }, null, 2));
  } catch (error) {
    failed = true;
    console.error('Artifact validation failed:', error);
    throw error;
  } finally {
    if (failed) {
      // A timed-out Node controller can leave Electron alive. Restrict cleanup
      // to executables inside this test's unique ZIP extraction, never other apps.
      const cleanup = spawnSync(path.join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-Command',
          "$root=$env:COMISCOPIO_TEST_OWNED_ROOT + '\\'; Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { taskkill /PID $_.ProcessId /T /F }"],
        { env: { ...env, COMISCOPIO_TEST_OWNED_ROOT: temporary }, encoding: 'utf8', windowsHide: true, timeout: 30000 });
      fs.writeFileSync(path.join(reports, 'failed-process-cleanup.log'), (cleanup.stdout || '') + (cleanup.stderr || '') + (cleanup.error?.message || ''));
    }
    try { fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch (error) {
      if (!failed) throw error;
      console.error('Additional cleanup failure:', error);
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
