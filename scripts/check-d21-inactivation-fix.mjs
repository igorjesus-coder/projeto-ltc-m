import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { scanMigrationText, stripSqlNoise } from './check-migrations.mjs';

const APPLIED_MIGRATION_HASHES = new Map([
  [
    '20260729163000_create_ltcm_relational_core.sql',
    'FEBE19BC524A467263415415300EA72FABDB42411F240E1F776D785ECA73CABF',
  ],
  [
    '20260730103002_add_ltcm_core_query_indexes.sql',
    'DC7E651D290C443F5C34F4C7D61071B1BE38CDD88E67EAC0B8EBB10E09D59339',
  ],
  [
    '20260730144303_add_ltcm_workflow_enum_values.sql',
    '6E8588D4538B1D32CAEBDC425C2CEC505011309C1B7D5AA0F46A4801FE021B7E',
  ],
  [
    '20260730144304_add_ltcm_versioning_audit_workflow.sql',
    '7891D5FFBC35A9C8D55B0824E2C692F47C261ECFBC02BCF8BA6C58DAEE017361',
  ],
  [
    '20260730155749_fix_ltcm_workflow_guard_fail_closed.sql',
    'C7CB68A7C93734F5D667089DBC6EBE10C866889AC762E8A26638B2D66EA07FE3',
  ],
  [
    '20260730163419_fix_ltcm_admin_inactivation_columns.sql',
    '04DBB1184E86394B4301766749A9CD16F79C84B7ABBC0531CFBB6B038E70A90F',
  ],
]);

const CORRECTION_NAME = '20260730163419_fix_ltcm_admin_inactivation_columns.sql';
const APPROVED_SUCCESSORS = new Set([
  '20260731103000_add_ltcm_audit_read_event.sql',
  '20260731103001_add_ltcm_runtime_rls_security.sql',
  '20260731120000_fix_ltcm_runtime_function_acl.sql',
]);
const EXPECTED_FUNCTION = 'ltc_m.enforce_admin_inactivation';

const REQUIRED_TEST_SCENARIOS = [
  ['update comum de app_users', /update comum de app_users não foi preservado/i],
  ['mudança de role por admin', /mudança de role por admin não foi auditada/i],
  ['mudança de role por editor', /editor alterou role de app_users/i],
  ['inativação por admin', /inativação de app_users não foi auditada/i],
  ['inativação por editor', /editor inativou app_users/i],
  ['inativação por viewer', /viewer inativou app_users/i],
  ['reativação por admin', /reativação de app_users não foi auditada/i],
  ['ausência de ator', /inativação sem ator foi aceita/i],
  ['DELETE físico de app_users', /app_users aceitou DELETE físico/i],
  ['demais triggers associados', /trigger associado não restaurou a entidade/i],
  ['auditoria dos demais triggers', /trigger associado não gerou auditoria esperada/i],
  ['ausência de 42703', /chegaram até aqui sem erro 42703/i],
];

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function createdOrReplacedFunctions(sql) {
  return [
    ...stripSqlNoise(sql).matchAll(
      /\bcreate\s+or\s+replace\s+function\s+(ltc_m\.[a-z_][a-z0-9_]*)\s*\(/gi,
    ),
  ].map((match) => match[1].toLowerCase());
}

export function scanD21MigrationText(sql) {
  const issues = [...scanMigrationText(sql)];
  const stripped = stripSqlNoise(sql);
  const functions = createdOrReplacedFunctions(sql);

  if (!/^\s*begin\s*;/i.test(stripped) || !/\bcommit\s*;\s*$/i.test(stripped)) {
    issues.push('migration D21 deve ser uma única transação explícita');
  }

  for (const [pattern, message] of [
    [/\bcreate\s+function\b/i, 'somente CREATE OR REPLACE FUNCTION é permitido'],
    [
      /\b(?:create|alter|drop)\s+(?:table|type|trigger|index|sequence|schema)\b/i,
      'objeto estrutural fora do escopo D21',
    ],
    [
      /\b(?:old|new)\s*\.\s*[a-z_][a-z0-9_]*/i,
      'função genérica não pode acessar diretamente campos de OLD/NEW',
    ],
    [
      /\b(?:old|new)\s*\.\s*(?:deleted_at|is_active|active)\b/i,
      'referência direta a coluna de inativação heterogênea',
    ],
    [/\bcomment\s+on\s+function\s+(?!ltc_m\.)/i, 'comentário fora de ltc_m'],
  ]) {
    if (pattern.test(stripped) || pattern.test(sql)) issues.push(message);
  }

  if (functions.length !== 1 || functions[0] !== EXPECTED_FUNCTION) {
    issues.push('D21 deve substituir somente ltc_m.enforce_admin_inactivation');
  }

  for (const requiredPattern of [
    /pg_catalog\.to_jsonb\s*\(\s*old\s*\)/i,
    /pg_catalog\.to_jsonb\s*\(\s*new\s*\)/i,
    /v_old_data\s*\?\s*'deleted_at'/i,
    /v_old_data\s*\?\s*'active'/i,
    /tg_table_name\s*=\s*'app_users'/i,
    /v_old_data\s*\?\s*'role'/i,
    /ltc_m\.current_actor_id\s*\(\s*true\s*\)/i,
    /app_users\.role\s*=\s*'admin'/i,
    /app_users\.active\s*=\s*true/i,
    /if\s+v_lifecycle_changed\s+then[\s\S]*?current_justification\s*\(\s*true\s*\)/i,
    /pg_catalog\.jsonb_populate_record\s*\(\s*new\s*,\s*v_new_data\s*\)/i,
  ]) {
    if (!requiredPattern.test(sql)) {
      issues.push(`proteção D21 ausente: ${requiredPattern.source}`);
    }
  }

  return [...new Set(issues)];
}

export function scanD21TestText(sql) {
  const issues = [];
  for (const [name, pattern] of REQUIRED_TEST_SCENARIOS) {
    if (!pattern.test(sql)) issues.push(`cenário D21 ausente: ${name}`);
  }
  return issues;
}

export function checkD21Fix(migrationDirectory, testPath) {
  const issues = [];
  const sqlFiles = fs
    .readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  for (const [filename, expectedHash] of APPLIED_MIGRATION_HASHES) {
    const filePath = path.join(migrationDirectory, filename);
    if (!fs.existsSync(filePath)) {
      issues.push(`migration aplicada ausente: ${filename}`);
    } else if (sha256(filePath) !== expectedHash) {
      issues.push(`migration aplicada alterada: ${filename}`);
    }
  }

  const unexpectedMigrations = sqlFiles.filter(
    (filename) => !APPLIED_MIGRATION_HASHES.has(filename) && !APPROVED_SUCCESSORS.has(filename),
  );
  if (unexpectedMigrations.length > 0) {
    issues.push('deve existir exatamente uma migration forward nova para D21');
  }

  const correctionPath = path.join(migrationDirectory, CORRECTION_NAME);
  if (fs.existsSync(correctionPath)) {
    for (const issue of scanD21MigrationText(fs.readFileSync(correctionPath, 'utf8'))) {
      issues.push(`${CORRECTION_NAME}: ${issue}`);
    }
  }

  if (!fs.existsSync(testPath)) {
    issues.push('suíte PostgreSQL P007 ausente');
  } else {
    issues.push(...scanD21TestText(fs.readFileSync(testPath, 'utf8')));
  }

  return [...new Set(issues)];
}

function main() {
  const root = process.cwd();
  const migrationDirectory = path.join(root, 'supabase', 'migrations');
  const testPath = path.join(root, 'database', 'audit', 'ltcm-p007-tests.sql');
  const issues = checkD21Fix(migrationDirectory, testPath);

  if (issues.length > 0) {
    console.error(`Validação D21 falhou:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    'Correção D21 válida: uma migration forward, função genérica segura e migrations aplicadas intactas',
  );
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
