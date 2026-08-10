import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  extractSyntheticCurrencyCodes,
  scanSyntheticCurrencyFixtures,
} from './check-d40-tests.mjs';
import {
  CONCURRENCY_ADMIN_USER,
  buildConcurrencySql,
  resolveConcurrencyIdentity,
  runConcurrencyTest,
} from './run-postgres-concurrency-test.mjs';

const RUNNER_SOURCE = fs.readFileSync('scripts/run-postgres-concurrency-test.mjs', 'utf8');
const CI_RUNNER_SOURCE = fs.readFileSync('scripts/run-postgres-ci-validation.mjs', 'utf8');
const BOOTSTRAP_SOURCE = fs.readFileSync('database/audit/ltcm-ci-bootstrap.sql', 'utf8');
const WORKFLOW_SOURCE = fs.readFileSync('.github/workflows/ltcm-postgres-validation.yml', 'utf8');

function successfulPsqlMocks({ dropError } = {}) {
  const syncCalls = [];
  const asyncCalls = [];
  const runPsql = (request) => {
    syncCalls.push(request);
    if (request.command?.includes("'exists'")) {
      return { code: 0, stdout: '{"exists":true}\n', stderr: '' };
    }
    if (request.command?.startsWith('drop database')) {
      if (dropError) throw dropError;
      return { code: 0, stdout: '', stderr: '' };
    }
    if (request.file?.endsWith('setup.sql')) {
      return { code: 0, stdout: '', stderr: '' };
    }
    if (request.command?.includes("'first_refs'")) {
      return {
        code: 0,
        stdout:
          '{"first_refs":1,"first_status":"received","second_refs":0,"second_status":"rejected"}\n',
        stderr: '',
      };
    }
    throw new Error('chamada psql sincrona inesperada');
  };
  const runPsqlAsync = async (request) => {
    asyncCalls.push(request);
    const expectedFailure = /(?:reject-first|link-second)\.sql$/u.test(request.file);
    return expectedFailure
      ? {
          code: 1,
          signal: null,
          stdout: '',
          stderr: 'ERROR: 23514 check violation',
          durationMs: 1200,
        }
      : { code: 0, signal: null, stdout: '', stderr: '', durationMs: 1200 };
  };
  return { syncCalls, asyncCalls, runPsql, runPsqlAsync };
}

test('seleciona postgres e nunca herda a identidade bootstrap supabase_admin', () => {
  const identity = resolveConcurrencyIdentity(
    {},
    {
      PGUSER: 'supabase_admin',
      PGPASSWORD: 'ltcm_ci_bootstrap_only',
      LTCM_CI_POSTGRES_PASSWORD: 'ltcm_ci_postgres_only',
    },
  );
  assert.equal(CONCURRENCY_ADMIN_USER, 'postgres');
  assert.deepEqual(identity, {
    adminUser: 'postgres',
    adminPassword: 'ltcm_ci_postgres_only',
    postgresPassword: 'ltcm_ci_postgres_only',
  });
  assert.doesNotMatch(RUNNER_SOURCE, /adminUser\s*\?\?\s*process\.env\.PGUSER/u);
  assert.doesNotMatch(RUNNER_SOURCE, /adminPassword\s*\?\?\s*process\.env\.PGPASSWORD/u);
});

test('falha fechado para identidade, senha separada ou credencial sintetica invalida', () => {
  assert.throws(
    () =>
      resolveConcurrencyIdentity(
        { adminUser: 'supabase_admin', postgresPassword: 'ltcm_ci_postgres_only' },
        {},
      ),
    /deve ser postgres/u,
  );
  assert.throws(
    () =>
      resolveConcurrencyIdentity(
        { adminPassword: 'ltcm_ci_bootstrap_only', postgresPassword: 'ltcm_ci_postgres_only' },
        {},
      ),
    /separada/u,
  );
  assert.throws(() => resolveConcurrencyIdentity({}, {}), /ausente ou invalida/u);
  assert.throws(
    () => resolveConcurrencyIdentity({ postgresPassword: 'credencial-real' }, {}),
    /ausente ou invalida/u,
  );
});

test('bootstrap preserva supabase_admin NOLOGIN, ci_admin restrita e D26 exata', () => {
  assert.match(
    BOOTSTRAP_SOURCE,
    /create role postgres\s+login\s+password\s+'ltcm_ci_postgres_only'\s+nosuperuser\s+inherit\s+createdb\s+createrole\s+noreplication\s+bypassrls\s*;/iu,
  );
  assert.match(BOOTSTRAP_SOURCE, /alter role supabase_admin nologin noreplication/iu);
  assert.doesNotMatch(RUNNER_SOURCE, /alter\s+role\s+supabase_admin/iu);
  assert.match(
    BOOTSTRAP_SOURCE,
    /create role ci_admin[\s\S]*?login[\s\S]*?nosuperuser[\s\S]*?noinherit[\s\S]*?nocreatedb[\s\S]*?nocreaterole[\s\S]*?noreplication[\s\S]*?nobypassrls/iu,
  );
  assert.match(
    BOOTSTRAP_SOURCE,
    /grant ltc_m_runtime to postgres\s+with admin true, inherit false, set false/iu,
  );
  assert.doesNotMatch(RUNNER_SOURCE, /\b(?:create|alter)\s+role\b|\bgrant\b/iu);
  assert.doesNotMatch(RUNNER_SOURCE, /ci_admin|ltc_m_runtime/iu);
});

test('sequenciamento prepara banco com postgres antes de D26 e invoca concorrencia apos 47 cenarios', () => {
  const createDatabase = CI_RUNNER_SOURCE.indexOf(
    "command: 'create database ltcm_ci_concurrency owner postgres'",
  );
  const bootstrapD26 = CI_RUNNER_SOURCE.indexOf("runStage('bootstrap_d26'");
  const d40 = CI_RUNNER_SOURCE.indexOf("runStage('d40_d41'");
  const concurrency = CI_RUNNER_SOURCE.indexOf('await runConcurrencyTest()');
  assert.ok(createDatabase >= 0 && createDatabase < bootstrapD26);
  assert.ok(bootstrapD26 < d40 && d40 < concurrency);
  assert.match(
    CI_RUNNER_SOURCE,
    /database: 'ltcm_ci_concurrency'[\s\S]*?user: 'postgres'[\s\S]*?password: postgresPassword/iu,
  );
  assert.match(CI_RUNNER_SOURCE, /drop database if exists ltcm_ci_concurrency with \(force\)/iu);
});

test('usa identidade administrativa somente no preflight e drop do banco descartavel', () => {
  assert.equal((RUNNER_SOURCE.match(/user: adminUser/gu) ?? []).length, 2);
  assert.equal((RUNNER_SOURCE.match(/password: adminPassword/gu) ?? []).length, 2);
  assert.match(RUNNER_SOURCE, /database: 'postgres',[\s\S]*?user: adminUser[\s\S]*?'exists'/u);
  assert.match(
    RUNNER_SOURCE,
    /database: 'postgres',[\s\S]*?user: adminUser[\s\S]*?drop database if exists/u,
  );
  assert.doesNotMatch(RUNNER_SOURCE, /create database ltcm_ci_concurrency/iu);
});

test('fluxo simulado usa postgres e preserva duas ordens em conexoes independentes', async () => {
  const mocks = successfulPsqlMocks();
  const result = await runConcurrencyTest({
    postgresPassword: 'ltcm_ci_postgres_only',
    runPsql: mocks.runPsql,
    runPsqlAsync: mocks.runPsqlAsync,
    wait: async () => {},
  });
  assert.deepEqual(result, {
    passed: true,
    scenarios: 2,
    deadlocks: 0,
    unexpectedTimeouts: 0,
    serialized: true,
    isolation: 'discarded_database',
  });
  assert.equal(mocks.asyncCalls.length, 4);
  assert.deepEqual(
    mocks.asyncCalls.map((call) => call.user),
    ['postgres', 'postgres', 'postgres', 'postgres'],
  );
  assert.match(mocks.asyncCalls[0].file, /link-first\.sql$/u);
  assert.match(mocks.asyncCalls[1].file, /reject-first\.sql$/u);
  assert.match(mocks.asyncCalls[2].file, /reject-second\.sql$/u);
  assert.match(mocks.asyncCalls[3].file, /link-second\.sql$/u);
  assert.equal(mocks.syncCalls[0].database, 'postgres');
  assert.equal(mocks.syncCalls[0].user, 'postgres');
  assert.equal(mocks.syncCalls.at(-1).database, 'postgres');
  assert.match(mocks.syncCalls.at(-1).command, /^drop database/iu);
});

test('erro de autenticacao administrativa permanece erro', async () => {
  const calls = [];
  await assert.rejects(
    runConcurrencyTest({
      postgresPassword: 'ltcm_ci_postgres_only',
      runPsql(request) {
        calls.push(request);
        throw new Error('FATAL: role postgres is not permitted to log in');
      },
      runPsqlAsync: async () => assert.fail('conexao concorrente nao deveria iniciar'),
      wait: async () => {},
    }),
    /FATAL: role postgres is not permitted to log in/u,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].user, 'postgres');
});

test('erro de permissao no setup falha e ainda executa cleanup', async () => {
  const calls = [];
  await assert.rejects(
    runConcurrencyTest({
      postgresPassword: 'ltcm_ci_postgres_only',
      runPsql(request) {
        calls.push(request);
        if (request.command?.includes("'exists'")) {
          return { code: 0, stdout: '{"exists":true}\n', stderr: '' };
        }
        if (request.file?.endsWith('setup.sql')) throw new Error('ERROR: permission denied');
        if (request.command?.startsWith('drop database')) {
          return { code: 0, stdout: '', stderr: '' };
        }
        throw new Error('chamada inesperada');
      },
      runPsqlAsync: async () => assert.fail('conexao concorrente nao deveria iniciar'),
      wait: async () => {},
    }),
    /permission denied/u,
  );
  assert.equal(calls.length, 3);
  assert.match(calls.at(-1).command, /^drop database/iu);
});

test('falha de cleanup nao e mascarada', async () => {
  const mocks = successfulPsqlMocks({ dropError: new Error('ERROR: drop database denied') });
  await assert.rejects(
    runConcurrencyTest({
      postgresPassword: 'ltcm_ci_postgres_only',
      runPsql: mocks.runPsql,
      runPsqlAsync: mocks.runPsqlAsync,
      wait: async () => {},
    }),
    /drop database denied/u,
  );
});

test('conexoes permanecem locais, sinteticas e sem Supabase ou DSN remoto', () => {
  assert.match(RUNNER_SOURCE, /--host'[\s\S]*?process\.env\.PGHOST/u);
  assert.match(RUNNER_SOURCE, /--port'[\s\S]*?process\.env\.PGPORT/u);
  assert.match(RUNNER_SOURCE, /LTCM_CI_POSTGRES_PASSWORD/u);
  assert.doesNotMatch(RUNNER_SOURCE, /https?:\/\/|postgresql:\/\/|supabase/iu);
  assert.doesNotMatch(RUNNER_SOURCE, /PGPASSWORD\s*\?\?|PGUSER\s*\?\?/u);
  assert.match(WORKFLOW_SOURCE, /^\s*PGHOST:\s*127\.0\.0\.1\s*$/mu);
  assert.match(WORKFLOW_SOURCE, /^\s*LTCM_CI_POSTGRES_PASSWORD:\s*ltcm_ci_postgres_only\s*$/mu);
  assert.match(CI_RUNNER_SOURCE, /checkCiEnvironment[\s\S]*?requireGitHubActions:\s*true/iu);
});

test('cenários concorrentes usam duas ordens e locks limitados', () => {
  const sql = buildConcurrencySql();
  assert.match(sql.linkFirst, /insert into ltc_m\.projects/iu);
  assert.match(sql.linkFirst, /pg_sleep\(2\)/iu);
  assert.match(sql.rejectFirst, /status = 'rejected'/iu);
  assert.match(sql.rejectSecond, /status = 'rejected'[\s\S]*pg_sleep\(2\)/iu);
  assert.match(sql.linkSecond, /insert into ltc_m\.projects/iu);
  for (const source of [sql.linkFirst, sql.rejectFirst, sql.rejectSecond, sql.linkSecond]) {
    assert.match(source, /set local lock_timeout = '8s'/iu);
  }
  for (const source of Object.values(sql)) {
    assert.doesNotMatch(source, /https?:\/\//iu);
    assert.doesNotMatch(source, /supabase/iu);
  }
});

test('SQL concorrente usa apenas a moeda sintética ZZZ válida', () => {
  const sql = buildConcurrencySql();
  const source = Object.values(sql).join('\n');
  assert.deepEqual(extractSyntheticCurrencyCodes(source), ['ZZZ']);
  assert.deepEqual(scanSyntheticCurrencyFixtures(source, { requireInsert: true }), []);
  assert.doesNotMatch(sql.setup, /values\s*\(\s*'C43'/iu);
  assert.doesNotMatch(`${sql.linkFirst}\n${sql.linkSecond}`, /'C43'\s*,\s*100/gu);
  assert.match(sql.linkFirst, /'ZZZ'\s*,\s*100/gu);
  assert.match(sql.linkSecond, /'ZZZ'\s*,\s*100/gu);
});

test('validação monetária rejeita a versão concorrente com C43', () => {
  const invalidSetup = buildConcurrencySql().setup.replace("'ZZZ'", "'C43'");
  assert.ok(
    scanSyntheticCurrencyFixtures(invalidSetup, { requireInsert: true }).some((issue) =>
      issue.includes('inválido'),
    ),
  );
});

test('fixtures concorrentes são exclusivamente sintéticas', () => {
  const source = Object.values(buildConcurrencySql()).join('\n');
  assert.match(source, /sintétic/iu);
  assert.doesNotMatch(source, /\.xlsx/iu);
  assert.doesNotMatch(source, /delete\s+from\s+ltc_m/iu);
});
