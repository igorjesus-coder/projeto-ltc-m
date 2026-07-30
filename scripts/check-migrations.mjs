import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MIGRATION_NAME = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;

const FORBIDDEN_PATTERNS = [
  [
    /\bdrop\s+(?:table|column|schema|type|view|sequence|function|procedure|trigger)\b/i,
    'DROP destrutivo',
  ],
  [/\btruncate\b/i, 'comando TRUNCATE'],
  [/\bdelete\s+from\b/i, 'comando DELETE'],
  [/\bupdate\s+(?:only\s+)?[a-z_][a-z0-9_.]*\s+set\b/i, 'comando UPDATE'],
  [/\binsert\s+into\b/i, 'comando INSERT'],
  [/\bmerge\b/i, 'comando MERGE'],
  [/\bcopy\b/i, 'comando COPY'],
  [/\balter\s+schema\b/i, 'comando ALTER SCHEMA'],
  [/\balter\s+role\b/i, 'comando ALTER ROLE'],
  [/\balter\s+default\s+privileges\b/i, 'comando ALTER DEFAULT PRIVILEGES'],
  [/\bcreate\s+role\b/i, 'comando CREATE ROLE'],
  [/\bdrop\s+role\b/i, 'comando DROP ROLE'],
  [/\bgrant\b/i, 'comando GRANT'],
  [/\brevoke\b/i, 'comando REVOKE'],
  [/\benable\s+row\s+level\s+security\b/i, 'RLS proibida'],
  [/\bforce\s+row\s+level\s+security\b/i, 'RLS proibida'],
  [/\bcreate\s+policy\b/i, 'policy proibida'],
  [/\balter\s+policy\b/i, 'policy proibida'],
  [/\bdrop\s+policy\b/i, 'policy proibida'],
  [/\bcreate\s+extension\b/i, 'comando CREATE EXTENSION'],
  [/\bdrop\s+extension\b/i, 'comando DROP EXTENSION'],
  [/\bcreate\s+publication\b/i, 'comando CREATE PUBLICATION'],
  [/\balter\s+publication\b/i, 'alteração de publication'],
  [/\bcreate\s+procedure\b/i, 'procedure proibida'],
  [/\bdo\b/i, 'bloco dinâmico DO'],
  [/\bcreate\s+(?:unique\s+)?index\s+concurrently\b/i, 'CREATE INDEX CONCURRENTLY'],
  [/\b(?:real|float4|float8|float|double\s+precision|money)\b/i, 'tipo financeiro impreciso'],
  [/\b(?:auth\.users|auth\.uid\s*\()/i, 'dependência de Supabase Auth'],
  [
    /\b(?:public|auth|storage|extensions|vault|realtime|supabase_migrations)\s*\./i,
    'referência a schema externo',
  ],
];

const P007_COLUMNS = new Map([
  ['app_users', new Set(['row_version'])],
  ['clients', new Set(['row_version'])],
  ['project_items', new Set(['row_version'])],
  ['plan_versions', new Set(['row_version', 'updated_by_user_id', 'source_plan_version_id'])],
  ['financial_plan_scopes', new Set(['row_version'])],
  ['financial_plan_lines', new Set(['row_version'])],
  ['financial_actual_events', new Set(['row_version'])],
  ['import_batches', new Set(['updated_at', 'row_version'])],
  [
    'audit_log',
    new Set([
      'actor_auth_subject',
      'source',
      'justification',
      'previous_row_version',
      'new_row_version',
      'metadata',
    ]),
  ],
]);

const P007_SECURITY_DEFINER_FUNCTIONS = new Set([
  'ltc_m.audit_row_change',
  'ltc_m.submit_plan_version',
  'ltc_m.return_plan_version_to_draft',
  'ltc_m.approve_plan_version',
  'ltc_m.lock_plan_version',
  'ltc_m.reopen_plan_version',
]);

function consumeDollarTag(sql, index) {
  const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
  return match?.[0] ?? null;
}

export function stripSqlNoise(sql) {
  let output = '';

  for (let index = 0; index < sql.length;) {
    if (sql.startsWith('--', index)) {
      const end = sql.indexOf('\n', index + 2);
      if (end < 0) break;
      output += '\n';
      index = end + 1;
      continue;
    }

    if (sql.startsWith('/*', index)) {
      const end = sql.indexOf('*/', index + 2);
      if (end < 0) {
        output += ' ';
        break;
      }
      output += sql.slice(index, end + 2).replace(/[^\r\n]/g, ' ');
      index = end + 2;
      continue;
    }

    if (sql[index] === "'") {
      output += ' ';
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
        } else if (sql[index] === "'") {
          index += 1;
          break;
        } else {
          if (sql[index] === '\n') output += '\n';
          index += 1;
        }
      }
      continue;
    }

    const dollarTag = sql[index] === '$' ? consumeDollarTag(sql, index) : null;
    if (dollarTag) {
      output += ' ';
      const end = sql.indexOf(dollarTag, index + dollarTag.length);
      if (end < 0) break;
      output += sql.slice(index + dollarTag.length, end).replace(/[^\r\n]/g, ' ');
      index = end + dollarTag.length;
      continue;
    }

    output += sql[index];
    index += 1;
  }

  return output;
}

function isValidTimestamp(timestamp) {
  const year = Number(timestamp.slice(0, 4));
  const month = Number(timestamp.slice(4, 6));
  const day = Number(timestamp.slice(6, 8));
  const hour = Number(timestamp.slice(8, 10));
  const minute = Number(timestamp.slice(10, 12));
  const second = Number(timestamp.slice(12, 14));
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

function requireQualifiedObjects(sql, issues) {
  const checks = [
    [/\bcreate\s+schema\s+(?!ltc_m\b)/i, 'somente o schema ltc_m pode ser criado'],
    [
      /\bcreate\s+(?:table|type|view|sequence)\s+(?:if\s+not\s+exists\s+)?(?!ltc_m\.)/i,
      'objeto de domínio sem qualificação ltc_m',
    ],
    [
      /\bcreate\s+(?:or\s+replace\s+)?function\s+(?!ltc_m\.)/i,
      'função de domínio sem qualificação ltc_m',
    ],
    [/\breferences\s+(?!ltc_m\.)/i, 'foreign key para tabela fora de ltc_m'],
    [
      /\bcomment\s+on\s+(?:schema|table|column|type|view|sequence)\s+(?!ltc_m(?:\.|\b))/i,
      'comentário sobre objeto fora de ltc_m',
    ],
  ];

  for (const [pattern, message] of checks) {
    if (pattern.test(sql)) issues.push(message);
  }

  for (const match of sql.matchAll(/\bcreate\s+(?:unique\s+)?index\b[\s\S]*?;/gi)) {
    if (!/\bon\s+ltc_m\./i.test(match[0])) {
      issues.push('índice sobre tabela fora de ltc_m');
    }
  }

  for (const match of sql.matchAll(/\bcreate\s+trigger\b[\s\S]*?;/gi)) {
    if (!/\bon\s+ltc_m\./i.test(match[0]) || !/\bexecute\s+function\s+ltc_m\./i.test(match[0])) {
      issues.push('trigger deve pertencer a tabela ltc_m e executar função ltc_m');
    }
  }
}

function requireAdditiveAlterTables(sql, issues) {
  const alterPattern = /\balter\s+table\b[\s\S]*?;/gi;
  const statements = [...sql.matchAll(alterPattern)];

  for (const match of statements) {
    const statement = match[0];
    const tableMatch = statement.match(/^\s*alter\s+table\s+ltc_m\.([a-z_][a-z0-9_]*)\b/i);
    if (!tableMatch) {
      issues.push('ALTER TABLE permitido somente em ltc_m');
      continue;
    }

    const tableName = tableMatch[1].toLowerCase();
    for (const columnMatch of statement.matchAll(/\badd\s+column\s+([a-z_][a-z0-9_]*)\b/gi)) {
      const allowedColumns = P007_COLUMNS.get(tableName);
      if (!allowedColumns?.has(columnMatch[1].toLowerCase())) {
        issues.push(`ADD COLUMN fora do escopo P007: ltc_m.${tableName}.${columnMatch[1]}`);
      }
    }

    if (
      /\bdrop\s+constraint\b/i.test(statement) &&
      !/^\s*alter\s+table\s+ltc_m\.plan_versions\b[\s\S]*?\bdrop\s+constraint\s+ck_plan_versions_approval\b/i.test(
        statement,
      )
    ) {
      issues.push('DROP CONSTRAINT fora do escopo P007');
    }

    if (
      /\b(?:rename|alter\s+column|drop\s+column|drop\s+table)\b/i.test(statement) ||
      !/\b(?:add\s+column|add\s+constraint|drop\s+constraint)\b/i.test(statement)
    ) {
      issues.push('ALTER TABLE não aditivo ou fora do escopo P007');
    }
  }

  if (/\balter\s+table\b/i.test(sql.replace(alterPattern, ' '))) {
    issues.push('ALTER TABLE incompleto ou não aditivo');
  }
}

function requireApprovedAlterTypes(sql, issues) {
  const alterTypePattern = /\balter\s+type\b[\s\S]*?;/gi;
  const statements = [...sql.matchAll(alterTypePattern)];

  for (const match of statements) {
    if (
      !/^\s*alter\s+type\s+ltc_m\.plan_status\s+add\s+value\s+'pending_approval'\s+after\s+'draft'\s*;/i.test(
        match[0],
      ) &&
      !/^\s*alter\s+type\s+ltc_m\.audit_operation\s+add\s+value\s+'(?:SUBMIT|RETURN)'\s+after\s+'(?:UPDATE|SUBMIT)'\s*;/i.test(
        match[0],
      )
    ) {
      issues.push('ALTER TYPE fora do escopo P007');
    }
  }

  if (/\balter\s+type\b/i.test(sql.replace(alterTypePattern, ' '))) {
    issues.push('ALTER TYPE incompleto');
  }
}

function extractDollarBodies(sql) {
  const bodies = [];
  for (let index = 0; index < sql.length;) {
    const tag = sql[index] === '$' ? consumeDollarTag(sql, index) : null;
    if (!tag) {
      index += 1;
      continue;
    }
    const end = sql.indexOf(tag, index + tag.length);
    if (end < 0) break;
    bodies.push(sql.slice(index + tag.length, end));
    index = end + tag.length;
  }
  return bodies;
}

function requireSafeFunctions(sql, issues) {
  const functionStarts = [
    ...sql.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(ltc_m\.[a-z_][a-z0-9_]*)\s*\(/gi),
  ];

  for (let index = 0; index < functionStarts.length; index += 1) {
    const match = functionStarts[index];
    const end = functionStarts[index + 1]?.index ?? sql.length;
    const definition = sql.slice(match.index, end);
    const functionName = match[1].toLowerCase();
    const securityMatch = definition.match(/\bsecurity\s+(invoker|definer)\b/i);

    if (!securityMatch) {
      issues.push(`${functionName}: SECURITY INVOKER ou DEFINER deve ser explícito`);
    } else if (
      securityMatch[1].toLowerCase() === 'definer' &&
      !P007_SECURITY_DEFINER_FUNCTIONS.has(functionName)
    ) {
      issues.push(`${functionName}: SECURITY DEFINER fora da whitelist P007`);
    }

    if (!/\bset\s+search_path\s*=\s*''/i.test(definition)) {
      issues.push(`${functionName}: search_path vazio obrigatório`);
    }
  }

  for (const body of extractDollarBodies(sql)) {
    const strippedBody = stripSqlNoise(body);
    for (const [pattern, message] of [
      [/\bexecute\b/i, 'SQL dinâmico EXECUTE em função'],
      [/\b(?:drop|truncate|alter|grant|revoke)\b/i, 'DDL ou privilégio proibido em função'],
      [
        /\b(?:public|auth|storage|extensions|vault|realtime|supabase_migrations)\s*\./i,
        'referência a schema externo em função',
      ],
      [/\bdelete\s+from\b/i, 'DELETE proibido em função'],
      [/\binsert\s+into\s+(?!ltc_m\.)/i, 'INSERT não qualificado em função'],
      [/\bupdate\s+(?!ltc_m\.)/i, 'UPDATE não qualificado em função'],
    ]) {
      if (pattern.test(strippedBody)) issues.push(message);
    }
  }
}

export function extractNamedObjects(sql) {
  const stripped = stripSqlNoise(sql);
  return {
    constraints: [...stripped.matchAll(/\bconstraint\s+([a-z_][a-z0-9_]*)/gi)].map((match) =>
      match[1].toLowerCase(),
    ),
    indexes: [
      ...stripped.matchAll(
        /\bcreate\s+(?:unique\s+)?index\s+(?!concurrently\b)([a-z_][a-z0-9_]*)/gi,
      ),
    ].map((match) => match[1].toLowerCase()),
  };
}

export function scanMigrationText(sql) {
  const issues = [];
  const stripped = stripSqlNoise(sql);
  const semanticSql = stripped.replace(/\b(?:begin|commit|rollback)\b/gi, '').replace(/[;\s]/g, '');

  if (!semanticSql) issues.push('migration vazia');

  for (const [pattern, message] of FORBIDDEN_PATTERNS) {
    if (pattern.test(stripped)) issues.push(message);
  }

  requireQualifiedObjects(stripped, issues);
  requireAdditiveAlterTables(stripped, issues);
  requireApprovedAlterTypes(sql, issues);
  requireSafeFunctions(sql, issues);

  if (/--project-ref\b/i.test(sql) || /\b[a-z0-9]{20}\.supabase\.co\b/i.test(sql)) {
    issues.push('project ref ou endpoint remoto versionado');
  }

  return [...new Set(issues)];
}

export function checkMigrations(directory) {
  const issues = [];
  const entries = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();

  if (entries.length === 0) {
    return { files: [], issues: ['nenhuma migration SQL encontrada'] };
  }

  const timestamps = new Set();
  const constraintNames = new Set();
  const indexNames = new Set();
  let previousTimestamp = null;

  for (const filename of entries) {
    const match = filename.match(MIGRATION_NAME);
    if (!match) {
      issues.push(`${filename}: nome inválido`);
      continue;
    }

    const timestamp = match[1];
    if (!isValidTimestamp(timestamp)) {
      issues.push(`${filename}: timestamp inválido`);
    }
    if (timestamps.has(timestamp)) {
      issues.push(`${filename}: timestamp duplicado`);
    }
    if (previousTimestamp && timestamp <= previousTimestamp) {
      issues.push(`${filename}: ordem de timestamp inválida`);
    }

    timestamps.add(timestamp);
    previousTimestamp = timestamp;

    const sql = fs.readFileSync(path.join(directory, filename), 'utf8');
    for (const issue of scanMigrationText(sql)) {
      issues.push(`${filename}: ${issue}`);
    }

    const namedObjects = extractNamedObjects(sql);
    for (const name of namedObjects.constraints) {
      if (constraintNames.has(name)) {
        const replacesApprovedConstraint =
          name === 'ck_plan_versions_approval' &&
          /\bdrop\s+constraint\s+ck_plan_versions_approval\b/i.test(stripSqlNoise(sql));
        if (!replacesApprovedConstraint) {
          issues.push(`${filename}: nome de constraint duplicado: ${name}`);
        }
      }
      constraintNames.add(name);
    }
    for (const name of namedObjects.indexes) {
      if (indexNames.has(name)) {
        issues.push(`${filename}: nome de índice duplicado: ${name}`);
      }
      indexNames.add(name);
    }
  }

  return { files: entries, issues };
}

export function formatMigrationIssues(issues) {
  return issues.map((issue) => `- ${issue}`).join('\n');
}

function main() {
  const directory = path.resolve(
    process.cwd(),
    process.argv[2] ?? path.join('supabase', 'migrations'),
  );

  let result;
  try {
    result = checkMigrations(directory);
  } catch {
    console.error('Falha de migrations: diretório não encontrado ou ilegível');
    process.exitCode = 1;
    return;
  }

  if (result.issues.length > 0) {
    console.error(`Validação de migrations falhou:\n${formatMigrationIssues(result.issues)}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Migrations válidas: ${result.files.length}`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  main();
}
