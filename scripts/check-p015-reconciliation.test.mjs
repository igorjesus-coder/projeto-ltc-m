import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { scanP015Sources } from './check-p015-reconciliation.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const official = async () => {
  const [engine, tests, documentation, rootPackage, normalizerPackage] = await Promise.all([
    readFile(`${root}/tools/ltcm-normalizer/src/reconciliation.ts`, 'utf8'),
    readFile(`${root}/tools/ltcm-normalizer/test/reconciliation.test.ts`, 'utf8'),
    readFile(`${root}/docs/reconciliation/p015-reconciliation.md`, 'utf8'),
    readFile(`${root}/package.json`, 'utf8'),
    readFile(`${root}/tools/ltcm-normalizer/package.json`, 'utf8'),
  ]);
  return { engine, tests, documentation, rootPackage, normalizerPackage };
};

test('aceita contrato P015 read-only versionado', async () => {
  assert.deepEqual(scanP015Sources(await official()), []);
});

test('rejeita perda de zero writes, missing-grain, scripts e documentação', async () => {
  const value = await official();
  assert.notDeepEqual(
    scanP015Sources({
      ...value,
      engine: value.engine.replaceAll('insert_count: 0', 'insert_count: 1'),
    }),
    [],
  );
  assert.notDeepEqual(
    scanP015Sources({
      ...value,
      engine: value.engine.replaceAll("'REALIZED_MONTH_MISSING_PROJECT'", "'REMOVED'"),
    }),
    [],
  );
  assert.notDeepEqual(
    scanP015Sources({
      ...value,
      rootPackage: value.rootPackage.replace('"p015:check"', '"removed"'),
    }),
    [],
  );
  assert.notDeepEqual(
    scanP015Sources({
      ...value,
      documentation: value.documentation.replace('SCHEMA_COMPLETE', 'REMOVED'),
    }),
    [],
  );
});

test('rejeita writer, Pool, aleatoriedade, relógio e endpoint remoto', async () => {
  const value = await official();
  for (const injection of [
    'insert into ltc_m.audit_log',
    'PoolClient',
    'randomUUID()',
    'Date.now()',
    'https://example.invalid',
  ]) {
    assert.notDeepEqual(
      scanP015Sources({ ...value, engine: `${value.engine}\n// ${injection}` }),
      [],
    );
  }
});
