import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkP019ServerPostgres } from './check-p019-server-postgres.mjs';

const migrationNames = fs
  .readdirSync(path.join(process.cwd(), 'supabase', 'migrations'))
  .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name));

test('P019 historical baseline with 14 migrations is valid', () => {
  assert.deepEqual(
    checkP019ServerPostgres(process.cwd(), { migrationNames: migrationNames.slice(0, 14) }),
    [],
  );
});

test('P019 accepts later migrations without a historical upper limit', () => {
  assert.deepEqual(
    checkP019ServerPostgres(process.cwd(), {
      migrationNames: [...migrationNames, '20990101000000_future_migration.sql'],
    }),
    [],
  );
});

test('P019 rejects an incomplete historical migration baseline', () => {
  const issues = checkP019ServerPostgres(process.cwd(), {
    migrationNames: migrationNames.slice(0, 13),
  });
  assert.ok(issues.includes('P019_MIGRATION_BASELINE_INCOMPLETE:13'));
});
test('aceita o contrato P019 completo no repositório', () => {
  assert.deepEqual(checkP019ServerPostgres(), []);
});

test('detecta import pg no browser sem inspecionar credenciais', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ltcm-p019-check-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of [
    'apps/api',
    'apps/web/src',
    'docs/backend',
    'scripts',
    'supabase/migrations',
  ]) {
    fs.cpSync(path.join(process.cwd(), directory), path.join(root, directory), { recursive: true });
  }
  fs.writeFileSync(
    path.join(root, 'apps', 'web', 'src', 'p019-forbidden.ts'),
    "import { Pool } from 'pg';\nvoid Pool;\n",
  );
  assert.ok(checkP019ServerPostgres(root).includes('P019_BROWSER_PG_IMPORT'));
});
