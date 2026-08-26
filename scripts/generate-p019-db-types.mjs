import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { format as formatWithPrettier } from 'prettier';

import { createSnapshot, serializeSnapshot } from './generate-p017-schema-docs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MODEL_PATH = path.join(ROOT, 'docs', 'database', 'p017-schema-model.json');
export const P019_DATABASE_TYPES_PATH = path.join(
  ROOT,
  'apps',
  'api',
  'src',
  'database',
  'generated',
  'database.types.ts',
);

function pascalCase(value) {
  return value
    .split(/[^a-zA-Z0-9]+/u)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('');
}

function quoteProperty(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(value) ? value : JSON.stringify(value);
}

function scalarType(postgresType, enumNames) {
  const type = postgresType.trim().toLowerCase();
  if (type.endsWith('[]')) {
    return `ReadonlyArray<${scalarType(type.slice(0, -2), enumNames)}>`;
  }
  if (enumNames.has(type)) return `${pascalCase(type.replace(/^ltc_m\./u, ''))}Enum`;
  if (type === 'uuid') return 'PgUuid';
  if (type === 'text' || type.startsWith('character varying')) return 'string';
  if (type === 'boolean') return 'boolean';
  if (type === 'smallint' || type === 'integer') return 'number';
  if (type === 'bigint') return 'PgBigInt';
  if (type === 'numeric' || type.startsWith('numeric(') || type.startsWith('decimal(')) {
    return 'PgNumeric';
  }
  if (type === 'date') return 'PgDate';
  if (type === 'timestamp without time zone') return 'PgTimestamp';
  if (type === 'timestamp with time zone') return 'PgTimestampTz';
  if (type === 'json' || type === 'jsonb') return 'JsonValue';
  if (type === 'bytea') return 'Uint8Array';
  throw new Error(`P019_POSTGRES_TYPE_UNSUPPORTED:${postgresType}`);
}

function relationInterfaceName(relation) {
  return `${pascalCase(relation.schema)}${pascalCase(relation.name)}Row`;
}

function renderEnum(type) {
  const name = `${pascalCase(type.name)}Enum`;
  const labels = type.labels.map((label) => JSON.stringify(label)).join(' | ');
  return `export type ${name} = ${labels};`;
}

function renderRelation(relation, enumNames) {
  const columns = [...relation.columns].sort((left, right) => left.position - right.position);
  const fields = columns.map((column) => {
    const scalar = scalarType(column.type, enumNames);
    return `  readonly ${quoteProperty(column.name)}: ${scalar}${column.nullable ? ' | null' : ''};`;
  });
  return [`export interface ${relationInterfaceName(relation)} {`, ...fields, '}'].join('\n');
}

function renderRelationMap(name, relations) {
  const fields = relations.map(
    (relation) => `  readonly ${quoteProperty(relation.name)}: ${relationInterfaceName(relation)};`,
  );
  return [`export interface ${name} {`, ...fields, '}'].join('\n');
}

export function renderP019DatabaseTypes(snapshot) {
  const expected = createSnapshot(snapshot.model, snapshot.migrationCount);
  if (serializeSnapshot(snapshot) !== serializeSnapshot(expected)) {
    throw new Error('P019_P017_SCHEMA_SNAPSHOT_INVALID');
  }
  const types = [...snapshot.model.types].sort((left, right) =>
    `${left.schema}.${left.name}`.localeCompare(`${right.schema}.${right.name}`, 'en'),
  );
  if (types.some((type) => type.kind !== 'enum')) {
    throw new Error('P019_CUSTOM_TYPE_UNSUPPORTED');
  }
  const enumNames = new Set(types.map((type) => `${type.schema}.${type.name}`.toLowerCase()));
  const relations = [...snapshot.model.relations].sort((left, right) =>
    `${left.schema}.${left.name}`.localeCompare(`${right.schema}.${right.name}`, 'en'),
  );
  const tables = relations.filter((relation) => relation.kind === 'table');
  const views = relations.filter(
    (relation) => relation.kind === 'view' || relation.kind === 'materialized_view',
  );
  if (tables.length + views.length !== relations.length) {
    throw new Error('P019_RELATION_KIND_UNSUPPORTED');
  }
  const sections = [
    '/**',
    ' * GENERATED FILE — DO NOT EDIT.',
    ' * Source: docs/database/p017-schema-model.json',
    ' * Regenerate with: npm run db:types:generate',
    ' */',
    `export const P017_SCHEMA_CONTRACT = ${JSON.stringify(snapshot.schemaContract)} as const;`,
    `export const P017_SCHEMA_FINGERPRINT = ${JSON.stringify(snapshot.fingerprint)} as const;`,
    `export const P019_DATABASE_TYPES_CONTRACT = 'ltcm.p019.database-types.v1' as const;`,
    '',
    '/** Exact decimal text returned by the P019 pg parser; never an authoritative number. */',
    'export type PgNumeric = string;',
    '/** Exact int8 text returned by the P019 pg parser. */',
    'export type PgBigInt = string;',
    'export type PgUuid = string;',
    'export type PgDate = string;',
    'export type PgTimestamp = string;',
    'export type PgTimestampTz = string;',
    'export type JsonValue =',
    '  | string',
    '  | number',
    '  | boolean',
    '  | null',
    '  | { readonly [key: string]: JsonValue }',
    '  | readonly JsonValue[];',
    '',
    ...types.flatMap((type) => [renderEnum(type), '']),
    ...relations.flatMap((relation) => [renderRelation(relation, enumNames), '']),
    renderRelationMap('LtcMTableRows', tables),
    '',
    renderRelationMap('LtcMViewRows', views),
    '',
    'export type LtcMTableName = keyof LtcMTableRows;',
    'export type LtcMViewName = keyof LtcMViewRows;',
    'export type LtcMTableRow<Name extends LtcMTableName> = LtcMTableRows[Name];',
    'export type LtcMViewRow<Name extends LtcMViewName> = LtcMViewRows[Name];',
    '',
  ];
  return `${sections
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trimEnd()}\n`;
}

export async function loadP019SchemaSnapshot() {
  return JSON.parse(await fs.readFile(MODEL_PATH, 'utf8'));
}

export async function generateP019DatabaseTypes({ write = false } = {}) {
  const output = await formatWithPrettier(renderP019DatabaseTypes(await loadP019SchemaSnapshot()), {
    parser: 'typescript',
    printWidth: 100,
    singleQuote: true,
    trailingComma: 'all',
  });
  if (write) {
    await fs.mkdir(path.dirname(P019_DATABASE_TYPES_PATH), { recursive: true });
    await fs.writeFile(P019_DATABASE_TYPES_PATH, output, 'utf8');
    return output;
  }
  let current;
  try {
    current = await fs.readFile(P019_DATABASE_TYPES_PATH, 'utf8');
  } catch {
    throw new Error('P019_DATABASE_TYPES_MISSING');
  }
  if (current !== output) throw new Error('P019_DATABASE_TYPES_STALE');
  return output;
}

async function main() {
  const mode = process.argv[2];
  if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
    throw new Error('P019_DATABASE_TYPES_USAGE');
  }
  const output = await generateP019DatabaseTypes({ write: mode === '--write' });
  process.stdout.write(
    `P019 database types ${mode === '--write' ? 'generated' : 'checked'}: ${Buffer.byteLength(output, 'utf8')} bytes\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'P019_DATABASE_TYPES_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
}
