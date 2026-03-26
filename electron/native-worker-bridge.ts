import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { getTempDir } from '../shared/constants';
import { app } from 'electron';

/** Events emitted by the worker, parsed from JSON-lines stdout */
export interface WorkerEvent {
  type: 'archive' | 'extracting' | 'ready' | 'progress' | 'error' | 'done';
  [key: string]: any;
}

export interface WorkerSession {
  fileHash: string;
  filePath: string;
  outputDir: string;
  process: ChildProcess | null;
  totalPages: number;
  manifest: any | null;
  ready: boolean;      // true after "archive" event (extraction done)
  cancelled: boolean;
}

type EventListener = (event: WorkerEvent) => void;
type ArtifactVariant = 'optimized' | 'original';

/**
 * Orchestrates the native comiscopio-worker process.
 *
 * Lifecycle:
 * 1. startSession() → spawns worker, extraction begins
 * 2. Worker emits "extracting" events → forwarded to listener
 * 3. Worker emits "archive" → extraction done, ready for focus
 * 4. focus(page) → sends focus command to worker stdin
 * 5. Worker emits "ready" → page artifacts available on disk
 * 6. closeSession() → SIGTERM + cleanup
 */
export class NativeWorkerBridge {
  private sessions = new Map<string, WorkerSession>();

  /** Get path to the native worker binary */
  private getWorkerBinaryPath(): string {
    const executable = process.platform === 'win32' ? 'comiscopio-worker.exe' : 'comiscopio-worker';
    if (app.isPackaged) {
      // In packaged app: look in extraResources or alongside the app
      const candidates = [
        path.join(process.resourcesPath, 'native', executable),
        path.join(path.dirname(app.getPath('exe')), 'native', executable),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    }
    // Dev mode: build directory
    const devCandidates = [
      path.join(__dirname, '..', '..', 'native', 'worker', 'build', executable),
      path.join(__dirname, '..', '..', 'native', 'worker', 'build-debug', executable),
    ];
    for (const p of devCandidates) {
      if (fs.existsSync(p)) return p;
    }

    throw new Error('comiscopio-worker binary not found');
  }

  private getWorkerEnv(binaryPath: string): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const libDirs = new Set<string>();

    if (app.isPackaged) {
      libDirs.add(path.join(process.resourcesPath, 'native', 'lib'));
      libDirs.add(path.join(path.dirname(app.getPath('exe')), 'native', 'lib'));
    } else {
      libDirs.add(path.join(path.dirname(binaryPath), 'lib'));
      libDirs.add(path.join(__dirname, '..', '..', 'native', 'worker', 'vendor', process.platform, process.arch, 'lib'));
    }

    const existing = (() => {
      switch (process.platform) {
        case 'win32': return env.PATH || '';
        case 'darwin': return env.DYLD_LIBRARY_PATH || '';
        default: return env.LD_LIBRARY_PATH || '';
      }
    })();

    const joined = Array.from(libDirs)
      .filter((dir) => fs.existsSync(dir))
      .concat(existing ? [existing] : [])
      .join(path.delimiter);

    if (joined) {
      if (process.platform === 'win32') env.PATH = joined;
      else if (process.platform === 'darwin') env.DYLD_LIBRARY_PATH = joined;
      else env.LD_LIBRARY_PATH = joined;
    }

    return env;
  }

  /** Start a new worker session for a file */
  startSession(
    fileHash: string,
    filePath: string,
    listener: EventListener,
    options: {
      backend?: string;
      readerFormat?: 'webp' | 'jpeg';
      thumbWidth?: number;
      thumbQuality?: number;
      readerMaxDimension?: number;
      readerQuality?: number;
      vipsConcurrency?: number;
      windowBefore?: number;
      windowAfter?: number;
    } = {},
  ): WorkerSession {
    // Close existing session for this hash if any
    this.closeSession(fileHash);

    const outputDir = path.join(getTempDir(), fileHash);
    const session: WorkerSession = {
      fileHash,
      filePath,
      outputDir,
      process: null,
      totalPages: 0,
      manifest: null,
      ready: false,
      cancelled: false,
    };

    this.sessions.set(fileHash, session);

    const binaryPath = this.getWorkerBinaryPath();
    const backend = options.backend || this.detectBackend(filePath);
    const readerFormat = options.readerFormat || (process.env.COMISCOPIO_READER_FORMAT === 'webp' ? 'webp' : 'jpeg');

    const args = [
      '--input', filePath,
      '--output', outputDir,
      '--backend', backend,
      '--reader-format', readerFormat,
      '--thumb-width', String(options.thumbWidth || 180),
      '--thumb-quality', String(options.thumbQuality || 60),
      '--reader-max-dimension', String(options.readerMaxDimension || 2400),
      '--reader-quality', String(options.readerQuality || 82),
      '--vips-concurrency', String(options.vipsConcurrency || 1),
      '--window-before', String(options.windowBefore || 2),
      '--window-after', String(options.windowAfter || 3),
    ];

    const proc = spawn(binaryPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.getWorkerEnv(binaryPath),
    });

    session.process = proc;

    // Parse JSON-lines from stdout
    const rl = readline.createInterface({ input: proc.stdout! });
    rl.on('line', (line) => {
      if (session.cancelled) return;
      try {
        const event: WorkerEvent = JSON.parse(line);

        if (event.type === 'archive') {
          session.totalPages = event.totalPages || 0;
          session.ready = true;

          // Auto-focus page 0 so the first page is ready before renderer asks
          this.focus(fileHash, 0);
        }

        listener(event);
      } catch {
        // Not JSON — ignore
      }
    });

    // Log stderr (worker diagnostics)
    const stderrRl = readline.createInterface({ input: proc.stderr! });
    stderrRl.on('line', (line) => {
      console.log(line);
    });

    proc.on('exit', (code) => {
      session.process = null;
      if (!session.cancelled && code !== 0) {
        listener({ type: 'error', message: `Worker exited with code ${code}` });
      }
    });

    proc.on('error', (err) => {
      session.process = null;
      if (!session.cancelled) {
        listener({ type: 'error', message: err.message });
      }
    });

    return session;
  }

  /** Send a focus command to the worker */
  focus(fileHash: string, page: number): void {
    const session = this.sessions.get(fileHash);
    if (!session?.process?.stdin?.writable) return;

    const cmd = JSON.stringify({ type: 'focus', page }) + '\n';
    session.process.stdin.write(cmd);
  }

  /** Close a session: kill worker + cleanup temp */
  closeSession(fileHash: string): void {
    const session = this.sessions.get(fileHash);
    if (!session) return;

    session.cancelled = true;

    if (session.process) {
      session.process.stdin?.end();
      session.process.kill('SIGTERM');
      session.process = null;
    }

    // Clean temp directory
    try {
      if (fs.existsSync(session.outputDir)) {
        fs.rmSync(session.outputDir, { recursive: true, force: true });
      }
    } catch { /* ignore cleanup errors */ }

    this.sessions.delete(fileHash);
  }

  /** Close all sessions */
  closeAll(): void {
    for (const hash of Array.from(this.sessions.keys())) {
      this.closeSession(hash);
    }
  }

  /** Get a session by file hash */
  getSession(fileHash: string): WorkerSession | undefined {
    return this.sessions.get(fileHash);
  }

  /** Read the manifest.json from a session's output directory */
  readManifest(fileHash: string): any | null {
    const session = this.sessions.get(fileHash);
    if (!session) return null;

    const manifestPath = path.join(session.outputDir, 'manifest.json');
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch {
      return null;
    }
  }

  /** Resolve the full path for a page artifact */
  resolvePagePath(fileHash: string, pageIndex: number, variant: ArtifactVariant = 'optimized'): string | null {
    const session = this.sessions.get(fileHash);
    if (!session) return null;

    const manifest = this.readManifest(fileHash);
    const entry = manifest?.pages?.[pageIndex];
    if (variant === 'optimized' && typeof entry?.page === 'string') {
      const p = path.join(session.outputDir, entry.page);
      if (fs.existsSync(p)) return p;
    }
    if (variant === 'original' && typeof entry?.original === 'string') {
      const p = path.join(session.outputDir, entry.original);
      if (fs.existsSync(p)) return p;
    }

    const directory = variant === 'original' ? 'raw' : 'pages';
    const prefix = path.join(session.outputDir, directory, String(pageIndex).padStart(6, '0'));
    for (const ext of ['.webp', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.avif', '.tiff', '.tif']) {
      const p = prefix + ext;
      if (fs.existsSync(p)) return p;
    }
    return null;
  }

  /** Resolve the full path for a thumbnail artifact */
  resolveThumbPath(fileHash: string, pageIndex: number): string | null {
    const session = this.sessions.get(fileHash);
    if (!session) return null;

    const p = path.join(session.outputDir, 'thumbs', String(pageIndex).padStart(6, '0') + '.jpg');
    return fs.existsSync(p) ? p : null;
  }

  /** Detect backend from file extension */
  private detectBackend(filePath: string): string {
    const magic = this.detectBackendByMagic(filePath);
    if (magic) return magic;

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.cbr' || ext === '.rar') return 'rar';
    if (ext === '.cbz' || ext === '.zip') return 'zip';
    return 'rar'; // default for now
  }

  private detectBackendByMagic(filePath: string): string | null {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return null;

      const fd = fs.openSync(filePath, 'r');
      try {
        const header = Buffer.alloc(8);
        const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
        if (bytesRead >= 7) {
          const rar4 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
          const rar5 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
          if (header.subarray(0, 7).equals(rar4) || (bytesRead >= 8 && header.subarray(0, 8).equals(rar5))) {
            return 'rar';
          }
        }
        if (bytesRead >= 4) {
          const signature = header.readUInt32LE(0);
          if (signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x08074b50) {
            return 'zip';
          }
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // Fall back to extension.
    }
    return null;
  }
}
