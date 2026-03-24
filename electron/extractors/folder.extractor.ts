import * as fs from 'fs';
import * as path from 'path';
import { Extractor } from './extractor.interface';
import { IMAGE_EXTENSIONS } from '../../shared/constants';

/**
 * "Extractor" for image folders.
 * Instead of extracting, creates symlinks (or copies on Windows)
 * from the source folder to the temp directory.
 * This avoids duplicating files while keeping the same interface.
 */
export class FolderExtractor implements Extractor {
  async extract(sourcePath: string, targetDir: string): Promise<void> {
    const entries = this.walkDir(sourcePath);
    const images = entries.filter((f) =>
      IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()),
    );

    if (images.length === 0) {
      throw new Error('No se encontraron imágenes en la carpeta');
    }

    for (const imgPath of images) {
      const relativePath = path.relative(sourcePath, imgPath);
      const targetPath = path.join(targetDir, relativePath);

      // Ensure subdirectory structure exists
      const targetSubDir = path.dirname(targetPath);
      if (!fs.existsSync(targetSubDir)) {
        fs.mkdirSync(targetSubDir, { recursive: true });
      }

      // Use symlinks on Linux, copy on Windows (symlinks need admin)
      if (process.platform === 'win32') {
        fs.copyFileSync(imgPath, targetPath);
      } else {
        fs.symlinkSync(imgPath, targetPath);
      }
    }
  }

  private walkDir(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.walkDir(fullPath));
      } else {
        results.push(fullPath);
      }
    }
    return results;
  }
}
