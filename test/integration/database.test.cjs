// Run using Electron's Node ABI, as better-sqlite3 is rebuilt for Electron.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Sqlite = require('better-sqlite3');
const { Database } = require('../../dist-electron/electron/db/database');

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-db-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('progress, bookmarks and keyboard overrides survive closing and reopening', t => {
  const dir = temporary(t);
  const first = new Database(dir);
  first.initialize();
  first.settingsRepo.saveAll({ keybindings: '{"next-page":"n"}', slidingWindowSize: 7 });
  first.readingProgressRepo.save({ fileHash: 'book', filePath: '/book.cbz', currentPage: 3, totalPages: 20, lastRead: new Date().toISOString() });
  first.bookmarksRepo.add({ fileHash: 'book', page: 3, name: 'test', createdAt: new Date().toISOString() });
  first.close();
  const next = new Database(dir);
  try {
    next.initialize();
    assert.equal(next.settingsRepo.getAll().keybindings, '{"next-page":"n"}');
    assert.equal(next.settingsRepo.getAll().slidingWindowSize, 7);
    assert.equal(next.readingProgressRepo.get('book').currentPage, 3);
    assert.equal(next.bookmarksRepo.getForFile('book')[0].page, 3);
  } finally { next.close(); }
});

test('an unreadable database is preserved rather than replaced', t => {
  const dir = temporary(t);
  const file = path.join(dir, 'comiscopio.db');
  const original = Buffer.from('not a sqlite database; preserve for recovery');
  fs.writeFileSync(file, original);
  const db = new Database(dir);
  assert.throws(() => db.initialize());
  db.close();
  assert.deepEqual(fs.readFileSync(file), original);
});

test('a database locked by another connection is never deleted', t => {
  const dir = temporary(t);
  const file = path.join(dir, 'comiscopio.db');
  const owner = new Sqlite(file);
  owner.exec('CREATE TABLE original(value TEXT); INSERT INTO original VALUES (\'keep me\'); BEGIN EXCLUSIVE;');
  const before = fs.readFileSync(file);
  try {
    const contender = new Database(dir);
    assert.throws(() => contender.initialize(), /locked/);
    contender.close();
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(owner.prepare('SELECT value FROM original').get().value, 'keep me');
  } finally { owner.exec('ROLLBACK'); owner.close(); }
});
