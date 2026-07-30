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
  'ltc_m.audit_log',
]);

const REQUIRED_SCENARIOS = [
  ['timestamps de insert', /insert não definiu timestamps coerentes/i],
  ['updated_at em mudança real', /update real não avançou updated_at/i],
  ['versão esperada', /update com versão esperada não alterou uma linha/i],
  ['versão obsoleta', /versão obsoleta alterou registro/i],
  ['no-op', /no-op alterou timestamp ou versão/i],
  ['auditoria de insert', /insert não gerou auditoria/i],
  ['before/after sanitizado', /before\/after sanitizado/i],
  ['soft delete', /soft delete não foi auditado/i],
  ['ator de sistema', /não gerou ator de sistema/i],
  ['segredo sanitizado', /segredo ou identificador sensível/i],
  ['audit_log append-only', /audit_log aceitou UPDATE/i],
  ['erros de importação append-only', /import_row_errors aceitou UPDATE/i],
  ['viewer rejeitado', /viewer executou workflow/i],
  ['editor não aprova', /editor aprovou versão/i],
  ['status direto rejeitado', /alteração direta de status foi aceita/i],
  ['guarda ausente', /guarda ausente ou resetada foi aceita/i],
  ['guarda vazia', /guarda vazia foi aceita/i],
  ['guarda inválida', /guarda inválida foi aceita/i],
  ['guarda false', /guarda textual false foi aceita/i],
  ['guarda true externa', /guarda textual true foi aceita/i],
  ['guarda restaurada', /guarda interna não foi restaurada/i],
  ['aprovação direta rejeitada', /aprovação direta foi aceita/i],
  ['retorno direto rejeitado', /retorno direto para draft foi aceito/i],
  ['bloqueio direto rejeitado', /bloqueio direto foi aceito/i],
  ['guarda não vaza', /guarda vazou após rollback/i],
  ['versão aprovada imutável', /versão aprovada foi alterada diretamente/i],
  ['scope imutável', /scope aprovado foi alterado/i],
  ['linha imutável', /linha aprovada foi alterada/i],
  ['clonagem de scopes', /reabertura não copiou scopes/i],
  ['clonagem de linhas', /reabertura não copiou linhas/i],
  ['origem preservada', /origem da reabertura foi alterada/i],
  ['realizados não copiados', /reabertura copiou eventos realizados/i],
  ['dois admins', /autoaprovação com dois admins foi aceita/i],
  ['justificativa única', /autoaprovação sem justificativa foi aceita/i],
  ['autoaprovação auditada', /autoaprovação excepcional não foi auditada/i],
  ['histórico financeiro', /correção financeira não preservou histórico/i],
  ['DELETE financeiro', /evento financeiro aceitou DELETE físico/i],
];

function mutationTargets(sql) {
  return [
    ...sql.matchAll(
      /\b(?:insert\s+into|update|delete\s+from)\s+([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/gi,
    ),
  ].map((match) => match[1].toLowerCase());
}

export function scanP007TestText(sql) {
  const issues = [];
  const stripped = stripSeedNoise(sql);

  if (!stripped.replace(/[\s;]+/g, '')) issues.push('teste SQL vazio');
  if (!/^\s*begin\s*;/i.test(stripped)) issues.push('transação inicial ausente');
  if ((stripped.match(/\brollback\s*;/gi) ?? []).length !== 1) {
    issues.push('deve existir exatamente um ROLLBACK');
  }
  if (/\bcommit\s*;/i.test(stripped)) issues.push('COMMIT proibido');
  if (!/\brollback\s*;[\s\S]*?\bas\s+rollback_clean\s*;/i.test(stripped)) {
    issues.push('verificação rollback_clean pós-rollback ausente');
  }

  for (const [pattern, message] of [
    [/\b(?:create|alter|drop|truncate|grant|revoke)\b/i, 'DDL ou privilégio proibido'],
    [/\bexecute\b/i, 'SQL dinâmico proibido'],
    [/\b(?:auth\.users|auth\.uid\s*\()/i, 'Supabase Auth proibido'],
    [/\b(?:enable|force)\s+row\s+level\s+security\b/i, 'RLS proibida'],
    [/\bcreate\s+policy\b/i, 'policy proibida'],
  ]) {
    if (pattern.test(stripped)) issues.push(message);
  }

  if (
    /\b(?:public|auth|storage|extensions|vault|realtime|supabase_migrations)\s*\./i.test(stripped)
  ) {
    issues.push('referência a schema fora de ltc_m/pg_catalog');
  }

  for (const target of mutationTargets(stripped)) {
    if (!ALLOWED_MUTATION_TABLES.has(target)) {
      issues.push(`mutação fora do escopo P007: ${target}`);
    }
  }

  if (/\b(?:insert\s+into|update|delete\s+from)\s+ltc_m\.(?:currencies|units)\b/i.test(stripped)) {
    issues.push('valores controlados não podem ser modificados');
  }

  for (const [name, pattern] of REQUIRED_SCENARIOS) {
    if (!pattern.test(sql)) issues.push(`cenário ausente: ${name}`);
  }

  return [...new Set(issues)];
}

function main() {
  const testPath = path.resolve(
    process.cwd(),
    process.argv[2] ?? path.join('database', 'audit', 'ltcm-p007-tests.sql'),
  );

  let sql;
  try {
    sql = fs.readFileSync(testPath, 'utf8');
  } catch {
    console.error('Falha P007: arquivo de teste não encontrado ou ilegível');
    process.exitCode = 1;
    return;
  }

  const issues = scanP007TestText(sql);
  if (issues.length > 0) {
    console.error(`Validação P007 falhou:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    process.exitCode = 1;
    return;
  }

  console.log('Teste P007 válido: transacional, sintético e restrito a ltc_m');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
