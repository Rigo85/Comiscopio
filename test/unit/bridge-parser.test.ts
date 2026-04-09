/**
 * Tests for NativeWorkerBridge:
 *  - detectBackendByMagic: verifies correct backend detected from file magic bytes
 *  - JSON-line event parsing: verifies each worker event type is forwarded correctly
 *  - Edge case: archive event with totalPages=0 emits error instead
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'stream';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';

// Mock electron before any module that imports it
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/mock/exe'),
    getAppPath: vi.fn(() => '/mock/app'),
  },
}));

vi.mock('child_process', () => ({ spawn: vi.fn() }));

import { NativeWorkerBridge } from '../../electron/native-worker-bridge';
import { spawn } from 'child_process';

const FIXTURES = path.resolve(__dirname, '../fixtures/archive');

// ─── helpers ───────────────────────────────────────────────────────────────

function makeMockProcess() {
  const stdout = new Readable({ read() {} });
  const stderr = new Readable({ read() {} });
  const stdin = { write: vi.fn(), end: vi.fn(), writable: true };
  const proc = new EventEmitter() as any;
  proc.stdout = stdout;
  proc.stderr = stderr;
  proc.stdin = stdin;
  proc.kill = vi.fn();
  return proc;
}

/** Create a bridge whose binary-lookup always resolves without touching the FS. */
function makeBridge(): NativeWorkerBridge {
  const bridge = new NativeWorkerBridge();
  const fakeBin = '/fake/comiscopio-worker';
  (bridge as any).getWorkerBinaryPath = vi.fn(() => fakeBin);
  (bridge as any).getDocWorkerBinaryPath = vi.fn(() => fakeBin);
  (bridge as any).getWorkerEnv = vi.fn(() => process.env);
  (bridge as any).cleanupSessionArtifacts = vi.fn();
  return bridge;
}

// ─── detectBackendByMagic (real FS reads against fixture files) ────────────

describe('detectBackendByMagic', () => {
  let bridge: NativeWorkerBridge;

  beforeEach(() => {
    bridge = new NativeWorkerBridge();
  });

  it('detects ZIP from .cbz fixture', () => {
    const result = (bridge as any).detectBackendByMagic(path.join(FIXTURES, 'test-5pages.cbz'));
    expect(result).toBe('zip');
  });

  it('detects RAR from .cbr fixture', () => {
    const result = (bridge as any).detectBackendByMagic(path.join(FIXTURES, 'test-5pages.cbr'));
    expect(result).toBe('rar');
  });

  it('detects 7z from .cb7 fixture', () => {
    const result = (bridge as any).detectBackendByMagic(path.join(FIXTURES, 'test-5pages.cb7'));
    expect(result).toBe('7z');
  });

  it('detects ACE from magic bytes even when the extension is .cbr', () => {
    const tmp = path.join(FIXTURES, '_tmp_ace_fake_cbr.cbr');
    const buf = Buffer.alloc(512);
    Buffer.from('**ACE**', 'ascii').copy(buf, 7);
    fs.writeFileSync(tmp, buf);
    try {
      expect((bridge as any).detectBackendByMagic(tmp)).toBe('ace');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('detects TAR from .cbt fixture', () => {
    const result = (bridge as any).detectBackendByMagic(path.join(FIXTURES, 'test-5pages.cbt'));
    expect(result).toBe('tar');
  });

  it('returns null for a non-existent path', () => {
    const result = (bridge as any).detectBackendByMagic('/no/such/file.cbz');
    expect(result).toBeNull();
  });

  it('returns null for a file with no recognised magic bytes', () => {
    const tmp = path.join(FIXTURES, '_tmp_nomagic.bin');
    fs.writeFileSync(tmp, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    try {
      expect((bridge as any).detectBackendByMagic(tmp)).toBeNull();
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('detects gzip (tar.gz): magic bytes 0x1F 0x8B', () => {
    const tmp = path.join(FIXTURES, '_tmp_gz.bin');
    const buf = Buffer.alloc(300);
    buf[0] = 0x1f; buf[1] = 0x8b;
    fs.writeFileSync(tmp, buf);
    try {
      expect((bridge as any).detectBackendByMagic(tmp)).toBe('tar');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('detects bzip2 (tar.bz2): magic bytes 0x42 0x5A 0x68', () => {
    const tmp = path.join(FIXTURES, '_tmp_bz2.bin');
    const buf = Buffer.alloc(300);
    buf[0] = 0x42; buf[1] = 0x5a; buf[2] = 0x68;
    fs.writeFileSync(tmp, buf);
    try {
      expect((bridge as any).detectBackendByMagic(tmp)).toBe('tar');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('detects xz (tar.xz): magic bytes 0xFD 0x37 0x7A 0x58 0x5A 0x00', () => {
    const tmp = path.join(FIXTURES, '_tmp_xz.bin');
    const buf = Buffer.alloc(300);
    [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00].forEach((b, i) => (buf[i] = b));
    fs.writeFileSync(tmp, buf);
    try {
      expect((bridge as any).detectBackendByMagic(tmp)).toBe('tar');
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

// ─── JSON-line event parsing ───────────────────────────────────────────────

describe('startSession JSON-line event parsing', () => {
  let bridge: NativeWorkerBridge;
  let mockProc: any;

  beforeEach(() => {
    bridge = makeBridge();
    mockProc = makeMockProcess();
    vi.mocked(spawn).mockReturnValue(mockProc);
  });

  function startAndCollect(filePath = 'test.cbz') {
    const events: any[] = [];
    bridge.startSession('h1', filePath, (e) => events.push(e));
    return events;
  }

  /** Push a JSON-line to the mock process stdout and wait for readline to process it. */
  async function push(line: string): Promise<void> {
    mockProc.stdout.push(line + '\n');
    // readline emits 'line' events asynchronously via setImmediate/nextTick
    await new Promise((r) => setImmediate(r));
  }

  it('forwards extracting event', async () => {
    const events = startAndCollect();
    await push(JSON.stringify({ type: 'extracting', current: 0, total: 5 }));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'extracting', current: 0, total: 5 });
  });

  it('forwards archive event and auto-focuses page 0', async () => {
    const events = startAndCollect();
    await push(JSON.stringify({ type: 'archive', totalPages: 10 }));
    expect(events[0]).toMatchObject({ type: 'archive', totalPages: 10 });
    expect(mockProc.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ type: 'focus', page: 0 }) + '\n',
    );
  });

  it('emits error (not archive) when totalPages is 0', async () => {
    const events = startAndCollect();
    await push(JSON.stringify({ type: 'archive', totalPages: 0 }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].message).toMatch(/no contiene imágenes/i);
    expect(mockProc.stdin.write).not.toHaveBeenCalled();
  });

  it('forwards ready event', async () => {
    const events = startAndCollect();
    await push(JSON.stringify({ type: 'ready', page: 0 }));
    expect(events[0]).toMatchObject({ type: 'ready', page: 0 });
  });

  it('forwards progress event', async () => {
    const events = startAndCollect();
    await push(JSON.stringify({ type: 'progress', page: 2, stage: 'thumb' }));
    expect(events[0]).toMatchObject({ type: 'progress', page: 2, stage: 'thumb' });
  });

  it('forwards done event', async () => {
    const events = startAndCollect();
    await push(JSON.stringify({ type: 'done' }));
    expect(events[0]).toMatchObject({ type: 'done' });
  });

  it('forwards error event from worker', async () => {
    const events = startAndCollect();
    await push(JSON.stringify({ type: 'error', message: 'worker crashed' }));
    expect(events[0]).toMatchObject({ type: 'error', message: 'worker crashed' });
  });

  it('invalidates cached manifest on ready event', async () => {
    startAndCollect();
    const session = bridge.getSession('h1')!;
    session.manifest = { pages: [] };
    await push(JSON.stringify({ type: 'ready', page: 0 }));
    expect(session.manifest).toBeNull();
  });

  it('invalidates cached manifest on done event', async () => {
    startAndCollect();
    const session = bridge.getSession('h1')!;
    session.manifest = { pages: [] };
    await push(JSON.stringify({ type: 'done' }));
    expect(session.manifest).toBeNull();
  });

  it('silently ignores non-JSON lines (worker diagnostics)', async () => {
    const events = startAndCollect();
    await push('[vips] some internal log');
    await push('WARN: something');
    await push(JSON.stringify({ type: 'ready', page: 1 }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('ready');
  });

  it('emits error when process exits with non-zero code', () => {
    const events = startAndCollect();
    mockProc.emit('exit', 2);
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect(err.message).toMatch(/code 2/);
  });

  it('does NOT emit error when process exits with code 0', () => {
    const events = startAndCollect();
    mockProc.emit('exit', 0);
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0);
  });

  it('emits error on process spawn error', () => {
    const events = startAndCollect();
    mockProc.emit('error', new Error('ENOENT'));
    expect(events[0]).toMatchObject({ type: 'error', message: 'ENOENT' });
  });

  it('does not emit events after closeSession (cancelled)', async () => {
    const events = startAndCollect();
    bridge.closeSession('h1');
    await push(JSON.stringify({ type: 'ready', page: 0 }));
    expect(events.filter((e) => e.type === 'ready')).toHaveLength(0);
  });

  it('auto-detects doc format and uses doc worker binary for PDF files', () => {
    bridge.startSession('h2', 'book.pdf', () => {});
    expect((bridge as any).getDocWorkerBinaryPath).toHaveBeenCalled();
  });

  it('uses archive worker binary for cbz files', () => {
    bridge.startSession('h3', 'manga.cbz', () => {});
    expect((bridge as any).getWorkerBinaryPath).toHaveBeenCalled();
  });
});
