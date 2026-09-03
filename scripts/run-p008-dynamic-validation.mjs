import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  fingerprintExternalRows,
  fingerprintLtcmRows,
  fingerprintMigrationRows,
  normalizeInventoryRows,
  runInventoryQuery,
} from './collect-db-inventory.mjs';
import {
  createP009TerminalEnvelope,
  runCapturedProcess,
  sha256File as sha256EvidenceFile,
} from './p009-evidence-protocol.mjs';
import {
  assertValidP009Aliases,
  renderComprehensiveP008,
  renderComprehensiveP009,
  renderScenario,
  validateP009ScenarioSource,
} from './sql-rendering.mjs';
import { buildGateManifest, validateSqlBundle } from './p009-rendered-sql-gate.mjs';

export {
  assertValidP009Aliases,
  renderComprehensiveP008,
  renderComprehensiveP009,
  renderScenario,
  validateP009ScenarioSource,
} from './sql-rendering.mjs';

const EXPECTED_FINGERPRINTS = Object.freeze({
  external: '7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95',
  ltcm: '0A39EEDACAC670E25EC46589F8774A13088C136453672C41A38A2EA948A891CB',
  migrations: '8D0A1AB4BE73312A653EA1F6E677044E6FB609A37BC752CA588F5AA4025789EA',
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
  '20260731130000_add_ltcm_import_staging.sql':
    'C0CDBC2F020A9D727D0E353A31EA7E91DF715E5B96BEB343E79407DECD940A22',
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
  p009Bootstrap: path.join('database', 'audit', 'ltcm-p009-bootstrap.sql'),
  p009: path.join('database', 'audit', 'ltcm-p009-staging-tests.sql'),
  postcheck: path.join('database', 'audit', 'ltcm-p009-postcheck.sql'),
});

const STATUS = Object.freeze({
  complete: 'Concluída',
  preflight: 'Bloqueada — preflight D33 divergente',
  phaseA: 'Parcialmente concluída — validação final P009 falhou, estado remoto limpo',
  phaseB: 'Parcialmente concluída — validação final P009 falhou, estado remoto limpo',
  critical: 'Falha crítica — resíduo ou delta após D33',
});

let activeArtifactCapture = null;

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex').toUpperCase();
}

function assertCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function parseOptions(argv) {
  const options = {
    check: false,
    dryRun: false,
    worker: false,
    runId: null,
    artifactDirectory: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') options.check = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--worker') options.worker = true;
    else if (argument === '--run-id') {
      options.runId = argv.at(index + 1) ?? null;
      index += 1;
    } else if (argument === '--artifact-directory') {
      options.artifactDirectory = argv.at(index + 1) ?? null;
      index += 1;
    } else throw new Error(`argumento desconhecido: ${argument}`);
  }

  if (options.check && options.dryRun) throw new Error('--check e --dry-run são exclusivos');
  if (options.runId && !/^[a-z0-9][a-z0-9-]{5,39}$/.test(options.runId)) {
    throw new Error('--run-id deve conter de 6 a 40 caracteres minúsculos, numéricos ou hífen');
  }
  if (options.worker !== Boolean(options.artifactDirectory)) {
    throw new Error('--worker exige --artifact-directory e vice-versa');
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

  if (
    !/begin\s*;/iu.test(sources.p009) ||
    !/rollback\s*;/iu.test(sources.p009) ||
    !/set\s+local\s+role\s+ltc_m_runtime/iu.test(sources.p009)
  ) {
    issues.push('suite P009 deve ser transacional e assumir ltc_m_runtime');
  }
  if (
    !/begin\s*;/iu.test(sources.p009Bootstrap) ||
    !/rollback\s*;/iu.test(sources.p009Bootstrap) ||
    !/phase_a_passed/iu.test(sources.p009Bootstrap) ||
    !/set\s+local\s+role\s+ltc_m_runtime/iu.test(sources.p009Bootstrap)
  ) {
    issues.push('Fase A P009 deve ser transacional, revertida e assumir ltc_m_runtime');
  }

  try {
    validateP009ScenarioSource(sources.p009);
  } catch (error) {
    issues.push(`fluxo D32 inválido: ${error.message}`);
  }

  return [...new Set(issues)];
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
  return runCapturedProcess(command, args, {
    ...options,
    stdoutPath: options.stdoutPath ?? activeArtifactCapture?.stdoutPath,
    stderrPath: options.stderrPath ?? activeArtifactCapture?.stderrPath,
    append: options.append ?? Boolean(activeArtifactCapture),
  }).then((result) => ({
    ...result,
    stderr: result.timedOut
      ? `${result.stderr}\nsubprocesso excedeu o timeout de ${options.timeoutMs ?? 120_000} ms`
      : result.stderr,
  }));
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
  return options.capture
    ? { durationMs: result.durationMs, stdout: result.stdout }
    : result.durationMs;
}

function parseQueryRows(stdout) {
  const start = stdout.indexOf('{');
  assertCondition(start >= 0, 'consulta D32 não retornou JSON');
  const payload = JSON.parse(stdout.slice(start));
  assertCondition(Array.isArray(payload.rows), 'consulta D32 não retornou rows');
  return payload.rows;
}

function inventoryFingerprints(rootDirectory, evidencePath = null) {
  const rows = runInventoryQuery(rootDirectory);
  if (evidencePath) {
    fs.writeFileSync(evidencePath, JSON.stringify(normalizeInventoryRows(rows)), 'utf8');
  }
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
  const p009ReportPath = path.join(
    rootDirectory,
    'docs',
    'database',
    'p009-runtime-validation-result.json',
  );
  fs.writeFileSync(p009ReportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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

  const p009Target = path.join(tempDirectory, 'comprehensive-p009.sql');
  fs.writeFileSync(
    p009Target,
    renderComprehensiveP009(readSource(rootDirectory, SQL_FILES.p009), runId),
    'utf8',
  );
  rendered.p009 = path.relative(rootDirectory, p009Target);

  const p009BootstrapTarget = path.join(tempDirectory, 'p009-bootstrap.sql');
  fs.writeFileSync(
    p009BootstrapTarget,
    renderComprehensiveP009(readSource(rootDirectory, SQL_FILES.p009Bootstrap), runId),
    'utf8',
  );
  rendered.p009Bootstrap = path.relative(rootDirectory, p009BootstrapTarget);
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

async function runLive(rootDirectory, runId, gateManifest, actualGate, artifactDirectory) {
  const report = {
    formatVersion: 1,
    task: 'P009 / D33 — validação remota final de evidência',
    runId,
    target: { project: 'Funcionarios', region: 'us-east-1' },
    command: 'npm run p009:runtime:validate',
    decisions: ['D26', 'D27', 'D28', 'D29', 'D30', 'D31', 'D32', 'D33'],
    startedAtUtc: new Date().toISOString(),
    status: STATUS.phaseA,
    gate: {
      manifestSha256: gateManifest.manifestSha256,
      sourceHash: gateManifest.sourceHash,
      runIds: gateManifest.runIds,
      actualRunId: runId,
      actualRenderedSha256: actualGate.renderedHash,
      actualCanonicalSha256: actualGate.canonicalHash,
      actualMetrics: actualGate.metrics,
    },
    phases: {
      phaseA: { startedAtUtc: null, finishedAtUtc: null, passed: false },
      phaseB: { startedAtUtc: null, finishedAtUtc: null, started: false, passed: false },
    },
    stages: [],
    fingerprints: { expected: EXPECTED_FINGERPRINTS, before: null, after: null },
    migrationHashes: EXPECTED_MIGRATIONS,
    cleanup: {
      attempted: false,
      startedAtUtc: null,
      finishedAtUtc: null,
      succeeded: null,
      localLockRemoved: false,
    },
    previousAttempts: previousAttempts(rootDirectory),
    requestIdMatrix: null,
    p009Evidence: null,
    finalStateEvidence: null,
    postcheckEvidence: null,
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
  let phaseAPassed = false;
  let phaseBStarted = false;

  fs.mkdirSync(artifactDirectory, { recursive: true });
  const subprocessStdoutPath = path.join(artifactDirectory, 'subprocess.stdout');
  const subprocessStderrPath = path.join(artifactDirectory, 'subprocess.stderr');
  const preInventoryPath = path.join(artifactDirectory, 'inventory.pre.json');
  const postInventoryPath = path.join(artifactDirectory, 'inventory.post.json');
  fs.writeFileSync(subprocessStdoutPath, Buffer.alloc(0));
  fs.writeFileSync(subprocessStderrPath, Buffer.alloc(0));
  activeArtifactCapture = {
    stdoutPath: subprocessStdoutPath,
    stderrPath: subprocessStderrPath,
  };

  try {
    fs.mkdirSync(tempRoot, { recursive: true });
    lockHandle = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(
      lockHandle,
      `${JSON.stringify({ runId, startedAtUtc: report.startedAtUtc })}\n`,
    );
    tempDirectory = fs.mkdtempSync(path.join(tempRoot, 'p008-runtime-'));
    const rendered = prepareRenderedFiles(rootDirectory, tempDirectory, runId);

    report.fingerprints.before = inventoryFingerprints(rootDirectory, preInventoryPath);
    assertExpectedBaseline(report.fingerprints.before);
    recordStage(report, 'fingerprint_pre', true, 0, 'inventory-pre');

    await executeStage(report, 'd26_preflight', 'connection-01', () =>
      runSql(rootDirectory, SQL_FILES.preflight, ['"ok": true', '"set": false']),
    );
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

    report.phases.phaseA.startedAtUtc = new Date().toISOString();
    try {
      await executeStage(report, 'p009_phase_a_bootstrap', 'connection-phase-a', () =>
        runSql(rootDirectory, rendered.p009Bootstrap, [
          '"phase_a_passed": true',
          '"rollback_clean": true',
          '"operational_rows": 0',
          '"relevant_advisory_locks": 0',
        ]),
      );
      phaseAPassed = true;
      report.phases.phaseA.passed = true;
    } finally {
      report.phases.phaseA.finishedAtUtc = new Date().toISOString();
    }

    assertCondition(phaseAPassed, 'Fase A não produziu phase_a_passed=true');
    report.phaseAPassed = phaseAPassed;
    report.phases.phaseB.started = true;
    report.phases.phaseB.startedAtUtc = new Date().toISOString();
    phaseBStarted = true;

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
    await continueStage('p009_full_validation', 'connection-10', async () => {
      const result = await runSql(rootDirectory, rendered.p009, ['"rollback_clean": true'], {
        capture: true,
      });
      const evidenceRow = parseQueryRows(result.stdout).find((row) => row.p009_terminal_evidence);
      assertCondition(evidenceRow, 'evidencia terminal P009 D33 ausente da resposta');
      assertCondition(
        evidenceRow.p009_terminal_evidence.rollback_clean === true,
        'rollback P009 D33 divergente',
      );
      assertCondition(
        evidenceRow.p009_terminal_evidence.request_contract === true,
        'contrato de request P009 D33 divergente',
      );
      report.p009Evidence = evidenceRow.p009_terminal_evidence;
      report.requestIdMatrix = evidenceRow.p009_terminal_evidence.audit_requests;
      return result.durationMs;
    });
    await continueStage('p007_full_regression', 'connection-11', () =>
      runSql(rootDirectory, SQL_FILES.p007, ['"rollback_clean": true']),
    );
    await continueStage('p008_comprehensive_runtime', 'connection-12', () =>
      runSql(rootDirectory, rendered.p008, ['"rollback_clean": true']),
    );

    await continueStage('d23_concurrency', 'connections-13-and-14', async () => {
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
    report.phases.phaseB.passed = functionalComplete;
    report.phases.phaseB.finishedAtUtc = new Date().toISOString();
  } catch (error) {
    failurePhase = report.stages.at(-1)?.name ?? (preflightPassed ? 'harness' : 'preflight');
    if (report.stages.at(-1)?.ok !== false) {
      recordStage(report, failurePhase, false, 0, 'orchestrator', error.message);
    }
    if (phaseBStarted && report.phases.phaseB.finishedAtUtc === null) {
      report.phases.phaseB.finishedAtUtc = new Date().toISOString();
    }
  } finally {
    if (grantAttempted) {
      report.cleanup.attempted = true;
      report.cleanup.startedAtUtc = new Date().toISOString();
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
        await executeStage(report, 'final_state', 'connection-finally-02', async () => {
          const result = await runSql(
            rootDirectory,
            SQL_FILES.final,
            ['"d26_restored": true', '"set": false', '"operational_rows": 0'],
            { capture: true },
          );
          report.finalStateEvidence = parseQueryRows(result.stdout).find(
            (row) => row.p008_runtime_result,
          )?.p008_runtime_result;
          assertCondition(report.finalStateEvidence, 'evidencia de estado final ausente');
          return result.durationMs;
        });
        await executeStage(report, 'structural_postcheck', 'connection-finally-03', async () => {
          const result = await runSql(
            rootDirectory,
            SQL_FILES.postcheck,
            [
              '"policy_count": 49',
              '"rls_force_table_count": 19',
              '"runtime_function_count": 9',
              '"unsafe_policy_count": 0',
            ],
            { capture: true },
          );
          report.postcheckEvidence = parseQueryRows(result.stdout).find(
            (row) => row.p009_postcheck,
          )?.p009_postcheck;
          assertCondition(report.postcheckEvidence, 'evidencia estrutural P009 ausente');
          return result.durationMs;
        });
        finalStateSucceeded = true;
      } catch {
        finalStateSucceeded = false;
      }

      try {
        report.fingerprints.after = inventoryFingerprints(rootDirectory, postInventoryPath);
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
      report.cleanup.finishedAtUtc = new Date().toISOString();
    }

    if (tempDirectory) fs.rmSync(tempDirectory, { recursive: true, force: true });
    if (lockHandle !== null) fs.closeSync(lockHandle);
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    report.cleanup.localLockRemoved = !fs.existsSync(lockPath);

    if (!preflightPassed) report.status = STATUS.preflight;
    else if (!proofPassed && !grantAttempted) report.status = STATUS.preflight;
    else if (cleanupSucceeded === false || !finalStateSucceeded) report.status = STATUS.critical;
    else if (!phaseAPassed) report.status = STATUS.phaseA;
    else if (functionalComplete) report.status = STATUS.complete;
    else report.status = STATUS.phaseB;

    report.rollbackClean =
      cleanupSucceeded === true && finalStateSucceeded && report.cleanup.localLockRemoved;
    report.failurePhase = failurePhase;
    report.phaseAPassed = phaseAPassed;
    report.phaseBStarted = phaseBStarted;
    report.finishedAtUtc = new Date().toISOString();
    report.exitCode = report.status === STATUS.complete ? 0 : 1;
    for (const evidencePath of [
      subprocessStdoutPath,
      subprocessStderrPath,
      preInventoryPath,
      postInventoryPath,
    ]) {
      if (!fs.existsSync(evidencePath)) fs.writeFileSync(evidencePath, '[]', 'utf8');
    }
    report.artifactHashes = {
      stdout: sha256EvidenceFile(subprocessStdoutPath),
      stderr: sha256EvidenceFile(subprocessStderrPath),
      preInventory: sha256EvidenceFile(preInventoryPath),
      postInventory: sha256EvidenceFile(postInventoryPath),
    };
    activeArtifactCapture = null;
    writeReport(rootDirectory, report);
  }

  return report;
}

function stagePassed(report, name) {
  return report.stages.some((stage) => stage.name === name && stage.ok === true);
}

export function isExactD26Membership(memberships, setRole) {
  return (
    Array.isArray(memberships) &&
    memberships.length === 1 &&
    memberships[0].granted_role === 'ltc_m_runtime' &&
    memberships[0].member_role === 'postgres' &&
    memberships[0].grantor === 'supabase_admin' &&
    memberships[0].admin_option === true &&
    memberships[0].inherit_option === false &&
    memberships[0].set_option === false &&
    setRole === false
  );
}

function d26IsExact(postcheck) {
  return isExactD26Membership(postcheck?.d26_membership, postcheck?.d26_set_role ?? false);
}

export function buildP009TerminalPayload(report) {
  const postcheck = report.postcheckEvidence ?? {};
  const counts = postcheck.counts ?? {};
  const p009 = report.p009Evidence ?? {};
  const firstFailure = report.stages.find((stage) => stage.ok === false);
  const status =
    report.status === STATUS.complete
      ? 'passed'
      : report.status === STATUS.critical
        ? 'critical'
        : 'failed';
  return {
    protocol_version: 'P009_RESULT_V1',
    run_id: report.runId,
    status,
    started_at: report.startedAtUtc,
    finished_at: report.finishedAtUtc,
    duration_ms: Math.max(0, Date.parse(report.finishedAtUtc) - Date.parse(report.startedAtUtc)),
    phase_a: {
      passed: report.phaseAPassed === true,
      rolled_back: stagePassed(report, 'p009_phase_a_bootstrap'),
    },
    phase_b: {
      started: report.phaseBStarted === true,
      passed: report.phases.phaseB.passed === true,
    },
    p009: {
      batches: p009.batches === true,
      sheets: p009.sheets === true,
      staging: p009.staging === true,
      errors: p009.errors === true,
      partial_rejection: p009.partial_rejection === true,
      immutability: p009.immutability === true,
      audit_sanitized: p009.audit_sanitized === true,
      rls_viewer: p009.rls_viewer === true,
      rls_editor: p009.rls_editor === true,
      rls_admin: p009.rls_admin === true,
      invalid_context: p009.invalid_context === true && stagePassed(report, 'invalid_context'),
    },
    audit_requests: (p009.audit_requests ?? []).map((item) => ({
      scenario: item.scenario.replaceAll(':', '_').replaceAll('-', '_'),
      configured: item.configured,
      audited: item.audited,
      passed: item.configured === item.audited,
    })),
    regressions: {
      p007: stagePassed(report, 'p007_full_regression'),
      p008: stagePassed(report, 'p008_comprehensive_runtime'),
      d23_concurrency: stagePassed(report, 'd23_concurrency'),
      d24: stagePassed(report, 'admin_d24'),
    },
    cleanup: {
      finally_completed: report.cleanup.succeeded === true,
      rollback_clean: report.rollbackClean === true,
      d26_exact: d26IsExact(postcheck),
      grantor_postgres_count: postcheck.postgres_grantor_memberships ?? -1,
      locks_remaining: postcheck.relevant_advisory_locks ?? -1,
    },
    final_state: {
      brl_count: postcheck.reference_data?.BRL ?? -1,
      us_count: postcheck.reference_data?.US ?? -1,
      app_users: counts.app_users ?? -1,
      audit_log: counts.audit_log ?? -1,
      import_batches: counts.import_batches ?? -1,
      import_batch_sheets: counts.import_batch_sheets ?? -1,
      import_staging_rows: counts.import_staging_rows ?? -1,
      import_row_errors: counts.import_row_errors ?? -1,
    },
    fingerprints: {
      external: (
        report.fingerprints.after?.external ?? EXPECTED_FINGERPRINTS.external
      ).toLowerCase(),
      ltc_m: (report.fingerprints.after?.ltcm ?? EXPECTED_FINGERPRINTS.ltcm).toLowerCase(),
      migrations: (
        report.fingerprints.after?.migrations ?? EXPECTED_FINGERPRINTS.migrations
      ).toLowerCase(),
    },
    artifacts: {
      stdout_sha256: report.artifactHashes.stdout,
      stderr_sha256: report.artifactHashes.stderr,
      manifest_sha256: report.gate.manifestSha256.toLowerCase(),
      pre_inventory_sha256: report.artifactHashes.preInventory,
      post_inventory_sha256: report.artifactHashes.postInventory,
    },
    first_error: firstFailure?.detail ?? null,
    details: {
      task: report.task,
      command: report.command,
      stages: report.stages,
      gate: report.gate,
      migrations: report.migrations,
    },
  };
}

async function main() {
  const rootDirectory = process.cwd();
  let options;
  try {
    options = parseOptions(process.argv.slice(2));
    const issues = validateHarnessSources(rootDirectory);
    if (issues.length > 0) throw new Error(issues.join('; '));
    const gateResult = buildGateManifest(rootDirectory);
    if (gateResult.manifest.status !== 'approved') {
      throw new Error(
        `gate local do SQL renderizado falhou: ${gateResult.manifest.issues
          .map((item) => `${item.artifact ?? 'bundle'}:${item.line}:${item.column} ${item.message}`)
          .join('; ')}`,
      );
    }
    const manifestPath = path.join(
      rootDirectory,
      'docs',
      'database',
      'p009-rendered-sql-gate-manifest.json',
    );
    if (!fs.existsSync(manifestPath)) throw new Error('manifesto D33 versionado ausente');
    const storedManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (storedManifest.manifestSha256 !== gateResult.manifest.manifestSha256) {
      throw new Error('manifesto D33 versionado diverge do gate local atual');
    }
    options.gateManifest = gateResult.manifest;
  } catch (error) {
    console.error(`Bloqueada — gate local D33 falhou: ${error.message}`);
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
            'p009_phase_a_bootstrap_rolled_back',
            'phase_a_gate',
            'isolated_runtime_scenarios',
            'p009_full_validation',
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

  if (!options.worker) {
    console.error('Bloqueada — execução remota D33 exige o launcher versionado');
    process.exitCode = 2;
    return;
  }

  const actualGate = validateSqlBundle(rootDirectory, runId);
  if (!actualGate.ok) {
    console.error(
      `Bloqueada — gate local D33 falhou: ${actualGate.issues
        .map((item) => `${item.artifact}:${item.line}:${item.column} ${item.message}`)
        .join('; ')}`,
    );
    process.exitCode = 2;
    return;
  }
  const resolvedArtifactDirectory = path.resolve(options.artifactDirectory);
  const relativeArtifactDirectory = path.relative(
    path.resolve(rootDirectory, '.tmp'),
    resolvedArtifactDirectory,
  );
  if (relativeArtifactDirectory.startsWith('..') || path.isAbsolute(relativeArtifactDirectory)) {
    console.error('Bloqueada — diretório de evidência D33 deve permanecer em .tmp');
    process.exitCode = 2;
    return;
  }
  const report = await runLive(
    rootDirectory,
    runId,
    options.gateManifest,
    actualGate,
    resolvedArtifactDirectory,
  );
  const payload = buildP009TerminalPayload(report);
  process.stdout.write(`${createP009TerminalEnvelope(payload)}\n`);
  if (payload.status !== 'passed') process.exitCode = 1;
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  await main();
}
