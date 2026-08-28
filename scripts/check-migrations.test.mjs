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

test('aceita os artefatos RLS P008 versionados', () => {
  const migrationsDirectory = path.resolve('supabase', 'migrations');
  const result = checkMigrations(migrationsDirectory);

  assert.deepEqual(result.issues, []);
  assert.equal(result.files.length, 14);
});

test('aceita somente o contrato nominal da migration D40', () => {
  const migrationName = '20260804120000_add_legacy_project_reference_date_exception.sql';
  const sql = fs.readFileSync(path.resolve('supabase', 'migrations', migrationName), 'utf8');

  assert.deepEqual(scanMigrationText(sql, { migrationName }), []);
});

test('D40 rejeita nullable global, is_legacy, objeto extra e SECURITY DEFINER não autorizado', () => {
  const migrationName = '20260804120000_add_legacy_project_reference_date_exception.sql';
  const issues = scanMigrationText(
    `
      alter table ltc_m.projects alter column data_reference_date drop not null;
      alter table ltc_m.projects add column is_legacy boolean;
      create function ltc_m.unapproved_d40()
      returns trigger language plpgsql security definer set search_path = ''
      as $function$ begin return new; end; $function$;
      create trigger trg_unapproved before update on ltc_m.projects
      for each row execute function ltc_m.unapproved_d40();
    `,
    { migrationName },
  );

  assert.ok(issues.some((issue) => issue.includes('allowlist nominal D40')));
  assert.ok(issues.some((issue) => issue.includes('is_legacy')));
  assert.ok(issues.some((issue) => issue.includes('SECURITY DEFINER')));
  assert.ok(issues.some((issue) => issue.includes('incompleta ou divergente')));
});

test('D40 rejeita DROP NOT NULL em outra coluna e data artificial', () => {
  const migrationName = '20260804120000_add_legacy_project_reference_date_exception.sql';
  const issues = scanMigrationText(
    `
      alter table ltc_m.projects alter column start_date drop not null;
      select current_date;
    `,
    { migrationName },
  );

  assert.ok(issues.some((issue) => issue.includes('allowlist nominal D40')));
  assert.ok(issues.some((issue) => issue.includes('data artificial')));
});

test('D41 rejeita filtro histórico, alteração automática e trigger em outra tabela', () => {
  const migrationName = '20260804120000_add_legacy_project_reference_date_exception.sql';
  const official = fs.readFileSync(path.resolve('supabase', 'migrations', migrationName), 'utf8');
  const filtered = official.replace(
    'where project.legacy_import_batch_id = new.id',
    'where project.legacy_import_batch_id = new.id and project.deleted_at is null',
  );
  const mutating = official.replace(
    'if exists (\n        select 1\n        from ltc_m.projects as project',
    'update ltc_m.projects set legacy_import_batch_id = null;\n\n    if exists (\n        select 1\n        from ltc_m.projects as project',
  );
  const wrongTable = official.replace(
    'before update on ltc_m.import_batches',
    'before update on ltc_m.projects',
  );
  const invoker = official.replace(
    'create function ltc_m.enforce_import_batch_rejection_guard()\nreturns trigger\nlanguage plpgsql\nsecurity definer',
    'create function ltc_m.enforce_import_batch_rejection_guard()\nreturns trigger\nlanguage plpgsql\nsecurity invoker',
  );

  assert.ok(
    scanMigrationText(filtered, { migrationName }).some((issue) => issue.includes('sem filtro')),
  );
  assert.ok(
    scanMigrationText(mutating, { migrationName }).some((issue) =>
      issue.includes('alterar projetos'),
    ),
  );
  assert.ok(
    scanMigrationText(wrongTable, { migrationName }).some((issue) =>
      issue.includes('incompleta ou divergente'),
    ),
  );
  assert.ok(
    scanMigrationText(invoker, { migrationName }).some((issue) =>
      issue.includes('SECURITY DEFINER trigger-only'),
    ),
  );
});

test('D41 exige serialização do vínculo e proíbe CASCADE', () => {
  const migrationName = '20260804120000_add_legacy_project_reference_date_exception.sql';
  const official = fs.readFileSync(path.resolve('supabase', 'migrations', migrationName), 'utf8');
  const unsafe = official
    .replace('for share;', ';')
    .replace('on delete no action', 'on delete cascade');
  const issues = scanMigrationText(unsafe, { migrationName });

  assert.ok(issues.some((issue) => issue.includes('FOR SHARE')));
  assert.ok(issues.some((issue) => issue.includes('CASCADE')));
});

test('rejeita desvios de role, policy e grants do modelo P008', () => {
  const issues = scanMigrationText(`
    create role attacker;
    alter table ltc_m.projects enable row level security;
    create policy projects_delete on ltc_m.projects
      for delete to ltc_m_runtime using (true);
    create policy clients_insert on ltc_m.clients
      for insert to ltc_m_runtime;
    grant delete on table ltc_m.projects to ltc_m_runtime;
    grant select on table public.projects to ltc_m_runtime;
    grant select on table ltc_m.projects to attacker;
  `);

  assert.ok(issues.some((issue) => issue.includes('somente a role ltc_m_runtime')));
  assert.ok(issues.some((issue) => issue.includes('DELETE ou FOR ALL')));
  assert.ok(issues.some((issue) => issue.includes('WITH CHECK')));
  assert.ok(issues.some((issue) => issue.includes('privilégio proibido')));
  assert.ok(issues.some((issue) => issue.includes('objetos ltc_m')));
  assert.ok(issues.some((issue) => issue.includes('somente para ltc_m_runtime')));
});

test('rejeita fontes de identidade externas e ownership da runtime', () => {
  const issues = scanMigrationText(`
    alter table ltc_m.projects owner to ltc_m_runtime;
    select auth.uid();
    select current_setting('request.jwt.claims', true);
  `);

  assert.ok(issues.some((issue) => issue.includes('ownership')));
  assert.ok(issues.some((issue) => issue.includes('JWT ou Supabase Auth')));
  assert.ok(issues.some((issue) => issue.includes('role ou JWT em GUC')));
});

test('rejeita alteração em migration já aplicada', () => {
  withMigrationDirectory(
    { '20260729163000_create_ltcm_relational_core.sql': `${validSql}\n-- alterada` },
    (directory) => {
      const issues = checkMigrations(directory).issues;
      assert.ok(issues.some((issue) => issue.includes('migration aplicada foi alterada')));
    },
  );
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
  assert.ok(issues.some((issue) => issue.includes('fora do escopo P007')));
  assert.ok(issues.some((issue) => issue.includes('DO permitido')));
});

test('aceita ADD CONSTRAINT aditivo e índice qualificado em ltc_m', () => {
  const issues = scanMigrationText(`
    alter table ltc_m.projects
      add constraint ck_projects_example check (version > 0);
    create index ix_projects_example on ltc_m.projects (client_id, status);
  `);

  assert.deepEqual(issues, []);
});

test('rejeita FK e índice fora de ltc_m', () => {
  const externalForeignKey = scanMigrationText(`
    alter table ltc_m.projects
      add constraint fk_projects_external
      foreign key (client_id) references public.clients (id);
  `);
  const externalIndex = scanMigrationText(`
    create index ix_external_example on public.projects (id);
  `);

  assert.ok(externalForeignKey.some((issue) => issue.includes('schema externo')));
  assert.ok(externalIndex.some((issue) => issue.includes('fora de ltc_m')));
});

test('rejeita ALTER TABLE não aditivo', () => {
  const issues = scanMigrationText(`
    alter table ltc_m.projects add column external_code text;
  `);

  assert.ok(issues.some((issue) => issue.includes('fora do escopo P007')));
});

test('aceita colunas, enum, função e trigger estritamente aprovados para P007', () => {
  const issues = scanMigrationText(`
    alter type ltc_m.plan_status
      add value 'pending_approval' after 'draft';
    alter table ltc_m.app_users
      add column row_version bigint not null default 1,
      add constraint ck_app_users_row_version check (row_version > 0);
    create function ltc_m.current_actor_id(p_required boolean default false)
    returns uuid
    language plpgsql
    security invoker
    set search_path = ''
    as $function$
    begin
      update ltc_m.app_users
      set row_version = row_version + 1
      where false;
      return null;
    end;
    $function$;
    create trigger trg_example
    before update on ltc_m.app_users
    for each row execute function ltc_m.current_actor_id();
  `);

  assert.deepEqual(issues, []);
});

test('rejeita função insegura, SECURITY DEFINER não aprovado e trigger externo', () => {
  const issues = scanMigrationText(`
    create function ltc_m.unapproved()
    returns void
    language plpgsql
    security definer
    set search_path = ''
    as $function$
    begin
      execute 'update public.example set value = 1';
    end;
    $function$;
    create trigger trg_external
    before update on public.example
    for each row execute function ltc_m.unapproved();
  `);

  assert.ok(issues.some((issue) => issue.includes('SECURITY DEFINER')));
  assert.ok(issues.some((issue) => issue.includes('SQL dinâmico')));
  assert.ok(issues.some((issue) => issue.includes('schema externo')));
  assert.ok(issues.some((issue) => issue.includes('trigger')));
});

test('inspeciona CREATE OR REPLACE FUNCTION com as mesmas regras de segurança', () => {
  const valid = scanMigrationText(`
    create or replace function ltc_m.workflow_guard_active(p_action text)
    returns boolean
    language sql
    security invoker
    set search_path = ''
    as $function$
      select coalesce(p_action = 'submit', false);
    $function$;
  `);
  const external = scanMigrationText(`
    create or replace function public.workflow_guard_active(p_action text)
    returns boolean
    language sql
    security invoker
    set search_path = ''
    as $function$
      select true;
    $function$;
  `);

  assert.deepEqual(valid, []);
  assert.ok(external.some((issue) => issue.includes('schema externo')));
  assert.ok(external.some((issue) => issue.includes('sem qualificação')));
});

test('rejeita RLS, policy e alterações de enum fora do fluxo P007', () => {
  const issues = scanMigrationText(`
    alter table ltc_m.unknown enable row level security;
    create policy projects_policy on ltc_m.projects for select using (true);
    alter type ltc_m.plan_status add value 'invented';
  `);

  assert.ok(issues.some((issue) => issue.includes('RLS')));
  assert.ok(issues.some((issue) => issue.includes('policy')));
  assert.ok(issues.some((issue) => issue.includes('ALTER TYPE')));
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

test('rejeita nomes duplicados de constraints e índices entre migrations', () => {
  withMigrationDirectory(
    {
      '20260729163000_first.sql': `
        create table ltc_m.first (
          id uuid primary key,
          constraint ck_duplicate check (id is not null)
        );
        create index ix_duplicate on ltc_m.first (id);
      `,
      '20260730103002_second.sql': `
        alter table ltc_m.first
          add constraint ck_duplicate check (id is not null);
        create index ix_duplicate on ltc_m.first (id);
      `,
    },
    (directory) => {
      const issues = checkMigrations(directory).issues;
      assert.ok(issues.some((issue) => issue.includes('constraint duplicado')));
      assert.ok(issues.some((issue) => issue.includes('índice duplicado')));
    },
  );
});
