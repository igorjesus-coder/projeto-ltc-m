-- NÃO EXECUTAR AUTOMATICAMENTE.
-- Rollback manual e destrutivo da camada de autorização P008.
-- Exige autorização, janela controlada e confirmação de que nenhum login usa ltc_m_runtime.
-- O valor AUDIT_READ do enum não pode ser removido com segurança pelo PostgreSQL e permanece.

begin;

do $rollback_guard$
begin
    if exists (
        select 1
        from pg_catalog.pg_auth_members
        join pg_catalog.pg_roles as member_role
            on member_role.oid = pg_auth_members.member
        join pg_catalog.pg_roles as granted_role
            on granted_role.oid = pg_auth_members.roleid
        where
            member_role.rolname = 'ltc_m_runtime'
            or granted_role.rolname = 'ltc_m_runtime'
    ) then
        raise exception 'Rollback P008 interrompido: ltc_m_runtime possui membros ou associações.';
    end if;
end;
$rollback_guard$;

revoke all privileges on schema ltc_m from ltc_m_runtime;
revoke all privileges on all tables in schema ltc_m from ltc_m_runtime;
revoke all privileges on all sequences in schema ltc_m from ltc_m_runtime;
revoke execute on all functions in schema ltc_m from ltc_m_runtime;

drop policy app_users_select on ltc_m.app_users;
drop policy app_users_insert on ltc_m.app_users;
drop policy app_users_update on ltc_m.app_users;
drop policy currencies_select on ltc_m.currencies;
drop policy currencies_insert on ltc_m.currencies;
drop policy currencies_update on ltc_m.currencies;
drop policy units_select on ltc_m.units;
drop policy units_insert on ltc_m.units;
drop policy units_update on ltc_m.units;
drop policy clients_select on ltc_m.clients;
drop policy clients_insert on ltc_m.clients;
drop policy clients_update on ltc_m.clients;
drop policy projects_select on ltc_m.projects;
drop policy projects_insert on ltc_m.projects;
drop policy projects_update on ltc_m.projects;
drop policy project_items_select on ltc_m.project_items;
drop policy project_items_insert on ltc_m.project_items;
drop policy project_items_update on ltc_m.project_items;
drop policy plan_versions_select on ltc_m.plan_versions;
drop policy plan_versions_insert on ltc_m.plan_versions;
drop policy plan_versions_update on ltc_m.plan_versions;
drop policy financial_plan_scopes_select on ltc_m.financial_plan_scopes;
drop policy financial_plan_scopes_insert on ltc_m.financial_plan_scopes;
drop policy financial_plan_scopes_update on ltc_m.financial_plan_scopes;
drop policy financial_plan_lines_select on ltc_m.financial_plan_lines;
drop policy financial_plan_lines_insert on ltc_m.financial_plan_lines;
drop policy financial_plan_lines_update on ltc_m.financial_plan_lines;
drop policy financial_actual_events_select on ltc_m.financial_actual_events;
drop policy financial_actual_events_insert on ltc_m.financial_actual_events;
drop policy financial_actual_events_update on ltc_m.financial_actual_events;
drop policy import_batches_select on ltc_m.import_batches;
drop policy import_batches_insert on ltc_m.import_batches;
drop policy import_batches_update on ltc_m.import_batches;
drop policy import_row_errors_select on ltc_m.import_row_errors;
drop policy import_row_errors_insert on ltc_m.import_row_errors;

alter table ltc_m.app_users no force row level security;
alter table ltc_m.app_users disable row level security;
alter table ltc_m.currencies no force row level security;
alter table ltc_m.currencies disable row level security;
alter table ltc_m.units no force row level security;
alter table ltc_m.units disable row level security;
alter table ltc_m.clients no force row level security;
alter table ltc_m.clients disable row level security;
alter table ltc_m.projects no force row level security;
alter table ltc_m.projects disable row level security;
alter table ltc_m.project_items no force row level security;
alter table ltc_m.project_items disable row level security;
alter table ltc_m.plan_versions no force row level security;
alter table ltc_m.plan_versions disable row level security;
alter table ltc_m.financial_plan_scopes no force row level security;
alter table ltc_m.financial_plan_scopes disable row level security;
alter table ltc_m.financial_plan_lines no force row level security;
alter table ltc_m.financial_plan_lines disable row level security;
alter table ltc_m.financial_actual_events no force row level security;
alter table ltc_m.financial_actual_events disable row level security;
alter table ltc_m.import_batches no force row level security;
alter table ltc_m.import_batches disable row level security;
alter table ltc_m.import_row_errors no force row level security;
alter table ltc_m.import_row_errors disable row level security;
alter table ltc_m.audit_log no force row level security;
alter table ltc_m.audit_log disable row level security;

drop function ltc_m.read_audit_log(
    integer,
    timestamptz,
    bigint,
    timestamptz,
    timestamptz,
    text,
    ltc_m.audit_operation,
    uuid,
    text
);
drop function ltc_m.authorization_context();

create or replace function ltc_m.set_actor_context(
    p_app_user_id uuid,
    p_auth_subject text default null,
    p_request_id text default null,
    p_justification text default null,
    p_source text default 'api',
    p_exceptional_self_approval boolean default false
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_auth_subject text;
    v_source text := lower(btrim(p_source));
    v_request_id text := nullif(btrim(p_request_id), '');
    v_justification text := nullif(btrim(p_justification), '');
begin
    if v_source is null or v_source !~ '^[a-z][a-z0-9_-]{0,49}$' then
        raise exception using errcode = '22023',
            message = 'Contexto do ator inválido: origem ausente ou fora do formato permitido.';
    end if;
    if v_request_id is not null and length(v_request_id) > 200 then
        raise exception using errcode = '22023',
            message = 'Contexto do ator inválido: request ID excede 200 caracteres.';
    end if;
    if v_justification is not null and length(v_justification) > 2000 then
        raise exception using errcode = '22023',
            message = 'Contexto do ator inválido: justificativa excede 2000 caracteres.';
    end if;
    if p_app_user_id is null then
        if v_source <> 'system' or p_auth_subject is not null then
            raise exception using errcode = '22023',
                message = 'Contexto sem usuário exige origem system e não aceita auth_subject.';
        end if;
        v_auth_subject := 'system:database';
    else
        select app_users.auth_subject into v_auth_subject
        from ltc_m.app_users
        where app_users.id = p_app_user_id and app_users.active = true;
        if v_auth_subject is null then
            raise exception using errcode = 'P0001',
                message = 'Contexto do ator rejeitado: usuário inexistente ou inativo.';
        end if;
        if p_auth_subject is not null
            and btrim(p_auth_subject) is distinct from v_auth_subject
        then
            raise exception using errcode = 'P0001',
                message = 'Contexto do ator rejeitado: auth_subject divergente.';
        end if;
    end if;
    perform pg_catalog.set_config('ltc_m.app_user_id', coalesce(p_app_user_id::text, ''), true);
    perform pg_catalog.set_config('ltc_m.actor_auth_subject', v_auth_subject, true);
    perform pg_catalog.set_config('ltc_m.request_id', coalesce(v_request_id, ''), true);
    perform pg_catalog.set_config('ltc_m.justification', coalesce(v_justification, ''), true);
    perform pg_catalog.set_config('ltc_m.source', v_source, true);
    perform pg_catalog.set_config(
        'ltc_m.exceptional_self_approval',
        p_exceptional_self_approval::text,
        true
    );
end;
$function$;

create or replace function ltc_m.current_actor_id(p_required boolean default false)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
    v_actor_text text := nullif(pg_catalog.current_setting('ltc_m.app_user_id', true), '');
    v_actor_id uuid;
begin
    if v_actor_text is null then
        if p_required then
            raise exception using errcode = 'P0001',
                message = 'Operação rejeitada: contexto de ator autenticado é obrigatório.';
        end if;
        return null;
    end if;
    begin
        v_actor_id := v_actor_text::uuid;
    exception
        when invalid_text_representation then
            raise exception using errcode = '22023',
                message = 'Operação rejeitada: app_user_id do contexto é inválido.';
    end;
    if not exists (
        select 1 from ltc_m.app_users
        where app_users.id = v_actor_id and app_users.active = true
    ) then
        raise exception using errcode = 'P0001',
            message = 'Operação rejeitada: ator inexistente ou inativo.';
    end if;
    return v_actor_id;
end;
$function$;

create or replace function ltc_m.enforce_admin_inactivation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_old_data jsonb := pg_catalog.to_jsonb(old);
    v_new_data jsonb := pg_catalog.to_jsonb(new);
    v_lifecycle_changed boolean := false;
    v_role_changed boolean := false;
    v_actor_id uuid;
begin
    if v_old_data ? 'deleted_at' and v_new_data ? 'deleted_at' then
        v_lifecycle_changed := (v_old_data -> 'deleted_at')
            is distinct from (v_new_data -> 'deleted_at');
    end if;
    if v_old_data ? 'active' and v_new_data ? 'active' then
        v_lifecycle_changed := v_lifecycle_changed
            or (v_old_data -> 'active') is distinct from (v_new_data -> 'active');
    end if;
    if tg_table_name = 'app_users' and v_old_data ? 'role' and v_new_data ? 'role' then
        v_role_changed := (v_old_data -> 'role') is distinct from (v_new_data -> 'role');
    end if;
    if not v_lifecycle_changed and not v_role_changed then
        return new;
    end if;
    v_actor_id := ltc_m.current_actor_id(true);
    if not exists (
        select 1 from ltc_m.app_users
        where app_users.id = v_actor_id
            and app_users.role = 'admin'
            and app_users.active = true
    ) then
        raise exception using errcode = '42501',
            message = 'Operação rejeitada: alteração administrativa exige admin ativo.';
    end if;
    if v_lifecycle_changed then
        perform ltc_m.current_justification(true);
    end if;
    if v_old_data ? 'deleted_at'
        and v_new_data ? 'deleted_at'
        and (v_old_data -> 'deleted_at') is distinct from (v_new_data -> 'deleted_at')
        and v_new_data -> 'deleted_at' <> 'null'::jsonb
    then
        v_new_data := v_new_data || pg_catalog.jsonb_build_object(
            'deleted_at',
            pg_catalog.clock_timestamp()
        );
        new := pg_catalog.jsonb_populate_record(new, v_new_data);
    end if;
    return new;
end;
$function$;

comment on function ltc_m.enforce_admin_inactivation() is
    'Protege inativação/restauração nas colunas existentes e mudanças de papel em app_users.';

alter default privileges in schema ltc_m grant execute on functions to public;
grant execute on all functions in schema ltc_m to public;

drop role ltc_m_runtime;

commit;
