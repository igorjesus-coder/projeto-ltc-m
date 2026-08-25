import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export function scanP015Sources({ engine, tests, documentation, rootPackage, normalizerPackage }) {
  const issues = [];
  const requiredEngine = [
    "'ltcm.p015.reconciliation.v1'",
    "'ltcm.p015.reconciliation-report.v1'",
    "'REALIZED_PROJECT_MISSING_COMPETENCE'",
    "'REALIZED_MONTH_MISSING_PROJECT'",
    "'GRAIN_MISMATCH'",
    'arbitrary_allocation_performed: false',
    'actual_events_manufactured: false',
    "database_access: 'none'",
    'transaction_read_only: true',
    'insert_count: 0',
    'update_count: 0',
    'delete_count: 0',
    'ddl_count: 0',
    'sha256Canonical(material)',
  ];
  for (const token of requiredEngine)
    if (!engine.includes(token)) issues.push(`engine token ausente: ${token}`);
  const requiredTests = [
    'dez evidências geram dez findings e zero actual events',
    'reordered',
    'untrusted-input',
    'untrusted-report',
    'cross-project-item',
  ];
  for (const token of requiredTests)
    if (!tests.includes(token)) issues.push(`teste P015 ausente: ${token}`);
  for (const token of [
    'SCHEMA_COMPLETE',
    'zero writes',
    'P014',
    'project + competence',
    '17 códigos',
  ])
    if (!documentation.includes(token)) issues.push(`documentação P015 ausente: ${token}`);
  if (!rootPackage.includes('"p015:check"') || !rootPackage.includes('"test:p015"'))
    issues.push('scripts raiz P015 ausentes');
  if (
    !rootPackage.includes('npm run p015:check') ||
    !/npm run test:p015(?:\s|&&)/u.test(rootPackage)
  )
    issues.push('P015 não integra check/test');
  if (!/"exports"\s*:\s*\{\s*\}/u.test(normalizerPackage))
    issues.push('normalizer publicou superfície P015 não aprovada');
  for (const [label, pattern] of [
    ['writer SQL', /\b(?:insert|update|delete|create|alter|drop)\s+(?:into\s+)?ltc_m\./iu],
    ['Pool genérico', /\b(?:Pool|PoolClient)\b/u],
    ['aleatoriedade', /\b(?:randomUUID|Math\.random)\b/u],
    ['tempo semântico', /\b(?:Date\.now|new Date)\b/u],
    ['acesso remoto', /\b(?:https?:\/\/|postgres(?:ql)?:\/\/|supabase|render\.com)\b/iu],
  ])
    if (pattern.test(engine)) issues.push(`engine contém ${label}`);
  return issues;
}

async function main() {
  const [engine, tests, documentation, rootPackage, normalizerPackage] = await Promise.all([
    readFile(`${root}/tools/ltcm-normalizer/src/reconciliation.ts`, 'utf8'),
    readFile(`${root}/tools/ltcm-normalizer/test/reconciliation.test.ts`, 'utf8'),
    readFile(`${root}/docs/reconciliation/p015-reconciliation.md`, 'utf8'),
    readFile(`${root}/package.json`, 'utf8'),
    readFile(`${root}/tools/ltcm-normalizer/package.json`, 'utf8'),
  ]);
  const issues = scanP015Sources({ engine, tests, documentation, rootPackage, normalizerPackage });
  if (issues.length > 0) {
    console.error(`P015 inválido:\n- ${issues.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    'P015 válido: reconciliação determinística read-only, proveniência e P014 fail-closed presentes',
  );
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1])
  await main();
