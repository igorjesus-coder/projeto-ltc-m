-- P008 / D27 — conexão isolada para contextos ausente, divergente e inativo.
begin;

select ltc_m.set_actor_context(null, null, 'p008-{{RUN_TOKEN}}-setup', null, 'system', false);

insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values
    ('{{UUID_PREFIX}}001', 'p008-{{RUN_TOKEN}}|viewer', 'P008 isolated viewer', 'viewer', true),
    ('{{UUID_PREFIX}}002', 'p008-{{RUN_TOKEN}}|inactive', 'P008 isolated inactive', 'viewer', false);

set local role ltc_m_runtime;

do $invalid_context$
declare
    v_count integer;
begin
    perform pg_catalog.set_config('ltc_m.app_user_id', '', true);
    perform pg_catalog.set_config('ltc_m.actor_auth_subject', '', true);
    select count(*) into v_count from ltc_m.currencies;
    if v_count <> 0 then
        raise exception 'P008 isolated: contexto ausente permitiu leitura.';
    end if;

    begin
        perform ltc_m.set_actor_context(
            '{{UUID_PREFIX}}001', 'p008-{{RUN_TOKEN}}|divergent',
            'p008-{{RUN_TOKEN}}-divergent'
        );
        raise exception 'P008 isolated: subject divergente foi aceito.';
    exception when sqlstate 'P0001' then null;
    end;

    begin
        perform ltc_m.set_actor_context(
            '{{UUID_PREFIX}}999', 'p008-{{RUN_TOKEN}}|missing',
            'p008-{{RUN_TOKEN}}-missing'
        );
        raise exception 'P008 isolated: usuário inexistente foi aceito.';
    exception when sqlstate 'P0001' then null;
    end;

    begin
        perform ltc_m.set_actor_context(
            '{{UUID_PREFIX}}002', 'p008-{{RUN_TOKEN}}|inactive',
            'p008-{{RUN_TOKEN}}-inactive'
        );
        raise exception 'P008 isolated: usuário inativo foi aceito.';
    exception when sqlstate 'P0001' then null;
    end;
end;
$invalid_context$;

rollback;

select pg_catalog.jsonb_build_object(
    'scenario', 'invalid_context',
    'rollback_clean', (select count(*) from ltc_m.app_users) = 0
) as p008_runtime_result;
