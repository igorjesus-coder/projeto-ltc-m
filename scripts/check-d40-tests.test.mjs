import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  D40_SCENARIO_COUNT,
  checkD40,
  extractSyntheticCurrencyCodes,
  isValidSyntheticCurrencyCode,
  scanD40HarnessText,
  scanSyntheticCurrencyFixtures,
} from './check-d40-tests.mjs';

test('valida o domínio nominal de moedas sintéticas', () => {
  for (const code of ['BRL', 'USD', 'ZZZ']) {
    assert.equal(isValidSyntheticCurrencyCode(code), true, code);
  }
  for (const code of [
    'D40',
    'C43',
    'brl',
    'BrL',
    'BR1',
    'BR-L',
    'BR_L',
    'BR ',
    ' BR',
    'A$',
    'ÁBC',
  ]) {
    assert.equal(isValidSyntheticCurrencyCode(code), false, code);
  }
});

test('aceita migration e harness D40 versionados', () => {
  assert.deepEqual(checkD40(), []);
});

test('harness D40 oficial usa ZZZ e preserva os 47 cenários', () => {
  const official = fs.readFileSync('database/audit/ltcm-d40-tests.sql', 'utf8');
  assert.deepEqual(extractSyntheticCurrencyCodes(official), ['ZZZ']);
  assert.deepEqual(scanSyntheticCurrencyFixtures(official, { requireInsert: true }), []);
  assert.doesNotMatch(official, /\bltc_m\.currencies[\s\S]*?values\s*\(\s*'D40'/iu);
  assert.doesNotMatch(official, /'D40'\s*,\s*100/gu);
  assert.match(official, /D40-NORMAL/u);
  assert.equal(D40_SCENARIO_COUNT, 47);
  assert.deepEqual(scanD40HarnessText(official), []);
});

test('scanner monetário falha fechado para código inválido e INSERT não reconhecido', () => {
  const invalidCode = `
    insert into ltc_m.currencies (code, name, decimal_places, active)
    values ('C43', 'Inválida', 2, true);
  `;
  const unrecognizedInsert = `
    insert into ltc_m.currencies (name, code, decimal_places, active)
    values ('Inválida', 'ZZZ', 2, true);
  `;
  assert.ok(
    scanSyntheticCurrencyFixtures(invalidCode, { requireInsert: true }).some((issue) =>
      issue.includes('inválido'),
    ),
  );
  assert.ok(
    scanSyntheticCurrencyFixtures(unrecognizedInsert, { requireInsert: true }).some((issue) =>
      issue.includes('formato nominal'),
    ),
  );
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
