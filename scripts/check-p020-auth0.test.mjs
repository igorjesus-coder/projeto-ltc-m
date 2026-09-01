import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkP020Auth0 } from './check-p020-auth0.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migrationNames = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name));

test('P020 historical baseline with 14 migrations is valid', () => {
  assert.deepEqual(checkP020Auth0(root, { migrationNames: migrationNames.slice(0, 14) }), []);
});

test('P020 accepts the current 15 migrations without knowing P026', () => {
  assert.deepEqual(checkP020Auth0(root, { migrationNames: migrationNames.slice(0, 15) }), []);
});

test('later migrations do not invalidate the P020 Auth0 contract', () => {
  assert.deepEqual(
    checkP020Auth0(root, {
      migrationNames: [...migrationNames, '20990101000000_add_future_migration.sql'],
    }),
    [],
  );
});

test('P020 rejects an incomplete historical migration baseline', () => {
  const issues = checkP020Auth0(root, { migrationNames: migrationNames.slice(0, 13) });
  assert.ok(issues.includes('P020_MIGRATION_BASELINE_INCOMPLETE:13'));
});

test('aceita o contrato P020 Auth0 com boundaries de segurança', () => {
  assert.deepEqual(checkP020Auth0(root), []);
});

test('rejeita Supabase Auth e segredo no código do navegador', () => {
  const environment = `${read('apps/web/src/app/environment.ts')}\nlocalStorage.setItem('token', 'x');`;
  const issues = checkP020Auth0(root, {
    overrides: { 'apps/web/src/app/environment.ts': environment },
  });
  assert.ok(issues.includes('P020_WEB_SECRET_FOUND'));
});

test('P020 rejects a Supabase backend client without confusing a domain createClient', () => {
  const issues = checkP020Auth0(root, {
    overrides: {
      'apps/api/src/auth/auth.module.ts':
        'const supabase = createClient(databaseUrl); export { supabase };',
    },
  });
  assert.ok(issues.includes('P020_API_SUPABASE_FOUND'));
});
