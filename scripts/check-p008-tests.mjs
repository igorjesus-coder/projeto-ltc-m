import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { stripSeedNoise } from './check-seeds.mjs';

const ALLOWED_MUTATION_TABLES = new Set([
  'ltc_m.app_users',
  'ltc_m.clients',
  'ltc_m.projects',
  'ltc_m.project_items',
  'ltc_m.plan_versions',
  'ltc_m.financial_plan_scopes',
  'ltc_m.financial_plan_lines',
  'ltc_m.financial_actual_events',
  'ltc_m.import_batches',
  'ltc_m.import_row_errors',
]);

const POLICY_INVENTORY_FIELDS = [
  'schemaname',
  'tablename',
  'policyname',
  'permissive',
  'roles',
  'cmd',
  'qual_md5',
  'with_check_md5',
];

const P013_POLICIES = new Set([
  'monthly_source_artifacts.monthly_source_artifacts_select_p013',
  'monthly_source_artifacts.monthly_source_artifacts_insert_p013',
  'monthly_plan_baselines.monthly_plan_baselines_select_p013',
  'monthly_plan_baselines.monthly_plan_baselines_insert_p013',
  'monthly_plan_import_executions.monthly_executions_select_p013',
  'monthly_plan_import_executions.monthly_executions_insert_p013',
  'monthly_plan_cells.monthly_plan_cells_select_p013',
  'monthly_plan_cells.monthly_plan_cells_insert_p013',
]);

const PROTECTED_TABLES = new Set([
  'app_users',
  'currencies',
  'units',
  'clients',
  'projects',
  'project_items',
  'plan_versions',
  'financial_plan_scopes',
  'financial_plan_lines',
  'financial_actual_events',
  'import_batches',
  'import_batch_sheets',
  'import_staging_rows',
  'import_row_errors',
  'audit_log',
  'monthly_source_artifacts',
  'monthly_plan_baselines',
  'monthly_plan_import_executions',
  'monthly_plan_cells',
]);

const REQUIRED_SCENARIOS = [
  ['atributos da runtime', /atributos seguros da role runtime ausentes/i],
  ['runtime sem ownership', /runtime recebeu ownership/i],
  ['runtime sem grants externos', /runtime recebeu grant direto em objeto externo/i],
  ['RLS e FORCE RLS', /inventário RLS\/FORCE divergente/i],
  ['policies exatas', /inventário de policies divergente/i],
  ['sem DELETE', /runtime recebeu privilégio de tabela proibido/i],
  ['allowlist de funções', /allowlist executável (?:contém|divergente)/i],
  ['current_actor_id na allowlist', /current_actor_id não está na allowlist/i],
  ['PUBLIC EXECUTE revogado', /PUBLIC ainda executa função/i],
  ['contexto ausente', /contexto ausente permitiu leitura/i],
  ['usuário inexistente', /app_user inexistente foi aceito/i],
  ['subject divergente', /auth_subject divergente foi aceito/i],
  ['usuário inativo', /usuário inativo foi aceito/i],
  ['role não vem de GUC', /set_config\('ltc_m\.role', 'admin'/i],
  ['viewer sem escrita', /viewer alterou cadastro/i],
  [
    'Editor DML completo',
    /do\s+\$editor\$[\s\S]*?insert\s+into\s+ltc_m\.clients[\s\S]*?update\s+ltc_m\.clients/i,
  ],
  ['viewer sem workflow', /viewer executou workflow/i],
  ['editor não inativa', /editor inativou cliente/i],
  ['editor não aprova', /editor aprovou versão/i],
  ['editor sem DELETE', /editor realizou DELETE/i],
  ['admin lê inativos', /admin não visualizou inativos/i],
  ['justificativa D23', /D23 aceitou operação sem justificativa/i],
  ['último admin', /último admin foi inativado/i],
  ['concorrência D23', /D23 não possui trava transacional/i],
  ['auditoria controlada', /consulta da auditoria não gerou evento/i],
  ['auditoria sanitizada', /consulta auditada expôs segredo ou auth_subject/i],
  ['sem auditoria direta', /admin leu audit_log diretamente/i],
];

function extractJsonArgument(sql, functionName) {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = sql.match(
    new RegExp(`${escapedName}\\s*\\(\\s*'\\s*(\\[[\\s\\S]*?\\])\\s*'::jsonb`, 'u'),
  );
  if (!match) throw new Error(`inventário ${functionName} ausente`);
  return JSON.parse(match[1]);
}

export function extractP008PolicyInventory(sql) {
  const inventory = extractJsonArgument(sql, 'jsonb_to_recordset');
  if (!Array.isArray(inventory)) throw new Error('inventário de policies não é array');
  return inventory;
}

export function extractP008RlsInventory(sql) {
  const inventory = extractJsonArgument(sql, 'jsonb_array_elements_text');
  if (!Array.isArray(inventory)) throw new Error('inventário RLS não é array');
  return inventory;
}

function policyIdentity(policy) {
  return `${policy.schemaname}.${policy.tablename}.${policy.policyname}`;
}

export function comparePolicyInventories(expected, actual) {
  const expectedByIdentity = new Map(expected.map((policy) => [policyIdentity(policy), policy]));
  const actualByIdentity = new Map(actual.map((policy) => [policyIdentity(policy), policy]));
  const missing = [...expectedByIdentity.keys()].filter((key) => !actualByIdentity.has(key));
  const unexpected = [...actualByIdentity.keys()].filter((key) => !expectedByIdentity.has(key));
  const changed = [...expectedByIdentity.keys()].filter((key) => {
    if (!actualByIdentity.has(key)) return false;
    const expectedPolicy = expectedByIdentity.get(key);
    const actualPolicy = actualByIdentity.get(key);
    return POLICY_INVENTORY_FIELDS.some((field) => expectedPolicy[field] !== actualPolicy[field]);
  });
  return { missing, unexpected, changed };
}

export function compareRlsInventories(expected, actual) {
  const expectedSet = new Set(expected);
  const actualByTable = new Map(actual.map((table) => [table.tablename, table]));
  return {
    missing: [...expectedSet].filter((table) => !actualByTable.has(table)),
    unexpected: [...actualByTable.keys()].filter((table) => !expectedSet.has(table)),
    changed: [...expectedSet].filter((table) => {
      const actualTable = actualByTable.get(table);
      return actualTable && (!actualTable.rls_enabled || !actualTable.force_rls_enabled);
    }),
  };
}

function mutationTargets(sql) {
  return [
    ...sql.matchAll(
      /\b(?:insert\s+into|update|delete\s+from)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi,
    ),
  ].map((match) => match[1].toLowerCase());
}

export function scanP008TestText(sql) {
  const issues = [];
  const stripped = stripSeedNoise(sql);

  let policyInventory = [];
  try {
    policyInventory = extractP008PolicyInventory(sql);
  } catch (error) {
    issues.push(error.message);
  }
  if (policyInventory.length !== 49) {
    issues.push(`inventário nominal deve conter 49 policies, recebeu ${policyInventory.length}`);
  }
  const policyIdentities = policyInventory.map(policyIdentity);
  if (new Set(policyIdentities).size !== policyIdentities.length) {
    issues.push('inventário nominal contém identidade duplicada');
  }
  for (const policy of policyInventory) {
    if (POLICY_INVENTORY_FIELDS.some((field) => typeof policy[field] !== 'string')) {
      issues.push(`policy nominal incompleta: ${policyIdentity(policy)}`);
      continue;
    }
    if (
      !/^[a-f0-9]{32}$/u.test(policy.qual_md5) ||
      !/^[a-f0-9]{32}$/u.test(policy.with_check_md5)
    ) {
      issues.push(`fingerprint de predicate inválido: ${policyIdentity(policy)}`);
    }
  }
  for (const policy of P013_POLICIES) {
    if (!policyIdentities.includes(`ltc_m.${policy}`))
      issues.push(`policy P013 ausente: ${policy}`);
  }
  const p013Inventory = policyInventory.filter((policy) =>
    P013_POLICIES.has(`${policy.tablename}.${policy.policyname}`),
  );
  if (
    p013Inventory.filter((policy) => policy.cmd === 'SELECT').length !== 4 ||
    p013Inventory.filter((policy) => policy.cmd === 'INSERT').length !== 4 ||
    p013Inventory.some(
      (policy) => policy.permissive !== 'PERMISSIVE' || policy.roles !== '{ltc_m_runtime}',
    )
  ) {
    issues.push('contrato nominal das oito policies P013 divergente');
  }

  let rlsInventory = [];
  try {
    rlsInventory = extractP008RlsInventory(sql);
  } catch (error) {
    issues.push(error.message);
  }
  if (
    rlsInventory.length !== PROTECTED_TABLES.size ||
    new Set(rlsInventory).size !== rlsInventory.length ||
    [...PROTECTED_TABLES].some((table) => !rlsInventory.includes(table))
  ) {
    issues.push('inventário RLS/FORCE deve conter exatamente as 19 tabelas protegidas');
  }

  for (const [pattern, message] of [
    [/\bjsonb_to_recordset\s*\(/iu, 'comparação nominal de policies ausente'],
    [/\bexpected_policies\b/iu, 'conjunto esperado de policies ausente'],
    [/\bactual_policies\b/iu, 'conjunto real de policies ausente'],
    [/\bv_missing_count\b/iu, 'proteção MISSING ausente'],
    [/\bv_unexpected_count\b/iu, 'proteção UNEXPECTED ausente'],
    [/\bv_changed_count\b/iu, 'proteção CHANGED ausente'],
    [/\bis\s+distinct\s+from\s+row\s*\(/iu, 'comparação semântica CHANGED ausente'],
    [/\bqual_md5\b/iu, 'fingerprint USING ausente'],
    [/\bwith_check_md5\b/iu, 'fingerprint WITH CHECK ausente'],
  ]) {
    if (!pattern.test(stripped)) issues.push(message);
  }

  if (!/\bdo\s+\$approver\$/iu.test(sql) || !/P021 falhou/iu.test(sql)) {
    issues.push('cenário P021 approver ausente');
  }
  if ((stripped.match(/\bwhere\s+not\s+exists\s*\(/giu) ?? []).length < 4) {
    issues.push('comparação bidirecional de inventários ausente');
  }
  for (const [pattern, message] of [
    [/\bv_expected_functions\b/iu, 'allowlist nominal esperada ausente'],
    [/\bv_actual_functions\b/iu, 'inventário real de funções ausente'],
    [/\bv_missing_functions\b/iu, 'proteção MISSING de funções ausente'],
    [/\bv_unexpected_functions\b/iu, 'proteção UNEXPECTED de funções ausente'],
    [/\bpg_proc\.oid::regprocedure::text\b/iu, 'identidade completa das funções ausente'],
  ]) {
    if (!pattern.test(stripped)) issues.push(message);
  }
  if (!/acl\.grantee\s*=\s*0[\s\S]*?acl\.privilege_type\s*=\s*'EXECUTE'/iu.test(sql)) {
    issues.push('verificação de PUBLIC EXECUTE ausente');
  }
  if (/\bv_count\s*(?:<>|=|>=|<=|>|<)\s*(?:12|41|49)\b/iu.test(stripped)) {
    issues.push('contagem literal cega de policies proibida');
  }

  if (!stripped.replace(/[\s;]+/g, '')) issues.push('teste SQL vazio');
  if ((stripped.match(/\bbegin\s*;/gi) ?? []).length !== 1) {
    issues.push('deve existir exatamente um BEGIN transacional');
  }
  if ((stripped.match(/\brollback\s*;/gi) ?? []).length !== 1) {
    issues.push('deve existir exatamente um ROLLBACK');
  }
  if (/\bcommit\s*;/i.test(stripped)) issues.push('COMMIT proibido');
  if (!/\brollback\s*;[\s\S]*?\bas\s+rollback_clean\b/i.test(stripped)) {
    issues.push('verificação rollback_clean pós-rollback ausente');
  }

  for (const [pattern, message] of [
    [/\b(?:create|alter|drop|truncate|grant|revoke)\b/i, 'DDL ou privilégio proibido'],
    [/\b(?:auth\.users|auth\.uid\s*\(|request\.jwt\.claims)\b/i, 'Supabase Auth/JWT proibido'],
  ]) {
    if (pattern.test(stripped)) issues.push(message);
  }

  if (/\b(?:password|private_key|client_secret)\b/i.test(sql)) {
    issues.push('credencial proibida');
  }

  for (const match of stripped.matchAll(
    /^\s*set\s+(?:local\s+)?role\s+([a-z_][a-z0-9_]*)\s*;/gim,
  )) {
    if (match[1].toLowerCase() !== 'ltc_m_runtime') {
      issues.push('SET ROLE fora de ltc_m_runtime');
    }
  }

  for (const target of mutationTargets(stripped)) {
    if (!ALLOWED_MUTATION_TABLES.has(target)) {
      issues.push(`mutação fora do escopo P008: ${target}`);
    }
  }

  if (
    /\b(?:insert\s+into|update|delete\s+from)\s+ltc_m\.(?:currencies|units|audit_log)\b/i.test(
      stripped,
    )
  ) {
    issues.push('valores controlados e audit_log não podem ser modificados diretamente');
  }

  for (const [name, pattern] of REQUIRED_SCENARIOS) {
    if (!pattern.test(sql)) issues.push(`cenário ausente: ${name}`);
  }

  return [...new Set(issues)];
}

function main() {
  const testPath = path.resolve(
    process.cwd(),
    process.argv[2] ?? path.join('database', 'audit', 'ltcm-p008-rls-tests.sql'),
  );

  let sql;
  try {
    sql = fs.readFileSync(testPath, 'utf8');
  } catch {
    console.error('Falha P008: arquivo de teste não encontrado ou ilegível');
    process.exitCode = 1;
    return;
  }

  const issues = scanP008TestText(sql);
  if (issues.length > 0) {
    console.error(`Validação P008 falhou:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  console.log('Teste P008 válido: transacional, sintético e restrito ao escopo aprovado');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
