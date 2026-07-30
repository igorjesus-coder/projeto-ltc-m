begin;

alter table ltc_m.app_users
    add column row_version bigint not null default 1,
    add constraint ck_app_users_row_version check (row_version > 0);

alter table ltc_m.clients
    add column row_version bigint not null default 1,
    add constraint ck_clients_row_version check (row_version > 0);

alter table ltc_m.project_items
    add column row_version bigint not null default 1,
    add constraint ck_project_items_row_version check (row_version > 0);

alter table ltc_m.plan_versions
    add column row_version bigint not null default 1,
    add column updated_by_user_id uuid references ltc_m.app_users (id),
    add column source_plan_version_id uuid references ltc_m.plan_versions (id),
    add constraint ck_plan_versions_row_version check (row_version > 0);

alter table ltc_m.financial_plan_scopes
    add column row_version bigint not null default 1,
    add constraint ck_financial_plan_scopes_row_version check (row_version > 0);

alter table ltc_m.financial_plan_lines
    add column row_version bigint not null default 1,
    add constraint ck_financial_plan_lines_row_version check (row_version > 0);

alter table ltc_m.financial_actual_events
    add column row_version bigint not null default 1,
    add constraint ck_financial_actual_events_row_version check (row_version > 0);

alter table ltc_m.import_batches
    add column updated_at timestamptz not null default now(),
    add column row_version bigint not null default 1,
    add constraint ck_import_batches_row_version check (row_version > 0);

alter table ltc_m.audit_log
    add column actor_auth_subject text,
    add column source text not null default 'system',
    add column justification text,
    add column previous_row_version bigint,
    add column new_row_version bigint,
    add column metadata jsonb not null default '{}'::jsonb,
    add constraint ck_audit_log_actor_auth_subject
        check (
            actor_auth_subject is null
            or (
                actor_auth_subject = btrim(actor_auth_subject)
                and actor_auth_subject <> ''
                and length(actor_auth_subject) <= 255
            )
        ),
    add constraint ck_audit_log_source
        check (
            source = btrim(source)
            and source ~ '^[a-z][a-z0-9_-]{0,49}$'
        ),
    add constraint ck_audit_log_justification
        check (
            justification is null
            or (
                justification = btrim(justification)
                and justification <> ''
                and length(justification) <= 2000
            )
        ),
    add constraint ck_audit_log_row_versions
        check (
            (previous_row_version is null or previous_row_version > 0)
            and (new_row_version is null or new_row_version > 0)
        ),
    add constraint ck_audit_log_metadata_object
        check (jsonb_typeof(metadata) = 'object');

alter table ltc_m.plan_versions
    drop constraint ck_plan_versions_approval,
    add constraint ck_plan_versions_approval
        check (
            (
                status::text in ('draft', 'pending_approval')
                and approved_by_user_id is null
                and approved_at is null
            )
            or (
                status::text in ('approved', 'locked')
                and approved_by_user_id is not null
                and approved_at is not null
            )
            or status::text = 'archived'
        );

create index ix_plan_versions_source
    on ltc_m.plan_versions (source_plan_version_id)
    where source_plan_version_id is not null;

create function ltc_m.set_actor_context(
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

        if p_auth_subject is not null
            and btrim(p_auth_subject) is distinct from v_auth_subject
        then
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

create function ltc_m.current_actor_id(p_required boolean default false)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
    v_actor_text text := nullif(
        pg_catalog.current_setting('ltc_m.app_user_id', true),
        ''
    );
    v_actor_id uuid;
begin
    if v_actor_text is null then
        if p_required then
            raise exception using
                errcode = 'P0001',
                message = 'Operação rejeitada: contexto de ator autenticado é obrigatório.';
        end if;
        return null;
    end if;

    begin
        v_actor_id := v_actor_text::uuid;
    exception
        when invalid_text_representation then
            raise exception using
                errcode = '22023',
                message = 'Operação rejeitada: app_user_id do contexto é inválido.';
    end;

    if not exists (
        select 1
        from ltc_m.app_users
        where
            app_users.id = v_actor_id
            and app_users.active = true
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'Operação rejeitada: ator inexistente ou inativo.';
    end if;

    return v_actor_id;
end;
$function$;

create function ltc_m.current_justification(p_required boolean default false)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
    v_justification text := nullif(
        btrim(pg_catalog.current_setting('ltc_m.justification', true)),
        ''
    );
begin
    if p_required and v_justification is null then
        raise exception using
            errcode = 'P0001',
            message = 'Operação rejeitada: justificativa é obrigatória.';
    end if;
    return v_justification;
end;
$function$;

create function ltc_m.workflow_guard_active(p_action text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
    select
        pg_catalog.current_setting('ltc_m.workflow_action', true) = p_action
        and exists (
            select 1
            from pg_catalog.pg_class
            join pg_catalog.pg_roles
                on pg_roles.oid = pg_class.relowner
            where
                pg_class.oid = pg_catalog.to_regclass('ltc_m.plan_versions')
                and pg_roles.rolname = current_user
        );
$function$;

create function ltc_m.sanitize_audit_payload(
    p_table_name text,
    p_payload jsonb
)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
    select case
        when p_payload is null then null
        when p_table_name = 'app_users'
            then p_payload - array['auth_subject', 'email']
        when p_table_name = 'clients'
            then p_payload - array['tax_id']
        when p_table_name = 'financial_actual_events'
            then p_payload - array[
                'document_number',
                'installment_key',
                'notes'
            ]
        when p_table_name = 'import_batches'
            then p_payload - array['source_hash']
        when p_table_name = 'import_row_errors'
            then p_payload - array['raw_payload', 'natural_key']
        else p_payload - array['notes']
    end;
$function$;

create function ltc_m.maintain_row_metadata()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_data jsonb := pg_catalog.to_jsonb(new);
    v_actor_id uuid := ltc_m.current_actor_id(false);
    v_timestamp timestamptz := pg_catalog.clock_timestamp();
    v_version_column text := tg_argv[0];
    v_ignored_columns text[] := array[
        'created_at',
        'updated_at',
        v_version_column,
        'updated_by_user_id'
    ];
    v_old_version bigint;
begin
    if tg_op = 'INSERT' then
        v_data := v_data
            || pg_catalog.jsonb_build_object(
                'created_at',
                v_timestamp,
                'updated_at',
                v_timestamp,
                v_version_column,
                1
            );

        if v_actor_id is not null and v_data ? 'created_by_user_id' then
            v_data := v_data
                || pg_catalog.jsonb_build_object(
                    'created_by_user_id',
                    v_actor_id
                );
        end if;
        if v_actor_id is not null and v_data ? 'updated_by_user_id' then
            v_data := v_data
                || pg_catalog.jsonb_build_object(
                    'updated_by_user_id',
                    v_actor_id
                );
        end if;

        new := pg_catalog.jsonb_populate_record(new, v_data);
        return new;
    end if;

    new.created_at := old.created_at;
    if (
        pg_catalog.to_jsonb(new) - v_ignored_columns
    ) is not distinct from (
        pg_catalog.to_jsonb(old) - v_ignored_columns
    ) then
        return old;
    end if;

    v_old_version := (pg_catalog.to_jsonb(old) ->> v_version_column)::bigint;
    v_data := pg_catalog.to_jsonb(new)
        || pg_catalog.jsonb_build_object(
            'created_at',
            old.created_at,
            'updated_at',
            v_timestamp,
            v_version_column,
            v_old_version + 1
        );

    if v_actor_id is not null and v_data ? 'updated_by_user_id' then
        v_data := v_data
            || pg_catalog.jsonb_build_object(
                'updated_by_user_id',
                v_actor_id
            );
    end if;

    new := pg_catalog.jsonb_populate_record(new, v_data);
    return new;
end;
$function$;

create function ltc_m.enforce_admin_inactivation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_old_data jsonb := pg_catalog.to_jsonb(old);
    v_new_data jsonb := pg_catalog.to_jsonb(new);
    v_changed boolean := false;
    v_actor_id uuid;
begin
    if v_old_data ? 'deleted_at' then
        v_changed := (v_old_data -> 'deleted_at')
            is distinct from (v_new_data -> 'deleted_at');
    end if;

    if v_old_data ? 'active' then
        v_changed := v_changed
            or (v_old_data -> 'active') is distinct from (v_new_data -> 'active');
    end if;

    if not v_changed then
        return new;
    end if;

    v_actor_id := ltc_m.current_actor_id(true);
    if not exists (
        select 1
        from ltc_m.app_users
        where
            app_users.id = v_actor_id
            and app_users.role = 'admin'
            and app_users.active = true
    ) then
        raise exception using
            errcode = '42501',
            message = 'Operação rejeitada: inativação ou restauração exige admin ativo.';
    end if;

    perform ltc_m.current_justification(true);

    if v_old_data ? 'deleted_at'
        and old.deleted_at is distinct from new.deleted_at
        and new.deleted_at is not null
    then
        new.deleted_at := pg_catalog.clock_timestamp();
    end if;

    return new;
end;
$function$;

create function ltc_m.prevent_physical_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
    raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
            'DELETE físico rejeitado em ltc_m.%I; use o fluxo lógico aprovado.',
            tg_table_name
        );
end;
$function$;

create function ltc_m.protect_plan_version()
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
                message = 'Versão pendente, aprovada ou bloqueada é imutável.';
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
        else null
    end;

    if v_action is null or not ltc_m.workflow_guard_active(v_action) then
        raise exception using
            errcode = 'P0001',
            message = 'Transição de status rejeitada: use a função de workflow correspondente.';
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

create function ltc_m.protect_plan_content()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_plan_version_id uuid;
    v_status text;
begin
    if tg_op = 'UPDATE' and old.plan_version_id <> new.plan_version_id then
        select plan_versions.status::text
        into v_status
        from ltc_m.plan_versions
        where plan_versions.id = old.plan_version_id
        for key share;

        if v_status <> 'draft' then
            raise exception using
                errcode = 'P0001',
                message = 'Conteúdo de versão não draft é imutável.';
        end if;
    end if;

    v_plan_version_id := new.plan_version_id;
    select plan_versions.status::text
    into v_status
    from ltc_m.plan_versions
    where plan_versions.id = v_plan_version_id
    for key share;

    if v_status is null then
        return new;
    end if;
    if v_status <> 'draft' then
        raise exception using
            errcode = 'P0001',
            message = 'Conteúdo de versão pendente, aprovada ou bloqueada é imutável.';
    end if;

    return new;
end;
$function$;

create function ltc_m.audit_row_change()
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
    v_action text := pg_catalog.current_setting(
        'ltc_m.workflow_action',
        true
    );
    v_metadata jsonb := '{}'::jsonb;
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

    if tg_op = 'INSERT' then
        v_operation := 'INSERT';
        v_record_id := v_new_data ->> 'id';
    elsif tg_op = 'UPDATE' then
        v_record_id := v_new_data ->> 'id';
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
                nullif(
                    pg_catalog.current_setting(
                        'ltc_m.exceptional_self_approval',
                        true
                    ),
                    ''
                )::boolean,
                false
            ),
            'active_admin_count',
            (
                select count(*)
                from ltc_m.app_users
                where
                    app_users.role = 'admin'
                    and app_users.active = true
            )
        );
    end if;

    insert into ltc_m.audit_log (
        table_name,
        record_id,
        operation,
        old_data,
        new_data,
        changed_by_user_id,
        actor_auth_subject,
        request_id,
        source,
        justification,
        previous_row_version,
        new_row_version,
        metadata
    )
    values (
        pg_catalog.format('ltc_m.%I', tg_table_name),
        v_record_id,
        v_operation,
        ltc_m.sanitize_audit_payload(tg_table_name, v_old_data),
        ltc_m.sanitize_audit_payload(tg_table_name, v_new_data),
        v_actor_id,
        v_actor_subject,
        nullif(
            btrim(pg_catalog.current_setting('ltc_m.request_id', true)),
            ''
        ),
        coalesce(
            nullif(
                btrim(pg_catalog.current_setting('ltc_m.source', true)),
                ''
            ),
            'system'
        ),
        ltc_m.current_justification(false),
        v_previous_version,
        v_new_version,
        v_metadata
    );

    return new;
end;
$function$;

create function ltc_m.prevent_audit_log_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
    raise exception using
        errcode = 'P0001',
        message = 'audit_log é append-only: UPDATE e DELETE são proibidos.';
end;
$function$;

create function ltc_m.prevent_append_only_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
    raise exception using
        errcode = 'P0001',
        message = pg_catalog.format(
            'ltc_m.%I é append-only: UPDATE é proibido.',
            tg_table_name
        );
end;
$function$;

create function ltc_m.submit_plan_version(p_plan_version_id uuid)
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
    if not exists (
        select 1
        from ltc_m.app_users
        where
            app_users.id = v_actor_id
            and app_users.active = true
            and app_users.role in ('editor', 'admin')
    ) then
        raise exception using
            errcode = '42501',
            message = 'Envio para aprovação exige editor ou admin ativo.';
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
    if v_current_status <> 'draft' then
        raise exception using
            errcode = 'P0001',
            message = 'Somente versão draft pode ser enviada para aprovação.';
    end if;

    perform pg_catalog.set_config('ltc_m.workflow_action', 'submit', true);

    return query
    update ltc_m.plan_versions
    set status = 'pending_approval'
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

create function ltc_m.return_plan_version_to_draft(p_plan_version_id uuid)
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
            and app_users.role = 'admin'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Devolução para draft exige admin ativo.';
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

create function ltc_m.approve_plan_version(p_plan_version_id uuid)
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
    v_admin_count integer;
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
    if not exists (
        select 1
        from ltc_m.app_users
        where
            app_users.id = v_actor_id
            and app_users.active = true
            and app_users.role = 'admin'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Aprovação exige admin ativo.';
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
        app_users.role = 'admin'
        and app_users.active = true
    for key share;

    select count(*)
    into v_admin_count
    from ltc_m.app_users
    where
        app_users.role = 'admin'
        and app_users.active = true;

    v_self_approval := v_actor_id = v_plan.created_by_user_id
        or v_actor_id = v_plan.updated_by_user_id;

    if v_self_approval and v_admin_count > 1 then
        raise exception using
            errcode = '42501',
            message = 'Autoaprovação rejeitada: existe outro admin ativo.';
    end if;

    if v_self_approval then
        perform ltc_m.current_justification(true);
        if not v_exceptional then
            raise exception using
                errcode = 'P0001',
                message = 'Autoaprovação excepcional exige indicador explícito no contexto.';
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

create function ltc_m.lock_plan_version(p_plan_version_id uuid)
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
            and app_users.role = 'admin'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Bloqueio exige admin ativo.';
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
    if v_current_status <> 'approved' then
        raise exception using
            errcode = 'P0001',
            message = 'Somente versão aprovada pode ser bloqueada.';
    end if;

    perform pg_catalog.set_config('ltc_m.workflow_action', 'lock', true);

    return query
    update ltc_m.plan_versions
    set status = 'locked'
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

create function ltc_m.reopen_plan_version(
    p_source_plan_version_id uuid,
    p_new_name text
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
    v_actor_subject text := pg_catalog.current_setting(
        'ltc_m.actor_auth_subject',
        true
    );
    v_request_id text := nullif(
        btrim(pg_catalog.current_setting('ltc_m.request_id', true)),
        ''
    );
    v_source_name text := nullif(btrim(p_new_name), '');
    v_origin text := coalesce(
        nullif(
            btrim(pg_catalog.current_setting('ltc_m.source', true)),
            ''
        ),
        'system'
    );
begin
    if v_source_name is null then
        raise exception using
            errcode = '22023',
            message = 'Reabertura exige nome não vazio para a nova versão.';
    end if;

    if not exists (
        select 1
        from ltc_m.app_users
        where
            app_users.id = v_actor_id
            and app_users.active = true
            and app_users.role = 'admin'
    ) then
        raise exception using
            errcode = '42501',
            message = 'Reabertura exige admin ativo.';
    end if;

    select plan_versions.*
    into v_source
    from ltc_m.plan_versions
    where plan_versions.id = p_source_plan_version_id
    for update;

    if not found then
        raise exception using
            errcode = 'P0002',
            message = 'Versão de planejamento de origem não encontrada.';
    end if;
    if v_source.status::text not in ('approved', 'locked') then
        raise exception using
            errcode = 'P0001',
            message = 'Somente versão aprovada ou bloqueada pode ser reaberta.';
    end if;

    insert into ltc_m.plan_versions (
        name,
        reference_date,
        status,
        is_baseline,
        notes,
        created_by_user_id,
        updated_by_user_id,
        source_plan_version_id
    )
    values (
        v_source_name,
        v_source.reference_date,
        'draft',
        false,
        v_source.notes,
        v_actor_id,
        v_actor_id,
        v_source.id
    )
    returning *
    into v_new_plan;

    insert into ltc_m.financial_plan_scopes (
        id,
        plan_version_id,
        project_id,
        metric_type,
        planning_level,
        currency_code,
        created_by_user_id,
        updated_by_user_id
    )
    select
        pg_catalog.gen_random_uuid(),
        v_new_plan.id,
        financial_plan_scopes.project_id,
        financial_plan_scopes.metric_type,
        financial_plan_scopes.planning_level,
        financial_plan_scopes.currency_code,
        v_actor_id,
        v_actor_id
    from ltc_m.financial_plan_scopes
    where financial_plan_scopes.plan_version_id = v_source.id;

    insert into ltc_m.financial_plan_lines (
        id,
        plan_version_id,
        project_id,
        project_item_id,
        metric_type,
        planning_level,
        competence_month,
        amount,
        currency_code,
        notes,
        created_by_user_id,
        updated_by_user_id
    )
    select
        pg_catalog.gen_random_uuid(),
        v_new_plan.id,
        financial_plan_lines.project_id,
        financial_plan_lines.project_item_id,
        financial_plan_lines.metric_type,
        financial_plan_lines.planning_level,
        financial_plan_lines.competence_month,
        financial_plan_lines.amount,
        financial_plan_lines.currency_code,
        financial_plan_lines.notes,
        v_actor_id,
        v_actor_id
    from ltc_m.financial_plan_lines
    where financial_plan_lines.plan_version_id = v_source.id;

    insert into ltc_m.audit_log (
        table_name,
        record_id,
        operation,
        old_data,
        new_data,
        changed_by_user_id,
        actor_auth_subject,
        request_id,
        source,
        justification,
        previous_row_version,
        new_row_version,
        metadata
    )
    values
        (
            'ltc_m.plan_versions',
            v_source.id::text,
            'REOPEN',
            ltc_m.sanitize_audit_payload(
                'plan_versions',
                pg_catalog.to_jsonb(v_source)
            ),
            ltc_m.sanitize_audit_payload(
                'plan_versions',
                pg_catalog.to_jsonb(v_source)
            ),
            v_actor_id,
            v_actor_subject,
            v_request_id,
            v_origin,
            v_justification,
            v_source.row_version,
            v_source.row_version,
            pg_catalog.jsonb_build_object(
                'reopened_as_plan_version_id',
                v_new_plan.id
            )
        ),
        (
            'ltc_m.plan_versions',
            v_new_plan.id::text,
            'REOPEN',
            null,
            ltc_m.sanitize_audit_payload(
                'plan_versions',
                pg_catalog.to_jsonb(v_new_plan)
            ),
            v_actor_id,
            v_actor_subject,
            v_request_id,
            v_origin,
            v_justification,
            null,
            v_new_plan.row_version,
            pg_catalog.jsonb_build_object(
                'source_plan_version_id',
                v_source.id
            )
        );

    return v_new_plan.id;
end;
$function$;

create trigger trg_10_app_users_metadata
before insert or update on ltc_m.app_users
for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_10_clients_metadata
before insert or update on ltc_m.clients
for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_10_projects_metadata
before insert or update on ltc_m.projects
for each row execute function ltc_m.maintain_row_metadata('version');

create trigger trg_10_project_items_metadata
before insert or update on ltc_m.project_items
for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_10_plan_versions_protect
before insert or update on ltc_m.plan_versions
for each row execute function ltc_m.protect_plan_version();

create trigger trg_20_plan_versions_metadata
before insert or update on ltc_m.plan_versions
for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_10_financial_plan_scopes_protect
before insert or update on ltc_m.financial_plan_scopes
for each row execute function ltc_m.protect_plan_content();

create trigger trg_20_financial_plan_scopes_metadata
before insert or update on ltc_m.financial_plan_scopes
for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_10_financial_plan_lines_protect
before insert or update on ltc_m.financial_plan_lines
for each row execute function ltc_m.protect_plan_content();

create trigger trg_20_financial_plan_lines_metadata
before insert or update on ltc_m.financial_plan_lines
for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_10_financial_actual_events_metadata
before insert or update on ltc_m.financial_actual_events
for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_10_import_batches_metadata
before insert or update on ltc_m.import_batches
for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_05_app_users_inactivation
before update on ltc_m.app_users
for each row execute function ltc_m.enforce_admin_inactivation();

create trigger trg_05_clients_inactivation
before update on ltc_m.clients
for each row execute function ltc_m.enforce_admin_inactivation();

create trigger trg_05_projects_inactivation
before update on ltc_m.projects
for each row execute function ltc_m.enforce_admin_inactivation();

create trigger trg_05_project_items_inactivation
before update on ltc_m.project_items
for each row execute function ltc_m.enforce_admin_inactivation();

create trigger trg_00_app_users_no_delete
before delete on ltc_m.app_users
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_currencies_no_delete
before delete on ltc_m.currencies
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_units_no_delete
before delete on ltc_m.units
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_clients_no_delete
before delete on ltc_m.clients
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_projects_no_delete
before delete on ltc_m.projects
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_project_items_no_delete
before delete on ltc_m.project_items
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_plan_versions_no_delete
before delete on ltc_m.plan_versions
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_financial_plan_scopes_no_delete
before delete on ltc_m.financial_plan_scopes
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_financial_plan_lines_no_delete
before delete on ltc_m.financial_plan_lines
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_financial_actual_events_no_delete
before delete on ltc_m.financial_actual_events
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_import_batches_no_delete
before delete on ltc_m.import_batches
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_import_row_errors_no_delete
before delete on ltc_m.import_row_errors
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_import_row_errors_append_only
before update on ltc_m.import_row_errors
for each row execute function ltc_m.prevent_append_only_change();

create trigger trg_90_app_users_audit
after insert or update on ltc_m.app_users
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_clients_audit
after insert or update on ltc_m.clients
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_projects_audit
after insert or update on ltc_m.projects
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_project_items_audit
after insert or update on ltc_m.project_items
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_plan_versions_audit
after insert or update on ltc_m.plan_versions
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_financial_plan_scopes_audit
after insert or update on ltc_m.financial_plan_scopes
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_financial_plan_lines_audit
after insert or update on ltc_m.financial_plan_lines
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_financial_actual_events_audit
after insert or update on ltc_m.financial_actual_events
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_import_batches_audit
after insert or update on ltc_m.import_batches
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_import_row_errors_audit
after insert on ltc_m.import_row_errors
for each row execute function ltc_m.audit_row_change();

create trigger trg_00_audit_log_append_only
before update or delete on ltc_m.audit_log
for each row execute function ltc_m.prevent_audit_log_change();

comment on column ltc_m.projects.version is
    'Versão otimista; o backend atualiza com WHERE id = ... AND version = expected_version.';

comment on column ltc_m.plan_versions.source_plan_version_id is
    'Linhagem imutável da reabertura por clonagem; a origem permanece preservada.';

comment on function ltc_m.set_actor_context(
    uuid,
    text,
    text,
    text,
    text,
    boolean
) is
    'Define contexto local à transação; o backend Auth0 valida o JWT antes de chamar.';

comment on function ltc_m.audit_row_change() is
    'SECURITY DEFINER restrito a trigger, com search_path vazio, para auditoria atômica.';

comment on function ltc_m.submit_plan_version(uuid) is
    'SECURITY DEFINER justificado para tornar o guard de workflow inacessível ao papel comum.';

comment on function ltc_m.return_plan_version_to_draft(uuid) is
    'SECURITY DEFINER justificado para transição administrativa atômica e auditada.';

comment on function ltc_m.approve_plan_version(uuid) is
    'SECURITY DEFINER justificado para aprovação atômica e regra de autoaprovação.';

comment on function ltc_m.lock_plan_version(uuid) is
    'SECURITY DEFINER justificado para bloqueio atômico de versão aprovada.';

comment on function ltc_m.reopen_plan_version(uuid, text) is
    'SECURITY DEFINER justificado para clonagem transacional com preservação da origem.';

commit;
