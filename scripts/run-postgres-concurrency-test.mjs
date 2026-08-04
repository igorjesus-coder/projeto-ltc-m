import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CONCURRENCY_DATABASE = 'ltcm_ci_concurrency';
const ADMIN_ID = '00000000-0000-4000-8000-000000043001';
const CLIENT_ID = '00000000-0000-4000-8000-000000043010';
const FIRST_BATCH_ID = '00000000-0000-4000-8000-000000043020';
const SECOND_BATCH_ID = '00000000-0000-4000-8000-000000043021';

function psqlArguments({ database, user, file, command }) {
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
  if (file) args.push('--file', file);
  if (command) args.push('--command', command);
  return args;
}

function sanitizedError(result) {
  const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
  return text.match(/(?:ERROR|FATAL):[^\r\n]{0,300}/u)?.[0] ?? 'psql falhou';
}

function runPsql({ database, user, password, file, command, expectSuccess = true }) {
  const result = spawnSync('psql', psqlArguments({ database, user, file, command }), {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: password },
    windowsHide: true,
    timeout: 30_000,
  });
  const code = result.status ?? 1;
  if (expectSuccess && code !== 0) throw new Error(sanitizedError(result));
  return { code, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runPsqlAsync({ database, user, password, file }) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn('psql', psqlArguments({ database, user, file }), {
      env: { ...process.env, PGPASSWORD: password },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const timeout = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, signal, stdout, stderr, durationMs: Date.now() - startedAt });
    });
  });
}

function writeSql(directory, name, sql) {
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, sql, 'utf8');
  return filePath;
}

export function buildConcurrencySql() {
  const actorContext = (requestId, justification) => `select ltc_m.set_actor_context(
    '${ADMIN_ID}', 'ci-d43|admin', '${requestId}', '${justification}', 'system'
);`;
  return {
    setup: `
select ltc_m.set_actor_context(null, null, 'ci-d43-setup', null, 'system');
insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values ('${ADMIN_ID}', 'ci-d43|admin', 'CI D43 Admin', 'admin', true);
${actorContext('ci-d43-setup-data', 'Fixture sintética concorrente D43')}
insert into ltc_m.currencies (code, name, decimal_places, active)
values ('C43', 'Moeda sintética CI D43', 2, true);
insert into ltc_m.clients (id, legal_name, display_name)
values ('${CLIENT_ID}', 'Cliente sintético CI D43', 'Cliente sintético CI D43');
insert into ltc_m.import_batches
    (id, source_name, source_hash, idempotency_key, submitted_by_user_id, status)
values
    ('${FIRST_BATCH_ID}', 'ci-d43-first.bin', repeat('4', 64), 'ci-d43-first', '${ADMIN_ID}', 'received'),
    ('${SECOND_BATCH_ID}', 'ci-d43-second.bin', repeat('5', 64), 'ci-d43-second', '${ADMIN_ID}', 'received');
`,
    linkFirst: `
\\set VERBOSITY verbose
begin;
set local lock_timeout = '8s';
set local statement_timeout = '15s';
${actorContext('ci-d43-link-first', 'Vínculo sintético concorrente D43')}
insert into ltc_m.projects
    (id, project_code, project_name, client_id, base_currency, contract_value,
     data_reference_date, legacy_import_batch_id)
values
    ('00000000-0000-4000-8000-000000043100', 'CI-D43-FIRST',
     'Projeto sintético concorrente D43', '${CLIENT_ID}', 'C43', 100, null,
     '${FIRST_BATCH_ID}');
select pg_catalog.pg_sleep(2);
commit;
`,
    rejectFirst: `
\\set VERBOSITY verbose
begin;
set local lock_timeout = '8s';
set local statement_timeout = '15s';
update ltc_m.import_batches set status = 'rejected' where id = '${FIRST_BATCH_ID}';
commit;
`,
    rejectSecond: `
\\set VERBOSITY verbose
begin;
set local lock_timeout = '8s';
set local statement_timeout = '15s';
update ltc_m.import_batches set status = 'rejected' where id = '${SECOND_BATCH_ID}';
select pg_catalog.pg_sleep(2);
commit;
`,
    linkSecond: `
\\set VERBOSITY verbose
begin;
set local lock_timeout = '8s';
set local statement_timeout = '15s';
${actorContext('ci-d43-link-second', 'Vínculo inverso sintético D43')}
insert into ltc_m.projects
    (id, project_code, project_name, client_id, base_currency, contract_value,
     data_reference_date, legacy_import_batch_id)
values
    ('00000000-0000-4000-8000-000000043101', 'CI-D43-SECOND',
     'Projeto sintético inverso D43', '${CLIENT_ID}', 'C43', 100, null,
     '${SECOND_BATCH_ID}');
commit;
`,
  };
}

function assertExpectedFailure(result, label) {
  if (result.code === 0) throw new Error(`${label}: operação incompatível foi aceita`);
  if (!/23514/u.test(result.stderr) || /40P01/u.test(result.stderr)) {
    throw new Error(`${label}: falha não corresponde ao bloqueio D41 esperado`);
  }
  if (/55P03/u.test(result.stderr)) throw new Error(`${label}: lock_timeout inesperado`);
}

function parseJsonOutput(stdout) {
  const line = stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .findLast(Boolean);
  if (!line) throw new Error('consulta concorrente não retornou evidência');
  return JSON.parse(line);
}

export async function runConcurrencyTest(options = {}) {
  const adminUser = options.adminUser ?? process.env.PGUSER;
  const adminPassword = options.adminPassword ?? process.env.PGPASSWORD;
  const postgresPassword = options.postgresPassword ?? process.env.LTCM_CI_POSTGRES_PASSWORD;
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ltcm-ci-concurrency-'));
  const sql = buildConcurrencySql();
  let databaseCreated = false;
  try {
    const databaseCheck = parseJsonOutput(
      runPsql({
        database: 'postgres',
        user: adminUser,
        password: adminPassword,
        command: `select pg_catalog.jsonb_build_object(
          'exists', exists (
            select 1 from pg_catalog.pg_database where datname = '${CONCURRENCY_DATABASE}'
          )
        )`,
      }).stdout,
    );
    if (databaseCheck.exists !== true) {
      throw new Error('banco concorrente descartável não foi preparado pelo runner');
    }
    databaseCreated = true;
    runPsql({
      database: CONCURRENCY_DATABASE,
      user: 'postgres',
      password: postgresPassword,
      file: writeSql(tempDirectory, 'setup.sql', sql.setup),
    });

    const firstLink = runPsqlAsync({
      database: CONCURRENCY_DATABASE,
      user: 'postgres',
      password: postgresPassword,
      file: writeSql(tempDirectory, 'link-first.sql', sql.linkFirst),
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const firstReject = runPsqlAsync({
      database: CONCURRENCY_DATABASE,
      user: 'postgres',
      password: postgresPassword,
      file: writeSql(tempDirectory, 'reject-first.sql', sql.rejectFirst),
    });
    const [linkResult, rejectResult] = await Promise.all([firstLink, firstReject]);
    if (linkResult.code !== 0) throw new Error('concorrência vínculo-primeiro falhou');
    assertExpectedFailure(rejectResult, 'concorrência vínculo-primeiro');
    if (rejectResult.durationMs < 1_000) {
      throw new Error('concorrência vínculo-primeiro não demonstrou serialização');
    }

    const secondReject = runPsqlAsync({
      database: CONCURRENCY_DATABASE,
      user: 'postgres',
      password: postgresPassword,
      file: writeSql(tempDirectory, 'reject-second.sql', sql.rejectSecond),
    });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const secondLink = runPsqlAsync({
      database: CONCURRENCY_DATABASE,
      user: 'postgres',
      password: postgresPassword,
      file: writeSql(tempDirectory, 'link-second.sql', sql.linkSecond),
    });
    const [rejectSecondResult, linkSecondResult] = await Promise.all([secondReject, secondLink]);
    if (rejectSecondResult.code !== 0) throw new Error('concorrência rejeição-primeiro falhou');
    assertExpectedFailure(linkSecondResult, 'concorrência rejeição-primeiro');
    if (linkSecondResult.durationMs < 1_000) {
      throw new Error('concorrência rejeição-primeiro não demonstrou serialização');
    }

    const verification = parseJsonOutput(
      runPsql({
        database: CONCURRENCY_DATABASE,
        user: 'postgres',
        password: postgresPassword,
        command: `select pg_catalog.jsonb_build_object(
          'first_refs', (select count(*) from ltc_m.projects where legacy_import_batch_id = '${FIRST_BATCH_ID}'),
          'first_status', (select status from ltc_m.import_batches where id = '${FIRST_BATCH_ID}'),
          'second_refs', (select count(*) from ltc_m.projects where legacy_import_batch_id = '${SECOND_BATCH_ID}'),
          'second_status', (select status from ltc_m.import_batches where id = '${SECOND_BATCH_ID}')
        )`,
      }).stdout,
    );
    if (
      verification.first_refs !== 1 ||
      verification.first_status !== 'received' ||
      verification.second_refs !== 0 ||
      verification.second_status !== 'rejected'
    ) {
      throw new Error('estado final dos cenários concorrentes é inconsistente');
    }

    return {
      passed: true,
      scenarios: 2,
      deadlocks: 0,
      unexpectedTimeouts: 0,
      serialized: true,
      isolation: 'discarded_database',
    };
  } finally {
    if (databaseCreated) {
      runPsql({
        database: 'postgres',
        user: adminUser,
        password: adminPassword,
        command: `drop database if exists ${CONCURRENCY_DATABASE} with (force)`,
      });
    }
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  try {
    const result = await runConcurrencyTest();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`Teste concorrente D41 falhou: ${error.message}\n`);
    process.exitCode = 1;
  }
}
