import BetterSqlite3 from 'better-sqlite3';
import { AppSettings, DEFAULT_SETTINGS } from '../../shared/models';

export class SettingsRepo {
  constructor(private db: BetterSqlite3.Database) {}

  getAll(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM app_settings').all() as any[];

    const settings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (row.key in settings) {
        const defaultVal = (settings as any)[row.key];
        if (typeof defaultVal === 'number') {
          (settings as any)[row.key] = Number(row.value);
        } else {
          (settings as any)[row.key] = row.value;
        }
      }
    }
    return settings;
  }

  saveAll(settings: Partial<AppSettings>): void {
    const upsert = this.db.prepare(
      'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
    );

    const saveMany = this.db.transaction((entries: [string, string][]) => {
      for (const [key, value] of entries) {
        upsert.run(key, value, value);
      }
    });

    const entries = Object.entries(settings).map(([k, v]) => [k, String(v)] as [string, string]);
    saveMany(entries);
  }

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
      .run(key, value, value);
  }
}
