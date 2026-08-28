import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const P021_AUTHORIZATION_CONTRACT = 'ltcm.p021.authorization-ui.v1';

const REQUIRED_FILES = [
  'apps/api/src/auth/authorization.ts',
  'apps/api/src/auth/auth.controller.ts',
  'apps/api/src/auth/auth.guard.ts',
  'apps/web/src/auth/authorization.tsx',
  'apps/web/src/auth/api-client.ts',
  'supabase/migrations/20260828100000_add_p021_authorization_approver.sql',
  'docs/auth/p021-authorization-ui-permissions.md',
  'apps/api/test/authorization.test.ts',
  'apps/web/src/auth/authorization.test.tsx',
  'database/audit/ltcm-p008-rls-tests.sql',
];

const ROLES = ['viewer', 'editor', 'approver', 'admin'];
const UNSUPPORTED_CAPABILITIES = ['physical_delete', 'archive', 'unlock_direct'];

function read(root, relativePath) {
  const filename = path.join(root, relativePath);
  return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
}

function parseJson(text, code, issues) {
  try {
    return JSON.parse(text);
  } catch {
    issues.push(code);
    return {};
  }
}

export function checkP021Authorization(root = process.cwd(), { overrides = {} } = {}) {
  const issues = [];
  const source = (relativePath) =>
    Object.hasOwn(overrides, relativePath) ? overrides[relativePath] : read(root, relativePath);

  for (const relativePath of REQUIRED_FILES) {
    if (source(relativePath) === null) issues.push(`P021_REQUIRED_FILE_MISSING:${relativePath}`);
  }

  const rootPackage = parseJson(source('package.json') ?? '', 'P021_ROOT_PACKAGE_INVALID', issues);
  for (const script of ['p021:check', 'p021:acceptance', 'test:p021:static']) {
    if (!rootPackage.scripts?.[script]) issues.push(`P021_SCRIPT_MISSING:${script}`);
  }

  const contract = source('docs/auth/p021-authorization-ui-permissions.md') ?? '';
  for (const marker of [
    P021_AUTHORIZATION_CONTRACT,
    'Auth0',
    'app_users.auth_subject',
    'viewer',
    'editor',
    'approver',
    'admin',
    'Fail-closed',
    'RLS',
    'GET /auth/me',
  ]) {
    if (!contract.includes(marker)) issues.push(`P021_CONTRACT_MARKER_MISSING:${marker}`);
  }

  const apiSource = [
    source('apps/api/src/auth/authorization.ts') ?? '',
    source('apps/api/src/auth/auth.controller.ts') ?? '',
    source('apps/api/src/auth/auth.guard.ts') ?? '',
  ].join('\n');
  const webSource = [
    source('apps/web/src/auth/authorization.tsx') ?? '',
    source('apps/web/src/auth/api-client.ts') ?? '',
  ].join('\n');
  const migration =
    source('supabase/migrations/20260828100000_add_p021_authorization_approver.sql') ?? '';
  const databaseTest = source('database/audit/ltcm-p008-rls-tests.sql') ?? '';

  for (const role of ROLES) {
    if (!apiSource.includes(`'${role}'`)) issues.push(`P021_ROLE_MISSING:${role}`);
  }
  for (const marker of [
    'AuthorizationGuard',
    'RequireCapabilities',
    'resolve_authorization',
    'setActorContext',
    "@Get('me')",
    'P021_AUTHORIZATION_DENIED',
  ]) {
    if (!apiSource.includes(marker)) issues.push(`P021_API_MARKER_MISSING:${marker}`);
  }
  for (const marker of [
    'AuthorizationProvider',
    'PermissionGate',
    'AuthorizationRoute',
    '/auth/me',
    'AuthorizationDeniedError',
  ]) {
    if (!webSource.includes(marker)) issues.push(`P021_WEB_MARKER_MISSING:${marker}`);
  }

  if (
    /supabase-js|createClient|localStorage|sessionStorage|VITE_.*(?:SECRET|TOKEN|PASSWORD)/iu.test(
      webSource,
    )
  ) {
    issues.push('P021_WEB_BOUNDARY_VIOLATION');
  }
  if (!/Authorization:\s*`Bearer \$\{token\}`/u.test(webSource)) {
    issues.push('P021_WEB_BEARER_MISSING');
  }
  if (!/setActorContext\(/u.test(apiSource) || !/authSubject/u.test(apiSource)) {
    issues.push('P021_ACTOR_CONTEXT_BINDING_MISSING');
  }
  if (!/app_users\.auth_subject|auth_subject/u.test(apiSource + migration)) {
    issues.push('P021_SUBJECT_RESOLUTION_MISSING');
  }
  if (
    !/active\s*=\s*true/iu.test(migration) ||
    !/ForbiddenException|P021_AUTHORIZATION_DENIED/u.test(apiSource)
  ) {
    issues.push('P021_FAIL_CLOSED_MISSING');
  }
  if (!/approver/iu.test(migration) || !/alter\s+policy/iu.test(migration)) {
    issues.push('P021_APPROVER_DATABASE_SUPPORT_MISSING');
  }
  if (/create\s+policy[\s\S]*\bdelete\b/iu.test(migration) || /delete\s+from/iu.test(migration)) {
    issues.push('P021_PHYSICAL_DELETE_PATH_FOUND');
  }
  if (!/\bdo\s+\$approver\$/iu.test(databaseTest) || !/P021 falhou/iu.test(databaseTest)) {
    issues.push('P021_DATABASE_TEST_MISSING');
  }
  for (const capability of UNSUPPORTED_CAPABILITIES) {
    const roleBlock = apiSource.match(/ROLE_CAPABILITIES[\s\S]*?;\n/u)?.[0] ?? '';
    if (roleBlock.includes(`'${capability}'`))
      issues.push(`P021_UNSUPPORTED_CAPABILITY_GRANTED:${capability}`);
  }

  return [...new Set(issues)].sort();
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const issues = checkP021Authorization(root);
  if (issues.length > 0) {
    console.error(`P021 Authorization inválido:\n- ${issues.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `P021 válido: ${P021_AUTHORIZATION_CONTRACT}, autorização server-side e UI fail-closed`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
