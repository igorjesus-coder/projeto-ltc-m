-- P021-D01 — suporte técnico ao perfil approver e resolução server-side.
-- A migration é aditiva: não altera tabelas, dados, grants fora de ltc_m ou o workflow físico.

alter type ltc_m.app_role add value if not exists 'approver' after 'editor';

create or replace function ltc_m.resolve_authorization(p_auth_subject text)
returns table (
    app_user_id uuid,
    display_name text,
    app_role ltc_m.app_role
)
language sql
stable
security definer
set search_path = ''
as $function$
    select
        app_users.id,
        app_users.full_name,
        app_users.role
    from ltc_m.app_users
    where
        app_users.auth_subject = pg_catalog.btrim(p_auth_subject)
        and app_users.active = true;
$function$;

alter policy plan_versions_select
on ltc_m.plan_versions
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
    or plan_versions.status in ('approved', 'locked')
);

alter policy financial_plan_scopes_select
on ltc_m.financial_plan_scopes
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
    or exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = financial_plan_scopes.plan_version_id
            and plan_versions.status in ('approved', 'locked')
    )
);

alter policy financial_plan_lines_select
on ltc_m.financial_plan_lines
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
    or exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = financial_plan_lines.plan_version_id
            and plan_versions.status in ('approved', 'locked')
    )
);

alter policy monthly_source_artifacts_select_p013
on ltc_m.monthly_source_artifacts
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
);

alter policy monthly_plan_baselines_select_p013
on ltc_m.monthly_plan_baselines
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
    or exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = monthly_plan_baselines.plan_version_id
            and plan_versions.status in ('approved', 'locked')
    )
);

alter policy monthly_executions_select_p013
on ltc_m.monthly_plan_import_executions
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
);

alter policy monthly_plan_cells_select_p013
on ltc_m.monthly_plan_cells
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role::text in ('editor', 'approver', 'admin')
    )
    or exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = monthly_plan_cells.plan_version_id
            and plan_versions.status in ('approved', 'locked')
    )
);

create function ltc_m.return_plan_version_to_draft_as_approver(p_plan_version_id uuid)
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
    v_previous_action text := pg_catalog.current_setting(
        'ltc_m.workflow_action',
        true
    );
    v_current_status text;
begin
    perform ltc_m.current_justification(true);
    if not exists (
        select 1
        from ltc_m.app_users
        where
            app_users.id = v_actor_id
            and app_users.active = true
            and app_users.role::text in ('approver', 'admin')
    ) then
        raise exception using
            errcode = '42501',
            message = 'Devolução para draft exige approver ou admin ativo.';
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
    if v_current_status <> 'pending_approval' then
        raise exception using
            errcode = 'P0001',
            message = 'Somente versão pendente pode ser devolvida para draft.';
    end if;

    perform pg_catalog.set_config('ltc_m.workflow_action', 'return', true);

    return query
    update ltc_m.plan_versions
    set status = 'draft'
    where plan_versions.id = p_plan_version_id
    returning
        plan_versions.id,
        plan_versions.status,
        plan_versions.row_version;

    perform pg_catalog.set_config(
        'ltc_m.workflow_action',
        coalesce(v_previous_action, ''),
        true
    );
end;
$function$;

create function ltc_m.approve_plan_version_as_approver(p_plan_version_id uuid)
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
    v_previous_action text := pg_catalog.current_setting(
        'ltc_m.workflow_action',
        true
    );
    v_plan ltc_m.plan_versions%rowtype;
    v_actor_role ltc_m.app_role;
    v_eligible_count integer;
    v_self_approval boolean;
    v_exceptional boolean := coalesce(
        nullif(
            pg_catalog.current_setting(
                'ltc_m.exceptional_self_approval',
                true
            ),
            ''
        )::boolean,
        false
    );
begin
    select app_users.role
    into v_actor_role
    from ltc_m.app_users
    where
        app_users.id = v_actor_id
        and app_users.active = true;

    if v_actor_role::text not in ('approver', 'admin') then
        raise exception using
            errcode = '42501',
            message = 'Aprovação exige approver ou admin ativo.';
    end if;

    select plan_versions.*
    into v_plan
    from ltc_m.plan_versions
    where plan_versions.id = p_plan_version_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Versão de planejamento não encontrada.';
    end if;
    if v_plan.status::text <> 'pending_approval' then
        raise exception using
            errcode = 'P0001',
            message = 'Somente versão pendente pode ser aprovada.';
    end if;

    perform 1
    from ltc_m.app_users
    where
        app_users.role::text in ('approver', 'admin')
        and app_users.active = true
    for key share;

    select count(*)
    into v_eligible_count
    from ltc_m.app_users
    where
        app_users.role::text in ('approver', 'admin')
        and app_users.active = true;

    v_self_approval := v_actor_id = v_plan.created_by_user_id
        or v_actor_id = v_plan.updated_by_user_id;

    if v_self_approval and v_actor_role::text = 'approver' then
        raise exception using
            errcode = '42501',
            message = 'Autoaprovação rejeitada para approver.';
    end if;

    if v_self_approval and v_actor_role::text = 'admin' and v_eligible_count > 1 then
        raise exception using
            errcode = '42501',
            message = 'Autoaprovação rejeitada: existe outro aprovador elegível.';
    end if;

    if v_self_approval then
        perform ltc_m.current_justification(true);
        if not v_exceptional or v_actor_role::text <> 'admin' then
            raise exception using
                errcode = 'P0001',
                message = 'Autoaprovação excepcional exige admin único, indicador explícito e justificativa.';
        end if;
    end if;

    perform pg_catalog.set_config('ltc_m.workflow_action', 'approve', true);

    return query
    update ltc_m.plan_versions
    set
        status = 'approved',
        approved_by_user_id = v_actor_id,
        approved_at = pg_catalog.clock_timestamp()
    where plan_versions.id = p_plan_version_id
    returning
        plan_versions.id,
        plan_versions.status,
        plan_versions.row_version;

    perform pg_catalog.set_config(
        'ltc_m.workflow_action',
        coalesce(v_previous_action, ''),
        true
    );
end;
$function$;

revoke execute on function ltc_m.resolve_authorization(text) from public;
grant execute on function ltc_m.resolve_authorization(text) to ltc_m_runtime;
revoke execute on function ltc_m.return_plan_version_to_draft_as_approver(uuid) from public;
grant execute on function ltc_m.return_plan_version_to_draft_as_approver(uuid) to ltc_m_runtime;
revoke execute on function ltc_m.approve_plan_version_as_approver(uuid) from public;
grant execute on function ltc_m.approve_plan_version_as_approver(uuid) to ltc_m_runtime;

comment on function ltc_m.resolve_authorization(text) is
    'Resolve subject Auth0 para usuário LTC-M ativo e role interna, sem expor credenciais.';
