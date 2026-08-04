-- D43 — bootstrap exclusivo do PostgreSQL efêmero do GitHub Actions.
-- O arquivo é executado em duas fases booleanas controladas pelo runner versionado.

\if :roles_phase
begin;

do $roles_preflight$
begin
    if current_user <> 'ci_admin' or session_user <> 'ci_admin' then
        raise exception using
            errcode = '42501',
            message = 'Bootstrap CI exige o administrador sintético ci_admin.';
    end if;
    if current_database() <> 'ltcm_ci' then
        raise exception using
            errcode = '3D000',
            message = 'Bootstrap CI exige o banco descartável ltcm_ci.';
    end if;
    if exists (
        select 1 from pg_catalog.pg_roles
        where rolname in ('postgres', 'supabase_admin', 'ltc_m_runtime')
    ) then
        raise exception using
            errcode = '42710',
            message = 'Bootstrap CI encontrou role reservada preexistente.';
    end if;
end;
$roles_preflight$;

create role postgres
    login
    password 'ltcm_ci_postgres_only'
    nosuperuser
    inherit
    createdb
    createrole
    noreplication
    bypassrls;

create role supabase_admin
    nologin
    superuser
    inherit
    createdb
    createrole
    noreplication
    bypassrls;

create role ltc_m_runtime
    nologin
    nosuperuser
    nocreatedb
    nocreaterole
    noreplication
    nobypassrls;

-- PostgreSQL 17 pode registrar ADMIN OPTION para o criador de uma role não-superuser.
-- O service inicia ci_admin como superuser, mas o revoke explícito mantém o bootstrap
-- determinístico mesmo se esse comportamento mudar entre builds da imagem oficial.
revoke ltc_m_runtime from ci_admin granted by ci_admin;

do $runtime_postcheck$
begin
    if not exists (
        select 1
        from pg_catalog.pg_roles
        where rolname = 'ltc_m_runtime'
          and not rolcanlogin
          and not rolsuper
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
end;
$runtime_postcheck$;

alter database ltcm_ci owner to postgres;

commit;
\endif

\if :d26_phase
begin;

do $d26_preflight$
begin
    if current_user <> 'ci_admin' or session_user <> 'ci_admin' then
        raise exception using
            errcode = '42501',
            message = 'Bootstrap D26 CI exige ci_admin.';
    end if;
    if not exists (
        select 1
        from pg_catalog.pg_roles
        where rolname = 'ltc_m_runtime'
          and not rolcanlogin
          and not rolsuper
          and not rolbypassrls
    ) then
        raise exception using
            errcode = '42704',
            message = 'Bootstrap D26 CI exige ltc_m_runtime validada pelas migrations.';
    end if;
end;
$d26_preflight$;

set role supabase_admin;

grant ltc_m_runtime to postgres
with admin true, inherit false, set false;

reset role;

do $d26_postcheck$
begin
    if (
        select count(*)
        from pg_catalog.pg_auth_members
        where roleid = 'ltc_m_runtime'::regrole
          and member = 'postgres'::regrole
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
    then
        raise exception using
            errcode = '55000',
            message = 'Bootstrap CI não reproduziu D26 exatamente.';
    end if;
end;
$d26_postcheck$;

commit;
\endif
