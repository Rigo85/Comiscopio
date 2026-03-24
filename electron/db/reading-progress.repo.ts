import BetterSqlite3 from 'better-sqlite3';
import { ReadingProgress, RecentFile } from '../../shared/models';

export class ReadingProgressRepo {
  constructor(private db: BetterSqlite3.Database) {}

  save(progress: ReadingProgress): void {
    this.db
      .prepare(
        `INSERT INTO reading_progress (file_hash, file_path, file_name, current_page, total_pages, last_read)
         VALUES (@fileHash, @filePath, @fileName, @currentPage, @totalPages, @lastRead)
         ON CONFLICT(file_hash) DO UPDATE SET
           file_path = @filePath,
           current_page = @currentPage,
           total_pages = @totalPages,
           last_read = @lastRead`,
      )
      .run({
        fileHash: progress.fileHash,
        filePath: progress.filePath,
        fileName: progress.filePath.split(/[\\/]/).pop() || '',
        currentPage: progress.currentPage,
        totalPages: progress.totalPages,
        lastRead: progress.lastRead || new Date().toISOString(),
      });
  }

  get(fileHash: string): ReadingProgress | null {
    const row = this.db
      .prepare('SELECT * FROM reading_progress WHERE file_hash = ?')
      .get(fileHash) as any;

    if (!row) return null;

    return {
      fileHash: row.file_hash,
      filePath: row.file_path,
      currentPage: row.current_page,
      totalPages: row.total_pages,
      lastRead: row.last_read,
    };
  }

  getRecent(limit: number): RecentFile[] {
    const rows = this.db
      .prepare('SELECT * FROM reading_progress ORDER BY last_read DESC LIMIT ?')
      .all(limit) as any[];

    return rows.map((row) => ({
      filePath: row.file_path,
      fileName: row.file_name || row.file_path.split(/[\\/]/).pop() || '',
      fileHash: row.file_hash,
      lastRead: row.last_read,
      currentPage: row.current_page,
      totalPages: row.total_pages,
    }));
  }
}
