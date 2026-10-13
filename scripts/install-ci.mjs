import { spawnSync } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.npm_execpath) throw new Error('Run this installer with npm run install:ci.');

// Use prebuilt Sharp binaries unless the developer explicitly selects libvips.
if (!['SHARP_IGNORE_GLOBAL_LIBVIPS', 'SHARP_FORCE_GLOBAL_LIBVIPS', 'npm_config_build_from_source', 'NPM_CONFIG_BUILD_FROM_SOURCE'].some(key => key in process.env)) {
  process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = '1';
}
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'ci', '--prefix', projectRoot, '--workspaces=false', '--include=dev', '--include=optional', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: projectRoot, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.signal) process.kill(process.pid, result.signal);
if (result.status !== 0) process.exit(result.status ?? 1);

try {
  accessSync(path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vinext.cmd' : 'vinext'), process.platform === 'win32' ? constants.F_OK : constants.X_OK);
} catch {
  console.error('npm ci completed but the local vinext executable is unavailable.');
  process.exitCode = 69;
}
