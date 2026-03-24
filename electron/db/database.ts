import * as fs from 'fs';
import * as path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import { getConfigDir } from '../../shared/constants';
import { ReadingProgressRepo } from './reading-progress.repo';
import { SettingsRepo } from './settings.repo';
import { BookmarksRepo } from './bookmarks.repo';

/**
 * SQLite database manager.
 * Stores data in ~/.comiscopio/comiscopio.db
 * Resilient to deletion — recreates if missing.
 */
export class Database {
  private db!: BetterSqlite3.Database;
  private configDir: string;

  readingProgressRepo!: ReadingProgressRepo;
  settingsRepo!: SettingsRepo;
  bookmarksRepo!: BookmarksRepo;

  constructor() {
    this.configDir = getConfigDir();
  }

  initialize(): void {
    this.ensureConfigDir();
    const dbPath = path.join(this.configDir, 'comiscopio.db');

    try {
      this.db = new BetterSqlite3(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.createTables();
      // Quick integrity check
      this.db.pragma('integrity_check');
    } catch (err) {
      console.error('Database corrupted or inaccessible, recreating:', err);
      try { this.db?.close(); } catch { /* ignore */ }
      // Remove corrupted DB and recreate
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
      try { fs.unlinkSync(dbPath + '-wal'); } catch { /* ignore */ }
      try { fs.unlinkSync(dbPath + '-shm'); } catch { /* ignore */ }
      this.db = new BetterSqlite3(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.createTables();
    }

    this.initRepos();
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reading_progress (
        file_hash TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL DEFAULT '',
        current_page INTEGER NOT NULL DEFAULT 0,
        total_pages INTEGER NOT NULL DEFAULT 0,
        last_read TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bookmarks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_hash TEXT NOT NULL,
        page INTEGER NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(file_hash, page)
      );

      CREATE INDEX IF NOT EXISTS idx_bookmarks_file_hash ON bookmarks(file_hash);
      CREATE INDEX IF NOT EXISTS idx_reading_progress_last_read ON reading_progress(last_read DESC);
    `);
  }

  private initRepos(): void {
    this.readingProgressRepo = new ReadingProgressRepo(this.db);
    this.settingsRepo = new SettingsRepo(this.db);
    this.bookmarksRepo = new BookmarksRepo(this.db);
  }
}
