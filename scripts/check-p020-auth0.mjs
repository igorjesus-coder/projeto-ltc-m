import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const P020_AUTH0_CONTRACT = 'ltcm.p020.auth0-authentication-session.v1';

const REQUIRED_FILES = [
  '.env.example',
  'apps/web/package.json',
  'apps/web/src/app/environment.ts',
  'apps/web/src/app/routes.tsx',
  'apps/web/src/app/App.tsx',
  'apps/web/src/main.tsx',
  'apps/web/src/auth/ProtectedRoute.tsx',
  'apps/web/src/auth/api-client.ts',
  'apps/api/package.json',
  'apps/api/src/app.module.ts',
  'apps/api/src/config/api-config.ts',
  'apps/api/src/auth/auth.module.ts',
  'apps/api/src/auth/auth.guard.ts',
  'apps/api/src/auth/auth.controller.ts',
  'apps/api/src/auth/token-verifier.ts',
  'apps/api/test/auth.test.ts',
  'docs/auth/p020-auth0-authentication-session.md',
  'scripts/check-p020-browser-bundle.mjs',
];

function read(root, relativePath) {
  const filename = path.join(root, relativePath);
  return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
  });
}

function parseJson(text, code, issues) {
  try {
    return JSON.parse(text);
  } catch {
    issues.push(code);
    return {};
  }
}

export function checkP020Auth0(root = process.cwd(), { overrides = {}, migrationNames } = {}) {
  const issues = [];
  const source = (relativePath) => {
    if (Object.hasOwn(overrides, relativePath)) return overrides[relativePath];
    return read(root, relativePath);
  };

  for (const relativePath of REQUIRED_FILES) {
    if (source(relativePath) === null) issues.push(`P020_REQUIRED_FILE_MISSING:${relativePath}`);
  }

  const webPackage = parseJson(
    source('apps/web/package.json') ?? '',
    'P020_WEB_PACKAGE_INVALID',
    issues,
  );
  const apiPackage = parseJson(
    source('apps/api/package.json') ?? '',
    'P020_API_PACKAGE_INVALID',
    issues,
  );
  if (webPackage.dependencies?.['@auth0/auth0-react'] !== '2.24.1') {
    issues.push('P020_AUTH0_REACT_DEPENDENCY_INVALID');
  }
  if (apiPackage.dependencies?.jose !== '6.2.10') issues.push('P020_JOSE_DEPENDENCY_INVALID');

  const rootPackage = parseJson(source('package.json') ?? '', 'P020_ROOT_PACKAGE_INVALID', issues);
  for (const script of ['p020:check', 'p020:acceptance', 'test:p020:static']) {
    if (!rootPackage.scripts?.[script]) issues.push(`P020_SCRIPT_MISSING:${script}`);
  }

  const contract = source('docs/auth/p020-auth0-authentication-session.md') ?? '';
  for (const marker of [
    P020_AUTH0_CONTRACT,
    'Authorization Code + PKCE',
    'AUTH0_ISSUER_BASE_URL',
    'AUTH0_AUDIENCE',
    'RS256',
    'JWKS',
    'GET /auth/me',
    'Supabase Auth',
  ]) {
    if (!contract.includes(marker)) issues.push(`P020_CONTRACT_MARKER_MISSING:${marker}`);
  }

  const webSource = walk(path.join(root, 'apps', 'web', 'src'))
    .filter((filename) => /\.(?:ts|tsx)$/u.test(filename) && !/\.test\.(?:ts|tsx)$/u.test(filename))
    .map((filename) => {
      const relativePath = path.relative(root, filename).replaceAll(path.sep, '/');
      return source(relativePath) ?? '';
    })
    .join('\n');
  const apiSource = walk(path.join(root, 'apps', 'api', 'src'))
    .filter((filename) => /\.(?:ts|tsx)$/u.test(filename))
    .map((filename) => {
      const relativePath = path.relative(root, filename).replaceAll(path.sep, '/');
      return source(relativePath) ?? '';
    })
    .join('\n');

  for (const [code, pattern] of [
    ['P020_WEB_SUPABASE_AUTH_FOUND', /supabase-js|Supabase Auth|createClient/u],
    [
      'P020_WEB_SECRET_FOUND',
      /import\.meta\.env\.[A-Z0-9_]*(?:DATABASE|PASSWORD|SECRET|TOKEN|SERVICE_ROLE|PRIVATE_KEY)|(?:localStorage|sessionStorage)/u,
    ],
    ['P020_WEB_PROVIDER_MISSING', /Auth0Provider/u],
    ['P020_WEB_PKCE_CONFIG_MISSING', /cacheLocation="memory"/u],
    ['P020_WEB_API_BEARER_MISSING', /Authorization: `Bearer \$\{token\}`/u],
  ]) {
    if (
      code.startsWith('P020_WEB_') && code.includes('FOUND')
        ? pattern.test(webSource)
        : !pattern.test(webSource)
    ) {
      issues.push(code);
    }
  }

  for (const [code, pattern] of [
    [
      'P020_API_SUPABASE_FOUND',
      /supabase-js|Supabase Auth|\bsupabase(?:Client)?\b[\s\S]{0,80}\bcreateClient\b|\bcreateClient\b[\s\S]{0,80}\bsupabase(?:Client)?\b/u,
    ],
    ['P020_API_JWT_VERIFY_MISSING', /jwtVerify/u],
    ['P020_API_JWKS_MISSING', /createRemoteJWKSet/u],
    ['P020_API_ALGORITHM_MISSING', /RS256/u],
    ['P020_API_ISSUER_MISSING', /issuer:/u],
    ['P020_API_AUDIENCE_MISSING', /audience:/u],
    ['P020_API_ENDPOINT_MISSING', /@Controller\('auth'\)|@Get\('me'\)/u],
  ]) {
    if (code.endsWith('_FOUND') ? pattern.test(apiSource) : !pattern.test(apiSource))
      issues.push(code);
  }

  const availableMigrationNames =
    migrationNames ??
    (fs.existsSync(path.join(root, 'supabase', 'migrations'))
      ? fs
          .readdirSync(path.join(root, 'supabase', 'migrations'))
          .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name))
      : []);
  if (availableMigrationNames.length < 14) {
    issues.push(`P020_MIGRATION_BASELINE_INCOMPLETE:${availableMigrationNames.length}`);
  }

  return [...new Set(issues)].sort();
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const issues = checkP020Auth0(root);
  if (issues.length) {
    process.stderr.write(
      `P020 Auth0 inválido:\n${issues.map((issue) => `- ${issue}`).join('\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`P020 válido: ${P020_AUTH0_CONTRACT}, Auth0/JWKS, sem Supabase Auth\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
