-- P008 / 1.08 — inspeção exclusivamente read-only de catálogo e contagens.
-- Não retorna dados de domínio, textos de função, credenciais ou project ref.
select pg_catalog.jsonb_build_object(
    'server_version', pg_catalog.current_setting('server_version'),
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
    'tables', (
        select coalesce(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'name', pg_class.relname,
                    'owner', pg_catalog.pg_get_userbyid(pg_class.relowner),
                    'rls', pg_class.relrowsecurity,
                    'force_rls', pg_class.relforcerowsecurity
                ) order by pg_class.relname
            ),
            '[]'::jsonb
        )
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relkind = 'r'
    ),
    'functions', (
        select coalesce(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'signature', pg_proc.proname || '(' ||
                        pg_catalog.pg_get_function_identity_arguments(pg_proc.oid) || ')',
                    'owner', pg_catalog.pg_get_userbyid(pg_proc.proowner),
                    'security_definer', pg_proc.prosecdef,
                    'search_path', pg_proc.proconfig,
                    'public_execute', pg_catalog.has_function_privilege(
                        'public',
                        pg_proc.oid,
                        'EXECUTE'
                    ),
                    'runtime_execute', pg_catalog.has_function_privilege(
                        'ltc_m_runtime',
                        pg_proc.oid,
                        'EXECUTE'
                    )
                ) order by
                    pg_proc.proname,
                    pg_catalog.pg_get_function_identity_arguments(pg_proc.oid)
            ),
            '[]'::jsonb
        )
        from pg_catalog.pg_proc
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_proc.pronamespace
        where pg_namespace.nspname = 'ltc_m'
    ),
    'policies', (
        select coalesce(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'table', pg_policies.tablename,
                    'name', pg_policies.policyname,
                    'permissive', pg_policies.permissive,
                    'roles', pg_policies.roles,
                    'command', pg_policies.cmd,
                    'has_using', pg_policies.qual is not null,
                    'has_with_check', pg_policies.with_check is not null
                ) order by pg_policies.tablename, pg_policies.policyname
            ),
            '[]'::jsonb
        )
        from pg_catalog.pg_policies
        where pg_policies.schemaname = 'ltc_m'
    ),
    'table_grants', (
        select coalesce(
            pg_catalog.jsonb_agg(
                pg_catalog.to_jsonb(role_table_grants)
                order by
                    role_table_grants.table_name,
                    role_table_grants.grantee,
                    role_table_grants.privilege_type
            ),
            '[]'::jsonb
        )
        from information_schema.role_table_grants
        where role_table_grants.table_schema = 'ltc_m'
    ),
    'default_privileges', (
        select coalesce(
            pg_catalog.jsonb_agg(
                pg_catalog.jsonb_build_object(
                    'owner', pg_catalog.pg_get_userbyid(pg_default_acl.defaclrole),
                    'schema', pg_namespace.nspname,
                    'object_type', pg_default_acl.defaclobjtype,
                    'acl', pg_default_acl.defaclacl::text
                ) order by
                    pg_catalog.pg_get_userbyid(pg_default_acl.defaclrole),
                    pg_default_acl.defaclobjtype
            ),
            '[]'::jsonb
        )
        from pg_catalog.pg_default_acl
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_default_acl.defaclnamespace
        where pg_namespace.nspname = 'ltc_m'
    ),
    'reference_data', pg_catalog.jsonb_build_object(
        'BRL', (
            select count(*)
            from ltc_m.currencies
            where
                currencies.code = 'BRL'
                and currencies.name = 'Real brasileiro'
                and currencies.decimal_places = 2
                and currencies.active = true
        ),
        'US', (
            select count(*)
            from ltc_m.units
            where
                units.code = 'US'
                and units.name = 'Unidade e Serviço'
                and units.category is null
                and units.active = true
        )
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
) as p008_preflight;
