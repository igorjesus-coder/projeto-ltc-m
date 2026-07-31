-- P008 / D27 — prova transacional e integralmente revertida.
begin;

select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ltc_m.p008.d27.membership', 0)
);

do $before_grant$
begin
    if (
        select count(*)
        from pg_catalog.pg_auth_members
        where
            pg_auth_members.roleid = 'ltc_m_runtime'::regrole
            and pg_auth_members.member = 'postgres'::regrole
    ) <> 1 or pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET') then
        raise exception 'P008 D27: estado inicial da prova divergiu de D26.';
    end if;
end;
$before_grant$;

grant ltc_m_runtime to postgres
with admin false, inherit false, set true
granted by postgres;

do $after_grant$
begin
    if (
        select count(*)
        from pg_catalog.pg_auth_members
        where
            pg_auth_members.roleid = 'ltc_m_runtime'::regrole
            and pg_auth_members.member = 'postgres'::regrole
    ) <> 2
        or not exists (
            select 1
            from pg_catalog.pg_auth_members
            where
                pg_auth_members.roleid = 'ltc_m_runtime'::regrole
                and pg_auth_members.member = 'postgres'::regrole
                and pg_catalog.pg_get_userbyid(pg_auth_members.grantor) = 'postgres'
                and not pg_auth_members.admin_option
                and not pg_auth_members.inherit_option
                and pg_auth_members.set_option
        )
        or not pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
    then
        raise exception 'P008 D27: concessão temporária não produziu a forma exata.';
    end if;
end;
$after_grant$;

revoke ltc_m_runtime from postgres granted by postgres restrict;

do $after_revoke$
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
        raise exception 'P008 D27: revogação seletiva não restaurou D26.';
    end if;
end;
$after_revoke$;

rollback;

select pg_catalog.jsonb_build_object(
    'gate', 'd27_reversibility',
    'rollback_clean', (
        select count(*) = 1
        from pg_catalog.pg_auth_members
        where
            pg_auth_members.roleid = 'ltc_m_runtime'::regrole
            and pg_auth_members.member = 'postgres'::regrole
    ) and not pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
) as p008_runtime_result;
