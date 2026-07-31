-- P008 / D27 — conexão isolada do perfil Viewer.
begin;

select ltc_m.set_actor_context(null, null, 'p008-{{RUN_TOKEN}}-setup', null, 'system', false);

insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values ('{{UUID_PREFIX}}011', 'p008-{{RUN_TOKEN}}|viewer', 'P008 isolated viewer', 'viewer', true);

insert into ltc_m.clients (id, legal_name, display_name, active)
values
    ('{{UUID_PREFIX}}111', 'P008 {{RUN_TOKEN}} active', 'P008 active', true),
    ('{{UUID_PREFIX}}112', 'P008 {{RUN_TOKEN}} inactive', 'P008 inactive', false);

set local role ltc_m_runtime;
select ltc_m.set_actor_context(
    '{{UUID_PREFIX}}011', 'p008-{{RUN_TOKEN}}|viewer', 'p008-{{RUN_TOKEN}}-viewer'
);

do $viewer$
declare
    v_count integer;
    v_rows integer;
begin
    select count(*) into v_count from ltc_m.clients;
    if v_count <> 1 then
        raise exception 'P008 isolated: Viewer não aplicou filtro de leitura.';
    end if;

    update ltc_m.clients
    set display_name = 'P008 forbidden viewer update';
    get diagnostics v_rows = row_count;
    if v_rows <> 0 then
        raise exception 'P008 isolated: Viewer alterou cadastro.';
    end if;

    begin
        perform count(*) from ltc_m.audit_log;
        raise exception 'P008 isolated: Viewer leu audit_log diretamente.';
    exception when insufficient_privilege then null;
    end;

    begin
        perform count(*) from ltc_m.read_audit_log();
        raise exception 'P008 isolated: Viewer consultou auditoria controlada.';
    exception when insufficient_privilege then null;
    end;
end;
$viewer$;

rollback;

select pg_catalog.jsonb_build_object(
    'scenario', 'viewer',
    'rollback_clean',
        (select count(*) from ltc_m.app_users) = 0
        and (select count(*) from ltc_m.clients) = 0
) as p008_runtime_result;
