import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export const P016_MIGRATION = '20260825160000_add_p016_tableau_analytical_views.sql';

export const P016_VIEWS = [
  'v_tableau_portfolio_overview',
  'v_tableau_project_overview',
  'v_tableau_project_items',
  'v_tableau_financial_monthly',
  'v_tableau_s_curve_portfolio',
  'v_tableau_s_curve_project',
  'v_tableau_data_quality',
  'v_tableau_plan_versions',
  'v_tableau_source_provenance',
];

export function scanP016Sources({
  migration,
  documentation,
  rootPackage,
  workflow,
  runner,
  tests,
}) {
  const issues = [];
  const createdViews = [
    ...migration.matchAll(/\bcreate\s+view\s+ltc_m\.([a-z_][a-z0-9_]*)/giu),
  ].map((match) => match[1]);
  if (createdViews.length !== P016_VIEWS.length) {
    issues.push(`quantidade de views P016 divergente: ${createdViews.length}`);
  }
  for (const view of P016_VIEWS) {
    if (!createdViews.includes(view)) issues.push(`view P016 ausente: ${view}`);
  }
  if ((migration.match(/security_invoker\s*=\s*true/giu) ?? []).length !== P016_VIEWS.length) {
    issues.push('todas as views devem usar security_invoker=true');
  }
  if ((migration.match(/security_barrier\s*=\s*true/giu) ?? []).length !== P016_VIEWS.length) {
    issues.push('todas as views devem usar security_barrier=true');
  }
  for (const token of [
    "'ltcm.p016.analytics.v1'",
    "'ltcm.p015.reconciliation-report.v1'",
    "'ACTUAL_STATUS_UNRESOLVED'",
    "'UNSUPPORTED_COMPARISON'",
    'false as p014_derived',
    'rows between unbounded preceding and current row',
    'items.item_total is distinct from projects.contract_value',
    'count(distinct monthly_plan_import_executions.source_artifact_id)',
  ]) {
    if (!migration.toLowerCase().includes(token.toLowerCase())) {
      issues.push(`invariante SQL P016 ausente: ${token}`);
    }
  }
  for (const [label, pattern] of [
    ['tabela', /\bcreate\s+table\b/iu],
    ['função', /\bcreate\s+(?:or\s+replace\s+)?function\b/iu],
    ['policy', /\bcreate\s+policy\b/iu],
    ['DML', /\b(?:insert\s+into|update\s+ltc_m\.|delete\s+from)\b/iu],
    ['SECURITY DEFINER', /\bsecurity\s+definer\b/iu],
    ['RANGE window', /\brange\s+between\b/iu],
    ['alocação', /\b(?:generate_series|allocation|allocate)\b/iu],
    ['float financeiro', /\b(?:real|float|double\s+precision|money)\b/iu],
  ]) {
    if (pattern.test(migration)) issues.push(`migration P016 contém ${label}`);
  }
  if (/coalesce\s*\([^)]*billing_actual[^)]*amount/iu.test(migration)) {
    issues.push('realizado ausente não pode sofrer COALESCE para zero');
  }
  for (const token of [
    'ltcm.p016.analytics.v1',
    '2800460.18',
    'security_invoker',
    'blank',
    'explicit_zero',
    'P014',
    'P015',
    'CURRENT_VERSION_RULE_UNDEFINED',
    '1:N',
    'não aditivo',
  ]) {
    if (!documentation.includes(token)) issues.push(`documentação P016 ausente: ${token}`);
  }
  for (const token of ['"p016:check"', '"test:p016:static"', '"test:p016:postgres"']) {
    if (!rootPackage.includes(token)) issues.push(`script raiz P016 ausente: ${token}`);
  }
  if (
    !rootPackage.includes('npm run p016:check') ||
    !rootPackage.includes('npm run test:p016:static')
  ) {
    issues.push('P016 não integra check/test raiz');
  }
  if (!workflow.includes("'docs/analytics/**'"))
    issues.push('workflow não monitora docs analíticos');
  for (const token of [
    "runStage('p016_postgres'",
    "LTCM_P016_INTEGRATION: '1'",
    'postgres-tableau-analytics.integration.test.js',
    'p016_postgres: false',
    'evidence.regressions.p016_postgres = true',
  ]) {
    if (!runner.includes(token)) issues.push(`runner CI P016 ausente: ${token}`);
  }
  for (const token of [
    '2800460.18',
    'security_invoker',
    'project_month_actual_available',
    'transaction read only',
    'advisory',
  ]) {
    if (!tests.toLowerCase().includes(token.toLowerCase())) {
      issues.push(`teste PostgreSQL P016 ausente: ${token}`);
    }
  }
  return [...new Set(issues)];
}

async function official() {
  return {
    migration: await readFile(`${root}/supabase/migrations/${P016_MIGRATION}`, 'utf8'),
    documentation: await readFile(`${root}/docs/analytics/p016-tableau-views.md`, 'utf8'),
    rootPackage: await readFile(`${root}/package.json`, 'utf8'),
    workflow: await readFile(`${root}/.github/workflows/ltcm-postgres-validation.yml`, 'utf8'),
    runner: await readFile(`${root}/scripts/run-postgres-ci-validation.mjs`, 'utf8'),
    tests: await readFile(
      `${root}/tools/ltcm-normalizer/test/postgres-tableau-analytics.integration.test.ts`,
      'utf8',
    ),
  };
}

async function main() {
  const issues = scanP016Sources(await official());
  if (issues.length > 0) {
    console.error(`P016 inválido:\n- ${issues.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    'P016 válido: 9 views Tableau security-invoker com grão, versão, RLS e no-allocation protegidos',
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
