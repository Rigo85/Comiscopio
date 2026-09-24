// Runs unchanged on Linux and Windows, against local builds or a packaged bundle.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline');
const { setTimeout: delay } = require('node:timers/promises');

const root = path.resolve(__dirname, '../..');
const extension = process.platform === 'win32' ? '.exe' : '';
function start(t, kind, input, backend, output, extraEnv = {}) {
  assert.ok(fs.existsSync(input), `Fixture missing: ${input}. Run node scripts/prepare-ace-fixture.cjs for ACE.`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-native-test-'));
  output ??= path.join(temporary, 'output');
  const bundle = process.env.COMISCOPIO_NATIVE_DIR && path.resolve(process.env.COMISCOPIO_NATIVE_DIR);
  const binary = bundle
    ? path.join(bundle, 'bin', `comiscopio-${kind}${extension}`)
    : path.join(root, 'native', kind, 'build', `comiscopio-${kind}${extension}`);
  assert.ok(fs.existsSync(binary), `Required worker missing: ${binary}`);
  const args = ['--input', input, '--output', output, '--window-before', '0', '--window-after', '0'];
  if (backend) args.push('--backend', backend);
  const env = { ...process.env, ...extraEnv };
  if (bundle && process.platform === 'linux') env.LD_LIBRARY_PATH = path.join(bundle, 'lib');
  const child = spawn(binary, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const events = [];
  let diagnostics = '', closed = false, status;
  child.stderr.on('data', data => { diagnostics += data; });
  child.stdin.on('error', () => {}); // The exit code is checked below.
  createInterface({ input: child.stdout }).on('line', line => {
    try { events.push(JSON.parse(line)); } catch { diagnostics += `Invalid stdout: ${line}\n`; }
  });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => { closed = true; status = code; resolve(code); });
  });
  t.after(async () => {
    if (!closed) child.kill('SIGKILL');
    await exit;
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  async function until(predicate, timeout = 20000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      assert.ok(!closed, `Worker exited (${status}) before expected event.\n${diagnostics}`);
      assert.ok(Date.now() < deadline, `Timed out. Events: ${JSON.stringify(events)}\n${diagnostics}`);
      await delay(20);
    }
  }
  return { child, events, output, until, exit, diagnostics: () => diagnostics };
}

for (const [kind, file, backend, count = 5] of [
  ['worker', 'archive/test-5pages.cbz', 'zip'],
  ['worker', 'archive/test-5pages.cbr', 'rar'],
  ['worker', 'archive/test-5pages.cb7', '7z'],
  ['worker', 'archive/test-solid-large.cb7', '7z', 16],
  ['worker', 'archive/test-5pages.cbt', 'tar'],
  ['doc-worker', 'doc/test-5pages.pdf'],
  ['doc-worker', 'doc/test-5pages.epub'],
  ['doc-worker', 'doc/test-5pages.xps'],
  ['worker', 'image/formats', 'folder', 7],
  ['worker', '../../.cache/fixtures/abydos.cba', 'ace', 2],
]) {
  const solidLarge = file === 'archive/test-solid-large.cb7';
  const windowsStartup = process.platform === 'win32' ? 120000 : 0;
  test(`${file}: render, fragmented focus, batched commands and clean quit`, { timeout: windowsStartup + (solidLarge ? 180000 : count > 5 ? 90000 : 30000) }, async t => {
    const run = start(t, kind, path.join(root, 'test/fixtures', file), backend);
    // The solid fixture writes 480 MiB. A cold Windows extraction can exceed
    // the ordinary 20 s wait even while it is making progress. Fresh Windows
    // packages also need the same cold-start allowance as the GUI suite.
    // Later navigation and shutdown waits retain their existing deadlines.
    await run.until(() => run.events.some(e => e.type === 'archive'), Math.max(windowsStartup, solidLarge ? 60000 : 20000));
    assert.equal(run.events.find(e => e.type === 'archive').totalPages, count);
    // An incomplete line must not block background processing.
    run.child.stdin.write('{"type":"fo');
    await run.until(() => fs.existsSync(path.join(run.output, 'thumbs')) && fs.readdirSync(path.join(run.output, 'thumbs')).length === count,
      solidLarge ? 60000 : 20000);
    run.child.stdin.write(`cus","page":${count - 1}}\n`);
    await run.until(() => run.events.some(e => e.type === 'ready' && e.page === count - 1));
    for (let page = 0; page < count; page++) {
      run.child.stdin.write(JSON.stringify({ type: 'focus', page }) + '\n');
      await run.until(() => run.events.some(e => e.type === 'ready' && e.page === page));
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(run.output, 'manifest.json')));
    assert.equal(manifest.pages.length, count);
    assert.ok(manifest.pages.every(p => p.status === 'ok'), JSON.stringify(manifest.pages));
    for (const page of manifest.pages) {
      if (/\.tiff?$/i.test(page.originalName)) assert.match(page.page, /\.(jpg|webp)$/, 'TIFF must be encoded for Chromium');
    }
    for (const page of manifest.pages) assert.ok(fs.statSync(path.join(run.output, page.thumb)).size > 0);
    assert.ok(fs.statSync(path.join(run.output, manifest.pages[count - 1].page)).size > 0);
    assert.deepEqual(run.events.filter(e => e.type === 'error'), [], run.diagnostics());
    // Both complete lines must be consumed, even when sent by a single write.
    run.child.stdin.end('invalid json\n{"type":"focus","page":"bad"}\n{"type":"focus","page":2}\n{"type":"quit"}\n');
    await run.until(() => run.child.exitCode !== null);
    assert.equal(await run.exit, 0, run.diagnostics());
    if (file === 'archive/test-solid-large.cb7') {
      assert.equal((run.diagnostics().match(/event=block_decode\b/g) || []).length, 1,
        'The single solid block must be decoded once across preview and full extraction');
      const preview = run.events.findIndex(e => e.type === 'ready' && e.page === 0);
      const archive = run.events.findIndex(e => e.type === 'archive');
      assert.ok(preview >= 0 && preview < archive, 'First reader page must remain ready before full extraction completes');
    }
  });
}

test('Linux solid 7z cancellation during preview obeys the bridge shutdown deadline',
  { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
    const run = start(t, 'worker', path.join(root, 'test/fixtures/archive/test-solid-large.cb7'), '7z');
    await run.until(() => /event=block_decode\b/.test(run.diagnostics()));
    const began = Date.now();
    // Same shutdown sequence as NativeWorkerBridge: cooperative signal, then
    // bounded hard stop if the SDK is still inside a non-interruptible decode.
    run.child.stdin.end('{"type":"quit"}\n');
    run.child.kill('SIGTERM');
    const fallback = setTimeout(() => run.child.kill('SIGKILL'), 1500);
    try {
      const code = await run.exit;
      assert.ok(code === 1 || (code === null && run.child.signalCode === 'SIGKILL'), run.diagnostics());
      assert.ok(Date.now() - began < 3000, 'Solid decode must not keep a closed session alive');
      assert.throws(() => process.kill(run.child.pid, 0), { code: 'ESRCH' });
      assert.ok(!run.events.some(e => e.type === 'archive'), 'Cancelled preview must not begin a complete reading session');
    } finally { clearTimeout(fallback); }
  });

// A tiny, valid 24-bit BMP avoids any fixture-generation dependency.
function bmp() {
  const data = Buffer.alloc(70, 0);
  data.write('BM'); data.writeUInt32LE(data.length, 2); data.writeUInt32LE(54, 10);
  data.writeUInt32LE(40, 14); data.writeInt32LE(2, 18); data.writeInt32LE(2, 22);
  data.writeUInt16LE(1, 26); data.writeUInt16LE(24, 28); data.fill(160, 54);
  return data;
}

test('image folder: natural order, nested Unicode paths, junk filtering and damaged-page recovery', { timeout: 30000 }, async t => {
  const input = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-folder-'));
  t.after(() => fs.rmSync(input, { recursive: true, force: true }));
  for (const folder of ['Capítulo 日本', '__MACOSX']) fs.mkdirSync(path.join(input, folder));
  for (const name of ['Capítulo 日本/2.bmp', 'Capítulo 日本/10.bmp', '__MACOSX/ignored.bmp', '._ignored.bmp']) {
    fs.writeFileSync(path.join(input, name), bmp());
  }
  fs.writeFileSync(path.join(input, '1.jpg'), 'broken image');
  fs.writeFileSync(path.join(input, 'ComicInfo.xml'), '<ComicInfo/>');
  const run = start(t, 'worker', input, 'folder');
  await run.until(() => run.events.some(e => e.type === 'archive'));
  for (let page = 0; page < 3; page++) {
    run.child.stdin.write(JSON.stringify({ type: 'focus', page }) + '\n');
    await run.until(() => run.events.some(e => e.type === 'ready' && e.page === page));
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(run.output, 'manifest.json')));
  assert.deepEqual(manifest.pages.map(p => p.originalName), ['1.jpg', 'Capítulo 日本/2.bmp', 'Capítulo 日本/10.bmp']);
  assert.equal(manifest.pages[0].status, 'error');
  assert.ok(run.events.some(e => e.type === 'ready' && e.page === 0), 'Damaged first page must be ready with a placeholder');
  const placeholder = fs.readFileSync(path.join(run.output, manifest.pages[0].page));
  if (manifest.pages[0].page.endsWith('.jpg')) assert.equal(placeholder.readUInt16BE(), 0xffd8);
  else assert.equal(placeholder.toString('ascii', 8, 12), 'WEBP');
  assert.ok(manifest.pages.slice(1).every(p => p.status === 'ok'), JSON.stringify(manifest.pages) + '\n' + run.diagnostics());
  assert.equal(fs.readFileSync(path.join(input, '1.jpg'), 'utf8'), 'broken image');
  assert.deepEqual(fs.readFileSync(path.join(input, 'Capítulo 日本/2.bmp')), bmp());
  run.child.stdin.end('{"type":"quit"}\n');
  await run.until(() => run.child.exitCode !== null);
  assert.equal(await run.exit, 0, run.diagnostics());
});

test('image folder refuses an output directory inside its source', { timeout: 30000 }, async t => {
  const input = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-protect-folder-'));
  t.after(() => fs.rmSync(input, { recursive: true, force: true }));
  fs.writeFileSync(path.join(input, '1.bmp'), bmp());
  const run = start(t, 'worker', input, 'folder', input);
  assert.notEqual(await run.exit, 0);
  assert.deepEqual(fs.readFileSync(path.join(input, '1.bmp')), bmp());
});

test('large progressive JPEGs do not leave background thumbnails paused forever', { timeout: 40000 }, async t => {
  const input = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-progressive-'));
  t.after(() => fs.rmSync(input, { recursive: true, force: true }));
  for (let page = 0; page < 6; page++) {
    fs.copyFileSync(path.join(root, 'test/fixtures/image/large-progressive.jpg'), path.join(input, `${page}.jpg`));
  }
  const run = start(t, 'worker', input, 'folder');
  await run.until(() => run.events.some(e => e.type === 'archive'));
  await run.until(() => fs.existsSync(path.join(run.output, 'thumbs')) && fs.readdirSync(path.join(run.output, 'thumbs')).length === 6);
  run.child.stdin.write('{"type":"focus","page":5}\n');
  await run.until(() => run.events.some(e => e.type === 'ready' && e.page === 5));
  assert.deepEqual(run.events.filter(e => e.type === 'error'), [], run.diagnostics());
  assert.doesNotMatch(run.diagnostics(), /GLib-CRITICAL|assertion .*failed/);
  run.child.stdin.end('{"type":"quit"}\n');
  await run.until(() => run.child.exitCode !== null);
  assert.equal(await run.exit, 0, run.diagnostics());
});


test('damaged background page announces only a real placeholder thumbnail', { timeout: 30000 }, async t => {
  const input = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-damaged-thumb-'));
  t.after(() => fs.rmSync(input, { recursive: true, force: true }));
  fs.writeFileSync(path.join(input, '0.bmp'), bmp());
  fs.writeFileSync(path.join(input, '1.jpg'), 'broken image');
  const run = start(t, 'worker', input, 'folder');
  await run.until(() => run.events.some(e => e.type === 'progress' && e.page === 1 && e.stage === 'thumb'));
  const event = run.events.find(e => e.type === 'progress' && e.page === 1 && e.stage === 'thumb');
  assert.equal(fs.readFileSync(path.join(run.output, event.file)).readUInt16BE(), 0xffd8);
  assert.ok(run.events.some(e => e.type === 'error' && e.page === 1));
  assert.ok(!run.events.some(e => e.type === 'ready' && e.page === 1), 'Background work must not claim the reader page is ready');
  run.child.stdin.write('{"type":"focus","page":1}\n');
  await run.until(() => run.events.some(e => e.type === 'ready' && e.page === 1));
  run.child.stdin.end('{"type":"quit"}\n');
  await run.until(() => run.child.exitCode !== null);
  assert.equal(await run.exit, 0, run.diagnostics());
});

test('Linux ACE cancellation reaps even a helper that ignores SIGTERM', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-ace-cancel-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const helper = path.join(dir, 'helper.py'), pidFile = path.join(dir, 'pid');
  fs.writeFileSync(helper, `#!/usr/bin/python3\nimport os,signal,time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\nopen(${JSON.stringify(pidFile)}, 'w').write(str(os.getpid()))\ntime.sleep(60)\n`, { mode: 0o755 });
  const previous = process.env.COMISCOPIO_ACE_HELPER_BINARY;
  process.env.COMISCOPIO_ACE_HELPER_BINARY = helper;
  let run;
  try { run = start(t, 'worker', path.join(root, '.cache/fixtures/abydos.cba'), 'ace'); }
  finally {
    if (previous === undefined) delete process.env.COMISCOPIO_ACE_HELPER_BINARY;
    else process.env.COMISCOPIO_ACE_HELPER_BINARY = previous;
  }
  await run.until(() => fs.existsSync(pidFile));
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  t.after(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} });
  run.child.stdin.end('{"type":"quit"}\n');
  run.child.kill('SIGTERM');
  const timer = setTimeout(() => run.child.kill('SIGKILL'), 1500);
  try {
    assert.equal(await run.exit, 1, run.diagnostics());
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  } finally { clearTimeout(timer); }
});


test('damaged document background page also gets a thumbnail placeholder', { timeout: 30000 }, async t => {
  const run = start(t, 'doc-worker', path.join(root, 'test/fixtures/doc/test-damaged-page.xps'));
  await run.until(() => run.events.some(e => e.type === 'progress' && e.page === 1 && e.stage === 'thumb'));
  const event = run.events.find(e => e.type === 'progress' && e.page === 1 && e.stage === 'thumb');
  assert.equal(fs.readFileSync(path.join(run.output, event.file)).readUInt16BE(), 0xffd8);
  assert.ok(run.events.some(e => e.type === 'error' && e.page === 1));
  run.child.stdin.write('{"type":"focus","page":1}\n');
  await run.until(() => run.events.some(e => e.type === 'ready' && e.page === 1));
  const ready = run.events.find(e => e.type === 'ready' && e.page === 1);
  assert.ok(fs.statSync(path.join(run.output, ready.pageFile)).size > 0);
  run.child.stdin.end('{"type":"quit"}\n');
  await run.until(() => run.child.exitCode !== null);
  assert.equal(await run.exit, 0, run.diagnostics());
});


for (const [extension, backend] of [['cbz', 'zip'], ['cbt', 'tar']]) {
  test(`Unicode ${extension} entries work under the minimal Linux C locale`, { skip: process.platform !== 'linux', timeout: 30000 }, async t => {
    const run = start(t, 'worker', path.join(root, `test/fixtures/archive/test-unicode-folder.${extension}`), backend, undefined, { LC_ALL: 'C', LANG: 'C' });
    await run.until(() => run.events.some(e => e.type === 'archive'));
    assert.equal(run.events.find(e => e.type === 'archive').totalPages, 5);
    run.child.stdin.write('{"type":"focus","page":4}\n');
    await run.until(() => run.events.some(e => e.type === 'ready' && e.page === 4));
    assert.deepEqual(run.events.filter(e => e.type === 'error'), [], run.diagnostics());
    run.child.stdin.end('{"type":"quit"}\n');
    await run.until(() => run.child.exitCode !== null);
    assert.equal(await run.exit, 0, run.diagnostics());
  });
}

for (const [key, value, message] of [
  ['COMISCOPIO_ACE_MAX_ENTRIES', '1', /limite de entradas/],
  ['COMISCOPIO_ACE_MAX_ENTRY_BYTES', '1', /limite por archivo/],
  ['COMISCOPIO_ACE_MAX_TOTAL_BYTES', '1', /limite total/],
  ['COMISCOPIO_ACE_MAX_ENTRIES', '0', /debe ser positivo/],
  ['COMISCOPIO_ACE_MAX_ENTRY_BYTES', '-1', /no valido/],
  ['COMISCOPIO_ACE_MAX_TOTAL_BYTES', '18446744073709551616', /no valido/],
]) {
  test(`ACE rejects ${key}=${value} before extracting`, { timeout: 10000 }, async t => {
    const run = start(t, 'worker', path.join(root, '.cache/fixtures/abydos.cba'), 'ace', undefined, { [key]: value });
    assert.equal(await run.exit, 1, run.diagnostics());
    assert.ok(run.events.some(e => e.type === 'error' && message.test(e.message)), JSON.stringify(run.events));
    assert.ok(!run.events.some(e => e.type === 'ready' || e.type === 'archive'));
    assert.ok(!fs.existsSync(path.join(run.output, '.ace-work')));
    const raw = path.join(run.output, 'raw');
    assert.ok(!fs.existsSync(raw) || fs.readdirSync(raw).length === 0);
  });
}

function unaceBinary() {
  return process.env.COMISCOPIO_NATIVE_DIR
    ? path.resolve(process.env.COMISCOPIO_NATIVE_DIR, 'bin', `comiscopio-unace${extension}`)
    : path.join(root, 'native/ace-helper/build', `comiscopio-unace${extension}`);
}

test('ACE accepts exact declared entry/total boundaries with its real decoder', { timeout: 10000 }, async t => {
  const input = path.join(root, '.cache/fixtures/abydos.cba');
  // The private POSIX decoder takes a relative path here; the helper translates
  // absolute Windows paths, exercised by normal ACE opening tests.
  const listing = spawnSync(unaceBinary(), ['v', '-y', '-c-', path.basename(input)], {
    cwd: path.dirname(input),
    env: { ...process.env, COMISCOPIO_UNACE_LIST_PREFIX: 'COMISCOPIO_FILE\t' }, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(listing.status, 0, listing.stderr);
  const sizes = listing.stdout.split('\n').filter(line => line.startsWith('COMISCOPIO_FILE\t'))
    .map(line => Number(line.split('\t')[1]));
  assert.equal(sizes.length, 2);
  const run = start(t, 'worker', input, 'ace', undefined, {
    COMISCOPIO_ACE_MAX_ENTRIES: '2',
    COMISCOPIO_ACE_MAX_ENTRY_BYTES: String(Math.max(...sizes)),
    COMISCOPIO_ACE_MAX_TOTAL_BYTES: String(sizes.reduce((sum, n) => sum + n, 0)),
  });
  await run.until(() => run.events.some(e => e.type === 'archive'));
  run.child.stdin.write('{"type":"focus","page":1}\n');
  await run.until(() => run.events.some(e => e.type === 'ready' && e.page === 1));
  assert.deepEqual(run.events.filter(e => e.type === 'error'), []);
  run.child.stdin.end('{"type":"quit"}\n');
  assert.equal(await run.exit, 0, run.diagnostics());
});

test('ACE opens absolute Unicode paths with spaces, including its output directory', { timeout: 30000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-ace-path-'));
  const folder = path.join(dir, 'Capítulo 日本');
  fs.mkdirSync(folder);
  const input = path.join(folder, 'Libro 日本.cba');
  fs.copyFileSync(path.join(root, '.cache/fixtures/abydos.cba'), input);
  const run = start(t, 'worker', input, 'ace', path.join(folder, 'salida de prueba'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await run.until(() => run.events.some(e => e.type === 'archive'));
  assert.equal(run.events.find(e => e.type === 'archive').totalPages, 2);
  run.child.stdin.write('{"type":"focus","page":1}\n');
  await run.until(() => run.events.some(e => e.type === 'ready' && e.page === 1));
  assert.deepEqual(run.events.filter(e => e.type === 'error'), [], run.diagnostics());
  run.child.stdin.end('{"type":"quit"}\n');
  assert.equal(await run.exit, 0, run.diagnostics());
});

// Synthetic decoder responses exercise limits without allocating GiB or using
// third-party hostile archives. The real decoder's write guard is tested below.
function fakeAceDecoder(t, listingBody, extractionBody = "raise RuntimeError('Extraction must not run')") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-ace-limits-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const decoder = path.join(dir, 'decoder.py');
  fs.writeFileSync(decoder, `#!/usr/bin/python3\nimport sys,os,pathlib\nmarker=pathlib.Path(${JSON.stringify(path.join(dir, 'extracted'))})\nif sys.argv[1]=='v':\n${listingBody.split('\n').map(line => ' '+line).join('\n')}\nelse:\n marker.write_text('yes')\n${extractionBody.split('\n').map(line => ' '+line).join('\n')}\n`, { mode: 0o755 });
  return { dir, decoder };
}

for (const [name, body, message] of [
  ['directory count', "for i in range(10001): print('COMISCOPIO_FILE\\t0\\t1\\t'+('dir'+str(i)).encode().hex())", /limite de entradas/],
  ['entry bytes', "print('COMISCOPIO_FILE\\t536870913\\t0\\t'+b'page.jpg'.hex())", /limite por archivo/],
  ['total including non-images', "for i in range(17): print('COMISCOPIO_FILE\\t536870912\\t0\\t'+('data'+str(i)+'.txt').encode().hex())", /limite total/],
  ['uint64 overflow', "print('COMISCOPIO_FILE\\t18446744073709551616\\t0\\t'+b'page.jpg'.hex())", /no valido/],
  ['malformed name encoding', "print('COMISCOPIO_FILE\\t10\\t0\\tzz')", /no valido/],
  ['unbounded decoder output', "sys.stdout.write('x' * (9 * 1024 * 1024))", /limite de salida/],
]) {
  test(`ACE helper bounds ${name}`, { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
    const fake = fakeAceDecoder(t, body);
    const run = start(t, 'worker', path.join(root, '.cache/fixtures/abydos.cba'), 'ace', undefined,
      { COMISCOPIO_UNACE_BINARY: fake.decoder });
    assert.equal(await run.exit, 1, run.diagnostics());
    assert.ok(run.events.some(e => e.type === 'error' && message.test(e.message)), JSON.stringify(run.events));
    assert.ok(!fs.existsSync(path.join(fake.dir, 'extracted')), 'Rejected metadata must never start extraction');
    assert.ok(!fs.existsSync(path.join(run.output, '.ace-work')));
    assert.deepEqual(fs.readdirSync(path.join(run.output, 'raw')), []);
  });
}

test('ACE real decoder stops before writing past a falsely declared size', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  const fake = fakeAceDecoder(t, "print('COMISCOPIO_FILE\\t1\\t0\\t'+b'001.jpg'.hex())",
    `os.execv(${JSON.stringify(unaceBinary())}, [${JSON.stringify(unaceBinary())}] + sys.argv[1:])`);
  const run = start(t, 'worker', path.join(root, '.cache/fixtures/abydos.cba'), 'ace', undefined,
    { COMISCOPIO_UNACE_BINARY: fake.decoder });
  assert.equal(await run.exit, 1, run.diagnostics());
  assert.ok(fs.existsSync(path.join(fake.dir, 'extracted')));
  assert.ok(run.events.some(e => e.type === 'error' && /presupuesto de escritura/.test(e.message)), JSON.stringify(run.events));
  assert.deepEqual(fs.readdirSync(path.join(run.output, 'raw')), []);
  assert.ok(!fs.existsSync(path.join(run.output, '.ace-work')));
});

test('ACE cleans earlier pages and work files when a later write exceeds its budget', { skip: process.platform !== 'linux', timeout: 10000 }, async t => {
  const fake = fakeAceDecoder(t, "for name in ['1.jpg','2.jpg']: print('COMISCOPIO_FILE\\t4\\t0\\t'+name.encode().hex())",
    "target=pathlib.Path(sys.argv[6]); target.mkdir(parents=True,exist_ok=True)\n(target/'page.jpg').write_bytes(b'1234' if sys.argv[7]=='1.jpg' else b'12345')");
  const run = start(t, 'worker', path.join(root, '.cache/fixtures/abydos.cba'), 'ace', undefined,
    { COMISCOPIO_UNACE_BINARY: fake.decoder });
  assert.equal(await run.exit, 1, run.diagnostics());
  assert.ok(run.events.some(e => e.type === 'error' && /presupuesto de escritura/.test(e.message)), JSON.stringify(run.events));
  assert.deepEqual(fs.readdirSync(path.join(run.output, 'raw')), []);
  assert.ok(!fs.existsSync(path.join(run.output, '.ace-work')));
});
