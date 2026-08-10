import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

import {
  analyzeInsertStatements,
  buildGateManifest,
  finalizeGateManifest,
  lexSql,
  toPortableRelativePath,
  validateSqlArtifact,
} from './p009-rendered-sql-gate.mjs';
import { renderComprehensiveP009 } from './sql-rendering.mjs';

const validAppUsers = `
insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values
  ('00000000-0000-4000-8000-000000000001', 'test|viewer', 'Viewer', 'viewer', true),
  ('00000000-0000-4000-8000-000000000002', 'test|inactive', 'Inactive', 'viewer', false);
`;

const storedManifest = JSON.parse(
  fs.readFileSync(
    new URL('../docs/database/p009-rendered-sql-gate-manifest.json', import.meta.url),
    'utf8',
  ),
);

const historicalEvidence = new Map([
  [
    '../docs/database/p008-runtime-validation-result.json',
    'BAEF49D3808FDC8505321AAC9C27F790888E7E175A2CCCEA6B8770392E348B62',
  ],
  [
    '../docs/database/p009-post-application-report.md',
    '8CF17BC521AA6959A2F6EF9724ECFF811195F5DD85076BBBEE9513B97EDF3363',
  ],
  [
    '../docs/database/p009-runtime-validation-report.md',
    'A0EA8A2DD8C41474D7716E6838627C9A3CE1E338393B4DA3487BB3B543E48643',
  ],
  [
    '../docs/database/p009-runtime-validation-result.json',
    'D044E2AFC8BF59EFFBC43D87855BF995C377A221D31BD90340F32FAB823AC37D',
  ],
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex').toUpperCase();
}

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

test('canonicaliza caminhos Windows e preserva caminhos POSIX', () => {
  const windows = 'database\\audit\\arquivo.sql';
  const posix = 'database/audit/arquivo.sql';
  assert.equal(toPortableRelativePath(windows), posix);
  assert.equal(toPortableRelativePath(posix), posix);
  assert.equal(toPortableRelativePath(windows), toPortableRelativePath(posix));
  assert.equal(toPortableRelativePath('database/temporary/../audit/arquivo.sql'), posix);
});

test('rejeita caminhos vazios, absolutos, drive, UNC e escape da raiz', () => {
  assert.throws(() => toPortableRelativePath(null), /deve ser string/u);
  assert.throws(() => toPortableRelativePath(''), /vazio/u);
  assert.throws(() => toPortableRelativePath('/database/audit/arquivo.sql'), /absoluto/u);
  assert.throws(() => toPortableRelativePath('C:\\database\\audit\\arquivo.sql'), /drive/u);
  assert.throws(() => toPortableRelativePath('C:database\\audit\\arquivo.sql'), /drive/u);
  assert.throws(() => toPortableRelativePath('\\\\server\\share\\arquivo.sql'), /UNC/u);
  assert.throws(() => toPortableRelativePath('../database/audit/arquivo.sql'), /escapa/u);
  assert.throws(() => toPortableRelativePath('database/../../arquivo.sql'), /escapa/u);
});

test('manifesto completo canonicaliza estruturas Windows e POSIX para os mesmos hashes', () => {
  const current = buildGateManifest(process.cwd()).manifest;
  const windows = finalizeGateManifest({
    ...current,
    sourceHash: 'substituido-pela-finalizacao',
    sourceFiles: current.sourceFiles.map((source) => ({
      ...source,
      path: source.path.replaceAll('/', '\\'),
    })),
    manifestSha256: 'substituido-pela-finalizacao',
  });
  const posix = finalizeGateManifest({
    ...current,
    sourceHash: 'substituido-pela-finalizacao',
    sourceFiles: current.sourceFiles.map((source) => ({ ...source })),
    manifestSha256: 'substituido-pela-finalizacao',
  });

  assert.deepEqual(windows.sourceFiles, posix.sourceFiles);
  assert.equal(windows.sourceHash, posix.sourceHash);
  assert.equal(windows.manifestSha256, posix.manifestSha256);
  assert.equal(JSON.stringify(windows), JSON.stringify(posix));
  assert.doesNotMatch(JSON.stringify(windows.sourceFiles), /\\/u);
});

test('manifesto oficial possui exatamente 19 caminhos portateis e hashes pos-canonicalizacao', () => {
  const { manifest } = buildGateManifest(process.cwd());
  assert.equal(manifest.sourceFiles.length, 19);
  for (const source of manifest.sourceFiles) {
    assert.equal(source.path, toPortableRelativePath(source.path));
    assert.doesNotMatch(source.path, /\\/u);
    assert.doesNotMatch(source.path, /^\//u);
    assert.doesNotMatch(source.path, /^[A-Za-z]:/u);
    assert.doesNotMatch(source.path, /^\/\//u);
    assert.ok(!source.path.split('/').includes('..'));
  }

  assert.equal(manifest.sourceHash, sha256(JSON.stringify(manifest.sourceFiles)));
  const { manifestSha256, ...withoutHash } = manifest;
  assert.equal(manifestSha256, sha256(JSON.stringify(withoutHash)));
});

test('duas geracoes independentes produzem bytes e JSON canonicalizado identicos', () => {
  const first = `${JSON.stringify(buildGateManifest(process.cwd()).manifest, null, 2)}\n`;
  const second = `${JSON.stringify(buildGateManifest(process.cwd()).manifest, null, 2)}\n`;
  assert.equal(Buffer.from(first).equals(Buffer.from(second)), true);
  assert.equal(JSON.stringify(JSON.parse(first)), JSON.stringify(JSON.parse(second)));
});

test('canonicalizacao preserva inputs SQL, metricas, INSERTs, gates e issues', () => {
  const generated = buildGateManifest(process.cwd()).manifest;
  assert.deepEqual(
    generated.sourceFiles.map(({ artifact, sha256: hash }) => ({ artifact, sha256: hash })),
    storedManifest.sourceFiles.map(({ artifact, sha256: hash }) => ({ artifact, sha256: hash })),
  );
  assert.deepEqual(generated.rendered, storedManifest.rendered);
  assert.deepEqual(generated.gates, storedManifest.gates);
  assert.deepEqual(generated.issues, storedManifest.issues);
});

test('evidencias historicas D33 permanecem byte a byte inalteradas', () => {
  for (const [relativePath, expectedHash] of historicalEvidence) {
    const bytes = fs.readFileSync(new URL(relativePath, import.meta.url));
    assert.equal(sha256(bytes), expectedHash, relativePath);
  }
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
