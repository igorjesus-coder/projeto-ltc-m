import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  checkD21Fix,
  scanD21MigrationText,
  scanD21TestText,
} from './check-d21-inactivation-fix.mjs';

const root = path.resolve(import.meta.dirname, '..');
const migrationDirectory = path.join(root, 'supabase', 'migrations');
const testPath = path.join(root, 'database', 'audit', 'ltcm-p007-tests.sql');
const correctionPath = path.join(
  migrationDirectory,
  '20260730163419_fix_ltcm_admin_inactivation_columns.sql',
);
const correctionSql = fs.readFileSync(correctionPath, 'utf8');
const p007Sql = fs.readFileSync(testPath, 'utf8');

function copyMigrations() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ltcm-d21-'));
  for (const filename of fs.readdirSync(migrationDirectory)) {
    if (filename.endsWith('.sql')) {
      fs.copyFileSync(path.join(migrationDirectory, filename), path.join(target, filename));
    }
  }
  return target;
}

test('aceita a única migration D21 e a suíte P007 ampliada', () => {
  assert.deepEqual(checkD21Fix(migrationDirectory, testPath), []);
  assert.deepEqual(scanD21MigrationText(correctionSql), []);
  assert.deepEqual(scanD21TestText(p007Sql), []);
});

test('rejeita acesso direto a OLD/NEW e ausência da estratégia JSONB', () => {
  const directField = correctionSql.replace(
    "(v_old_data -> 'deleted_at') is distinct from\n            (v_new_data -> 'deleted_at')",
    'old.deleted_at is distinct from new.deleted_at',
  );
  const withoutJson = correctionSql.replace('pg_catalog.to_jsonb(old)', "'{}'::jsonb");

  assert.ok(scanD21MigrationText(directField).some((issue) => issue.includes('OLD/NEW')));
  assert.ok(
    scanD21MigrationText(withoutJson).some((issue) => issue.includes('proteção D21 ausente')),
  );
});

test('rejeita OLD.is_active, objeto externo, DML, RLS e privilégios', () => {
  const unsafeIsActive = correctionSql.replace(
    'return new;',
    'if old.is_active is distinct from new.is_active then return new; end if;',
  );
  assert.notDeepEqual(scanD21MigrationText(unsafeIsActive), []);

  for (const injected of [
    'create or replace function public.bad() returns boolean language sql as $$ select true $$;',
    "insert into ltc_m.app_users (auth_subject, full_name) values ('bad', 'bad');",
    'alter table ltc_m.app_users enable row level security;',
    'create policy bad on ltc_m.app_users using (true);',
    'grant select on ltc_m.app_users to anon;',
    'revoke select on ltc_m.app_users from anon;',
    'create role bad;',
    'create extension pgcrypto;',
  ]) {
    const mutated = correctionSql.replace('commit;', `${injected}\ncommit;`);
    assert.notDeepEqual(scanD21MigrationText(mutated), []);
  }
});

test('rejeita migration aplicada alterada e uma segunda migration D21', () => {
  const target = copyMigrations();
  try {
    fs.appendFileSync(
      path.join(target, '20260730155749_fix_ltcm_workflow_guard_fail_closed.sql'),
      '\n-- alteração indevida\n',
      'utf8',
    );
    fs.writeFileSync(path.join(target, '20260730170000_second_d21_fix.sql'), correctionSql, 'utf8');

    const issues = checkD21Fix(target, testPath);
    assert.ok(issues.some((issue) => issue.includes('migration aplicada alterada')));
    assert.ok(issues.some((issue) => issue.includes('exatamente uma migration forward')));
  } finally {
    fs.rmSync(target, { force: true, recursive: true });
  }
});

test('rejeita ausência dos testes de app_users e de inativação por papel', () => {
  const withoutAppUsers = p007Sql.replace(
    'update comum de app_users não foi preservado',
    'cenário removido',
  );
  const withoutEditor = p007Sql.replace('editor inativou app_users', 'cenário removido');

  assert.ok(scanD21TestText(withoutAppUsers).some((issue) => issue.includes('update comum')));
  assert.ok(
    scanD21TestText(withoutEditor).some((issue) => issue.includes('inativação por editor')),
  );
});
