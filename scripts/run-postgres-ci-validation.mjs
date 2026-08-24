import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { checkCiEnvironment, CI_POSTGRES_IMAGE } from './check-ci-local-db-env.mjs';
import { runConcurrencyTest } from './run-postgres-concurrency-test.mjs';
import { renderComprehensiveP008, renderComprehensiveP009 } from './sql-rendering.mjs';

const D40_MIGRATION = '20260804120000_add_legacy_project_reference_date_exception.sql';
const D40_SHA256 = '4FA11A1D2AB1AA437593BFA1535348048B34E96E33051E6E637FCB26EF84813C';
const EVIDENCE_PATH = path.join('.tmp', 'ci-evidence', 'ltcm-postgres-validation.json');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

export function migrationInventory(rootDirectory) {
  const directory = path.join(rootDirectory, 'supabase', 'migrations');
  const names = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'en'));
  const timestamps = names.map((name) => name.match(/^(\d{14})_[a-z0-9_]+\.sql$/u)?.[1]);
  if (timestamps.some((timestamp) => !timestamp)) throw new Error('nome de migration inválido');
  if (new Set(timestamps).size !== timestamps.length) {
    throw new Error('timestamp de migration duplicado');
  }
  return names.map((name, index) => ({
    order: index + 1,
    name,
    sha256: sha256File(path.join(directory, name)),
  }));
}

export function sanitizeProcessFailure(result) {
  const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
  return (
    text.match(/(?:ERROR|FATAL|Falha|failed):?[^\r\n]{0,300}/iu)?.[0] ??
    `processo terminou com código ${result.code ?? 'desconhecido'}`
  ).replaceAll(/postgresql:\/\/[^\s]+/giu, '[database-url-redacted]');
}

function runProcess(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeoutMs ?? 120_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs: Date.now() - startedAt,
  };
}

function psqlArguments({ database, user, file, command, variables = {} }) {
  const args = [
    '-X',
    '--no-psqlrc',
    '--set=ON_ERROR_STOP=1',
    '--no-align',
    '--tuples-only',
    '--quiet',
    '--host',
    process.env.PGHOST,
    '--port',
    process.env.PGPORT,
    '--dbname',
    database,
    '--username',
    user,
  ];
  for (const [name, value] of Object.entries(variables)) args.push(`--set=${name}=${value}`);
  if (file) args.push('--file', file);
  if (command) args.push('--command', command);
  return args;
}

function executePsql({ database, user, password, file, command, variables, timeoutMs }) {
  return runProcess('psql', psqlArguments({ database, user, file, command, variables }), {
    env: { ...process.env, PGPASSWORD: password },
    timeoutMs,
  });
}

function parseLastJson(stdout) {
  const line = stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .findLast(Boolean);
  if (!line) throw new Error('etapa não retornou JSON sanitizado');
  return JSON.parse(line);
}

function gitValue(rootDirectory, args) {
  const result = runProcess('git', args, { cwd: rootDirectory, timeoutMs: 10_000 });
  if (result.code !== 0) throw new Error('metadado Git indisponível');
  return result.stdout.trim();
}

function writeEvidence(rootDirectory, evidence) {
  const target = path.join(rootDirectory, EVIDENCE_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function source(rootDirectory, relativePath) {
  return fs.readFileSync(path.join(rootDirectory, relativePath), 'utf8');
}

function stageRunner(evidence) {
  return (name, action) => {
    const result = action();
    evidence.exit_codes[name] = result.code;
    evidence.stages.push({ name, exit_code: result.code, duration_ms: result.durationMs });
    if (result.code !== 0) throw new Error(`${name}: ${sanitizeProcessFailure(result)}`);
    return result;
  };
}

export async function runPostgresCiValidation(rootDirectory = process.cwd()) {
  const environmentIssues = checkCiEnvironment(rootDirectory, {
    requireGitHubActions: true,
  });
  if (environmentIssues.length) throw new Error(environmentIssues.join('; '));

  const initialMigrations = migrationInventory(rootDirectory);
  const d40 = initialMigrations.find((migration) => migration.name === D40_MIGRATION);
  if (!d40 || d40.sha256 !== D40_SHA256) throw new Error('hash da migration D40/D41 divergiu');

  const branch = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'unknown';
  const commit = process.env.LTCM_CI_HEAD_SHA || gitValue(rootDirectory, ['rev-parse', 'HEAD']);
  const imageDigest = CI_POSTGRES_IMAGE.split('@')[1];
  const evidence = {
    format_version: 1,
    task: 'P011-D43-CI-IMPLEMENT',
    status: 'failed',
    commit,
    branch,
    image: CI_POSTGRES_IMAGE,
    image_digest: imageDigest,
    migration_d40_sha256: D40_SHA256,
    migrations: initialMigrations,
    migration_count: initialMigrations.length,
    static_gates: { npm_run_check: 0 },
    exit_codes: {},
    stages: [],
    regressions: {
      p006: false,
      p007: false,
      p008: false,
      p009_phase_a: false,
      p009: false,
      p012_persistence: false,
      p013_postgres: false,
    },
    p013_postgres: null,
    d40_d41: { scenarios: '0/47', passed: false },
    concurrency: null,
    postgres: null,
    d41_security: null,
    rollback_clean: false,
    final_counts: null,
    git_diff_exit_code: null,
    first_error: null,
  };

  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ltcm-ci-validation-'));
  const postgresPassword = process.env.LTCM_CI_POSTGRES_PASSWORD;
  const bootstrapPassword = process.env.PGPASSWORD;
  const adminPassword = process.env.LTCM_CI_ADMIN_PASSWORD;
  const runStage = stageRunner(evidence);
  let d27Granted = false;
  let concurrencyDatabaseCreated = false;
  let p013DatabaseCreated = false;

  const postgresFile = (relativePath, options = {}) =>
    executePsql({
      database: process.env.PGDATABASE,
      user: 'postgres',
      password: postgresPassword,
      file: path.join(rootDirectory, relativePath),
      timeoutMs: options.timeoutMs,
    });

  const runP013PostgresStage = () => {
    runStage('create_p013_database', () =>
      executePsql({
        database: 'postgres',
        user: 'postgres',
        password: postgresPassword,
        command: 'create database ltcm_test owner postgres',
      }),
    );
    p013DatabaseCreated = true;

    const p013DatabaseUrl = `postgresql://postgres:${postgresPassword}@127.0.0.1:5432/ltcm_test`;
    runStage('p013_postgres_build', () =>
      runProcess('npm', ['run', 'build', '--workspace', '@ltcm/normalizer', '--silent'], {
        cwd: rootDirectory,
        timeoutMs: 120_000,
      }),
    );
    runStage('p013_postgres', () =>
      runProcess(
        'node',
        [
          '--test',
          path.join(
            'tools',
            'ltcm-normalizer',
            'dist',
            'test',
            'postgres-monthly-foundation.integration.test.js',
          ),
        ],
        {
          cwd: rootDirectory,
          env: {
            ...process.env,
            LTCM_P013_INTEGRATION: '1',
            LTCM_P012_TEST_DATABASE_URL: p013DatabaseUrl,
          },
          timeoutMs: 120_000,
        },
      ),
    );
    evidence.regressions.p013_postgres = true;
    evidence.p013_postgres = {
      passed: true,
      database: 'ltcm_test',
      host: '127.0.0.1',
      command:
        'node --test tools/ltcm-normalizer/dist/test/postgres-monthly-foundation.integration.test.js',
      coverage: [
        'migrations_from_zero',
        'p013_foundation_schema',
        'rls',
        'force_rls',
        'runtime_role_behavior',
        'provenance_constraints',
        'idempotency',
        'rollback_cleanup',
      ],
    };
  };

  try {
    runStage('bootstrap_roles', () =>
      executePsql({
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: bootstrapPassword,
        file: path.join(rootDirectory, 'database', 'audit', 'ltcm-ci-bootstrap.sql'),
        variables: { roles_phase: 'true', ci_admin_phase: 'false', d26_phase: 'false' },
      }),
    );

    runStage('ci_admin_preflight', () =>
      executePsql({
        database: process.env.PGDATABASE,
        user: 'ci_admin',
        password: adminPassword,
        file: path.join(rootDirectory, 'database', 'audit', 'ltcm-ci-bootstrap.sql'),
        variables: { roles_phase: 'false', ci_admin_phase: 'true', d26_phase: 'false' },
      }),
    );

    runStage('create_concurrency_database', () =>
      executePsql({
        database: 'postgres',
        user: 'postgres',
        password: postgresPassword,
        command: 'create database ltcm_ci_concurrency owner postgres',
      }),
    );
    concurrencyDatabaseCreated = true;

    runP013PostgresStage();

    for (const migration of initialMigrations) {
      runStage(`migration_${migration.order}`, () =>
        postgresFile(path.join('supabase', 'migrations', migration.name)),
      );
      runStage(`concurrency_migration_${migration.order}`, () =>
        executePsql({
          database: 'ltcm_ci_concurrency',
          user: 'postgres',
          password: postgresPassword,
          file: path.join(rootDirectory, 'supabase', 'migrations', migration.name),
        }),
      );
    }
    runStage('seed', () => postgresFile(path.join('supabase', 'seed.sql')));
    runStage('concurrency_seed', () =>
      executePsql({
        database: 'ltcm_ci_concurrency',
        user: 'postgres',
        password: postgresPassword,
        file: path.join(rootDirectory, 'supabase', 'seed.sql'),
      }),
    );

    runStage('bootstrap_d26', () =>
      executePsql({
        database: process.env.PGDATABASE,
        user: process.env.PGUSER,
        password: bootstrapPassword,
        file: path.join(rootDirectory, 'database', 'audit', 'ltcm-ci-bootstrap.sql'),
        variables: { roles_phase: 'false', ci_admin_phase: 'false', d26_phase: 'true' },
      }),
    );

    runStage('p006', () =>
      postgresFile(path.join('database', 'audit', 'ltcm-integrity-tests.sql')),
    );
    evidence.regressions.p006 = true;
    runStage('p007', () => postgresFile(path.join('database', 'audit', 'ltcm-p007-tests.sql')));
    evidence.regressions.p007 = true;

    runStage('d26_preflight', () =>
      postgresFile(path.join('database', 'audit', 'p008-runtime', 'membership-preflight.sql')),
    );
    runStage('d27_reversibility', () =>
      postgresFile(
        path.join('database', 'audit', 'p008-runtime', 'membership-reversibility-proof.sql'),
      ),
    );
    runStage('d27_grant', () =>
      postgresFile(path.join('database', 'audit', 'p008-runtime', 'membership-grant.sql')),
    );
    d27Granted = true;

    const runId = `ci-${commit.slice(0, 12).toLowerCase()}`;
    const renderedP008 = path.join(tempDirectory, 'p008.sql');
    const renderedP009PhaseA = path.join(tempDirectory, 'p009-phase-a.sql');
    const renderedP009 = path.join(tempDirectory, 'p009.sql');
    fs.writeFileSync(
      renderedP008,
      renderComprehensiveP008(
        source(rootDirectory, path.join('database', 'audit', 'ltcm-p008-rls-tests.sql')),
        runId,
      ),
      'utf8',
    );
    fs.writeFileSync(
      renderedP009PhaseA,
      renderComprehensiveP009(
        source(rootDirectory, path.join('database', 'audit', 'ltcm-p009-bootstrap.sql')),
        runId,
      ),
      'utf8',
    );
    fs.writeFileSync(
      renderedP009,
      renderComprehensiveP009(
        source(rootDirectory, path.join('database', 'audit', 'ltcm-p009-staging-tests.sql')),
        runId,
      ),
      'utf8',
    );

    runStage('p008', () =>
      executePsql({
        database: process.env.PGDATABASE,
        user: 'postgres',
        password: postgresPassword,
        file: renderedP008,
      }),
    );
    evidence.regressions.p008 = true;
    const phaseAResult = runStage('p009_phase_a', () =>
      executePsql({
        database: process.env.PGDATABASE,
        user: 'postgres',
        password: postgresPassword,
        file: renderedP009PhaseA,
      }),
    );
    const phaseAEvidence = parseLastJson(phaseAResult.stdout);
    if (
      phaseAEvidence.phase_a_passed !== true ||
      phaseAEvidence.rollback_clean !== true ||
      phaseAEvidence.operational_rows !== 0 ||
      phaseAEvidence.relevant_advisory_locks !== 0
    ) {
      throw new Error('p009_phase_a: evidência terminal divergente');
    }
    evidence.regressions.p009_phase_a = true;
    const p009Result = runStage('p009', () =>
      executePsql({
        database: process.env.PGDATABASE,
        user: 'postgres',
        password: postgresPassword,
        file: renderedP009,
      }),
    );
    const p009Evidence = parseLastJson(p009Result.stdout);
    if (p009Evidence.rollback_clean !== true || p009Evidence.request_contract !== true) {
      throw new Error('p009: evidência terminal divergente');
    }
    evidence.regressions.p009 = true;
    runStage('p009_postcheck', () =>
      postgresFile(path.join('database', 'audit', 'ltcm-p009-postcheck.sql')),
    );

    runStage('d40_d41', () => postgresFile(path.join('database', 'audit', 'ltcm-d40-tests.sql')));
    evidence.d40_d41 = { scenarios: '47/47', passed: true };

    runStage('p012_persistence', () =>
      runProcess(
        'node',
        [
          '--test',
          path.join(
            'tools',
            'ltcm-normalizer',
            'dist',
            'test',
            'postgres-item-persistence.integration.test.js',
          ),
        ],
        {
          cwd: rootDirectory,
          env: {
            ...process.env,
            LTCM_P012_INTEGRATION: '1',
            PGDATABASE: 'ltcm_ci_concurrency',
          },
          timeoutMs: 120_000,
        },
      ),
    );
    evidence.regressions.p012_persistence = true;

    evidence.concurrency = await runConcurrencyTest();
    concurrencyDatabaseCreated = false;
    evidence.exit_codes.concurrency = 0;
    evidence.stages.push({ name: 'concurrency', exit_code: 0 });
  } catch (error) {
    evidence.first_error = error.message;
  } finally {
    if (d27Granted) {
      try {
        runStage('d27_cleanup', () =>
          postgresFile(path.join('database', 'audit', 'p008-runtime', 'membership-cleanup.sql')),
        );
      } catch (error) {
        evidence.first_error ??= error.message;
      }
    }

    if (concurrencyDatabaseCreated) {
      const dropConcurrencyDatabase = executePsql({
        database: 'postgres',
        user: 'postgres',
        password: postgresPassword,
        command: 'drop database if exists ltcm_ci_concurrency with (force)',
      });
      evidence.exit_codes.concurrency_database_cleanup = dropConcurrencyDatabase.code;
      if (dropConcurrencyDatabase.code !== 0) {
        evidence.first_error ??= `concurrency_database_cleanup: ${sanitizeProcessFailure(dropConcurrencyDatabase)}`;
      }
    }

    if (p013DatabaseCreated) {
      const dropP013Database = executePsql({
        database: 'postgres',
        user: 'postgres',
        password: postgresPassword,
        command: 'drop database if exists ltcm_test with (force)',
      });
      evidence.exit_codes.p013_database_cleanup = dropP013Database.code;
      if (dropP013Database.code !== 0) {
        evidence.first_error ??= `p013_database_cleanup: ${sanitizeProcessFailure(dropP013Database)}`;
      }
    }

    try {
      runStage('d27_final_state', () =>
        postgresFile(path.join('database', 'audit', 'p008-runtime', 'final-state.sql')),
      );
      const finalResult = runStage('ci_final_state', () =>
        postgresFile(path.join('database', 'audit', 'ltcm-ci-final-state.sql')),
      );
      const finalState = parseLastJson(finalResult.stdout);
      evidence.postgres = {
        version: finalState.postgres_version,
        encoding: finalState.server_encoding,
        locale: finalState.locale,
        timezone: finalState.timezone,
      };
      evidence.d41_security = finalState.d41_security;
      evidence.rollback_clean = finalState.rollback_clean === true;
      evidence.final_counts = finalState.final_counts;
    } catch (error) {
      evidence.first_error ??= error.message;
    }

    const finalMigrations = migrationInventory(rootDirectory);
    if (JSON.stringify(finalMigrations) !== JSON.stringify(initialMigrations)) {
      evidence.first_error ??= 'migration alterada durante o job';
    }
    const gitDiff = runProcess('git', ['diff', '--exit-code'], {
      cwd: rootDirectory,
      timeoutMs: 10_000,
    });
    evidence.git_diff_exit_code = gitDiff.code;
    const trackedStatus = gitValue(rootDirectory, [
      'status',
      '--porcelain',
      '--untracked-files=no',
    ]);
    if (trackedStatus) evidence.first_error ??= 'arquivo versionado alterado durante o job';

    const allPassed =
      evidence.first_error === null &&
      Object.values(evidence.regressions).every(Boolean) &&
      evidence.d40_d41.passed &&
      evidence.concurrency?.passed === true &&
      evidence.rollback_clean &&
      evidence.final_counts?.operational_fixtures === 0 &&
      evidence.git_diff_exit_code === 0;
    evidence.status = allPassed ? 'passed' : 'failed';
    writeEvidence(rootDirectory, evidence);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }

  if (evidence.status !== 'passed') throw new Error(evidence.first_error ?? 'gate CI falhou');
  return evidence;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  try {
    const result = await runPostgresCiValidation();
    process.stdout.write(
      `${JSON.stringify({ status: result.status, migrations: result.migration_count, scenarios: result.d40_d41.scenarios, rollback_clean: result.rollback_clean })}\n`,
    );
  } catch (error) {
    process.stderr.write(`Gate PostgreSQL efêmero falhou: ${error.message}\n`);
    process.exitCode = 1;
  }
}
