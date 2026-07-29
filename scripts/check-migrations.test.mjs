import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { checkMigrations, scanMigrationText, stripSqlNoise } from './check-migrations.mjs';

function withMigrationDirectory(files, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ltcm-migrations-'));
  try {
    for (const [filename, sql] of Object.entries(files)) {
      fs.writeFileSync(path.join(directory, filename), sql, 'utf8');
    }
    callback(directory);
  } finally {
    fs.rmSync(directory, { force: true, recursive: true });
  }
}

const validSql = `
begin;
create schema ltc_m;
create type ltc_m.status_code as enum ('INSERT', 'UPDATE');
create table ltc_m.example (
  id uuid primary key,
  amount numeric(20, 2) not null,
  parent_id uuid references ltc_m.example (id)
);
create index ix_example_amount on ltc_m.example (amount);
comment on table ltc_m.example is 'DROP e DELETE neste comentário não são comandos';
commit;
`;

test('remove comentários e literais antes de analisar comandos', () => {
  const stripped = stripSqlNoise(validSql);

  assert.doesNotMatch(stripped, /DROP|DELETE|INSERT|UPDATE/);
  assert.deepEqual(scanMigrationText(validSql), []);
});

test('aceita migration aditiva, qualificada e com numeric', () => {
  withMigrationDirectory({ '20260729163000_create_ltcm_core.sql': validSql }, (directory) => {
    assert.deepEqual(checkMigrations(directory).issues, []);
  });
});

test('rejeita comandos proibidos, DML e SQL dinâmico', () => {
  const issues = scanMigrationText(`
    create table ltc_m.example (id uuid);
    insert into ltc_m.example values (gen_random_uuid());
    alter table ltc_m.example add column name text;
    do $$ begin execute 'drop table public.example'; end $$;
  `);

  assert.ok(issues.some((issue) => issue.includes('INSERT')));
  assert.ok(issues.some((issue) => issue.includes('ALTER TABLE')));
  assert.ok(issues.some((issue) => issue.includes('bloco dinâmico')));
});

test('rejeita schemas externos e objetos não qualificados', () => {
  const external = scanMigrationText(`
    create table public.example (id uuid references auth.users (id));
  `);
  const unqualified = scanMigrationText(`
    create table example (id uuid references ltc_m.app_users (id));
  `);

  assert.ok(external.some((issue) => issue.includes('schema externo')));
  assert.ok(unqualified.some((issue) => issue.includes('sem qualificação')));
});

test('rejeita tipos monetários imprecisos', () => {
  for (const type of ['money', 'real', 'float8', 'double precision']) {
    const issues = scanMigrationText(`create table ltc_m.amounts (amount ${type});`);
    assert.ok(issues.some((issue) => issue.includes('impreciso')));
  }
});

test('rejeita migration vazia e diretório sem migrations', () => {
  assert.ok(scanMigrationText('-- somente comentário').includes('migration vazia'));

  withMigrationDirectory({}, (directory) => {
    assert.deepEqual(checkMigrations(directory).issues, ['nenhuma migration SQL encontrada']);
  });
});

test('rejeita timestamps inválidos ou duplicados', () => {
  withMigrationDirectory(
    {
      '20261301120000_invalid_month.sql': validSql,
      '20261301120000_second.sql': validSql,
    },
    (directory) => {
      const issues = checkMigrations(directory).issues;
      assert.ok(issues.some((issue) => issue.includes('timestamp inválido')));
      assert.ok(issues.some((issue) => issue.includes('timestamp duplicado')));
      assert.ok(issues.some((issue) => issue.includes('ordem de timestamp inválida')));
    },
  );
});
