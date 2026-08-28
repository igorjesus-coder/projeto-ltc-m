import assert from 'node:assert/strict';
import test from 'node:test';

import { loadP019SchemaSnapshot, renderP019DatabaseTypes } from './generate-p019-db-types.mjs';
import { createSnapshot } from './generate-p017-schema-docs.mjs';

test('gera tipos P019 determinísticos a partir do snapshot P017', async () => {
  const snapshot = await loadP019SchemaSnapshot();
  const first = renderP019DatabaseTypes(snapshot);
  const second = renderP019DatabaseTypes(structuredClone(snapshot));
  assert.equal(first, second);
  assert.match(first, new RegExp(snapshot.fingerprint, 'u'));
  assert.match(first, /GENERATED FILE — DO NOT EDIT/u);
});

test('preserva numeric, bigint, nullability e enums sem number inseguro', async () => {
  const output = renderP019DatabaseTypes(await loadP019SchemaSnapshot());
  assert.match(output, /export type PgNumeric = string;/u);
  assert.match(output, /export type PgBigInt = string;/u);
  assert.match(output, /contract_value: PgNumeric;/u);
  assert.match(output, /opening_balance: PgNumeric \| null;/u);
  assert.match(output, /export type AppRoleEnum = "viewer" \| "editor" \| "approver" \| "admin";/u);
  assert.doesNotMatch(output, /type PgNumeric = number/u);
});

test('falha claramente diante de tipo PostgreSQL desconhecido', async () => {
  const snapshot = await loadP019SchemaSnapshot();
  const changed = structuredClone(snapshot);
  changed.model.relations[0].columns[0].type = 'ltc_m.unsupported_domain';
  changed.model.types = [];
  const internallyConsistent = createSnapshot(changed.model, changed.migrationCount);
  assert.throws(
    () => renderP019DatabaseTypes(internallyConsistent),
    /P019_POSTGRES_TYPE_UNSUPPORTED/u,
  );
});
