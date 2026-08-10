-- D43 — bootstrap exclusivo do PostgreSQL efêmero do GitHub Actions.
-- O arquivo é executado em três fases booleanas controladas pelo runner versionado.

\if :roles_phase
begin;

do $roles_preflight$
begin
    if current_user <> 'supabase_admin' or session_user <> 'supabase_admin' then
        raise exception using
            errcode = '42501',
            message = 'Bootstrap CI exige supabase_admin como bootstrap superuser real.';
    end if;
    if current_database() <> 'ltcm_ci' then
        raise exception using
            errcode = '3D000',
            message = 'Bootstrap CI exige o banco descartável ltcm_ci.';
    end if;
    if exists (
        select 1 from pg_catalog.pg_roles
        where rolname in ('postgres', 'ci_admin', 'ltc_m_runtime')
    ) then
        raise exception using
            errcode = '42710',
            message = 'Bootstrap CI encontrou role reservada preexistente.';
    end if;
end;
$roles_preflight$;

-- D51 mantém esta fase one-shot: qualquer role operacional preexistente produz 42710
-- antes de mutação. supabase_admin já existe porque foi criado pelo initdb como OID 10.
do $bootstrap_superuser_preflight$
begin
    if not exists (
        select 1
        from pg_catalog.pg_roles
        where rolname = 'supabase_admin'
          and oid = 10
          and rolsuper
          and rolinherit
          and rolcreaterole
          and rolcreatedb
          and rolcanlogin
          and rolbypassrls
    ) then
        raise exception using
            errcode = '55000',
            message = 'Bootstrap CI não reconheceu supabase_admin como bootstrap superuser.';
    end if;
end;
$bootstrap_superuser_preflight$;

create role postgres
    login
    password 'ltcm_ci_postgres_only'
    nosuperuser
    inherit
    createdb
    createrole
    noreplication
    bypassrls;

create role ci_admin
    login
    password 'ltcm_ci_admin_only'
    nosuperuser
    noinherit
    nocreatedb
    nocreaterole
    noreplication
    nobypassrls;

create role ltc_m_runtime
    nologin
    nosuperuser
    inherit
    nocreatedb
    nocreaterole
    noreplication
    nobypassrls;

do $runtime_postcheck$
begin
    if not exists (
        select 1
        from pg_catalog.pg_roles
        where rolname = 'ltc_m_runtime'
          and not rolcanlogin
          and not rolsuper
          and rolinherit
          and not rolcreatedb
          and not rolcreaterole
          and not rolreplication
          and not rolbypassrls
    ) or exists (
        select 1
        from pg_catalog.pg_auth_members
        where roleid = 'ltc_m_runtime'::regrole
           or member = 'ltc_m_runtime'::regrole
    ) then
        raise exception using
            errcode = '55000',
            message = 'Bootstrap CI não isolou ltc_m_runtime antes das migrations.';
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_roles
        where rolname = 'ci_admin'
          and rolcanlogin
          and not rolsuper
          and not rolinherit
          and not rolcreatedb
          and not rolcreaterole
          and not rolreplication
          and not rolbypassrls
    ) or exists (
        select 1
        from pg_catalog.pg_auth_members
        where member = 'ci_admin'::regrole
           or roleid = 'ci_admin'::regrole
    ) then
        raise exception using
            errcode = '55000',
            message = 'Bootstrap CI não isolou o operador sintético ci_admin.';
    end if;
end;
$runtime_postcheck$;

alter database ltcm_ci owner to postgres;

commit;
\endif

\if :ci_admin_phase
begin;

do $ci_admin_postcheck$
begin
    if current_user <> 'ci_admin' or session_user <> 'ci_admin' then
        raise exception using
            errcode = '42501',
            message = 'Bootstrap CI exige conexão própria do operador sintético ci_admin.';
    end if;
    if current_database() <> 'ltcm_ci' then
        raise exception using
            errcode = '3D000',
            message = 'Bootstrap CI exige o banco descartável ltcm_ci.';
    end if;
    if exists (
        select 1
        from pg_catalog.pg_auth_members
        where roleid = 'ltc_m_runtime'::regrole
           or member = 'ltc_m_runtime'::regrole
    )
        or pg_catalog.pg_has_role('ci_admin', 'ltc_m_runtime', 'MEMBER')
        or pg_catalog.pg_has_role('ci_admin', 'ltc_m_runtime', 'USAGE')
        or pg_catalog.pg_has_role('ci_admin', 'ltc_m_runtime', 'SET')
    then
        raise exception using
            errcode = '55000',
            message = 'Bootstrap CI encontrou capacidade antecipada de ci_admin sobre ltc_m_runtime.';
    end if;
end;
$ci_admin_postcheck$;

commit;
\endif

\if :d26_phase
begin;

do $d26_preflight$
begin
    if current_user <> 'supabase_admin' or session_user <> 'supabase_admin' then
        raise exception using
            errcode = '42501',
            message = 'Bootstrap D26 CI exige conexão direta do bootstrap superuser supabase_admin.';
    end if;
    if not exists (
        select 1
        from pg_catalog.pg_roles
        where rolname = 'ltc_m_runtime'
          and not rolcanlogin
          and not rolsuper
          and rolinherit
          and not rolcreatedb
          and not rolcreaterole
          and not rolreplication
          and not rolbypassrls
    ) then
        raise exception using
            errcode = '42704',
            message = 'Bootstrap D26 CI exige ltc_m_runtime validada pelas migrations.';
    end if;
    if exists (
        select 1
        from pg_catalog.pg_auth_members
        where roleid = 'ltc_m_runtime'::regrole
           or member = 'ltc_m_runtime'::regrole
    ) then
        raise exception using
            errcode = '55000',
            message = 'Bootstrap D26 CI encontrou membership antecipada em ltc_m_runtime.';
    end if;
end;
$d26_preflight$;

grant ltc_m_runtime to postgres
with admin true, inherit false, set false;

alter role supabase_admin nologin noreplication;

do $d26_postcheck$
begin
    if (
        select count(*)
        from pg_catalog.pg_auth_members
        where roleid = 'ltc_m_runtime'::regrole
           or member = 'ltc_m_runtime'::regrole
    ) <> 1
        or not exists (
            select 1
            from pg_catalog.pg_auth_members
            where roleid = 'ltc_m_runtime'::regrole
              and member = 'postgres'::regrole
              and pg_catalog.pg_get_userbyid(grantor) = 'supabase_admin'
              and admin_option
              and not inherit_option
              and not set_option
        )
        or not pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'MEMBER')
        or pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'USAGE')
        or pg_catalog.pg_has_role('postgres', 'ltc_m_runtime', 'SET')
        or pg_catalog.pg_has_role('ci_admin', 'ltc_m_runtime', 'MEMBER')
        or pg_catalog.pg_has_role('ci_admin', 'ltc_m_runtime', 'USAGE')
        or pg_catalog.pg_has_role('ci_admin', 'ltc_m_runtime', 'SET')
        or not exists (
            select 1
            from pg_catalog.pg_roles
            where rolname = 'supabase_admin'
              and oid = 10
              and rolsuper
              and rolinherit
              and rolcreaterole
              and rolcreatedb
              and not rolcanlogin
              and not rolreplication
              and rolbypassrls
        )
    then
        raise exception using
            errcode = '55000',
            message = 'Bootstrap CI não reproduziu D26 exatamente.';
    end if;
end;
$d26_postcheck$;

commit;
\endif
