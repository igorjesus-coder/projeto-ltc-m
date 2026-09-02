import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  P012_MIGRATION_BASELINE,
  P013_MIGRATION_BASELINE,
  P016_MIGRATION_BASELINE,
  readMigrationInventory,
  selectMigrationNames,
  validateMigrationNames,
} from './support/migration-inventory.js';

const P021_MIGRATION = '20260828100000_add_p021_authorization_approver.sql';
const P026_MIGRATION = '20260901100000_add_p026_master_data_management.sql';
const P026_AUDIT_FIX_MIGRATION = '20260902100000_fix_p026_catalog_audit_identity.sql';
const FUTURE_MIGRATION = '20990101000000_future_valid_migration.sql';
const HISTORICAL_MIDDLE = '20260730150000_historical_middle.sql';
const HISTORICAL_BEFORE_FINAL = '20260804115959_historical_before_final.sql';
const HISTORICAL_BEFORE_FIRST = '20260729000000_historical_before_first.sql';
const HISTORICAL_REPLACEMENT = '20260804120000_historical_replacement.sql';
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
  const current = [
    ...P016_MIGRATION_BASELINE,
    P021_MIGRATION,
    P026_MIGRATION,
    P026_AUDIT_FIX_MIGRATION,
  ];
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
  assert.equal(inventory.length, 16);
  assert.ok(inventory.length > P016_MIGRATION_BASELINE.length);
  assert.ok(inventory.some((migration) => migration.name === P026_MIGRATION));
  assert.ok(inventory.some((migration) => migration.name === P026_AUDIT_FIX_MIGRATION));
});

test('o modo histórico do P013 seleciona exatamente o baseline e exclui sucessoras', async () => {
  const inventory = await readMigrationInventory(
    path.join(REPOSITORY_ROOT, 'supabase', 'migrations'),
    P013_MIGRATION_BASELINE,
    'historical',
  );
  assert.deepEqual(
    inventory.map((migration) => migration.name),
    P013_MIGRATION_BASELINE,
  );
  assert.ok(!inventory.some((migration) => migration.name === P026_MIGRATION));
  assert.deepEqual(
    selectMigrationNames(
      [...P013_MIGRATION_BASELINE, P021_MIGRATION, P026_MIGRATION],
      P013_MIGRATION_BASELINE,
      'historical',
    ),
    P013_MIGRATION_BASELINE,
  );
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

test('qualquer inserção ou substituição no prefixo histórico falha', () => {
  const cases = [
    [
      ...P012_MIGRATION_BASELINE.slice(0, 4),
      HISTORICAL_MIDDLE,
      ...P012_MIGRATION_BASELINE.slice(4),
    ],
    [
      ...P012_MIGRATION_BASELINE.slice(0, -1),
      HISTORICAL_BEFORE_FINAL,
      P012_MIGRATION_BASELINE.at(-1)!,
    ],
    [HISTORICAL_BEFORE_FIRST, ...P012_MIGRATION_BASELINE],
    [...P012_MIGRATION_BASELINE.slice(0, -1), HISTORICAL_REPLACEMENT],
  ];

  for (const names of cases) {
    assert.throws(
      () => validateMigrationNames(names, P012_MIGRATION_BASELINE),
      /migration|prefixo/u,
    );
  }
});

test('baseline sintético exato rejeita prefixo adulterado e aceita somente successors posteriores', () => {
  const baseline = [
    '20260729000000_a.sql',
    '20260730000000_b.sql',
    '20260731000000_c.sql',
  ] as const;
  const validSuccessors = [
    ...baseline,
    '20260731000001_d_future.sql',
    '20990101000000_e_future.sql',
  ];
  const adulteredPrefix = [
    baseline[0],
    baseline[1],
    '20260730000001_b2_extra_historical.sql',
    baseline[2],
    '20990101000000_d_future.sql',
  ];

  assert.deepEqual(validateMigrationNames(validSuccessors, baseline), validSuccessors);
  assert.throws(
    () => validateMigrationNames(adulteredPrefix, baseline),
    /prefixo histórico de migrations divergiu/u,
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
