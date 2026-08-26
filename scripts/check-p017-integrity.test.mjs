import assert from 'node:assert/strict';
import test from 'node:test';

import { createSnapshot } from './generate-p017-schema-docs.mjs';
import { officialP017Sources, validateP017Sources } from './check-p017-integrity.mjs';

test('aceita contrato P017 completo e integrado aos documentos e CI', async () => {
  assert.deepEqual(validateP017Sources(await officialP017Sources()), []);
});

test('rejeita drift de relação, RLS, FK, policy e propriedade de view', async () => {
  const value = await officialP017Sources();
  const mutations = [
    value.snapshot.model.relations.slice(1),
    value.snapshot.model.relations.map((relation) =>
      relation.kind === 'table' && relation.rowSecurity
        ? { ...relation, forceRowSecurity: false }
        : relation,
    ),
    value.snapshot.model.relations.map((relation) =>
      relation.name === 'v_tableau_project_overview'
        ? {
            ...relation,
            options: relation.options.filter((option) => option !== 'security_invoker=true'),
          }
        : relation,
    ),
  ];
  for (const relations of mutations) {
    const model = { ...value.snapshot.model, relations };
    assert.notDeepEqual(
      validateP017Sources({
        ...value,
        snapshot: createSnapshot(model, value.snapshot.migrationCount),
      }),
      [],
    );
  }
  for (const model of [
    { ...value.snapshot.model, policies: value.snapshot.model.policies.slice(1) },
    {
      ...value.snapshot.model,
      constraints: value.snapshot.model.constraints.filter(
        (constraint) => constraint.type !== 'foreign_key',
      ),
    },
  ]) {
    assert.notDeepEqual(
      validateP017Sources({
        ...value,
        snapshot: createSnapshot(model, value.snapshot.migrationCount),
      }),
      [],
    );
  }
});

test('rejeita documentação stale, migration inesperada e remoção do estágio CI', async () => {
  const value = await officialP017Sources();
  assert.notDeepEqual(
    validateP017Sources({
      ...value,
      documents: { ...value.documents, 'erd.md': `${value.documents['erd.md']}stale` },
    }),
    [],
  );
  assert.notDeepEqual(
    validateP017Sources({
      ...value,
      migrationNames: [...value.migrationNames, '20260825170000_p017_unexpected.sql'],
    }),
    [],
  );
  assert.notDeepEqual(
    validateP017Sources({
      ...value,
      runner: value.runner.replace("runStage('p017_postgres'", "runStage('removed'"),
    }),
    [],
  );
});
