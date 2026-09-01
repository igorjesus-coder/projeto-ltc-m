import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const P018_SCAFFOLD_CONTRACT = 'ltcm.p018.crud-scaffold.v1';

const REQUIRED_FILES = [
  '.env.example',
  'apps/web/index.html',
  'apps/web/package.json',
  'apps/web/src/app/App.tsx',
  'apps/web/src/app/App.test.tsx',
  'apps/web/src/app/AppErrorBoundary.tsx',
  'apps/web/src/app/app-config.ts',
  'apps/web/src/app/environment.ts',
  'apps/web/src/app/environment.test.ts',
  'apps/web/src/app/routes.tsx',
  'apps/web/src/layouts/AppShell.tsx',
  'apps/web/src/main.tsx',
  'apps/web/src/routes/HomePage.tsx',
  'apps/web/src/routes/NotFoundPage.tsx',
  'apps/web/src/styles/global.css',
  'apps/web/tsconfig.app.json',
  'docs/frontend/p018-crud-scaffold.md',
  '.github/workflows/ltcm-postgres-validation.yml',
  'package.json',
];

const SOURCE_FILES = REQUIRED_FILES.filter((name) => name.startsWith('apps/web/src/'));

function parseJson(text, code, issues) {
  try {
    return JSON.parse(text);
  } catch {
    issues.push(code);
    return {};
  }
}

export function checkP018Scaffold(
  rootDirectory = process.cwd(),
  { overrides = {}, migrationNames } = {},
) {
  const issues = [];
  const source = (relativePath) => {
    if (Object.hasOwn(overrides, relativePath)) return overrides[relativePath];
    const filename = path.join(rootDirectory, relativePath);
    return fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : null;
  };

  for (const relativePath of REQUIRED_FILES) {
    if (source(relativePath) === null) issues.push(`P018_REQUIRED_FILE_MISSING:${relativePath}`);
  }

  const rootPackage = parseJson(source('package.json') ?? '', 'P018_ROOT_PACKAGE_INVALID', issues);
  const webPackage = parseJson(
    source('apps/web/package.json') ?? '',
    'P018_WEB_PACKAGE_INVALID',
    issues,
  );
  const tsconfig = parseJson(
    source('apps/web/tsconfig.app.json') ?? '',
    'P018_TSCONFIG_INVALID',
    issues,
  );

  for (const script of ['p018:check', 'p018:acceptance', 'test:p018:static']) {
    if (!rootPackage.scripts?.[script]) issues.push(`P018_SCRIPT_MISSING:${script}`);
  }
  const acceptance = rootPackage.scripts?.['p018:acceptance'] ?? '';
  for (const command of [
    'p018:check',
    'test:p018:static',
    'lint --workspace @ltcm/web',
    'typecheck --workspace @ltcm/web',
    'test --workspace @ltcm/web',
    'build --workspace @ltcm/web',
  ]) {
    if (!acceptance.includes(command)) issues.push(`P018_ACCEPTANCE_COMMAND_MISSING:${command}`);
  }
  if (!rootPackage.scripts?.check?.includes('p018:check')) issues.push('P018_ROOT_CHECK_MISSING');
  if (!rootPackage.scripts?.test?.includes('test:p018:static')) {
    issues.push('P018_ROOT_TEST_MISSING');
  }
  if (webPackage.dependencies?.['@supabase/supabase-js']) issues.push('P018_P019_DEPENDENCY_FOUND');

  for (const option of [
    'strict',
    'noUncheckedIndexedAccess',
    'exactOptionalPropertyTypes',
    'noEmit',
  ]) {
    if (tsconfig.compilerOptions?.[option] !== true)
      issues.push(`P018_TYPESCRIPT_OPTION_MISSING:${option}`);
  }

  const appConfig = source('apps/web/src/app/app-config.ts') ?? '';
  if (!appConfig.includes(P018_SCAFFOLD_CONTRACT)) issues.push('P018_CONTRACT_MISSING');

  const main = source('apps/web/src/main.tsx') ?? '';
  if (!main.includes('AppErrorBoundary') || !main.includes('./styles/global.css')) {
    issues.push('P018_ENTRYPOINT_INCOMPLETE');
  }

  const shell = source('apps/web/src/layouts/AppShell.tsx') ?? '';
  for (const marker of [
    '<header',
    '<nav aria-label="Navegação principal"',
    '<main id="main-content"',
    '<footer',
    'Pular para o conteúdo',
  ]) {
    if (!shell.includes(marker)) issues.push(`P018_LANDMARK_MISSING:${marker}`);
  }

  const routes = source('apps/web/src/app/routes.tsx') ?? '';
  if (!routes.includes("id: 'home'") || !routes.includes("id: 'not-found'")) {
    issues.push('P018_ROUTE_BASELINE_INCOMPLETE');
  }

  const appTest = source('apps/web/src/app/App.test.tsx') ?? '';
  for (const marker of ['Navegação principal', 'main-content', 'Página não encontrada']) {
    if (!appTest.includes(marker)) issues.push(`P018_ACCESSIBILITY_TEST_MISSING:${marker}`);
  }

  const environment = source('apps/web/src/app/environment.ts') ?? '';
  for (const category of ['PUBLIC_CLIENT_SAFE', 'SERVER_ONLY', 'NOT_ALLOWED_IN_BROWSER']) {
    if (!environment.includes(category)) issues.push(`P018_ENV_CATEGORY_MISSING:${category}`);
  }
  if (!environment.includes('P018_SENSITIVE_BROWSER_ENV_REJECTED')) {
    issues.push('P018_ENV_FAIL_CLOSED_MISSING');
  }

  const html = source('apps/web/index.html') ?? '';
  if (!/<html\s+lang="pt-BR">/u.test(html)) issues.push('P018_HTML_LANG_MISSING');
  if (!html.includes('name="viewport"') || !html.includes('<title>LTC-M')) {
    issues.push('P018_HTML_BASELINE_INCOMPLETE');
  }

  const styles = source('apps/web/src/styles/global.css') ?? '';
  for (const marker of [':focus-visible', '.skip-link', 'min-width: 320px', '@media']) {
    if (!styles.includes(marker)) issues.push(`P018_STYLE_BASELINE_MISSING:${marker}`);
  }

  const docs = source('docs/frontend/p018-crud-scaffold.md') ?? '';
  for (const marker of [
    P018_SCAFFOLD_CONTRACT,
    'PUBLIC_CLIENT_SAFE',
    'SERVER_ONLY',
    'NOT_ALLOWED_IN_BROWSER',
    'P019',
  ]) {
    if (!docs.includes(marker)) issues.push(`P018_DOCUMENTATION_INCOMPLETE:${marker}`);
  }

  const workflow = source('.github/workflows/ltcm-postgres-validation.yml') ?? '';
  if (!workflow.includes("'apps/web/**'") || !workflow.includes('npm run p018:acceptance')) {
    issues.push('P018_CI_STAGE_MISSING');
  }

  const sourceBundle = SOURCE_FILES.map((name) => source(name) ?? '').join('\n');
  for (const [code, pattern] of [
    ['P018_DANGEROUS_HTML_FOUND', /dangerouslySetInnerHTML/u],
    ['P018_EVAL_FOUND', /\beval\s*\(/u],
    ['P018_DYNAMIC_FUNCTION_FOUND', /new\s+Function\s*\(/u],
    [
      'P018_SENSITIVE_VITE_ACCESS_FOUND',
      /import\.meta\.env\.VITE_.*(?:DATABASE|PASSWORD|SECRET|TOKEN|SERVICE_ROLE|PRIVATE_KEY)/u,
    ],
    ['P018_SUPABASE_CLIENT_FOUND', /@supabase\/supabase-js/u],
  ]) {
    if (pattern.test(sourceBundle)) issues.push(code);
  }

  const migrationDirectory = path.join(rootDirectory, 'supabase', 'migrations');
  const availableMigrationNames =
    migrationNames ??
    (fs.existsSync(migrationDirectory)
      ? fs.readdirSync(migrationDirectory).filter((name) => /^\d{14}_[a-z0-9_]+\.sql$/u.test(name))
      : []);
  if (availableMigrationNames.length < 14) {
    issues.push(`P018_MIGRATION_BASELINE_INCOMPLETE:${availableMigrationNames.length}`);
  }

  return [...new Set(issues)].sort();
}

function main() {
  const rootDirectory = fileURLToPath(new URL('..', import.meta.url));
  const issues = checkP018Scaffold(rootDirectory);
  if (issues.length > 0) {
    console.error(`P018 scaffold inválido:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `P018 scaffold válido: ${P018_SCAFFOLD_CONTRACT}, migration baseline preserved (minimum 14), sem P019`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
