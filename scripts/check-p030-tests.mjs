import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(...parts) {
  return readFile(path.join(root, ...parts), 'utf8');
}

export function scanP030Sources(input) {
  const issues = [];
  const financialSource = input.financial.replace(/\s+/gu, ' ');
  const required = [
    ['financial contract', input.types, 'ltcm.p030.balance-distribution-validations.v1'],
    ['financial read model', input.types, 'contractValue'],
    ['financial summary query', input.service, 'readFinancialSummary'],
    ['posted actual source', input.service, 'financial_actual_events'],
    ['posted actual filter', input.service, "status = 'posted'"],
    ['draft planned source', input.service, 'financial_plan_lines'],
    ['draft status guard', input.service, 'versionStatus'],
    ['currency fail closed', input.service, 'P030_CURRENCY_MISMATCH'],
    ['financial formula', financialSource, 'contractValue - actualPosted - plannedDraft'],
    ['excess rule', input.financial, 'rawBalance < 0n'],
    ['exact cents parser', input.service, 'parseFinancialCents'],
    ['transaction boundary', input.service, 'actorTransaction'],
    ['optimistic revision', input.service, 'content_revision'],
    ['justification reuse', input.service, 'payload.justification'],
    ['override error', input.service, 'P030_BALANCE_OVERRIDE_REQUIRED'],
    ['override capability', input.controller, 'forecast:override_balance'],
    ['capability snapshot', input.auth, 'forecast:override_balance'],
    ['web distribution', input.web, 'distributeBalance'],
    ['percentage scale', input.web, 'P030_PERCENT_TOTAL'],
    ['web exact arithmetic', input.web, 'BigInt'],
    ['destination limit', input.web, 'P030_MAX_DESTINATIONS'],
    ['existing value addition', input.web, 'addDistributionToValues'],
    ['residual order', input.web, 'itemId.localeCompare'],
    ['selection control', input.page, 'selectedCells'],
    ['distribution action', input.page, 'Distribuir saldo'],
    ['formula tests', input.financialTests, "excess.rawBalance, '-100.00'"],
    ['residual tests', input.webTests, '33.3333'],
    ['authorization tests', input.authTests, 'forecast:override_balance'],
    ['service tests', input.apiTests, 'P030 bloqueia excesso'],
    ['replacement test', input.apiTests, 'replacement semantics'],
    ['aggregate overflow', input.apiTests, 'AGGREGATE_OVERFLOW'],
    ['reduce excess test', input.apiTests, 'reduzir excesso'],
    ['PostgreSQL integration', input.postgres, 'P030 PostgreSQL'],
    ['atomic rollback assertion', input.postgres, 'unchanged'],
    ['audit evidence', input.postgres, 'audit_log'],
    ['stale evidence', input.postgres, 'P029_VERSION_CONFLICT'],
    ['protected evidence', input.postgres, 'monthly_plan_cells'],
    ['runtime RLS role', input.postgres, 'set local role ltc_m_runtime'],
    ['CI PostgreSQL invocation', input.workflow, 'LTCM_P030_INTEGRATION'],
    ['decision DEC-01', input.documentation, 'P030-D01-DEC-01'],
    ['decision DEC-02', input.documentation, 'P030-D01-DEC-02'],
    ['decision DEC-03', input.documentation, 'P030-D01-DEC-03'],
    ['decision DEC-04', input.documentation, 'P030-D01-DEC-04'],
    ['decision DEC-05', input.documentation, 'P030-D01-DEC-05'],
    ['no FX', input.documentation, 'P030_CURRENCY_MISMATCH'],
  ];
  for (const [label, source, token] of required) {
    if (!source.includes(token)) issues.push(`${label} ausente`);
  }
  const editorCapabilities = input.auth.match(/editor:\s*\[[\s\S]*?\n\s*\],/u)?.[0] ?? '';
  const adminCapabilities = input.auth.match(/admin:\s*\[[\s\S]*?\n\s*\],/u)?.[0] ?? '';
  if (!adminCapabilities.includes('forecast:override_balance'))
    issues.push('override não está restrito ao admin');
  if (editorCapabilities.includes('forecast:override_balance'))
    issues.push('editor recebeu override indevido');
  if (/\bdelete\s+from\b/iu.test(input.service)) issues.push('P030 contém DELETE');
  if (/\b(?:insert|update)\s+into\s+ltc_m\.financial_actual_events\b/iu.test(input.service))
    issues.push('P030 altera realized');
  if (input.migrationFiles.some((file) => /p030|balance-distribution/iu.test(file)))
    issues.push('migration P030 indevida');
  return issues;
}

export async function checkP030() {
  return scanP030Sources({
    types: await read('apps', 'api', 'src', 'planning', 'planning.types.ts'),
    service: await read('apps', 'api', 'src', 'planning', 'planning.service.ts'),
    financial: await read('apps', 'api', 'src', 'planning', 'financial.ts'),
    controller: await read('apps', 'api', 'src', 'planning', 'planning.controller.ts'),
    auth: await read('apps', 'api', 'src', 'auth', 'authorization.ts'),
    web: await read('apps', 'web', 'src', 'planning', 'planning.ts'),
    page: await read('apps', 'web', 'src', 'routes', 'MonthlyPlanningPage.tsx'),
    financialTests: await read('apps', 'api', 'test', 'financial.test.ts'),
    webTests: await read('apps', 'web', 'src', 'planning', 'planning.test.ts'),
    authTests: await read('apps', 'api', 'test', 'authorization.test.ts'),
    apiTests: await read('apps', 'api', 'test', 'planning.test.ts'),
    postgres: await read('scripts', 'p030-postgres.integration.test.mjs'),
    workflow: await read('.github', 'workflows', 'ltcm-postgres-validation.yml'),
    documentation: await read('docs', 'planning', 'p030-balance-distribution-validations.md'),
    migrationFiles: await readdir(path.join(root, 'supabase', 'migrations')),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const issues = await checkP030();
  if (issues.length) {
    console.error(`P030 inválido:\n- ${issues.join('\n- ')}`);
    process.exitCode = 1;
  } else console.log('P030 válido: saldo, distribuição, override e evidências protegidos');
}
