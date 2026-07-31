-- P008 / D27 — conexão isolada do workflow P007 permitido ao Editor.
begin;

select ltc_m.set_actor_context(null, null, 'p008-{{RUN_TOKEN}}-setup', null, 'system', false);

insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values ('{{UUID_PREFIX}}025', 'p008-{{RUN_TOKEN}}|editor-flow', 'P008 workflow editor', 'editor', true);

insert into ltc_m.plan_versions (id, name, reference_date, created_by_user_id)
values (
    '{{UUID_PREFIX}}425', 'P008 {{RUN_TOKEN}} workflow plan', date '2026-07-31',
    '{{UUID_PREFIX}}025'
);

set local role ltc_m_runtime;
select ltc_m.set_actor_context(
    '{{UUID_PREFIX}}025', 'p008-{{RUN_TOKEN}}|editor-flow', 'p008-{{RUN_TOKEN}}-editor-flow'
);

select ltc_m.submit_plan_version('{{UUID_PREFIX}}425');

do $editor_workflow$
begin
    if not exists (
        select 1
        from ltc_m.plan_versions
        where plan_versions.id = '{{UUID_PREFIX}}425'
            and plan_versions.status = 'pending_approval'
    ) then
        raise exception 'P008 isolated: Editor não submeteu versão.';
    end if;

    begin
        perform ltc_m.approve_plan_version('{{UUID_PREFIX}}425');
        raise exception 'P008 isolated: Editor aprovou versão.';
    exception when sqlstate 'P0001' or insufficient_privilege then null;
    end;
end;
$editor_workflow$;

rollback;

select pg_catalog.jsonb_build_object(
    'scenario', 'editor_workflow',
    'rollback_clean',
        (select count(*) from ltc_m.app_users) = 0
        and (select count(*) from ltc_m.plan_versions) = 0
) as p008_runtime_result;
