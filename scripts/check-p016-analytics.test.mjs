import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { P016_MIGRATION, scanP016Sources } from './check-p016-analytics.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

async function official() {
  return {
    migration: await readFile(`${root}/supabase/migrations/${P016_MIGRATION}`, 'utf8'),
    documentation: await readFile(`${root}/docs/analytics/p016-tableau-views.md`, 'utf8'),
    rootPackage: await readFile(`${root}/package.json`, 'utf8'),
    workflow: await readFile(`${root}/.github/workflows/ltcm-postgres-validation.yml`, 'utf8'),
    runner: await readFile(`${root}/scripts/run-postgres-ci-validation.mjs`, 'utf8'),
    tests: await readFile(
      `${root}/tools/ltcm-normalizer/test/postgres-tableau-analytics.integration.test.ts`,
      'utf8',
    ),
  };
}

test('aceita contrato P016 completo e integrado ao CI PostgreSQL', async () => {
  assert.deepEqual(scanP016Sources(await official()), []);
});

test('rejeita perda de view, security-invoker e janela ROWS', async () => {
  const value = await official();
  for (const migration of [
    value.migration.replace(
      'create view ltc_m.v_tableau_project_items',
      'create materialized view ltc_m.v_tableau_project_items',
    ),
    value.migration.replace('security_invoker = true', 'security_invoker = false'),
    value.migration.replaceAll(
      'rows between unbounded preceding and current row',
      'range between unbounded preceding and current row',
    ),
    value.migration.replace(
      'count(distinct monthly_plan_import_executions.source_artifact_id)',
      'count(monthly_plan_import_executions.source_artifact_id)',
    ),
  ]) {
    assert.notDeepEqual(scanP016Sources({ ...value, migration }), []);
  }
});

test('rejeita writer, alocação, float e COALESCE de realizado ausente', async () => {
  const value = await official();
  for (const injection of [
    'insert into ltc_m.projects values (default);',
    'select * from generate_series(1, 9); -- allocation',
    'select 1::double precision;',
    'select coalesce(billing_actual_canonical_amount, 0);',
  ]) {
    assert.notDeepEqual(
      scanP016Sources({ ...value, migration: `${value.migration}\n${injection}` }),
      [],
    );
  }
});

test('rejeita perda de documentação, teste PostgreSQL ou estágio CI', async () => {
  const value = await official();
  assert.notDeepEqual(
    scanP016Sources({
      ...value,
      documentation: value.documentation.replace('2800460.18', 'removed'),
    }),
    [],
  );
  assert.notDeepEqual(
    scanP016Sources({ ...value, tests: value.tests.replace('transaction read only', 'removed') }),
    [],
  );
  assert.notDeepEqual(
    scanP016Sources({
      ...value,
      runner: value.runner.replace("runStage('p016_postgres'", "runStage('removed'"),
    }),
    [],
  );
});
