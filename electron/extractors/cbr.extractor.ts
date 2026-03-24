import * as fs from 'fs';
import * as path from 'path';
import { Extractor } from './extractor.interface';
import { SystemExtractor } from './system.extractor';

/**
 * CBR/RAR extractor with fallback chain:
 * 1. node-unrar-js (WASM, portable, supports RAR5)
 * 2. 7z bundled via 7zip-bin + node-7z
 * 3. system `unrar` command
 * 4. Error with descriptive message
 */
export class CbrExtractor implements Extractor {
  async extract(sourcePath: string, targetDir: string): Promise<void> {
    const errors: string[] = [];

    // Attempt 1: node-unrar-js (pure WASM — fully portable)
    try {
      await this.extractWithUnrarJs(sourcePath, targetDir);
      return;
    } catch (err: any) {
      errors.push(`unrar-js: ${err.message || err}`);
    }

    // Attempt 2: bundled 7z via node-7z (handles RAR including RAR5)
    try {
      await SystemExtractor.extractWith7z(sourcePath, targetDir);
      return;
    } catch (err: any) {
      errors.push(`7z: ${err.message || err}`);
    }

    // Attempt 3: system unrar
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
      `No se pudo extraer el archivo RAR. Intentos fallidos:\n${errors.join('\n')}`,
    );
  }

  private async extractWithUnrarJs(sourcePath: string, targetDir: string): Promise<void> {
    const { createExtractorFromFile } = require('node-unrar-js');

    const extractor = await createExtractorFromFile({
      filepath: sourcePath,
      targetPath: targetDir,
    });

    const { files } = extractor.extract();

    // Consume the generator to actually extract
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _file of files) {
      // extraction happens on iteration
    }
  }
}
