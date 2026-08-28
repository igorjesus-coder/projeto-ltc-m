import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const P019_SERVER_POSTGRES_CONTRACT = 'ltcm.p019.server-postgres-access.v1';

const REQUIRED_FILES = [
  'apps/api/package.json',
  'apps/api/tsconfig.json',
  'apps/api/src/app.module.ts',
  'apps/api/src/main.ts',
  'apps/api/src/config/api-config.ts',
  'apps/api/src/database/database.module.ts',
  'apps/api/src/database/database-pool.ts',
  'apps/api/src/database/database.service.ts',
  'apps/api/src/database/transaction.ts',
  'apps/api/src/database/generated/database.types.ts',
  'apps/api/test/api-config.test.ts',
  'apps/api/test/database.test.ts',
  'apps/api/test/database.integration.test.ts',
  'docs/backend/p019-server-postgres-access.md',
  'scripts/generate-p019-db-types.mjs',
  'scripts/generate-p019-db-types.test.mjs',
];

function walkFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(filename) : [filename];
  });
}

function source(root, relativePath) {
  const filename = path.join(root, relativePath);
  return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
}

export function checkP019ServerPostgres(root = process.cwd()) {
  const issues = [];
  for (const file of REQUIRED_FILES) {
    if (source(root, file) === null) issues.push(`P019_REQUIRED_FILE_MISSING:${file}`);
  }
  const apiPackageText = source(root, 'apps/api/package.json') ?? '{}';
  let apiPackage = {};
  try {
    apiPackage = JSON.parse(apiPackageText);
  } catch {
    issues.push('P019_API_PACKAGE_INVALID');
  }
  if (apiPackage.dependencies?.pg !== '8.23.0') issues.push('P019_PG_VERSION_UNEXPECTED');
  for (const forbidden of ['@supabase/supabase-js', 'prisma', 'drizzle-orm', 'typeorm', 'knex']) {
    if (apiPackage.dependencies?.[forbidden] || apiPackage.devDependencies?.[forbidden]) {
      issues.push(`P019_FORBIDDEN_DEPENDENCY:${forbidden}`);
    }
  }
  const transaction = source(root, 'apps/api/src/database/transaction.ts') ?? '';
  for (const marker of [
    'BEGIN',
    'COMMIT',
    'ROLLBACK',
    'ltc_m.set_actor_context',
    'client.release',
  ]) {
    if (!transaction.includes(marker)) issues.push(`P019_TRANSACTION_MARKER_MISSING:${marker}`);
  }
  const pool = source(root, 'apps/api/src/database/database-pool.ts') ?? '';
  for (const marker of ['rejectUnauthorized: true', 'pool.end()', 'statement_timeout']) {
    if (!pool.includes(marker)) issues.push(`P019_POOL_MARKER_MISSING:${marker}`);
  }
  const generated = source(root, 'apps/api/src/database/generated/database.types.ts') ?? '';
  for (const marker of [
    'GENERATED FILE — DO NOT EDIT',
    'PgNumeric = string',
    'PgBigInt = string',
  ]) {
    if (!generated.includes(marker)) issues.push(`P019_GENERATED_MARKER_MISSING:${marker}`);
  }
  const webFiles = walkFiles(path.join(root, 'apps', 'web', 'src')).filter((name) =>
    /\.(?:ts|tsx)$/u.test(name),
  );
  const webSource = webFiles.map((name) => fs.readFileSync(name, 'utf8')).join('\n');
  for (const [code, pattern] of [
    ['P019_BROWSER_PG_IMPORT', /from\s+['"]pg['"]/u],
    ['P019_BROWSER_API_IMPORT', /(?:@ltcm\/api|apps\/api|database\/generated)/u],
    ['P019_BROWSER_SUPABASE_CLIENT', /@supabase\/supabase-js/u],
    ['P019_BROWSER_DATABASE_ENV_ACCESS', /import\.meta\.env\.[A-Z0-9_]*DATABASE/u],
    ['P019_BROWSER_SERVICE_ROLE_ENV_ACCESS', /import\.meta\.env\.[A-Z0-9_]*SERVICE_ROLE/u],
  ]) {
    if (pattern.test(webSource)) issues.push(code);
  }
  const migrations = fs
    .readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name));
  if (migrations.length !== 14) issues.push(`P019_MIGRATION_COUNT_UNEXPECTED:${migrations.length}`);
  const docs = source(root, 'docs/backend/p019-server-postgres-access.md') ?? '';
  if (!docs.includes(P019_SERVER_POSTGRES_CONTRACT)) issues.push('P019_CONTRACT_MISSING');
  return [...new Set(issues)].sort();
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const issues = checkP019ServerPostgres(root);
  if (issues.length) {
    process.stderr.write(
      `P019 server PostgreSQL inválido:\n${issues.map((item) => `- ${item}`).join('\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `P019 válido: ${P019_SERVER_POSTGRES_CONTRACT}, pg server-only, 14 migrations\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
