import assert from 'node:assert/strict';
import test from 'node:test';

import { formatIssues, parseEnvText, validateEntries } from './check-env.mjs';

const validFrontend = new Map([
  ['VITE_APP_ENV', 'development'],
  ['VITE_API_BASE_URL', 'http://localhost:3000'],
  ['VITE_AUTH0_DOMAIN', 'localhost'],
  ['VITE_AUTH0_CLIENT_ID', 'public-client'],
  ['VITE_AUTH0_AUDIENCE', 'local-api'],
]);

test('detecta variável obrigatória ausente sem exibir outros valores', () => {
  const entries = new Map(validFrontend);
  entries.delete('VITE_AUTH0_CLIENT_ID');

  const issues = validateEntries(entries, { scope: 'frontend' });
  const output = formatIssues(issues);

  assert.match(output, /VITE_AUTH0_CLIENT_ID/);
  assert.doesNotMatch(output, /public-client/);
});

test('rejeita DATABASE_URL no arquivo do frontend', () => {
  const entries = new Map(validFrontend);
  entries.set('DATABASE_URL', 'sensitive-value');

  const issues = validateEntries(entries, { scope: 'frontend' });

  assert.ok(issues.some((issue) => issue.name === 'DATABASE_URL'));
  assert.doesNotMatch(formatIssues(issues), /sensitive-value/);
});

test('rejeita variável sensível com prefixo VITE_', () => {
  const entries = new Map(validFrontend);
  entries.set('VITE_DATABASE_URL', 'sensitive-value');
  entries.set('VITE_PORT', '3000');

  const issues = validateEntries(entries, { scope: 'frontend' });

  assert.ok(issues.some((issue) => issue.name === 'VITE_DATABASE_URL'));
  assert.ok(issues.some((issue) => issue.name === 'VITE_PORT'));
});

test('rejeita URL pública da API e ambiente inválidos', () => {
  const entries = new Map(validFrontend);
  entries.set('VITE_API_BASE_URL', 'not-a-url');
  entries.set('VITE_APP_ENV', 'unknown');

  const issues = validateEntries(entries, { scope: 'frontend' });
  const names = issues.map((issue) => issue.name);

  assert.ok(names.includes('VITE_API_BASE_URL'));
  assert.ok(names.includes('VITE_APP_ENV'));
});

test('aceita o contrato de exemplo com valores secretos vazios', () => {
  const { entries, duplicates } = parseEnvText(`
VITE_APP_ENV=local
VITE_API_BASE_URL=http://localhost:3000
VITE_AUTH0_DOMAIN=
VITE_AUTH0_CLIENT_ID=
VITE_AUTH0_AUDIENCE=
NODE_ENV=development
PORT=3000
CORS_ALLOWED_ORIGINS=http://localhost:5173
AUTH0_DOMAIN=
AUTH0_AUDIENCE=
DATABASE_URL=
DATABASE_SSL_MODE=disable
`);

  const issues = validateEntries(entries, { scope: 'all', allowEmpty: true, duplicates });

  assert.deepEqual(issues, []);
});

test('rejeita modo TLS inválido e exige verify-full em produção', () => {
  const backend = new Map([
    ['NODE_ENV', 'production'],
    ['PORT', '3000'],
    ['CORS_ALLOWED_ORIGINS', 'https://web.example.invalid'],
    ['AUTH0_DOMAIN', 'tenant.example.invalid'],
    ['AUTH0_AUDIENCE', 'ltcm-api'],
    ['DATABASE_URL', 'postgresql://synthetic:synthetic@localhost/ltcm_test'],
    ['DATABASE_SSL_MODE', 'disable'],
  ]);
  assert.ok(
    validateEntries(backend, { scope: 'backend' }).some(
      (issue) => issue.name === 'DATABASE_SSL_MODE',
    ),
  );
  backend.set('DATABASE_SSL_MODE', 'verify-full');
  assert.deepEqual(validateEntries(backend, { scope: 'backend' }), []);
});
