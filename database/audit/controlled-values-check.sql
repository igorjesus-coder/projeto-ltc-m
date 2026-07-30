-- Auditoria read-only e sanitizada dos valores controlados da P005.
-- Retorna somente contagens e compatibilidade; não expõe conteúdo de registros.
select
    to_regclass('ltc_m.currencies')::text = 'ltc_m.currencies'
        as currencies_in_ltcm,
    to_regclass('ltc_m.units')::text = 'ltc_m.units'
        as units_in_ltcm,
    (select count(*) from ltc_m.currencies) as currencies_total_count,
    (
        select count(*)
        from ltc_m.currencies
        where code = 'BRL'
    ) as brl_count,
    (
        select count(*)
        from ltc_m.currencies
        where
            code = 'BRL'
            and name = 'Real brasileiro'
            and decimal_places = 2
            and active = true
    ) as brl_approved_count,
    (
        select count(*)
        from ltc_m.units
        where code = 'US'
    ) as us_count,
    (select count(*) from ltc_m.units) as units_total_count,
    (
        select count(*)
        from ltc_m.units
        where
            code = 'US'
            and name = 'Unidade e Serviço'
            and category is null
            and active = true
    ) as us_approved_count,
    (select count(*) from ltc_m.app_users) as app_users_count,
    (select count(*) from ltc_m.clients) as clients_count,
    (select count(*) from ltc_m.projects) as projects_count,
    (select count(*) from ltc_m.project_items) as project_items_count,
    (select count(*) from ltc_m.plan_versions) as plan_versions_count,
    (
        select count(*)
        from ltc_m.financial_plan_scopes
    ) as financial_plan_scopes_count,
    (
        select count(*)
        from ltc_m.financial_plan_lines
    ) as financial_plan_lines_count,
    (
        select count(*)
        from ltc_m.financial_actual_events
    ) as financial_actual_events_count,
    (select count(*) from ltc_m.import_batches) as import_batches_count,
    (select count(*) from ltc_m.import_row_errors) as import_row_errors_count,
    (select count(*) from ltc_m.audit_log) as audit_log_count;
