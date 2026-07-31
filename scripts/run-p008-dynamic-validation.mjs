import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  fingerprintExternalRows,
  fingerprintLtcmRows,
  fingerprintMigrationRows,
  runInventoryQuery,
} from './collect-db-inventory.mjs';

const EXPECTED_FINGERPRINTS = Object.freeze({
  external: '7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95',
  ltcm: 'F4A1681530F50790B97250F1BDF4C3577AE808376821B8A00E74A90A70019154',
  migrations: 'A4DD8FF011E5AD3AB56247437D61EBC5C87BE7930830F213F3B821BD430BBFC3',
});

const EXPECTED_MIGRATIONS = Object.freeze({
  '20260729163000_create_ltcm_relational_core.sql':
    'FEBE19BC524A467263415415300EA72FABDB42411F240E1F776D785ECA73CABF',
  '20260730103002_add_ltcm_core_query_indexes.sql':
    'DC7E651D290C443F5C34F4C7D61071B1BE38CDD88E67EAC0B8EBB10E09D59339',
  '20260730144303_add_ltcm_workflow_enum_values.sql':
    '6E8588D4538B1D32CAEBDC425C2CEC505011309C1B7D5AA0F46A4801FE021B7E',
  '20260730144304_add_ltcm_versioning_audit_workflow.sql':
    '7891D5FFBC35A9C8D55B0824E2C692F47C261ECFBC02BCF8BA6C58DAEE017361',
  '20260730155749_fix_ltcm_workflow_guard_fail_closed.sql':
    'C7CB68A7C93734F5D667089DBC6EBE10C866889AC762E8A26638B2D66EA07FE3',
  '20260730163419_fix_ltcm_admin_inactivation_columns.sql':
    '04DBB1184E86394B4301766749A9CD16F79C84B7ABBC0531CFBB6B038E70A90F',
  '20260731103000_add_ltcm_audit_read_event.sql':
    'B2722B5695786191A40A39745DC7B36DCDF28623DDA0A1E29FFC2A3C4B1661F8',
  '20260731103001_add_ltcm_runtime_rls_security.sql':
    '485DB38DE4194F2564C6A22D22B145ECA49710A2340B5EBD39C91990EA5CC14A',
  '20260731120000_fix_ltcm_runtime_function_acl.sql':
    'E2CF2E94DCC14713840472684D90369E76A889E30E0C45198B533D8A92F729A8',
});

const SQL_DIRECTORY = path.join('database', 'audit', 'p008-runtime');
const SQL_FILES = Object.freeze({
  preflight: path.join(SQL_DIRECTORY, 'membership-preflight.sql'),
  proof: path.join(SQL_DIRECTORY, 'membership-reversibility-proof.sql'),
  grant: path.join(SQL_DIRECTORY, 'membership-grant.sql'),
  cleanup: path.join(SQL_DIRECTORY, 'membership-cleanup.sql'),
  invalidContext: path.join(SQL_DIRECTORY, 'connection-invalid-context.sql'),
  viewer: path.join(SQL_DIRECTORY, 'connection-viewer.sql'),
  editor: path.join(SQL_DIRECTORY, 'connection-editor.sql'),
  editorWorkflow: path.join(SQL_DIRECTORY, 'connection-editor-workflow.sql'),
  admin: path.join(SQL_DIRECTORY, 'connection-admin-d23-d24.sql'),
  adminD24: path.join(SQL_DIRECTORY, 'connection-admin-d24.sql'),
  concurrency: path.join(SQL_DIRECTORY, 'connection-d23-concurrency.sql'),
  final: path.join(SQL_DIRECTORY, 'final-state.sql'),
  p007: path.join('database', 'audit', 'ltcm-p007-tests.sql'),
  p008: path.join('database', 'audit', 'ltcm-p008-rls-tests.sql'),
  postcheck: path.join('database', 'audit', 'ltcm-p008-postcheck.sql'),
});

const STATUS = Object.freeze({
  complete: 'Concluída',
  preflight: 'Bloqueada — preflight D26 divergente',
  reversibility: 'Bloqueada — reversibilidade da concessão temporária não comprovada',
  partial: 'Parcialmente concluída — harness executado, validação dinâmica incompleta',
  critical: 'Falha crítica — concessão temporária ou delta não autorizado permaneceu',
});

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseOptions(argv) {
  const options = { check: false, dryRun: false, runId: null };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') options.check = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--run-id') {
      options.runId = argv.at(index + 1) ?? null;
      index += 1;
    } else throw new Error(`argumento desconhecido: ${argument}`);
  }

  if (options.check && options.dryRun) throw new Error('--check e --dry-run são exclusivos');
  if (options.runId && !/^[a-z0-9][a-z0-9-]{5,39}$/.test(options.runId)) {
    throw new Error('--run-id deve conter de 6 a 40 caracteres minúsculos, numéricos ou hífen');
  }
  return options;
}

function readSource(rootDirectory, relativePath) {
  return fs.readFileSync(path.join(rootDirectory, relativePath), 'utf8');
}

export function validateHarnessSources(rootDirectory) {
  const issues = [];
  const sources = Object.fromEntries(
    Object.entries(SQL_FILES).map(([name, relativePath]) => [
      name,
      readSource(rootDirectory, relativePath),
    ]),
  );

  for (const [name, expectedHash] of Object.entries(EXPECTED_MIGRATIONS)) {
    const filePath = path.join(rootDirectory, 'supabase', 'migrations', name);
    if (!fs.existsSync(filePath) || sha256File(filePath) !== expectedHash) {
      issues.push(`hash da migration aplicada divergiu: ${name}`);
    }
  }

  if (
    !/grant\s+ltc_m_runtime\s+to\s+postgres[\s\S]*with\s+admin\s+false,\s*inherit\s+false,\s*set\s+true[\s\S]*granted\s+by\s+postgres/iu.test(
      sources.proof,
    )
  ) {
    issues.push('prova D27 não contém o GRANT temporário exato');
  }
  if (
    !/revoke\s+ltc_m_runtime\s+from\s+postgres\s+granted\s+by\s+postgres\s+restrict/iu.test(
      sources.proof,
    )
  ) {
    issues.push('prova D27 não contém o REVOKE seletivo exato');
  }
  if (!/rollback\s*;/iu.test(sources.proof) || /commit\s*;/iu.test(sources.proof)) {
    issues.push('prova D27 deve terminar somente em ROLLBACK');
  }
  if (!/granted\s+by\s+postgres/iu.test(sources.grant) || !/commit\s*;/iu.test(sources.grant)) {
    issues.push('grant persistente D27 não está na forma versionada esperada');
  }
  if (
    !/revoke\s+ltc_m_runtime\s+from\s+postgres\s+granted\s+by\s+postgres\s+restrict/iu.test(
      sources.cleanup,
    )
  ) {
    issues.push('cleanup não contém a revogação seletiva D27');
  }
  if (/granted\s+by\s+supabase_admin/iu.test(sources.cleanup)) {
    issues.push('cleanup tenta modificar a associação automática D26');
  }

  for (const name of [
    'invalidContext',
    'viewer',
    'editor',
    'editorWorkflow',
    'admin',
    'adminD24',
    'concurrency',
  ]) {
    if (!/begin\s*;/iu.test(sources[name]) || !/rollback\s*;/iu.test(sources[name])) {
      issues.push(`cenário ${name} não possui rollback integral`);
    }
    if (/\b(?:grant|revoke|commit|create|alter|drop|truncate)\b/iu.test(sources[name])) {
      issues.push(`cenário ${name} contém DDL ou privilégio proibido`);
    }
    if (!/set\s+local\s+role\s+ltc_m_runtime/iu.test(sources[name])) {
      issues.push(`cenário ${name} não assume ltc_m_runtime`);
    }
  }

  for (const name of [
    'invalidContext',
    'viewer',
    'editor',
    'editorWorkflow',
    'admin',
    'adminD24',
    'concurrency',
  ]) {
    if (!sources[name].includes('{{RUN_TOKEN}}') || !sources[name].includes('{{UUID_PREFIX}}')) {
      issues.push(`cenário ${name} não usa dados exclusivos por execução`);
    }
  }

  if (!sources.concurrency.includes("hashtextextended('ltc_m.active_admin_guard', 0)")) {
    issues.push('concorrência não usa a chave real da proteção D23');
  }
  if (
    !/pg_try_advisory_lock/iu.test(sources.final) ||
    !/pg_advisory_unlock/iu.test(sources.final)
  ) {
    issues.push('pós-check final não comprova a liberação das travas');
  }

  return [...new Set(issues)];
}

function uuidPrefixFor(runId) {
  const hex = createHash('sha256').update(runId, 'utf8').digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(12, 15)}-8${hex.slice(15, 18)}-${hex.slice(18, 27)}`;
}

export function renderScenario(source, runId) {
  const uuidPrefix = uuidPrefixFor(runId);
  return source.replaceAll('{{RUN_TOKEN}}', runId).replaceAll('{{UUID_PREFIX}}', uuidPrefix);
}

export function renderComprehensiveP008(source, runId) {
  const uuidPrefix = uuidPrefixFor(runId);
  return source
    .replaceAll('00000000-0000-4000-8000-000000008', uuidPrefix)
    .replaceAll('p008', `p008-${runId}`)
    .replaceAll('P008', `P008-${runId}`);
}

export function parseMigrationList(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('lista de migrations não retornou JSON');
  const payload = JSON.parse(stdout.slice(start));
  if (!Array.isArray(payload.migrations)) {
    throw new Error('lista de migrations não contém migrations');
  }
  return payload.migrations;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timeoutMs = options.timeoutMs ?? 120_000;
    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: error.message,
        durationMs: Date.now() - startedAt,
      });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        stdout,
        stderr: timedOut ? `${stderr}\nsubprocesso excedeu o timeout de ${timeoutMs} ms` : stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function sanitizedFailure(result) {
  const text = `${result.stderr}\n${result.stdout}`;
  const match = text.match(/(?:ERROR|error|Falha|failed)[^\r\n]{0,240}/u);
  return match?.[0] ?? `subprocesso terminou com código ${result.code ?? 'desconhecido'}`;
}

async function runCli(rootDirectory, args, options = {}) {
  const cli = path.join('node_modules', 'supabase', 'dist', 'supabase.js');
  return runProcess(process.execPath, [cli, ...args], {
    cwd: rootDirectory,
    timeoutMs: options.timeoutMs,
  });
}

async function runSql(rootDirectory, relativeFile, expectedFragments = [], options = {}) {
  const result = await runCli(
    rootDirectory,
    ['db', 'query', '--linked', '--file', relativeFile, '--output-format', 'json'],
    options,
  );
  if (!result.ok) throw new Error(sanitizedFailure(result));
  for (const fragment of expectedFragments) {
    if (!result.stdout.includes(fragment)) {
      throw new Error(`resposta do gate não contém ${fragment}`);
    }
  }
  return result.durationMs;
}

function inventoryFingerprints(rootDirectory) {
  const rows = runInventoryQuery(rootDirectory);
  return {
    external: fingerprintExternalRows(rows),
    ltcm: fingerprintLtcmRows(rows),
    migrations: fingerprintMigrationRows(rows),
  };
}

function assertExpectedBaseline(fingerprints) {
  for (const [name, expected] of Object.entries(EXPECTED_FINGERPRINTS)) {
    assertCondition(fingerprints[name] === expected, `fingerprint inicial ${name} divergiu`);
  }
}

function writeReport(rootDirectory, report) {
  const reportPath = path.join(
    rootDirectory,
    'docs',
    'database',
    'p008-runtime-validation-result.json',
  );
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function previousAttempts(rootDirectory) {
  const reportPath = path.join(
    rootDirectory,
    'docs',
    'database',
    'p008-runtime-validation-result.json',
  );
  if (!fs.existsSync(reportPath)) return [];
  try {
    const previous = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const history = Array.isArray(previous.previousAttempts) ? previous.previousAttempts : [];
    return [
      ...history,
      {
        runId: previous.runId,
        status: previous.status,
        startedAtUtc: previous.startedAtUtc,
        finishedAtUtc: previous.finishedAtUtc,
        failurePhase: previous.failurePhase,
        stages: previous.stages,
      },
    ];
  } catch {
    return [];
  }
}

function createRunId() {
  return `r${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomBytes(4).toString('hex')}`;
}

function prepareRenderedFiles(rootDirectory, tempDirectory, runId) {
  const rendered = {};
  for (const name of [
    'invalidContext',
    'viewer',
    'editor',
    'editorWorkflow',
    'admin',
    'adminD24',
    'concurrency',
  ]) {
    const source = readSource(rootDirectory, SQL_FILES[name]);
    const target = path.join(tempDirectory, `${name}.sql`);
    fs.writeFileSync(target, renderScenario(source, runId), 'utf8');
    rendered[name] = path.relative(rootDirectory, target);
  }

  const concurrencySource = readSource(rootDirectory, SQL_FILES.concurrency);
  rendered.concurrency = ['a', 'b'].map((suffix) => {
    const target = path.join(tempDirectory, `concurrency-${suffix}.sql`);
    fs.writeFileSync(target, renderScenario(concurrencySource, `${runId}-${suffix}`), 'utf8');
    return path.relative(rootDirectory, target);
  });

  const p008Target = path.join(tempDirectory, 'comprehensive-p008.sql');
  fs.writeFileSync(
    p008Target,
    renderComprehensiveP008(readSource(rootDirectory, SQL_FILES.p008), runId),
    'utf8',
  );
  rendered.p008 = path.relative(rootDirectory, p008Target);
  return rendered;
}

function recordStage(report, name, ok, durationMs, connection, detail = null) {
  report.stages.push({ name, ok, durationMs, connection, ...(detail ? { detail } : {}) });
}

async function executeStage(report, name, connection, action) {
  const startedAt = Date.now();
  try {
    const durationMs = await action();
    recordStage(report, name, true, durationMs ?? Date.now() - startedAt, connection);
  } catch (error) {
    recordStage(report, name, false, Date.now() - startedAt, connection, error.message);
    throw error;
  }
}

async function runLive(rootDirectory, runId) {
  const report = {
    formatVersion: 1,
    task: 'P008 / 1.08 — validação dinâmica ltc_m_runtime',
    runId,
    target: { project: 'Funcionarios', region: 'us-east-1' },
    decisions: ['D26', 'D27', 'D28'],
    startedAtUtc: new Date().toISOString(),
    status: STATUS.partial,
    stages: [],
    fingerprints: { expected: EXPECTED_FINGERPRINTS, before: null, after: null },
    migrationHashes: EXPECTED_MIGRATIONS,
    cleanup: { attempted: false, succeeded: null, localLockRemoved: false },
    previousAttempts: previousAttempts(rootDirectory),
  };

  const tempRoot = path.join(rootDirectory, '.tmp');
  const lockPath = path.join(tempRoot, 'p008-runtime.lock');
  let lockHandle = null;
  let tempDirectory = null;
  let preflightPassed = false;
  let proofPassed = false;
  let grantAttempted = false;
  let functionalComplete = false;
  let functionalFailures = 0;
  let cleanupSucceeded = null;
  let finalStateSucceeded = false;
  let failurePhase = null;
  let preflightDiverged = false;

  try {
    fs.mkdirSync(tempRoot, { recursive: true });
    lockHandle = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(
      lockHandle,
      `${JSON.stringify({ runId, startedAtUtc: report.startedAtUtc })}\n`,
    );
    tempDirectory = fs.mkdtempSync(path.join(tempRoot, 'p008-runtime-'));
    const rendered = prepareRenderedFiles(rootDirectory, tempDirectory, runId);

    report.fingerprints.before = inventoryFingerprints(rootDirectory);
    assertExpectedBaseline(report.fingerprints.before);
    recordStage(report, 'fingerprint_pre', true, 0, 'inventory-pre');

    try {
      await executeStage(report, 'd26_preflight', 'connection-01', () =>
        runSql(rootDirectory, SQL_FILES.preflight, ['"ok": true', '"set": false']),
      );
    } catch (error) {
      preflightDiverged = /D26|associação automática|membership/i.test(error.message);
      throw error;
    }
    preflightPassed = true;

    await executeStage(report, 'migration_alignment_pre', 'migration-list', async () => {
      const migrationList = await runCli(rootDirectory, ['migration', 'list', '--linked']);
      assertCondition(migrationList.ok, sanitizedFailure(migrationList));
      const migrations = parseMigrationList(migrationList.stdout);
      const expectedVersions = Object.keys(EXPECTED_MIGRATIONS).map((filename) =>
        filename.slice(0, 14),
      );
      assertCondition(
        migrations.length === expectedVersions.length,
        'quantidade de migrations divergiu',
      );
      for (const version of expectedVersions) {
        assertCondition(
          migrations.some(
            (migration) => migration.local === version && migration.remote === version,
          ),
          `migration ${version} não está alinhada`,
        );
      }
      report.migrations = migrations;
      return migrationList.durationMs;
    });

    await executeStage(report, 'd27_reversibility_proof', 'connection-02', () =>
      runSql(rootDirectory, SQL_FILES.proof, ['"rollback_clean": true']),
    );
    proofPassed = true;

    grantAttempted = true;
    await executeStage(report, 'd27_temporary_grant', 'connection-03', () =>
      runSql(rootDirectory, SQL_FILES.grant, ['"membership_count": 2', '"set": true']),
    );

    const continueStage = async (name, connection, action) => {
      try {
        await executeStage(report, name, connection, action);
      } catch {
        functionalFailures += 1;
        failurePhase ??= name;
      }
    };

    await continueStage('invalid_context', 'connection-04', () =>
      runSql(rootDirectory, rendered.invalidContext, ['"rollback_clean": true']),
    );
    await continueStage('viewer', 'connection-05', () =>
      runSql(rootDirectory, rendered.viewer, ['"rollback_clean": true']),
    );
    await continueStage('editor_workflow_p007', 'connection-06', () =>
      runSql(rootDirectory, rendered.editorWorkflow, ['"rollback_clean": true']),
    );
    await continueStage('editor_dml', 'connection-07', () =>
      runSql(rootDirectory, rendered.editor, ['"rollback_clean": true']),
    );
    await continueStage('admin_d24', 'connection-08', () =>
      runSql(rootDirectory, rendered.adminD24, ['"rollback_clean": true']),
    );
    await continueStage('admin_d23_sequential', 'connection-09', () =>
      runSql(rootDirectory, rendered.admin, ['"rollback_clean": true']),
    );
    await continueStage('p007_full_regression', 'connection-10', () =>
      runSql(rootDirectory, SQL_FILES.p007, ['"rollback_clean": true']),
    );
    await continueStage('p008_comprehensive_runtime', 'connection-11', () =>
      runSql(rootDirectory, rendered.p008, ['"rollback_clean": true']),
    );

    await continueStage('d23_concurrency', 'connections-12-and-13', async () => {
      const concurrencyStartedAt = Date.now();
      const firstConnection = runSql(
        rootDirectory,
        rendered.concurrency[0],
        ['"rollback_clean": true'],
        { timeoutMs: 120_000 },
      );
      // A CLI linked-query invocation provisions its administrative session before
      // executing SQL. Stagger the second launch so provisioning cannot race while
      // the first session already holds the D23 advisory lock.
      await new Promise((resolve) => setTimeout(resolve, 15_000));
      const secondConnection = runSql(
        rootDirectory,
        rendered.concurrency[1],
        ['"rollback_clean": true'],
        { timeoutMs: 120_000 },
      );
      const concurrencyResults = await Promise.all([firstConnection, secondConnection]);
      const concurrencyDuration = Date.now() - concurrencyStartedAt;
      const durationDelta = Math.abs(concurrencyResults[0] - concurrencyResults[1]);
      assertCondition(
        concurrencyDuration >= 30_000 && durationDelta >= 10_000,
        'D23 concorrente não demonstrou serialização pela advisory lock',
      );
      report.concurrency = {
        individualDurationMs: concurrencyResults,
        staggerMs: 15_000,
        durationDeltaMs: durationDelta,
      };
      return concurrencyDuration;
    });
    functionalComplete = functionalFailures === 0;
  } catch (error) {
    failurePhase = report.stages.at(-1)?.name ?? (preflightPassed ? 'harness' : 'preflight');
    if (report.stages.at(-1)?.ok !== false) {
      recordStage(report, failurePhase, false, 0, 'orchestrator', error.message);
    }
  } finally {
    if (grantAttempted) {
      report.cleanup.attempted = true;
      try {
        await executeStage(report, 'd27_cleanup_finally', 'connection-finally-01', () =>
          runSql(rootDirectory, SQL_FILES.cleanup, ['"d26_restored": true', '"set": false']),
        );
        cleanupSucceeded = true;
      } catch {
        cleanupSucceeded = false;
      }
      report.cleanup.succeeded = cleanupSucceeded;

      try {
        await executeStage(report, 'final_state', 'connection-finally-02', () =>
          runSql(rootDirectory, SQL_FILES.final, [
            '"d26_restored": true',
            '"set": false',
            '"operational_rows": 0',
          ]),
        );
        await executeStage(report, 'structural_postcheck', 'connection-finally-03', () =>
          runSql(rootDirectory, SQL_FILES.postcheck, [
            '"policy_count": 35',
            '"rls_force_tables": 13',
            '"runtime_function_count": 9',
            '"unsafe_policy_count": 0',
          ]),
        );
        finalStateSucceeded = true;
      } catch {
        finalStateSucceeded = false;
      }

      try {
        report.fingerprints.after = inventoryFingerprints(rootDirectory);
        for (const name of Object.keys(EXPECTED_FINGERPRINTS)) {
          assertCondition(
            report.fingerprints.after[name] === report.fingerprints.before[name],
            `fingerprint final ${name} divergiu`,
          );
        }
        recordStage(report, 'fingerprint_post', true, 0, 'inventory-post');
      } catch (error) {
        recordStage(report, 'fingerprint_post', false, 0, 'inventory-post', error.message);
        finalStateSucceeded = false;
      }
    }

    if (tempDirectory) fs.rmSync(tempDirectory, { recursive: true, force: true });
    if (lockHandle !== null) fs.closeSync(lockHandle);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    report.cleanup.localLockRemoved = !fs.existsSync(lockPath);

    if (!preflightPassed) report.status = preflightDiverged ? STATUS.preflight : STATUS.partial;
    else if (!proofPassed && !grantAttempted) report.status = STATUS.reversibility;
    else if (cleanupSucceeded === false || !finalStateSucceeded) report.status = STATUS.critical;
    else if (functionalComplete) report.status = STATUS.complete;
    else report.status = STATUS.partial;

    report.failurePhase = failurePhase;
    report.finishedAtUtc = new Date().toISOString();
    writeReport(rootDirectory, report);
  }

  return report;
}

async function main() {
  const rootDirectory = process.cwd();
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
    const issues = validateHarnessSources(rootDirectory);
    if (issues.length > 0) throw new Error(issues.join('; '));
  } catch (error) {
    console.error(`Falha de uso/validação do harness P008: ${error.message}`);
    process.exitCode = 2;
    return;
  }

  if (options.check) {
    console.log('Harness P008/D27 válido: escopo, hashes, reversibilidade e cleanup verificados');
    return;
  }

  const runId = options.runId ?? createRunId();
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry-run',
          runId,
          remoteWrites: false,
          stages: [
            'fingerprint_pre',
            'd26_preflight',
            'migration_alignment_pre',
            'd27_reversibility_proof_rolled_back',
            'd27_temporary_grant',
            'isolated_runtime_scenarios',
            'p007_full_regression',
            'p008_comprehensive_runtime',
            'd23_concurrency',
            'd27_cleanup_finally',
            'final_state_and_fingerprints',
          ],
        },
        null,
        2,
      ),
    );
    return;
  }

  const report = await runLive(rootDirectory, runId);
  console.log(
    JSON.stringify({ runId: report.runId, status: report.status, stages: report.stages }, null, 2),
  );
  if (report.status !== STATUS.complete) process.exitCode = 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await main();
}
