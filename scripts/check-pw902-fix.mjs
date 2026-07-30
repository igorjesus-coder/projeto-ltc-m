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
]);

const CORRECTION_NAME = '20260730155749_fix_ltcm_workflow_guard_fail_closed.sql';
const EXPECTED_FUNCTIONS = new Set([
  'ltc_m.workflow_guard_active',
  'ltc_m.protect_plan_version',
  'ltc_m.audit_row_change',
  'ltc_m.approve_plan_version',
]);

const REQUIRED_TEST_SCENARIOS = [
  ['PW902 preservado', /errcode\s*=\s*'PW902'/i],
  ['guarda ausente', /guarda ausente ou resetada foi aceita/i],
  ['guarda vazia', /guarda vazia foi aceita/i],
  ['guarda inválida', /guarda inválida foi aceita/i],
  ['guarda false', /guarda textual false foi aceita/i],
  ['guarda true externa', /guarda textual true foi aceita/i],
  ['restauração da guarda', /guarda interna não foi restaurada/i],
  ['aprovação direta', /aprovação direta foi aceita/i],
  ['retorno direto', /retorno direto para draft foi aceito/i],
  ['bloqueio direto', /bloqueio direto foi aceito/i],
  ['vazamento pós-transação', /guarda vazou após rollback/i],
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

export function scanPw902MigrationText(sql) {
  const issues = [...scanMigrationText(sql)];
  const stripped = stripSqlNoise(sql);
  const functions = createdOrReplacedFunctions(sql);

  if (!/^\s*begin\s*;/i.test(stripped) || !/\bcommit\s*;\s*$/i.test(stripped)) {
    issues.push('migration corretiva deve ser uma única transação explícita');
  }

  for (const [pattern, message] of [
    [/\bcreate\s+function\b/i, 'somente CREATE OR REPLACE FUNCTION é permitido'],
    [
      /\b(?:create|alter|drop)\s+(?:table|type|trigger|index|sequence|schema)\b/i,
      'objeto estrutural fora do escopo PW902',
    ],
    [/\bcomment\s+on\s+function\s+(?!ltc_m\.)/i, 'comentário fora de ltc_m'],
    [
      /pg_catalog\.current_setting\s*\([^)]*,\s*true\s*\)\s*::\s*boolean/i,
      'cast booleano inseguro de current_setting',
    ],
    [
      /\bnot\s+ltc_m\.workflow_guard_active\s*\(/i,
      'NOT workflow_guard_active sem tratamento fail-closed',
    ],
    [/ltc_m\.workflow_guard_active\s*\([^)]*\)\s*=\s*false/i, 'comparação = false não trata NULL'],
  ]) {
    if (pattern.test(stripped) || pattern.test(sql)) issues.push(message);
  }

  if (functions.length !== EXPECTED_FUNCTIONS.size) {
    issues.push('a correção deve substituir exatamente quatro funções afetadas');
  }
  for (const functionName of EXPECTED_FUNCTIONS) {
    if (!functions.includes(functionName)) {
      issues.push(`função corretiva ausente: ${functionName}`);
    }
  }
  for (const functionName of functions) {
    if (!EXPECTED_FUNCTIONS.has(functionName)) {
      issues.push(`função fora do escopo PW902: ${functionName}`);
    }
  }

  if (
    !/create\s+or\s+replace\s+function\s+ltc_m\.workflow_guard_active[\s\S]*?select\s+coalesce\s*\(/i.test(
      sql,
    )
  ) {
    issues.push('workflow_guard_active deve garantir retorno booleano não nulo');
  }
  for (const action of ['submit', 'return', 'approve', 'lock']) {
    if (!new RegExp(`'${action}'`, 'i').test(sql)) {
      issues.push(`ação interna ausente na guarda: ${action}`);
    }
  }
  if (!/ltc_m\.workflow_guard_active\s*\(\s*v_action\s*\)\s+is\s+not\s+true/i.test(sql)) {
    issues.push('protect_plan_version deve rejeitar qualquer guarda diferente de true');
  }
  if (!/ltc_m\.workflow_guard_active\s*\(\s*v_action\s*\)\s+is\s+true/i.test(sql)) {
    issues.push('audit_row_change deve classificar somente guarda explicitamente true');
  }

  return [...new Set(issues)];
}

export function scanPw902TestText(sql) {
  const issues = [];
  for (const [name, pattern] of REQUIRED_TEST_SCENARIOS) {
    if (!pattern.test(sql)) issues.push(`cenário PW902 ausente: ${name}`);
  }
  return issues;
}

export function checkPw902Fix(migrationDirectory, testPath) {
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

  for (const filename of sqlFiles.filter((candidate) => !APPLIED_MIGRATION_HASHES.has(candidate))) {
    const functions = createdOrReplacedFunctions(
      fs.readFileSync(path.join(migrationDirectory, filename), 'utf8'),
    );
    if (functions.some((functionName) => EXPECTED_FUNCTIONS.has(functionName))) {
      issues.push('deve existir exatamente uma migration forward nova para PW902');
    }
  }

  const correctionPath = path.join(migrationDirectory, CORRECTION_NAME);
  if (fs.existsSync(correctionPath)) {
    for (const issue of scanPw902MigrationText(fs.readFileSync(correctionPath, 'utf8'))) {
      issues.push(`${CORRECTION_NAME}: ${issue}`);
    }
  }

  if (!fs.existsSync(testPath)) {
    issues.push('suíte PostgreSQL P007 ausente');
  } else {
    issues.push(...scanPw902TestText(fs.readFileSync(testPath, 'utf8')));
  }

  return [...new Set(issues)];
}

function main() {
  const root = process.cwd();
  const migrationDirectory = path.join(root, 'supabase', 'migrations');
  const testPath = path.join(root, 'database', 'audit', 'ltcm-p007-tests.sql');
  const issues = checkPw902Fix(migrationDirectory, testPath);

  if (issues.length > 0) {
    console.error(`Validação PW902 falhou:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  console.log('Correção PW902 válida: forward-only, fail-closed e migrations aplicadas intactas');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
