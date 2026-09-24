const { spawnSync } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');
const root = path.resolve(__dirname, '..');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (process.platform === 'win32') {
  const msys = process.env.COMISCOPIO_MSYS2 || 'C:\\msys64';
  run(path.join(msys, 'usr/bin/bash.exe'), ['-l', 'native/deps/build-windows-x64.sh'], {
    env: { ...process.env, MSYSTEM: 'UCRT64', CHERE_INVOKING: '1' },
  });
} else {
  for (const component of ['worker', 'doc-worker', 'ace-helper']) {
    run('cmake', ['-S', `native/${component}`, '-B', `native/${component}/build`, '-DCMAKE_BUILD_TYPE=Release']);
    run('cmake', ['--build', `native/${component}/build`, '--parallel', String(Math.min(os.availableParallelism(), 4))]);
  }
}
