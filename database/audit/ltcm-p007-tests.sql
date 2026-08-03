-- P007 / 1.07 — testes transacionais de timestamps, versionamento, auditoria e workflow.
-- Todos os dados são sintéticos e a transação termina em rollback integral.

begin;

insert into ltc_m.app_users (
    id,
    auth_subject,
    full_name,
    role,
    active
)
values
    (
        '00000000-0000-4000-8000-000000007001',
        'p007|viewer',
        'P007 Viewer',
        'viewer',
        true
    ),
    (
        '00000000-0000-4000-8000-000000007002',
        'p007|editor',
        'P007 Editor',
        'editor',
        true
    ),
    (
        '00000000-0000-4000-8000-000000007003',
        'p007|admin-one',
        'P007 Admin One',
        'admin',
        true
    ),
    (
        '00000000-0000-4000-8000-000000007004',
        'p007|admin-two',
        'P007 Admin Two',
        'admin',
        true
    );

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007002',
    'p007|editor',
    'p007-request-setup',
    null,
    'api',
    false
);

insert into ltc_m.clients (
    id,
    legal_name,
    display_name,
    tax_id
)
values
    (
        '00000000-0000-4000-8000-000000007101',
        'P007 Synthetic Client',
        'P007 Synthetic Client',
        'P007-TAX-SENSITIVE'
    ),
    (
        '00000000-0000-4000-8000-000000007102',
        'P007 Soft Delete Client',
        'P007 Soft Delete Client',
        null
    );

insert into ltc_m.projects (
    id,
    project_code,
    project_name,
    client_id,
    base_currency,
    data_reference_date
)
values (
    '00000000-0000-4000-8000-000000007201',
    'P007-PROJECT',
    'P007 Synthetic Project',
    '00000000-0000-4000-8000-000000007101',
    'BRL',
    date '2026-07-30'
);

insert into ltc_m.project_items (
    id,
    project_id,
    source_line_key,
    line_number,
    item_code,
    description,
    quantity,
    unit_code,
    currency_code,
    unit_price
)
values (
    '00000000-0000-4000-8000-000000007301',
    '00000000-0000-4000-8000-000000007201',
    'P007-LINE-1',
    1,
    'P007-ITEM',
    'P007 Synthetic Item',
    2,
    'US',
    'BRL',
    50
);

insert into ltc_m.plan_versions (
    id,
    name,
    reference_date
)
values (
    '00000000-0000-4000-8000-000000007401',
    'P007 Editor Plan',
    date '2026-07-30'
);

insert into ltc_m.financial_plan_scopes (
    id,
    plan_version_id,
    project_id,
    metric_type,
    planning_level,
    currency_code
)
values (
    '00000000-0000-4000-8000-000000007501',
    '00000000-0000-4000-8000-000000007401',
    '00000000-0000-4000-8000-000000007201',
    'billing_planned',
    'item',
    'BRL'
);

insert into ltc_m.financial_plan_lines (
    id,
    plan_version_id,
    project_id,
    project_item_id,
    metric_type,
    planning_level,
    competence_month,
    amount,
    currency_code
)
values (
    '00000000-0000-4000-8000-000000007601',
    '00000000-0000-4000-8000-000000007401',
    '00000000-0000-4000-8000-000000007201',
    '00000000-0000-4000-8000-000000007301',
    'billing_planned',
    'item',
    date '2026-08-01',
    100,
    'BRL'
);

insert into ltc_m.financial_actual_events (
    id,
    project_id,
    project_item_id,
    metric_type,
    competence_date,
    source_key,
    document_number,
    amount,
    currency_code
)
values (
    '00000000-0000-4000-8000-000000007701',
    '00000000-0000-4000-8000-000000007201',
    '00000000-0000-4000-8000-000000007301',
    'billing_actual',
    date '2026-07-30',
    'P007-ACTUAL-1',
    'P007-DOCUMENT-SENSITIVE',
    25,
    'BRL'
);

insert into ltc_m.import_batches (
    id,
    source_name,
    source_hash,
    reference_date,
    received_rows,
    submitted_by_user_id
)
values (
    '00000000-0000-4000-8000-000000007801',
    'p007-synthetic.xlsx',
    repeat('7', 64),
    date '2026-07-30',
    1,
    '00000000-0000-4000-8000-000000007002'
);

insert into ltc_m.import_row_errors (
    batch_id,
    source_row,
    error_code,
    error_message,
    raw_payload
)
values (
    '00000000-0000-4000-8000-000000007801',
    1,
    'P007_SYNTHETIC',
    'Synthetic validation error',
    '{"access_token":"P007-SECRET-MUST-NOT-APPEAR"}'::jsonb
);

do $timestamps_and_versions$
declare
    v_created_at timestamptz;
    v_updated_at timestamptz;
    v_after_update timestamptz;
    v_row_count integer;
begin
    select clients.created_at, clients.updated_at
    into v_created_at, v_updated_at
    from ltc_m.clients
    where clients.id = '00000000-0000-4000-8000-000000007101';

    if v_created_at is null or v_created_at is distinct from v_updated_at then
        raise exception using
            errcode = 'PT001',
            message = 'P007 falhou: insert não definiu timestamps coerentes.';
    end if;

    perform pg_catalog.pg_sleep(0.002);
    update ltc_m.clients
    set display_name = 'P007 Synthetic Client Updated'
    where
        clients.id = '00000000-0000-4000-8000-000000007101'
        and clients.row_version = 1;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 1 then
        raise exception using
            errcode = 'PT002',
            message = 'P007 falhou: update com versão esperada não alterou uma linha.';
    end if;

    select clients.updated_at
    into v_after_update
    from ltc_m.clients
    where clients.id = '00000000-0000-4000-8000-000000007101';

    if v_after_update <= v_updated_at then
        raise exception using
            errcode = 'PT003',
            message = 'P007 falhou: update real não avançou updated_at.';
    end if;

    if not exists (
        select 1
        from ltc_m.clients
        where
            clients.id = '00000000-0000-4000-8000-000000007101'
            and clients.created_at = v_created_at
            and clients.row_version = 2
    ) then
        raise exception using
            errcode = 'PT004',
            message = 'P007 falhou: created_at mudou ou row_version não incrementou uma vez.';
    end if;

    update ltc_m.clients
    set display_name = 'P007 Stale Update'
    where
        clients.id = '00000000-0000-4000-8000-000000007101'
        and clients.row_version = 1;
    get diagnostics v_row_count = row_count;
    if v_row_count <> 0 then
        raise exception using
            errcode = 'PT005',
            message = 'P007 falhou: versão obsoleta alterou registro.';
    end if;

    update ltc_m.clients
    set display_name = display_name
    where clients.id = '00000000-0000-4000-8000-000000007101';

    if not exists (
        select 1
        from ltc_m.clients
        where
            clients.id = '00000000-0000-4000-8000-000000007101'
            and clients.updated_at = v_after_update
            and clients.row_version = 2
    ) then
        raise exception using
            errcode = 'PT006',
            message = 'P007 falhou: no-op alterou timestamp ou versão.';
    end if;

    update ltc_m.projects
    set project_name = 'P007 Synthetic Project Updated'
    where
        projects.id = '00000000-0000-4000-8000-000000007201'
        and projects.version = 1;

    if not exists (
        select 1
        from ltc_m.projects
        where
            projects.id = '00000000-0000-4000-8000-000000007201'
            and projects.version = 2
    ) then
        raise exception using
            errcode = 'PT007',
            message = 'P007 falhou: projects.version não incrementou uma vez.';
    end if;
end;
$timestamps_and_versions$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-request-soft-delete',
    'Synthetic admin soft delete',
    'api',
    false
);

update ltc_m.clients
set deleted_at = pg_catalog.clock_timestamp()
where
    clients.id = '00000000-0000-4000-8000-000000007102'
    and clients.row_version = 1;

do $audit_assertions$
begin
    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.clients'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007101'
            and audit_log.operation = 'INSERT'
    ) then
        raise exception using
            errcode = 'PA001',
            message = 'P007 falhou: insert não gerou auditoria.';
    end if;

    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.clients'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007101'
            and audit_log.operation = 'UPDATE'
            and audit_log.old_data is not null
            and audit_log.new_data is not null
            and audit_log.previous_row_version = 1
            and audit_log.new_row_version = 2
            and not audit_log.old_data ? 'tax_id'
            and not audit_log.new_data ? 'tax_id'
    ) then
        raise exception using
            errcode = 'PA002',
            message = 'P007 falhou: update não preservou before/after sanitizado.';
    end if;

    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.clients'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007102'
            and audit_log.operation = 'SOFT_DELETE'
            and audit_log.justification = 'Synthetic admin soft delete'
    ) then
        raise exception using
            errcode = 'PA003',
            message = 'P007 falhou: soft delete não foi auditado.';
    end if;

    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.actor_auth_subject = 'system:database'
            and audit_log.source = 'system'
    ) then
        raise exception using
            errcode = 'PA004',
            message = 'P007 falhou: ausência de contexto não gerou ator de sistema.';
    end if;

    if exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.old_data::text
                like '%P007-SECRET-MUST-NOT-APPEAR%'
            or audit_log.new_data::text
                like '%P007-SECRET-MUST-NOT-APPEAR%'
            or audit_log.old_data::text like '%' || repeat('7', 64) || '%'
            or audit_log.new_data::text like '%' || repeat('7', 64) || '%'
            or audit_log.old_data::text
                like '%P007-DOCUMENT-SENSITIVE%'
            or audit_log.new_data::text
                like '%P007-DOCUMENT-SENSITIVE%'
    ) then
        raise exception using
            errcode = 'PA005',
            message = 'P007 falhou: segredo ou identificador sensível apareceu no payload.';
    end if;
end;
$audit_assertions$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-d21-user-common-update',
    null,
    'api',
    false
);

update ltc_m.app_users
set full_name = 'P007 Viewer Updated'
where app_users.id = '00000000-0000-4000-8000-000000007001';

update ltc_m.app_users
set role = 'editor'
where app_users.id = '00000000-0000-4000-8000-000000007001';

update ltc_m.app_users
set role = 'viewer'
where app_users.id = '00000000-0000-4000-8000-000000007001';

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007002',
    'p007|editor',
    'p007-d21-editor-role-rejected',
    null,
    'api',
    false
);

do $d21_editor_role_rejected$
begin
    begin
        update ltc_m.app_users
        set role = 'admin'
        where app_users.id = '00000000-0000-4000-8000-000000007001';
        raise exception using
            errcode = 'PU901',
            message = 'P007 falhou: editor alterou role de app_users.';
    exception
        when insufficient_privilege then null;
    end;
end;
$d21_editor_role_rejected$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007002',
    'p007|editor',
    'p007-d21-editor-inactivation-rejected',
    'Synthetic editor inactivation rejection',
    'api',
    false
);

do $d21_editor_inactivation_rejected$
begin
    begin
        update ltc_m.app_users
        set active = false
        where app_users.id = '00000000-0000-4000-8000-000000007001';
        raise exception using
            errcode = 'PU902',
            message = 'P007 falhou: editor inativou app_users.';
    exception
        when insufficient_privilege then null;
    end;
end;
$d21_editor_inactivation_rejected$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007001',
    'p007|viewer',
    'p007-d21-viewer-inactivation-rejected',
    'Synthetic viewer inactivation rejection',
    'api',
    false
);

do $d21_viewer_inactivation_rejected$
begin
    begin
        update ltc_m.app_users
        set active = false
        where app_users.id = '00000000-0000-4000-8000-000000007002';
        raise exception using
            errcode = 'PU903',
            message = 'P007 falhou: viewer inativou app_users.';
    exception
        when insufficient_privilege then null;
    end;
end;
$d21_viewer_inactivation_rejected$;

select ltc_m.set_actor_context(
    null,
    null,
    'p007-d21-missing-actor',
    'Synthetic missing actor rejection',
    'system',
    false
);

do $d21_missing_actor_rejected$
begin
    begin
        update ltc_m.app_users
        set active = false
        where app_users.id = '00000000-0000-4000-8000-000000007001';
        raise exception using
            errcode = 'PU904',
            message = 'P007 falhou: inativação sem ator foi aceita.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$d21_missing_actor_rejected$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-d21-admin-inactivation',
    'Synthetic D21 admin inactivation',
    'api',
    false
);

update ltc_m.app_users
set active = false
where app_users.id = '00000000-0000-4000-8000-000000007001';

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-d21-admin-reactivation',
    'Synthetic D21 admin reactivation',
    'api',
    false
);

update ltc_m.app_users
set active = true
where app_users.id = '00000000-0000-4000-8000-000000007001';

do $d21_app_users_assertions$
begin
    if not exists (
        select 1
        from ltc_m.app_users
        where
            app_users.id = '00000000-0000-4000-8000-000000007001'
            and app_users.full_name = 'P007 Viewer Updated'
            and app_users.role = 'viewer'
            and app_users.active = true
    ) then
        raise exception using
            errcode = 'PU001',
            message = 'P007 falhou: update comum de app_users não foi preservado.';
    end if;

    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.app_users'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007001'
            and audit_log.operation = 'UPDATE'
            and audit_log.request_id = 'p007-d21-user-common-update'
            and audit_log.old_data ->> 'role' = 'viewer'
            and audit_log.new_data ->> 'role' = 'editor'
    ) then
        raise exception using
            errcode = 'PU002',
            message = 'P007 falhou: mudança de role por admin não foi auditada.';
    end if;

    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.app_users'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007001'
            and audit_log.operation = 'SOFT_DELETE'
            and audit_log.request_id = 'p007-d21-admin-inactivation'
            and audit_log.justification = 'Synthetic D21 admin inactivation'
    ) then
        raise exception using
            errcode = 'PU003',
            message = 'P007 falhou: inativação de app_users não foi auditada.';
    end if;

    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.app_users'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007001'
            and audit_log.operation = 'RESTORE'
            and audit_log.request_id = 'p007-d21-admin-reactivation'
            and audit_log.justification = 'Synthetic D21 admin reactivation'
    ) then
        raise exception using
            errcode = 'PU004',
            message = 'P007 falhou: reativação de app_users não foi auditada.';
    end if;
end;
$d21_app_users_assertions$;

do $d21_app_users_no_delete$
begin
    begin
        delete from ltc_m.app_users
        where app_users.id = '00000000-0000-4000-8000-000000007001';
        raise exception using
            errcode = 'PU905',
            message = 'P007 falhou: app_users aceitou DELETE físico.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$d21_app_users_no_delete$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-d21-related-triggers',
    'Synthetic D21 related trigger lifecycle',
    'api',
    false
);

update ltc_m.clients
set deleted_at = null
where clients.id = '00000000-0000-4000-8000-000000007102';

update ltc_m.projects
set deleted_at = pg_catalog.clock_timestamp()
where projects.id = '00000000-0000-4000-8000-000000007201';

update ltc_m.projects
set deleted_at = null
where projects.id = '00000000-0000-4000-8000-000000007201';

update ltc_m.project_items
set active = false
where project_items.id = '00000000-0000-4000-8000-000000007301';

update ltc_m.project_items
set active = true
where project_items.id = '00000000-0000-4000-8000-000000007301';

do $d21_related_trigger_assertions$
begin
    if not exists (
        select 1
        from ltc_m.clients
        where
            clients.id = '00000000-0000-4000-8000-000000007102'
            and clients.deleted_at is null
    ) or not exists (
        select 1
        from ltc_m.projects
        where
            projects.id = '00000000-0000-4000-8000-000000007201'
            and projects.deleted_at is null
    ) or not exists (
        select 1
        from ltc_m.project_items
        where
            project_items.id = '00000000-0000-4000-8000-000000007301'
            and project_items.active = true
    ) then
        raise exception using
            errcode = 'PU005',
            message = 'P007 falhou: trigger associado não restaurou a entidade.';
    end if;

    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.clients'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007102'
            and audit_log.operation = 'RESTORE'
            and audit_log.request_id = 'p007-d21-related-triggers'
    ) or not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.projects'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007201'
            and audit_log.operation = 'SOFT_DELETE'
            and audit_log.request_id = 'p007-d21-related-triggers'
    ) or not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.project_items'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007301'
            and audit_log.operation = 'RESTORE'
            and audit_log.request_id = 'p007-d21-related-triggers'
    ) then
        raise exception using
            errcode = 'PU006',
            message = 'P007 falhou: trigger associado não gerou auditoria esperada.';
    end if;
end;
$d21_related_trigger_assertions$;

-- D21: app_users, clients, projects e project_items chegaram até aqui sem erro 42703.

do $audit_append_only$
begin
    begin
        update ltc_m.audit_log
        set source = 'tampered'
        where audit_log.id = (select min(id) from ltc_m.audit_log);
        raise exception using
            errcode = 'PA901',
            message = 'P007 falhou: audit_log aceitou UPDATE.';
    exception
        when sqlstate 'P0001' then null;
    end;

    begin
        delete from ltc_m.audit_log
        where audit_log.id = (select min(id) from ltc_m.audit_log);
        raise exception using
            errcode = 'PA902',
            message = 'P007 falhou: audit_log aceitou DELETE.';
    exception
        when sqlstate 'P0001' then null;
    end;

    begin
        update ltc_m.import_row_errors
        set error_message = 'Tampered'
        where import_row_errors.batch_id
            = '00000000-0000-4000-8000-000000007801';
        raise exception using
            errcode = 'PA903',
            message = 'P007 falhou: import_row_errors aceitou UPDATE.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$audit_append_only$;

do $workflow_guard_fail_closed$
begin
    if ltc_m.workflow_guard_active('submit') is distinct from false then
        raise exception using
            errcode = 'PG901',
            message = 'P007 falhou: guarda ausente ou resetada foi aceita.';
    end if;

    perform pg_catalog.set_config('ltc_m.workflow_action', '', true);
    if ltc_m.workflow_guard_active('submit') is distinct from false then
        raise exception using
            errcode = 'PG902',
            message = 'P007 falhou: guarda vazia foi aceita.';
    end if;

    perform pg_catalog.set_config(
        'ltc_m.workflow_action',
        'invalid-action',
        true
    );
    if ltc_m.workflow_guard_active('invalid-action') is distinct from false
        or ltc_m.workflow_guard_active('submit') is distinct from false
    then
        raise exception using
            errcode = 'PG903',
            message = 'P007 falhou: guarda inválida foi aceita.';
    end if;

    perform pg_catalog.set_config('ltc_m.workflow_action', 'false', true);
    if ltc_m.workflow_guard_active('false') is distinct from false
        or ltc_m.workflow_guard_active('submit') is distinct from false
    then
        raise exception using
            errcode = 'PG904',
            message = 'P007 falhou: guarda textual false foi aceita.';
    end if;

    perform pg_catalog.set_config('ltc_m.workflow_action', 'true', true);
    if ltc_m.workflow_guard_active('true') is distinct from false
        or ltc_m.workflow_guard_active('submit') is distinct from false
    then
        raise exception using
            errcode = 'PG905',
            message = 'P007 falhou: guarda textual true foi aceita.';
    end if;

    perform pg_catalog.set_config('ltc_m.workflow_action', '', true);
end;
$workflow_guard_fail_closed$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007001',
    'p007|viewer',
    'p007-request-viewer',
    null,
    'api',
    false
);

do $viewer_cannot_submit$
begin
    begin
        perform *
        from ltc_m.submit_plan_version(
            '00000000-0000-4000-8000-000000007401'
        );
        raise exception using
            errcode = 'PW901',
            message = 'P007 falhou: viewer executou workflow.';
    exception
        when insufficient_privilege then null;
    end;
end;
$viewer_cannot_submit$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007002',
    'p007|editor',
    'p007-request-direct-status',
    null,
    'api',
    false
);

do $direct_status_rejected$
begin
    begin
        update ltc_m.plan_versions
        set status = 'pending_approval'
        where plan_versions.id
            = '00000000-0000-4000-8000-000000007401';
        raise exception using
            errcode = 'PW902',
            message = 'P007 falhou: alteração direta de status foi aceita.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$direct_status_rejected$;

select *
from ltc_m.submit_plan_version(
    '00000000-0000-4000-8000-000000007401'
);

do $official_submit_guard_scope$
begin
    if ltc_m.workflow_guard_active('submit') is distinct from false
        or not exists (
            select 1
            from ltc_m.audit_log
            where
                audit_log.table_name = 'ltc_m.plan_versions'
                and audit_log.record_id
                    = '00000000-0000-4000-8000-000000007401'
                and audit_log.operation = 'SUBMIT'
        )
    then
        raise exception using
            errcode = 'PG906',
            message = 'P007 falhou: guarda interna não foi restaurada após função oficial.';
    end if;
end;
$official_submit_guard_scope$;

do $direct_pending_transitions_rejected$
begin
    begin
        update ltc_m.plan_versions
        set
            status = 'approved',
            approved_by_user_id
                = '00000000-0000-4000-8000-000000007003',
            approved_at = pg_catalog.clock_timestamp()
        where plan_versions.id
            = '00000000-0000-4000-8000-000000007401';
        raise exception using
            errcode = 'PW907',
            message = 'P007 falhou: aprovação direta foi aceita.';
    exception
        when sqlstate 'P0001' then null;
    end;

    begin
        update ltc_m.plan_versions
        set status = 'draft'
        where plan_versions.id
            = '00000000-0000-4000-8000-000000007401';
        raise exception using
            errcode = 'PW908',
            message = 'P007 falhou: retorno direto para draft foi aceito.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$direct_pending_transitions_rejected$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-request-return',
    'Synthetic return to draft',
    'api',
    false
);

select *
from ltc_m.return_plan_version_to_draft(
    '00000000-0000-4000-8000-000000007401'
);

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007002',
    'p007|editor',
    'p007-request-resubmit',
    null,
    'api',
    false
);

select *
from ltc_m.submit_plan_version(
    '00000000-0000-4000-8000-000000007401'
);

do $editor_cannot_approve$
begin
    begin
        perform *
        from ltc_m.approve_plan_version(
            '00000000-0000-4000-8000-000000007401'
        );
        raise exception using
            errcode = 'PW903',
            message = 'P007 falhou: editor aprovou versão.';
    exception
        when insufficient_privilege then null;
    end;
end;
$editor_cannot_approve$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-request-approve',
    null,
    'api',
    false
);

select *
from ltc_m.approve_plan_version(
    '00000000-0000-4000-8000-000000007401'
);

do $direct_lock_rejected$
begin
    begin
        update ltc_m.plan_versions
        set status = 'locked'
        where plan_versions.id
            = '00000000-0000-4000-8000-000000007401';
        raise exception using
            errcode = 'PW909',
            message = 'P007 falhou: bloqueio direto foi aceito.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$direct_lock_rejected$;

do $immutable_approved_content$
begin
    begin
        update ltc_m.plan_versions
        set name = 'P007 Illegal Approved Edit'
        where plan_versions.id
            = '00000000-0000-4000-8000-000000007401';
        raise exception using
            errcode = 'PW904',
            message = 'P007 falhou: versão aprovada foi alterada diretamente.';
    exception
        when sqlstate 'P0001' then null;
    end;

    begin
        update ltc_m.financial_plan_scopes
        set updated_by_user_id
            = '00000000-0000-4000-8000-000000007003'
        where financial_plan_scopes.id
            = '00000000-0000-4000-8000-000000007501';
        raise exception using
            errcode = 'PW905',
            message = 'P007 falhou: scope aprovado foi alterado.';
    exception
        when sqlstate 'P0001' then null;
    end;

    begin
        update ltc_m.financial_plan_lines
        set amount = 101
        where financial_plan_lines.id
            = '00000000-0000-4000-8000-000000007601';
        raise exception using
            errcode = 'PW906',
            message = 'P007 falhou: linha aprovada foi alterada.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$immutable_approved_content$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-request-lock',
    'Synthetic lock',
    'api',
    false
);

select *
from ltc_m.lock_plan_version(
    '00000000-0000-4000-8000-000000007401'
);

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-request-reopen',
    'Synthetic reopen',
    'api',
    false
);

do $reopen_by_cloning$
declare
    v_new_plan_id uuid;
    v_actual_count_before bigint;
    v_actual_count_after bigint;
begin
    select count(*)
    into v_actual_count_before
    from ltc_m.financial_actual_events;

    v_new_plan_id := ltc_m.reopen_plan_version(
        '00000000-0000-4000-8000-000000007401',
        'P007 Reopened Plan'
    );

    if not exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = v_new_plan_id
            and plan_versions.status = 'draft'
            and plan_versions.source_plan_version_id
                = '00000000-0000-4000-8000-000000007401'
            and plan_versions.approved_by_user_id is null
            and plan_versions.approved_at is null
    ) then
        raise exception using
            errcode = 'PR001',
            message = 'P007 falhou: reabertura não criou nova versão draft com linhagem.';
    end if;

    if (
        select count(*)
        from ltc_m.financial_plan_scopes
        where financial_plan_scopes.plan_version_id = v_new_plan_id
    ) <> 1 then
        raise exception using
            errcode = 'PR002',
            message = 'P007 falhou: reabertura não copiou scopes.';
    end if;

    if (
        select count(*)
        from ltc_m.financial_plan_lines
        where financial_plan_lines.plan_version_id = v_new_plan_id
    ) <> 1 then
        raise exception using
            errcode = 'PR003',
            message = 'P007 falhou: reabertura não copiou linhas.';
    end if;

    if not exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id
                = '00000000-0000-4000-8000-000000007401'
            and plan_versions.status = 'locked'
            and plan_versions.source_plan_version_id is null
    ) then
        raise exception using
            errcode = 'PR004',
            message = 'P007 falhou: origem da reabertura foi alterada.';
    end if;

    select count(*)
    into v_actual_count_after
    from ltc_m.financial_actual_events;
    if v_actual_count_after <> v_actual_count_before then
        raise exception using
            errcode = 'PR005',
            message = 'P007 falhou: reabertura copiou eventos realizados.';
    end if;

    if (
        select count(*)
        from ltc_m.audit_log
        where
            audit_log.operation = 'REOPEN'
            and audit_log.justification = 'Synthetic reopen'
            and audit_log.request_id = 'p007-request-reopen'
            and audit_log.record_id in (
                '00000000-0000-4000-8000-000000007401',
                v_new_plan_id::text
            )
    ) <> 2 then
        raise exception using
            errcode = 'PR006',
            message = 'P007 falhou: reabertura não gerou auditoria na origem e destino.';
    end if;
end;
$reopen_by_cloning$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-request-self-plan',
    null,
    'api',
    false
);

insert into ltc_m.plan_versions (
    id,
    name,
    reference_date
)
values (
    '00000000-0000-4000-8000-000000007402',
    'P007 Self Approval Plan',
    date '2026-07-30'
);

select *
from ltc_m.submit_plan_version(
    '00000000-0000-4000-8000-000000007402'
);

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-request-self-rejected',
    'Synthetic self approval with another admin',
    'api',
    true
);

do $two_admins_reject_self_approval$
begin
    begin
        perform *
        from ltc_m.approve_plan_version(
            '00000000-0000-4000-8000-000000007402'
        );
        raise exception using
            errcode = 'PS901',
            message = 'P007 falhou: autoaprovação com dois admins foi aceita.';
    exception
        when insufficient_privilege then null;
    end;
end;
$two_admins_reject_self_approval$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-request-disable-admin',
    'Synthetic admin inactivation',
    'api',
    false
);

update ltc_m.app_users
set active = false
where
    app_users.id = '00000000-0000-4000-8000-000000007004'
    and app_users.row_version = 1;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-request-self-no-reason',
    null,
    'api',
    true
);

do $one_admin_requires_justification$
begin
    begin
        perform *
        from ltc_m.approve_plan_version(
            '00000000-0000-4000-8000-000000007402'
        );
        raise exception using
            errcode = 'PS902',
            message = 'P007 falhou: autoaprovação sem justificativa foi aceita.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$one_admin_requires_justification$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007003',
    'p007|admin-one',
    'p007-request-self-approved',
    'Synthetic exceptional self approval',
    'api',
    true
);

select *
from ltc_m.approve_plan_version(
    '00000000-0000-4000-8000-000000007402'
);

do $self_approval_audited$
begin
    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.plan_versions'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007402'
            and audit_log.operation = 'APPROVE'
            and audit_log.changed_by_user_id
                = '00000000-0000-4000-8000-000000007003'
            and audit_log.request_id = 'p007-request-self-approved'
            and audit_log.justification
                = 'Synthetic exceptional self approval'
            and audit_log.metadata
                @> '{"exceptional_self_approval":true,"active_admin_count":1}'::jsonb
    ) then
        raise exception using
            errcode = 'PS001',
            message = 'P007 falhou: autoaprovação excepcional não foi auditada.';
    end if;
end;
$self_approval_audited$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000007002',
    'p007|editor',
    'p007-request-actual-correction',
    'Synthetic financial correction',
    'api',
    false
);

update ltc_m.financial_actual_events
set amount = 26
where
    financial_actual_events.id
        = '00000000-0000-4000-8000-000000007701'
    and financial_actual_events.row_version = 1;

do $financial_history_and_no_delete$
begin
    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.table_name = 'ltc_m.financial_actual_events'
            and audit_log.record_id
                = '00000000-0000-4000-8000-000000007701'
            and audit_log.operation = 'UPDATE'
            and (audit_log.old_data ->> 'amount')::numeric = 25
            and (audit_log.new_data ->> 'amount')::numeric = 26
    ) then
        raise exception using
            errcode = 'PF001',
            message = 'P007 falhou: correção financeira não preservou histórico.';
    end if;

    begin
        delete from ltc_m.financial_actual_events
        where financial_actual_events.id
            = '00000000-0000-4000-8000-000000007701';
        raise exception using
            errcode = 'PF901',
            message = 'P007 falhou: evento financeiro aceitou DELETE físico.';
    exception
        when sqlstate 'P0001' then null;
    end;
end;
$financial_history_and_no_delete$;

rollback;

do $workflow_guard_transaction_cleanup$
begin
    if ltc_m.workflow_guard_active('submit') is distinct from false
        or coalesce(
            pg_catalog.current_setting('ltc_m.workflow_action', true),
            ''
        ) <> ''
    then
        raise exception using
            errcode = 'PG907',
            message = 'P007 falhou: guarda vazou após rollback.';
    end if;
end;
$workflow_guard_transaction_cleanup$;

select
    (select count(*) from ltc_m.currencies where code = 'BRL') = 1
    and (
        select count(*)
        from ltc_m.currencies
        where
            code = 'BRL'
            and name = 'Real brasileiro'
            and decimal_places = 2
            and active = true
    ) = 1
    and (select count(*) from ltc_m.units where code = 'US') = 1
    and (
        select count(*)
        from ltc_m.units
        where
            code = 'US'
            and name = 'Unidade e Serviço'
            and category is null
            and active = true
    ) = 1
    and (select count(*) from ltc_m.app_users) = 0
    and (select count(*) from ltc_m.clients) = 0
    and (select count(*) from ltc_m.projects) = 0
    and (select count(*) from ltc_m.project_items) = 0
    and (select count(*) from ltc_m.plan_versions) = 0
    and (select count(*) from ltc_m.financial_plan_scopes) = 0
    and (select count(*) from ltc_m.financial_plan_lines) = 0
    and (select count(*) from ltc_m.financial_actual_events) = 0
    and (select count(*) from ltc_m.import_batches) = 0
    and (select count(*) from ltc_m.import_row_errors) = 0
    and (select count(*) from ltc_m.audit_log) = 0
    and ltc_m.workflow_guard_active('submit') is false
    as rollback_clean;
