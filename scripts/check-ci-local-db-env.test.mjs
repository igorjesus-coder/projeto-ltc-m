import assert from 'node:assert/strict';
import test from 'node:test';

import { CI_POSTGRES_IMAGE, validateCiEnvironment } from './check-ci-local-db-env.mjs';

function validEnvironment() {
  return {
    GITHUB_ACTIONS: 'true',
    PGHOST: '127.0.0.1',
    PGPORT: '5432',
    PGDATABASE: 'ltcm_ci',
    PGUSER: 'ci_admin',
    PGPASSWORD: 'ltcm_ci_admin_only',
    LTCM_CI_POSTGRES_PASSWORD: 'ltcm_ci_postgres_only',
    LTCM_CI_POSTGRES_IMAGE: CI_POSTGRES_IMAGE,
  };
}

test('aceita somente configuração sintética e local do GitHub Actions', () => {
  assert.deepEqual(
    validateCiEnvironment({
      env: validEnvironment(),
      repositoryFiles: ['.env.example', 'database/audit/test.sql'],
      executionSources: { 'workflow.yml': 'psql --host 127.0.0.1' },
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
    LTCM_CI_POSTGRES_IMAGE: 'postgres:17',
  };
  const issues = validateCiEnvironment({ env, requireGitHubActions: true });
  assert.ok(issues.some((issue) => issue.includes('PGHOST')));
  assert.ok(issues.some((issue) => issue.includes('imutável')));
  assert.ok(issues.some((issue) => issue.includes('GitHub Actions')));
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
      'workflow.yml': 'pull_request_target:\n  run: supabase db push --linked',
    },
  });
  assert.equal(issues.length, 1);
  assert.match(issues[0], /operação remota proibida/u);
});
