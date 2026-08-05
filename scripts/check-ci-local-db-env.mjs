import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CI_POSTGRES_IMAGE =
  'postgres@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394';
export const CI_PACKAGE_LOCK_SHA256 =
  'CD69FDB04673AAE30C344735CD9A68D2983B1CD8BC84961AF113D1178E8CFD91';

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

export function validateCiEnvironment({
  env = process.env,
  repositoryFiles = [],
  executionSources = {},
  packageLockSha256 = CI_PACKAGE_LOCK_SHA256,
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
  if (String(env.PGUSER ?? '') !== 'ci_admin') issues.push('PGUSER deve ser ci_admin');
  if (!/^ltcm_ci_[a-z0-9_]+_only$/u.test(String(env.PGPASSWORD ?? ''))) {
    issues.push('PGPASSWORD deve ser a credencial sintética do job');
  }
  if (!/^ltcm_ci_[a-z0-9_]+_only$/u.test(String(env.LTCM_CI_POSTGRES_PASSWORD ?? ''))) {
    issues.push('senha da role postgres deve ser sintética');
  }
  if (String(packageLockSha256).toUpperCase() !== CI_PACKAGE_LOCK_SHA256) {
    issues.push('package-lock.json divergiu do hash aprovado');
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
