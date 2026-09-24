import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import { getTempDir } from '../shared/constants';
import { app } from 'electron';
import { randomUUID } from 'crypto';

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
  cleanupTimer: NodeJS.Timeout | null;
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
 * 6. closeSession() → quit command, forced termination if needed, cleanup
 */
export class NativeWorkerBridge {
  private sessions = new Map<string, WorkerSession>();
  private pendingWorkers = new Set<Promise<void>>();
  private pendingCleanup = new Set<Promise<void>>();

  /** Check if a file is a document format (PDF, DjVu, EPUB, XPS) vs archive */
  private isDocumentFormat(filePath: string): boolean {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) return false;
    const ext = path.extname(filePath).toLowerCase();
    return ['.pdf', '.djvu', '.djv', '.epub', '.xps'].includes(ext);
  }

  /** Get path to the archive worker binary */
  private getWorkerBinaryPath(): string {
    return this.findBinary('comiscopio-worker', 'worker');
  }

  /** Get path to the document worker binary */
  private getDocWorkerBinaryPath(): string {
    return this.findBinary('comiscopio-doc-worker', 'doc-worker');
  }

  private findBinary(name: string, buildDir: string): string {
    const executable = process.platform === 'win32' ? `${name}.exe` : name;
    if (app.isPackaged) {
      // Packaged layout: resources/native/bin/<binary>  (RPATH → ../lib)
      const candidates = [
        path.join(process.resourcesPath, 'native', 'bin', executable),
        path.join(path.dirname(app.getPath('exe')), 'native', 'bin', executable),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    }
    // Development must run the binaries just built, not a stale release bundle.
    const vendorPlatform = `${process.platform}-${process.arch}`;
    const devCandidates = [
      path.join(__dirname, '..', '..', 'native', buildDir, 'build', executable),
      path.join(__dirname, '..', '..', 'native', buildDir, 'build', 'Release', executable),
      path.join(__dirname, '..', '..', 'native', buildDir, 'build-debug', executable),
      path.join(__dirname, '..', '..', 'native', 'vendor', vendorPlatform, 'bin', executable),
    ];
    for (const p of devCandidates) {
      if (fs.existsSync(p)) return p;
    }

    throw new Error(`${name} binary not found`);
  }

  private getWorkerEnv(binaryPath: string): NodeJS.ProcessEnv {
    const env = { ...process.env };
    const libDirs = new Set<string>();

    if (app.isPackaged) {
      // Packaged: RPATH handles lib resolution, but also set env as fallback
      libDirs.add(path.join(process.resourcesPath, 'native', 'lib'));
      libDirs.add(path.join(path.dirname(app.getPath('exe')), 'native', 'lib'));
    } else {
      // Only add libraries belonging to the selected binary.
      libDirs.add(path.join(path.dirname(binaryPath), '..', 'lib'));
      libDirs.add(path.join(path.dirname(binaryPath), 'lib'));
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

    const outputDir = path.join(getTempDir(), `${fileHash}-${randomUUID()}`);
    const session: WorkerSession = {
      fileHash,
      filePath,
      outputDir,
      process: null,
      totalPages: 0,
      manifest: null,
      ready: false,
      cancelled: false,
      cleanupTimer: null,
    };

    this.sessions.set(fileHash, session);

    const isDoc = this.isDocumentFormat(filePath);
    const binaryPath = isDoc ? this.getDocWorkerBinaryPath() : this.getWorkerBinaryPath();
    const readerFormat = options.readerFormat || (process.env.COMISCOPIO_READER_FORMAT === 'webp' ? 'webp' : 'jpeg');

    const args = [
      '--input', filePath,
      '--output', outputDir,
      '--reader-format', readerFormat,
      '--thumb-width', String(options.thumbWidth || 180),
      '--thumb-quality', String(options.thumbQuality || 60),
      '--reader-max-dimension', String(options.readerMaxDimension || 2400),
      '--reader-quality', String(options.readerQuality || 82),
      '--vips-concurrency', String(options.vipsConcurrency || 1),
      '--window-before', String(options.windowBefore || 2),
      '--window-after', String(options.windowAfter || 3),
    ];

    // Archive worker needs --backend; doc worker auto-detects format
    if (!isDoc) {
      const backend = options.backend || this.detectBackend(filePath);
      args.push('--backend', backend);
    }

    const proc = spawn(binaryPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.getWorkerEnv(binaryPath),
      windowsHide: true,
    });

    session.process = proc;
    // Writes can race a worker crash. Handle EPIPE so it cannot crash Electron;
    // the process error/exit handlers report the actual failure to the reader.
    proc.stdin!.on('error', (error: NodeJS.ErrnoException) => {
      if (!session.cancelled && error.code !== 'EPIPE') {
        console.warn('Worker input failed:', error.message);
      }
    });

    // Parse JSON-lines from stdout
    let reportedFatalError = false;
    const rl = readline.createInterface({ input: proc.stdout! });
    rl.on('line', (line) => {
      if (session.cancelled) return;
      try {
        const event: WorkerEvent = JSON.parse(line);

        if (event.type === 'archive') {
          session.totalPages = event.totalPages || 0;

          if (session.totalPages === 0) {
            // Archive opened successfully but contains no recognized image entries
            // (e.g. a TAR of CBR files). Rewrite as an error so the viewer shows
            // a clear message instead of an empty reader.
            reportedFatalError = true;
            listener({ type: 'error', message: 'El archivo no contiene imágenes reconocidas' });
            return;
          }

          session.ready = true;

          // Auto-focus page 0 so the first page is ready before renderer asks
          this.focus(fileHash, 0);
        }

        // Invalidate cached manifest when new pages are ready
        if (event.type === 'ready' || event.type === 'done') {
          session.manifest = null;
        }

        if (event.type === 'error' && event.page == null) reportedFatalError = true;
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

    // 'close' follows drained stdout/stderr; 'exit' can precede the final error.
    proc.on('close', (code) => {
      rl.close();
      stderrRl.close();
      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer);
        session.cleanupTimer = null;
      }
      session.process = null;
      // Each session owns its directory, including while its successor is running.
      // A successful exit may leave artifacts needed by the reader until close.
      if (session.cancelled || code !== 0) {
        this.cleanupSessionArtifacts(session);
        if (this.sessions.get(fileHash) === session) this.sessions.delete(fileHash);
      }
      if (!session.cancelled && code !== 0 && !reportedFatalError) {
        listener({ type: 'error', message: `Worker exited with code ${code}` });
      }
    });

    proc.on('error', (err) => {
      session.process = null;
      this.cleanupSessionArtifacts(session);
      if (this.sessions.get(fileHash) === session) this.sessions.delete(fileHash);
      if (!session.cancelled) {
        listener({ type: 'error', message: err.message });
      }
    });

    // Keep track even after closeSession removes the session from the map.
    // The earlier close handler schedules cleanup before this promise resolves.
    const finished = new Promise<void>(resolve => proc.once('close', () => resolve()));
    this.pendingWorkers.add(finished);
    void finished.then(() => this.pendingWorkers.delete(finished));
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
    this.sessions.delete(fileHash);

    if (session.process) {
      const proc = session.process;
      if (proc.stdin?.writable) proc.stdin.end(JSON.stringify({ type: 'quit' }) + '\n');
      // POSIX extraction can be blocked waiting for ACE; stdin is only read
      // afterwards. Its signal handler cancels extraction and reaps the helper.
      // Windows uses the stdin command and its kill-on-close Job Object.
      if (process.platform !== 'win32') proc.kill('SIGTERM');
      session.cleanupTimer = setTimeout(() => {
        if (session.process === proc) {
          proc.kill('SIGKILL');
        }
      }, 1500);
      return;
    }

    this.cleanupSessionArtifacts(session);
    this.sessions.delete(fileHash);
  }

  /** Close all sessions */
  async closeAll(): Promise<void> {
    for (const hash of Array.from(this.sessions.keys())) {
      this.closeSession(hash);
    }
    await Promise.all(this.pendingWorkers);
    await Promise.all(this.pendingCleanup);
  }

  /** Get a session by file hash */
  getSession(fileHash: string): WorkerSession | undefined {
    return this.sessions.get(fileHash);
  }

  private cleanupSessionArtifacts(session: WorkerSession): void {
    const cleanup = fs.promises.rm(session.outputDir, {
      recursive: true, force: true, maxRetries: 3, retryDelay: 100,
    }).catch(error => {
      console.warn('Could not remove worker temporary directory:', session.outputDir, error);
    });
    this.pendingCleanup.add(cleanup);
    void cleanup.then(() => this.pendingCleanup.delete(cleanup));
  }

  /** Read the manifest.json from a session's output directory (cached) */
  readManifest(fileHash: string): any | null {
    const session = this.sessions.get(fileHash);
    if (!session) return null;
    if (session.manifest) return session.manifest;

    const manifestPath = path.join(session.outputDir, 'manifest.json');
    try {
      session.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      return session.manifest;
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

  /** Detect backend by magic bytes first, then fall back to file extension. */
  private detectBackend(filePath: string): string {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) return 'folder';
    const magic = this.detectBackendByMagic(filePath);
    if (magic) return magic;

    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.cbr' || ext === '.rar') return 'rar';
    if (ext === '.cbz' || ext === '.zip') return 'zip';
    if (ext === '.cb7' || ext === '.7z') return '7z';
    if (ext === '.cbt' || ext === '.tar' || ext === '.tgz') return 'tar';
    if (ext === '.cba' || ext === '.ace') return 'ace';
    return 'rar'; // default fallback
  }

  private detectBackendByMagic(filePath: string): string | null {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return null;

      const fd = fs.openSync(filePath, 'r');
      try {
        const header = Buffer.alloc(512);
        const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
        // RAR v4/v5: 0x526172211A07
        if (bytesRead >= 7) {
          const rar4 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]);
          const rar5 = Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
          if (header.subarray(0, 7).equals(rar4) || (bytesRead >= 8 && header.subarray(0, 8).equals(rar5))) {
            return 'rar';
          }
        }
        // ZIP: PK signature
        if (bytesRead >= 4) {
          const signature = header.readUInt32LE(0);
          if (signature === 0x04034b50 || signature === 0x06054b50 || signature === 0x08074b50) {
            return 'zip';
          }
        }
        // 7z: 0x377ABCAF271C
        if (bytesRead >= 6) {
          const sevenz = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
          if (header.subarray(0, 6).equals(sevenz)) {
            return '7z';
          }
        }
        // ACE: official UnAce code scans for "**ACE**" within the first 512 bytes.
        if (bytesRead >= 7) {
          const ace = Buffer.from('**ACE**', 'ascii');
          for (let offset = 0; offset <= bytesRead - ace.length; offset++) {
            if (header.subarray(offset, offset + ace.length).equals(ace)) {
              return 'ace';
            }
          }
        }
        // TAR: "ustar" at offset 257
        if (bytesRead >= 262) {
          const ustar = header.subarray(257, 262).toString('ascii');
          if (ustar === 'ustar') {
            return 'tar';
          }
        }
        // gzip (tar.gz): 0x1F8B
        if (bytesRead >= 2 && header[0] === 0x1f && header[1] === 0x8b) {
          return 'tar';
        }
        // bzip2 (tar.bz2): 0x425A68 ("BZh")
        if (bytesRead >= 3 && header[0] === 0x42 && header[1] === 0x5a && header[2] === 0x68) {
          return 'tar';
        }
        // xz (tar.xz): 0xFD377A585A00
        if (bytesRead >= 6) {
          const xz = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
          if (header.subarray(0, 6).equals(xz)) {
            return 'tar';
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
