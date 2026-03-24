import { Extractor } from './extractor.interface';

/**
 * CBZ/ZIP extractor using adm-zip.
 */
export class CbzExtractor implements Extractor {
  async extract(sourcePath: string, targetDir: string): Promise<void> {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(sourcePath);
    zip.extractAllTo(targetDir, true);
  }
}
