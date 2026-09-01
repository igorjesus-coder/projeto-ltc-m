import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { applyApprovedSeed, scanSeedText } from './check-seeds.mjs';

const seedSql = fs.readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8');

test('seed oficial contém somente BRL e US e passa no scanner', () => {
  assert.deepEqual(scanSeedText(seedSql), []);
});

test('primeira execução insere BRL e US; segunda é idempotente', () => {
  const first = applyApprovedSeed({ currencies: [], units: [] });
  const second = applyApprovedSeed(first);

  assert.deepEqual(first, {
    currencies: [
      { code: 'BRL', name: 'Real brasileiro', decimalPlaces: 2, active: true },
      { code: 'USD', name: 'Dólar americano', decimalPlaces: 2, active: true },
    ],
    units: [{ code: 'US', name: 'Unidade e Serviço', category: null, active: true }],
  });
  assert.deepEqual(second, first);
});

test('US divergente é rejeitada sem aplicação parcial', () => {
  const initial = {
    currencies: [],
    units: [{ code: 'US', name: 'Outro nome', category: null, active: true }],
  };

  assert.throws(() => applyApprovedSeed(initial), /US divergente/);
  assert.deepEqual(initial.currencies, []);
});

test('BRL divergente é rejeitado sem atualizar o registro', () => {
  const initial = {
    currencies: [{ code: 'BRL', name: 'Outro nome', decimalPlaces: 2, active: true }],
    units: [],
  };

  assert.throws(() => applyApprovedSeed(initial), /BRL divergente/);
  assert.equal(initial.currencies[0].name, 'Outro nome');
  assert.deepEqual(initial.units, []);
});

test('scanner rejeita comandos destrutivos, updates e schema externo', () => {
  for (const fragment of [
    'delete from ltc_m.units;',
    'truncate table ltc_m.units;',
    'drop table ltc_m.units;',
    'alter table ltc_m.units add column symbol text;',
    "update ltc_m.units set name = 'X';",
    'select * from public.units;',
  ]) {
    assert.notDeepEqual(scanSeedText(`${seedSql}\n${fragment}`), []);
  }
});

test('scanner rejeita entidades, moedas e unidades adicionais', () => {
  const extraCurrency = seedSql.replace(
    'commit;',
    "insert into ltc_m.currencies (code, name, decimal_places, active)\nselect 'USD', 'Dollar', 2, true;\ncommit;",
  );
  const extraUnit = seedSql.replace(
    'commit;',
    "insert into ltc_m.units (code, name, active)\nselect 'UN', 'Unidade', true;\ncommit;",
  );
  const projectSeed = seedSql.replace(
    'commit;',
    "insert into ltc_m.projects (project_code) select '2026-01-00001';\ncommit;",
  );
  const unionCurrency = seedSql.replace(
    "select 'BRL', 'Real brasileiro', 2, true",
    "select 'BRL', 'Real brasileiro', 2, true union all select 'USD', 'Dollar', 2, true",
  );

  assert.ok(scanSeedText(extraCurrency).some((issue) => issue.includes('moeda')));
  assert.ok(scanSeedText(extraUnit).some((issue) => issue.includes('unidade')));
  assert.ok(scanSeedText(projectSeed).some((issue) => issue.includes('não aprovada')));
  assert.ok(scanSeedText(unionCurrency).some((issue) => issue.includes('moeda')));
});

test('scanner rejeita nome incorreto, Auth, credenciais, dados reais e seed vazio', () => {
  assert.ok(
    scanSeedText(seedSql.replaceAll('Unidade e Serviço', 'Unidade de Serviço')).some((issue) =>
      issue.includes('US'),
    ),
  );
  assert.notDeepEqual(scanSeedText(`${seedSql}\nselect auth.uid();`), []);
  assert.notDeepEqual(scanSeedText(`${seedSql}\n-- DATABASE_URL=postgresql://secret`), []);
  assert.notDeepEqual(scanSeedText(`${seedSql}\n-- pessoa@example.com`), []);
  assert.ok(scanSeedText('').includes('seed vazio'));
});

test('scanner exige atomicidade, locks e validações antes das inserções', () => {
  assert.notDeepEqual(scanSeedText(seedSql.replace('begin;', '')), []);
  assert.notDeepEqual(
    scanSeedText(seedSql.replace('lock table ltc_m.units in share row exclusive mode;', '')),
    [],
  );
  assert.notDeepEqual(scanSeedText(seedSql.replace('raise exception', 'raise notice')), []);
});
