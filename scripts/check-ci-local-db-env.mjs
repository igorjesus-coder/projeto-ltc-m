import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CI_POSTGRES_IMAGE =
  'postgres:17.10-bookworm@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394';

const FORBIDDEN_ENVIRONMENT = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_PROJECT_REF',
  'SUPABASE_URL',
  'DATABASE_URL',
];

const CI_EXECUTION_FILES = [
  '.github/workflows/ltcm-postgres-validation.yml',
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

export function validateCiEnvironment({
  env = process.env,
  repositoryFiles = [],
  executionSources = {},
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
  if (String(env.LTCM_CI_POSTGRES_IMAGE ?? '') !== CI_POSTGRES_IMAGE) {
    issues.push('imagem PostgreSQL não corresponde à referência imutável aprovada');
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
    for (const pattern of FORBIDDEN_COMMANDS) {
      if (pattern.test(source)) {
        issues.push(`operação remota proibida em ${normalizedPath(filePath)}`);
        break;
      }
    }
  }

  return [...new Set(issues)];
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
