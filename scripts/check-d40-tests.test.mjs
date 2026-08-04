import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { checkD40, scanD40HarnessText } from './check-d40-tests.mjs';

test('aceita migration e harness D40 versionados', () => {
  assert.deepEqual(checkD40(), []);
});

test('rejeita harness sem rollback, com commit, DDL, rede ou credencial', () => {
  const issues = scanD40HarnessText(`
    begin;
    create table ltc_m.extra (id integer);
    insert into public.clients values (1);
    select 'https://example.invalid', 'password';
    commit;
  `);
  assert.ok(issues.some((issue) => issue.includes('ROLLBACK')));
  assert.ok(issues.some((issue) => issue.includes('COMMIT')));
  assert.ok(issues.some((issue) => issue.includes('DDL')));
  assert.ok(issues.some((issue) => issue.includes('rede ou credencial')));
  assert.ok(issues.some((issue) => issue.includes('fora de ltc_m')));
});

test('rejeita remoção de cenário obrigatório', () => {
  const official = fs.readFileSync('database/audit/ltcm-d40-tests.sql', 'utf8');
  assert.ok(
    scanD40HarnessText(official.replaceAll('Admin sem request ID', 'contexto removido')).some(
      (issue) => issue.includes('request obrigatório'),
    ),
  );
});

test('rejeita remoção de cenário D41 obrigatório', () => {
  const official = fs.readFileSync('database/audit/ltcm-d40-tests.sql', 'utf8');
  assert.ok(
    scanD40HarnessText(
      official.replaceAll('correção parcial liberou o lote antigo', 'cenário removido'),
    ).some((issue) => issue.includes('D41 correção parcial')),
  );
});
