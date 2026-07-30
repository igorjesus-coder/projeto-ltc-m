-- P006 / 1.06 — testes transacionais de integridade com dados sintéticos.
-- O rollback é obrigatório e os valores controlados BRL/US não são modificados.

begin;

insert into ltc_m.app_users (id, auth_subject, full_name)
values (
    '00000000-0000-4000-8000-000000006001',
    'p006|synthetic-user',
    'P006 Synthetic User'
);

insert into ltc_m.clients (id, legal_name, display_name, created_by_user_id)
values (
    '00000000-0000-4000-8000-000000006101',
    'P006 Synthetic Client',
    'P006 Synthetic Client',
    '00000000-0000-4000-8000-000000006001'
);

insert into ltc_m.projects (
    id,
    project_code,
    project_name,
    client_id,
    base_currency,
    data_reference_date,
    created_by_user_id
)
values
    (
        '00000000-0000-4000-8000-000000006201',
        'P006-PROJECT-1',
        'P006 Synthetic Project 1',
        '00000000-0000-4000-8000-000000006101',
        'BRL',
        date '2026-07-30',
        '00000000-0000-4000-8000-000000006001'
    ),
    (
        '00000000-0000-4000-8000-000000006202',
        'P006-PROJECT-2',
        'P006 Synthetic Project 2',
        '00000000-0000-4000-8000-000000006101',
        'BRL',
        date '2026-07-30',
        '00000000-0000-4000-8000-000000006001'
    );

insert into ltc_m.project_items (
    id,
    project_id,
    source_line_key,
    line_number,
    quantity,
    unit_code,
    currency_code,
    unit_price,
    created_by_user_id
)
values
    (
        '00000000-0000-4000-8000-000000006301',
        '00000000-0000-4000-8000-000000006201',
        'P006-LINE-1',
        1,
        1,
        'US',
        'BRL',
        1,
        '00000000-0000-4000-8000-000000006001'
    ),
    (
        '00000000-0000-4000-8000-000000006302',
        '00000000-0000-4000-8000-000000006202',
        'P006-LINE-2',
        1,
        1,
        'US',
        'BRL',
        1,
        '00000000-0000-4000-8000-000000006001'
    );

insert into ltc_m.plan_versions (
    id,
    name,
    reference_date,
    created_by_user_id
)
values (
    '00000000-0000-4000-8000-000000006401',
    'P006 Synthetic Plan',
    date '2026-07-30',
    '00000000-0000-4000-8000-000000006001'
);

insert into ltc_m.financial_plan_scopes (
    id,
    plan_version_id,
    project_id,
    metric_type,
    planning_level,
    currency_code,
    created_by_user_id
)
values
    (
        '00000000-0000-4000-8000-000000006501',
        '00000000-0000-4000-8000-000000006401',
        '00000000-0000-4000-8000-000000006201',
        'billing_planned',
        'item',
        'BRL',
        '00000000-0000-4000-8000-000000006001'
    ),
    (
        '00000000-0000-4000-8000-000000006502',
        '00000000-0000-4000-8000-000000006401',
        '00000000-0000-4000-8000-000000006201',
        'receipt_forecast',
        'project',
        'BRL',
        '00000000-0000-4000-8000-000000006001'
    );

do $tests$
begin
    begin
        insert into ltc_m.app_users (auth_subject, full_name)
        values ('p006|synthetic-user', 'P006 Duplicate User');
        raise exception 'P006 falhou: auth_subject duplicado foi aceito';
    exception
        when unique_violation then null;
    end;

    begin
        insert into ltc_m.projects (
            project_code,
            project_name,
            client_id,
            base_currency,
            data_reference_date
        )
        values (
            'p006-project-1',
            'P006 Duplicate Project',
            '00000000-0000-4000-8000-000000006101',
            'BRL',
            date '2026-07-30'
        );
        raise exception 'P006 falhou: código de projeto duplicado foi aceito';
    exception
        when unique_violation then null;
    end;

    begin
        insert into ltc_m.project_items (
            project_id,
            source_line_key,
            line_number,
            quantity,
            unit_code,
            currency_code,
            unit_price
        )
        values (
            '00000000-0000-4000-8000-000000006201',
            'P006-WRONG-CURRENCY',
            2,
            1,
            'US',
            'ZZZ',
            1
        );
        raise exception 'P006 falhou: item com moeda diferente do projeto foi aceito';
    exception
        when foreign_key_violation then null;
    end;

    begin
        insert into ltc_m.financial_plan_lines (
            plan_version_id,
            project_id,
            project_item_id,
            metric_type,
            planning_level,
            competence_month,
            amount,
            currency_code,
            created_by_user_id
        )
        values (
            '00000000-0000-4000-8000-000000006401',
            '00000000-0000-4000-8000-000000006201',
            null,
            'billing_planned',
            'item',
            date '2026-08-01',
            1,
            'BRL',
            '00000000-0000-4000-8000-000000006001'
        );
        raise exception 'P006 falhou: planejamento de item sem item foi aceito';
    exception
        when check_violation then null;
    end;

    begin
        insert into ltc_m.financial_plan_lines (
            plan_version_id,
            project_id,
            project_item_id,
            metric_type,
            planning_level,
            competence_month,
            amount,
            currency_code,
            created_by_user_id
        )
        values (
            '00000000-0000-4000-8000-000000006401',
            '00000000-0000-4000-8000-000000006201',
            '00000000-0000-4000-8000-000000006301',
            'receipt_forecast',
            'project',
            date '2026-08-01',
            1,
            'BRL',
            '00000000-0000-4000-8000-000000006001'
        );
        raise exception 'P006 falhou: planejamento de projeto com item foi aceito';
    exception
        when check_violation then null;
    end;

    begin
        insert into ltc_m.financial_actual_events (
            project_id,
            project_item_id,
            metric_type,
            competence_date,
            source_key,
            amount,
            currency_code,
            created_by_user_id
        )
        values (
            '00000000-0000-4000-8000-000000006201',
            '00000000-0000-4000-8000-000000006302',
            'billing_actual',
            date '2026-08-15',
            'P006-ACTUAL-WRONG-ITEM',
            1,
            'BRL',
            '00000000-0000-4000-8000-000000006001'
        );
        raise exception 'P006 falhou: evento com item de outro projeto foi aceito';
    exception
        when foreign_key_violation then null;
    end;

    begin
        insert into ltc_m.financial_plan_lines (
            plan_version_id,
            project_id,
            project_item_id,
            metric_type,
            planning_level,
            competence_month,
            amount,
            currency_code,
            created_by_user_id
        )
        values (
            '00000000-0000-4000-8000-000000006401',
            '00000000-0000-4000-8000-000000006201',
            null,
            'receipt_forecast',
            'project',
            date '2026-08-15',
            1,
            'BRL',
            '00000000-0000-4000-8000-000000006001'
        );
        raise exception 'P006 falhou: competência fora do primeiro dia foi aceita';
    exception
        when check_violation then null;
    end;

    begin
        insert into ltc_m.projects (
            project_code,
            project_name,
            client_id,
            base_currency,
            data_reference_date
        )
        values (
            'P006-ORPHAN',
            'P006 Orphan Project',
            '00000000-0000-4000-8000-000000006999',
            'BRL',
            date '2026-07-30'
        );
        raise exception 'P006 falhou: FK órfã foi aceita';
    exception
        when foreign_key_violation then null;
    end;

    begin
        insert into ltc_m.projects (
            project_code,
            project_name,
            client_id,
            base_currency,
            data_reference_date,
            start_date,
            end_date
        )
        values (
            'P006-BAD-DATES',
            'P006 Invalid Dates',
            '00000000-0000-4000-8000-000000006101',
            'BRL',
            date '2026-07-30',
            date '2026-08-02',
            date '2026-08-01'
        );
        raise exception 'P006 falhou: data final anterior à inicial foi aceita';
    exception
        when check_violation then null;
    end;
end;
$tests$;

rollback;

select
    not exists (
        select 1
        from ltc_m.app_users
        where auth_subject = 'p006|synthetic-user'
    )
    and not exists (
        select 1
        from ltc_m.projects
        where project_code in ('P006-PROJECT-1', 'P006-PROJECT-2')
    ) as rollback_clean;
