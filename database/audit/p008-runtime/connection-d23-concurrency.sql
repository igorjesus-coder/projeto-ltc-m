-- P008 / D27 — uma das duas conexões concorrentes disputa a trava real de D23.
begin;
do $identity$
begin
    if session_user <> 'postgres' then
        raise exception 'P008 D23: conexao concorrente nao e administrativa.';
    end if;
end;
$identity$;

select ltc_m.set_actor_context(null, null, 'p008-{{RUN_TOKEN}}-setup', null, 'system', false);

insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values
    ('{{UUID_PREFIX}}901', 'p008-{{RUN_TOKEN}}|concurrency-one', 'P008 D23 concurrency one', 'admin', true),
    ('{{UUID_PREFIX}}902', 'p008-{{RUN_TOKEN}}|concurrency-two', 'P008 D23 concurrency two', 'admin', true);

set local role ltc_m_runtime;

do $runtime_identity$
begin
    if current_user <> 'ltc_m_runtime' or session_user <> 'postgres' then
        raise exception 'P008 D23: SET ROLE nao produziu conexao administrativa esperada.';
    end if;
end;
$runtime_identity$;

select ltc_m.set_actor_context(
    '{{UUID_PREFIX}}901', 'p008-{{RUN_TOKEN}}|concurrency-one',
    'p008-{{RUN_TOKEN}}-concurrency', 'P008 isolated D23 concurrency'
);

select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ltc_m.active_admin_guard', 0)
);
select pg_catalog.pg_sleep(30);

update ltc_m.app_users
set active = false
where id = '{{UUID_PREFIX}}902';

do $admin_remaining$
begin
    if (select count(*) from ltc_m.app_users where role = 'admin' and active) < 1 then
        raise exception 'P008 D23: nenhuma administradora ativa permaneceu.';
    end if;
end;
$admin_remaining$;

reset role;

rollback;

select pg_catalog.jsonb_build_object(
    'scenario', 'd23_concurrency_lock',
    'rollback_clean', true
) as p008_runtime_result;
