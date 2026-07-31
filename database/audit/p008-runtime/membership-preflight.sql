-- P008 / D26 — preflight remoto somente leitura.
do $preflight$
declare
    v_memberships integer;
begin
    if session_user <> 'postgres' or current_user <> 'postgres' then
        raise exception 'P008 D26 divergente: executor remoto não é postgres.';
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_roles
        where
            pg_roles.rolname = 'postgres'
            and not pg_roles.rolsuper
            and pg_roles.rolinherit
            and pg_roles.rolcreaterole
            and pg_roles.rolcreatedb
            and pg_roles.rolcanlogin
            and pg_roles.rolbypassrls
    ) then
        raise exception 'P008 D26 divergente: atributos de postgres inesperados.';
    end if;

    select count(*)
    into v_memberships
    from pg_catalog.pg_auth_members
    join pg_catalog.pg_roles as granted_role
        on granted_role.oid = pg_auth_members.roleid
    join pg_catalog.pg_roles as member_role
        on member_role.oid = pg_auth_members.member
    where
        granted_role.rolname = 'ltc_m_runtime'
        or member_role.rolname = 'ltc_m_runtime';

    if v_memberships <> 1 or not exists (
        select 1
        from pg_catalog.pg_auth_members
        join pg_catalog.pg_roles as granted_role
            on granted_role.oid = pg_auth_members.roleid
        join pg_catalog.pg_roles as member_role
            on member_role.oid = pg_auth_members.member
        where
            granted_role.rolname = 'ltc_m_runtime'
            and member_role.rolname = 'postgres'
            and pg_catalog.pg_get_userbyid(pg_auth_members.grantor) = 'supabase_admin'
            and pg_auth_members.admin_option
            and not pg_auth_members.inherit_option
            and not pg_auth_members.set_option
    ) then
        raise exception 'P008 D26 divergente: associação automática não está na forma exata.';
    end if;

    if not pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'MEMBER')
        or pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'USAGE')
        or pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
    then
        raise exception 'P008 D26 divergente: MEMBER/USAGE/SET inesperado.';
    end if;
end;
$preflight$;

select pg_catalog.jsonb_build_object(
    'gate', 'd26_preflight',
    'ok', true,
    'session_user', session_user,
    'current_user', current_user,
    'member', pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'MEMBER'),
    'usage', pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'USAGE'),
    'set', pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
) as p008_runtime_result;
