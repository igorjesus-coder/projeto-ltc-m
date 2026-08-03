-- P009 / 1.09 - inventario final read-only apos aplicacao e testes.
select pg_catalog.jsonb_build_object(
    'server_version', pg_catalog.current_setting('server_version'),
    'ltcm_table_count', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m' and pg_class.relkind = 'r'
    ),
    'p009_table_count', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relkind = 'r'
          and pg_class.relname in ('import_batch_sheets', 'import_staging_rows')
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
    'rls_table_count', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relkind = 'r'
          and pg_class.relrowsecurity
    ),
    'force_rls_table_count', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relkind = 'r'
          and pg_class.relforcerowsecurity
    ),
    'policy_count', (
        select count(*) from pg_catalog.pg_policies where schemaname = 'ltc_m'
    ),
    'unsafe_policy_count', (
        select count(*)
        from pg_catalog.pg_policies
        where schemaname = 'ltc_m'
          and (cmd in ('DELETE', 'ALL') or roles <> array['ltc_m_runtime']::name[])
    ),
    'delete_policy_count', (
        select count(*)
        from pg_catalog.pg_policies
        where schemaname = 'ltc_m' and cmd = 'DELETE'
    ),
    'for_all_policy_count', (
        select count(*)
        from pg_catalog.pg_policies
        where schemaname = 'ltc_m' and cmd = 'ALL'
    ),
    'p009_constraint_count', (
        select count(*)
        from pg_catalog.pg_constraint
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_constraint.connamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_constraint.conname like '%_p009'
    ),
    'p009_index_count', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relkind = 'i'
          and pg_class.relname like '%_p009'
    ),
    'p009_trigger_count', (
        select count(*)
        from pg_catalog.pg_trigger
        join pg_catalog.pg_class on pg_class.oid = pg_trigger.tgrelid
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relname in ('import_batch_sheets', 'import_staging_rows')
          and not pg_trigger.tgisinternal
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
        ) order by granted_role.rolname, member_role.rolname)
        from pg_catalog.pg_auth_members
        join pg_catalog.pg_roles granted_role on granted_role.oid = pg_auth_members.roleid
        join pg_catalog.pg_roles member_role on member_role.oid = pg_auth_members.member
        where granted_role.rolname = 'ltc_m_runtime'
           or member_role.rolname = 'ltc_m_runtime'
    ),
    'postgres_grantor_memberships', (
        select count(*)
        from pg_catalog.pg_auth_members
        where pg_catalog.pg_get_userbyid(pg_auth_members.grantor) = 'postgres'
    ),
    'runtime_external_direct_grants', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        cross join lateral pg_catalog.aclexplode(pg_class.relacl) as acl
        where acl.grantee = 'ltc_m_runtime'::regrole
          and pg_namespace.nspname <> 'ltc_m'
    ),
    'runtime_forbidden_table_privileges', (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relkind = 'r'
          and pg_catalog.has_table_privilege(
              'ltc_m_runtime', pg_class.oid,
              'DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
    ),
    'runtime_owns_objects', (
        select count(*)
        from pg_catalog.pg_class
        where pg_class.relowner = 'ltc_m_runtime'::regrole
    ),
    'relevant_advisory_locks', (
        select count(*)
        from pg_catalog.pg_locks
        cross join lateral (
            values
                (pg_catalog.hashtextextended('ltc_m.p008.d27.membership', 0)),
                (pg_catalog.hashtextextended('ltc_m.active_admin_guard', 0))
        ) as relevant_keys(lock_key)
        where pg_locks.locktype = 'advisory'
          and pg_locks.database = (
              select pg_database.oid
              from pg_catalog.pg_database
              where pg_database.datname = pg_catalog.current_database()
          )
          and pg_locks.classid = ((relevant_keys.lock_key >> 32) & 4294967295)::oid
          and pg_locks.objid = (relevant_keys.lock_key & 4294967295)::oid
          and pg_locks.objsubid = 1
    ),
    'reference_data', pg_catalog.jsonb_build_object(
        'BRL', (select count(*) from ltc_m.currencies where code = 'BRL'),
        'US', (select count(*) from ltc_m.units where code = 'US'),
        'US_name', (select name from ltc_m.units where code = 'US')
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
        'import_batch_sheets', (select count(*) from ltc_m.import_batch_sheets),
        'import_staging_rows', (select count(*) from ltc_m.import_staging_rows),
        'import_row_errors', (select count(*) from ltc_m.import_row_errors),
        'audit_log', (select count(*) from ltc_m.audit_log)
    )
) as p009_postcheck;
