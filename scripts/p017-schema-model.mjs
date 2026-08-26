import { createHash } from 'node:crypto';

export const P017_SCHEMA_CONTRACT = 'ltcm.p017.schema-integrity.v1';
export const P017_FINGERPRINT_CONTRACT = 'ltcm.p017.schema-fingerprint.v1';

export const P016_VIEW_CONTRACTS = Object.freeze({
  v_tableau_portfolio_overview: {
    grain: 'moeda no snapshot visível',
    key: 'currency_code',
  },
  v_tableau_project_overview: { grain: 'projeto', key: 'project_id' },
  v_tableau_project_items: {
    grain: 'item persistido',
    key: 'project_item_id; negócio: project_id + source_line_key',
  },
  v_tableau_financial_monthly: {
    grain: 'fato persistido planned/actual',
    key: 'analytical_fact_key',
  },
  v_tableau_s_curve_portfolio: {
    grain: 'série + versão/status + competência + métrica + moeda',
    key: 'todas as dimensões do grão',
  },
  v_tableau_s_curve_project: {
    grain: 'projeto + série + versão/status + competência + métrica + moeda',
    key: 'todas as dimensões do grão',
  },
  v_tableau_data_quality: { grain: 'finding', key: 'finding_id' },
  v_tableau_plan_versions: {
    grain: 'versão + escopo (NO_SCOPE quando ausente)',
    key: 'analytical_version_key',
  },
  v_tableau_source_provenance: {
    grain: 'célula mensal',
    key: 'monthly_plan_cell_id',
  },
});

const RELATION_CONTRACT_OWNERS = Object.freeze({
  app_users: 'P007/P008',
  audit_log: 'P007/P008',
  clients: 'P011',
  currencies: 'P004/P005',
  financial_actual_events: 'Core/P014',
  financial_plan_lines: 'Core/P013',
  financial_plan_scopes: 'Core/P013',
  import_batch_sheets: 'P009',
  import_batches: 'Core/P009',
  import_row_errors: 'Core/P009',
  import_staging_rows: 'P009',
  monthly_plan_baselines: 'P013',
  monthly_plan_cells: 'P013',
  monthly_plan_import_executions: 'P013',
  monthly_source_artifacts: 'P013',
  plan_versions: 'Core/P013',
  project_items: 'P012',
  projects: 'P011',
  units: 'P004/P005',
  ...Object.fromEntries(Object.keys(P016_VIEW_CONTRACTS).map((name) => [name, 'P016'])),
});

const compareText = (left, right) => String(left).localeCompare(String(right), 'en');

function cleanText(value) {
  if (value === null || value === undefined) return null;
  return String(value).replaceAll('\r\n', '\n').trim();
}

function sortedText(values) {
  return [...new Set((values ?? []).map(String))].sort(compareText);
}

function sortBy(values, keys) {
  return [...values].sort((left, right) => {
    for (const key of keys) {
      const result = compareText(left[key] ?? '', right[key] ?? '');
      if (result !== 0) return result;
    }
    return 0;
  });
}

export function canonicalizeSchemaModel(input) {
  const relations = sortBy(
    (input.relations ?? []).map((relation) => ({
      schema: String(relation.schema),
      name: String(relation.name),
      kind: String(relation.kind),
      rowSecurity: Boolean(relation.rowSecurity),
      forceRowSecurity: Boolean(relation.forceRowSecurity),
      options: sortedText(relation.options),
      comment: cleanText(relation.comment),
      definition: cleanText(relation.definition),
      columns: sortBy(
        (relation.columns ?? []).map((column) => ({
          position: Number(column.position),
          name: String(column.name),
          type: String(column.type),
          nullable: Boolean(column.nullable),
          default: cleanText(column.default),
          generated: cleanText(column.generated),
          comment: cleanText(column.comment),
        })),
        ['position', 'name'],
      ),
    })),
    ['schema', 'name'],
  );
  return {
    schemaContract: P017_SCHEMA_CONTRACT,
    fingerprintContract: P017_FINGERPRINT_CONTRACT,
    postgresMajor: 17,
    relations,
    constraints: sortBy(
      (input.constraints ?? []).map((constraint) => ({
        schema: String(constraint.schema),
        table: String(constraint.table),
        name: String(constraint.name),
        type: String(constraint.type),
        columns: (constraint.columns ?? []).map(String),
        referencedSchema: cleanText(constraint.referencedSchema),
        referencedTable: cleanText(constraint.referencedTable),
        referencedColumns: (constraint.referencedColumns ?? []).map(String),
        definition: cleanText(constraint.definition),
      })),
      ['schema', 'table', 'type', 'name'],
    ),
    indexes: sortBy(
      (input.indexes ?? []).map((index) => ({
        schema: String(index.schema),
        table: String(index.table),
        name: String(index.name),
        unique: Boolean(index.unique),
        primary: Boolean(index.primary),
        valid: Boolean(index.valid),
        ready: Boolean(index.ready),
        definition: cleanText(index.definition),
      })),
      ['schema', 'table', 'name'],
    ),
    functions: sortBy(
      (input.functions ?? []).map((routine) => ({
        schema: String(routine.schema),
        name: String(routine.name),
        identityArguments: String(routine.identityArguments ?? ''),
        resultType: String(routine.resultType),
        kind: String(routine.kind),
        language: String(routine.language),
        securityDefiner: Boolean(routine.securityDefiner),
        volatility: String(routine.volatility),
        definitionHash: String(routine.definitionHash),
      })),
      ['schema', 'name', 'identityArguments'],
    ),
    triggers: sortBy(
      (input.triggers ?? []).map((trigger) => ({
        schema: String(trigger.schema),
        table: String(trigger.table),
        name: String(trigger.name),
        definition: cleanText(trigger.definition),
      })),
      ['schema', 'table', 'name'],
    ),
    policies: sortBy(
      (input.policies ?? []).map((policy) => ({
        schema: String(policy.schema),
        table: String(policy.table),
        name: String(policy.name),
        permissive: Boolean(policy.permissive),
        command: String(policy.command),
        roles: sortedText(policy.roles),
        using: cleanText(policy.using),
        check: cleanText(policy.check),
      })),
      ['schema', 'table', 'name'],
    ),
    grants: sortBy(
      (input.grants ?? []).map((grant) => ({
        schema: String(grant.schema),
        object: String(grant.object),
        objectType: String(grant.objectType),
        grantee: String(grant.grantee),
        privilege: String(grant.privilege),
        grantable: Boolean(grant.grantable),
      })),
      ['schema', 'object', 'grantee', 'privilege'],
    ),
    types: sortBy(
      (input.types ?? []).map((type) => ({
        schema: String(type.schema),
        name: String(type.name),
        kind: String(type.kind),
        labels: (type.labels ?? []).map(String),
      })),
      ['schema', 'name'],
    ),
  };
}

export function fingerprintSchemaModel(model) {
  const canonical = canonicalizeSchemaModel(model);
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export function summarizeSchemaModel(model) {
  const canonical = canonicalizeSchemaModel(model);
  const tables = canonical.relations.filter((relation) => relation.kind === 'table');
  return {
    relationCount: canonical.relations.length,
    tableCount: tables.length,
    viewCount: canonical.relations.filter((relation) => relation.kind === 'view').length,
    materializedViewCount: canonical.relations.filter(
      (relation) => relation.kind === 'materialized_view',
    ).length,
    columnCount: canonical.relations.reduce(
      (count, relation) => count + relation.columns.length,
      0,
    ),
    functionCount: canonical.functions.length,
    triggerCount: canonical.triggers.length,
    indexCount: canonical.indexes.length,
    primaryKeyCount: canonical.constraints.filter((constraint) => constraint.type === 'primary_key')
      .length,
    uniqueConstraintCount: canonical.constraints.filter(
      (constraint) => constraint.type === 'unique',
    ).length,
    foreignKeyCount: canonical.constraints.filter((constraint) => constraint.type === 'foreign_key')
      .length,
    checkConstraintCount: canonical.constraints.filter((constraint) => constraint.type === 'check')
      .length,
    protectedRlsTableCount: tables.filter((relation) => relation.rowSecurity).length,
    forceRlsTableCount: tables.filter((relation) => relation.forceRowSecurity).length,
    policyCount: canonical.policies.length,
    grantCount: canonical.grants.length,
    typeCount: canonical.types.length,
  };
}

function relationKind(relkind) {
  return { r: 'table', p: 'partitioned_table', v: 'view', m: 'materialized_view' }[relkind];
}

function constraintKind(contype) {
  return { p: 'primary_key', u: 'unique', f: 'foreign_key', c: 'check', x: 'exclusion' }[contype];
}

function functionKind(prokind) {
  return { f: 'function', p: 'procedure', a: 'aggregate', w: 'window' }[prokind] ?? prokind;
}

function volatilityKind(provolatile) {
  return { i: 'immutable', s: 'stable', v: 'volatile' }[provolatile] ?? provolatile;
}

export async function collectSchemaModel(client) {
  const relationsResult = await client.query(`
    select namespaces.nspname as schema_name,
           relations.relname as relation_name,
           relations.relkind,
           relations.relrowsecurity,
           relations.relforcerowsecurity,
           relations.reloptions,
           pg_catalog.obj_description(relations.oid, 'pg_class') as comment,
           case when relations.relkind in ('v', 'm')
                then pg_catalog.pg_get_viewdef(relations.oid, true)
                else null end as definition
      from pg_catalog.pg_class as relations
      join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
     where namespaces.nspname = 'ltc_m'
       and relations.relkind in ('r', 'p', 'v', 'm')
     order by namespaces.nspname, relations.relname`);

  const columnsResult = await client.query(`
    select namespaces.nspname as schema_name,
           relations.relname as relation_name,
           attributes.attnum as position,
           attributes.attname as column_name,
           pg_catalog.format_type(attributes.atttypid, attributes.atttypmod) as data_type,
           not attributes.attnotnull as nullable,
           pg_catalog.pg_get_expr(defaults.adbin, defaults.adrelid, true) as column_default,
           nullif(attributes.attgenerated, '') as generated,
           pg_catalog.col_description(relations.oid, attributes.attnum) as comment
      from pg_catalog.pg_attribute as attributes
      join pg_catalog.pg_class as relations on relations.oid = attributes.attrelid
      join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
      left join pg_catalog.pg_attrdef as defaults
        on defaults.adrelid = attributes.attrelid and defaults.adnum = attributes.attnum
     where namespaces.nspname = 'ltc_m'
       and relations.relkind in ('r', 'p', 'v', 'm')
       and attributes.attnum > 0
       and not attributes.attisdropped
     order by namespaces.nspname, relations.relname, attributes.attnum`);

  const constraintsResult = await client.query(`
    select namespaces.nspname as schema_name,
           relations.relname as table_name,
           constraints.conname as constraint_name,
           constraints.contype,
           coalesce((
             select array_agg(attributes.attname::text order by positions.ordinality)
               from unnest(constraints.conkey) with ordinality as positions(attnum, ordinality)
               join pg_catalog.pg_attribute as attributes
                 on attributes.attrelid = constraints.conrelid
                and attributes.attnum = positions.attnum
           ), array[]::text[]) as columns,
           referenced_namespaces.nspname as referenced_schema,
           referenced_relations.relname as referenced_table,
           coalesce((
             select array_agg(attributes.attname::text order by positions.ordinality)
               from unnest(constraints.confkey) with ordinality as positions(attnum, ordinality)
               join pg_catalog.pg_attribute as attributes
                 on attributes.attrelid = constraints.confrelid
                and attributes.attnum = positions.attnum
           ), array[]::text[]) as referenced_columns,
           pg_catalog.pg_get_constraintdef(constraints.oid, true) as definition
      from pg_catalog.pg_constraint as constraints
      join pg_catalog.pg_class as relations on relations.oid = constraints.conrelid
      join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
      left join pg_catalog.pg_class as referenced_relations
        on referenced_relations.oid = constraints.confrelid
      left join pg_catalog.pg_namespace as referenced_namespaces
        on referenced_namespaces.oid = referenced_relations.relnamespace
     where namespaces.nspname = 'ltc_m'
       and constraints.contype in ('p', 'u', 'f', 'c', 'x')
     order by namespaces.nspname, relations.relname, constraints.contype, constraints.conname`);

  const indexesResult = await client.query(`
    select namespaces.nspname as schema_name,
           relations.relname as table_name,
           indexes.relname as index_name,
           metadata.indisunique,
           metadata.indisprimary,
           metadata.indisvalid,
           metadata.indisready,
           pg_catalog.pg_get_indexdef(indexes.oid) as definition
      from pg_catalog.pg_index as metadata
      join pg_catalog.pg_class as indexes on indexes.oid = metadata.indexrelid
      join pg_catalog.pg_class as relations on relations.oid = metadata.indrelid
      join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
     where namespaces.nspname = 'ltc_m'
     order by namespaces.nspname, relations.relname, indexes.relname`);

  const functionsResult = await client.query(`
    select namespaces.nspname as schema_name,
           routines.proname as routine_name,
           pg_catalog.pg_get_function_identity_arguments(routines.oid) as identity_arguments,
           pg_catalog.pg_get_function_result(routines.oid) as result_type,
           routines.prokind,
           languages.lanname as language_name,
           routines.prosecdef,
           routines.provolatile,
           encode(sha256(convert_to(pg_catalog.pg_get_functiondef(routines.oid), 'UTF8')), 'hex')
             as definition_hash
      from pg_catalog.pg_proc as routines
      join pg_catalog.pg_namespace as namespaces on namespaces.oid = routines.pronamespace
      join pg_catalog.pg_language as languages on languages.oid = routines.prolang
     where namespaces.nspname = 'ltc_m'
       and routines.prokind in ('f', 'p')
     order by namespaces.nspname, routines.proname, identity_arguments`);

  const triggersResult = await client.query(`
    select namespaces.nspname as schema_name,
           relations.relname as table_name,
           triggers.tgname as trigger_name,
           pg_catalog.pg_get_triggerdef(triggers.oid, true) as definition
      from pg_catalog.pg_trigger as triggers
      join pg_catalog.pg_class as relations on relations.oid = triggers.tgrelid
      join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
     where namespaces.nspname = 'ltc_m'
       and not triggers.tgisinternal
     order by namespaces.nspname, relations.relname, triggers.tgname`);

  const policiesResult = await client.query(`
    select namespaces.nspname as schema_name,
           relations.relname as table_name,
           policies.polname as policy_name,
           policies.polpermissive,
           policies.polcmd,
           array(
             select roles.rolname::text
               from unnest(policies.polroles) as role_ids(role_oid)
               join pg_catalog.pg_roles as roles on roles.oid = role_ids.role_oid
              order by roles.rolname
           ) as roles,
           pg_catalog.pg_get_expr(policies.polqual, policies.polrelid, true) as using_expression,
           pg_catalog.pg_get_expr(policies.polwithcheck, policies.polrelid, true) as check_expression
      from pg_catalog.pg_policy as policies
      join pg_catalog.pg_class as relations on relations.oid = policies.polrelid
      join pg_catalog.pg_namespace as namespaces on namespaces.oid = relations.relnamespace
     where namespaces.nspname = 'ltc_m'
     order by namespaces.nspname, relations.relname, policies.polname`);

  const grantsResult = await client.query(`
    select table_schema as schema_name,
           table_name as object_name,
           'relation'::text as object_type,
           grantee,
           privilege_type,
           is_grantable = 'YES' as grantable
      from information_schema.table_privileges
     where table_schema = 'ltc_m'
       and grantee in ('ltc_m_runtime', 'PUBLIC')
    union all
    select routine_schema,
           routine_name,
           'routine'::text,
           grantee,
           privilege_type,
           is_grantable = 'YES'
      from information_schema.routine_privileges
     where routine_schema = 'ltc_m'
       and grantee in ('ltc_m_runtime', 'PUBLIC')
    union all
    select object_schema,
           object_name,
           object_type,
           grantee,
           privilege_type,
           is_grantable = 'YES'
      from information_schema.usage_privileges
     where object_schema = 'ltc_m'
       and grantee in ('ltc_m_runtime', 'PUBLIC')
     order by schema_name, object_name, grantee, privilege_type`);

  const typesResult = await client.query(`
    select namespaces.nspname as schema_name,
           types.typname as type_name,
           types.typtype,
           coalesce(array_agg(enums.enumlabel::text order by enums.enumsortorder)
             filter (where enums.enumlabel is not null), array[]::text[]) as labels
      from pg_catalog.pg_type as types
      join pg_catalog.pg_namespace as namespaces on namespaces.oid = types.typnamespace
      left join pg_catalog.pg_enum as enums on enums.enumtypid = types.oid
     where namespaces.nspname = 'ltc_m'
       and types.typtype in ('e', 'd')
     group by namespaces.nspname, types.typname, types.typtype
     order by namespaces.nspname, types.typname`);

  const columnsByRelation = new Map();
  for (const row of columnsResult.rows) {
    const key = `${row.schema_name}.${row.relation_name}`;
    const columns = columnsByRelation.get(key) ?? [];
    columns.push({
      position: row.position,
      name: row.column_name,
      type: row.data_type,
      nullable: row.nullable,
      default: row.column_default,
      generated: row.generated,
      comment: row.comment,
    });
    columnsByRelation.set(key, columns);
  }

  return canonicalizeSchemaModel({
    relations: relationsResult.rows.map((row) => ({
      schema: row.schema_name,
      name: row.relation_name,
      kind: relationKind(row.relkind),
      rowSecurity: row.relrowsecurity,
      forceRowSecurity: row.relforcerowsecurity,
      options: row.reloptions,
      comment: row.comment,
      definition: row.definition,
      columns: columnsByRelation.get(`${row.schema_name}.${row.relation_name}`) ?? [],
    })),
    constraints: constraintsResult.rows.map((row) => ({
      schema: row.schema_name,
      table: row.table_name,
      name: row.constraint_name,
      type: constraintKind(row.contype),
      columns: row.columns,
      referencedSchema: row.referenced_schema,
      referencedTable: row.referenced_table,
      referencedColumns: row.referenced_columns,
      definition: row.definition,
    })),
    indexes: indexesResult.rows.map((row) => ({
      schema: row.schema_name,
      table: row.table_name,
      name: row.index_name,
      unique: row.indisunique,
      primary: row.indisprimary,
      valid: row.indisvalid,
      ready: row.indisready,
      definition: row.definition,
    })),
    functions: functionsResult.rows.map((row) => ({
      schema: row.schema_name,
      name: row.routine_name,
      identityArguments: row.identity_arguments,
      resultType: row.result_type,
      kind: functionKind(row.prokind),
      language: row.language_name,
      securityDefiner: row.prosecdef,
      volatility: volatilityKind(row.provolatile),
      definitionHash: row.definition_hash,
    })),
    triggers: triggersResult.rows.map((row) => ({
      schema: row.schema_name,
      table: row.table_name,
      name: row.trigger_name,
      definition: row.definition,
    })),
    policies: policiesResult.rows.map((row) => ({
      schema: row.schema_name,
      table: row.table_name,
      name: row.policy_name,
      permissive: row.polpermissive,
      command: row.polcmd,
      roles: row.roles,
      using: row.using_expression,
      check: row.check_expression,
    })),
    grants: grantsResult.rows.map((row) => ({
      schema: row.schema_name,
      object: row.object_name,
      objectType: row.object_type,
      grantee: row.grantee,
      privilege: row.privilege_type,
      grantable: row.grantable,
    })),
    types: typesResult.rows.map((row) => ({
      schema: row.schema_name,
      name: row.type_name,
      kind: row.typtype === 'e' ? 'enum' : 'domain',
      labels: row.labels,
    })),
  });
}

function markdown(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value).replaceAll('|', '\\|').replaceAll('\n', '<br>');
}

function mermaidType(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9_]/gu, '_')
    .replace(/_+/gu, '_');
}

function relationConstraints(model, relation) {
  return model.constraints.filter(
    (constraint) => constraint.schema === relation.schema && constraint.table === relation.name,
  );
}

function primaryKey(model, relation) {
  return relationConstraints(model, relation).find(
    (constraint) => constraint.type === 'primary_key',
  );
}

function logicalKey(model, relation) {
  const p016 = P016_VIEW_CONTRACTS[relation.name];
  if (p016) return p016.key;
  const primary = primaryKey(model, relation);
  return primary ? primary.columns.join(' + ') : 'sem chave primária declarada';
}

function relationGrain(model, relation) {
  const p016 = P016_VIEW_CONTRACTS[relation.name];
  if (p016) return p016.grain;
  const primary = primaryKey(model, relation);
  return primary ? `uma linha por ${primary.columns.join(' + ')}` : 'grão não declarado no schema';
}

export function renderErd(snapshot) {
  const model = canonicalizeSchemaModel(snapshot.model ?? snapshot);
  const tables = model.relations.filter((relation) => relation.kind === 'table');
  const foreignKeys = model.constraints.filter((constraint) => constraint.type === 'foreign_key');
  const lines = [
    '# ERD do schema `ltc_m`',
    '',
    `Contrato: \`${P017_SCHEMA_CONTRACT}\``,
    `Fingerprint: \`${snapshot.fingerprint ?? fingerprintSchemaModel(model)}\``,
    '',
    'Arquivo gerado deterministicamente a partir do modelo canônico capturado em PostgreSQL 17.',
    'Não editar manualmente; use `npm run docs:schema:generate` e valide com',
    '`npm run docs:schema:check`.',
    '',
    '## Entidades e relacionamentos',
    '',
    '```mermaid',
    'erDiagram',
  ];
  for (const relation of tables) {
    const constraints = relationConstraints(model, relation);
    const pkColumns = new Set(
      constraints.find((constraint) => constraint.type === 'primary_key')?.columns ?? [],
    );
    const fkColumns = new Set(
      constraints
        .filter((constraint) => constraint.type === 'foreign_key')
        .flatMap((constraint) => constraint.columns),
    );
    lines.push(`  ${relation.name} {`);
    for (const column of relation.columns) {
      const markers = [
        pkColumns.has(column.name) ? 'PK' : '',
        fkColumns.has(column.name) ? 'FK' : '',
      ]
        .filter(Boolean)
        .join(',');
      lines.push(`    ${mermaidType(column.type)} ${column.name}${markers ? ` ${markers}` : ''}`);
    }
    lines.push('  }');
  }
  for (const foreignKey of foreignKeys) {
    if (foreignKey.referencedSchema !== 'ltc_m') continue;
    lines.push(`  ${foreignKey.referencedTable} ||--o{ ${foreignKey.table} : "${foreignKey.name}"`);
  }
  lines.push('```', '', '## Camada analítica derivada', '', '```mermaid', 'flowchart LR');
  for (const name of Object.keys(P016_VIEW_CONTRACTS).sort(compareText)) {
    lines.push(`  ${name}["${name}"]`);
  }
  lines.push(
    '  BASE["19 tabelas protegidas por RLS/FORCE RLS"] --> v_tableau_portfolio_overview',
    '  BASE --> v_tableau_project_overview',
    '  BASE --> v_tableau_project_items',
    '  BASE --> v_tableau_financial_monthly',
    '  BASE --> v_tableau_s_curve_portfolio',
    '  BASE --> v_tableau_s_curve_project',
    '  BASE --> v_tableau_data_quality',
    '  BASE --> v_tableau_plan_versions',
    '  BASE --> v_tableau_source_provenance',
    '```',
    '',
    'As setas da camada analítica indicam derivação, não FKs. Grãos e chaves das views são',
    'definidos no dicionário e no contrato P016.',
    '',
  );
  return lines.join('\n');
}

export function renderDataDictionary(snapshot) {
  const model = canonicalizeSchemaModel(snapshot.model ?? snapshot);
  const summary = snapshot.summary ?? summarizeSchemaModel(model);
  const fingerprint = snapshot.fingerprint ?? fingerprintSchemaModel(model);
  const lines = [
    '# Dicionário de dados do schema `ltc_m`',
    '',
    `Contrato: \`${P017_SCHEMA_CONTRACT}\``,
    `Fingerprint: \`${fingerprint}\``,
    '',
    `Inventário: ${summary.relationCount} relações (${summary.tableCount} tabelas, ${summary.viewCount} views), ` +
      `${summary.columnCount} colunas, ${summary.foreignKeyCount} FKs e ${summary.policyCount} policies.`,
    '',
    'O conteúdo é gerado do modelo canônico PostgreSQL 17. Descrições ausentes são declaradas como',
    'ausentes, sem inferência de negócio. Valores financeiros `numeric` permanecem exatos; sua',
    'aditividade depende do grão documentado.',
    '',
  ];
  for (const relation of model.relations) {
    const constraints = relationConstraints(model, relation);
    const foreignKeys = constraints.filter((constraint) => constraint.type === 'foreign_key');
    const uniqueIdentities = [
      ...constraints
        .filter((constraint) => constraint.type === 'unique')
        .map((constraint) => `\`${constraint.name}\`: ${constraint.definition}`),
      ...model.indexes
        .filter(
          (index) =>
            index.schema === relation.schema &&
            index.table === relation.name &&
            index.unique &&
            !index.primary,
        )
        .map((index) => `\`${index.name}\`: ${index.definition}`),
    ];
    const foreignKeyByColumn = new Map();
    for (const foreignKey of foreignKeys) {
      foreignKey.columns.forEach((column, index) => {
        foreignKeyByColumn.set(
          column,
          `${foreignKey.referencedSchema}.${foreignKey.referencedTable}.${foreignKey.referencedColumns[index] ?? '?'}`,
        );
      });
    }
    lines.push(`## \`${relation.schema}.${relation.name}\``, '');
    lines.push(`- Tipo: \`${relation.kind}\`.`);
    lines.push(`- Contrato proprietário: ${RELATION_CONTRACT_OWNERS[relation.name] ?? 'Core'}.`);
    lines.push(
      `- Propósito versionado: ${markdown(relation.comment ?? 'COMMENT não definido no schema')}.`,
    );
    lines.push(`- Grão: ${relationGrain(model, relation)}.`);
    lines.push(`- Chave primária/lógica: ${logicalKey(model, relation)}.`);
    lines.push(
      `- Identidades exclusivas adicionais: ${
        uniqueIdentities.length > 0 ? uniqueIdentities.join('; ') : 'nenhuma além da chave primária'
      }.`,
    );
    if (relation.kind === 'table') {
      lines.push(
        `- Segurança: RLS=${relation.rowSecurity}; FORCE RLS=${relation.forceRowSecurity}; ` +
          `${model.policies.filter((policy) => policy.table === relation.name).length} policies.`,
      );
    } else if (P016_VIEW_CONTRACTS[relation.name]) {
      lines.push(
        '- Semântica analítica: moeda e versão/status explícitos; métricas somente aditivas dentro ' +
          'do grão; realizado ausente permanece NULL e a evidência P014 não é alocada.',
      );
      lines.push(
        `- Segurança: options=${relation.options.join(', ')}; SELECT respeita grants e RLS das tabelas-base.`,
      );
    }
    lines.push('', '| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const column of relation.columns) {
      const generated = column.generated
        ? `generated=${column.generated}; ${column.default ?? ''}`
        : column.default;
      const numericNote = column.type.startsWith('numeric')
        ? 'Precisão financeira PostgreSQL; sem conversão para float.'
        : null;
      lines.push(
        `| \`${column.name}\` | \`${markdown(column.type)}\` | ${column.nullable ? 'sim' : 'não'} | ` +
          `${markdown(generated)} | ${markdown(foreignKeyByColumn.get(column.name))} | ` +
          `${markdown(column.comment ?? numericNote)} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function renderIntegrityValidation(snapshot) {
  const model = canonicalizeSchemaModel(snapshot.model ?? snapshot);
  const summary = snapshot.summary ?? summarizeSchemaModel(model);
  const fingerprint = snapshot.fingerprint ?? fingerprintSchemaModel(model);
  const lines = [
    '# P017 — validação global de integridade e idempotência',
    '',
    `Contrato do schema: \`${P017_SCHEMA_CONTRACT}\``,
    `Contrato do fingerprint: \`${P017_FINGERPRINT_CONTRACT}\``,
    `Fingerprint nominal: \`${fingerprint}\``,
    '',
    '## Inventário nominal',
    '',
    '| Medida | Quantidade |',
    '| --- | ---: |',
    `| \`migrationCount\` | ${snapshot.migrationCount ?? 13} |`,
    ...Object.entries(summary).map(([name, count]) => `| \`${name}\` | ${count} |`),
    '',
    'O inventário exclui OIDs, timestamps de criação, owners e identificadores físicos incidentais.',
    'A ordenação é canônica e o hash usa SHA-256. O teste PostgreSQL compara semanticamente o modelo',
    'capturado from-zero com `docs/database/p017-schema-model.json`.',
    '',
    '## Matriz de idempotência',
    '',
    '| Fluxo | Contrato proprietário | Comportamento de rerun | Evidência P017 |',
    '| --- | --- | --- | --- |',
    '| Projeto | P011 | mesma identidade `project_code`; sem crescimento lógico | suíte P011/P012 + acceptance PostgreSQL |',
    '| Item | P012 | `project_id + source_line_key`; `item_code` repetido é permitido | suíte P012 + duplicate scan |',
    '| Baseline mensal | P013 | versão + métrica e fingerprint semântico estáveis | suíte P013 + duplicate scan |',
    '| Batch/artefato/execução | P009/P013 | idempotency key, hash e recibo não duplicam execução lógica | constraints + rerun fixture |',
    '| Linhas financeiras | P013 | identidade material preservada; zero explícito distinto de blank | suíte P013 + totals/fingerprint |',
    '| Eventos realizados | Core/P014 | source key única; P014 não fabrica eventos | unique scan + regressão P014 |',
    '| Reconciliação | P015 | read-only e determinística | suíte P015 |',
    '| Views analíticas | P016 | SELECT read-only; mesma chave/fingerprint | 9 views + RLS smoke |',
    '',
    'A aplicação das migrations é one-shot e ordenada. “Pipeline duas vezes” significa recriar o',
    'schema from-zero e repetir fluxos de bootstrap/importação aplicáveis, não executar DDL histórico',
    'duas vezes sobre o mesmo schema.',
    '',
    '## Bootstrap e seeds',
    '',
    '- `supabase/seed.sql`: `IDEMPOTENT`, restrito a BRL e US.',
    '- bootstrap de roles do CI: `ONE_SHOT_BUT_GUARDED`, com preflight e cleanup.',
    '- fixtures PostgreSQL P012–P017: `TEST_ONLY` e sintéticas.',
    '- dados de produção ou `.local-source`: `NOT_APPLICABLE` para P017.',
    '',
    '## Papéis e fronteira de segurança',
    '',
    '- `ltc_m_runtime`: papel `NOLOGIN`, `NOSUPERUSER` e `NOBYPASSRLS` criado defensivamente pela P008.',
    '- `postgres`: operador sintético do cluster isolado; a associação temporária usada pelo teste é revogada em `finally`.',
    '- `PUBLIC`: não recebe acesso às nove views P016; grants contratuais são capturados no fingerprint.',
    '- A matriz dinâmica cobre admin, viewer, contexto ausente e ator inválido sem depender de superuser no caminho de negócio.',
    '',
    '## Precisão, reconciliação e decisões pendentes',
    '',
    'P017 reutiliza o decimal exato P013/P014: escala, half-away-from-zero, signed zero, carry,',
    'overflow e negativos são cobertos pelas suítes proprietárias sem `Number` autoritativo.',
    'Findings P015 aprovados e decisões de negócio pendentes não são falhas técnicas. P014 permanece',
    'controlled impossibility: zero alocações e zero eventos realizados fabricados.',
    '',
    '## Drift e documentação',
    '',
    '- `npm run docs:schema:generate`: regenera ERD/dicionário a partir do snapshot canônico.',
    '- `npm run docs:schema:check`: falha se os documentos não correspondem ao snapshot.',
    '- `npm run p017:check`: valida contratos, inventários P008/P016, CI e artefatos.',
    '- `npm run test:p017:postgres`: compara PostgreSQL 17 from-zero ao snapshot e exercita integridade, RLS e rerun.',
    '',
    'Nenhuma credencial Tableau, Extract ou agenda de refresh é criada pela P017.',
    '',
  ];
  return lines.join('\n');
}
