import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractSyntheticCurrencyCodes,
  scanSyntheticCurrencyFixtures,
} from './check-d40-tests.mjs';
import { buildConcurrencySql } from './run-postgres-concurrency-test.mjs';

test('cenários concorrentes usam duas ordens e locks limitados', () => {
  const sql = buildConcurrencySql();
  assert.match(sql.linkFirst, /insert into ltc_m\.projects/iu);
  assert.match(sql.linkFirst, /pg_sleep\(2\)/iu);
  assert.match(sql.rejectFirst, /status = 'rejected'/iu);
  assert.match(sql.rejectSecond, /status = 'rejected'[\s\S]*pg_sleep\(2\)/iu);
  assert.match(sql.linkSecond, /insert into ltc_m\.projects/iu);
  for (const source of [sql.linkFirst, sql.rejectFirst, sql.rejectSecond, sql.linkSecond]) {
    assert.match(source, /set local lock_timeout = '8s'/iu);
  }
  for (const source of Object.values(sql)) {
    assert.doesNotMatch(source, /https?:\/\//iu);
    assert.doesNotMatch(source, /supabase/iu);
  }
});

test('SQL concorrente usa apenas a moeda sintética ZZZ válida', () => {
  const sql = buildConcurrencySql();
  const source = Object.values(sql).join('\n');
  assert.deepEqual(extractSyntheticCurrencyCodes(source), ['ZZZ']);
  assert.deepEqual(scanSyntheticCurrencyFixtures(source, { requireInsert: true }), []);
  assert.doesNotMatch(sql.setup, /values\s*\(\s*'C43'/iu);
  assert.doesNotMatch(`${sql.linkFirst}\n${sql.linkSecond}`, /'C43'\s*,\s*100/gu);
  assert.match(sql.linkFirst, /'ZZZ'\s*,\s*100/gu);
  assert.match(sql.linkSecond, /'ZZZ'\s*,\s*100/gu);
});

test('validação monetária rejeita a versão concorrente com C43', () => {
  const invalidSetup = buildConcurrencySql().setup.replace("'ZZZ'", "'C43'");
  assert.ok(
    scanSyntheticCurrencyFixtures(invalidSetup, { requireInsert: true }).some((issue) =>
      issue.includes('inválido'),
    ),
  );
});

test('fixtures concorrentes são exclusivamente sintéticas', () => {
  const source = Object.values(buildConcurrencySql()).join('\n');
  assert.match(source, /sintétic/iu);
  assert.doesNotMatch(source, /\.xlsx/iu);
  assert.doesNotMatch(source, /delete\s+from\s+ltc_m/iu);
});
