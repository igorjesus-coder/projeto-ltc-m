begin;

do $d40_preflight$
declare
    v_import_statuses text[];
begin
    if not exists (
        select 1
        from pg_catalog.pg_namespace
        where pg_namespace.nspname = 'ltc_m'
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: schema ltc_m ausente.';
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relname = 'projects'
            and pg_class.relkind = 'r'
    ) or not exists (
        select 1
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relname = 'import_batches'
            and pg_class.relkind = 'r'
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: projects ou import_batches ausente.';
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_attribute
        join pg_catalog.pg_class
            on pg_class.oid = pg_attribute.attrelid
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relname = 'projects'
            and pg_attribute.attname = 'data_reference_date'
            and pg_catalog.format_type(
                pg_attribute.atttypid,
                pg_attribute.atttypmod
            ) = 'date'
            and pg_attribute.attnotnull
            and not pg_attribute.attisdropped
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: projects.data_reference_date não é date NOT NULL.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_attribute
        join pg_catalog.pg_class
            on pg_class.oid = pg_attribute.attrelid
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relname = 'projects'
            and pg_attribute.attname = 'legacy_import_batch_id'
            and not pg_attribute.attisdropped
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: legacy_import_batch_id já existe.';
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_constraint
        join pg_catalog.pg_class
            on pg_class.oid = pg_constraint.conrelid
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relname = 'import_batches'
            and pg_constraint.contype = 'p'
            and pg_catalog.pg_get_constraintdef(pg_constraint.oid) = 'PRIMARY KEY (id)'
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: PK import_batches(id) ausente ou divergente.';
    end if;

    if not exists (
        select 1
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relname = 'projects'
            and pg_class.relrowsecurity
            and pg_class.relforcerowsecurity
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: RLS forçada de projects ausente.';
    end if;

    if (
        select count(*)
        from pg_catalog.pg_policy
        join pg_catalog.pg_class
            on pg_class.oid = pg_policy.polrelid
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relname = 'projects'
            and pg_policy.polname in (
                'projects_select',
                'projects_insert',
                'projects_update'
            )
    ) <> 3 then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: policies essenciais de projects ausentes.';
    end if;

    if (
        select count(*)
        from pg_catalog.pg_trigger
        join pg_catalog.pg_class
            on pg_class.oid = pg_trigger.tgrelid
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relname = 'projects'
            and not pg_trigger.tgisinternal
            and pg_trigger.tgenabled <> 'D'
            and pg_trigger.tgname in (
                'trg_00_projects_no_delete',
                'trg_05_projects_inactivation',
                'trg_10_projects_metadata',
                'trg_90_projects_audit'
            )
    ) <> 4 then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: triggers essenciais de projects ausentes.';
    end if;

    if (
        select count(*)
        from pg_catalog.pg_trigger
        join pg_catalog.pg_class
            on pg_class.oid = pg_trigger.tgrelid
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relname = 'import_batches'
            and not pg_trigger.tgisinternal
            and pg_trigger.tgenabled <> 'D'
            and pg_trigger.tgname in (
                'trg_00_import_batches_no_delete',
                'trg_10_import_batches_metadata',
                'trg_90_import_batches_audit'
            )
    ) <> 3 then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: triggers essenciais de import_batches ausentes.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_constraint
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_constraint.connamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_constraint.conname in (
                'fk_projects_legacy_import_batch',
                'ck_projects_data_reference_date_legacy'
            )
    ) or exists (
        select 1
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_class.relname = 'ix_projects_legacy_import_batch'
    ) or exists (
        select 1
        from pg_catalog.pg_proc
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_proc.pronamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and pg_proc.proname in (
                'enforce_project_legacy_reference_date',
                'enforce_import_batch_rejection_guard'
            )
    ) or exists (
        select 1
        from pg_catalog.pg_trigger
        join pg_catalog.pg_class
            on pg_class.oid = pg_trigger.tgrelid
        join pg_catalog.pg_namespace
            on pg_namespace.oid = pg_class.relnamespace
        where
            pg_namespace.nspname = 'ltc_m'
            and (
                (
                    pg_class.relname = 'projects'
                    and pg_trigger.tgname = 'trg_07_projects_legacy_reference_guard'
                )
                or (
                    pg_class.relname = 'import_batches'
                    and pg_trigger.tgname = 'trg_07_import_batches_rejection_guard'
                )
            )
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: objeto final D40 já existe.';
    end if;

    select pg_catalog.array_agg(
        pg_enum.enumlabel::text
        order by pg_enum.enumsortorder
    )
    into v_import_statuses
    from pg_catalog.pg_enum
    join pg_catalog.pg_type
        on pg_type.oid = pg_enum.enumtypid
    join pg_catalog.pg_namespace
        on pg_namespace.oid = pg_type.typnamespace
    where
        pg_namespace.nspname = 'ltc_m'
        and pg_type.typname = 'import_status';

    if v_import_statuses is distinct from
        array['received', 'validating', 'rejected', 'loaded']::text[]
    then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: lifecycle de import_batches divergente.';
    end if;

    if exists (
        select 1
        from ltc_m.projects
        where projects.data_reference_date is null
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'D40 preflight falhou: data_reference_date nula antes da exceção.';
    end if;
end;
$d40_preflight$;

alter table ltc_m.projects
    add column legacy_import_batch_id uuid;

comment on column ltc_m.projects.legacy_import_batch_id is
    'Lote P009 que autoriza e preserva a linhagem da exceção legada de data de referência.';

alter table ltc_m.projects
    add constraint fk_projects_legacy_import_batch
        foreign key (legacy_import_batch_id)
        references ltc_m.import_batches (id)
        on update no action
        on delete no action,
    add constraint ck_projects_data_reference_date_legacy
        check (
            data_reference_date is not null
            or legacy_import_batch_id is not null
        ) not valid;

alter table ltc_m.projects
    validate constraint ck_projects_data_reference_date_legacy;

create function ltc_m.enforce_project_legacy_reference_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_actor_id uuid;
    v_actor_role ltc_m.app_role;
    v_batch_status ltc_m.import_status;
    v_request_id text;
    v_requires_admin boolean;
begin
    if new.data_reference_date is null
        and new.legacy_import_batch_id is null
    then
        raise exception using
            errcode = '23514',
            message = 'Projeto sem data de referência exige lote legado.';
    end if;

    if tg_op = 'UPDATE'
        and old.legacy_import_batch_id is not null
        and new.legacy_import_batch_id is null
    then
        raise exception using
            errcode = '23514',
            message = 'Linhagem legada não pode ser removida.';
    end if;

    v_requires_admin := case
        when tg_op = 'INSERT' then
            new.data_reference_date is null
            or new.legacy_import_batch_id is not null
        else
            new.data_reference_date is null
            or new.legacy_import_batch_id is distinct from
                old.legacy_import_batch_id
            or (
                old.data_reference_date is null
                and new.data_reference_date is not null
            )
    end;

    if not v_requires_admin then
        return new;
    end if;

    select
        authorization_context.app_user_id,
        authorization_context.app_role
    into v_actor_id, v_actor_role
    from ltc_m.authorization_context();

    if v_actor_id is null or v_actor_role <> 'admin' then
        raise exception using
            errcode = '42501',
            message = 'Exceção legada de data de referência exige Admin ativo.';
    end if;

    perform ltc_m.current_justification(true);

    v_request_id := nullif(
        btrim(pg_catalog.current_setting('ltc_m.request_id', true)),
        ''
    );
    if v_request_id is null then
        raise exception using
            errcode = 'P0001',
            message = 'Exceção legada de data de referência exige request ID.';
    end if;

    if new.legacy_import_batch_id is not null then
        select import_batches.status
        into v_batch_status
        from ltc_m.import_batches
        where import_batches.id = new.legacy_import_batch_id
        for share;

        if found and v_batch_status not in ('received', 'validating', 'loaded') then
            raise exception using
                errcode = '23514',
                message = 'Lote rejeitado não autoriza exceção legada.';
        end if;
    end if;

    return new;
end;
$function$;

comment on function ltc_m.enforce_project_legacy_reference_date() is
    'Guarda D40 SECURITY DEFINER: reusa o contexto P007/P008 para exigir Admin, justificativa e request ID, valida lifecycle do lote e não concede bypass ao runtime.';

revoke execute on function ltc_m.enforce_project_legacy_reference_date()
from public;

create trigger trg_07_projects_legacy_reference_guard
before insert or update on ltc_m.projects
for each row execute function ltc_m.enforce_project_legacy_reference_date();

create function ltc_m.enforce_import_batch_rejection_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
    if old.status is not distinct from new.status then
        return new;
    end if;

    if new.status <> 'rejected' then
        return new;
    end if;

    if exists (
        select 1
        from ltc_m.projects as project
        where project.legacy_import_batch_id = new.id
    ) then
        raise exception using
            errcode = '23514',
            message = 'Lote vinculado a projeto legado nÃ£o pode ser rejeitado.';
    end if;

    return new;
end;
$function$;

comment on function ltc_m.enforce_import_batch_rejection_guard() is
    'Guarda D41 SECURITY DEFINER somente-leitura: enxerga toda referÃªncia histÃ³rica apesar da RLS, bloqueia rejected sem expor dados e nÃ£o altera projetos.';

revoke execute on function ltc_m.enforce_import_batch_rejection_guard()
from public;

create trigger trg_07_import_batches_rejection_guard
before update on ltc_m.import_batches
for each row execute function ltc_m.enforce_import_batch_rejection_guard();

create index ix_projects_legacy_import_batch
    on ltc_m.projects (legacy_import_batch_id)
    where legacy_import_batch_id is not null;

alter table ltc_m.projects
    alter column data_reference_date drop not null;

commit;
