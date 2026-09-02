-- P008 / D27 — estado final obrigatório e somente leitura, exceto lock efêmero liberado no ato.
do $final_state$
declare
    v_lock_key bigint := pg_catalog.hashtextextended('ltc_m.p008.d27.membership', 0);
    v_d23_lock_key bigint := pg_catalog.hashtextextended('ltc_m.active_admin_guard', 0);
begin
    if (
        select count(*)
        from pg_catalog.pg_auth_members
        where
            pg_auth_members.roleid = 'ltc_m_runtime'::regrole
            and pg_auth_members.member = 'postgres'::regrole
    ) <> 1
        or not exists (
            select 1
            from pg_catalog.pg_auth_members
            where
                pg_auth_members.roleid = 'ltc_m_runtime'::regrole
                and pg_auth_members.member = 'postgres'::regrole
                and pg_catalog.pg_get_userbyid(pg_auth_members.grantor) = 'supabase_admin'
                and pg_auth_members.admin_option
                and not pg_auth_members.inherit_option
                and not pg_auth_members.set_option
        )
        or pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
    then
        raise exception 'P008 D27: estado final não corresponde exatamente a D26.';
    end if;

    if not pg_catalog.pg_try_advisory_lock(v_lock_key) then
        raise exception 'P008 D27: trava de membership permaneceu ativa.';
    end if;
    perform pg_catalog.pg_advisory_unlock(v_lock_key);

    if not pg_catalog.pg_try_advisory_lock(v_d23_lock_key) then
        raise exception 'P008 D27: trava concorrente D23 permaneceu ativa.';
    end if;
    perform pg_catalog.pg_advisory_unlock(v_d23_lock_key);

    if (select count(*) from ltc_m.currencies where code = 'BRL') <> 1
        or (select count(*) from ltc_m.units where code = 'US' and name = 'Unidade e Serviço') <> 1
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
        or (select count(*) from ltc_m.audit_log) <> 3
        or (
            select count(*)
            from ltc_m.audit_log
            where
                (
                    table_name = 'ltc_m.currencies'
                    and record_id in ('BRL', 'USD')
                    and operation = 'INSERT'::ltc_m.audit_operation
                    and source = 'system'
                )
                or (
                    table_name = 'ltc_m.units'
                    and record_id = 'US'
                    and operation = 'INSERT'::ltc_m.audit_operation
                    and source = 'system'
                )
        ) <> 3
    then
        raise exception 'P008 D27: dados sintéticos ou valores controlados divergentes.';
    end if;
end;
$final_state$;

select pg_catalog.jsonb_build_object(
    'gate', 'final_state',
    'd26_restored', true,
    'set', pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET'),
    'brl', (select count(*) from ltc_m.currencies where code = 'BRL'),
    'us', (select count(*) from ltc_m.units where code = 'US'),
    'operational_rows',
        (select count(*) from ltc_m.app_users)
        + (select count(*) from ltc_m.clients)
        + (select count(*) from ltc_m.projects)
        + (select count(*) from ltc_m.project_items)
        + (select count(*) from ltc_m.plan_versions)
        + (select count(*) from ltc_m.financial_plan_scopes)
        + (select count(*) from ltc_m.financial_plan_lines)
        + (select count(*) from ltc_m.financial_actual_events)
        + (select count(*) from ltc_m.import_batches)
        + (select count(*) from ltc_m.import_batch_sheets)
        + (select count(*) from ltc_m.import_staging_rows)
        + (select count(*) from ltc_m.import_row_errors)
        + (select count(*) from ltc_m.audit_log) - 3
) as p008_runtime_result;
