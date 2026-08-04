import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConcurrencySql } from './run-postgres-concurrency-test.mjs';

test('cenários concorrentes usam duas ordens e locks limitados', () => {
  const sql = buildConcurrencySql();
  assert.match(sql.linkFirst, /insert into ltc_m\.projects/iu);
  assert.match(sql.linkFirst, /pg_sleep\(2\)/iu);
  assert.match(sql.rejectFirst, /status = 'rejected'/iu);
  assert.match(sql.rejectSecond, /status = 'rejected'[\s\S]*pg_sleep\(2\)/iu);
  assert.match(sql.linkSecond, /insert into ltc_m\.projects/iu);
  for (const source of Object.values(sql)) {
    assert.doesNotMatch(source, /https?:\/\//iu);
    assert.doesNotMatch(source, /supabase/iu);
  }
});

test('fixtures concorrentes são exclusivamente sintéticas', () => {
  const source = Object.values(buildConcurrencySql()).join('\n');
  assert.match(source, /sintétic/iu);
  assert.doesNotMatch(source, /\.xlsx/iu);
  assert.doesNotMatch(source, /delete\s+from\s+ltc_m/iu);
});
