import * as fs from 'fs';
import * as path from 'path';
import { parentPort } from 'worker_threads';
import { FileDescriptor } from './file-handler';
import { CbzExtractor } from './extractors/cbz.extractor';
import { CbrExtractor } from './extractors/cbr.extractor';
import { Cb7Extractor } from './extractors/cb7.extractor';
import { PdfExtractor } from './extractors/pdf.extractor';
import { FolderExtractor } from './extractors/folder.extractor';
import { Extractor } from './extractors/extractor.interface';
import { IMAGE_EXTENSIONS } from '../shared/constants';
import type { FileInfo, ArchiveFormat, OpenFileStage } from '../shared/models';
import { SystemExtractor } from './extractors/system.extractor';

interface StartMessage {
  kind: 'start';
  sessionId: number;
  descriptor: FileDescriptor;
  tempDir: string;
}

interface CancelMessage {
  kind: 'cancel';
}

type WorkerMessage = StartMessage | CancelMessage;

let cancelled = false;

function postProgress(sessionId: number, stage: OpenFileStage, message: string): void {
  parentPort?.postMessage({ kind: 'progress', sessionId, stage, message });
}

function ensureNotCancelled(): void {
  if (cancelled) {
    throw new Error('OPEN_CANCELLED');
  }
}

function getExtractor(format: ArchiveFormat): Extractor {
  switch (format) {
    case 'cbz':
      return new CbzExtractor();
    case 'cbr':
      return new CbrExtractor();
    case 'cb7':
      return new Cb7Extractor();
    case 'pdf':
      return new PdfExtractor();
    case 'folder':
      return new FolderExtractor();
    default:
      throw new Error(`Extractor no implementado para formato: ${format}`);
  }
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function walkDir(dir: string, results: string[] = []): string[] {
  ensureNotCancelled();
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    ensureNotCancelled();
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, results);
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function indexPages(dir: string): string[] {
  ensureNotCancelled();
  return walkDir(dir)
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort((a, b) => naturalCompare(path.basename(a), path.basename(b)));
}

async function runOpenSession(message: StartMessage): Promise<void> {
  const { descriptor, tempDir, sessionId } = message;
  const { filePath, fileHash, fileName, format, isDirectory } = descriptor;
  const startedAt = performance.now();

  postProgress(sessionId, 'preparing', `Preparando ${fileName}...`);
  ensureNotCancelled();

  const extractor = getExtractor(format);
  const extractStartedAt = performance.now();

  postProgress(sessionId, 'extracting', isDirectory ? 'Preparando carpeta...' : 'Extrayendo archivo...');
  await extractor.extract(filePath, tempDir);
  ensureNotCancelled();
  const extractMs = performance.now() - extractStartedAt;

  const indexStartedAt = performance.now();
  postProgress(sessionId, 'indexing', 'Indexando paginas...');
  const pageFiles = indexPages(isDirectory ? filePath : tempDir);
  ensureNotCancelled();
  const indexMs = performance.now() - indexStartedAt;

  if (pageFiles.length === 0) {
    throw new Error('No se encontraron imágenes en el archivo');
  }

  const info: FileInfo = {
    filePath,
    fileHash,
    fileName,
    format,
    totalPages: pageFiles.length,
  };

  postProgress(sessionId, 'ready', 'Primera pagina lista');
  parentPort?.postMessage({
    kind: 'complete',
    sessionId,
    info,
    tempDir,
    pageFiles,
    timings: {
      totalMs: performance.now() - startedAt,
      extractMs,
      indexMs,
    },
  });
}

parentPort?.on('message', async (message: WorkerMessage) => {
  if (message.kind === 'cancel') {
    cancelled = true;
    SystemExtractor.cancelAll();
    return;
  }

  cancelled = false;

  try {
    await runOpenSession(message);
  } catch (err: any) {
    if (cancelled || err?.message === 'OPEN_CANCELLED') {
      parentPort?.postMessage({ kind: 'cancelled', sessionId: message.sessionId });
      return;
    }

    parentPort?.postMessage({
      kind: 'error',
      sessionId: message.sessionId,
      message: err?.message || 'Error al abrir el archivo',
    });
  }
});
