begin;

alter table ltc_m.plan_versions
    add column baseline_plan_version_id uuid references ltc_m.plan_versions (id);

comment on column ltc_m.plan_versions.baseline_plan_version_id is
    'Referência explícita ao baseline canônico herdado pela cadeia de revisões P031.';

create or replace function ltc_m.protect_plan_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_old_status text;
    v_new_status text;
    v_action text;
    v_changed_data jsonb;
begin
    if tg_op = 'INSERT' then
        if new.status::text <> 'draft'
            or new.approved_by_user_id is not null
            or new.approved_at is not null
        then
            raise exception using
                errcode = 'P0001',
                message = 'Nova versão de planejamento deve iniciar em draft.';
        end if;
        return new;
    end if;

    v_old_status := old.status::text;
    v_new_status := new.status::text;

    if v_old_status = v_new_status then
        if v_old_status <> 'draft'
            and new is distinct from old
        then
            raise exception using
                errcode = 'P0001',
                message = 'Versão pendente, aprovada, bloqueada ou arquivada é imutável.';
        end if;
        return new;
    end if;

    v_action := case
        when v_old_status = 'draft'
            and v_new_status = 'pending_approval' then 'submit'
        when v_old_status = 'pending_approval'
            and v_new_status = 'draft' then 'return'
        when v_old_status = 'pending_approval'
            and v_new_status = 'approved' then 'approve'
        when v_old_status = 'approved'
            and v_new_status = 'locked' then 'lock'
        when v_old_status in ('approved', 'locked')
            and v_new_status = 'archived' then 'archive'
        else null
    end;

    if v_action is null or not ltc_m.workflow_guard_active(v_action) then
        if v_action = 'archive'
            and exists (
                select 1 from ltc_m.app_users
                where app_users.id = ltc_m.current_actor_id(true)
                  and app_users.role = 'admin'
                  and app_users.active = true
            )
        then
            null;
        else
            raise exception using
                errcode = 'P0001',
                message = 'Transição de status rejeitada: use a função de workflow correspondente.';
        end if;
    end if;

    v_changed_data := (
        pg_catalog.to_jsonb(new)
        - array[
            'status',
            'updated_at',
            'row_version',
            'updated_by_user_id'
        ]
    ) - (
        case
            when v_action = 'approve'
                then array['approved_by_user_id', 'approved_at']
            else array[]::text[]
        end
    );

    if v_changed_data is distinct from (
        (
            pg_catalog.to_jsonb(old)
            - array[
                'status',
                'updated_at',
                'row_version',
                'updated_by_user_id'
            ]
        ) - (
            case
                when v_action = 'approve'
                    then array['approved_by_user_id', 'approved_at']
                else array[]::text[]
            end
        )
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'Transição rejeitada: campos de conteúdo não podem mudar no workflow.';
    end if;

    return new;
end;
$function$;

create or replace function ltc_m.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_old_data jsonb := case
        when tg_op = 'INSERT' then null
        else pg_catalog.to_jsonb(old)
    end;
    v_new_data jsonb := case
        when tg_op = 'DELETE' then null
        else pg_catalog.to_jsonb(new)
    end;
    v_actor_id uuid := ltc_m.current_actor_id(false);
    v_actor_subject text;
    v_operation ltc_m.audit_operation;
    v_action text := pg_catalog.current_setting('ltc_m.workflow_action', true);
    v_metadata jsonb := '{}'::jsonb;
    v_identity_column text;
    v_record_id text;
    v_previous_version bigint;
    v_new_version bigint;
begin
    if tg_op = 'UPDATE' and new is not distinct from old then
        return new;
    end if;

    v_actor_subject := case
        when v_actor_id is null then 'system:database'
        else pg_catalog.current_setting('ltc_m.actor_auth_subject', true)
    end;

    v_identity_column := case
        when tg_nargs = 0 then 'id'
        when tg_nargs = 1 then nullif(pg_catalog.btrim(tg_argv[0]), '')
        else null
    end;
    if v_identity_column is null or v_identity_column !~ '^[a-z_][a-z0-9_]*$' then
        raise exception using
            errcode = 'P0001',
            message = 'Identidade de auditoria configurada de forma inválida.';
    end if;

    if tg_op = 'INSERT' then
        v_operation := 'INSERT';
    elsif tg_op = 'UPDATE' then
        if tg_table_name = 'plan_versions'
            and ltc_m.workflow_guard_active(v_action)
        then
            v_operation := case v_action
                when 'submit' then 'SUBMIT'::ltc_m.audit_operation
                when 'return' then 'RETURN'::ltc_m.audit_operation
                when 'approve' then 'APPROVE'::ltc_m.audit_operation
                when 'lock' then 'LOCK'::ltc_m.audit_operation
                else 'UPDATE'::ltc_m.audit_operation
            end;
            if v_action = 'archive' then
                v_metadata := pg_catalog.jsonb_build_object('workflow_action', 'archive');
            end if;
        elsif (
            (v_old_data ? 'deleted_at')
            and (v_old_data -> 'deleted_at') is distinct from
                (v_new_data -> 'deleted_at')
        ) or (
            (v_old_data ? 'active')
            and (v_old_data -> 'active') is distinct from
                (v_new_data -> 'active')
        ) then
            if (
                (v_new_data ? 'deleted_at')
                and v_new_data -> 'deleted_at' <> 'null'::jsonb
            ) or (
                (v_new_data ? 'active')
                and v_new_data ->> 'active' = 'false'
            ) then
                v_operation := 'SOFT_DELETE';
            else
                v_operation := 'RESTORE';
            end if;
        elsif tg_table_name = 'financial_actual_events'
            and v_old_data ->> 'status' is distinct from
                v_new_data ->> 'status'
            and v_new_data ->> 'status' = 'cancelled'
        then
            v_operation := 'CANCEL';
        else
            v_operation := 'UPDATE';
        end if;
    else
        raise exception using
            errcode = 'P0001',
            message = 'DELETE físico não pode ser auditado como operação válida.';
    end if;

    if tg_table_name = 'plan_versions' and v_action = 'archive' then
        v_metadata := pg_catalog.jsonb_build_object('workflow_action', 'archive');
    end if;

    if v_new_data is null
        or not (v_new_data ? v_identity_column)
        or (v_new_data ->> v_identity_column) is null
        or pg_catalog.btrim(v_new_data ->> v_identity_column) = ''
    then
        raise exception using
            errcode = 'P0001',
            message = pg_catalog.format(
                'Identidade de auditoria ausente ou vazia: %s.',
                v_identity_column
            );
    end if;
    v_record_id := v_new_data ->> v_identity_column;

    if v_old_data ? 'version' then
        v_previous_version := (v_old_data ->> 'version')::bigint;
    elsif v_old_data ? 'row_version' then
        v_previous_version := (v_old_data ->> 'row_version')::bigint;
    end if;

    if v_new_data ? 'version' then
        v_new_version := (v_new_data ->> 'version')::bigint;
    elsif v_new_data ? 'row_version' then
        v_new_version := (v_new_data ->> 'row_version')::bigint;
    end if;

    if v_operation = 'APPROVE' then
        v_metadata := pg_catalog.jsonb_build_object(
            'exceptional_self_approval',
            coalesce(
                nullif(pg_catalog.current_setting('ltc_m.exceptional_self_approval', true), '')::boolean,
                false
            ),
            'active_admin_count',
            (
                select count(*)
                from ltc_m.app_users
                where app_users.role = 'admin' and app_users.active = true
            )
        );
    end if;

    insert into ltc_m.audit_log (
        table_name, record_id, operation, old_data, new_data, changed_by_user_id,
        actor_auth_subject, request_id, source, justification,
        previous_row_version, new_row_version, metadata
    )
    values (
        pg_catalog.format('ltc_m.%I', tg_table_name),
        v_record_id,
        v_operation,
        ltc_m.sanitize_audit_payload(tg_table_name, v_old_data),
        ltc_m.sanitize_audit_payload(tg_table_name, v_new_data),
        v_actor_id,
        v_actor_subject,
        nullif(btrim(pg_catalog.current_setting('ltc_m.request_id', true)), ''),
        coalesce(nullif(btrim(pg_catalog.current_setting('ltc_m.source', true)), ''), 'system'),
        ltc_m.current_justification(false),
        v_previous_version,
        v_new_version,
        v_metadata
    );

    return new;
end;
$function$;

create function ltc_m.archive_plan_version(p_plan_version_id uuid)
returns table (
    plan_version_id uuid,
    status ltc_m.plan_status,
    row_version bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_actor_id uuid := ltc_m.current_actor_id(true);
    v_previous_action text := pg_catalog.current_setting('ltc_m.workflow_action', true);
    v_current_status text;
begin
    perform ltc_m.current_justification(true);
    if not exists (
        select 1 from ltc_m.app_users
        where app_users.id = v_actor_id
          and app_users.active = true
          and app_users.role = 'admin'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Arquivamento exige admin ativo.';
    end if;

    select plan_versions.status::text
    into v_current_status
    from ltc_m.plan_versions
    where plan_versions.id = p_plan_version_id
    for update;

    if v_current_status is null then
        raise exception using
            errcode = 'P0002',
            message = 'Versão de planejamento não encontrada.';
    end if;
    if v_current_status not in ('approved', 'locked') then
        raise exception using
            errcode = 'P0001',
            message = 'Somente versão aprovada ou bloqueada pode ser arquivada.';
    end if;

    perform pg_catalog.set_config('ltc_m.workflow_action', 'archive', true);
    return query
    update ltc_m.plan_versions
    set status = 'archived'
    where plan_versions.id = p_plan_version_id
    returning plan_versions.id, plan_versions.status, plan_versions.row_version;
    perform pg_catalog.set_config('ltc_m.workflow_action', coalesce(v_previous_action, ''), true);
end;
$function$;

create function ltc_m.reopen_plan_version(
    p_source_plan_version_id uuid,
    p_new_name text,
    p_expected_row_version bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_actor_id uuid := ltc_m.current_actor_id(true);
    v_justification text := ltc_m.current_justification(true);
    v_source ltc_m.plan_versions%rowtype;
    v_new_plan ltc_m.plan_versions%rowtype;
    v_baseline_id uuid;
    v_actor_subject text := pg_catalog.current_setting('ltc_m.actor_auth_subject', true);
    v_request_id text := nullif(btrim(pg_catalog.current_setting('ltc_m.request_id', true)), '');
    v_source_name text := nullif(btrim(p_new_name), '');
    v_origin text := coalesce(nullif(btrim(pg_catalog.current_setting('ltc_m.source', true)), ''), 'system');
begin
    if p_expected_row_version < 1 then
        raise exception using errcode = '22023', message = 'Versão esperada inválida.';
    end if;
    if v_source_name is null then
        raise exception using errcode = '22023', message = 'Reabertura exige nome não vazio para a nova versão.';
    end if;
    if not exists (
        select 1 from ltc_m.app_users
        where app_users.id = v_actor_id and app_users.active = true and app_users.role = 'admin'
    ) then
        raise exception using errcode = '42501', message = 'Reabertura exige admin ativo.';
    end if;

    select plan_versions.* into v_source
    from ltc_m.plan_versions
    where plan_versions.id = p_source_plan_version_id
    for update;
    if not found then
        raise exception using errcode = 'P0002', message = 'Versão de planejamento de origem não encontrada.';
    end if;
    if v_source.row_version <> p_expected_row_version then
        raise exception using errcode = 'P0001', message = 'P031_VERSION_CONFLICT';
    end if;
    if v_source.status::text not in ('approved', 'locked') then
        raise exception using errcode = 'P0001', message = 'Somente versão aprovada ou bloqueada pode ser reaberta.';
    end if;

    with recursive lineage as (
        select id, source_plan_version_id, is_baseline, baseline_plan_version_id
        from ltc_m.plan_versions where id = v_source.id
        union all
        select parent.id, parent.source_plan_version_id, parent.is_baseline, parent.baseline_plan_version_id
        from ltc_m.plan_versions parent
        join lineage on lineage.source_plan_version_id = parent.id
    )
    select coalesce(
        (select baseline_plan_version_id from lineage where baseline_plan_version_id is not null limit 1),
        (select id from lineage where is_baseline = true limit 1),
        (select plan_version_id from ltc_m.monthly_plan_baselines where plan_version_id = v_source.id limit 1)
    ) into v_baseline_id;

    insert into ltc_m.plan_versions (
        name, reference_date, status, is_baseline, notes, created_by_user_id,
        updated_by_user_id, source_plan_version_id, baseline_plan_version_id
    ) values (
        v_source_name, v_source.reference_date, 'draft', false, v_source.notes,
        v_actor_id, v_actor_id, v_source.id, v_baseline_id
    ) returning * into v_new_plan;

    insert into ltc_m.financial_plan_scopes (
        id, plan_version_id, project_id, metric_type, planning_level, currency_code,
        created_by_user_id, updated_by_user_id
    )
    select pg_catalog.gen_random_uuid(), v_new_plan.id, scopes.project_id, scopes.metric_type,
        scopes.planning_level, scopes.currency_code, v_actor_id, v_actor_id
    from ltc_m.financial_plan_scopes scopes where scopes.plan_version_id = v_source.id;

    insert into ltc_m.financial_plan_lines (
        id, plan_version_id, project_id, project_item_id, metric_type, planning_level,
        competence_month, amount, currency_code, notes, created_by_user_id, updated_by_user_id
    )
    select pg_catalog.gen_random_uuid(), v_new_plan.id, lines.project_id, lines.project_item_id,
        lines.metric_type, lines.planning_level, lines.competence_month, lines.amount,
        lines.currency_code, lines.notes, v_actor_id, v_actor_id
    from ltc_m.financial_plan_lines lines where lines.plan_version_id = v_source.id;

    insert into ltc_m.audit_log (
        table_name, record_id, operation, old_data, new_data, changed_by_user_id,
        actor_auth_subject, request_id, source, justification,
        previous_row_version, new_row_version, metadata
    ) values (
        'ltc_m.plan_versions', v_source.id::text, 'REOPEN',
        ltc_m.sanitize_audit_payload('plan_versions', pg_catalog.to_jsonb(v_source)),
        ltc_m.sanitize_audit_payload('plan_versions', pg_catalog.to_jsonb(v_source)),
        v_actor_id, v_actor_subject, v_request_id, v_origin, v_justification,
        v_source.row_version, v_source.row_version,
        pg_catalog.jsonb_build_object('reopened_as_plan_version_id', v_new_plan.id,
            'baseline_plan_version_id', v_baseline_id)
    ), (
        'ltc_m.plan_versions', v_new_plan.id::text, 'REOPEN', null,
        ltc_m.sanitize_audit_payload('plan_versions', pg_catalog.to_jsonb(v_new_plan)),
        v_actor_id, v_actor_subject, v_request_id, v_origin, v_justification,
        null, v_new_plan.row_version,
        pg_catalog.jsonb_build_object('source_plan_version_id', v_source.id,
            'baseline_plan_version_id', v_baseline_id)
    );
    return v_new_plan.id;
end;
$function$;

create function ltc_m.submit_plan_version(p_plan_version_id uuid, p_expected_row_version bigint)
returns table (plan_version_id uuid, status ltc_m.plan_status, row_version bigint)
language plpgsql security definer set search_path = ''
as $function$
declare v_current bigint;
begin
    select plan_versions.row_version into v_current from ltc_m.plan_versions as plan_versions where plan_versions.id = p_plan_version_id for update;
    if v_current is null then raise exception using errcode = 'P0002', message = 'Versão de planejamento não encontrada.'; end if;
    if v_current <> p_expected_row_version then raise exception using errcode = 'P0001', message = 'P031_VERSION_CONFLICT'; end if;
    return query select * from ltc_m.submit_plan_version(p_plan_version_id);
end;
$function$;

create function ltc_m.return_plan_version_to_draft_as_approver(p_plan_version_id uuid, p_expected_row_version bigint)
returns table (plan_version_id uuid, status ltc_m.plan_status, row_version bigint)
language plpgsql security definer set search_path = ''
as $function$
declare v_current bigint;
begin
    select plan_versions.row_version into v_current from ltc_m.plan_versions as plan_versions where plan_versions.id = p_plan_version_id for update;
    if v_current is null then raise exception using errcode = 'P0002', message = 'Versão de planejamento não encontrada.'; end if;
    if v_current <> p_expected_row_version then raise exception using errcode = 'P0001', message = 'P031_VERSION_CONFLICT'; end if;
    return query select * from ltc_m.return_plan_version_to_draft_as_approver(p_plan_version_id);
end;
$function$;

create function ltc_m.approve_plan_version_as_approver(p_plan_version_id uuid, p_expected_row_version bigint)
returns table (plan_version_id uuid, status ltc_m.plan_status, row_version bigint)
language plpgsql security definer set search_path = ''
as $function$
declare v_current bigint;
begin
    select plan_versions.row_version into v_current from ltc_m.plan_versions as plan_versions where plan_versions.id = p_plan_version_id for update;
    if v_current is null then raise exception using errcode = 'P0002', message = 'Versão de planejamento não encontrada.'; end if;
    if v_current <> p_expected_row_version then raise exception using errcode = 'P0001', message = 'P031_VERSION_CONFLICT'; end if;
    return query select * from ltc_m.approve_plan_version_as_approver(p_plan_version_id);
end;
$function$;

create function ltc_m.lock_plan_version(p_plan_version_id uuid, p_expected_row_version bigint)
returns table (plan_version_id uuid, status ltc_m.plan_status, row_version bigint)
language plpgsql security definer set search_path = ''
as $function$
declare v_current bigint;
begin
    select plan_versions.row_version into v_current from ltc_m.plan_versions as plan_versions where plan_versions.id = p_plan_version_id for update;
    if v_current is null then raise exception using errcode = 'P0002', message = 'Versão de planejamento não encontrada.'; end if;
    if v_current <> p_expected_row_version then raise exception using errcode = 'P0001', message = 'P031_VERSION_CONFLICT'; end if;
    return query select * from ltc_m.lock_plan_version(p_plan_version_id);
end;
$function$;

create function ltc_m.archive_plan_version(p_plan_version_id uuid, p_expected_row_version bigint)
returns table (plan_version_id uuid, status ltc_m.plan_status, row_version bigint)
language plpgsql security definer set search_path = ''
as $function$
declare
    v_actor_id uuid := ltc_m.current_actor_id(true);
    v_current bigint;
    v_status text;
begin
    perform ltc_m.current_justification(true);
    if not exists (
        select 1 from ltc_m.app_users
        where app_users.id = v_actor_id and app_users.active = true and app_users.role = 'admin'
    ) then
        raise exception using errcode = '42501', message = 'Arquivamento exige admin ativo.';
    end if;
    select plan_versions.row_version into v_current from ltc_m.plan_versions as plan_versions where plan_versions.id = p_plan_version_id for update;
    if v_current is null then raise exception using errcode = 'P0002', message = 'Versão de planejamento não encontrada.'; end if;
    if v_current <> p_expected_row_version then raise exception using errcode = 'P0001', message = 'P031_VERSION_CONFLICT'; end if;
    select plan_versions.status::text into v_status
    from ltc_m.plan_versions as plan_versions
    where plan_versions.id = p_plan_version_id;
    if v_status not in ('approved', 'locked') then raise exception using errcode = 'P0001', message = 'Somente versão aprovada ou bloqueada pode ser arquivada.'; end if;
    perform pg_catalog.set_config('ltc_m.workflow_action', 'archive', true);
    return query
    update ltc_m.plan_versions as plan_versions
    set status = 'archived'
    where plan_versions.id = p_plan_version_id
    returning plan_versions.id, plan_versions.status, plan_versions.row_version;
end;
$function$;

revoke execute on function ltc_m.reopen_plan_version(uuid, text) from ltc_m_runtime;
revoke execute on function ltc_m.submit_plan_version(uuid) from ltc_m_runtime;
revoke execute on function ltc_m.return_plan_version_to_draft_as_approver(uuid) from ltc_m_runtime;
revoke execute on function ltc_m.approve_plan_version_as_approver(uuid) from ltc_m_runtime;
revoke execute on function ltc_m.lock_plan_version(uuid) from ltc_m_runtime;
revoke execute on function ltc_m.archive_plan_version(uuid) from public;
revoke execute on function ltc_m.archive_plan_version(uuid) from ltc_m_runtime;
grant execute on function ltc_m.submit_plan_version(uuid, bigint) to ltc_m_runtime;
grant execute on function ltc_m.return_plan_version_to_draft_as_approver(uuid, bigint) to ltc_m_runtime;
grant execute on function ltc_m.approve_plan_version_as_approver(uuid, bigint) to ltc_m_runtime;
grant execute on function ltc_m.lock_plan_version(uuid, bigint) to ltc_m_runtime;
grant execute on function ltc_m.archive_plan_version(uuid, bigint) to ltc_m_runtime;
revoke execute on function ltc_m.reopen_plan_version(uuid, text, bigint) from public;
grant execute on function ltc_m.reopen_plan_version(uuid, text, bigint) to ltc_m_runtime;

comment on function ltc_m.archive_plan_version(uuid) is
    'P031: arquivamento lógico terminal, somente admin e com justificativa.';
comment on function ltc_m.reopen_plan_version(uuid, text, bigint) is
    'P031: cria revisão draft com UUID novo, parent imediato e referência explícita ao baseline herdado.';

alter policy plan_versions_select
on ltc_m.plan_versions
using (
    exists (
        select 1 from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
    or plan_versions.status in ('approved', 'locked', 'archived')
);

alter policy financial_plan_scopes_select
on ltc_m.financial_plan_scopes
using (
    exists (
        select 1 from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
    or exists (
        select 1 from ltc_m.plan_versions
        where plan_versions.id = financial_plan_scopes.plan_version_id
          and plan_versions.status in ('approved', 'locked', 'archived')
    )
);

alter policy financial_plan_lines_select
on ltc_m.financial_plan_lines
using (
    exists (
        select 1 from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
    or exists (
        select 1 from ltc_m.plan_versions
        where plan_versions.id = financial_plan_lines.plan_version_id
          and plan_versions.status in ('approved', 'locked', 'archived')
    )
);

alter policy monthly_plan_baselines_select_p013
on ltc_m.monthly_plan_baselines
using (
    exists (
        select 1 from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
    or exists (
        select 1 from ltc_m.plan_versions
        where plan_versions.id = monthly_plan_baselines.plan_version_id
          and plan_versions.status in ('approved', 'locked', 'archived')
    )
);

alter policy monthly_plan_cells_select_p013
on ltc_m.monthly_plan_cells
using (
    exists (
        select 1 from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
    or exists (
        select 1 from ltc_m.plan_versions
        where plan_versions.id = monthly_plan_cells.plan_version_id
          and plan_versions.status in ('approved', 'locked', 'archived')
    )
);

commit;
