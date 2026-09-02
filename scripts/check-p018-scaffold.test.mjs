import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkP018Scaffold } from './check-p018-scaffold.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migrationNames = fs
  .readdirSync(path.join(root, 'supabase', 'migrations'))
  .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name));

test('aceita o baseline histórico P018 com 14 migrations', () => {
  assert.deepEqual(checkP018Scaffold(root, { migrationNames: migrationNames.slice(0, 14) }), []);
});

test('aceita as 15 migrations atuais sem conhecer P026', () => {
  assert.deepEqual(checkP018Scaffold(root, { migrationNames: migrationNames.slice(0, 15) }), []);
});

test('migrations posteriores adicionais não invalidam o scaffold P018', () => {
  assert.deepEqual(
    checkP018Scaffold(root, {
      migrationNames: [...migrationNames, '20990101000000_add_future_migration.sql'],
    }),
    [],
  );
});

test('preserva a proteção quando o baseline histórico está incompleto', () => {
  const issues = checkP018Scaffold(root, { migrationNames: migrationNames.slice(0, 13) });
  assert.ok(issues.includes('P018_MIGRATION_BASELINE_INCOMPLETE:13'));
});

test('aceita o scaffold P018 modular, acessível e sem P019', () => {
  assert.deepEqual(checkP018Scaffold(root), []);
});

test('rejeita acesso Vite sensível e perda do fallback de rota', () => {
  const main = `${read('apps/web/src/main.tsx')}\nvoid import.meta.env.VITE_SERVICE_ROLE_KEY;`;
  const routes = read('apps/web/src/app/routes.tsx').replace("id: 'not-found'", "id: 'home'");
  const issues = checkP018Scaffold(root, {
    overrides: {
      'apps/web/src/main.tsx': main,
      'apps/web/src/app/routes.tsx': routes,
    },
  });

  assert.ok(issues.includes('P018_SENSITIVE_VITE_ACCESS_FOUND'));
  assert.ok(issues.includes('P018_ROUTE_BASELINE_INCOMPLETE'));
});

test('rejeita remoção do acceptance e do estágio CI nominal', () => {
  const rootPackage = JSON.parse(read('package.json'));
  delete rootPackage.scripts['p018:acceptance'];
  const workflow = read('.github/workflows/ltcm-postgres-validation.yml').replace(
    'npm run p018:acceptance',
    'npm run build',
  );
  const issues = checkP018Scaffold(root, {
    overrides: {
      'package.json': JSON.stringify(rootPackage),
      '.github/workflows/ltcm-postgres-validation.yml': workflow,
    },
  });

  assert.ok(issues.includes('P018_SCRIPT_MISSING:p018:acceptance'));
  assert.ok(issues.includes('P018_CI_STAGE_MISSING'));
});
