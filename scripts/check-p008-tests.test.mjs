import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  comparePolicyInventories,
  compareRlsInventories,
  extractP008PolicyInventory,
  extractP008RlsInventory,
  scanP008TestText,
} from './check-p008-tests.mjs';

const p008Sql = fs.readFileSync(
  new URL('../database/audit/ltcm-p008-rls-tests.sql', import.meta.url),
  'utf8',
);

test('aceita a suíte oficial P008 com rollback integral', () => {
  assert.deepEqual(scanP008TestText(p008Sql), []);
});

test('rejeita COMMIT, ausência de rollback e cenário obrigatório ausente', () => {
  assert.notDeepEqual(scanP008TestText(p008Sql.replace('rollback;', 'commit;')), []);
  assert.notDeepEqual(scanP008TestText(p008Sql.replace('rollback;', '')), []);
  assert.ok(
    scanP008TestText(p008Sql.replace('último admin foi inativado', 'cenário removido')).some(
      (issue) => issue.includes('último admin'),
    ),
  );
});

test('rejeita DDL, role externa, credencial e mutação fora do escopo', () => {
  const ddl = p008Sql.replace('rollback;', 'alter table ltc_m.clients disable row level security;');
  const role = p008Sql.replace('set local role ltc_m_runtime;', 'set local role postgres;');
  const credential = p008Sql.replace('rollback;', "select 'client_secret';\nrollback;");
  const external = p008Sql.replace(
    'rollback;',
    'insert into public.example (id) values (1);\nrollback;',
  );

  assert.notDeepEqual(scanP008TestText(ddl), []);
  assert.notDeepEqual(scanP008TestText(role), []);
  assert.notDeepEqual(scanP008TestText(credential), []);
  assert.notDeepEqual(scanP008TestText(external), []);
});

test('exige evidência de current_actor_id e do DML completo do Editor', () => {
  const withoutActorEvidence = p008Sql.replace(
    'P008 falhou: current_actor_id não está na allowlist D28.',
    'P008 falhou: dependência de contexto ausente.',
  );
  const withoutEditorDml = p008Sql.replace(
    /do\s+\$editor\$[\s\S]*?\$editor\$;/i,
    'do $editor$ begin null; end; $editor$;',
  );

  assert.ok(
    scanP008TestText(withoutActorEvidence).some((issue) => issue.includes('current_actor_id')),
  );
  assert.ok(
    scanP008TestText(withoutEditorDml).some((issue) => issue.includes('Editor DML completo')),
  );
});

const canonicalPolicies = extractP008PolicyInventory(p008Sql);
const canonicalRlsTables = extractP008RlsInventory(p008Sql);
const clonePolicies = () => structuredClone(canonicalPolicies);

test('aceita o inventário canônico de 49 policies e 19 tabelas protegidas', () => {
  assert.equal(canonicalPolicies.length, 49);
  assert.equal(canonicalRlsTables.length, 19);
  assert.deepEqual(comparePolicyInventories(canonicalPolicies, clonePolicies()), {
    missing: [],
    unexpected: [],
    changed: [],
  });
  assert.deepEqual(
    compareRlsInventories(
      canonicalRlsTables,
      canonicalRlsTables.map((tablename) => ({
        tablename,
        rls_enabled: true,
        force_rls_enabled: true,
      })),
    ),
    { missing: [], unexpected: [], changed: [] },
  );
});

test('falha fechado quando uma policy esperada está ausente', () => {
  const actual = clonePolicies();
  const removed = actual.pop();
  assert.deepEqual(comparePolicyInventories(canonicalPolicies, actual).missing, [
    `${removed.schemaname}.${removed.tablename}.${removed.policyname}`,
  ]);
});

test('falha fechado para policy inesperada', () => {
  const actual = clonePolicies();
  actual.push({
    ...actual[0],
    tablename: 'unexpected_table',
    policyname: 'unexpected_policy',
  });
  assert.equal(comparePolicyInventories(canonicalPolicies, actual).unexpected.length, 1);
});

test('falha fechado para substituição compensatória mantendo total 49', () => {
  const actual = clonePolicies();
  actual.shift();
  actual.push({
    ...actual[0],
    tablename: 'unexpected_table',
    policyname: 'compensating_policy',
  });
  const comparison = comparePolicyInventories(canonicalPolicies, actual);
  assert.equal(actual.length, 49);
  assert.equal(comparison.missing.length, 1);
  assert.equal(comparison.unexpected.length, 1);
});

for (const [name, field, value] of [
  ['command', 'cmd', 'UPDATE'],
  ['role', 'roles', '{PUBLIC}'],
  ['permissiveness', 'permissive', 'RESTRICTIVE'],
  ['USING', 'qual_md5', '0'.repeat(32)],
  ['WITH CHECK', 'with_check_md5', 'f'.repeat(32)],
]) {
  test(`falha fechado para mutação de ${name}`, () => {
    const actual = clonePolicies();
    const target = actual.find((policy) => policy.policyname === 'monthly_plan_cells_select_p013');
    target[field] = value;
    assert.deepEqual(comparePolicyInventories(canonicalPolicies, actual).changed, [
      'ltc_m.monthly_plan_cells.monthly_plan_cells_select_p013',
    ]);
  });
}

test('falha fechado quando RLS está desligado', () => {
  const actual = canonicalRlsTables.map((tablename) => ({
    tablename,
    rls_enabled: tablename !== 'monthly_plan_cells',
    force_rls_enabled: true,
  }));
  assert.deepEqual(compareRlsInventories(canonicalRlsTables, actual).changed, [
    'monthly_plan_cells',
  ]);
});

test('falha fechado quando FORCE RLS está desligado', () => {
  const actual = canonicalRlsTables.map((tablename) => ({
    tablename,
    rls_enabled: true,
    force_rls_enabled: tablename !== 'monthly_plan_cells',
  }));
  assert.deepEqual(compareRlsInventories(canonicalRlsTables, actual).changed, [
    'monthly_plan_cells',
  ]);
});

test('checker rejeita regressão para contagem cega ou comparação unilateral', () => {
  const blindCount = p008Sql.replace(
    'if\n        v_missing_count <> 0',
    'if v_count <> 49 then null; end if;\n    if\n        v_missing_count <> 0',
  );
  const unilateral = p008Sql.replaceAll('where not exists (', 'where exists (');
  assert.ok(scanP008TestText(blindCount).some((issue) => issue.includes('contagem literal')));
  assert.ok(scanP008TestText(unilateral).some((issue) => issue.includes('bidirecional')));
});
