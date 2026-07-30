import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkPw902Fix, scanPw902MigrationText, scanPw902TestText } from './check-pw902-fix.mjs';

const root = path.resolve(import.meta.dirname, '..');
const migrationDirectory = path.join(root, 'supabase', 'migrations');
const testPath = path.join(root, 'database', 'audit', 'ltcm-p007-tests.sql');
const correctionPath = path.join(
  migrationDirectory,
  '20260730155749_fix_ltcm_workflow_guard_fail_closed.sql',
);
const correctionSql = fs.readFileSync(correctionPath, 'utf8');
const p007Sql = fs.readFileSync(testPath, 'utf8');

function copyMigrations() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ltcm-pw902-'));
  for (const filename of fs.readdirSync(migrationDirectory)) {
    if (filename.endsWith('.sql')) {
      fs.copyFileSync(path.join(migrationDirectory, filename), path.join(target, filename));
    }
  }
  return target;
}

test('aceita a única migration forward e a suíte oficial ampliada', () => {
  assert.deepEqual(checkPw902Fix(migrationDirectory, testPath), []);
  assert.deepEqual(scanPw902MigrationText(correctionSql), []);
  assert.deepEqual(scanPw902TestText(p007Sql), []);
});

test('rejeita guarda anulável, NOT inseguro e cast booleano de current_setting', () => {
  const nullable = correctionSql.replace('select coalesce(', 'select (');
  const unsafeNot = correctionSql.replace(
    'ltc_m.workflow_guard_active(v_action) is not true',
    'not ltc_m.workflow_guard_active(v_action)',
  );
  const unsafeCast = correctionSql.replace(
    "pg_catalog.current_setting(\n                    'ltc_m.exceptional_self_approval',\n                    true\n                ) = 'true'",
    "pg_catalog.current_setting(\n                    'ltc_m.exceptional_self_approval',\n                    true\n                )::boolean",
  );

  assert.ok(scanPw902MigrationText(nullable).some((issue) => issue.includes('não nulo')));
  assert.ok(
    scanPw902MigrationText(unsafeNot).some((issue) => issue.includes('NOT workflow_guard')),
  );
  assert.ok(scanPw902MigrationText(unsafeCast).some((issue) => issue.includes('cast booleano')));
});

test('rejeita objeto externo, DML top-level, RLS, grant, role e extensão', () => {
  for (const injected of [
    'create or replace function public.bad() returns boolean language sql as $$ select true $$;',
    "insert into ltc_m.plan_versions (name, reference_date) values ('bad', current_date);",
    'alter table ltc_m.plan_versions enable row level security;',
    'create policy bad on ltc_m.plan_versions using (true);',
    'grant select on ltc_m.plan_versions to anon;',
    'create role bad;',
    'create extension pgcrypto;',
  ]) {
    const mutated = correctionSql.replace('commit;', `${injected}\ncommit;`);
    assert.notDeepEqual(scanPw902MigrationText(mutated), []);
  }
});

test('rejeita alteração de migration aplicada e segunda migration corretiva', () => {
  const target = copyMigrations();
  try {
    fs.appendFileSync(
      path.join(target, '20260730144304_add_ltcm_versioning_audit_workflow.sql'),
      '\n-- alteração indevida\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(target, '20260730160000_second_pw902_fix.sql'),
      correctionSql,
      'utf8',
    );

    const issues = checkPw902Fix(target, testPath);
    assert.ok(issues.some((issue) => issue.includes('migration aplicada alterada')));
    assert.ok(issues.some((issue) => issue.includes('exatamente uma migration forward')));
  } finally {
    fs.rmSync(target, { force: true, recursive: true });
  }
});

test('rejeita ausência do PW902 e dos novos cenários de guarda', () => {
  const withoutPw902 = p007Sql.replace("errcode = 'PW902'", "errcode = 'PX902'");
  const withoutInvalid = p007Sql.replace(
    'guarda inválida foi aceita',
    'cenário de guarda removido',
  );

  assert.ok(scanPw902TestText(withoutPw902).some((issue) => issue.includes('PW902')));
  assert.ok(scanPw902TestText(withoutInvalid).some((issue) => issue.includes('guarda inválida')));
});
