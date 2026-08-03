-- P009 / 1.09 — inspeção remota read-only antes da aplicação.
select pg_catalog.jsonb_build_object(
    'server_version', pg_catalog.current_setting('server_version'),
    'p009_objects', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relname in ('import_batch_sheets', 'import_staging_rows')
    ),
    'ltcm_table_count', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relkind = 'r'
    ),
    'rls_force_table_count', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relkind = 'r'
          and pg_class.relrowsecurity
          and pg_class.relforcerowsecurity
    ),
    'policy_count', (
        select count(*) from pg_catalog.pg_policies where schemaname = 'ltc_m'
    ),
    'runtime_function_count', (
        select count(*)
        from pg_catalog.pg_proc
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_catalog.has_function_privilege('ltc_m_runtime', pg_proc.oid, 'EXECUTE')
    ),
    'public_function_count', (
        select count(*)
        from pg_catalog.pg_proc
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_proc.pronamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_catalog.has_function_privilege('public', pg_proc.oid, 'EXECUTE')
    ),
    'runtime_role', (
        select pg_catalog.jsonb_build_object(
            'name', rolname,
            'login', rolcanlogin,
            'bypass_rls', rolbypassrls
        )
        from pg_catalog.pg_roles
        where rolname = 'ltc_m_runtime'
    ),
    'd26_membership', (
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'granted_role', granted_role.rolname,
            'member_role', member_role.rolname,
            'grantor', pg_catalog.pg_get_userbyid(pg_auth_members.grantor),
            'admin_option', pg_auth_members.admin_option,
            'inherit_option', pg_auth_members.inherit_option,
            'set_option', pg_auth_members.set_option
        ))
        from pg_catalog.pg_auth_members
        join pg_catalog.pg_roles granted_role on granted_role.oid = pg_auth_members.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = pg_auth_members.member
        where granted_role.rolname = 'ltc_m_runtime'
           or member_role.rolname = 'ltc_m_runtime'
    ),
    'reference_data', pg_catalog.jsonb_build_object(
        'BRL', (select count(*) from ltc_m.currencies where code = 'BRL'),
        'US', (select count(*) from ltc_m.units where code = 'US')
    ),
    'counts', pg_catalog.jsonb_build_object(
        'app_users', (select count(*) from ltc_m.app_users),
        'import_batches', (select count(*) from ltc_m.import_batches),
        'import_row_errors', (select count(*) from ltc_m.import_row_errors),
        'audit_log', (select count(*) from ltc_m.audit_log)
    )
) as p009_preflight;
