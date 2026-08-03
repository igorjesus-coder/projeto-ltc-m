import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeInsertStatements,
  buildGateManifest,
  lexSql,
  validateSqlArtifact,
} from './p009-rendered-sql-gate.mjs';
import { renderComprehensiveP009 } from './sql-rendering.mjs';

const validAppUsers = `
insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values
  ('00000000-0000-4000-8000-000000000001', 'test|viewer', 'Viewer', 'viewer', true),
  ('00000000-0000-4000-8000-000000000002', 'test|inactive', 'Inactive', 'viewer', false);
`;

test('lexer reconhece strings, identificadores, comentarios, dollar quotes e parenteses', () => {
  const sql = `
    -- comentario, com virgula
    do $body$
    begin
      perform jsonb_build_object('text', 'a,b', 'nested', array[1, 2]);
      perform "Quoted Identifier";
    end;
    $body$;
  `;
  const result = lexSql(sql);
  assert.deepEqual(result.issues, []);
  assert.ok(result.tokens.some((token) => token.type === 'dollar'));
});

test('aceita alias valido e rejeita alias com hifen', () => {
  assert.equal(validateSqlArtifact('select true as p009_valid_alias;').ok, true);
  const invalid = validateSqlArtifact('select true as p009-invalid-alias;');
  assert.equal(invalid.ok, false);
  assert.ok(invalid.issues.some((item) => item.message.includes('alias invalido com hifen')));
});

test('aceita INSERT correto com virgulas em strings, JSON e funcoes', () => {
  const sql = `
    insert into ltc_m.import_batches (source_name, metadata, submitted_by_user_id)
    values ('file,a.xlsx', jsonb_build_object('items', jsonb_build_array(1, 2)), gen_random_uuid());
  `;
  const result = analyzeInsertStatements(sql);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.inserts[0].tuples.map((tuple) => tuple.arity),
    [3],
  );
});

test('rejeita INSERT com mais valores e com menos valores', () => {
  const more = analyzeInsertStatements(
    'insert into ltc_m.app_users (id, active) values (gen_random_uuid(), true, false);',
  );
  const less = analyzeInsertStatements(
    'insert into ltc_m.app_users (id, active) values (gen_random_uuid());',
  );
  assert.ok(more.issues.some((item) => item.message.includes('2 colunas e 3 valores')));
  assert.ok(less.issues.some((item) => item.message.includes('2 colunas e 1 valores')));
});

test('rejeita INSERT sem colunas, coluna duplicada e tuplas com aridades divergentes', () => {
  const noColumns = analyzeInsertStatements('insert into ltc_m.app_users values (1);');
  const duplicate = analyzeInsertStatements(
    'insert into ltc_m.app_users (id, id) values (gen_random_uuid(), gen_random_uuid());',
  );
  const divergent = analyzeInsertStatements(
    'insert into ltc_m.app_users (id, active) values (gen_random_uuid(), true), (gen_random_uuid());',
  );
  assert.ok(noColumns.issues.some((item) => item.message.includes('sem lista explicita')));
  assert.ok(duplicate.issues.some((item) => item.message.includes('coluna duplicada')));
  assert.ok(divergent.issues.some((item) => item.message.includes('aridade divergente')));
});

test('reproduz quatro colunas/cinco valores e cinco colunas/quatro valores de app_users', () => {
  const fourFive = validateSqlArtifact(`
    insert into ltc_m.app_users (id, auth_subject, full_name, role)
    values ('00000000-0000-4000-8000-000000000001', 'test|inactive', 'Inactive', 'viewer', false);
  `);
  const fiveFour = validateSqlArtifact(`
    insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
    values ('00000000-0000-4000-8000-000000000001', 'test|viewer', 'Viewer', 'viewer');
  `);
  assert.equal(fourFive.ok, false);
  assert.equal(fiveFour.ok, false);
  assert.ok(fourFive.issues.some((item) => item.message.includes('aridade divergente')));
  assert.ok(fiveFour.issues.some((item) => item.message.includes('aridade divergente')));
});

test('aceita fixtures app_users ativa e inativa explicitas', () => {
  const result = validateSqlArtifact(validAppUsers);
  assert.equal(result.ok, true, JSON.stringify(result.issues));
});

test('rejeita estado active divergente em fixtures app_users', () => {
  const result = validateSqlArtifact(
    validAppUsers.replace(
      "'test|inactive', 'Inactive', 'viewer', false",
      "'test|inactive', 'Inactive', 'viewer', true",
    ),
  );
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((item) => item.message.includes('fixture inativa')));
});

test('rejeita placeholder, undefined, NaN, statement proibido e SQL truncado', () => {
  for (const [sql, expected] of [
    ['select {{RUN_TOKEN}};', 'placeholder'],
    ['select undefined;', 'literal proibido'],
    ['select NaN;', 'literal proibido'],
    ['drop table ltc_m.import_batches;', 'statement proibido'],
    ['select true', 'statement truncado'],
  ]) {
    const result = validateSqlArtifact(sql);
    assert.equal(result.ok, false);
    assert.ok(
      result.issues.some((item) => item.message.includes(expected)),
      JSON.stringify(result.issues),
    );
  }
});

test('run IDs com hifen e underscore alteram apenas literais autorizados', () => {
  const source = `
    select '00000000-0000-4000-8000-000000009001', 'p009|viewer'
      as p009_rejection_partial_integrity;
  `;
  const first = renderComprehensiveP009(source, 'r20991231-gate-a1b2c3d4');
  const second = renderComprehensiveP009(source, 'r20000101_gate_00000000');
  const firstGate = validateSqlArtifact(first, 'p009', 'r20991231-gate-a1b2c3d4');
  const secondGate = validateSqlArtifact(second, 'p009', 'r20000101_gate_00000000');
  assert.equal(firstGate.ok, true, JSON.stringify(firstGate.issues));
  assert.equal(secondGate.ok, true, JSON.stringify(secondGate.issues));
  assert.deepEqual(firstGate.canonical, secondGate.canonical);
  assert.match(first, /as p009_rejection_partial_integrity/u);
  assert.match(second, /as p009_rejection_partial_integrity/u);
});

test('manifesto integral oficial aprova os dois run IDs e todas as aridades', () => {
  const { manifest } = buildGateManifest(process.cwd());
  assert.equal(manifest.status, 'approved', JSON.stringify(manifest.issues));
  assert.equal(manifest.gates.runIdInvariant, true);
  assert.equal(manifest.gates.insertColumnValueParity, true);
  assert.equal(manifest.gates.requestContextFlow, true);
  for (const run of manifest.rendered) {
    assert.equal(run.metrics.requestContexts, 13);
    assert.equal(run.metrics.postDmlContextAssertions, 13);
    assert.ok(run.metrics.auditedRequestScenarios >= 8);
    for (const insert of run.inserts) {
      assert.ok(insert.tupleArities.every((arity) => arity === insert.columns));
    }
  }
});
