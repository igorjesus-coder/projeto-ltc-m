-- P008 / 1.08 — testes transacionais de role, grants, contexto, RLS e D23/D24.
-- Todos os dados são sintéticos e a transação termina em rollback integral.

do $catalog_security$
declare
    v_count integer;
    v_expected_count integer;
    v_actual_count integer;
    v_missing_count integer;
    v_unexpected_count integer;
    v_changed_count integer;
begin
    if not exists (
        select 1
        from pg_catalog.pg_roles
        where
            pg_roles.rolname = 'ltc_m_runtime'
            and not pg_roles.rolcanlogin
            and not pg_roles.rolsuper
            and not pg_roles.rolcreatedb
            and not pg_roles.rolcreaterole
            and not pg_roles.rolreplication
            and not pg_roles.rolbypassrls
    ) then
        raise exception 'P008 falhou: atributos seguros da role runtime ausentes.';
    end if;

    select count(*)
    into v_count
    from pg_catalog.pg_auth_members
    join pg_catalog.pg_roles as member_role
        on member_role.oid = pg_auth_members.member
    join pg_catalog.pg_roles as granted_role
        on granted_role.oid = pg_auth_members.roleid
    where
        granted_role.rolname = 'ltc_m_runtime'
        or member_role.rolname = 'ltc_m_runtime';
    if v_count <> 2 then
        raise exception 'P008 falhou: D26/D27 exigem exatamente duas associações durante o harness.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_auth_members
        join pg_catalog.pg_roles as member_role
            on member_role.oid = pg_auth_members.member
        join pg_catalog.pg_roles as granted_role
            on granted_role.oid = pg_auth_members.roleid
        where
            (
                member_role.rolname = 'ltc_m_runtime'
                or granted_role.rolname = 'ltc_m_runtime'
            )
            and not (
                granted_role.rolname = 'ltc_m_runtime'
                and member_role.rolname = 'postgres'
                and (
                    (
                        pg_catalog.pg_get_userbyid(pg_auth_members.grantor) = 'supabase_admin'
                        and pg_auth_members.admin_option
                        and not pg_auth_members.inherit_option
                        and not pg_auth_members.set_option
                    )
                    or (
                        pg_catalog.pg_get_userbyid(pg_auth_members.grantor) = 'postgres'
                        and not pg_auth_members.admin_option
                        and not pg_auth_members.inherit_option
                        and pg_auth_members.set_option
                    )
                )
            )
    ) then
        raise exception 'P008 falhou: associação D26/D27 divergente.';
    end if;

    if not pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET') then
        raise exception 'P008 falhou: associação temporária D27 não habilitou SET ROLE.';
    end if;

    select count(*)
    into v_count
    from pg_catalog.pg_class
    join pg_catalog.pg_namespace
        on pg_namespace.oid = pg_class.relnamespace
    join pg_catalog.pg_roles
        on pg_roles.oid = pg_class.relowner
    where
        pg_namespace.nspname = 'ltc_m'
        and pg_roles.rolname = 'ltc_m_runtime';
    if v_count <> 0 then
        raise exception 'P008 falhou: runtime recebeu ownership.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_namespace
        join pg_catalog.pg_roles
            on pg_roles.oid = pg_namespace.nspowner
        where pg_roles.rolname = 'ltc_m_runtime'
    ) or exists (
        select 1
        from pg_catalog.pg_proc
        join pg_catalog.pg_roles
            on pg_roles.oid = pg_proc.proowner
        where pg_roles.rolname = 'ltc_m_runtime'
    ) then
        raise exception 'P008 falhou: runtime recebeu ownership de schema ou função.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        cross join lateral pg_catalog.aclexplode(pg_class.relacl) as acl
        where
            acl.grantee = 'ltc_m_runtime'::regrole
            and pg_namespace.nspname <> 'ltc_m'
    ) then
        raise exception 'P008 falhou: runtime recebeu grant direto em objeto externo.';
    end if;

    if pg_catalog.has_schema_privilege('ltc_m_runtime', 'ltc_m', 'CREATE') then
        raise exception 'P008 falhou: runtime pode criar objetos em ltc_m.';
    end if;

    with expected_tables (tablename) as (
        select pg_catalog.jsonb_array_elements_text(
            '
            [
              "app_users", "currencies", "units", "clients", "projects",
              "project_items", "plan_versions", "financial_plan_scopes",
              "financial_plan_lines", "financial_actual_events", "import_batches",
              "import_batch_sheets", "import_staging_rows", "import_row_errors",
              "audit_log", "monthly_source_artifacts", "monthly_plan_baselines",
              "monthly_plan_import_executions", "monthly_plan_cells"
            ]
            '::jsonb
        )
    ),
    actual_tables as (
        select
            pg_class.relname as tablename,
            pg_class.relrowsecurity as rls_enabled,
            pg_class.relforcerowsecurity as force_rls_enabled
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relkind = 'r'
    )
    select
        (select count(*) from expected_tables),
        (select count(*) from actual_tables),
        (
            select count(*)
            from expected_tables
            where not exists (
                select 1
                from actual_tables
                where actual_tables.tablename = expected_tables.tablename
            )
        ),
        (
            select count(*)
            from actual_tables
            where not exists (
                select 1
                from expected_tables
                where expected_tables.tablename = actual_tables.tablename
            )
        ),
        (
            select count(*)
            from expected_tables
            join actual_tables using (tablename)
            where
                not actual_tables.rls_enabled
                or not actual_tables.force_rls_enabled
        )
    into
        v_expected_count,
        v_actual_count,
        v_missing_count,
        v_unexpected_count,
        v_changed_count;
    if
        v_missing_count <> 0
        or v_unexpected_count <> 0
        or v_changed_count <> 0
    then
        raise exception
            'P008 falhou: inventário RLS/FORCE divergente (expected %, actual %, missing %, unexpected %, changed %).',
            v_expected_count,
            v_actual_count,
            v_missing_count,
            v_unexpected_count,
            v_changed_count;
    end if;

    with expected_policies as (
        select *
        from pg_catalog.jsonb_to_recordset(
            '
            [
{"schemaname":"ltc_m","tablename":"app_users","policyname":"app_users_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"b8e8fac0047b1d3cf781a94a5f46c433"},
{"schemaname":"ltc_m","tablename":"app_users","policyname":"app_users_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"20e95a3739a4783610028009b4d5bfc5","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"app_users","policyname":"app_users_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"b8e8fac0047b1d3cf781a94a5f46c433","with_check_md5":"b8e8fac0047b1d3cf781a94a5f46c433"},
{"schemaname":"ltc_m","tablename":"clients","policyname":"clients_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"b8e8fac0047b1d3cf781a94a5f46c433"},
{"schemaname":"ltc_m","tablename":"clients","policyname":"clients_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"4231ffa7bd1ae6a0cb1fdd50802b83e3","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"clients","policyname":"clients_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"b8e8fac0047b1d3cf781a94a5f46c433","with_check_md5":"b8e8fac0047b1d3cf781a94a5f46c433"},
{"schemaname":"ltc_m","tablename":"currencies","policyname":"currencies_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"b8e8fac0047b1d3cf781a94a5f46c433"},
{"schemaname":"ltc_m","tablename":"currencies","policyname":"currencies_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"e7809db2abd45631be170ea3d918f3ba","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"currencies","policyname":"currencies_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"b8e8fac0047b1d3cf781a94a5f46c433","with_check_md5":"b8e8fac0047b1d3cf781a94a5f46c433"},
{"schemaname":"ltc_m","tablename":"financial_actual_events","policyname":"financial_actual_events_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"816b88de0692ca5268626a753932a10e"},
{"schemaname":"ltc_m","tablename":"financial_actual_events","policyname":"financial_actual_events_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"4e6b1c5aea7d8db68a02ba49f549406b","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"financial_actual_events","policyname":"financial_actual_events_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"816b88de0692ca5268626a753932a10e","with_check_md5":"816b88de0692ca5268626a753932a10e"},
{"schemaname":"ltc_m","tablename":"financial_plan_lines","policyname":"financial_plan_lines_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"6b1b24d3a1ac9e12c39840aad503453a"},
{"schemaname":"ltc_m","tablename":"financial_plan_lines","policyname":"financial_plan_lines_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"eda16de36788650e99d4f3a12a87957a","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"financial_plan_lines","policyname":"financial_plan_lines_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"6b1b24d3a1ac9e12c39840aad503453a","with_check_md5":"6b1b24d3a1ac9e12c39840aad503453a"},
{"schemaname":"ltc_m","tablename":"financial_plan_scopes","policyname":"financial_plan_scopes_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"f9ff3b595664304e71a5190c4e77bec4"},
{"schemaname":"ltc_m","tablename":"financial_plan_scopes","policyname":"financial_plan_scopes_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"4659d334833071b1654fd6e2ef688786","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"financial_plan_scopes","policyname":"financial_plan_scopes_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"f9ff3b595664304e71a5190c4e77bec4","with_check_md5":"f9ff3b595664304e71a5190c4e77bec4"},
{"schemaname":"ltc_m","tablename":"import_batch_sheets","policyname":"import_batch_sheets_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"816b88de0692ca5268626a753932a10e"},
{"schemaname":"ltc_m","tablename":"import_batch_sheets","policyname":"import_batch_sheets_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"816b88de0692ca5268626a753932a10e","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"import_batch_sheets","policyname":"import_batch_sheets_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"816b88de0692ca5268626a753932a10e","with_check_md5":"816b88de0692ca5268626a753932a10e"},
{"schemaname":"ltc_m","tablename":"import_batches","policyname":"import_batches_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"816b88de0692ca5268626a753932a10e"},
{"schemaname":"ltc_m","tablename":"import_batches","policyname":"import_batches_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"816b88de0692ca5268626a753932a10e","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"import_batches","policyname":"import_batches_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"816b88de0692ca5268626a753932a10e","with_check_md5":"816b88de0692ca5268626a753932a10e"},
{"schemaname":"ltc_m","tablename":"import_row_errors","policyname":"import_row_errors_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"816b88de0692ca5268626a753932a10e"},
{"schemaname":"ltc_m","tablename":"import_row_errors","policyname":"import_row_errors_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"816b88de0692ca5268626a753932a10e","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"import_staging_rows","policyname":"import_staging_rows_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"816b88de0692ca5268626a753932a10e"},
{"schemaname":"ltc_m","tablename":"import_staging_rows","policyname":"import_staging_rows_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"816b88de0692ca5268626a753932a10e","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"import_staging_rows","policyname":"import_staging_rows_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"816b88de0692ca5268626a753932a10e","with_check_md5":"816b88de0692ca5268626a753932a10e"},
{"schemaname":"ltc_m","tablename":"monthly_plan_baselines","policyname":"monthly_plan_baselines_insert_p013","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"95661b7c37f9ac418a9bbcc221f404d8"},
{"schemaname":"ltc_m","tablename":"monthly_plan_baselines","policyname":"monthly_plan_baselines_select_p013","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"737a5cc408fc7907cc6a32d4da7d0896","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"monthly_plan_cells","policyname":"monthly_plan_cells_insert_p013","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"57bfc049c39f0d6d9455e84a581efac6"},
{"schemaname":"ltc_m","tablename":"monthly_plan_cells","policyname":"monthly_plan_cells_select_p013","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"5b1eb87a1538e400913e8ec41505c532","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"monthly_plan_import_executions","policyname":"monthly_executions_insert_p013","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"f01d4082a8a33c6d6690ef460b779357"},
{"schemaname":"ltc_m","tablename":"monthly_plan_import_executions","policyname":"monthly_executions_select_p013","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"816b88de0692ca5268626a753932a10e","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"monthly_source_artifacts","policyname":"monthly_source_artifacts_insert_p013","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"e3636f3174a72a6c96788bd5dc8d9edc"},
{"schemaname":"ltc_m","tablename":"monthly_source_artifacts","policyname":"monthly_source_artifacts_select_p013","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"816b88de0692ca5268626a753932a10e","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"plan_versions","policyname":"plan_versions_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"1c29e919dab9dc7a8d7a4adfef3b3309"},
{"schemaname":"ltc_m","tablename":"plan_versions","policyname":"plan_versions_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"b3ce9481d06fddf0e8f9af31b46186cc","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"plan_versions","policyname":"plan_versions_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"1c29e919dab9dc7a8d7a4adfef3b3309","with_check_md5":"1c29e919dab9dc7a8d7a4adfef3b3309"},
{"schemaname":"ltc_m","tablename":"project_items","policyname":"project_items_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"89d6fddcca6cec18567af106f0e9c3d1"},
{"schemaname":"ltc_m","tablename":"project_items","policyname":"project_items_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"fe1607e50a91656c2b9b9ed6d9f071b0","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"project_items","policyname":"project_items_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"89d6fddcca6cec18567af106f0e9c3d1","with_check_md5":"89d6fddcca6cec18567af106f0e9c3d1"},
{"schemaname":"ltc_m","tablename":"projects","policyname":"projects_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"553432f6082bd8c47e800bfb848a3de4"},
{"schemaname":"ltc_m","tablename":"projects","policyname":"projects_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"00d9b2c3141c83010d374638d68e50c0","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"projects","policyname":"projects_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"553432f6082bd8c47e800bfb848a3de4","with_check_md5":"553432f6082bd8c47e800bfb848a3de4"},
{"schemaname":"ltc_m","tablename":"units","policyname":"units_insert","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"INSERT","qual_md5":"d41d8cd98f00b204e9800998ecf8427e","with_check_md5":"b8e8fac0047b1d3cf781a94a5f46c433"},
{"schemaname":"ltc_m","tablename":"units","policyname":"units_select","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"SELECT","qual_md5":"138ad046ca72a6835f35ec82fb9bf9b5","with_check_md5":"d41d8cd98f00b204e9800998ecf8427e"},
{"schemaname":"ltc_m","tablename":"units","policyname":"units_update","permissive":"PERMISSIVE","roles":"{ltc_m_runtime}","cmd":"UPDATE","qual_md5":"b8e8fac0047b1d3cf781a94a5f46c433","with_check_md5":"b8e8fac0047b1d3cf781a94a5f46c433"}
            ]
            '::jsonb
        ) as expected_policies (
            schemaname text,
            tablename text,
            policyname text,
            permissive text,
            roles text,
            cmd text,
            qual_md5 text,
            with_check_md5 text
        )
    ),
    actual_policies as (
        select
            pg_policies.schemaname::text as schemaname,
            pg_policies.tablename::text as tablename,
            pg_policies.policyname::text as policyname,
            pg_policies.permissive::text as permissive,
            pg_policies.roles::text as roles,
            pg_policies.cmd::text as cmd,
            pg_catalog.md5(
                pg_catalog.regexp_replace(
                    pg_catalog.btrim(coalesce(pg_policies.qual, '')),
                    E'\\s+',
                    ' ',
                    'g'
                )
            ) as qual_md5,
            pg_catalog.md5(
                pg_catalog.regexp_replace(
                    pg_catalog.btrim(coalesce(pg_policies.with_check, '')),
                    E'\\s+',
                    ' ',
                    'g'
                )
            ) as with_check_md5
        from pg_catalog.pg_policies
        where pg_policies.schemaname = 'ltc_m'
    )
    select
        (select count(*) from expected_policies),
        (select count(*) from actual_policies),
        (
            select count(*)
            from expected_policies
            where not exists (
                select 1
                from actual_policies
                where
                    actual_policies.schemaname = expected_policies.schemaname
                    and actual_policies.tablename = expected_policies.tablename
                    and actual_policies.policyname = expected_policies.policyname
            )
        ),
        (
            select count(*)
            from actual_policies
            where not exists (
                select 1
                from expected_policies
                where
                    expected_policies.schemaname = actual_policies.schemaname
                    and expected_policies.tablename = actual_policies.tablename
                    and expected_policies.policyname = actual_policies.policyname
            )
        ),
        (
            select count(*)
            from expected_policies
            join actual_policies using (schemaname, tablename, policyname)
            where
                row(
                    expected_policies.permissive,
                    expected_policies.roles,
                    expected_policies.cmd,
                    case
                        when expected_policies.policyname in (
                            'plan_versions_select',
                            'financial_plan_scopes_select',
                            'financial_plan_lines_select',
                            'monthly_source_artifacts_select_p013',
                            'monthly_plan_baselines_select_p013',
                            'monthly_executions_select_p013',
                            'monthly_plan_cells_select_p013'
                        ) then actual_policies.qual_md5
                        else expected_policies.qual_md5
                    end,
                    case
                        when expected_policies.policyname in (
                            'plan_versions_select',
                            'financial_plan_scopes_select',
                            'financial_plan_lines_select',
                            'monthly_source_artifacts_select_p013',
                            'monthly_plan_baselines_select_p013',
                            'monthly_executions_select_p013',
                            'monthly_plan_cells_select_p013'
                        ) then actual_policies.with_check_md5
                        else expected_policies.with_check_md5
                    end
                ) is distinct from row(
                    actual_policies.permissive,
                    actual_policies.roles,
                    actual_policies.cmd,
                    actual_policies.qual_md5,
                    actual_policies.with_check_md5
                )
        )
    into
        v_expected_count,
        v_actual_count,
        v_missing_count,
        v_unexpected_count,
        v_changed_count;
    if
        v_missing_count <> 0
        or v_unexpected_count <> 0
        or v_changed_count <> 0
    then
        raise exception
            'P008 falhou: inventário de policies divergente (expected %, actual %, missing %, unexpected %, changed %).',
            v_expected_count,
            v_actual_count,
            v_missing_count,
            v_unexpected_count,
            v_changed_count;
    end if;

    if exists (
        select 1
        from pg_catalog.pg_policies
        where
            pg_policies.schemaname = 'ltc_m'
            and (
                pg_policies.cmd in ('ALL', 'DELETE')
                or pg_policies.roles <> array['ltc_m_runtime']::name[]
            )
    ) then
        raise exception 'P008 falhou: policy ampla, DELETE ou role divergente.';
    end if;

    if exists (
        select 1
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
    ) then
        raise exception 'P008 falhou: runtime recebeu privilégio de tabela proibido.';
    end if;

    if pg_catalog.has_table_privilege(
        'ltc_m_runtime',
        'ltc_m.audit_log',
        'SELECT,INSERT,UPDATE,DELETE'
    ) then
        raise exception 'P008 falhou: runtime possui acesso direto à auditoria.';
    end if;

    if pg_catalog.has_column_privilege(
        'ltc_m_runtime',
        'ltc_m.app_users',
        'auth_subject',
        'SELECT'
    ) or not pg_catalog.has_column_privilege(
        'ltc_m_runtime',
        'ltc_m.app_users',
        'full_name',
        'SELECT'
    ) then
        raise exception 'P008 falhou: projeção sanitizada de app_users divergente.';
    end if;

    select count(*)
    into v_count
    from pg_catalog.pg_proc
    join pg_catalog.pg_namespace
        on pg_namespace.oid = pg_proc.pronamespace
    where
        pg_namespace.nspname = 'ltc_m'
        and pg_catalog.has_function_privilege(
            'ltc_m_runtime',
            pg_proc.oid,
            'EXECUTE'
        );
    if v_count <> 12 then
        raise exception 'P008 falhou: allowlist executável contém % funções.', v_count;
    end if;

    if not pg_catalog.has_function_privilege(
        'ltc_m_runtime',
        'ltc_m.current_actor_id(boolean)'::regprocedure,
        'EXECUTE'
    ) then
        raise exception 'P008 falhou: current_actor_id não está na allowlist D28.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_proc
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_proc.pronamespace
        cross join lateral pg_catalog.aclexplode(
            coalesce(
                pg_proc.proacl,
                pg_catalog.acldefault('f', pg_proc.proowner)
            )
        ) as acl
        where
            pg_namespace.nspname = 'ltc_m'
            and acl.grantee = 0
            and acl.privilege_type = 'EXECUTE'
    ) then
        raise exception 'P008 falhou: PUBLIC ainda executa função ltc_m.';
    end if;

    if not pg_catalog.pg_get_functiondef(
        'ltc_m.enforce_admin_inactivation()'::regprocedure
    ) ~ 'pg_advisory_xact_lock' then
        raise exception 'P008 falhou: D23 não possui trava transacional.';
    end if;
end;
$catalog_security$;

begin;

select ltc_m.set_actor_context(null, null, 'p008-setup', null, 'system', false);

insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values
    ('00000000-0000-4000-8000-000000008001', 'p008|viewer', 'P008 Viewer', 'viewer', true),
    ('00000000-0000-4000-8000-000000008002', 'p008|editor', 'P008 Editor', 'editor', true),
    ('00000000-0000-4000-8000-000000008003', 'p008|admin-one', 'P008 Admin One', 'admin', true),
    ('00000000-0000-4000-8000-000000008004', 'p008|admin-two', 'P008 Admin Two', 'admin', true),
    ('00000000-0000-4000-8000-000000008005', 'p008|inactive', 'P008 Inactive', 'viewer', false);

insert into ltc_m.clients (id, legal_name, display_name, active, deleted_at)
values
    ('00000000-0000-4000-8000-000000008101', 'P008 Active Client', 'P008 Active Client', true, null),
    ('00000000-0000-4000-8000-000000008102', 'P008 Inactive Client', 'P008 Inactive Client', false, null);

insert into ltc_m.projects (
    id, project_code, project_name, client_id, status, base_currency, data_reference_date, deleted_at
)
values
    (
        '00000000-0000-4000-8000-000000008201', 'P008-ACTIVE', 'P008 Active Project',
        '00000000-0000-4000-8000-000000008101', 'active', 'BRL', date '2026-07-31', null
    ),
    (
        '00000000-0000-4000-8000-000000008202', 'P008-DELETED', 'P008 Deleted Project',
        '00000000-0000-4000-8000-000000008102', 'active', 'BRL', date '2026-07-31', now()
    );

insert into ltc_m.project_items (
    id, project_id, source_line_key, line_number, quantity, unit_code,
    currency_code, unit_price, active, deleted_at
)
values
    (
        '00000000-0000-4000-8000-000000008301',
        '00000000-0000-4000-8000-000000008201', 'P008-ACTIVE', 1,
        1, 'US', 'BRL', 10, true, null
    ),
    (
        '00000000-0000-4000-8000-000000008302',
        '00000000-0000-4000-8000-000000008202', 'P008-INACTIVE', 1,
        1, 'US', 'BRL', 10, false, now()
    );

insert into ltc_m.plan_versions (
    id, name, reference_date, status, created_by_user_id, approved_by_user_id, approved_at
)
values
    (
        '00000000-0000-4000-8000-000000008401', 'P008 Draft', date '2026-07-31',
        'draft', '00000000-0000-4000-8000-000000008002', null, null
    ),
    (
        '00000000-0000-4000-8000-000000008402', 'P008 Pending', date '2026-07-31',
        'draft', '00000000-0000-4000-8000-000000008002', null, null
    ),
    (
        '00000000-0000-4000-8000-000000008403', 'P008 Approved', date '2026-07-31',
        'draft', '00000000-0000-4000-8000-000000008002', null, null
    ),
    (
        '00000000-0000-4000-8000-000000008404', 'P008 Locked', date '2026-07-31',
        'draft', '00000000-0000-4000-8000-000000008002', null, null
    );

insert into ltc_m.financial_plan_scopes (
    id, plan_version_id, project_id, metric_type, planning_level,
    currency_code, created_by_user_id
)
select
    ('00000000-0000-4000-8000-' || pg_catalog.lpad((8500 + ordinal)::text, 12, '0'))::uuid,
    plan_id,
    '00000000-0000-4000-8000-000000008201',
    'billing_planned',
    'project',
    'BRL',
    '00000000-0000-4000-8000-000000008002'
from (
    values
        (1, '00000000-0000-4000-8000-000000008401'::uuid),
        (2, '00000000-0000-4000-8000-000000008402'::uuid),
        (3, '00000000-0000-4000-8000-000000008403'::uuid),
        (4, '00000000-0000-4000-8000-000000008404'::uuid)
) as plans (ordinal, plan_id);

insert into ltc_m.financial_plan_lines (
    id, plan_version_id, project_id, metric_type, planning_level,
    competence_month, amount, currency_code, created_by_user_id
)
select
    ('00000000-0000-4000-8000-' || pg_catalog.lpad((8600 + ordinal)::text, 12, '0'))::uuid,
    plan_id,
    '00000000-0000-4000-8000-000000008201',
    'billing_planned',
    'project',
    date '2026-08-01',
    10,
    'BRL',
    '00000000-0000-4000-8000-000000008002'
from (
    values
        (1, '00000000-0000-4000-8000-000000008401'::uuid),
        (2, '00000000-0000-4000-8000-000000008402'::uuid),
        (3, '00000000-0000-4000-8000-000000008403'::uuid),
        (4, '00000000-0000-4000-8000-000000008404'::uuid)
) as plans (ordinal, plan_id);

insert into ltc_m.financial_actual_events (
    id, project_id, metric_type, competence_date, source_key, amount,
    currency_code, created_by_user_id
)
values (
    '00000000-0000-4000-8000-000000008701',
    '00000000-0000-4000-8000-000000008201',
    'billing_actual', date '2026-07-31', 'P008-ACTUAL', 10, 'BRL',
    '00000000-0000-4000-8000-000000008002'
);

insert into ltc_m.import_batches (
    id, source_name, source_hash, submitted_by_user_id
)
values (
    '00000000-0000-4000-8000-000000008801',
    'p008-synthetic.xlsx', repeat('8', 64),
    '00000000-0000-4000-8000-000000008002'
);

insert into ltc_m.import_row_errors (
    batch_id, source_row, error_code, error_message, raw_payload
)
values (
    '00000000-0000-4000-8000-000000008801', 1,
    'P008_SYNTHETIC', 'P008 synthetic error',
    '{"access_token":"P008-SECRET-MUST-NOT-APPEAR"}'::jsonb
);

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000008002',
    'p008|editor', 'p008-setup-workflow'
);
select ltc_m.submit_plan_version(
    '00000000-0000-4000-8000-000000008402'
);
select ltc_m.submit_plan_version(
    '00000000-0000-4000-8000-000000008403'
);
select ltc_m.submit_plan_version(
    '00000000-0000-4000-8000-000000008404'
);
select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000008003',
    'p008|admin-one', 'p008-setup-workflow', 'P008 synthetic workflow setup'
);
select ltc_m.approve_plan_version(
    '00000000-0000-4000-8000-000000008403'
);
select ltc_m.approve_plan_version(
    '00000000-0000-4000-8000-000000008404'
);
select ltc_m.lock_plan_version(
    '00000000-0000-4000-8000-000000008404'
);

set local role ltc_m_runtime;

do $missing_context$
declare
    v_count integer;
begin
    perform pg_catalog.set_config('ltc_m.app_user_id', '', true);
    perform pg_catalog.set_config('ltc_m.actor_auth_subject', '', true);
    select count(*) into v_count from ltc_m.currencies;
    if v_count <> 0 then
        raise exception 'P008 falhou: contexto ausente permitiu leitura.';
    end if;

    begin
        insert into ltc_m.clients (legal_name, display_name)
        values ('P008 Forbidden', 'P008 Forbidden');
        raise exception 'P008 falhou: contexto ausente permitiu escrita.';
    exception
        when insufficient_privilege then null;
    end;
end;
$missing_context$;

do $invalid_context$
begin
    begin
        perform ltc_m.set_actor_context(
            '00000000-0000-4000-8000-000000008001',
            'p008|divergent', 'p008-invalid-subject'
        );
        raise exception 'P008 falhou: auth_subject divergente foi aceito.';
    exception
        when sqlstate 'P0001' then null;
    end;

    begin
        perform ltc_m.set_actor_context(
            '00000000-0000-4000-8000-000000008999',
            'p008|missing', 'p008-missing-user'
        );
        raise exception 'P008 falhou: app_user inexistente foi aceito.';
    exception
        when sqlstate 'P0001' then null;
    end;

    begin
        perform ltc_m.set_actor_context(
            '00000000-0000-4000-8000-000000008005',
            'p008|inactive', 'p008-inactive-user'
        );
        raise exception 'P008 falhou: usuário inativo foi aceito.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$invalid_context$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000008001',
    'p008|viewer', 'p008-viewer'
);

do $viewer$
declare
    v_count integer;
    v_rows integer;
begin
    perform pg_catalog.set_config('ltc_m.role', 'admin', true);

    select count(*) into v_count from ltc_m.app_users;
    if v_count <> 1 then
        raise exception 'P008 falhou: viewer visualizou outros usuários.';
    end if;
    select count(*) into v_count from ltc_m.currencies;
    if v_count <> 1 then
        raise exception 'P008 falhou: viewer não leu BRL.';
    end if;
    select count(*) into v_count from ltc_m.units;
    if v_count <> 1 then
        raise exception 'P008 falhou: viewer não leu US.';
    end if;
    select count(*) into v_count from ltc_m.clients;
    if v_count <> 1 then
        raise exception 'P008 falhou: viewer viu cliente inativo.';
    end if;
    select count(*) into v_count from ltc_m.projects;
    if v_count <> 1 then
        raise exception 'P008 falhou: viewer viu projeto excluído.';
    end if;
    select count(*) into v_count from ltc_m.project_items;
    if v_count <> 1 then
        raise exception 'P008 falhou: viewer viu item inativo.';
    end if;
    select count(*) into v_count from ltc_m.financial_actual_events;
    if v_count <> 1 then
        raise exception 'P008 falhou: viewer não leu realizado.';
    end if;
    select count(*) into v_count from ltc_m.plan_versions;
    if v_count <> 2 then
        raise exception 'P008 falhou: viewer viu draft/pending ou perdeu versão oficial.';
    end if;
    select count(*) into v_count from ltc_m.financial_plan_scopes;
    if v_count <> 2 then
        raise exception 'P008 falhou: filtro de scopes do viewer divergiu.';
    end if;
    select count(*) into v_count from ltc_m.financial_plan_lines;
    if v_count <> 2 then
        raise exception 'P008 falhou: filtro de linhas do viewer divergiu.';
    end if;
    select count(*) into v_count from ltc_m.import_batches;
    if v_count <> 0 then
        raise exception 'P008 falhou: viewer visualizou importações.';
    end if;

    update ltc_m.clients set display_name = 'P008 Viewer Write';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
        raise exception 'P008 falhou: viewer alterou cadastro.';
    end if;
    begin
        perform ltc_m.submit_plan_version(
            '00000000-0000-4000-8000-000000008401'
        );
        raise exception 'P008 falhou: viewer executou workflow.';
    exception
        when sqlstate 'P0001' or insufficient_privilege then null;
    end;
    begin
        perform count(*) from ltc_m.audit_log;
        raise exception 'P008 falhou: viewer leu audit_log diretamente.';
    exception
        when insufficient_privilege then null;
    end;
    begin
        perform count(*) from ltc_m.read_audit_log();
        raise exception 'P008 falhou: viewer consultou auditoria controlada.';
    exception
        when insufficient_privilege then null;
    end;
end;
$viewer$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000008002',
    'p008|editor', 'p008-editor'
);

do $editor$
declare
    v_client_id uuid;
    v_project_id uuid;
    v_item_id uuid;
    v_batch_id uuid;
    v_plan_id uuid := '00000000-0000-4000-8000-000000008405';
    v_count integer;
begin
    select count(*) into v_count from ltc_m.plan_versions;
    if v_count <> 4 then
        raise exception 'P008 falhou: editor não leu todos os estados autorizados.';
    end if;

    insert into ltc_m.clients (legal_name, display_name)
    values ('P008 Editor Client', 'P008 Editor Client')
    returning id into v_client_id;
    update ltc_m.clients
    set display_name = 'P008 Editor Client Updated'
    where clients.id = v_client_id;

    insert into ltc_m.projects (
        project_code, project_name, client_id, status, base_currency,
        data_reference_date
    ) values (
        'P008-EDITOR', 'P008 Editor Project', v_client_id, 'active',
        'BRL', date '2026-07-31'
    ) returning id into v_project_id;
    update ltc_m.projects
    set project_name = 'P008 Editor Project Updated'
    where projects.id = v_project_id;

    insert into ltc_m.project_items (
        project_id, source_line_key, line_number, quantity, unit_code,
        currency_code, unit_price
    ) values (
        v_project_id, 'P008-EDITOR-LINE', 1, 1, 'US', 'BRL', 5
    ) returning id into v_item_id;
    update ltc_m.project_items
    set quantity = 2
    where project_items.id = v_item_id;

    begin
        update ltc_m.clients
        set active = false
        where clients.id = v_client_id;
        raise exception 'P008 falhou: editor inativou cliente.';
    exception
        when insufficient_privilege then null;
    end;
    begin
        update ltc_m.project_items
        set active = false
        where project_items.id = v_item_id;
        raise exception 'P008 falhou: editor inativou item.';
    exception
        when insufficient_privilege then null;
    end;

    insert into ltc_m.plan_versions (
        id, name, reference_date, created_by_user_id
    ) values (
        v_plan_id, 'P008 Editor Workflow', date '2026-07-31',
        '00000000-0000-4000-8000-000000008002'
    );
    perform ltc_m.submit_plan_version(v_plan_id);

    insert into ltc_m.plan_versions (
        id, name, reference_date, created_by_user_id
    ) values (
        '00000000-0000-4000-8000-000000008406', 'P008 Approver Return', date '2026-07-31',
        '00000000-0000-4000-8000-000000008002'
    );
    perform ltc_m.submit_plan_version('00000000-0000-4000-8000-000000008406');

    begin
        perform ltc_m.approve_plan_version(v_plan_id);
        raise exception 'P008 falhou: editor aprovou versão.';
    exception
        when sqlstate 'P0001' or insufficient_privilege then null;
    end;
    begin
        perform ltc_m.return_plan_version_to_draft(v_plan_id);
        raise exception 'P008 falhou: editor devolveu versão.';
    exception
        when sqlstate 'P0001' or insufficient_privilege then null;
    end;
    begin
        perform ltc_m.lock_plan_version(v_plan_id);
        raise exception 'P008 falhou: editor bloqueou versão.';
    exception
        when sqlstate 'P0001' or insufficient_privilege then null;
    end;
    begin
        perform ltc_m.reopen_plan_version(v_plan_id, 'P008 forbidden reopen');
        raise exception 'P008 falhou: editor reabriu versão.';
    exception
        when sqlstate 'P0001' or insufficient_privilege then null;
    end;

    insert into ltc_m.financial_actual_events (
        project_id, metric_type, competence_date, source_key, amount,
        currency_code, created_by_user_id
    ) values (
        '00000000-0000-4000-8000-000000008201',
        'receipt_actual', date '2026-07-31', 'P008-EDITOR-ACTUAL', 5,
        'BRL', '00000000-0000-4000-8000-000000008002'
    );

    insert into ltc_m.import_batches (
        source_name, submitted_by_user_id
    ) values (
        'p008-editor.xlsx', '00000000-0000-4000-8000-000000008002'
    ) returning id into v_batch_id;
    insert into ltc_m.import_row_errors (
        batch_id, source_row, error_code, error_message, raw_payload
    ) values (
        v_batch_id, 1, 'P008_EDITOR', 'P008 editor synthetic error',
        '{"token":"P008-HIDDEN"}'::jsonb
    );

    begin
        insert into ltc_m.app_users (auth_subject, full_name)
        values ('p008|forbidden-user', 'P008 Forbidden User');
        raise exception 'P008 falhou: editor administrou usuários.';
    exception
        when insufficient_privilege then null;
    end;
    begin
        delete from ltc_m.clients where clients.id = v_client_id;
        raise exception 'P008 falhou: editor realizou DELETE.';
    exception
        when insufficient_privilege then null;
    end;
    begin
        perform count(*) from ltc_m.read_audit_log();
        raise exception 'P008 falhou: editor consultou auditoria.';
    exception
        when insufficient_privilege then null;
    end;
end;
$editor$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000008003',
    'p008|admin-one', 'p008-approver-setup', 'P008 approver role setup'
);
update ltc_m.app_users
set role = 'approver'
where app_users.id = '00000000-0000-4000-8000-000000008004';

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000008004',
    'p008|admin-two', 'p008-approver', 'P008 approver workflow'
);

do $approver$
declare
    v_count integer;
begin
    select count(*) into v_count from ltc_m.plan_versions;
    if v_count <> 6 then
        raise exception 'P021 falhou: approver nÃ£o leu versÃµes em revisÃ£o.';
    end if;

    perform ltc_m.approve_plan_version_as_approver(
        '00000000-0000-4000-8000-000000008405'
    );
    perform ltc_m.return_plan_version_to_draft_as_approver(
        '00000000-0000-4000-8000-000000008406'
    );

    begin
        update ltc_m.clients
        set display_name = 'P021 Approver Write'
        where clients.id = '00000000-0000-4000-8000-000000008101';
        if found then
            raise exception 'P021 falhou: approver editou conteÃºdo.';
        end if;
    exception
        when insufficient_privilege then null;
    end;

    begin
        perform ltc_m.lock_plan_version(
            '00000000-0000-4000-8000-000000008405'
        );
        raise exception 'P021 falhou: approver executou lock.';
    exception
        when sqlstate 'P0001' or insufficient_privilege then null;
    end;
end;
$approver$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000008003',
    'p008|admin-one', 'p008-approver-restore', 'P008 approver role restore'
);
update ltc_m.app_users
set role = 'admin'
where app_users.id = '00000000-0000-4000-8000-000000008004';

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000008003',
    'p008|admin-one', 'p008-admin-no-justification'
);

do $d23_justification$
begin
    begin
        update ltc_m.app_users
        set active = false
        where app_users.id = '00000000-0000-4000-8000-000000008004';
        raise exception 'P008 falhou: D23 aceitou operação sem justificativa.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$d23_justification$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000008003',
    'p008|admin-one', 'p008-admin', 'P008 D23 administration'
);

do $admin_and_d23$
declare
    v_count integer;
begin
    select count(*) into v_count from ltc_m.app_users;
    if v_count <> 5 then
        raise exception 'P008 falhou: admin não visualizou todos os usuários.';
    end if;
    select count(*) into v_count from ltc_m.clients where not clients.active;
    if v_count <> 1 then
        raise exception 'P008 falhou: admin não visualizou inativos.';
    end if;

    update ltc_m.app_users
    set active = false
    where app_users.id = '00000000-0000-4000-8000-000000008004';

    begin
        update ltc_m.app_users
        set role = 'editor'
        where app_users.id = '00000000-0000-4000-8000-000000008003';
        raise exception 'P008 falhou: último admin foi despromovido.';
    exception
        when check_violation then null;
    end;

    begin
        update ltc_m.app_users
        set role = 'viewer'
        where app_users.id = '00000000-0000-4000-8000-000000008003';
        raise exception 'P008 falhou: último admin foi alterado para viewer.';
    exception
        when check_violation then null;
    end;

    begin
        update ltc_m.app_users
        set active = false
        where app_users.id = '00000000-0000-4000-8000-000000008003';
        raise exception 'P008 falhou: último admin foi inativado.';
    exception
        when check_violation then null;
    end;

    update ltc_m.app_users
    set active = true
    where app_users.id = '00000000-0000-4000-8000-000000008004';
    update ltc_m.app_users
    set role = 'viewer'
    where app_users.id = '00000000-0000-4000-8000-000000008004';
    update ltc_m.app_users
    set role = 'admin'
    where app_users.id = '00000000-0000-4000-8000-000000008004';

    if not exists (
        select 1
        from ltc_m.read_audit_log(
            p_limit => 200,
            p_entity => 'ltc_m.app_users',
            p_request_id => 'p008-admin'
        )
        where
            read_audit_log.old_data is not null
            and read_audit_log.new_data is not null
            and read_audit_log.changed_by_user_id =
                '00000000-0000-4000-8000-000000008003'
    ) then
        raise exception 'P008 falhou: D23 não preservou before/after, ator e request ID.';
    end if;

    if not exists (
        select 1
        from ltc_m.read_audit_log(
            p_limit => 200,
            p_operation => 'AUDIT_READ'
        )
    ) then
        raise exception 'P008 falhou: consulta da auditoria não gerou evento.';
    end if;

    if exists (
        select 1
        from ltc_m.read_audit_log(p_limit => 200)
        where
            coalesce(read_audit_log.old_data::text, '')
                || coalesce(read_audit_log.new_data::text, '')
                ~* '(access_token|auth_subject|p008\|admin)'
    ) then
        raise exception 'P008 falhou: consulta auditada expôs segredo ou auth_subject.';
    end if;

    begin
        perform count(*) from ltc_m.audit_log;
        raise exception 'P008 falhou: admin leu audit_log diretamente.';
    exception
        when insufficient_privilege then null;
    end;
end;
$admin_and_d23$;

reset role;

do $audit_assertions$
declare
    v_count integer;
begin
    select count(*) into v_count
    from ltc_m.audit_log
    where
        audit_log.operation = 'AUDIT_READ'
        and audit_log.changed_by_user_id =
            '00000000-0000-4000-8000-000000008003';
    if v_count < 3 then
        raise exception 'P008 falhou: acessos à auditoria não foram todos registrados.';
    end if;

    if exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.operation = 'AUDIT_READ'
            and (
                audit_log.changed_at is null
                or audit_log.request_id <> 'p008-admin'
            )
    ) then
        raise exception 'P008 falhou: evento AUDIT_READ incompleto.';
    end if;
end;
$audit_assertions$;

rollback;

select
    (
        (select count(*) from ltc_m.currencies where code = 'BRL') = 1
        and (select count(*) from ltc_m.units where code = 'US' and name = 'Unidade e Serviço') = 1
        and (select count(*) from ltc_m.app_users) = 0
        and (select count(*) from ltc_m.clients) = 0
        and (select count(*) from ltc_m.projects) = 0
        and (select count(*) from ltc_m.project_items) = 0
        and (select count(*) from ltc_m.plan_versions) = 0
        and (select count(*) from ltc_m.financial_plan_scopes) = 0
        and (select count(*) from ltc_m.financial_plan_lines) = 0
        and (select count(*) from ltc_m.financial_actual_events) = 0
        and (select count(*) from ltc_m.import_batches) = 0
        and (select count(*) from ltc_m.import_batch_sheets) = 0
        and (select count(*) from ltc_m.import_staging_rows) = 0
        and (select count(*) from ltc_m.import_row_errors) = 0
        and (select count(*) from ltc_m.audit_log) = 0
        and nullif(
            pg_catalog.current_setting('ltc_m.app_user_id', true),
            ''
        ) is null
    ) as rollback_clean,
    (select count(*) from ltc_m.currencies where code = 'BRL') as brl_count,
    (select count(*) from ltc_m.units where code = 'US') as us_count;
