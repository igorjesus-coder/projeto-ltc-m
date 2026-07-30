begin;

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
            or (v_old_data -> 'active') is distinct from
                (v_new_data -> 'active');
    end if;

    if tg_table_name = 'app_users'
        and v_old_data ? 'role'
        and v_new_data ? 'role'
    then
        v_role_changed := (v_old_data -> 'role')
            is distinct from (v_new_data -> 'role');
    end if;

    if not v_lifecycle_changed and not v_role_changed then
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
            message = 'Operação rejeitada: alteração administrativa exige admin ativo.';
    end if;

    if v_lifecycle_changed then
        perform ltc_m.current_justification(true);
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

comment on function ltc_m.enforce_admin_inactivation() is
    'Protege inativação/restauração nas colunas existentes e mudanças de papel em app_users.';

commit;
