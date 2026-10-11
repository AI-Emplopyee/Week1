import { existsSync, readFileSync } from 'node:fs';

const configPath = 'aicd.standalone.json';
const placeholderId = '00000000-0000-4000-8000-000000000000';

export function standaloneConfig({ development = false } = {}) {
  if (!existsSync(configPath) && !development) throw new Error('Copy aicd.standalone.example.json to aicd.standalone.json and enter your own D1 database ID before building for deployment.');
  const settings = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : {
    name: 'aicd-local', databaseName: 'aicd-local-db', databaseId: placeholderId, bucketName: 'aicd-local-documents',
  };
  for (const key of Object.keys(settings)) {
    if (!['name', 'databaseName', 'databaseId', 'bucketName'].includes(key)) throw new Error(`Unknown standalone setting: ${key}. Put runtime secrets in Cloudflare secrets, never this file.`);
  }
  for (const key of ['name', 'databaseName', 'bucketName']) {
    if (typeof settings[key] !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(settings[key])) throw new Error(`Invalid ${key}: use 3–63 lowercase letters, digits and hyphens.`);
  }
  if (!development && (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(settings.databaseId) || settings.databaseId === placeholderId)) {
    throw new Error('A real Cloudflare D1 database ID is required for standalone deployment.');
  }
  return {
    name: settings.name,
    vars: { AICD_AUTH_MODE: 'supabase' },
    d1_databases: [{ binding: 'DB', database_name: settings.databaseName, database_id: development ? placeholderId : settings.databaseId, migrations_dir: 'drizzle' }],
    r2_buckets: [{ binding: 'BUCKET', bucket_name: settings.bucketName }],
  };
}
