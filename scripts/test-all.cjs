const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
function npm(script) {
  run(process.execPath, [process.env.npm_execpath, 'run', script]);
}
npm('build');
npm('test:unit');
run(process.execPath, ['scripts/test-database.cjs']);
run(process.execPath, ['scripts/prepare-ace-fixture.cjs']);
if (process.platform === 'linux') {
  run('ctest', ['--test-dir', 'native/worker/build', '--output-on-failure']);
  npm('build:portable');
  npm('test:workers');
} // Windows CTest is already required by build:native.
run(process.execPath, ['test/workers/native.test.cjs'], {
  ...process.env,
  COMISCOPIO_NATIVE_DIR: path.join(root, 'native/vendor', `${process.platform}-x64`),
});
