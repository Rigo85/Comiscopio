import { ChildProcess, execFile } from 'child_process';

/**
 * Shared utilities for extractors that rely on 7z binary.
 * Uses bundled 7zip-bin first (portable), falls back to system binary.
 */
export class SystemExtractor {
  private static activeChildren = new Set<ChildProcess>();

  /**
   * Get the path to the 7za binary.
   * Priority: bundled (7zip-bin) → system 7z.
   */
  static get7zBinPath(): string {
    try {
      const { path7za } = require('7zip-bin');
      return path7za;
    } catch {
      return '7z'; // fallback to system
    }
  }

  /**
   * Extract using node-7z with bundled 7za binary.
   * Works for ZIP, RAR, 7z, and many other formats.
   */
  static async extractWith7z(sourcePath: string, targetDir: string): Promise<void> {
    const Seven = require('node-7z');
    const binPath = this.get7zBinPath();

    return new Promise<void>((resolve, reject) => {
      const stream = Seven.extractFull(sourcePath, targetDir, {
        $bin: binPath,
        $progress: false,
        recursive: true,
      });

      const child = (stream as any).childProcess as ChildProcess | undefined;
      if (child) {
        this.activeChildren.add(child);
        const cleanup = () => this.activeChildren.delete(child);
        child.once('exit', cleanup);
        child.once('error', cleanup);
      }

      stream.on('end', () => resolve());
      stream.on('error', (err: Error) => reject(err));
    });
  }

  /**
   * Extract using an arbitrary system command.
   * Used as fallback when bundled tools fail.
   */
  static async extractWithCommand(command: string, args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
        this.activeChildren.delete(child);
        if (error) {
          if ((error as any).code === 'ENOENT') {
            reject(new Error(`Comando '${command}' no encontrado en el sistema`));
          } else {
            reject(new Error(stderr || error.message));
          }
        } else {
          resolve();
        }
      });

      this.activeChildren.add(child);
    });
  }

  static cancelAll(): void {
    for (const child of this.activeChildren) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore process cleanup failures during cancellation
      }
    }
    this.activeChildren.clear();
  }
}
