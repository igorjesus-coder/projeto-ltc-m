import assert from 'node:assert/strict';
import test from 'node:test';

import { loadApiConfig } from '../src/config/api-config.js';

const validEnvironment = Object.freeze({
  NODE_ENV: 'test',
  PORT: '3000',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173,https://web.example.invalid',
  DATABASE_URL: 'postgresql://p019_user:p019_local_only@127.0.0.1:5432/ltcm_test',
  DATABASE_SSL_MODE: 'disable',
  AUTH0_ISSUER_BASE_URL: 'https://tenant.example.auth0.com/',
  AUTH0_AUDIENCE: 'https://api.example.invalid',
});

test('carrega configuração server-only válida com limites explícitos', () => {
  const config = loadApiConfig(validEnvironment);
  assert.equal(config.nodeEnvironment, 'test');
  assert.equal(config.port, 3000);
  assert.deepEqual(config.corsAllowedOrigins, [
    'http://localhost:5173',
    'https://web.example.invalid',
  ]);
  assert.equal(config.database.sslMode, 'disable');
  assert.equal(config.database.poolMax, 10);
  assert.equal(config.auth.issuerBaseUrl, 'https://tenant.example.auth0.com/');
  assert.equal(config.auth.jwksUri, 'https://tenant.example.auth0.com/.well-known/jwks.json');
  assert.deepEqual(config.auth.allowedAlgorithms, ['RS256']);
});

test('falha fechado quando DATABASE_URL está ausente sem revelar outros valores', () => {
  const missing: Record<string, string> = { ...validEnvironment };
  delete missing['DATABASE_URL'];
  assert.throws(
    () => loadApiConfig(missing),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'P019_CONFIG_DATABASE_URL_MISSING' &&
      !error.message.includes('p019_local_only'),
  );
});

test('rejeita URL PostgreSQL inválida sem ecoar credencial', () => {
  const secret = 'must-not-appear';
  assert.throws(
    () => loadApiConfig({ ...validEnvironment, DATABASE_URL: `https://user:${secret}@host/db` }),
    (error: unknown) => error instanceof Error && !error.message.includes(secret),
  );
});

test('produção exige verificação TLS completa e rejeita SSL ambíguo na URL', () => {
  assert.throws(
    () => loadApiConfig({ ...validEnvironment, NODE_ENV: 'production' }),
    /P019_CONFIG_DATABASE_SSL_MODE_UNSAFE/u,
  );
  assert.throws(
    () =>
      loadApiConfig({
        ...validEnvironment,
        DATABASE_SSL_MODE: 'verify-full',
        DATABASE_URL: `${validEnvironment.DATABASE_URL}?sslmode=require`,
      }),
    /P019_CONFIG_DATABASE_URL_INVALID/u,
  );
});

test('falha fechado quando a configuração Auth0 está ausente ou insegura', () => {
  const missing: Record<string, string> = { ...validEnvironment };
  delete missing['AUTH0_AUDIENCE'];
  assert.throws(() => loadApiConfig(missing), /P020_CONFIG_AUTH0_AUDIENCE_MISSING/u);
  assert.throws(
    () =>
      loadApiConfig({ ...validEnvironment, AUTH0_ISSUER_BASE_URL: 'http://auth.example.invalid/' }),
    /P020_CONFIG_AUTH0_ISSUER_INVALID/u,
  );
});
