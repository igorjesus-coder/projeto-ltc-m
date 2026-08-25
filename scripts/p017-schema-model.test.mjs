import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createSnapshot,
  renderedDocuments,
  serializeSnapshot,
} from './generate-p017-schema-docs.mjs';
import {
  P017_FINGERPRINT_CONTRACT,
  P017_SCHEMA_CONTRACT,
  canonicalizeSchemaModel,
  fingerprintSchemaModel,
  summarizeSchemaModel,
} from './p017-schema-model.mjs';

const sample = {
  relations: [
    {
      schema: 'ltc_m',
      name: 'children',
      kind: 'table',
      rowSecurity: true,
      forceRowSecurity: true,
      options: [],
      comment: 'Children.',
      definition: null,
      columns: [
        { position: 2, name: 'parent_id', type: 'uuid', nullable: false },
        { position: 1, name: 'id', type: 'uuid', nullable: false },
      ],
    },
    {
      schema: 'ltc_m',
      name: 'parents',
      kind: 'table',
      rowSecurity: true,
      forceRowSecurity: true,
      options: [],
      comment: 'Parents.',
      definition: null,
      columns: [{ position: 1, name: 'id', type: 'uuid', nullable: false }],
    },
  ],
  constraints: [
    {
      schema: 'ltc_m',
      table: 'children',
      name: 'children_parent_fk',
      type: 'foreign_key',
      columns: ['parent_id'],
      referencedSchema: 'ltc_m',
      referencedTable: 'parents',
      referencedColumns: ['id'],
      definition: 'FOREIGN KEY (parent_id) REFERENCES ltc_m.parents(id)',
    },
    {
      schema: 'ltc_m',
      table: 'parents',
      name: 'parents_pkey',
      type: 'primary_key',
      columns: ['id'],
      referencedColumns: [],
      definition: 'PRIMARY KEY (id)',
    },
    {
      schema: 'ltc_m',
      table: 'children',
      name: 'children_pkey',
      type: 'primary_key',
      columns: ['id'],
      referencedColumns: [],
      definition: 'PRIMARY KEY (id)',
    },
  ],
  indexes: [],
  functions: [],
  triggers: [],
  policies: [
    {
      schema: 'ltc_m',
      table: 'children',
      name: 'children_select',
      permissive: true,
      command: 'r',
      roles: ['ltc_m_runtime'],
    },
  ],
  grants: [],
  types: [],
};

test('modelo P017 é canônico, ordenado e independente da ordem de entrada', () => {
  const left = canonicalizeSchemaModel(sample);
  const right = canonicalizeSchemaModel({
    ...sample,
    relations: [...sample.relations].reverse(),
    constraints: [...sample.constraints].reverse(),
  });
  assert.deepEqual(left, right);
  assert.equal(fingerprintSchemaModel(left), fingerprintSchemaModel(right));
  assert.equal(left.schemaContract, P017_SCHEMA_CONTRACT);
  assert.equal(left.fingerprintContract, P017_FINGERPRINT_CONTRACT);
});

test('fingerprint falha fechado para coluna, FK, RLS e policy divergentes', () => {
  const baseline = fingerprintSchemaModel(sample);
  const mutations = [
    { ...sample, relations: sample.relations.slice(1) },
    {
      ...sample,
      relations: sample.relations.map((relation) =>
        relation.name === 'children' ? { ...relation, forceRowSecurity: false } : relation,
      ),
    },
    { ...sample, constraints: sample.constraints.filter((value) => value.type !== 'foreign_key') },
    { ...sample, policies: [] },
  ];
  for (const mutation of mutations) assert.notEqual(fingerprintSchemaModel(mutation), baseline);
});

test('snapshot e sumário contabilizam relações, colunas, chaves e RLS', () => {
  const snapshot = createSnapshot(sample);
  assert.deepEqual(snapshot.summary, {
    relationCount: 2,
    tableCount: 2,
    viewCount: 0,
    materializedViewCount: 0,
    columnCount: 3,
    functionCount: 0,
    triggerCount: 0,
    indexCount: 0,
    primaryKeyCount: 2,
    uniqueConstraintCount: 0,
    foreignKeyCount: 1,
    checkConstraintCount: 0,
    protectedRlsTableCount: 2,
    forceRlsTableCount: 2,
    policyCount: 1,
    grantCount: 0,
    typeCount: 0,
  });
  assert.deepEqual(snapshot.summary, summarizeSchemaModel(sample));
  assert.equal(serializeSnapshot(snapshot), serializeSnapshot(createSnapshot(sample)));
});

test('ERD e dicionário são renderizados deterministicamente do mesmo snapshot', () => {
  const documents = [...renderedDocuments(createSnapshot(sample)).values()];
  assert.equal(documents.length, 3);
  assert.ok(documents.some((document) => document.includes('parents ||--o{ children')));
  assert.ok(documents.some((document) => document.includes('`ltc_m.children`')));
  assert.ok(documents.every((document) => document.includes(P017_SCHEMA_CONTRACT)));
});
