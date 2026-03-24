import { Extractor } from './extractor.interface';
import { SystemExtractor } from './system.extractor';

/**
 * CBR/RAR extractor with fallback chain:
 * 1. node-7z (uses system 7z binary, which can extract RAR)
 * 2. system `unrar` command
 * 3. Error with descriptive message
 */
export class CbrExtractor implements Extractor {
  async extract(sourcePath: string, targetDir: string): Promise<void> {
    const errors: string[] = [];

    // Attempt 1: node-7z (uses system 7z, which handles RAR including RAR5)
    try {
      await SystemExtractor.extractWith7z(sourcePath, targetDir);
      return;
    } catch (err: any) {
      errors.push(`7z: ${err.message || err}`);
    }

    // Attempt 2: system unrar
    try {
      await SystemExtractor.extractWithCommand(
        'unrar',
        ['x', '-o+', '-inul', sourcePath, targetDir + '/'],
      );
      return;
    } catch (err: any) {
      errors.push(`unrar: ${err.message || err}`);
    }

    throw new Error(
      `No se pudo extraer el archivo RAR. Intentos fallidos:\n${errors.join('\n')}\n\n` +
      'Instala 7z o unrar en tu sistema para soporte RAR.',
    );
  }
}
