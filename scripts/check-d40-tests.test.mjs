import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  D40_SCENARIO_COUNT,
  D40_STRUCTURAL_PRECONDITION_COUNT,
  checkD40,
  extractSyntheticCurrencyCodes,
  isValidSyntheticCurrencyCode,
  scanD40HarnessText,
  scanD40StructuralPreconditions,
  scanSyntheticCurrencyFixtures,
} from './check-d40-tests.mjs';

const OFFICIAL_HARNESS = fs.readFileSync('database/audit/ltcm-d40-tests.sql', 'utf8');

function replaceOnce(source, expected, replacement) {
  const position = source.indexOf(expected);
  assert.notEqual(position, -1, `fixture de mutacao ausente: ${expected}`);
  return source.slice(0, position) + replacement + source.slice(position + expected.length);
}

function assertStructuralMutation({ expected, replacement, issue }) {
  const mutated = replaceOnce(OFFICIAL_HARNESS, expected, replacement);
  const issues = scanD40StructuralPreconditions(mutated);
  assert.ok(
    issues.some((candidate) => candidate.includes(issue)),
    `esperava issue ${JSON.stringify(issue)}; recebidas: ${issues.join(' | ')}`,
  );
}

test('valida o domínio nominal de moedas sintéticas', () => {
  for (const code of ['BRL', 'USD', 'ZZZ']) {
    assert.equal(isValidSyntheticCurrencyCode(code), true, code);
  }
  for (const code of [
    'D40',
    'C43',
    'brl',
    'BrL',
    'BR1',
    'BR-L',
    'BR_L',
    'BR ',
    ' BR',
    'A$',
    'ÁBC',
  ]) {
    assert.equal(isValidSyntheticCurrencyCode(code), false, code);
  }
});

test('aceita as seis preconditions estruturais oficiais sem deparser de constraint', () => {
  assert.equal(D40_STRUCTURAL_PRECONDITION_COUNT, 6);
  assert.deepEqual(scanD40StructuralPreconditions(OFFICIAL_HARNESS), []);
  assert.doesNotMatch(OFFICIAL_HARNESS, /pg_get_constraintdef/iu);
  assert.doesNotMatch(OFFICIAL_HARNESS, /pg_get_indexdef/iu);
  assert.equal(D40_SCENARIO_COUNT, 47);
});

test('FK estrutural falha fechado em toda divergencia normativa', async (t) => {
  const cases = [
    {
      name: 'ausente',
      expected: 'from pg_catalog.pg_constraint as fk_constraint',
      replacement: 'from pg_catalog.pg_constraint as absent_fk_constraint',
      issue: 'FK: cat',
    },
    {
      name: 'nome divergente',
      expected: "fk_constraint.conname = 'fk_projects_legacy_import_batch'",
      replacement: "fk_constraint.conname = 'fk_projects_other_batch'",
      issue: 'FK: nome',
    },
    {
      name: 'tabela origem divergente',
      expected: "fk_constraint.conrelid = 'ltc_m.projects'::regclass",
      replacement: "fk_constraint.conrelid = 'ltc_m.clients'::regclass",
      issue: 'FK: tabela origem',
    },
    {
      name: 'coluna origem divergente',
      expected: "source_attribute.attname = 'legacy_import_batch_id'",
      replacement: "source_attribute.attname = 'client_id'",
      issue: 'FK: coluna origem',
    },
    {
      name: 'tabela destino divergente',
      expected: "fk_constraint.confrelid = 'ltc_m.import_batches'::regclass",
      replacement: "fk_constraint.confrelid = 'ltc_m.clients'::regclass",
      issue: 'FK: tabela destino',
    },
    {
      name: 'coluna destino divergente',
      expected: "target_attribute.attname = 'id'",
      replacement: "target_attribute.attname = 'source_hash'",
      issue: 'FK: coluna destino',
    },
    {
      name: 'match type divergente',
      expected: "fk_constraint.confmatchtype = 's'",
      replacement: "fk_constraint.confmatchtype = 'f'",
      issue: 'FK: match type',
    },
    {
      name: 'ON UPDATE divergente',
      expected: "fk_constraint.confupdtype = 'a'",
      replacement: "fk_constraint.confupdtype = 'c'",
      issue: 'FK: ON UPDATE',
    },
    {
      name: 'ON DELETE divergente',
      expected: "fk_constraint.confdeltype = 'a'",
      replacement: "fk_constraint.confdeltype = 'c'",
      issue: 'FK: ON DELETE',
    },
    {
      name: 'DEFERRABLE divergente',
      expected: 'not fk_constraint.condeferrable',
      replacement: 'fk_constraint.condeferrable',
      issue: 'FK: NOT DEFERRABLE',
    },
    {
      name: 'INITIALLY DEFERRED divergente',
      expected: 'not fk_constraint.condeferred',
      replacement: 'fk_constraint.condeferred',
      issue: 'FK: INITIALLY IMMEDIATE',
    },
    {
      name: 'nao validada',
      expected: 'and fk_constraint.convalidated',
      replacement: 'and not fk_constraint.convalidated',
      issue: 'FK: validada',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => assertStructuralMutation(testCase));
  }
});

test('CHECK estrutural falha fechado em ausencia ou divergencia', async (t) => {
  const cases = [
    {
      name: 'ausente',
      expected: 'from pg_catalog.pg_constraint as check_constraint',
      replacement: 'from pg_catalog.pg_constraint as absent_check_constraint',
      issue: 'CHECK: cat',
    },
    {
      name: 'nao validada',
      expected: 'and check_constraint.convalidated',
      replacement: 'and not check_constraint.convalidated',
      issue: 'CHECK: validada',
    },
    {
      name: 'nome divergente',
      expected: "check_constraint.conname = 'ck_projects_data_reference_date_legacy'",
      replacement: "check_constraint.conname = 'ck_projects_other'",
      issue: 'CHECK: nome',
    },
    {
      name: 'tabela divergente',
      expected: "check_constraint.conrelid = 'ltc_m.projects'::regclass",
      replacement: "check_constraint.conrelid = 'ltc_m.clients'::regclass",
      issue: 'CHECK: tabela',
    },
    {
      name: 'expressao divergente',
      expected: "'data_reference_dateisnotnullorlegacy_import_batch_idisnotnull'",
      replacement: "'data_reference_dateisnotnullandlegacy_import_batch_idisnotnull'",
      issue: 'CHECK: express',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => assertStructuralMutation(testCase));
  }
});

test('NOT NULL estrutural exige tabela, coluna existente e attnotnull falso', async (t) => {
  const cases = [
    {
      name: 'attnotnull true',
      expected: 'not reference_date_attribute.attnotnull',
      replacement: 'reference_date_attribute.attnotnull',
      issue: 'NOT NULL: removido',
    },
    {
      name: 'coluna ausente',
      expected: "reference_date_attribute.attname = 'data_reference_date'",
      replacement: "reference_date_attribute.attname = 'missing_reference_date'",
      issue: 'NOT NULL: coluna',
    },
    {
      name: 'tabela ausente',
      expected: "reference_date_attribute.attrelid = 'ltc_m.projects'::regclass",
      replacement: "reference_date_attribute.attrelid = 'ltc_m.missing_projects'::regclass",
      issue: 'NOT NULL: tabela',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => assertStructuralMutation(testCase));
  }
});

test('indice parcial falha fechado em ausencia ou divergencia estrutural', async (t) => {
  const cases = [
    {
      name: 'ausente',
      expected: 'from pg_catalog.pg_index as index_record',
      replacement: 'from pg_catalog.pg_index as absent_index_record',
      issue: 'ndice: cat',
    },
    {
      name: 'tabela divergente',
      expected: "table_class.relname = 'projects'",
      replacement: "table_class.relname = 'clients'",
      issue: 'ndice: tabela',
    },
    {
      name: 'coluna divergente',
      expected: "indexed_attribute.attname = 'legacy_import_batch_id'",
      replacement: "indexed_attribute.attname = 'client_id'",
      issue: 'ndice: coluna',
    },
    {
      name: 'sem predicado parcial',
      expected: 'index_record.indpred is not null',
      replacement: 'index_record.indpred is null',
      issue: 'ndice: parcial',
    },
    {
      name: 'predicado divergente',
      expected: "'legacy_import_batch_idisnotnull'",
      replacement: "'legacy_import_batch_idisnull'",
      issue: 'ndice: predicado',
    },
    {
      name: 'indice unico divergente',
      expected: 'not index_record.indisunique',
      replacement: 'index_record.indisunique',
      issue: 'ndice: n',
    },
    {
      name: 'indice invalido',
      expected: 'and index_record.indisvalid',
      replacement: 'and not index_record.indisvalid',
      issue: 'ndice: v',
    },
    {
      name: 'indice nao pronto',
      expected: 'and index_record.indisready',
      replacement: 'and not index_record.indisready',
      issue: 'ndice: pronto',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => assertStructuralMutation(testCase));
  }
});

test('triggers exigem conjunto completo antes da ordem normativa', async (t) => {
  const cases = [
    {
      name: 'trigger projects ausente',
      expected: "'trg_07_projects_legacy_reference_guard',",
      replacement: "'trg_08_projects_legacy_reference_guard',",
      issue: 'triggers projects: conjunto',
    },
    {
      name: 'trigger import_batches ausente',
      expected: "'trg_07_import_batches_rejection_guard',",
      replacement: "'trg_08_import_batches_rejection_guard',",
      issue: 'triggers import_batches: conjunto',
    },
    {
      name: 'ordem projects incorreta',
      expected:
        "array_position(v_trigger_order, 'trg_00_projects_no_delete')\n        < pg_catalog.array_position(v_trigger_order, 'trg_05_projects_inactivation')",
      replacement:
        "array_position(v_trigger_order, 'trg_00_projects_no_delete')\n        > pg_catalog.array_position(v_trigger_order, 'trg_05_projects_inactivation')",
      issue: 'triggers projects: ordem',
    },
    {
      name: 'ordem import_batches incorreta',
      expected:
        "array_position(v_import_trigger_order, 'trg_00_import_batches_no_delete')\n        < pg_catalog.array_position(v_import_trigger_order, 'trg_07_import_batches_rejection_guard')",
      replacement:
        "array_position(v_import_trigger_order, 'trg_00_import_batches_no_delete')\n        > pg_catalog.array_position(v_import_trigger_order, 'trg_07_import_batches_rejection_guard')",
      issue: 'triggers import_batches: ordem',
    },
  ];

  for (const testCase of cases) {
    await t.test(testCase.name, () => assertStructuralMutation(testCase));
  }
});

test('scanner global impede ausencia, warning, NULL e defaults decompilados', () => {
  assert.ok(
    scanD40StructuralPreconditions(
      replaceOnce(OFFICIAL_HARNESS, '$d40_structure$', '$removed_structure$'),
    ).some((issue) => issue.includes('exatamente um bloco')),
  );
  assert.ok(
    scanD40StructuralPreconditions(
      replaceOnce(OFFICIAL_HARNESS, 'raise exception', 'raise warning'),
    ).some((issue) => issue.includes('warning')),
  );
  assert.ok(
    scanD40StructuralPreconditions(
      replaceOnce(
        OFFICIAL_HARNESS,
        'if v_trigger_order is distinct from v_expected_project_triggers then',
        'if v_trigger_order <> v_expected_project_triggers then',
      ),
    ).some((issue) => issue.includes('NULL')),
  );
  assert.ok(
    scanD40StructuralPreconditions(
      replaceOnce(
        OFFICIAL_HARNESS,
        'begin\n    if (',
        'begin\n    perform pg_catalog.pg_get_constraintdef(1);\n    if (',
      ),
    ).some((issue) => issue.includes('pg_get_constraintdef')),
  );
});

test('aceita migration e harness D40 versionados', () => {
  assert.deepEqual(checkD40(), []);
});

test('harness D40 oficial usa ZZZ e preserva os 47 cenários', () => {
  const official = fs.readFileSync('database/audit/ltcm-d40-tests.sql', 'utf8');
  assert.deepEqual(extractSyntheticCurrencyCodes(official), ['ZZZ']);
  assert.deepEqual(scanSyntheticCurrencyFixtures(official, { requireInsert: true }), []);
  assert.doesNotMatch(official, /\bltc_m\.currencies[\s\S]*?values\s*\(\s*'D40'/iu);
  assert.doesNotMatch(official, /'D40'\s*,\s*100/gu);
  assert.match(official, /D40-NORMAL/u);
  assert.equal(D40_SCENARIO_COUNT, 47);
  assert.deepEqual(scanD40HarnessText(official), []);
});

test('scanner monetário falha fechado para código inválido e INSERT não reconhecido', () => {
  const invalidCode = `
    insert into ltc_m.currencies (code, name, decimal_places, active)
    values ('C43', 'Inválida', 2, true);
  `;
  const unrecognizedInsert = `
    insert into ltc_m.currencies (name, code, decimal_places, active)
    values ('Inválida', 'ZZZ', 2, true);
  `;
  assert.ok(
    scanSyntheticCurrencyFixtures(invalidCode, { requireInsert: true }).some((issue) =>
      issue.includes('inválido'),
    ),
  );
  assert.ok(
    scanSyntheticCurrencyFixtures(unrecognizedInsert, { requireInsert: true }).some((issue) =>
      issue.includes('formato nominal'),
    ),
  );
});

test('rejeita harness sem rollback, com commit, DDL, rede ou credencial', () => {
  const issues = scanD40HarnessText(`
    begin;
    create table ltc_m.extra (id integer);
    insert into public.clients values (1);
    select 'https://example.invalid', 'password';
    commit;
  `);
  assert.ok(issues.some((issue) => issue.includes('ROLLBACK')));
  assert.ok(issues.some((issue) => issue.includes('COMMIT')));
  assert.ok(issues.some((issue) => issue.includes('DDL')));
  assert.ok(issues.some((issue) => issue.includes('rede ou credencial')));
  assert.ok(issues.some((issue) => issue.includes('fora de ltc_m')));
});

test('rejeita remoção de cenário obrigatório', () => {
  const official = fs.readFileSync('database/audit/ltcm-d40-tests.sql', 'utf8');
  assert.ok(
    scanD40HarnessText(official.replaceAll('Admin sem request ID', 'contexto removido')).some(
      (issue) => issue.includes('request obrigatório'),
    ),
  );
});

test('rejeita remoção de cenário D41 obrigatório', () => {
  const official = fs.readFileSync('database/audit/ltcm-d40-tests.sql', 'utf8');
  assert.ok(
    scanD40HarnessText(
      official.replaceAll('correção parcial liberou o lote antigo', 'cenário removido'),
    ).some((issue) => issue.includes('D41 correção parcial')),
  );
});
