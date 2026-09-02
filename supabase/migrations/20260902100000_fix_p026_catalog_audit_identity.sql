-- P026-D21: preserve the natural-key identity of catalog audit records.
-- The generic audit trigger defaults to UUID-like `id`; catalogs use `code`.

create or replace function ltc_m.maintain_row_metadata()
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
    v_old_data jsonb;
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

    v_old_data := pg_catalog.to_jsonb(old);
    if v_data ? 'created_at' then
        v_data := v_data
            || pg_catalog.jsonb_build_object('created_at', v_old_data -> 'created_at');
    end if;
    if (
        v_data - v_ignored_columns
    ) is not distinct from (
        v_old_data - v_ignored_columns
    ) then
        return old;
    end if;

    v_old_version := (v_old_data ->> v_version_column)::bigint;
    v_data := v_data
        || pg_catalog.jsonb_build_object(
            'updated_at',
            v_timestamp,
            v_version_column,
            v_old_version + 1
        );
    if v_data ? 'created_at' then
        v_data := v_data
            || pg_catalog.jsonb_build_object('created_at', v_old_data -> 'created_at');
    end if;

    if v_actor_id is not null and v_data ? 'updated_by_user_id' then
        v_data := v_data
            || pg_catalog.jsonb_build_object('updated_by_user_id', v_actor_id);
    end if;

    new := pg_catalog.jsonb_populate_record(new, v_data);
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
    v_identity_column text;
    v_record_id text;
    v_previous_version bigint;
    v_new_version bigint;
begin
    if tg_op = 'UPDATE' and new is not distinct from old then
        return new;
    end if;

    v_identity_column := case
        when tg_nargs = 0 then 'id'
        when tg_nargs = 1 then nullif(pg_catalog.btrim(tg_argv[0]), '')
        else null
    end;

    if v_identity_column is null
        or v_identity_column !~ '^[a-z_][a-z0-9_]*$'
    then
        raise exception using
            errcode = 'P0001',
            message = 'Identidade de auditoria configurada de forma inválida.';
    end if;

    v_actor_subject := case
        when v_actor_id is null then 'system:database'
        else pg_catalog.current_setting('ltc_m.actor_auth_subject', true)
    end;

    if tg_op = 'INSERT' then
        v_operation := 'INSERT';
    elsif tg_op = 'UPDATE' then
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

drop trigger trg_90_currencies_audit on ltc_m.currencies;
create trigger trg_90_currencies_audit
after insert or update or delete on ltc_m.currencies
for each row execute function ltc_m.audit_row_change('code');

drop trigger trg_90_units_audit on ltc_m.units;
create trigger trg_90_units_audit
after insert or update or delete on ltc_m.units
for each row execute function ltc_m.audit_row_change('code');
