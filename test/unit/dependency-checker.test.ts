import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const names = ['comiscopio-worker', 'comiscopio-doc-worker', 'comiscopio-ace-helper', 'comiscopio-unace'];
describe.skipIf(process.platform !== 'linux')('portable dependency gate', () => {
  for (const mode of ['empty', 'invalid executable', 'ldd failure', 'unknown output', 'valid']) {
    it(`checks ${mode}`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'comiscopio-ldd-'));
      try {
        fs.mkdirSync(path.join(dir, 'bin'));
        fs.mkdirSync(path.join(dir, 'lib'));
        if (mode !== 'empty') for (const name of names) {
          const file = path.join(dir, 'bin', name);
          if (mode === 'invalid executable') fs.writeFileSync(file, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
          else fs.copyFileSync('/bin/true', file);
        }
        const env = { ...process.env };
        if (mode === 'ldd failure' || mode === 'unknown output') {
          fs.mkdirSync(path.join(dir, 'tools'));
          fs.writeFileSync(path.join(dir, 'tools/ldd'), `#!/bin/sh\necho unclassifiable\nexit ${mode === 'ldd failure' ? 1 : 0}\n`, { mode: 0o755 });
          env.PATH = path.join(dir, 'tools') + ':' + env.PATH;
        }
        const result = spawnSync('bash', ['test/ldd/check-deps.sh', dir], { env, encoding: 'utf8' });
        expect(result.status, result.stdout + result.stderr).toBe(mode === 'valid' ? 0 : 1);
        expect(result.stdout).toContain(mode === 'valid' ? 'OVERALL: PASS' : 'OVERALL: FAIL');
      } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
  }
});
