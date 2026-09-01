import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { stripSqlNoise } from './check-migrations.mjs';

export const D28_FILENAME = '20260731120000_fix_ltcm_runtime_function_acl.sql';
const P008_LAST_TIMESTAMP = '20260731103001';

// D28 is intentionally a one-function corrective ACL.  The trigger path is
// SECURITY INVOKER and calls this SECURITY DEFINER helper; no other function
// requires a new direct grant.
const ALLOWED_FUNCTION = 'ltc_m.current_actor_id(boolean)';
const ALLOWED_FUNCTION_PATTERN = ALLOWED_FUNCTION.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function splitStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function hasForbiddenAclSyntax(sql) {
  return [
    [/\bgrant\s+execute\s+on\s+all\s+functions\b/i, 'GRANT EXECUTE ON ALL FUNCTIONS proibido'],
    [/\brevoke\s+execute\s+on\s+all\s+functions\b/i, 'REVOKE EXECUTE ON ALL FUNCTIONS proibido'],
    [/\bgrant\s+execute\s+on\s+function\s+[^;]+\s+to\s+public\b/i, 'EXECUTE para PUBLIC proibido'],
    [
      /\bgrant\s+execute\s+on\s+function\s+[^;]+\s+to\s+(?!ltc_m_runtime\b)[a-z_][a-z0-9_]*/i,
      'EXECUTE permitido somente para ltc_m_runtime',
    ],
    [
      /\b(?:grant|revoke)\s+execute\s+on\s+(?:schema|table|sequence)\b/i,
      'ACL de schema, tabela ou sequência proibida',
    ],
    [
      /\b(?:create|alter|drop)\s+(?:policy|table|role|schema|function|trigger|index|sequence|type)\b/i,
      'DDL fora do escopo D28',
    ],
    [/\b(?:insert|update|delete|merge|truncate|copy)\b/i, 'DML fora do escopo D28'],
    [/\b(?:add|drop|alter)\s+member\b/i, 'membership fora do escopo D28'],
    [
      /\b(?:seed|auth\.|public\.|storage\.|extensions\.)/i,
      'objeto externo ou seed fora do escopo D28',
    ],
  ];
}

export function scanD28MigrationText(sql) {
  const issues = [];
  const stripped = stripSqlNoise(sql);
  const withoutTx = stripped.replace(/\b(?:begin|commit)\s*;?/gi, '');

  if (!withoutTx.replace(/[;\s]/g, '')) issues.push('migration D28 vazia');
  for (const [pattern, message] of hasForbiddenAclSyntax(withoutTx)) {
    if (pattern.test(withoutTx)) issues.push(message);
  }

  const statements = splitStatements(withoutTx);
  const comments = statements.filter((statement) => /^comment\s+on\s+function\s+/i.test(statement));
  if (
    comments.some(
      (statement) =>
        !/^comment\s+on\s+function\s+ltc_m\.current_actor_id\(boolean\)\s+is\s*$/i.test(statement),
    ) ||
    comments.length > 1
  ) {
    issues.push('COMMENT D28 permitido somente na função current_actor_id(boolean)');
  }
  const aclStatements = statements.filter(
    (statement) => !/^comment\s+on\s+function\s+/i.test(statement),
  );
  const grants = aclStatements.filter((statement) =>
    /^grant\s+execute\s+on\s+function\s+/i.test(statement),
  );

  const revokes = aclStatements.filter((statement) =>
    /^revoke\s+execute\s+on\s+function\s+/i.test(statement),
  );
  if (aclStatements.length !== 2 || revokes.length !== 1 || grants.length !== 1) {
    issues.push('D28 deve conter exatamente um REVOKE e um GRANT EXECUTE');
  }

  const revoke = revokes[0];
  if (
    revoke &&
    !new RegExp(
      `^revoke\\s+execute\\s+on\\s+function\\s+${ALLOWED_FUNCTION_PATTERN}\\s+from\\s+public$`,
      'i',
    ).test(revoke)
  ) {
    issues.push('REVOKE D28 deve ser exclusivamente de current_actor_id(boolean) para PUBLIC');
  }

  const grant = grants[0];
  if (
    grant &&
    !new RegExp(
      `^grant\\s+execute\\s+on\\s+function\\s+${ALLOWED_FUNCTION_PATTERN}\\s+to\\s+ltc_m_runtime$`,
      'i',
    ).test(grant)
  ) {
    issues.push('GRANT D28 deve ser exclusivamente current_actor_id(boolean) para ltc_m_runtime');
  }

  // Both a complete signature and the corrected runtime grant are mandatory.
  if (!new RegExp(ALLOWED_FUNCTION_PATTERN, 'i').test(withoutTx)) {
    issues.push('allowlist D28 ausente: ltc_m.current_actor_id(boolean)');
  }

  return [...new Set(issues)];
}

export function checkD28Migrations(directory) {
  const issues = [];
  let entries;
  try {
    entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return { files: [], issues: ['diretório de migrations D28 ilegível'] };
  }

  const postP008 = entries.filter((filename) => {
    const timestamp = filename.match(/^(\d{14})_/i)?.[1];
    return timestamp && timestamp > P008_LAST_TIMESTAMP;
  });
  const d28Migrations = postP008.filter((filename) => filename === D28_FILENAME);
  if (d28Migrations.length === 0) {
    issues.push(`migration D28 obrigatória ausente: ${D28_FILENAME}`);
  } else if (d28Migrations.length > 1) {
    issues.push(`múltiplas migrations D28 encontradas: ${d28Migrations.length}`);
  }

  if (entries.includes(D28_FILENAME)) {
    const sql = fs.readFileSync(path.join(directory, D28_FILENAME), 'utf8');
    for (const issue of scanD28MigrationText(sql)) issues.push(`${D28_FILENAME}: ${issue}`);
  }

  return { files: entries, issues: [...new Set(issues)] };
}

function main() {
  const directory = path.resolve(
    process.cwd(),
    process.argv[2] ?? path.join('supabase', 'migrations'),
  );
  const result = checkD28Migrations(directory);
  if (result.issues.length > 0) {
    console.error(
      `Validação D28 falhou:\n${result.issues.map((issue) => `- ${issue}`).join('\n')}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log('Migration D28 válida: ACL mínima e exclusiva de current_actor_id(boolean)');
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) main();
