import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { stripSqlNoise } from './check-migrations.mjs';
import { validateP009ScenarioSource } from './sql-rendering.mjs';

export const P009_FILENAME = '20260731130000_add_ltcm_import_staging.sql';
const P009_LAST_TIMESTAMP = '20260731120000';
const REQUIRED_TABLES = ['import_batch_sheets', 'import_staging_rows'];
const REQUIRED_POLICIES = [
  'import_batch_sheets_select',
  'import_batch_sheets_insert',
  'import_batch_sheets_update',
  'import_staging_rows_select',
  'import_staging_rows_insert',
  'import_staging_rows_update',
];

function migrationFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

export function scanP009MigrationText(sql) {
  const issues = [];
  const stripped = stripSqlNoise(sql);

  if (!/create\s+table\s+ltc_m\.import_batch_sheets\b/i.test(stripped)) {
    issues.push('import_batch_sheets ausente');
  }
  if (!/create\s+table\s+ltc_m\.import_staging_rows\b/i.test(stripped)) {
    issues.push('import_staging_rows ausente');
  }
  for (const table of REQUIRED_TABLES) {
    if (
      !new RegExp(
        `alter\\s+table\\s+ltc_m\\.${table}\\s+enable\\s+row\\s+level\\s+security`,
        'i',
      ).test(stripped)
    ) {
      issues.push(`RLS ausente: ${table}`);
    }
    if (
      !new RegExp(
        `alter\\s+table\\s+ltc_m\\.${table}\\s+force\\s+row\\s+level\\s+security`,
        'i',
      ).test(stripped)
    ) {
      issues.push(`FORCE RLS ausente: ${table}`);
    }
  }
  for (const policy of REQUIRED_POLICIES) {
    if (!new RegExp(`create\\s+policy\\s+${policy}\\b`, 'i').test(stripped)) {
      issues.push(`policy ausente: ${policy}`);
    }
  }

  const requiredFragments = [
    'source_hash_p009',
    'uq_import_batches_idempotency_key_p009',
    'uq_import_batch_sheets_batch_key_p009',
    'uq_import_batch_sheets_batch_name_p009',
    'uq_import_staging_rows_sheet_row_p009',
    'ck_import_staging_rows_payload_p009',
    'ck_import_staging_rows_hash_p009',
    'protect_import_staging_row',
    'trg_00_import_staging_rows_immutable',
    'severity',
    'raw_value',
    'monthly_revenue',
    'project_values',
    'curve_s',
  ];
  const source = sql.toLowerCase();
  for (const fragment of requiredFragments) {
    if (!source.includes(fragment.toLowerCase())) {
      issues.push(`contrato P009 ausente: ${fragment}`);
    }
  }

  for (const [pattern, message] of [
    [/staging_(?:valores|prev|curva)/i, 'tabela duplicada por aba'],
    [/\b(?:xlsx|exceljs|sheetjs|xlsx-populate)\b/i, 'dependência de Excel no P009'],
    [/\b(?:create|alter|drop)\s+role\b/i, 'role fora do escopo P009'],
    [/\b(?:add|drop|grant|revoke)\s+member\b/i, 'membership fora do escopo P009'],
    [
      /\b(?:insert\s+into|update\s+ltc_m\.|delete\s+from|copy)\b/i,
      'DML de dados fora do escopo P009',
    ],
    [
      /\b(?:auth\.users|auth\.uid\s*\(|storage\.|public\.)/i,
      'objeto externo/Auth fora do escopo P009',
    ],
    [/\bgrant\b[\s\S]*?\bto\s+(?!ltc_m_runtime\b)/i, 'grant para papel diferente do runtime'],
    [/\bfor\s+(?:delete|all)\b/i, 'policy DELETE/FOR ALL proibida'],
  ]) {
    if (pattern.test(stripped)) issues.push(message);
  }

  for (const match of stripped.matchAll(/\bdrop\s+index\s+([^;]+);/gi)) {
    if (!/^\s*ltc_m\.uq_import_batches_hash\s*$/i.test(match[1])) {
      issues.push('DROP INDEX fora do contrato P009');
    }
  }

  if (
    !/grant\s+(?:select|select\s*,\s*insert\s*,\s*update)[\s\S]*?to\s+ltc_m_runtime/i.test(stripped)
  ) {
    issues.push('grant mínimo ao runtime ausente');
  }
  if (/grant\s+.*\b(?:delete|truncate|references|trigger|create)\b/i.test(stripped)) {
    issues.push('privilégio proibido concedido ao runtime');
  }

  if (/Decis[\s\S]{0,6}Aprovadas/i.test(sql)) {
    const documentaryIssue = issues.findIndex((issue) =>
      issue.includes('aba documental rejeitada'),
    );
    if (documentaryIssue >= 0) issues.splice(documentaryIssue, 1);
  }
  return [...new Set(issues)];
}

export function scanP009TestText(sql) {
  const issues = [];
  const stripped = stripSqlNoise(sql);

  if ((stripped.match(/\bbegin\s*;/gi) ?? []).length !== 1) issues.push('teste deve ter um BEGIN');
  if ((stripped.match(/\brollback\s*;/gi) ?? []).length !== 1)
    issues.push('teste deve ter um ROLLBACK');
  if (/\bcommit\s*;/i.test(stripped)) issues.push('COMMIT proibido');
  if (!/rollback\s*;[\s\S]*?rollback_clean/i.test(stripped)) issues.push('rollback_clean ausente');
  if (/\b(?:password|client_secret|private_key|connection_string)\b/i.test(sql))
    issues.push('credencial proibida');

  try {
    validateP009ScenarioSource(sql);
  } catch (error) {
    issues.push(`fluxo request D32 invalido: ${error.message}`);
  }
  if (!/['"]request_contract['"][\s\S]*?p009_request_matrix/iu.test(sql)) {
    issues.push('matriz configurado-auditado D32 ausente');
  }

  const allowedTargets = new Set([
    'ltc_m.app_users',
    'ltc_m.import_batches',
    'ltc_m.import_batch_sheets',
    'ltc_m.import_staging_rows',
    'ltc_m.import_row_errors',
  ]);
  for (const match of stripped.matchAll(
    /\b(?:insert\s+into|update|delete\s+from)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi,
  )) {
    if (!allowedTargets.has(match[1].toLowerCase()))
      issues.push(`mutaÃ§Ã£o fora do P009: ${match[1]}`);
  }
  const hasNegativeDeleteAssertions =
    /delete\s+from\s+ltc_m\.import_batches[\s\S]*?Editor realizou DELETE/i.test(sql) &&
    /delete\s+from\s+ltc_m\.import_staging_rows[\s\S]*?Admin realizou DELETE/i.test(sql);
  if (
    !hasNegativeDeleteAssertions &&
    /\bdelete\s+from\s+ltc_m\.(?:import_batches|import_batch_sheets|import_staging_rows|import_row_errors)/i.test(
      stripped,
    )
  ) {
    issues.push('DELETE fÃ­sico de importaÃ§Ã£o proibido');
  }

  const documentaryText = /Decis[\s\S]{0,6}Aprovadas/i;
  const requiredScenarios = [
    [
      'fixtures de perfil com estado ativo explicito',
      /insert\s+into\s+ltc_m\.app_users\s*\(\s*id\s*,\s*auth_subject\s*,\s*full_name\s*,\s*role\s*,\s*active\s*\)[\s\S]*?'viewer'\s*,\s*true\s*\)[\s\S]*?'editor'\s*,\s*true\s*\)[\s\S]*?'admin'\s*,\s*true\s*\)[\s\S]*?'viewer'\s*,\s*false\s*\)/i,
    ],
    ['hash repetido em lotes distintos', /source_hash[\s\S]*?idempotency_key[\s\S]*?source_hash/i],
    ['hash de arquivo invalido', /hash de arquivo invalido foi aceito/i],
    ['contador negativo', /contador negativo foi aceito/i],
    ['metadata objeto', /metadata nao objeto foi aceita/i],
    ['trÃªs chaves de aba', /project_values[\s\S]*?monthly_revenue[\s\S]*?curve_s/i],
    ['aba documental rejeitada', /DecisÃµes Aprovadas/i],
    ['linhas staged', /import_staging_rows/i],
    [
      'dois erros na linha',
      /(?:warning[\s\S]*?error|error[\s\S]*?warning)[\s\S]*?import_row_errors/i,
    ],
    ['imutabilidade do payload', /raw_payload[\s\S]*?(?:23514|check_violation)/i],
    [
      'imutabilidade de origem e hash',
      /origem da linha foi alterada[\s\S]*?hash da linha foi alterado/i,
    ],
    ['coordenada Ãºnica', /source_row_number[\s\S]*?(?:23505|unique_violation)/i],
    ['runtime real', /set\s+local\s+role\s+ltc_m_runtime/i],
    ['viewer/editor/admin', /viewer_rls[\s\S]*?editor_rls[\s\S]*?admin_rls/i],
    ['delete rejeitado', /delete\s+from\s+ltc_m\.(?:import_batches|import_staging_rows)/i],
    [
      'erro append-only',
      /import_row_errors aceitou update[\s\S]*?import_row_errors aceitou delete/i,
    ],
    ['auditoria sanitizada', /auditoria duplicou payload ou segredo/i],
    ['rollback limpo', /rollback_clean/i],
  ];
  for (const [name, pattern] of requiredScenarios)
    if (!pattern.test(sql)) issues.push(`cenÃ¡rio ausente: ${name}`);

  if (documentaryText.test(sql)) {
    const documentaryIssue = issues.findIndex((issue) =>
      issue.includes('aba documental rejeitada'),
    );
    if (documentaryIssue >= 0) issues.splice(documentaryIssue, 1);
  }
  return [...new Set(issues)];
}

export function checkP009(rootDirectory = process.cwd()) {
  const migrationDirectory = path.join(rootDirectory, 'supabase', 'migrations');
  const files = migrationFiles(migrationDirectory);
  const issues = [];
  const successors = files.filter((filename) => {
    const timestamp = filename.match(/^(\d{14})_/u)?.[1];
    return timestamp && timestamp > P009_LAST_TIMESTAMP;
  });
  if (successors[0] !== P009_FILENAME) {
    issues.push(`a primeira migration após P008 deve ser P009 ${P009_FILENAME}`);
  }
  const migrationPath = path.join(migrationDirectory, P009_FILENAME);
  if (fs.existsSync(migrationPath))
    issues.push(...scanP009MigrationText(fs.readFileSync(migrationPath, 'utf8')));

  const testPath = path.join(rootDirectory, 'database', 'audit', 'ltcm-p009-staging-tests.sql');
  if (!fs.existsSync(testPath)) issues.push('teste SQL P009 ausente');
  else issues.push(...scanP009TestText(fs.readFileSync(testPath, 'utf8')));
  return { files, issues: [...new Set(issues)] };
}

function main() {
  const result = checkP009();
  if (result.issues.length > 0) {
    console.error(
      `ValidaÃ§Ã£o P009 falhou:\n${result.issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    'P009 vÃ¡lido: staging genÃ©rico, contrato v1, RLS/grants e testes transacionais presentes',
  );
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) main();
