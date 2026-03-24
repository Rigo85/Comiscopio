import { execFile } from 'child_process';

/**
 * Shared utilities for extractors that rely on system binaries.
 */
export class SystemExtractor {
  /**
   * Extract using node-7z (wrapper for system 7z binary).
   * Works for ZIP, RAR, 7z, and many other formats.
   */
  static async extractWith7z(sourcePath: string, targetDir: string): Promise<void> {
    const Seven = require('node-7z');

    return new Promise<void>((resolve, reject) => {
      const stream = Seven.extractFull(sourcePath, targetDir, {
        $progress: false,
        recursive: true,
      });

      stream.on('end', () => resolve());
      stream.on('error', (err: Error) => reject(err));
    });
  }

  /**
   * Extract using an arbitrary system command.
   * Used as fallback when node libraries fail.
   */
  static async extractWithCommand(command: string, args: string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      execFile(command, args, { maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
        if (error) {
          // Check if the command exists
          if ((error as any).code === 'ENOENT') {
            reject(new Error(`Comando '${command}' no encontrado en el sistema`));
          } else {
            reject(new Error(stderr || error.message));
          }
        } else {
          resolve();
        }
      });
    });
  }
}
