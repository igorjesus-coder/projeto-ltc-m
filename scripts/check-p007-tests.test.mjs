import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { scanP007TestText } from './check-p007-tests.mjs';

const p007Sql = fs.readFileSync(
  new URL('../database/audit/ltcm-p007-tests.sql', import.meta.url),
  'utf8',
);

test('aceita o teste oficial P007 com rollback integral', () => {
  assert.deepEqual(scanP007TestText(p007Sql), []);
});

test('rejeita COMMIT, ausência de rollback e cenário obrigatório ausente', () => {
  assert.notDeepEqual(scanP007TestText(p007Sql.replace('rollback;', 'commit;')), []);
  assert.notDeepEqual(scanP007TestText(p007Sql.replace('rollback;', '')), []);
  assert.ok(
    scanP007TestText(
      p007Sql.replace('autoaprovação com dois admins foi aceita', 'cenário removido'),
    ).some((issue) => issue.includes('dois admins')),
  );
  assert.ok(
    scanP007TestText(p007Sql.replace('guarda inválida foi aceita', 'cenário removido')).some(
      (issue) => issue.includes('guarda inválida'),
    ),
  );
  assert.ok(
    scanP007TestText(p007Sql.replace('bloqueio direto foi aceito', 'cenário removido')).some(
      (issue) => issue.includes('bloqueio direto'),
    ),
  );
});

test('rejeita DDL, RLS, schema externo e mutação de valores controlados', () => {
  const ddl = p007Sql.replace('rollback;', 'alter table ltc_m.projects enable row level security;');
  const external = p007Sql.replace(
    'rollback;',
    'insert into public.projects (id) values (1);\nrollback;',
  );
  const controlled = p007Sql.replace(
    'rollback;',
    "update ltc_m.currencies set name = 'forbidden' where code = 'BRL';\nrollback;",
  );

  assert.notDeepEqual(scanP007TestText(ddl), []);
  assert.notDeepEqual(scanP007TestText(external), []);
  assert.notDeepEqual(scanP007TestText(controlled), []);
});
