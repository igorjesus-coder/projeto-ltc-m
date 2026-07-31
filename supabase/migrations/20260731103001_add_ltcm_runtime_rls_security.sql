begin;

do $runtime_role$
begin
    if exists (
        select 1
        from pg_catalog.pg_roles
        where pg_roles.rolname = 'ltc_m_runtime'
    ) then
        if exists (
            select 1
            from pg_catalog.pg_roles
            where
                pg_roles.rolname = 'ltc_m_runtime'
                and (
                    pg_roles.rolcanlogin
                    or pg_roles.rolsuper
                    or pg_roles.rolcreatedb
                    or pg_roles.rolcreaterole
                    or pg_roles.rolreplication
                    or pg_roles.rolbypassrls
                )
        ) or exists (
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
            raise exception using
                errcode = '55000',
                message = 'ltc_m_runtime existe com atributos ou associações não aprovados.';
        end if;
    else
        execute 'create role ltc_m_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls';
    end if;
end;
$runtime_role$;

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
security definer
set search_path = ''
as $function$
declare
    v_auth_subject text;
    v_source text := pg_catalog.lower(pg_catalog.btrim(p_source));
    v_request_id text := nullif(pg_catalog.btrim(p_request_id), '');
    v_justification text := nullif(pg_catalog.btrim(p_justification), '');
begin
    perform pg_catalog.set_config('ltc_m.app_user_id', '', true);
    perform pg_catalog.set_config('ltc_m.actor_auth_subject', '', true);
    perform pg_catalog.set_config('ltc_m.request_id', '', true);
    perform pg_catalog.set_config('ltc_m.justification', '', true);
    perform pg_catalog.set_config('ltc_m.source', '', true);
    perform pg_catalog.set_config(
        'ltc_m.exceptional_self_approval',
        'false',
        true
    );

    if v_source is null or v_source !~ '^[a-z][a-z0-9_-]{0,49}$' then
        raise exception using
            errcode = '22023',
            message = 'Contexto do ator inválido: origem ausente ou fora do formato permitido.';
    end if;

    if v_request_id is not null and length(v_request_id) > 200 then
        raise exception using
            errcode = '22023',
            message = 'Contexto do ator inválido: request ID excede 200 caracteres.';
    end if;

    if v_justification is not null and length(v_justification) > 2000 then
        raise exception using
            errcode = '22023',
            message = 'Contexto do ator inválido: justificativa excede 2000 caracteres.';
    end if;

    if p_app_user_id is null then
        if v_source <> 'system' or p_auth_subject is not null then
            raise exception using
                errcode = '22023',
                message = 'Contexto sem usuário exige origem system e não aceita auth_subject.';
        end if;
        v_auth_subject := 'system:database';
    else
        if nullif(pg_catalog.btrim(p_auth_subject), '') is null then
            raise exception using
                errcode = '22023',
                message = 'Contexto autenticado exige auth_subject.';
        end if;

        select app_users.auth_subject
        into v_auth_subject
        from ltc_m.app_users
        where
            app_users.id = p_app_user_id
            and app_users.active = true;

        if v_auth_subject is null then
            raise exception using
                errcode = 'P0001',
                message = 'Contexto do ator rejeitado: usuário inexistente ou inativo.';
        end if;

        if pg_catalog.btrim(p_auth_subject) is distinct from v_auth_subject then
            raise exception using
                errcode = 'P0001',
                message = 'Contexto do ator rejeitado: auth_subject divergente.';
        end if;
    end if;

    perform pg_catalog.set_config(
        'ltc_m.app_user_id',
        coalesce(p_app_user_id::text, ''),
        true
    );
    perform pg_catalog.set_config(
        'ltc_m.actor_auth_subject',
        v_auth_subject,
        true
    );
    perform pg_catalog.set_config(
        'ltc_m.request_id',
        coalesce(v_request_id, ''),
        true
    );
    perform pg_catalog.set_config(
        'ltc_m.justification',
        coalesce(v_justification, ''),
        true
    );
    perform pg_catalog.set_config('ltc_m.source', v_source, true);
    perform pg_catalog.set_config(
        'ltc_m.exceptional_self_approval',
        p_exceptional_self_approval::text,
        true
    );
end;
$function$;

create function ltc_m.authorization_context()
returns table (
    app_user_id uuid,
    app_role ltc_m.app_role
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_actor_text text := nullif(
        pg_catalog.current_setting('ltc_m.app_user_id', true),
        ''
    );
    v_actor_subject text := nullif(
        pg_catalog.current_setting('ltc_m.actor_auth_subject', true),
        ''
    );
    v_actor_id uuid;
begin
    if v_actor_text is null or v_actor_subject is null then
        return;
    end if;

    begin
        v_actor_id := v_actor_text::uuid;
    exception
        when invalid_text_representation then
            return;
    end;

    return query
    select app_users.id, app_users.role
    from ltc_m.app_users
    where
        app_users.id = v_actor_id
        and app_users.auth_subject = v_actor_subject
        and app_users.active = true;
end;
$function$;

create or replace function ltc_m.current_actor_id(p_required boolean default false)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
    v_actor_id uuid;
begin
    select authorization_context.app_user_id
    into v_actor_id
    from ltc_m.authorization_context();

    if v_actor_id is null and p_required then
        raise exception using
            errcode = 'P0001',
            message = 'Operação rejeitada: contexto de ator autenticado e válido é obrigatório.';
    end if;

    return v_actor_id;
end;
$function$;

create or replace function ltc_m.enforce_admin_inactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_old_data jsonb := pg_catalog.to_jsonb(old);
    v_new_data jsonb := pg_catalog.to_jsonb(new);
    v_lifecycle_changed boolean := false;
    v_role_changed boolean := false;
    v_loses_active_admin boolean := false;
    v_actor_id uuid;
begin
    if v_old_data ? 'deleted_at' and v_new_data ? 'deleted_at' then
        v_lifecycle_changed := (v_old_data -> 'deleted_at')
            is distinct from (v_new_data -> 'deleted_at');
    end if;

    if v_old_data ? 'active' and v_new_data ? 'active' then
        v_lifecycle_changed := v_lifecycle_changed
            or (v_old_data -> 'active') is distinct from
                (v_new_data -> 'active');
    end if;

    if tg_table_name = 'app_users'
        and v_old_data ? 'role'
        and v_new_data ? 'role'
    then
        v_role_changed := (v_old_data -> 'role')
            is distinct from (v_new_data -> 'role');
        v_loses_active_admin := v_old_data ->> 'role' = 'admin'
            and v_old_data ->> 'active' = 'true'
            and (
                v_new_data ->> 'role' <> 'admin'
                or v_new_data ->> 'active' <> 'true'
            );
    end if;

    if not v_lifecycle_changed and not v_role_changed then
        return new;
    end if;

    v_actor_id := ltc_m.current_actor_id(true);
    if not exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_user_id = v_actor_id
            and authorization_context.app_role = 'admin'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Operação rejeitada: alteração administrativa exige admin ativo.';
    end if;

    if v_lifecycle_changed or v_loses_active_admin then
        perform ltc_m.current_justification(true);
    end if;

    if v_loses_active_admin then
        perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('ltc_m.active_admin_guard', 0)
        );

        if not exists (
            select 1
            from ltc_m.app_users
            where
                app_users.id <> old.id
                and app_users.role = 'admin'
                and app_users.active = true
        ) then
            raise exception using
                errcode = '23514',
                message = 'Operação rejeitada: o sistema deve manter ao menos um admin ativo.';
        end if;
    end if;

    if v_old_data ? 'deleted_at'
        and v_new_data ? 'deleted_at'
        and (v_old_data -> 'deleted_at') is distinct from
            (v_new_data -> 'deleted_at')
        and v_new_data -> 'deleted_at' <> 'null'::jsonb
    then
        v_new_data := v_new_data
            || pg_catalog.jsonb_build_object(
                'deleted_at',
                pg_catalog.clock_timestamp()
            );
        new := pg_catalog.jsonb_populate_record(new, v_new_data);
    end if;

    return new;
end;
$function$;

create function ltc_m.read_audit_log(
    p_limit integer default 100,
    p_after_changed_at timestamptz default null,
    p_after_id bigint default null,
    p_date_from timestamptz default null,
    p_date_to timestamptz default null,
    p_entity text default null,
    p_operation ltc_m.audit_operation default null,
    p_actor uuid default null,
    p_request_id text default null
)
returns table (
    id bigint,
    table_name text,
    record_id text,
    operation ltc_m.audit_operation,
    old_data jsonb,
    new_data jsonb,
    changed_by_user_id uuid,
    request_id text,
    changed_at timestamptz,
    source text,
    justification text,
    previous_row_version bigint,
    new_row_version bigint,
    metadata jsonb
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
    v_actor_id uuid;
    v_actor_subject text;
    v_entity text := nullif(pg_catalog.btrim(p_entity), '');
    v_filter_request_id text := nullif(pg_catalog.btrim(p_request_id), '');
    v_context_request_id text := nullif(
        pg_catalog.btrim(
            pg_catalog.current_setting('ltc_m.request_id', true)
        ),
        ''
    );
    v_source text := coalesce(
        nullif(
            pg_catalog.btrim(
                pg_catalog.current_setting('ltc_m.source', true)
            ),
            ''
        ),
        'api'
    );
    v_access_event_id bigint;
begin
    select
        authorization_context.app_user_id,
        pg_catalog.current_setting('ltc_m.actor_auth_subject', true)
    into v_actor_id, v_actor_subject
    from ltc_m.authorization_context()
    where authorization_context.app_role = 'admin';

    if v_actor_id is null then
        raise exception using
            errcode = '42501',
            message = 'Consulta da auditoria exige contexto de admin ativo.';
    end if;

    if p_limit is null or p_limit < 1 or p_limit > 200 then
        raise exception using
            errcode = '22023',
            message = 'Limite da auditoria deve estar entre 1 e 200.';
    end if;

    if (p_after_changed_at is null) <> (p_after_id is null) then
        raise exception using
            errcode = '22023',
            message = 'Cursor da auditoria exige changed_at e id juntos.';
    end if;

    if p_date_from is not null
        and p_date_to is not null
        and p_date_from > p_date_to
    then
        raise exception using
            errcode = '22023',
            message = 'Intervalo de datas da auditoria é inválido.';
    end if;

    if v_entity is not null and v_entity !~ '^ltc_m\.[a-z_]+$' then
        raise exception using
            errcode = '22023',
            message = 'Filtro de entidade da auditoria é inválido.';
    end if;

    if v_filter_request_id is not null
        and length(v_filter_request_id) > 200
    then
        raise exception using
            errcode = '22023',
            message = 'Filtro de request ID excede 200 caracteres.';
    end if;

    insert into ltc_m.audit_log (
        table_name,
        record_id,
        operation,
        changed_by_user_id,
        actor_auth_subject,
        request_id,
        source,
        justification,
        metadata
    )
    values (
        'ltc_m.audit_log',
        v_actor_id::text,
        'AUDIT_READ',
        v_actor_id,
        v_actor_subject,
        v_context_request_id,
        v_source,
        ltc_m.current_justification(false),
        pg_catalog.jsonb_build_object(
            'limit', p_limit,
            'after_changed_at', p_after_changed_at,
            'after_id', p_after_id,
            'date_from', p_date_from,
            'date_to', p_date_to,
            'entity', v_entity,
            'operation', p_operation,
            'actor', p_actor,
            'request_id_filter', v_filter_request_id
        )
    )
    returning audit_log.id into v_access_event_id;

    return query
    select
        audit_log.id,
        audit_log.table_name,
        audit_log.record_id,
        audit_log.operation,
        ltc_m.sanitize_audit_payload(
            pg_catalog.split_part(audit_log.table_name, '.', 2),
            audit_log.old_data
        ),
        ltc_m.sanitize_audit_payload(
            pg_catalog.split_part(audit_log.table_name, '.', 2),
            audit_log.new_data
        ),
        audit_log.changed_by_user_id,
        audit_log.request_id,
        audit_log.changed_at,
        audit_log.source,
        audit_log.justification,
        audit_log.previous_row_version,
        audit_log.new_row_version,
        audit_log.metadata
    from ltc_m.audit_log
    where
        audit_log.id <> v_access_event_id
        and (p_date_from is null or audit_log.changed_at >= p_date_from)
        and (p_date_to is null or audit_log.changed_at <= p_date_to)
        and (v_entity is null or audit_log.table_name = v_entity)
        and (p_operation is null or audit_log.operation = p_operation)
        and (p_actor is null or audit_log.changed_by_user_id = p_actor)
        and (
            v_filter_request_id is null
            or audit_log.request_id = v_filter_request_id
        )
        and (
            p_after_changed_at is null
            or (audit_log.changed_at, audit_log.id)
                < (p_after_changed_at, p_after_id)
        )
    order by audit_log.changed_at desc, audit_log.id desc
    limit p_limit;
end;
$function$;

alter table ltc_m.app_users enable row level security;
alter table ltc_m.app_users force row level security;
alter table ltc_m.currencies enable row level security;
alter table ltc_m.currencies force row level security;
alter table ltc_m.units enable row level security;
alter table ltc_m.units force row level security;
alter table ltc_m.clients enable row level security;
alter table ltc_m.clients force row level security;
alter table ltc_m.projects enable row level security;
alter table ltc_m.projects force row level security;
alter table ltc_m.project_items enable row level security;
alter table ltc_m.project_items force row level security;
alter table ltc_m.plan_versions enable row level security;
alter table ltc_m.plan_versions force row level security;
alter table ltc_m.financial_plan_scopes enable row level security;
alter table ltc_m.financial_plan_scopes force row level security;
alter table ltc_m.financial_plan_lines enable row level security;
alter table ltc_m.financial_plan_lines force row level security;
alter table ltc_m.financial_actual_events enable row level security;
alter table ltc_m.financial_actual_events force row level security;
alter table ltc_m.import_batches enable row level security;
alter table ltc_m.import_batches force row level security;
alter table ltc_m.import_row_errors enable row level security;
alter table ltc_m.import_row_errors force row level security;
alter table ltc_m.audit_log enable row level security;
alter table ltc_m.audit_log force row level security;

create policy app_users_select
on ltc_m.app_users
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or authorization_context.app_user_id = app_users.id
    )
);

create policy app_users_insert
on ltc_m.app_users
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role = 'admin'
    )
);

create policy app_users_update
on ltc_m.app_users
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role = 'admin'
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role = 'admin'
    )
);

create policy currencies_select
on ltc_m.currencies
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or currencies.active = true
    )
);

create policy currencies_insert
on ltc_m.currencies
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role = 'admin'
    )
);

create policy currencies_update
on ltc_m.currencies
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role = 'admin'
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role = 'admin'
    )
);

create policy units_select
on ltc_m.units
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or units.active = true
    )
);

create policy units_insert
on ltc_m.units
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role = 'admin'
    )
);

create policy units_update
on ltc_m.units
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role = 'admin'
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role = 'admin'
    )
);

create policy clients_select
on ltc_m.clients
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (clients.active = true and clients.deleted_at is null)
    )
);

create policy clients_insert
on ltc_m.clients
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                authorization_context.app_role = 'editor'
                and clients.active = true
                and clients.deleted_at is null
            )
    )
);

create policy clients_update
on ltc_m.clients
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                authorization_context.app_role = 'editor'
                and clients.active = true
                and clients.deleted_at is null
            )
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                authorization_context.app_role = 'editor'
                and clients.active = true
                and clients.deleted_at is null
            )
    )
);

create policy projects_select
on ltc_m.projects
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                projects.status = 'active'
                and projects.deleted_at is null
                and exists (
                    select 1
                    from ltc_m.clients
                    where clients.id = projects.client_id
                )
            )
    )
);

create policy projects_insert
on ltc_m.projects
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                authorization_context.app_role = 'editor'
                and projects.status = 'active'
                and projects.deleted_at is null
                and exists (
                    select 1
                    from ltc_m.clients
                    where clients.id = projects.client_id
                )
            )
    )
);

create policy projects_update
on ltc_m.projects
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                authorization_context.app_role = 'editor'
                and projects.status = 'active'
                and projects.deleted_at is null
                and exists (
                    select 1
                    from ltc_m.clients
                    where clients.id = projects.client_id
                )
            )
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                authorization_context.app_role = 'editor'
                and projects.status = 'active'
                and projects.deleted_at is null
                and exists (
                    select 1
                    from ltc_m.clients
                    where clients.id = projects.client_id
                )
            )
    )
);

create policy project_items_select
on ltc_m.project_items
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                project_items.active = true
                and project_items.deleted_at is null
                and exists (
                    select 1
                    from ltc_m.projects
                    where projects.id = project_items.project_id
                )
            )
    )
);

create policy project_items_insert
on ltc_m.project_items
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                authorization_context.app_role = 'editor'
                and project_items.active = true
                and project_items.deleted_at is null
                and exists (
                    select 1
                    from ltc_m.projects
                    where projects.id = project_items.project_id
                )
            )
    )
);

create policy project_items_update
on ltc_m.project_items
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                authorization_context.app_role = 'editor'
                and project_items.active = true
                and project_items.deleted_at is null
                and exists (
                    select 1
                    from ltc_m.projects
                    where projects.id = project_items.project_id
                )
            )
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role = 'admin'
            or (
                authorization_context.app_role = 'editor'
                and project_items.active = true
                and project_items.deleted_at is null
                and exists (
                    select 1
                    from ltc_m.projects
                    where projects.id = project_items.project_id
                )
            )
    )
);

create policy plan_versions_select
on ltc_m.plan_versions
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role in ('editor', 'admin')
            or plan_versions.status in ('approved', 'locked')
    )
);

create policy plan_versions_insert
on ltc_m.plan_versions
for insert
to ltc_m_runtime
with check (
    plan_versions.status = 'draft'
    and exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy plan_versions_update
on ltc_m.plan_versions
for update
to ltc_m_runtime
using (
    plan_versions.status = 'draft'
    and exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
)
with check (
    plan_versions.status = 'draft'
    and exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy financial_plan_scopes_select
on ltc_m.financial_plan_scopes
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
    or exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = financial_plan_scopes.plan_version_id
            and plan_versions.status in ('approved', 'locked')
    )
);

create policy financial_plan_scopes_insert
on ltc_m.financial_plan_scopes
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
    and exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = financial_plan_scopes.plan_version_id
            and plan_versions.status = 'draft'
    )
);

create policy financial_plan_scopes_update
on ltc_m.financial_plan_scopes
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
    and exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = financial_plan_scopes.plan_version_id
            and plan_versions.status = 'draft'
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
    and exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = financial_plan_scopes.plan_version_id
            and plan_versions.status = 'draft'
    )
);

create policy financial_plan_lines_select
on ltc_m.financial_plan_lines
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
    or exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = financial_plan_lines.plan_version_id
            and plan_versions.status in ('approved', 'locked')
    )
);

create policy financial_plan_lines_insert
on ltc_m.financial_plan_lines
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
    and exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = financial_plan_lines.plan_version_id
            and plan_versions.status = 'draft'
    )
);

create policy financial_plan_lines_update
on ltc_m.financial_plan_lines
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
    and exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = financial_plan_lines.plan_version_id
            and plan_versions.status = 'draft'
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
    and exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = financial_plan_lines.plan_version_id
            and plan_versions.status = 'draft'
    )
);

create policy financial_actual_events_select
on ltc_m.financial_actual_events
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
    )
);

create policy financial_actual_events_insert
on ltc_m.financial_actual_events
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy financial_actual_events_update
on ltc_m.financial_actual_events
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy import_batches_select
on ltc_m.import_batches
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy import_batches_insert
on ltc_m.import_batches
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy import_batches_update
on ltc_m.import_batches
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy import_row_errors_select
on ltc_m.import_row_errors
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy import_row_errors_insert
on ltc_m.import_row_errors
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

revoke all privileges on schema ltc_m from public;
revoke all privileges on all tables in schema ltc_m from public;
revoke all privileges on all sequences in schema ltc_m from public;
revoke execute on all functions in schema ltc_m from public;
revoke execute on all functions in schema ltc_m from ltc_m_runtime;

alter default privileges in schema ltc_m
    revoke execute on functions from public;

grant usage on schema ltc_m to ltc_m_runtime;

grant select, insert, update on table
    ltc_m.currencies,
    ltc_m.units,
    ltc_m.clients,
    ltc_m.projects,
    ltc_m.project_items,
    ltc_m.plan_versions,
    ltc_m.financial_plan_scopes,
    ltc_m.financial_plan_lines,
    ltc_m.financial_actual_events,
    ltc_m.import_batches
to ltc_m_runtime;

grant insert, update on table ltc_m.app_users to ltc_m_runtime;
grant select (
    id,
    email,
    full_name,
    role,
    active,
    created_at,
    updated_at,
    row_version
) on table ltc_m.app_users to ltc_m_runtime;

grant insert on table ltc_m.import_row_errors to ltc_m_runtime;
grant select (
    id,
    batch_id,
    sheet_name,
    source_row,
    entity_type,
    error_code,
    error_message,
    created_at
) on table ltc_m.import_row_errors to ltc_m_runtime;

grant usage on sequence ltc_m.import_row_errors_id_seq to ltc_m_runtime;

grant execute on function ltc_m.set_actor_context(
    uuid,
    text,
    text,
    text,
    text,
    boolean
) to ltc_m_runtime;
grant execute on function ltc_m.authorization_context() to ltc_m_runtime;
grant execute on function ltc_m.submit_plan_version(uuid) to ltc_m_runtime;
grant execute on function ltc_m.return_plan_version_to_draft(uuid)
    to ltc_m_runtime;
grant execute on function ltc_m.approve_plan_version(uuid) to ltc_m_runtime;
grant execute on function ltc_m.lock_plan_version(uuid) to ltc_m_runtime;
grant execute on function ltc_m.reopen_plan_version(uuid, text)
    to ltc_m_runtime;
grant execute on function ltc_m.read_audit_log(
    integer,
    timestamptz,
    bigint,
    timestamptz,
    timestamptz,
    text,
    ltc_m.audit_operation,
    uuid,
    text
) to ltc_m_runtime;

comment on function ltc_m.authorization_context() is
    'Helper RLS fail-closed: valida ID, auth_subject, usuário ativo e role armazenada sem recursão.';

comment on function ltc_m.enforce_admin_inactivation() is
    'Protege ciclo de vida, role e último admin ativo com serialização transacional independente de RLS.';

comment on function ltc_m.read_audit_log(
    integer,
    timestamptz,
    bigint,
    timestamptz,
    timestamptz,
    text,
    ltc_m.audit_operation,
    uuid,
    text
) is
    'Consulta admin sanitizada, paginada, parametrizada e auditada da trilha P007.';

commit;
