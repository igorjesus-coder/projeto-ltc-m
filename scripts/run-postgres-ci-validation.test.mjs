import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { migrationInventory, sanitizeProcessFailure } from './run-postgres-ci-validation.mjs';

function migrationDirectory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ltcm-ci-runner-test-'));
  fs.mkdirSync(path.join(root, 'supabase', 'migrations'), { recursive: true });
  return root;
}

test('inventário ordena migrations e calcula hashes determinísticos', (context) => {
  const root = migrationDirectory();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'supabase', 'migrations', '20260101000002_b.sql'), 'select 2;');
  fs.writeFileSync(path.join(root, 'supabase', 'migrations', '20260101000001_a.sql'), 'select 1;');
  const inventory = migrationInventory(root);
  assert.deepEqual(
    inventory.map(({ order, name }) => ({ order, name })),
    [
      { order: 1, name: '20260101000001_a.sql' },
      { order: 2, name: '20260101000002_b.sql' },
    ],
  );
  assert.ok(inventory.every(({ sha256 }) => /^[A-F0-9]{64}$/u.test(sha256)));
});

test('inventário rejeita timestamp duplicado e nome inválido', (context) => {
  const duplicate = migrationDirectory();
  const invalid = migrationDirectory();
  context.after(() => {
    fs.rmSync(duplicate, { recursive: true, force: true });
    fs.rmSync(invalid, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(duplicate, 'supabase', 'migrations', '20260101000001_a.sql'), '');
  fs.writeFileSync(path.join(duplicate, 'supabase', 'migrations', '20260101000001_b.sql'), '');
  fs.writeFileSync(path.join(invalid, 'supabase', 'migrations', 'migration.sql'), '');
  assert.throws(() => migrationInventory(duplicate), /duplicado/u);
  assert.throws(() => migrationInventory(invalid), /inválido/u);
});

test('falha sanitizada não preserva URL de banco', () => {
  const message = sanitizeProcessFailure({
    code: 1,
    stderr: 'ERROR: failed postgresql://user:password@example.invalid/database',
  });
  assert.doesNotMatch(message, /password|example\.invalid/u);
  assert.match(message, /redacted/u);
});

test('bootstrap prepara runtime sem memberships antes das migrations', () => {
  const bootstrap = fs.readFileSync(
    path.join(process.cwd(), 'database', 'audit', 'ltcm-ci-bootstrap.sql'),
    'utf8',
  );
  assert.match(bootstrap, /create role ltc_m_runtime[\s\S]*nologin[\s\S]*nobypassrls/iu);
  assert.match(bootstrap, /revoke ltc_m_runtime from ci_admin granted by ci_admin/iu);
  assert.match(bootstrap, /pg_catalog\.pg_auth_members/iu);
});

test('estado final lê locale do catálogo do banco PostgreSQL', () => {
  const finalState = fs.readFileSync(
    path.join(process.cwd(), 'database', 'audit', 'ltcm-ci-final-state.sql'),
    'utf8',
  );
  assert.match(finalState, /pg_database\.datcollate/iu);
  assert.match(finalState, /pg_database\.datctype/iu);
  assert.doesNotMatch(finalState, /current_setting\('lc_(?:collate|ctype)'\)/iu);
});

test('estado final verifica as duas funções trigger-only D40 e D41', () => {
  const finalState = fs.readFileSync(
    path.join(process.cwd(), 'database', 'audit', 'ltcm-ci-final-state.sql'),
    'utf8',
  );
  assert.match(finalState, /enforce_project_legacy_reference_date\(\)/u);
  assert.match(finalState, /enforce_import_batch_rejection_guard\(\)/u);
  assert.match(finalState, /pg_catalog\.aclexplode/iu);
  assert.match(finalState, /has_function_privilege/iu);
});

test('runner só avança da Fase A P009 com evidência limpa', () => {
  const runner = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'run-postgres-ci-validation.mjs'),
    'utf8',
  );
  assert.match(runner, /phase_a_passed !== true/u);
  assert.match(runner, /operational_rows !== 0/u);
  assert.match(runner, /relevant_advisory_locks !== 0/u);
  assert.ok(runner.indexOf('phase_a_passed !== true') < runner.indexOf("runStage('p009',"));
});
