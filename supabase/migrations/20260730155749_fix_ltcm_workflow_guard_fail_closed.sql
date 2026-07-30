begin;

create or replace function ltc_m.workflow_guard_active(p_action text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
    select coalesce(
        nullif(pg_catalog.btrim(p_action), '') in (
            'submit',
            'return',
            'approve',
            'lock'
        )
        and pg_catalog.current_setting(
            'ltc_m.workflow_action',
            true
        ) = nullif(pg_catalog.btrim(p_action), '')
        and exists (
            select 1
            from pg_catalog.pg_class
            join pg_catalog.pg_roles
                on pg_roles.oid = pg_class.relowner
            where
                pg_class.oid = pg_catalog.to_regclass('ltc_m.plan_versions')
                and pg_roles.rolname = current_user
        ),
        false
    );
$function$;

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

    if v_action is null
        or ltc_m.workflow_guard_active(v_action) is not true
    then
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
            and ltc_m.workflow_guard_active(v_action) is true
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
                pg_catalog.current_setting(
                    'ltc_m.exceptional_self_approval',
                    true
                ) = 'true',
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
            pg_catalog.btrim(
                pg_catalog.current_setting('ltc_m.request_id', true)
            ),
            ''
        ),
        coalesce(
            nullif(
                pg_catalog.btrim(
                    pg_catalog.current_setting('ltc_m.source', true)
                ),
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

create or replace function ltc_m.approve_plan_version(p_plan_version_id uuid)
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
        pg_catalog.current_setting(
            'ltc_m.exceptional_self_approval',
            true
        ) = 'true',
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

comment on function ltc_m.workflow_guard_active(text) is
    'Guarda fail-closed: ação ausente, vazia, inválida ou fora da função SECURITY DEFINER resulta em false.';

comment on function ltc_m.protect_plan_version() is
    'Protege transições e imutabilidade; a autorização interna deve ser explicitamente true.';

comment on function ltc_m.audit_row_change() is
    'Auditoria atômica com classificação de workflow fail-closed e booleanos de contexto sem cast inseguro.';

comment on function ltc_m.approve_plan_version(uuid) is
    'Aprovação atômica; indicador excepcional só é true para o valor textual canônico true.';

commit;
