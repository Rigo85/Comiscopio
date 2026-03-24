import { Extractor } from './extractor.interface';
import { SystemExtractor } from './system.extractor';

/**
 * CB7/7z extractor with fallback chain:
 * 1. node-7z (uses system 7z binary)
 * 2. system `7z` command directly
 * 3. Error with descriptive message
 */
export class Cb7Extractor implements Extractor {
  async extract(sourcePath: string, targetDir: string): Promise<void> {
    const errors: string[] = [];

    // Attempt 1: node-7z
    try {
      await SystemExtractor.extractWith7z(sourcePath, targetDir);
      return;
    } catch (err: any) {
      errors.push(`node-7z: ${err.message || err}`);
    }

    // Attempt 2: direct 7z command
    try {
      await SystemExtractor.extractWithCommand(
        '7z',
        ['x', `-o${targetDir}`, '-y', sourcePath],
      );
      return;
    } catch (err: any) {
      errors.push(`7z cmd: ${err.message || err}`);
    }

    throw new Error(
      `No se pudo extraer el archivo 7z. Intentos fallidos:\n${errors.join('\n')}\n\n` +
      'Instala 7z (p7zip-full) en tu sistema para soporte 7z.',
    );
  }
}
