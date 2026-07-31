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

const REQUIRED_SCENARIOS = [
  ['atributos da runtime', /atributos seguros da role runtime ausentes/i],
  ['runtime sem ownership', /runtime recebeu ownership/i],
  ['runtime sem grants externos', /runtime recebeu grant direto em objeto externo/i],
  ['RLS e FORCE RLS', /RLS e FORCE RLS não cobrem as 13 tabelas/i],
  ['policies exatas', /inventário de policies divergente/i],
  ['sem DELETE', /runtime recebeu privilégio de tabela proibido/i],
  ['allowlist de funções', /allowlist executável contém/i],
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
