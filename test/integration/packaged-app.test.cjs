const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright-core');
// Fresh Windows extracts can take over 45 seconds to initialize in the test VM.
const launchTimeout = process.platform === 'win32' ? 120000 : 45000;

test('packaged app keeps the ACE limit message and can open another file after rejection', { timeout: launchTimeout + 30000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-ace-ui-'));
  const application = await _electron.launch({
    executablePath: path.resolve(process.env.COMISCOPIO_APP_BINARY),
    args: [`--user-data-dir=${path.join(temporary, 'chromium')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, COMISCOPIO_CONFIG_DIR: path.join(temporary, 'config'), COMISCOPIO_ACE_MAX_ENTRIES: '1' },
    timeout: launchTimeout,
  });
  t.after(async () => {
    try { await application.close(); } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  });
  const page = await application.firstWindow();
  await page.locator('app-viewer').waitFor();
  async function open(filename) {
    await application.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, filename);
    await page.keyboard.press('Control+o');
  }
  await open(path.join(root, '.cache/fixtures/abydos.cba'));
  await page.locator('.viewer-error').waitFor();
  assert.match(await page.locator('.viewer-error').innerText(), /ACE supera el limite de entradas \(1\)/);
  // Wait beyond the worker's exit/close handling to catch error replacement.
  await page.waitForTimeout(300);
  assert.doesNotMatch(await page.locator('.viewer-error').innerText(), /Worker exited/);
  await open(path.join(root, 'test/fixtures/archive/test-5pages.cbz'));
  await page.waitForFunction(() => {
    const image = document.querySelector('img.viewer-image');
    return !document.querySelector('.viewer-error, .viewer-loading') && image?.complete && image.naturalWidth > 0;
  });
  await page.locator('img.viewer-image').first().evaluate(image => image.decode());
});

test('packaged app renders each format, restores progress and reuses an existing window', { timeout: launchTimeout + 180000 }, async t => {
  const root = path.resolve(__dirname, '../..');
  const cacheRoot = path.join(os.tmpdir(), 'comiscopio');
  const previousOutputs = new Set(fs.existsSync(cacheRoot) ? fs.readdirSync(cacheRoot) : []);
  const executablePath = process.env.COMISCOPIO_APP_BINARY;
  assert.ok(executablePath && fs.existsSync(executablePath), 'Set COMISCOPIO_APP_BINARY to the packaged executable');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-app-test-'));
  const reports = path.resolve(process.env.COMISCOPIO_TEST_REPORTS || path.join(root, 'test-results/electron'));
  fs.mkdirSync(reports, { recursive: true });
  const application = await _electron.launch({
    executablePath: path.resolve(executablePath),
    args: [`--user-data-dir=${path.join(temporary, 'chromium')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, COMISCOPIO_CONFIG_DIR: path.join(temporary, 'config') },
    timeout: launchTimeout,
  });
  t.after(async () => {
    try { await application.close(); } finally {
      const logs = path.join(temporary, 'config/logs');
      if (fs.existsSync(logs)) fs.cpSync(logs, path.join(reports, 'logs'), { recursive: true });
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });
  assert.equal(await application.evaluate(({ app }) => app.isPackaged), true);
  const expectedVersion = require('../../package.json').version;
  assert.equal(await application.evaluate(({ app }) => app.getVersion()), expectedVersion);
  const first = await application.firstWindow();
  const errors = [];
  first.on('pageerror', error => errors.push(error.message));
  await first.locator('app-viewer').waitFor();
  async function open(page, file) {
    await application.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, path.join(root, 'test/fixtures', file));
    await page.keyboard.press('Control+o');
  }
  async function dropFile(page, file) {
    const cdp = await page.context().newCDPSession(page);
    try {
      const data = { items: [], files: [path.join(root, 'test/fixtures', file)], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop']) {
        await cdp.send('Input.dispatchDragEvent', { type, x: 450, y: 250, data });
      }
    } finally { await cdp.detach(); }
  }
  async function rendered(page, index) {
    await page.waitForFunction(expected => {
      const img = document.querySelector(`img.viewer-image[alt="Página ${expected}"]`);
      if (!img || document.querySelector('.viewer-loading, .viewer-error')) return false;
      const src = img.src;
      if (new URL(src).pathname !== `/${expected - 1}`) return false;
      return img.currentSrc === src && img.complete && img.naturalWidth > 0 &&
        img.getAttribute('alt') === `Página ${expected}`;
    }, index, { timeout: 20000 });
    await page.locator(`img.viewer-image[alt="Página ${index}"]`).evaluate(img => img.decode());
  }
  for (const [file, count] of [
    ['archive/test-5pages.cbz', 5], ['archive/test-5pages.cbr', 5],
    ['archive/test-5pages.cb7', 5], ['archive/test-5pages.cbt', 5],
    ['doc/test-5pages.pdf', 5], ['doc/test-5pages.epub', 5],
    ['doc/test-5pages.xps', 5], ['image/formats', 7],
    ['../../.cache/fixtures/abydos.cba', 2],
  ]) {
    await open(first, file);
    await rendered(first, 1);
    if (file === 'archive/test-5pages.cbz') {
      await first.locator('app-viewer').click({ button: 'right', position: { x: 450, y: 200 } });
      await first.getByText('Acerca de...', { exact: true }).click();
      await first.locator('.about-modal').waitFor();
      assert.equal(await first.locator('.about-row').filter({ hasText: 'Version' }).locator('.about-value').innerText(), expectedVersion);
      await first.locator('.about-close').click();
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 480));
      const list = first.locator('.thumbnails-list');
      await list.waitFor();
      for (let attempt = 0; attempt < 3; attempt++) {
        await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
        await first.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }
      const bounds = await list.evaluate(element => {
        const last = element.querySelector('[data-page="4"]');
        return {
          scrollHeight: element.scrollHeight,
          viewport: element.clientHeight,
          bottom: element.getBoundingClientRect().bottom,
          lastBottom: last?.getBoundingClientRect().bottom,
        };
      });
      assert.ok(bounds.scrollHeight <= Math.max(bounds.viewport, 5 * 109 + 16), `Thumbnail list grew beyond the last page: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.lastBottom && Math.abs(bounds.bottom - bounds.lastBottom) <= 16, `Last thumbnail must remain at the end of scrolling: ${JSON.stringify(bounds)}`);
      await first.keyboard.press('ArrowRight');
      await first.keyboard.press('ArrowRight');
      await rendered(first, 3);
      // Dragging the scrollbar changes list position without changing the reader.
      await list.evaluate(element => { element.scrollTop = 0; });
      await first.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      await list.hover();
      await first.mouse.wheel(0, 100);
      await first.waitForFunction(() => document.querySelector('.thumbnails-list').scrollTop > 0);
      await first.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await first.locator('.viewer-image').first().getAttribute('alt'), 'Página 3', 'Wheel over thumbnails must not navigate the reader or recenter its current page');
      await first.keyboard.press('t');
      await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800));
    }
    if (file === 'image/formats') {
      for (let page = 2; page <= count; page++) {
        await first.keyboard.press('ArrowRight');
        await rendered(first, page);
      }
    }
    await first.keyboard.press('End');
    await rendered(first, count);
    await first.screenshot({ path: path.join(reports, `${path.basename(file)}.png`) });
    await first.keyboard.press('Control+w');
    await first.locator('.viewer-image').waitFor({ state: 'detached' });
    await open(first, file);
    await rendered(first, count);
    await first.keyboard.press('Control+w');
    await first.locator('.viewer-image').waitFor({ state: 'detached' });
  }
  // Real filesystem-backed File objects must cross the preload bridge after
  // both closing a book and replacing one already open.
  await dropFile(first, 'archive/test-5pages.cbz');
  await rendered(first, 5);
  const droppedSource = await first.locator('.viewer-image').first().getAttribute('src');
  await dropFile(first, 'doc/test-5pages.pdf');
  await first.waitForFunction(previous => {
    const img = document.querySelector('.viewer-image');
    return img && img.getAttribute('src') !== previous;
  }, droppedSource);
  await rendered(first, 5);
  await first.keyboard.press('Control+w');
  await first.locator('.viewer-image').waitFor({ state: 'detached' });
  await dropFile(first, 'archive/test-5pages.cbz');
  await rendered(first, 5);
  const nextWindow = application.waitForEvent('window');
  await first.keyboard.press('Control+n');
  const second = await nextWindow;
  await second.locator('app-viewer').waitFor();
  await open(second, 'doc/test-5pages.pdf');
  await rendered(second, 5);
  const previousSource = await second.locator('.viewer-image').first().getAttribute('src');
  await open(second, 'archive/test-5pages.cbz');
  await first.waitForFunction(() => document.hasFocus());
  assert.equal(await second.locator('.viewer-image').first().getAttribute('src'), previousSource);
  assert.equal(application.windows().length, 2);
  await second.close();
  await first.keyboard.press('Home');
  await rendered(first, 1);
  assert.deepEqual(errors, []);
  // Closing the last window must wait for its worker and temporary files.
  const hash = new URL(await first.locator('.viewer-image').first().getAttribute('src')).hostname;
  const outputDirs = fs.readdirSync(cacheRoot).filter(name => name.startsWith(`${hash}-`) && !previousOutputs.has(name));
  assert.ok(outputDirs.length > 0, 'The active reader must have temporary output');
  const closed = application.waitForEvent('close');
  await first.evaluate(() => window.electronAPI.send('window-close')).catch(error => {
    // A successful quit can destroy the renderer before CDP returns this call.
    if (!error.message.includes('Target page, context or browser has been closed')) throw error;
  });
  await closed;
  for (const directory of outputDirs) {
    assert.ok(!fs.existsSync(path.join(cacheRoot, directory)), `Temporary output remains after app exit: ${directory}`);
  }
});
