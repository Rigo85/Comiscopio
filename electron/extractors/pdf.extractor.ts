import * as fs from 'fs';
import * as path from 'path';
import { Extractor } from './extractor.interface';

/**
 * PDF extractor using pdfjs-dist.
 * Renders each page to a PNG image in the target directory.
 * Uses Node.js canvas (OffscreenCanvas not available in main process).
 */
export class PdfExtractor implements Extractor {
  async extract(sourcePath: string, targetDir: string): Promise<void> {
    // pdfjs-dist for Node.js
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

    const data = new Uint8Array(fs.readFileSync(sourcePath));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    const numPages = doc.numPages;

    // Pad page numbers for correct natural sort (001, 002, ...)
    const padLen = String(numPages).length;

    for (let i = 1; i <= numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 }); // 2x for good quality

      // Create a minimal canvas-like object for pdfjs
      // pdfjs-dist/legacy supports a custom canvas factory
      const { createCanvas } = await this.getCanvasModule();
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');

      await page.render({
        canvasContext: context,
        viewport,
      }).promise;

      const pageNum = String(i).padStart(padLen, '0');
      const outPath = path.join(targetDir, `page_${pageNum}.png`);
      const buffer = canvas.toBuffer('image/png');
      fs.writeFileSync(outPath, buffer);

      // Free memory
      page.cleanup();
    }

    doc.destroy();
  }

  private async getCanvasModule(): Promise<any> {
    try {
      return require('canvas');
    } catch {
      throw new Error(
        'No se pudo cargar el módulo "canvas" necesario para PDF.\n' +
        'Instálalo con: npm install canvas',
      );
    }
  }
}
