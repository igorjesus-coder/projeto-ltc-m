import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { scanIntegrityTestText } from './check-integrity-tests.mjs';

const integritySql = fs.readFileSync(
  new URL('../database/audit/ltcm-integrity-tests.sql', import.meta.url),
  'utf8',
);

test('aceita o teste oficial transacional e restrito a ltc_m', () => {
  assert.deepEqual(scanIntegrityTestText(integritySql), []);
});

test('rejeita COMMIT ou ausência de ROLLBACK', () => {
  assert.notDeepEqual(scanIntegrityTestText(integritySql.replace('rollback;', 'commit;')), []);
  assert.notDeepEqual(scanIntegrityTestText(integritySql.replace('rollback;', '')), []);
});

test('rejeita escrita em valores controlados ou schema externo', () => {
  const seedWrite = integritySql.replace(
    'rollback;',
    "insert into ltc_m.currencies (code, name) values ('ZZZ', 'Forbidden');\nrollback;",
  );
  const externalWrite = integritySql.replace(
    'rollback;',
    'insert into public.projects (id) values (1);\nrollback;',
  );

  assert.notDeepEqual(scanIntegrityTestText(seedWrite), []);
  assert.notDeepEqual(scanIntegrityTestText(externalWrite), []);
});

test('rejeita operação destrutiva e cenário obrigatório ausente', () => {
  assert.notDeepEqual(scanIntegrityTestText(`${integritySql}\ndelete from ltc_m.projects;`), []);
  assert.ok(
    scanIntegrityTestText(
      integritySql.replace('auth_subject duplicado foi aceito', 'cenário removido'),
    ).some((issue) => issue.includes('auth_subject')),
  );
});
