import * as fs from 'fs';
import * as path from 'path';
import { getTempDir } from '../shared/constants';

/**
 * Manages temporary directories for extracted comic files.
 * Each opened file gets its own subdirectory keyed by fileHash.
 */
export class TempManager {
  private baseTempDir: string;
  private activeDirs = new Set<string>();

  constructor() {
    this.baseTempDir = getTempDir();
    this.ensureBaseDir();
  }

  private ensureBaseDir(): void {
    if (!fs.existsSync(this.baseTempDir)) {
      fs.mkdirSync(this.baseTempDir, { recursive: true });
    }
  }

  /** Create a temp directory for a file and return its path */
  create(fileHash: string): string {
    const dir = path.join(this.baseTempDir, fileHash);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.activeDirs.add(dir);
    return dir;
  }

  /** Get the temp directory path for a file hash */
  getPath(fileHash: string): string {
    return path.join(this.baseTempDir, fileHash);
  }

  /** Cleanup a specific file's temp directory */
  cleanup(fileHash: string): void {
    const dir = path.join(this.baseTempDir, fileHash);
    this.removeDirSync(dir);
    this.activeDirs.delete(dir);
  }

  /** Cleanup all active temp directories */
  cleanupAll(): void {
    for (const dir of this.activeDirs) {
      this.removeDirSync(dir);
    }
    this.activeDirs.clear();
  }

  /** Remove orphaned temp dirs from previous sessions that weren't cleaned up */
  cleanupOrphans(): void {
    this.ensureBaseDir();
    try {
      const entries = fs.readdirSync(this.baseTempDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dir = path.join(this.baseTempDir, entry.name);
          if (!this.activeDirs.has(dir)) {
            this.removeDirSync(dir);
          }
        }
      }
    } catch {
      // Temp dir might not exist yet — that's fine
    }
  }

  private removeDirSync(dir: string): void {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (err) {
      console.error(`Failed to remove temp dir ${dir}:`, err);
    }
  }
}
