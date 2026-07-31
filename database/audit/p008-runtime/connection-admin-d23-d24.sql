-- P008 / D27 — conexão isolada do Admin, D23 sequencial e D24.
begin;

select ltc_m.set_actor_context(null, null, 'p008-{{RUN_TOKEN}}-setup', null, 'system', false);

insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values
    ('{{UUID_PREFIX}}031', 'p008-{{RUN_TOKEN}}|admin-one', 'P008 isolated admin one', 'admin', true),
    ('{{UUID_PREFIX}}032', 'p008-{{RUN_TOKEN}}|admin-two', 'P008 isolated admin two', 'admin', true);

insert into ltc_m.clients (id, legal_name, display_name, active)
values ('{{UUID_PREFIX}}131', 'P008 {{RUN_TOKEN}} inactive', 'P008 inactive', false);

set local role ltc_m_runtime;
select ltc_m.set_actor_context(
    '{{UUID_PREFIX}}031', 'p008-{{RUN_TOKEN}}|admin-one', 'p008-{{RUN_TOKEN}}-admin',
    'P008 isolated D23'
);

do $admin_d23_d24$
declare
    v_count integer;
begin
    select count(*) into v_count from ltc_m.clients where not clients.active;
    if v_count <> 1 then
        raise exception 'P008 isolated: Admin não leu registro inativo.';
    end if;

    update ltc_m.app_users
    set role = 'viewer'
    where app_users.id = '{{UUID_PREFIX}}032';

    begin
        update ltc_m.app_users
        set active = false
        where app_users.id = '{{UUID_PREFIX}}031';
        raise exception 'P008 isolated: D23 permitiu remover o último admin.';
    exception when check_violation then null;
    end;

    if not exists (
        select 1
        from ltc_m.read_audit_log(
            p_limit => 200,
            p_entity => 'ltc_m.app_users',
            p_request_id => 'p008-{{RUN_TOKEN}}-admin'
        )
        where
            read_audit_log.old_data is not null
            and read_audit_log.new_data is not null
    ) then
        raise exception 'P008 isolated: D24 não retornou auditoria autorizada.';
    end if;

    if exists (
        select 1
        from ltc_m.read_audit_log(p_limit => 200)
        where
            coalesce(read_audit_log.old_data, '{}'::jsonb) ? 'auth_subject'
            or coalesce(read_audit_log.new_data, '{}'::jsonb) ? 'auth_subject'
            or position(
                'p008-{{RUN_TOKEN}}|admin-one'
                in coalesce(read_audit_log.old_data::text, '')
                    || coalesce(read_audit_log.new_data::text, '')
            ) > 0
            or position(
                'p008-{{RUN_TOKEN}}|admin-two'
                in coalesce(read_audit_log.old_data::text, '')
                    || coalesce(read_audit_log.new_data::text, '')
            ) > 0
    ) then
        raise exception 'P008 isolated: D24 expôs auth_subject.';
    end if;

    begin
        perform count(*) from ltc_m.audit_log;
        raise exception 'P008 isolated: Admin leu audit_log diretamente.';
    exception when insufficient_privilege then null;
    end;
end;
$admin_d23_d24$;

reset role;

do $audit_read_event$
begin
    if not exists (
        select 1
        from ltc_m.audit_log
        where
            audit_log.operation = 'AUDIT_READ'
            and audit_log.changed_by_user_id = '{{UUID_PREFIX}}031'
            and audit_log.request_id = 'p008-{{RUN_TOKEN}}-admin'
    ) then
        raise exception 'P008 isolated: D24 não auditou a própria consulta.';
    end if;
end;
$audit_read_event$;

rollback;

select pg_catalog.jsonb_build_object(
    'scenario', 'admin_d23_d24',
    'rollback_clean',
        (select count(*) from ltc_m.app_users) = 0
        and (select count(*) from ltc_m.clients) = 0
        and (select count(*) from ltc_m.audit_log) = 0
) as p008_runtime_result;
