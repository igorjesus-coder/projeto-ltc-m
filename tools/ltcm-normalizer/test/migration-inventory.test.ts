import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  P012_MIGRATION_BASELINE,
  P013_MIGRATION_BASELINE,
  P016_MIGRATION_BASELINE,
  readMigrationInventory,
  validateMigrationNames,
} from './support/migration-inventory.js';

const P021_MIGRATION = '20260828100000_add_p021_authorization_approver.sql';
const P026_MIGRATION = '20260901100000_add_p026_master_data_management.sql';
const FUTURE_MIGRATION = '20990101000000_future_valid_migration.sql';
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

test('P012, P013 e P016 aceitam seus baselines históricos canônicos', () => {
  assert.deepEqual(
    validateMigrationNames(P012_MIGRATION_BASELINE, P012_MIGRATION_BASELINE),
    P012_MIGRATION_BASELINE,
  );
  assert.deepEqual(
    validateMigrationNames(P013_MIGRATION_BASELINE, P013_MIGRATION_BASELINE),
    P013_MIGRATION_BASELINE,
  );
  assert.deepEqual(
    validateMigrationNames(P016_MIGRATION_BASELINE, P016_MIGRATION_BASELINE),
    P016_MIGRATION_BASELINE,
  );
});

test('as três suítes aceitam as migrations atuais e sucessoras arbitrárias', () => {
  const current = [...P016_MIGRATION_BASELINE, P021_MIGRATION, P026_MIGRATION];
  const future = [...current, FUTURE_MIGRATION];

  for (const baseline of [
    P012_MIGRATION_BASELINE,
    P013_MIGRATION_BASELINE,
    P016_MIGRATION_BASELINE,
  ]) {
    assert.deepEqual(validateMigrationNames(current, baseline), current);
    assert.deepEqual(validateMigrationNames(future, baseline), future);
  }
});

test('o inventário atual real é aceito sem teto global de cardinalidade', async () => {
  const inventory = await readMigrationInventory(
    path.join(REPOSITORY_ROOT, 'supabase', 'migrations'),
    P016_MIGRATION_BASELINE,
  );
  assert.ok(inventory.length > P016_MIGRATION_BASELINE.length);
  assert.ok(inventory.some((migration) => migration.name === P026_MIGRATION));
});

test('a ausência do último marco histórico de cada milestone falha', () => {
  assert.throws(
    () => validateMigrationNames(P012_MIGRATION_BASELINE.slice(0, -1), P012_MIGRATION_BASELINE),
    /migration histórica obrigatória ausente/u,
  );
  assert.throws(
    () => validateMigrationNames(P013_MIGRATION_BASELINE.slice(0, -1), P013_MIGRATION_BASELINE),
    /migration histórica obrigatória ausente/u,
  );
  assert.throws(
    () => validateMigrationNames(P016_MIGRATION_BASELINE.slice(0, -1), P016_MIGRATION_BASELINE),
    /migration histórica obrigatória ausente/u,
  );
});

test('nome inválido, timestamp duplicado e ordem inválida falham no guard canônico', () => {
  assert.throws(
    () =>
      validateMigrationNames(
        [...P012_MIGRATION_BASELINE, 'not-a-migration.sql'],
        P012_MIGRATION_BASELINE,
      ),
    /nome de migration inválido/u,
  );
  assert.throws(
    () =>
      validateMigrationNames(
        [...P012_MIGRATION_BASELINE, '20260804120000_another_migration.sql'],
        P012_MIGRATION_BASELINE,
      ),
    /timestamp de migration duplicado/u,
  );
  assert.throws(
    () => validateMigrationNames([...P012_MIGRATION_BASELINE].reverse(), P012_MIGRATION_BASELINE),
    /fora da ordem canônica/u,
  );
});
