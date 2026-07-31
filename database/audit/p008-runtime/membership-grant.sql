-- P008 / D27 — concessão temporária persistente, somente após a prova.
begin;

select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ltc_m.p008.d27.membership', 0)
);

do $precondition$
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
        raise exception 'P008 D27: precondição D26 divergiu antes do grant persistente.';
    end if;
end;
$precondition$;

grant ltc_m_runtime to postgres
with admin false, inherit false, set true
granted by postgres;

do $intermediate$
begin
    if (
        select count(*)
        from pg_catalog.pg_auth_members
        where
            pg_auth_members.roleid = 'ltc_m_runtime'::regrole
            and pg_auth_members.member = 'postgres'::regrole
    ) <> 2
        or not pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
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
    then
        raise exception 'P008 D27: estado intermediário divergente.';
    end if;
end;
$intermediate$;

commit;

select pg_catalog.jsonb_build_object(
    'gate', 'd27_temporary_grant',
    'membership_count', (
        select count(*)
        from pg_catalog.pg_auth_members
        where
            pg_auth_members.roleid = 'ltc_m_runtime'::regrole
            and pg_auth_members.member = 'postgres'::regrole
    ),
    'set', pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
) as p008_runtime_result;
