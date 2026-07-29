-- Consulta exclusivamente read-only para inventário sanitizado de metadados.
-- Não retorna linhas de domínio, e-mails, textos de funções ou definições SQL.
with user_schemas as (
    select
        pg_namespace.oid,
        pg_namespace.nspname as schema_name,
        pg_get_userbyid(pg_namespace.nspowner) as owner_name
    from pg_namespace
    where
        pg_namespace.nspname <> 'information_schema'
        and pg_namespace.nspname !~ '^pg_'
),
inventory as (
    select
        'schema'::text as object_kind,
        user_schemas.schema_name,
        user_schemas.schema_name as object_name,
        'owner=' || user_schemas.owner_name as detail,
        md5(user_schemas.owner_name) as definition_hash
    from user_schemas

    union all

    select
        case pg_class.relkind
            when 'r' then 'table'
            when 'p' then 'partitioned_table'
            when 'v' then 'view'
            when 'm' then 'materialized_view'
            when 'S' then 'sequence'
            when 'f' then 'foreign_table'
        end,
        user_schemas.schema_name,
        pg_class.relname,
        concat_ws(
            ';',
            'owner=' || pg_get_userbyid(pg_class.relowner),
            'persistence=' || pg_class.relpersistence::text,
            'rls=' || pg_class.relrowsecurity::text,
            'force_rls=' || pg_class.relforcerowsecurity::text
        ),
        md5(
            concat_ws(
                '|',
                pg_class.relkind,
                pg_class.relpersistence,
                pg_class.relrowsecurity,
                pg_class.relforcerowsecurity,
                coalesce(pg_class.reloptions::text, ''),
                coalesce(pg_class.relacl::text, ''),
                case
                    when pg_class.relkind in ('v', 'm')
                        then pg_get_viewdef(pg_class.oid, true)
                    else ''
                end
            )
        )
    from pg_class
    join user_schemas
        on user_schemas.oid = pg_class.relnamespace
    where pg_class.relkind in ('r', 'p', 'v', 'm', 'S', 'f')

    union all

    select
        'column',
        user_schemas.schema_name,
        pg_class.relname || '.' || pg_attribute.attname,
        concat_ws(
            ';',
            'position=' || pg_attribute.attnum,
            'type=' || format_type(pg_attribute.atttypid, pg_attribute.atttypmod),
            'not_null=' || pg_attribute.attnotnull::text,
            'identity=' || nullif(pg_attribute.attidentity::text, ''),
            'generated=' || nullif(pg_attribute.attgenerated::text, '')
        ),
        md5(
            concat_ws(
                '|',
                pg_attribute.attnum,
                format_type(pg_attribute.atttypid, pg_attribute.atttypmod),
                pg_attribute.attnotnull,
                pg_attribute.attidentity,
                pg_attribute.attgenerated,
                coalesce(pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid), '')
            )
        )
    from pg_attribute
    join pg_class
        on pg_class.oid = pg_attribute.attrelid
    join user_schemas
        on user_schemas.oid = pg_class.relnamespace
    left join pg_attrdef
        on pg_attrdef.adrelid = pg_attribute.attrelid
        and pg_attrdef.adnum = pg_attribute.attnum
    where
        pg_class.relkind in ('r', 'p', 'v', 'm', 'f')
        and pg_attribute.attnum > 0
        and not pg_attribute.attisdropped

    union all

    select
        'function',
        user_schemas.schema_name,
        pg_proc.proname || '(' || pg_get_function_identity_arguments(pg_proc.oid) || ')',
        concat_ws(
            ';',
            'kind=' || pg_proc.prokind::text,
            'language=' || pg_language.lanname,
            'result=' || pg_get_function_result(pg_proc.oid),
            'security_definer=' || pg_proc.prosecdef::text,
            'volatility=' || pg_proc.provolatile::text,
            'owner=' || pg_get_userbyid(pg_proc.proowner)
        ),
        md5(
            pg_get_functiondef(pg_proc.oid)
            || coalesce(pg_proc.proacl::text, '')
        )
    from pg_proc
    join user_schemas
        on user_schemas.oid = pg_proc.pronamespace
    join pg_language
        on pg_language.oid = pg_proc.prolang

    union all

    select
        'constraint',
        user_schemas.schema_name,
        pg_class.relname || '.' || pg_constraint.conname,
        'type=' || pg_constraint.contype::text,
        md5(pg_get_constraintdef(pg_constraint.oid, true))
    from pg_constraint
    join pg_class
        on pg_class.oid = pg_constraint.conrelid
    join user_schemas
        on user_schemas.oid = pg_class.relnamespace

    union all

    select
        'index',
        user_schemas.schema_name,
        pg_class.relname || '.' || pg_index_class.relname,
        concat_ws(
            ';',
            'unique=' || pg_index.indisunique::text,
            'primary=' || pg_index.indisprimary::text,
            'valid=' || pg_index.indisvalid::text
        ),
        md5(pg_get_indexdef(pg_index.indexrelid))
    from pg_index
    join pg_class
        on pg_class.oid = pg_index.indrelid
    join pg_class as pg_index_class
        on pg_index_class.oid = pg_index.indexrelid
    join user_schemas
        on user_schemas.oid = pg_class.relnamespace

    union all

    select
        'type',
        user_schemas.schema_name,
        pg_type.typname,
        concat_ws(
            ';',
            'kind=' || pg_type.typtype::text,
            'category=' || pg_type.typcategory::text,
            'owner=' || pg_get_userbyid(pg_type.typowner)
        ),
        md5(
            concat_ws(
                '|',
                pg_type.typtype,
                pg_type.typcategory,
                coalesce(
                    (
                        select string_agg(
                            pg_enum.enumlabel,
                            ',' order by pg_enum.enumsortorder
                        )
                        from pg_enum
                        where pg_enum.enumtypid = pg_type.oid
                    ),
                    ''
                )
            )
        )
    from pg_type
    join user_schemas
        on user_schemas.oid = pg_type.typnamespace
    where pg_type.typtype in ('e', 'd', 'c', 'r')

    union all

    select
        'sequence_config',
        user_schemas.schema_name,
        pg_class.relname,
        concat_ws(
            ';',
            'type=' || format_type(pg_sequence.seqtypid, null),
            'start=' || pg_sequence.seqstart,
            'increment=' || pg_sequence.seqincrement,
            'minimum=' || pg_sequence.seqmin,
            'maximum=' || pg_sequence.seqmax,
            'cache=' || pg_sequence.seqcache,
            'cycle=' || pg_sequence.seqcycle::text
        ),
        md5(pg_sequence::text)
    from pg_sequence
    join pg_class
        on pg_class.oid = pg_sequence.seqrelid
    join user_schemas
        on user_schemas.oid = pg_class.relnamespace

    union all

    select
        'trigger',
        user_schemas.schema_name,
        pg_class.relname || '.' || pg_trigger.tgname,
        'enabled=' || pg_trigger.tgenabled::text,
        md5(pg_get_triggerdef(pg_trigger.oid, true))
    from pg_trigger
    join pg_class
        on pg_class.oid = pg_trigger.tgrelid
    join user_schemas
        on user_schemas.oid = pg_class.relnamespace
    where not pg_trigger.tgisinternal

    union all

    select
        'policy',
        user_schemas.schema_name,
        pg_class.relname || '.' || pg_policy.polname,
        concat_ws(
            ';',
            'command=' || pg_policy.polcmd::text,
            'permissive=' || pg_policy.polpermissive::text
        ),
        md5(
            concat_ws(
                '|',
                pg_policy.polroles::text,
                coalesce(pg_get_expr(pg_policy.polqual, pg_policy.polrelid), ''),
                coalesce(pg_get_expr(pg_policy.polwithcheck, pg_policy.polrelid), '')
            )
        )
    from pg_policy
    join pg_class
        on pg_class.oid = pg_policy.polrelid
    join user_schemas
        on user_schemas.oid = pg_class.relnamespace
)
select
    inventory.object_kind,
    inventory.schema_name,
    inventory.object_name,
    inventory.detail,
    inventory.definition_hash
from inventory
order by
    inventory.schema_name,
    inventory.object_kind,
    inventory.object_name;
