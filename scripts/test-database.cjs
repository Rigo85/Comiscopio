// better-sqlite3 uses Electron's ABI, not the host Node ABI.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(require('electron'), [path.join(__dirname, '../test/integration/database.test.cjs')], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
