import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CI_POSTGRES_IMAGE =
  'postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394';
export const CI_PACKAGE_LOCK_SHA256 =
  '7D55A1B1666EB4F482123F1C22F7241541B73D161152BF91BDDA66D9D32E1C06';
export const CI_P008_MIGRATION_SHA256 =
  '485DB38DE4194F2564C6A22D22B145ECA49710A2340B5EBD39C91990EA5CC14A';

const WORKFLOW_PATH = '.github/workflows/ltcm-postgres-validation.yml';

const FORBIDDEN_ENVIRONMENT = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_URL',
  'DATABASE_URL',
];

const CI_EXECUTION_FILES = [
  WORKFLOW_PATH,
  'scripts/run-postgres-ci-validation.mjs',
  'scripts/run-postgres-concurrency-test.mjs',
  'database/audit/ltcm-ci-bootstrap.sql',
  'database/audit/ltcm-ci-final-state.sql',
];

const FORBIDDEN_COMMANDS = [
  /\bsupabase\s+link\b/iu,
  /\bsupabase\s+db\s+push\b/iu,
  /\bsupabase\s+migration\s+repair\b/iu,
  /\bsupabase\s+db\s+reset\b/iu,
  /\B--linked\b/iu,
  /\bsecrets\s*\./iu,
  /\bpull_request_target\b/iu,
];

function normalizedPath(filePath) {
  return filePath.replaceAll('\\', '/');
}

function forbiddenRepositoryPath(filePath) {
  const normalized = normalizedPath(filePath);
  const basename = path.posix.basename(normalized);
  return (
    /(^|\/)\.artifacts\//u.test(normalized) ||
    /\.xlsx$/iu.test(normalized) ||
    (/^\.env(?:\.|$)/u.test(basename) && basename !== '.env.example')
  );
}

function occurrenceCount(source, value) {
  return source.split(value).length - 1;
}

export function validatePostgresImageWorkflow(source) {
  const issues = [];
  const imageLines = source
    .split('\n')
    .filter((line) => /^\s*image:/u.test(line.replace(/\r$/u, '')));

  if (imageLines.length !== 1) {
    issues.push('workflow deve declarar exatamente uma imagem de service');
    return issues;
  }

  const rawLine = imageLines[0];
  const valueSource = rawLine.slice(rawLine.indexOf(':') + 1);
  const value = valueSource.replace(/^ +/u, '');

  if (occurrenceCount(source, CI_POSTGRES_IMAGE) !== 1) {
    issues.push('referência PostgreSQL canônica deve ocorrer uma única vez no workflow');
  }
  if (value !== CI_POSTGRES_IMAGE) {
    issues.push('imagem PostgreSQL não corresponde à referência imutável aprovada');
  }
  if (!/^postgres@sha256:[0-9a-f]{64}$/u.test(value)) {
    issues.push('imagem PostgreSQL deve usar postgres@sha256 e 64 hexadecimais minúsculos');
  }
  if (/^postgres:[^@\s]+@/u.test(value)) {
    issues.push('imagem PostgreSQL não pode conter tag antes do digest');
  }
  if (/\s|\u00a0/u.test(value) || /\p{Cc}/u.test(value)) {
    issues.push('imagem PostgreSQL não pode conter whitespace ou caractere de controle');
  }
  if ([...value].some((character) => character.codePointAt(0) > 0x7f)) {
    issues.push('imagem PostgreSQL deve conter somente ASCII');
  }
  if (valueSource !== valueSource.trimEnd()) {
    issues.push('imagem PostgreSQL não pode conter whitespace final');
  }

  return [...new Set(issues)];
}

export function validateD51Workflow(source) {
  const issues = [];
  if (!/^\s*POSTGRES_USER:\s*supabase_admin\s*$/mu.test(source)) {
    issues.push('workflow deve inicializar supabase_admin como bootstrap superuser');
  }
  if (/^\s*POSTGRES_USER:\s*ci_admin\s*$/mu.test(source)) {
    issues.push('ci_admin não pode ser bootstrap superuser');
  }
  if (!/^\s*PGUSER:\s*supabase_admin\s*$/mu.test(source)) {
    issues.push('PGUSER deve ser supabase_admin no bootstrap D51');
  }
  if (!/pg_isready -U supabase_admin -d ltcm_ci/u.test(source)) {
    issues.push('healthcheck deve usar o bootstrap superuser supabase_admin');
  }
  return issues;
}

export function validateD51Bootstrap(source) {
  const issues = [];
  const required = [
    [
      /current_user\s*<>\s*'supabase_admin'[\s\S]*session_user\s*<>\s*'supabase_admin'/iu,
      'sessão direta de supabase_admin ausente',
    ],
    [
      /create role ci_admin[\s\S]*login[\s\S]*nosuperuser[\s\S]*noinherit[\s\S]*nocreatedb[\s\S]*nocreaterole[\s\S]*nobypassrls/iu,
      'ci_admin separado e restrito ausente',
    ],
    [
      /grant\s+ltc_m_runtime\s+to\s+postgres\s+with\s+admin\s+true\s*,\s*inherit\s+false\s*,\s*set\s+false/iu,
      'GRANT D26 exato ausente',
    ],
    [
      /pg_catalog\.pg_get_userbyid\(grantor\)\s*=\s*'supabase_admin'/iu,
      'assertion do grantor D26 ausente',
    ],
    [
      /alter role supabase_admin nologin noreplication/iu,
      'estado final NOLOGIN de supabase_admin ausente',
    ],
    [/oid\s*=\s*10[\s\S]*rolsuper/iu, 'prova do bootstrap superuser real ausente'],
    [
      /pg_has_role\('postgres',\s*'ltc_m_runtime',\s*'MEMBER'\)/iu,
      'assertion MEMBER de postgres ausente',
    ],
    [
      /pg_has_role\('ci_admin',\s*'ltc_m_runtime',\s*'SET'\)/iu,
      'assertion SET negativa de ci_admin ausente',
    ],
  ];
  for (const [pattern, message] of required) if (!pattern.test(source)) issues.push(message);
  if (/grant\s+ltc_m_runtime\s+to\s+ci_admin/iu.test(source)) {
    issues.push('membership ci_admin para ltc_m_runtime é proibida');
  }
  if (/granted\s+by\s+supabase_admin/iu.test(source)) {
    issues.push('GRANTED BY não pode mascarar o bootstrap D51');
  }
  return issues;
}

export function validateCiEnvironment({
  env = process.env,
  repositoryFiles = [],
  executionSources = {},
  packageLockSha256 = CI_PACKAGE_LOCK_SHA256,
  p008MigrationSha256 = CI_P008_MIGRATION_SHA256,
  requireGitHubActions = false,
} = {}) {
  const issues = [];

  for (const name of FORBIDDEN_ENVIRONMENT) {
    if (String(env[name] ?? '').trim()) issues.push(`variável remota proibida presente: ${name}`);
  }

  if (!['127.0.0.1', 'localhost'].includes(String(env.PGHOST ?? ''))) {
    issues.push('PGHOST deve apontar somente para localhost');
  }
  if (String(env.PGPORT ?? '') !== '5432') issues.push('PGPORT deve ser 5432');
  if (String(env.PGDATABASE ?? '') !== 'ltcm_ci') issues.push('PGDATABASE deve ser ltcm_ci');
  if (String(env.PGUSER ?? '') !== 'supabase_admin') {
    issues.push('PGUSER deve ser supabase_admin');
  }
  if (!/^ltcm_ci_[a-z0-9_]+_only$/u.test(String(env.PGPASSWORD ?? ''))) {
    issues.push('PGPASSWORD deve ser a credencial sintética do job');
  }
  if (!/^ltcm_ci_[a-z0-9_]+_only$/u.test(String(env.LTCM_CI_POSTGRES_PASSWORD ?? ''))) {
    issues.push('senha da role postgres deve ser sintética');
  }
  if (!/^ltcm_ci_[a-z0-9_]+_only$/u.test(String(env.LTCM_CI_ADMIN_PASSWORD ?? ''))) {
    issues.push('senha da role ci_admin deve ser sintética');
  }
  const syntheticPasswords = [
    env.PGPASSWORD,
    env.LTCM_CI_ADMIN_PASSWORD,
    env.LTCM_CI_POSTGRES_PASSWORD,
  ].map((value) => String(value ?? ''));
  if (new Set(syntheticPasswords).size !== syntheticPasswords.length) {
    issues.push('credenciais sintéticas das roles CI devem ser distintas');
  }
  if (String(packageLockSha256).toUpperCase() !== CI_PACKAGE_LOCK_SHA256) {
    issues.push('package-lock.json divergiu do hash aprovado');
  }
  if (String(p008MigrationSha256).toUpperCase() !== CI_P008_MIGRATION_SHA256) {
    issues.push('migration P008 divergiu do hash aprovado');
  }
  if (requireGitHubActions && String(env.GITHUB_ACTIONS ?? '') !== 'true') {
    issues.push('execução dinâmica exige GitHub Actions');
  }

  for (const filePath of repositoryFiles) {
    if (forbiddenRepositoryPath(filePath)) {
      issues.push(`arquivo proibido no repositório: ${normalizedPath(filePath)}`);
    }
  }

  for (const [filePath, source] of Object.entries(executionSources)) {
    if (normalizedPath(filePath) === WORKFLOW_PATH) {
      issues.push(...validatePostgresImageWorkflow(source));
      issues.push(...validateD51Workflow(source));
    }
    if (normalizedPath(filePath) === 'database/audit/ltcm-ci-bootstrap.sql') {
      issues.push(...validateD51Bootstrap(source));
    }
    for (const pattern of FORBIDDEN_COMMANDS) {
      if (pattern.test(source)) {
        issues.push(`operação remota proibida em ${normalizedPath(filePath)}`);
        break;
      }
    }
  }

  return [...new Set(issues)];
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function repositoryFiles(rootDirectory) {
  const stdout = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: rootDirectory,
    encoding: 'utf8',
    windowsHide: true,
  });
  return stdout.split(/\r?\n/u).filter(Boolean);
}

function executionSources(rootDirectory) {
  return Object.fromEntries(
    CI_EXECUTION_FILES.filter((filePath) => fs.existsSync(path.join(rootDirectory, filePath))).map(
      (filePath) => [filePath, fs.readFileSync(path.join(rootDirectory, filePath), 'utf8')],
    ),
  );
}

export function checkCiEnvironment(rootDirectory = process.cwd(), options = {}) {
  return validateCiEnvironment({
    env: options.env ?? process.env,
    repositoryFiles: repositoryFiles(rootDirectory),
    executionSources: executionSources(rootDirectory),
    packageLockSha256: sha256File(path.join(rootDirectory, 'package-lock.json')),
    p008MigrationSha256: sha256File(
      path.join(
        rootDirectory,
        'supabase',
        'migrations',
        '20260731103001_add_ltcm_runtime_rls_security.sql',
      ),
    ),
    requireGitHubActions: options.requireGitHubActions ?? false,
  });
}

function main() {
  const requireGitHubActions = process.argv.includes('--require-github-actions');
  const issues = checkCiEnvironment(process.cwd(), { requireGitHubActions });
  if (issues.length) {
    process.stderr.write(
      `Gate CI local falhou:\n${issues.map((issue) => `- ${issue}`).join('\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Gate CI local aprovado: PostgreSQL efêmero e zero configuração remota\n');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) main();
