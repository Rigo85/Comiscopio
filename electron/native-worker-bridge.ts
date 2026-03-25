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
    if (app.isPackaged) {
      // In packaged app: look in extraResources or alongside the app
      const candidates = [
        path.join(process.resourcesPath, 'native', 'comiscopio-worker'),
        path.join(path.dirname(app.getPath('exe')), 'native', 'comiscopio-worker'),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    }
    // Dev mode: build directory
    const devPath = path.join(__dirname, '..', '..', 'native', 'worker', 'build', 'comiscopio-worker');
    if (fs.existsSync(devPath)) return devPath;

    throw new Error('comiscopio-worker binary not found');
  }

  /** Start a new worker session for a file */
  startSession(
    fileHash: string,
    filePath: string,
    listener: EventListener,
    options: {
      backend?: string;
      thumbWidth?: number;
      thumbQuality?: number;
      readerMaxDimension?: number;
      readerQuality?: number;
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

    const args = [
      '--input', filePath,
      '--output', outputDir,
      '--backend', backend,
      '--thumb-width', String(options.thumbWidth || 180),
      '--thumb-quality', String(options.thumbQuality || 60),
      '--reader-max-dimension', String(options.readerMaxDimension || 2400),
      '--reader-quality', String(options.readerQuality || 82),
      '--window-before', String(options.windowBefore || 2),
      '--window-after', String(options.windowAfter || 3),
    ];

    const proc = spawn(binaryPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
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
        }

        listener(event);
      } catch {
        // Not JSON — ignore
      }
    });

    // Log stderr (worker diagnostics)
    const stderrRl = readline.createInterface({ input: proc.stderr! });
    stderrRl.on('line', (line) => {
      console.log(`[native-worker] ${line}`);
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
  resolvePagePath(fileHash: string, pageIndex: number): string | null {
    const session = this.sessions.get(fileHash);
    if (!session) return null;

    const prefix = path.join(session.outputDir, 'pages', String(pageIndex).padStart(6, '0'));
    for (const ext of ['.webp', '.jpg', '.jpeg', '.png']) {
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
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.cbr' || ext === '.rar') return 'rar';
    // Future: zip, 7z, pdf
    return 'rar'; // default for now
  }
}
