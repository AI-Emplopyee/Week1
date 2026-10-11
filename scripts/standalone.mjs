import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { standaloneConfig } from './standalone-config.mjs';

const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build', 'deploy', 'dry-run'].includes(command)) throw new Error('Use dev, build, dry-run or deploy.');
if (args.length && !(command === 'dev' && args.length === 2 && args[0] === '--port' && /^\d{4,5}$/.test(args[1]) && Number(args[1]) <= 65535)) throw new Error('Only dev --port PORT is supported. Deployment config and authentication overrides are not accepted.');
if (command === 'dev') {
  for (const file of ['.dev.vars', '.env', '.env.local', '.env.development', '.env.development.local']) {
    if (!existsSync(file)) continue;
    const entries = readFileSync(file, 'utf8').split(/\r?\n/).filter(line => /^\s*(?:export\s+)?AICD_AUTH_MODE\s*=/.test(line));
    if (entries.some(line => !/^\s*(?:export\s+)?AICD_AUTH_MODE\s*=\s*(?:supabase|"supabase"|'supabase')\s*(?:#.*)?$/.test(line))) throw new Error(`${file} must use AICD_AUTH_MODE=supabase for standalone development.`);
  }
}
standaloneConfig({ development: command === 'dev' });
const run = (script, params) => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), ...params], {
    stdio: 'inherit', env: { ...process.env, AICD_STANDALONE: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
if (command === 'dev') run('./run-framework.mjs', ['dev', '--hostname', '127.0.0.1', ...args]);
else {
  run('./run-framework.mjs', ['build']);
  const config = JSON.parse(readFileSync('dist/server/wrangler.json', 'utf8'));
  if (config.vars?.AICD_AUTH_MODE !== 'supabase') throw new Error('Refusing to deploy a build without explicit Supabase authentication.');
  // Wrangler resolves migration paths relative to this generated config file.
  for (const binding of config.d1_databases ?? []) binding.migrations_dir = '../../drizzle';
  writeFileSync('dist/server/wrangler.json', JSON.stringify(config, null, 2) + '\n');
  if (command !== 'build') run('../node_modules/wrangler/bin/wrangler.js', ['deploy', '--config', 'dist/server/wrangler.json', ...(command === 'dry-run' ? ['--dry-run', '--outdir', 'outputs/standalone-dry-run'] : []), ...args]);
}
