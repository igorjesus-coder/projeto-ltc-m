import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fingerprintExternalRows,
  normalizeInventoryRows,
  summarizeInventory,
} from './collect-db-inventory.mjs';

const rows = [
  {
    object_kind: 'table',
    schema_name: 'public',
    object_name: 'existing',
    detail: 'owner=postgres',
    definition_hash: 'AAA',
  },
  {
    object_kind: 'schema',
    schema_name: 'ltc_m',
    object_name: 'ltc_m',
    detail: 'owner=postgres',
    definition_hash: 'BBB',
  },
  {
    object_kind: 'table',
    schema_name: 'supabase_migrations',
    object_name: 'schema_migrations',
    detail: 'owner=postgres',
    definition_hash: 'CCC',
  },
];

test('normaliza e ordena metadados determinísticamente', () => {
  const normalized = normalizeInventoryRows([...rows].reverse());

  assert.deepEqual(
    normalized.map((row) => `${row.schema_name}.${row.object_name}`),
    ['ltc_m.ltc_m', 'public.existing', 'supabase_migrations.schema_migrations'],
  );
});

test('fingerprint ignora ltc_m e supabase_migrations', () => {
  const baseline = fingerprintExternalRows(rows);
  const withDifferentLtcm = fingerprintExternalRows([
    ...rows,
    {
      object_kind: 'table',
      schema_name: 'ltc_m',
      object_name: 'projects',
      detail: '',
      definition_hash: 'DDD',
    },
  ]);

  assert.equal(withDifferentLtcm, baseline);
});

test('fingerprint muda quando metadado externo muda', () => {
  const baseline = fingerprintExternalRows(rows);
  const changed = rows.map((row) =>
    row.schema_name === 'public' ? { ...row, definition_hash: 'CHANGED' } : row,
  );

  assert.notEqual(fingerprintExternalRows(changed), baseline);
});

test('sumário contabiliza objetos e schemas', () => {
  assert.deepEqual(summarizeInventory(rows), {
    totalObjects: 3,
    ltcmObjects: 1,
    byKind: { schema: 1, table: 2 },
    bySchema: { ltc_m: 1, public: 1, supabase_migrations: 1 },
  });
});
