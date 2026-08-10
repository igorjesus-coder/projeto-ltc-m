import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import * as prettier from 'prettier';

import {
  CI_PACKAGE_LOCK_SHA256,
  CI_P008_MIGRATION_SHA256,
  CI_POSTGRES_IMAGE,
  validateCiEnvironment,
  validateD51Bootstrap,
  validateD51Workflow,
  validatePostgresImageWorkflow,
} from './check-ci-local-db-env.mjs';

const WORKFLOW_PATH = '.github/workflows/ltcm-postgres-validation.yml';

function workflowSource(image = CI_POSTGRES_IMAGE, suffix = '') {
  return `jobs:\n  validation:\n    services:\n      postgres:\n        image: ${image}\n        env:\n          POSTGRES_USER: supabase_admin\n        options: --health-cmd "pg_isready -U supabase_admin -d ltcm_ci"\n    env:\n      PGUSER: supabase_admin\n${suffix}`;
}

function workflowExecutionSources(image = CI_POSTGRES_IMAGE, suffix = '') {
  return { [WORKFLOW_PATH]: workflowSource(image, suffix) };
}

function validEnvironment() {
  return {
    GITHUB_ACTIONS: 'true',
    PGHOST: '127.0.0.1',
    PGPORT: '5432',
    PGDATABASE: 'ltcm_ci',
    PGUSER: 'supabase_admin',
    PGPASSWORD: 'ltcm_ci_bootstrap_only',
    LTCM_CI_ADMIN_PASSWORD: 'ltcm_ci_admin_only',
    LTCM_CI_POSTGRES_PASSWORD: 'ltcm_ci_postgres_only',
  };
}

test('aceita somente configuração sintética e local do GitHub Actions', () => {
  assert.deepEqual(
    validateCiEnvironment({
      env: validEnvironment(),
      repositoryFiles: ['.env.example', 'database/audit/test.sql'],
      executionSources: workflowExecutionSources(),
      requireGitHubActions: true,
    }),
    [],
  );
});

test('rejeita variáveis remotas sem exibir seus valores', () => {
  const env = { ...validEnvironment(), SUPABASE_ACCESS_TOKEN: 'valor-nao-exibido' };
  const issues = validateCiEnvironment({ env });
  assert.ok(issues.some((issue) => issue.includes('SUPABASE_ACCESS_TOKEN')));
  assert.ok(issues.every((issue) => !issue.includes('valor-nao-exibido')));
});

test('rejeita host externo, imagem móvel e execução fora do runner', () => {
  const env = {
    ...validEnvironment(),
    GITHUB_ACTIONS: 'false',
    PGHOST: 'db.example.invalid',
  };
  const issues = validateCiEnvironment({
    env,
    executionSources: workflowExecutionSources('postgres:17'),
    requireGitHubActions: true,
  });
  assert.ok(issues.some((issue) => issue.includes('PGHOST')));
  assert.ok(issues.some((issue) => issue.includes('imutável')));
  assert.ok(issues.some((issue) => issue.includes('GitHub Actions')));
});

test('D51 exige supabase_admin como bootstrap superuser no workflow', () => {
  const valid = workflowSource();
  assert.deepEqual(validateD51Workflow(valid), []);

  const ciBootstrap = valid
    .replace('POSTGRES_USER: supabase_admin', 'POSTGRES_USER: ci_admin')
    .replace('pg_isready -U supabase_admin', 'pg_isready -U ci_admin');
  const issues = validateD51Workflow(ciBootstrap);
  assert.ok(issues.some((issue) => issue.includes('bootstrap superuser')));
  assert.ok(issues.some((issue) => issue.includes('ci_admin não pode')));
});

test('D51 rejeita grantor, membership e opções D26 relaxadas', () => {
  const bootstrapPath = path.join(process.cwd(), 'database', 'audit', 'ltcm-ci-bootstrap.sql');
  const source = fs.readFileSync(bootstrapPath, 'utf8');
  assert.deepEqual(validateD51Bootstrap(source), []);

  const invalidSources = [
    source.replace('grant ltc_m_runtime to postgres', 'grant ltc_m_runtime to ci_admin'),
    source.replace(
      "pg_catalog.pg_get_userbyid(grantor) = 'supabase_admin'",
      "pg_catalog.pg_get_userbyid(grantor) = 'ci_admin'",
    ),
    source.replace(
      'with admin true, inherit false, set false',
      'with admin false, inherit true, set true',
    ),
    `${source}\ngrant ltc_m_runtime to postgres granted by supabase_admin;\n`,
  ];
  for (const invalid of invalidSources) assert.notDeepEqual(validateD51Bootstrap(invalid), []);
});

test('D51 exige credenciais sintéticas distintas e protege a migration P008', () => {
  const duplicateCredentials = {
    ...validEnvironment(),
    LTCM_CI_ADMIN_PASSWORD: validEnvironment().PGPASSWORD,
  };
  assert.ok(
    validateCiEnvironment({ env: duplicateCredentials }).some((issue) =>
      issue.includes('devem ser distintas'),
    ),
  );
  assert.ok(
    validateCiEnvironment({
      env: validEnvironment(),
      p008MigrationSha256: '0'.repeat(64),
    }).some((issue) => issue.includes('migration P008')),
  );
  assert.deepEqual(
    validateCiEnvironment({
      env: validEnvironment(),
      p008MigrationSha256: CI_P008_MIGRATION_SHA256,
    }),
    [],
  );
});

test('rejeita XLSX, artifacts e env real, preservando env example', () => {
  const issues = validateCiEnvironment({
    env: validEnvironment(),
    repositoryFiles: ['.env.example', '.env.local', '.artifacts/result.json', 'source.xlsx'],
  });
  assert.equal(issues.length, 3);
});

test('rejeita operações remotas e pull_request_target nos executores', () => {
  const issues = validateCiEnvironment({
    env: validEnvironment(),
    executionSources: {
      [WORKFLOW_PATH]: `${workflowSource()}pull_request_target:\n  run: supabase db push --linked`,
    },
  });
  assert.ok(issues.some((issue) => /operação remota proibida/u.test(issue)));
});

test('workflow real usa uma única referência canônica ASCII sem tag ou whitespace', () => {
  const source = fs.readFileSync(path.join(process.cwd(), WORKFLOW_PATH), 'utf8');
  const imageLine = source.split('\n').find((line) => /^\s*image:/u.test(line));
  const value = imageLine.slice(imageLine.indexOf(':') + 1).trimStart();
  const approvedDigest = '4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394';
  const previousReference = ['postgres:17.10-bookworm@', `sha256:${approvedDigest}`].join('');

  assert.deepEqual(validatePostgresImageWorkflow(source), []);
  assert.equal(value, CI_POSTGRES_IMAGE);
  assert.match(value, /^postgres@sha256:[0-9a-f]{64}$/u);
  assert.equal(value, `postgres@sha256:${approvedDigest}`);
  assert.equal(source.split(CI_POSTGRES_IMAGE).length - 1, 1);
  assert.equal(source.includes(previousReference), false);
  assert.equal(Buffer.from(value, 'ascii').toString('ascii'), value);
  assert.doesNotMatch(value, /[\s\u00a0\p{Cc}]/u);
  assert.equal(value, value.trimEnd());
});

test('scanner rejeita tag, digest móvel ou inválido, whitespace, Unicode e duplicidade', () => {
  const digest = CI_POSTGRES_IMAGE.slice('postgres@sha256:'.length);
  const invalidSources = [
    workflowSource(`postgres:17.10-bookworm@sha256:${digest}`),
    workflowSource('postgres:17'),
    workflowSource(`postgres@sha256:${digest.slice(1)}`),
    workflowSource(`postgres@sha256:${digest.toUpperCase()}`),
    workflowSource(`postgres@SHA256:${digest}`),
    workflowSource(`postgres@sha256:${'0'.repeat(64)}`),
    workflowSource(`${CI_POSTGRES_IMAGE.slice(0, 35)} ${CI_POSTGRES_IMAGE.slice(35)}`),
    workflowSource(`${CI_POSTGRES_IMAGE} `),
    workflowSource(`\t${CI_POSTGRES_IMAGE}`),
    workflowSource(`${CI_POSTGRES_IMAGE}\r`),
    workflowSource(`${CI_POSTGRES_IMAGE}\u00a0`),
    workflowSource(`${CI_POSTGRES_IMAGE}\u0007`),
    workflowSource(CI_POSTGRES_IMAGE.replace('postgres', 'postgrés')),
    'jobs:\n  validation:\n    services:\n      postgres:\n        image: >-\n          postgres@sha256:fragmented\n',
    workflowSource(CI_POSTGRES_IMAGE, `    env:\n      DUPLICATE: ${CI_POSTGRES_IMAGE}\n`),
  ];

  for (const source of invalidSources) {
    assert.notDeepEqual(validatePostgresImageWorkflow(source), []);
  }
});

test('parser YAML expõe exatamente o valor canônico sem tag', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), WORKFLOW_PATH), 'utf8');
  const parsed = await prettier.__debug.parse(source, { parser: 'yaml' });
  const values = [];
  const seen = new WeakSet();
  const visit = (value) => {
    if (typeof value === 'string') {
      if (value.startsWith('postgres@sha256:')) values.push(value);
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) value.forEach(visit);
    else Object.values(value).forEach(visit);
  };
  visit(parsed.ast);
  assert.deepEqual(values, [CI_POSTGRES_IMAGE]);
});

test('package-lock permanece no hash aprovado pela D45', () => {
  const hash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(path.join(process.cwd(), 'package-lock.json')))
    .digest('hex')
    .toUpperCase();
  assert.equal(hash, CI_PACKAGE_LOCK_SHA256);
  assert.deepEqual(validateCiEnvironment({ env: validEnvironment(), packageLockSha256: hash }), []);
  assert.ok(
    validateCiEnvironment({ env: validEnvironment(), packageLockSha256: '0'.repeat(64) }).some(
      (issue) => issue.includes('package-lock.json'),
    ),
  );
});
