-- P008 / D27 — conexão isolada do perfil Editor e workflow P007.
begin;

select ltc_m.set_actor_context(null, null, 'p008-{{RUN_TOKEN}}-setup', null, 'system', false);

insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values ('{{UUID_PREFIX}}021', 'p008-{{RUN_TOKEN}}|editor', 'P008 isolated editor', 'editor', true);

insert into ltc_m.plan_versions (id, name, reference_date, created_by_user_id)
values (
    '{{UUID_PREFIX}}421', 'P008 {{RUN_TOKEN}} editor plan', date '2026-07-31',
    '{{UUID_PREFIX}}021'
);

set local role ltc_m_runtime;
select ltc_m.set_actor_context(
    '{{UUID_PREFIX}}021', 'p008-{{RUN_TOKEN}}|editor', 'p008-{{RUN_TOKEN}}-editor'
);

do $editor$
declare
    v_client_id uuid;
begin
    insert into ltc_m.clients (legal_name, display_name)
    values ('P008 {{RUN_TOKEN}} editor client', 'P008 editor client')
    returning id into v_client_id;

    update ltc_m.clients
    set display_name = 'P008 editor updated'
    where clients.id = v_client_id;

    perform ltc_m.submit_plan_version('{{UUID_PREFIX}}421');

    begin
        perform ltc_m.approve_plan_version('{{UUID_PREFIX}}421');
        raise exception 'P008 isolated: Editor aprovou versão.';
    exception when sqlstate 'P0001' or insufficient_privilege then null;
    end;

    begin
        update ltc_m.clients set active = false where clients.id = v_client_id;
        raise exception 'P008 isolated: Editor inativou cliente.';
    exception when insufficient_privilege then null;
    end;

    begin
        perform count(*) from ltc_m.read_audit_log();
        raise exception 'P008 isolated: Editor consultou auditoria.';
    exception when insufficient_privilege then null;
    end;
end;
$editor$;

rollback;

select pg_catalog.jsonb_build_object(
    'scenario', 'editor',
    'rollback_clean',
        (select count(*) from ltc_m.app_users) = 0
        and (select count(*) from ltc_m.clients) = 0
        and (select count(*) from ltc_m.plan_versions) = 0
) as p008_runtime_result;
