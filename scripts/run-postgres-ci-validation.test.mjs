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

test('bootstrap D51 usa supabase_admin real e isola ci_admin antes das migrations', () => {
  const bootstrap = fs.readFileSync(
    path.join(process.cwd(), 'database', 'audit', 'ltcm-ci-bootstrap.sql'),
    'utf8',
  );
  assert.match(bootstrap, /current_user\s*<>\s*'supabase_admin'/iu);
  assert.match(bootstrap, /session_user\s*<>\s*'supabase_admin'/iu);
  assert.match(bootstrap, /rolname\s*=\s*'supabase_admin'[\s\S]*oid\s*=\s*10/iu);
  assert.match(
    bootstrap,
    /create role ci_admin[\s\S]*login[\s\S]*nosuperuser[\s\S]*noinherit[\s\S]*nocreatedb[\s\S]*nocreaterole[\s\S]*nobypassrls/iu,
  );
  assert.match(bootstrap, /create role ltc_m_runtime[\s\S]*nologin[\s\S]*nobypassrls/iu);
  assert.match(bootstrap, /pg_catalog\.pg_auth_members/iu);
  assert.match(bootstrap, /pg_has_role\('ci_admin', 'ltc_m_runtime', 'MEMBER'\)/iu);
  assert.match(bootstrap, /pg_has_role\('ci_admin', 'ltc_m_runtime', 'USAGE'\)/iu);
  assert.match(bootstrap, /pg_has_role\('ci_admin', 'ltc_m_runtime', 'SET'\)/iu);
  assert.doesNotMatch(bootstrap, /grant\s+ltc_m_runtime\s+to\s+ci_admin/iu);
});

test('bootstrap D51 preserva a assertion estrutural D26 e encerra LOGIN do bootstrap', () => {
  const bootstrap = fs.readFileSync(
    path.join(process.cwd(), 'database', 'audit', 'ltcm-ci-bootstrap.sql'),
    'utf8',
  );
  assert.match(
    bootstrap,
    /grant ltc_m_runtime to postgres\s+with admin true, inherit false, set false/iu,
  );
  assert.match(bootstrap, /pg_catalog\.pg_get_userbyid\(grantor\) = 'supabase_admin'/iu);
  assert.match(bootstrap, /alter role supabase_admin nologin noreplication/iu);
  assert.match(bootstrap, /pg_has_role\('postgres', 'ltc_m_runtime', 'MEMBER'\)/iu);
  assert.match(bootstrap, /pg_has_role\('postgres', 'ltc_m_runtime', 'USAGE'\)/iu);
  assert.match(bootstrap, /pg_has_role\('postgres', 'ltc_m_runtime', 'SET'\)/iu);
  assert.doesNotMatch(bootstrap, /granted\s+by\s+supabase_admin/iu);
});

test('fase de roles D51 é one-shot e rejeita todos os estados preexistentes', () => {
  const bootstrap = fs.readFileSync(
    path.join(process.cwd(), 'database', 'audit', 'ltcm-ci-bootstrap.sql'),
    'utf8',
  );
  assert.match(
    bootstrap,
    /rolname in \('postgres', 'ci_admin', 'ltc_m_runtime'\)[\s\S]*errcode = '42710'/iu,
  );
  assert.match(bootstrap, /membership antecipada em ltc_m_runtime/iu);
});

test('runner separa bootstrap, operador e dois bancos no mesmo cluster', () => {
  const runner = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'run-postgres-ci-validation.mjs'),
    'utf8',
  );
  assert.match(runner, /runStage\('bootstrap_roles'/u);
  assert.match(runner, /runStage\('ci_admin_preflight'/u);
  assert.match(runner, /user: 'ci_admin'[\s\S]*password: adminPassword/u);
  assert.match(
    runner,
    /runStage\('create_concurrency_database'[\s\S]*database: 'postgres'[\s\S]*user: 'postgres'/u,
  );
  assert.match(runner, /database: 'ltcm_ci_concurrency'/u);
  assert.match(runner, /ci_admin_phase: 'true'/u);
});

test('runner ativa P012 somente no banco efêmero antes da concorrência D41', () => {
  const runner = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'run-postgres-ci-validation.mjs'),
    'utf8',
  );
  assert.match(runner, /runStage\('p012_persistence'/u);
  assert.match(runner, /LTCM_P012_INTEGRATION: '1'/u);
  assert.match(runner, /PGDATABASE: 'ltcm_ci_concurrency'/u);
  assert.ok(runner.indexOf("runStage('p012_persistence'") < runner.indexOf('runConcurrencyTest()'));
  assert.doesNotMatch(runner, /LTCM_P012_INTEGRATION[\s\S]{0,200}SUPABASE/iu);
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

test('estado final D51 comprova roles, ownership e D26 cluster-wide', () => {
  const finalState = fs.readFileSync(
    path.join(process.cwd(), 'database', 'audit', 'ltcm-ci-final-state.sql'),
    'utf8',
  );
  assert.match(finalState, /pg_database\.datname = 'ltcm_ci'/iu);
  assert.match(finalState, /pg_roles\.rolname = 'postgres'/iu);
  assert.match(finalState, /rolname = 'supabase_admin'[\s\S]*oid = 10[\s\S]*not rolcanlogin/iu);
  assert.match(finalState, /rolname = 'ci_admin'[\s\S]*not rolsuper[\s\S]*not rolcreaterole/iu);
  assert.match(finalState, /pg_get_userbyid\(grantor\) = 'supabase_admin'/iu);
  assert.match(finalState, /pg_has_role\('postgres', 'ltc_m_runtime', 'MEMBER'\)/iu);
  assert.match(finalState, /pg_has_role\('ci_admin', 'ltc_m_runtime', 'SET'\)/iu);
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
