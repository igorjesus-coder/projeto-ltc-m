-- D43 — estado final sanitizado do banco efêmero, executado após cleanup D27.

do $ci_final_state$
declare
    v_functions oid[] := array[
        'ltc_m.enforce_project_legacy_reference_date()'::regprocedure::oid,
        'ltc_m.enforce_import_batch_rejection_guard()'::regprocedure::oid
    ];
begin
    if current_database() <> 'ltcm_ci' or session_user <> 'postgres' then
        raise exception 'Estado final CI está fora do banco ou executor sintético esperado.';
    end if;

    if (
        select count(*)
        from pg_catalog.pg_proc
        join pg_catalog.pg_roles on pg_roles.oid = pg_proc.proowner
        where pg_proc.oid = any (v_functions)
          and pg_roles.rolname = 'postgres'
          and pg_proc.prosecdef
          and exists (
              select 1
              from pg_catalog.unnest(pg_proc.proconfig) as setting
              where setting = 'search_path=""'
          )
    ) <> pg_catalog.cardinality(v_functions) then
        raise exception 'Estado final CI encontrou owner, SECURITY DEFINER ou search_path divergente.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_proc
        cross join lateral pg_catalog.aclexplode(
            coalesce(pg_proc.proacl, pg_catalog.acldefault('f', pg_proc.proowner))
        ) as acl
        where pg_proc.oid = any (v_functions)
          and acl.grantee <> pg_proc.proowner
          and acl.privilege_type = 'EXECUTE'
    ) or exists (
        select 1
        from pg_catalog.unnest(v_functions) as checked_function(function_oid)
        where pg_catalog.has_function_privilege(
            'ltc_m_runtime',
            checked_function.function_oid,
            'EXECUTE'
        )
    ) then
        raise exception 'Estado final CI encontrou EXECUTE não aprovado na guarda D41.';
    end if;

    if (
        select count(*)
        from pg_catalog.pg_auth_members
        where roleid = 'ltc_m_runtime'::regrole
          and member = 'postgres'::regrole
    ) <> 1
        or not exists (
            select 1
            from pg_catalog.pg_auth_members
            where roleid = 'ltc_m_runtime'::regrole
              and member = 'postgres'::regrole
              and pg_catalog.pg_get_userbyid(grantor) = 'supabase_admin'
              and admin_option
              and not inherit_option
              and not set_option
        )
        or pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
    then
        raise exception 'Estado final CI não restaurou D26 exatamente.';
    end if;

    if (select count(*) from ltc_m.currencies where code = 'BRL') <> 1
        or (select count(*) from ltc_m.units where code = 'US') <> 1
        or (select count(*) from ltc_m.app_users) <> 0
        or (select count(*) from ltc_m.clients) <> 0
        or (select count(*) from ltc_m.projects) <> 0
        or (select count(*) from ltc_m.project_items) <> 0
        or (select count(*) from ltc_m.plan_versions) <> 0
        or (select count(*) from ltc_m.financial_plan_scopes) <> 0
        or (select count(*) from ltc_m.financial_plan_lines) <> 0
        or (select count(*) from ltc_m.financial_actual_events) <> 0
        or (select count(*) from ltc_m.import_batches) <> 0
        or (select count(*) from ltc_m.import_batch_sheets) <> 0
        or (select count(*) from ltc_m.import_staging_rows) <> 0
        or (select count(*) from ltc_m.import_row_errors) <> 0
        or (select count(*) from ltc_m.audit_log) <> 0
    then
        raise exception 'Estado final CI encontrou fixture operacional persistente.';
    end if;
end;
$ci_final_state$;

select pg_catalog.jsonb_build_object(
    'postgres_version', current_setting('server_version'),
    'server_encoding', current_setting('server_encoding'),
    'locale', (
        select pg_catalog.jsonb_build_object(
            'collate', pg_database.datcollate,
            'ctype', pg_database.datctype
        )
        from pg_catalog.pg_database
        where pg_database.datname = current_database()
    ),
    'timezone', current_setting('TimeZone'),
    'd41_security', pg_catalog.jsonb_build_object(
        'functions', pg_catalog.jsonb_build_array(
            'ltc_m.enforce_project_legacy_reference_date()',
            'ltc_m.enforce_import_batch_rejection_guard()'
        ),
        'function_count', 2,
        'owner', 'postgres',
        'acl', 'restricted',
        'security_definer', true,
        'search_path_empty', true,
        'public_execute', false,
        'runtime_execute', false
    ),
    'rollback_clean', true,
    'final_counts', pg_catalog.jsonb_build_object(
        'currencies_brl', (select count(*) from ltc_m.currencies where code = 'BRL'),
        'units_us', (select count(*) from ltc_m.units where code = 'US'),
        'operational_fixtures', 0
    )
) as ltcm_ci_final_state;
