import * as fs from 'fs';
import * as path from 'path';
import { Extractor } from './extractor.interface';
import { SystemExtractor } from './system.extractor';

/**
 * PDF extractor with fallback chain:
 * 1. pdfjs-dist + canvas (npm) — if canvas module is installed
 * 2. system `pdftoppm` (poppler-utils) — renders PDF pages to PNG
 * 3. system `mutool` (mupdf-tools) — alternative renderer
 * 4. Error with descriptive message
 *
 * Note: For fully portable PDF without native deps, render in the
 * Electron renderer process using pdfjs-dist + Chromium <canvas>.
 * That's a future improvement tracked separately.
 */
export class PdfExtractor implements Extractor {
  async extract(sourcePath: string, targetDir: string): Promise<void> {
    const errors: string[] = [];

    // Attempt 1: pdfjs-dist + canvas npm module
    try {
      await this.extractWithPdfJs(sourcePath, targetDir);
      return;
    } catch (err: any) {
      errors.push(`pdfjs+canvas: ${err.message || err}`);
    }

    // Attempt 2: pdftoppm (poppler-utils) — common on Linux
    try {
      await SystemExtractor.extractWithCommand(
        'pdftoppm',
        ['-png', '-r', '200', sourcePath, path.join(targetDir, 'page')],
      );
      return;
    } catch (err: any) {
      errors.push(`pdftoppm: ${err.message || err}`);
    }

    // Attempt 3: mutool (mupdf-tools)
    try {
      await SystemExtractor.extractWithCommand(
        'mutool',
        ['convert', '-F', 'png', '-O', 'resolution=200', '-o', path.join(targetDir, 'page_%04d.png'), sourcePath],
      );
      return;
    } catch (err: any) {
      errors.push(`mutool: ${err.message || err}`);
    }

    throw new Error(
      `No se pudo extraer el PDF. Intentos fallidos:\n${errors.join('\n')}\n\n` +
      'Instala una de estas opciones:\n' +
      '- npm install canvas (recomendado)\n' +
      '- poppler-utils (pdftoppm)\n' +
      '- mupdf-tools (mutool)',
    );
  }

  private async extractWithPdfJs(sourcePath: string, targetDir: string): Promise<void> {
    let createCanvas: any;
    try {
      createCanvas = require('canvas').createCanvas;
    } catch {
      throw new Error('Módulo "canvas" no instalado');
    }

    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

    const data = new Uint8Array(fs.readFileSync(sourcePath));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const numPages = doc.numPages;
    const padLen = String(numPages).length;

    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });

      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      await page.render({ canvasContext: context, viewport }).promise;

      const pageNum = String(i).padStart(padLen, '0');
      const outPath = path.join(targetDir, `page_${pageNum}.png`);
      fs.writeFileSync(outPath, canvas.toBuffer('image/png'));

      page.cleanup();
    }

    doc.destroy();
  }
}
