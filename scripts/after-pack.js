// afterPack hook: wraps the Linux Electron binary so --no-sandbox is always passed.
// AppImages extract to /tmp where the chrome-sandbox SUID bit is not preserved,
// causing a FATAL abort if --no-sandbox is not on the command line at startup.
// The flag must be present before Chromium initializes (before JS runs), so it
// cannot be set via app.commandLine.appendSwitch().
'use strict';
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;

  const appOutDir = context.appOutDir;
  const execName = context.packager.executableName; // e.g. "comiscopio"
  const binPath = path.join(appOutDir, execName);
  const realBinPath = path.join(appOutDir, execName + '.bin');

  if (!fs.existsSync(binPath)) {
    console.warn(`afterPack: binary not found at ${binPath}, skipping wrapper`);
    return;
  }

  // Rename actual Electron binary
  fs.renameSync(binPath, realBinPath);

  // Create a shell wrapper that injects --no-sandbox
  const wrapper = [
    '#!/bin/bash',
    `exec "$(dirname "$(readlink -f "$0")")/${execName}.bin" --no-sandbox "$@"`,
    '',
  ].join('\n');

  fs.writeFileSync(binPath, wrapper, { mode: 0o755 });
  console.log(`afterPack: wrapped ${execName} → ${execName}.bin with --no-sandbox`);
};
