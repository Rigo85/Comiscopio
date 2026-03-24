import BetterSqlite3 from 'better-sqlite3';
import { Bookmark } from '../../shared/models';

export class BookmarksRepo {
  constructor(private db: BetterSqlite3.Database) {}

  add(bookmark: Bookmark): void {
    this.db
      .prepare(
        `INSERT INTO bookmarks (file_hash, page, name, created_at)
         VALUES (@fileHash, @page, @name, @createdAt)
         ON CONFLICT(file_hash, page) DO UPDATE SET name = @name`,
      )
      .run({
        fileHash: bookmark.fileHash,
        page: bookmark.page,
        name: bookmark.name,
        createdAt: bookmark.createdAt || new Date().toISOString(),
      });
  }

  getForFile(fileHash: string): Bookmark[] {
    const rows = this.db
      .prepare('SELECT * FROM bookmarks WHERE file_hash = ? ORDER BY page ASC')
      .all(fileHash) as any[];

    return rows.map((row) => ({
      id: row.id,
      fileHash: row.file_hash,
      page: row.page,
      name: row.name,
      createdAt: row.created_at,
    }));
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
  }

  removeForFile(fileHash: string): void {
    this.db.prepare('DELETE FROM bookmarks WHERE file_hash = ?').run(fileHash);
  }
}
