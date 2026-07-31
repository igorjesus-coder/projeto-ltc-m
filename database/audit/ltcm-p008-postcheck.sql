-- P008 / 1.08 — pós-check exclusivamente read-only.
select pg_catalog.jsonb_build_object(
    'session_user', session_user,
    'current_user', current_user,
    'runtime_role', (
        select pg_catalog.to_jsonb(runtime_role)
        from (
            select
                pg_roles.rolname as name,
                pg_roles.rolcanlogin as login,
                pg_roles.rolsuper as superuser,
                pg_roles.rolcreatedb as create_db,
                pg_roles.rolcreaterole as create_role,
                pg_roles.rolreplication as replication,
                pg_roles.rolbypassrls as bypass_rls
            from pg_catalog.pg_roles
            where pg_roles.rolname = 'ltc_m_runtime'
        ) as runtime_role
    ),
    'runtime_memberships', (
        select coalesce(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'granted_role', granted_role.rolname,
                    'member_role', member_role.rolname,
                    'grantor', pg_catalog.pg_get_userbyid(pg_auth_members.grantor),
                    'admin_option', pg_auth_members.admin_option,
                    'inherit_option', pg_auth_members.inherit_option,
                    'set_option', pg_auth_members.set_option
                ) order by granted_role.rolname, member_role.rolname
            ),
            '[]'::jsonb
        )
        from pg_catalog.pg_auth_members
        join pg_catalog.pg_roles as granted_role
            on granted_role.oid = pg_auth_members.roleid
        join pg_catalog.pg_roles as member_role
            on member_role.oid = pg_auth_members.member
        where
            granted_role.rolname = 'ltc_m_runtime'
            or member_role.rolname = 'ltc_m_runtime'
    ),
    'rls_force_tables', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relkind = 'r'
            and pg_class.relrowsecurity
            and pg_class.relforcerowsecurity
    ),
    'policy_count', (
        select count(*)
        from pg_catalog.pg_policies
        where pg_policies.schemaname = 'ltc_m'
    ),
    'unsafe_policy_count', (
        select count(*)
        from pg_catalog.pg_policies
        where
            pg_policies.schemaname = 'ltc_m'
            and (
                pg_policies.cmd in ('ALL', 'DELETE')
                or pg_policies.roles <> array['ltc_m_runtime']::name[]
            )
    ),
    'runtime_function_count', (
        select count(*)
        from pg_catalog.pg_proc
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_proc.pronamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_catalog.has_function_privilege(
                'ltc_m_runtime',
                pg_proc.oid,
                'EXECUTE'
            )
    ),
    'runtime_functions', (
        select pg_catalog.jsonb_agg(
            pg_proc.proname || '(' ||
                pg_catalog.pg_get_function_identity_arguments(pg_proc.oid) || ')'
            order by pg_proc.proname
        )
        from pg_catalog.pg_proc
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_proc.pronamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_catalog.has_function_privilege(
                'ltc_m_runtime',
                pg_proc.oid,
                'EXECUTE'
            )
    ),
    'public_function_count', (
        select count(*)
        from pg_catalog.pg_proc
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_proc.pronamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_catalog.has_function_privilege('public', pg_proc.oid, 'EXECUTE')
    ),
    'runtime_external_direct_grants', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        cross join lateral pg_catalog.aclexplode(pg_class.relacl) as acl
        where
            acl.grantee = 'ltc_m_runtime'::regrole
            and pg_namespace.nspname <> 'ltc_m'
    ),
    'runtime_forbidden_table_privileges', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relkind = 'r'
            and pg_catalog.has_table_privilege(
                'ltc_m_runtime',
                pg_class.oid,
                'DELETE,TRUNCATE,REFERENCES,TRIGGER'
            )
    ),
    'runtime_audit_direct_access', pg_catalog.has_table_privilege(
        'ltc_m_runtime',
        'ltc_m.audit_log',
        'SELECT,INSERT,UPDATE,DELETE'
    ),
    'runtime_auth_subject_select', pg_catalog.has_column_privilege(
        'ltc_m_runtime',
        'ltc_m.app_users',
        'auth_subject',
        'SELECT'
    ),
    'ltcm_named_roles', (
        select pg_catalog.jsonb_agg(pg_roles.rolname order by pg_roles.rolname)
        from pg_catalog.pg_roles
        where pg_roles.rolname like 'ltc_m%'
    ),
    'runtime_owns_objects', (
        select count(*)
        from pg_catalog.pg_class
        where pg_class.relowner = 'ltc_m_runtime'::regrole
    ),
    'reference_data', pg_catalog.jsonb_build_object(
        'BRL', (select count(*) from ltc_m.currencies where code = 'BRL'),
        'US', (select count(*) from ltc_m.units where code = 'US')
    ),
    'counts', pg_catalog.jsonb_build_object(
        'app_users', (select count(*) from ltc_m.app_users),
        'clients', (select count(*) from ltc_m.clients),
        'projects', (select count(*) from ltc_m.projects),
        'project_items', (select count(*) from ltc_m.project_items),
        'plan_versions', (select count(*) from ltc_m.plan_versions),
        'financial_plan_scopes', (select count(*) from ltc_m.financial_plan_scopes),
        'financial_plan_lines', (select count(*) from ltc_m.financial_plan_lines),
        'financial_actual_events', (select count(*) from ltc_m.financial_actual_events),
        'import_batches', (select count(*) from ltc_m.import_batches),
        'import_row_errors', (select count(*) from ltc_m.import_row_errors),
        'audit_log', (select count(*) from ltc_m.audit_log)
    )
) as p008_postcheck;
