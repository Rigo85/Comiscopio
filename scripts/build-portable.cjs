const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const windows = process.platform === 'win32';
const result = spawnSync(windows ? process.execPath : 'bash', [
  windows ? 'scripts/build-native.cjs' : 'native/deps/build-linux-x64.sh',
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
