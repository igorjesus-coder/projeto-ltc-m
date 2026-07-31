-- P008 / D27 — limpeza seletiva idempotente do grantor postgres.
reset role;
begin;

select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ltc_m.p008.d27.membership', 0)
);

do $identity$
begin
    if session_user <> 'postgres' or current_user <> 'postgres' then
        raise exception 'P008 D27: cleanup não está sob postgres.';
    end if;
end;
$identity$;

revoke ltc_m_runtime from postgres granted by postgres restrict;

do $restored$
begin
    if (
        select count(*)
        from pg_catalog.pg_auth_members
        where
            pg_auth_members.roleid = 'ltc_m_runtime'::regrole
            and pg_auth_members.member = 'postgres'::regrole
    ) <> 1
        or not exists (
            select 1
            from pg_catalog.pg_auth_members
            where
                pg_auth_members.roleid = 'ltc_m_runtime'::regrole
                and pg_auth_members.member = 'postgres'::regrole
                and pg_catalog.pg_get_userbyid(pg_auth_members.grantor) = 'supabase_admin'
                and pg_auth_members.admin_option
                and not pg_auth_members.inherit_option
                and not pg_auth_members.set_option
        )
        or pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
    then
        raise exception 'P008 D27: cleanup não restaurou D26 exatamente.';
    end if;
end;
$restored$;

commit;

select pg_catalog.jsonb_build_object(
    'gate', 'd27_cleanup',
    'd26_restored', true,
    'set', pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
) as p008_runtime_result;
