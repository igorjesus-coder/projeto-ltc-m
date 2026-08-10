import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { scanMigrationText, stripSqlNoise } from './check-migrations.mjs';

export const D40_MIGRATION = '20260804120000_add_legacy_project_reference_date_exception.sql';
export const D40_HARNESS = 'database/audit/ltcm-d40-tests.sql';
export const SYNTHETIC_CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/u;
export const D40_STRUCTURAL_PRECONDITION_COUNT = 6;

const CURRENCY_INSERT_TARGET_PATTERN = /\binsert\s+into\s+ltc_m\.currencies\b/giu;
const CURRENCY_INSERT_PATTERN =
  /\binsert\s+into\s+ltc_m\.currencies\s*\(\s*code\s*,[^)]*\)\s*values\s*\(\s*'((?:''|[^'])*)'/giu;

const STRUCTURAL_BLOCK_PATTERN = /\bdo\s+\$d40_structure\$([\s\S]*?)\$d40_structure\$\s*;/giu;

const STRUCTURAL_REQUIREMENTS = [
  ['FK: catalogo nominal', /\bfrom\s+pg_catalog\.pg_constraint\s+as\s+fk_constraint\b/iu],
  ['FK: tipo', /\bfk_constraint\.contype\s*=\s*'f'/iu],
  ['FK: nome', /\bfk_constraint\.conname\s*=\s*'fk_projects_legacy_import_batch'/iu],
  ['FK: tabela origem', /\bfk_constraint\.conrelid\s*=\s*'ltc_m\.projects'::regclass/iu],
  ['FK: tabela destino', /\bfk_constraint\.confrelid\s*=\s*'ltc_m\.import_batches'::regclass/iu],
  [
    'FK: cardinalidade da chave origem',
    /\bpg_catalog\.cardinality\(fk_constraint\.conkey\)\s*=\s*1/iu,
  ],
  ['FK: attnum da chave origem', /\bsource_attribute\.attnum\s*=\s*fk_constraint\.conkey\[1\]/iu],
  ['FK: coluna origem', /\bsource_attribute\.attname\s*=\s*'legacy_import_batch_id'/iu],
  [
    'FK: cardinalidade da chave destino',
    /\bpg_catalog\.cardinality\(fk_constraint\.confkey\)\s*=\s*1/iu,
  ],
  ['FK: attnum da chave destino', /\btarget_attribute\.attnum\s*=\s*fk_constraint\.confkey\[1\]/iu],
  ['FK: coluna destino', /\btarget_attribute\.attname\s*=\s*'id'/iu],
  ['FK: match type', /\bfk_constraint\.confmatchtype\s*=\s*'s'/iu],
  ['FK: ON UPDATE', /\bfk_constraint\.confupdtype\s*=\s*'a'/iu],
  ['FK: ON DELETE', /\bfk_constraint\.confdeltype\s*=\s*'a'/iu],
  ['FK: NOT DEFERRABLE', /\bnot\s+fk_constraint\.condeferrable\b/iu],
  ['FK: INITIALLY IMMEDIATE', /\bnot\s+fk_constraint\.condeferred\b/iu],
  ['FK: validada', /\band\s+fk_constraint\.convalidated\b/iu],
  ['CHECK: catalogo nominal', /\bfrom\s+pg_catalog\.pg_constraint\s+as\s+check_constraint\b/iu],
  ['CHECK: tipo', /\bcheck_constraint\.contype\s*=\s*'c'/iu],
  ['CHECK: nome', /\bcheck_constraint\.conname\s*=\s*'ck_projects_data_reference_date_legacy'/iu],
  ['CHECK: tabela', /\bcheck_constraint\.conrelid\s*=\s*'ltc_m\.projects'::regclass/iu],
  ['CHECK: validada', /\band\s+check_constraint\.convalidated\b/iu],
  [
    'CHECK: expressao logica',
    /\bpg_catalog\.pg_get_expr\(check_constraint\.conbin,\s*check_constraint\.conrelid\)[\s\S]*?=\s*'data_reference_dateisnotnullorlegacy_import_batch_idisnotnull'/iu,
  ],
  ['NOT NULL: tabela', /\breference_date_attribute\.attrelid\s*=\s*'ltc_m\.projects'::regclass/iu],
  ['NOT NULL: coluna', /\breference_date_attribute\.attname\s*=\s*'data_reference_date'/iu],
  ['NOT NULL: coluna de usuario', /\breference_date_attribute\.attnum\s*>\s*0/iu],
  ['NOT NULL: coluna existente', /\bnot\s+reference_date_attribute\.attisdropped\b/iu],
  ['NOT NULL: removido', /\bnot\s+reference_date_attribute\.attnotnull\b/iu],
  ['Indice: catalogo', /\bfrom\s+pg_catalog\.pg_index\s+as\s+index_record\b/iu],
  ['Indice: schema', /\bindex_namespace\.nspname\s*=\s*'ltc_m'/iu],
  ['Indice: nome', /\bindex_class\.relname\s*=\s*'ix_projects_legacy_import_batch'/iu],
  ['Indice: schema da tabela', /\btable_namespace\.nspname\s*=\s*'ltc_m'/iu],
  ['Indice: tabela', /\btable_class\.relname\s*=\s*'projects'/iu],
  ['Indice: uma chave', /\bindex_record\.indnatts\s*=\s*1/iu],
  ['Indice: uma coluna-chave', /\bindex_record\.indnkeyatts\s*=\s*1/iu],
  ['Indice: sem chave de expressao', /\bindex_record\.indexprs\s+is\s+null/iu],
  ['Indice: attnum da coluna', /\bindexed_attribute\.attnum\s*=\s*index_record\.indkey\[0\]/iu],
  ['Indice: coluna', /\bindexed_attribute\.attname\s*=\s*'legacy_import_batch_id'/iu],
  ['Indice: nao unico', /\bnot\s+index_record\.indisunique\b/iu],
  ['Indice: valido', /\band\s+index_record\.indisvalid\b/iu],
  ['Indice: pronto', /\band\s+index_record\.indisready\b/iu],
  ['Indice: parcial', /\bindex_record\.indpred\s+is\s+not\s+null/iu],
  [
    'Indice: predicado',
    /\bpg_catalog\.pg_get_expr\(index_record\.indpred,\s*index_record\.indrelid\)[\s\S]*?=\s*'legacy_import_batch_idisnotnull'/iu,
  ],
  [
    'triggers projects: conjunto normativo',
    /v_expected_project_triggers\s+constant\s+text\[\]\s*:=\s*array\[\s*'trg_00_projects_no_delete',\s*'trg_05_projects_inactivation',\s*'trg_07_projects_legacy_reference_guard',\s*'trg_10_projects_metadata',\s*'trg_90_projects_audit'\s*\]/iu,
  ],
  [
    'triggers projects: ausencia fail-closed',
    /\bif\s+v_trigger_order\s+is\s+distinct\s+from\s+v_expected_project_triggers\s+then\b/iu,
  ],
  [
    'triggers projects: catalogo ativo',
    /\bfrom\s+pg_catalog\.pg_trigger[^;]*?tgrelid\s*=\s*'ltc_m\.projects'::regclass[^;]*?not\s+pg_trigger\.tgisinternal[^;]*?pg_trigger\.tgenabled\s*<>\s*'D'\s*;/iu,
  ],
  [
    'triggers projects: ordem normativa',
    /array_position\(v_trigger_order,\s*'trg_00_projects_no_delete'\)[\s\S]*?<\s*pg_catalog\.array_position\(v_trigger_order,\s*'trg_05_projects_inactivation'\)[\s\S]*?<\s*pg_catalog\.array_position\(v_trigger_order,\s*'trg_07_projects_legacy_reference_guard'\)[\s\S]*?<\s*pg_catalog\.array_position\(v_trigger_order,\s*'trg_10_projects_metadata'\)[\s\S]*?<\s*pg_catalog\.array_position\(v_trigger_order,\s*'trg_90_projects_audit'\)/iu,
  ],
  [
    'triggers import_batches: conjunto normativo',
    /v_expected_import_triggers\s+constant\s+text\[\]\s*:=\s*array\[\s*'trg_00_import_batches_no_delete',\s*'trg_07_import_batches_rejection_guard',\s*'trg_10_import_batches_metadata',\s*'trg_90_import_batches_audit'\s*\]/iu,
  ],
  [
    'triggers import_batches: ausencia fail-closed',
    /\bif\s+v_import_trigger_order\s+is\s+distinct\s+from\s+v_expected_import_triggers\s+then\b/iu,
  ],
  [
    'triggers import_batches: catalogo ativo',
    /\bfrom\s+pg_catalog\.pg_trigger[^;]*?tgrelid\s*=\s*'ltc_m\.import_batches'::regclass[^;]*?not\s+pg_trigger\.tgisinternal[^;]*?pg_trigger\.tgenabled\s*<>\s*'D'\s*;/iu,
  ],
  [
    'triggers import_batches: ordem normativa',
    /array_position\(v_import_trigger_order,\s*'trg_00_import_batches_no_delete'\)[\s\S]*?<\s*pg_catalog\.array_position\(v_import_trigger_order,\s*'trg_07_import_batches_rejection_guard'\)[\s\S]*?<\s*pg_catalog\.array_position\(v_import_trigger_order,\s*'trg_10_import_batches_metadata'\)[\s\S]*?<\s*pg_catalog\.array_position\(v_import_trigger_order,\s*'trg_90_import_batches_audit'\)/iu,
  ],
];

const REQUIRED_SCENARIOS = [
  ['data sem lote', /Projeto novo com data e sem lote/iu],
  ['nulo sem lote', /Sem data e sem lote/iu],
  ['legado por Admin', /Admin ativo e contexto completo/iu],
  ['FK inexistente', /Lote inexistente/iu],
  ['Editor rejeitado', /Editor tentando criar exceção/iu],
  ['justificativa obrigatória', /Admin sem justificativa/iu],
  ['request obrigatório', /Admin sem request ID/iu],
  ['Admin inativo', /Admin inativo/iu],
  ['received aceito', /D40-RECEIVED/iu],
  ['validating aceito', /D40-VALIDATING/iu],
  ['loaded aceito', /D40-LOADED/iu],
  ['rejected negado', /lote rejected foi aceito/iu],
  ['data e lote', /Data\+lote exige Admin/iu],
  ['enriquecimento', /Enriquecimento sintético D40/iu],
  ['remoção negada', /linhagem foi removida/iu],
  ['correção de lote', /Correção sintética de lote D40/iu],
  ['linhagem preservada', /enriquecimento não preservou\/corrigiu a linhagem/iu],
  ['delete negado', /DELETE físico foi aceito/iu],
  ['P008/D24 preservados', /Viewer\/Editor\/Admin e D24 continuam/iu],
  ['auditoria contextual', /auditoria before\/after\/contexto incompleta/iu],
  ['rollback limpo', /rollback_clean/iu],
  ['escopo ltc_m', /não há mutação fora do schema/iu],
  ['D41 received sem vínculo', /d41-unlinked-received/iu],
  ['D41 validating sem vínculo', /d41-unlinked-validating/iu],
  ['D41 loaded sem vínculo', /d41-unlinked-loaded/iu],
  ['D41 received vinculado', /D40-RECEIVED/iu],
  ['D41 validating vinculado', /D40-VALIDATING/iu],
  ['D41 loaded vinculado', /D40-LOADED/iu],
  ['D41 data nula', /D41-MULTIPLE-B[\s\S]*?100, null/iu],
  ['D41 data preenchida', /D41-ACTIVE/iu],
  ['D41 draft', /D41-MULTIPLE-A/iu],
  ['D41 active', /Projeto sintético active/iu],
  ['D41 completed', /Projeto sintético completed/iu],
  ['D41 inactive real', /enum real não possui inactive/iu],
  ['D41 soft delete', /deleted_at is not null/iu],
  ['D41 múltiplos projetos', /D41-MULTIPLE-A[\s\S]*?D41-MULTIPLE-B/iu],
  ['D41 correção total', /d41-correct-all/iu],
  ['D41 correção parcial', /correção parcial liberou o lote antigo/iu],
  ['D41 limpeza negada', /limpeza de legacy_import_batch_id foi aceita/iu],
  ['D41 sem Admin', /correção sem Admin foi aceita/iu],
  ['D41 sem justificativa', /correção sem justificativa foi aceita/iu],
  ['D41 sem request', /correção sem request ID foi aceita/iu],
  ['D41 destino rejected', /correção para lote rejected foi aceita/iu],
  ['D41 auditoria', /auditoria before\/after da correção ausente/iu],
  ['D41 atomicidade lote', /rejeição bloqueada alterou o lote/iu],
  ['D41 atomicidade projeto', /rejeição bloqueada alterou projeto histórico/iu],
  ['D41 rollback', /rollback deixou fixture permanente/iu],
];

export const D40_SCENARIO_COUNT = REQUIRED_SCENARIOS.length;

export function isValidSyntheticCurrencyCode(code) {
  return typeof code === 'string' && SYNTHETIC_CURRENCY_CODE_PATTERN.test(code);
}

export function extractSyntheticCurrencyCodes(sql) {
  return [...String(sql).matchAll(CURRENCY_INSERT_PATTERN)].map((match) =>
    match[1].replaceAll("''", "'"),
  );
}

export function scanSyntheticCurrencyFixtures(sql, { requireInsert = false } = {}) {
  const source = String(sql);
  const insertCount = (source.match(CURRENCY_INSERT_TARGET_PATTERN) ?? []).length;
  const codes = extractSyntheticCurrencyCodes(source);
  const issues = [];
  if (requireInsert && insertCount === 0) {
    issues.push('fixture monetária sintética ausente');
  }
  if (codes.length !== insertCount) {
    issues.push('INSERT de ltc_m.currencies fora do formato nominal autorizado');
  }
  for (const code of codes) {
    if (!isValidSyntheticCurrencyCode(code)) {
      issues.push(`código monetário sintético inválido: ${JSON.stringify(code)}`);
    }
  }
  return [...new Set(issues)];
}

export function scanD40StructuralPreconditions(sql) {
  const source = String(sql);
  const blocks = [...source.matchAll(STRUCTURAL_BLOCK_PATTERN)];
  if (blocks.length !== 1) {
    return ['preconditions D40 devem conter exatamente um bloco estrutural'];
  }

  const block = blocks[0][1];
  const issues = [];
  for (const [label, pattern] of STRUCTURAL_REQUIREMENTS) {
    if (!pattern.test(block))
      issues.push(`precondition estrutural ausente ou divergente: ${label}`);
  }

  if (/\bpg_catalog\.pg_get_constraintdef\s*\(/iu.test(block)) {
    issues.push('preconditions D40 nao podem depender de pg_get_constraintdef');
  }
  if (/\bpg_catalog\.pg_get_indexdef\s*\(/iu.test(block)) {
    issues.push('precondition do indice nao pode depender de pg_get_indexdef');
  }
  if ((block.match(/\)\s*<>\s*1\s+then\b/giu) ?? []).length !== 4) {
    issues.push('FK, CHECK, NOT NULL e indice devem falhar com contagem estrutural exatamente um');
  }
  if ((block.match(/\bis\s+distinct\s+from\b/giu) ?? []).length !== 2) {
    issues.push(
      'conjuntos de triggers devem falhar fechado inclusive quando o catalogo retorna NULL',
    );
  }
  if (/\braise\s+warning\b/iu.test(block)) {
    issues.push('precondition estrutural divergente nao pode virar warning');
  }

  const projectPresence = block.indexOf(
    'if v_trigger_order is distinct from v_expected_project_triggers then',
  );
  const projectOrder = block.indexOf(
    "array_position(v_trigger_order, 'trg_00_projects_no_delete')",
  );
  if (projectPresence < 0 || projectOrder < 0 || projectPresence > projectOrder) {
    issues.push('triggers projects devem provar presenca antes da ordem');
  }

  const importPresence = block.indexOf(
    'if v_import_trigger_order is distinct from v_expected_import_triggers then',
  );
  const importOrder = block.indexOf(
    "array_position(v_import_trigger_order, 'trg_00_import_batches_no_delete')",
  );
  if (importPresence < 0 || importOrder < 0 || importPresence > importOrder) {
    issues.push('triggers import_batches devem provar presenca antes da ordem');
  }

  return [...new Set(issues)];
}

export function scanD40HarnessText(sql) {
  const issues = [];
  issues.push(...scanSyntheticCurrencyFixtures(sql, { requireInsert: true }));
  issues.push(...scanD40StructuralPreconditions(sql));
  const stripped = stripSqlNoise(sql);
  if ((stripped.match(/\bbegin\s*;/giu) ?? []).length !== 1) {
    issues.push('harness D40 deve conter um BEGIN');
  }
  if ((stripped.match(/\brollback\s*;/giu) ?? []).length !== 1) {
    issues.push('harness D40 deve conter um ROLLBACK');
  }
  if (/\bcommit\s*;/iu.test(stripped)) issues.push('COMMIT proibido no harness D40');
  if (/\b(?:create|alter|drop|truncate|copy)\b/iu.test(stripped)) {
    issues.push('DDL/COPY proibido no harness D40');
  }
  if (
    /\b(?:password|client_secret|private_key|connection_string|https?:\/\/|supabase)\b/iu.test(sql)
  ) {
    issues.push('rede ou credencial proibida no harness D40');
  }
  for (const match of stripped.matchAll(
    /\b(?:insert\s+into|update|delete\s+from)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/giu,
  )) {
    if (!match[1].toLowerCase().startsWith('ltc_m.')) {
      issues.push(`mutação fora de ltc_m: ${match[1]}`);
    }
  }
  for (const [label, pattern] of REQUIRED_SCENARIOS) {
    if (!pattern.test(sql)) issues.push(`cenário D40 ausente: ${label}`);
  }
  return [...new Set(issues)];
}

export function checkD40(rootDirectory = process.cwd()) {
  const migrationPath = path.join(rootDirectory, 'supabase', 'migrations', D40_MIGRATION);
  const harnessPath = path.join(rootDirectory, ...D40_HARNESS.split('/'));
  const issues = [];
  if (!fs.existsSync(migrationPath)) issues.push(`migration D40 ausente: ${D40_MIGRATION}`);
  else {
    issues.push(
      ...scanMigrationText(fs.readFileSync(migrationPath, 'utf8'), {
        migrationName: D40_MIGRATION,
      }),
    );
  }
  if (!fs.existsSync(harnessPath)) issues.push(`harness D40 ausente: ${D40_HARNESS}`);
  else issues.push(...scanD40HarnessText(fs.readFileSync(harnessPath, 'utf8')));
  return [...new Set(issues)];
}

function main() {
  const issues = checkD40();
  if (issues.length > 0) {
    console.error(`Validação D40 falhou:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log('D40/D41 válido: migration nominal e 47 cenários locais transacionais presentes');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) main();
