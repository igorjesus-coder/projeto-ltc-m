begin;

create role ltc_m_provenance_writer
    nologin
    noinherit
    nosuperuser
    nocreatedb
    nocreaterole
    noreplication
    nobypassrls;

create table ltc_m.p034_provenance_snapshots (
    id uuid not null default gen_random_uuid(),
    import_batch_id uuid not null,
    project_id uuid not null,
    scope_type text not null default 'project',
    schema_version smallint not null default 1,
    source_artifact_hash text not null,
    snapshot_fingerprint text not null,
    fingerprint_algorithm text not null default 'sha256-canonical-v1',
    source_observation_contract text not null default 'ltcm.p015.reconciliation.v1',
    status text not null default 'success',
    authority_revision bigint not null,
    captured_by_user_id uuid not null,
    request_id text,
    capture_source text not null default 'api',
    captured_at timestamptz not null default now(),
    completed_at timestamptz not null,
    constraint pk_p034_provenance_snapshots primary key (id),
    constraint uq_p034_snapshot_batch_project unique (import_batch_id, project_id),
    constraint uq_p034_snapshot_project_revision unique (project_id, authority_revision),
    constraint uq_p034_snapshot_fingerprint unique (snapshot_fingerprint),
    constraint uq_p034_snapshot_id_project unique (id, project_id),
    constraint fk_p034_snapshot_batch foreign key (import_batch_id)
        references ltc_m.import_batches(id) on delete restrict,
    constraint fk_p034_snapshot_project foreign key (project_id)
        references ltc_m.projects(id) on delete restrict,
    constraint fk_p034_snapshot_actor foreign key (captured_by_user_id)
        references ltc_m.app_users(id) on delete restrict,
    constraint ck_p034_snapshot_scope check (scope_type = 'project'),
    constraint ck_p034_snapshot_schema check (schema_version = 1),
    constraint ck_p034_snapshot_artifact_hash check (
        lower(source_artifact_hash) = source_artifact_hash
        and source_artifact_hash ~ '^[0-9a-f]{64}$'
    ),
    constraint ck_p034_snapshot_fingerprint check (
        lower(snapshot_fingerprint) = snapshot_fingerprint
        and snapshot_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    constraint ck_p034_snapshot_algorithm check (fingerprint_algorithm = 'sha256-canonical-v1'),
    constraint ck_p034_snapshot_contract check (source_observation_contract = 'ltcm.p015.reconciliation.v1'),
    constraint ck_p034_snapshot_status check (status = 'success'),
    constraint ck_p034_snapshot_revision check (authority_revision > 0),
    constraint ck_p034_snapshot_request check (
        request_id is null
        or (btrim(request_id) <> '' and char_length(request_id) <= 200)
    ),
    constraint ck_p034_snapshot_source check (capture_source = 'api'),
    constraint ck_p034_snapshot_completed check (completed_at >= captured_at)
);

create index ix_p034_snapshot_project_latest
    on ltc_m.p034_provenance_snapshots (project_id, authority_revision desc);
create index ix_p034_snapshot_batch_project
    on ltc_m.p034_provenance_snapshots (import_batch_id, project_id);

create table ltc_m.p034_provenance_project_observations (
    id uuid not null default gen_random_uuid(),
    snapshot_id uuid not null,
    project_id uuid not null,
    project_code text not null,
    occurrence_ordinal integer not null,
    occurrence_fingerprint text not null,
    constraint pk_p034_project_observations primary key (id),
    constraint uq_p034_project_observation_id_project unique (id, project_id),
    constraint uq_p034_project_observation_ordinal unique (snapshot_id, occurrence_ordinal),
    constraint fk_p034_project_observation_snapshot foreign key (snapshot_id, project_id)
        references ltc_m.p034_provenance_snapshots(id, project_id) on delete restrict,
    constraint fk_p034_project_observation_project foreign key (project_id)
        references ltc_m.projects(id) on delete restrict,
    constraint ck_p034_project_observation_code check (
        project_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,63}$'
    ),
    constraint ck_p034_project_observation_ordinal check (occurrence_ordinal > 0),
    constraint ck_p034_project_observation_fingerprint check (
        lower(occurrence_fingerprint) = occurrence_fingerprint
        and occurrence_fingerprint ~ '^[0-9a-f]{64}$'
    )
);

create index ix_p034_project_observation_identity
    on ltc_m.p034_provenance_project_observations (snapshot_id, project_code, occurrence_ordinal);

create table ltc_m.p034_provenance_item_observations (
    id uuid not null default gen_random_uuid(),
    snapshot_id uuid not null,
    project_id uuid not null,
    project_code text not null,
    source_line_key text not null,
    item_id text,
    occurrence_ordinal integer not null,
    occurrence_fingerprint text not null,
    constraint pk_p034_item_observations primary key (id),
    constraint uq_p034_item_observation_id_project unique (id, project_id),
    constraint uq_p034_item_observation_ordinal unique (snapshot_id, occurrence_ordinal),
    constraint fk_p034_item_observation_snapshot foreign key (snapshot_id, project_id)
        references ltc_m.p034_provenance_snapshots(id, project_id) on delete restrict,
    constraint fk_p034_item_observation_project foreign key (project_id)
        references ltc_m.projects(id) on delete restrict,
    constraint ck_p034_item_observation_code check (
        project_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,63}$'
    ),
    constraint ck_p034_item_observation_line check (
        source_line_key ~ '^p012-line-v1:[0-9a-f]{64}$'
    ),
    constraint ck_p034_item_observation_id check (
        item_id is null
        or (btrim(item_id) <> '' and item_id = btrim(item_id))
    ),
    constraint ck_p034_item_observation_ordinal check (occurrence_ordinal > 0),
    constraint ck_p034_item_observation_fingerprint check (
        lower(occurrence_fingerprint) = occurrence_fingerprint
        and occurrence_fingerprint ~ '^[0-9a-f]{64}$'
    )
);

create index ix_p034_item_observation_identity
    on ltc_m.p034_provenance_item_observations (
        snapshot_id,
        project_code,
        source_line_key,
        occurrence_ordinal
    );
create index ix_p034_item_observation_project_identity
    on ltc_m.p034_provenance_item_observations (project_id, project_code, source_line_key);

create table ltc_m.p034_provenance_source_references (
    id uuid not null default gen_random_uuid(),
    project_id uuid not null,
    project_observation_id uuid,
    item_observation_id uuid,
    reference_ordinal integer not null,
    kind text not null,
    locator text not null,
    fingerprint text not null,
    constraint pk_p034_source_references primary key (id),
    constraint fk_p034_source_reference_project foreign key (project_id)
        references ltc_m.projects(id) on delete restrict,
    constraint fk_p034_source_reference_project_observation foreign key (project_observation_id, project_id)
        references ltc_m.p034_provenance_project_observations(id, project_id) on delete restrict,
    constraint fk_p034_source_reference_item_observation foreign key (item_observation_id, project_id)
        references ltc_m.p034_provenance_item_observations(id, project_id) on delete restrict,
    constraint ck_p034_source_reference_one_parent check (
        (project_observation_id is not null)::integer
        + (item_observation_id is not null)::integer = 1
    ),
    constraint ck_p034_source_reference_kind check (kind in ('source', 'database')),
    constraint ck_p034_source_reference_locator check (
        btrim(locator) <> ''
        and char_length(locator) <= 1024
        and locator !~* E'(?:[A-Z]:\\\\|(?:^|\\s)/(?:home|Users)/|postgres(?:ql)?://|https?://|(^|[^a-z0-9_])(?:password|token|private_key|client_secret)[[:space:]]*=)'
    ),
    constraint ck_p034_source_reference_fingerprint check (
        lower(fingerprint) = fingerprint
        and fingerprint ~ '^[0-9a-f]{64}$'
    ),
    constraint ck_p034_source_reference_ordinal check (reference_ordinal > 0)
);

create unique index uq_p034_source_reference_project_ordinal
    on ltc_m.p034_provenance_source_references (project_observation_id, reference_ordinal)
    where project_observation_id is not null;
create unique index uq_p034_source_reference_item_ordinal
    on ltc_m.p034_provenance_source_references (item_observation_id, reference_ordinal)
    where item_observation_id is not null;
create index ix_p034_source_reference_project
    on ltc_m.p034_provenance_source_references (project_id, project_observation_id, reference_ordinal);
create index ix_p034_source_reference_item
    on ltc_m.p034_provenance_source_references (project_id, item_observation_id, reference_ordinal);

alter table ltc_m.p034_provenance_snapshots enable row level security;
alter table ltc_m.p034_provenance_snapshots force row level security;
alter table ltc_m.p034_provenance_project_observations enable row level security;
alter table ltc_m.p034_provenance_project_observations force row level security;
alter table ltc_m.p034_provenance_item_observations enable row level security;
alter table ltc_m.p034_provenance_item_observations force row level security;
alter table ltc_m.p034_provenance_source_references enable row level security;
alter table ltc_m.p034_provenance_source_references force row level security;

create function ltc_m.p034_provenance_reject_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
    raise exception 'P034 provenance facts are immutable' using errcode = '55000';
    return null;
end;
$function$;

create function ltc_m.p034_provenance_reject_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
    raise exception 'P034 provenance facts cannot be deleted' using errcode = '55000';
    return null;
end;
$function$;

create function ltc_m.p034_provenance_source_hash_matches_batch()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
    if not exists (
        select 1
        from ltc_m.import_batches as b
        where b.id = new.import_batch_id
          and b.source_hash = new.source_artifact_hash
    ) then
        raise exception 'P034 source artifact hash does not match import batch' using errcode = '23514';
    end if;
    return new;
end;
$function$;

create function ltc_m.p034_provenance_context_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
    if new.captured_by_user_id is distinct from ltc_m.current_actor_id(true)
       or new.request_id is distinct from nullif(current_setting('ltc_m.request_id', true), '')
       or new.capture_source is distinct from current_setting('ltc_m.source', true)
       or new.capture_source <> 'api' then
        raise exception 'P034 provenance actor context mismatch' using errcode = '42501';
    end if;
    return new;
end;
$function$;

create function ltc_m.p034_project_observation_reference_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
    if not exists (
        select 1
        from ltc_m.p034_provenance_source_references as r
        where r.project_observation_id = new.id
          and r.project_id = new.project_id
    ) then
        raise exception 'P034 project observation requires source reference' using errcode = '23514';
    end if;
    return null;
end;
$function$;

create function ltc_m.p034_item_observation_reference_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
    if not exists (
        select 1
        from ltc_m.p034_provenance_source_references as r
        where r.item_observation_id = new.id
          and r.project_id = new.project_id
    ) then
        raise exception 'P034 item observation requires source reference' using errcode = '23514';
    end if;
    return null;
end;
$function$;

create trigger trg_p034_snapshot_hash
    before insert on ltc_m.p034_provenance_snapshots
    for each row execute function ltc_m.p034_provenance_source_hash_matches_batch();
create trigger trg_p034_snapshot_context
    before insert on ltc_m.p034_provenance_snapshots
    for each row execute function ltc_m.p034_provenance_context_guard();

create constraint trigger trg_p034_project_reference_cardinality
    after insert on ltc_m.p034_provenance_project_observations
    deferrable initially deferred for each row
    execute function ltc_m.p034_project_observation_reference_guard();
create constraint trigger trg_p034_item_reference_cardinality
    after insert on ltc_m.p034_provenance_item_observations
    deferrable initially deferred for each row
    execute function ltc_m.p034_item_observation_reference_guard();

create trigger trg_p034_snapshot_no_update
    before update on ltc_m.p034_provenance_snapshots
    for each row execute function ltc_m.p034_provenance_reject_update();
create trigger trg_p034_snapshot_no_delete
    before delete on ltc_m.p034_provenance_snapshots
    for each row execute function ltc_m.p034_provenance_reject_delete();
create trigger trg_p034_project_no_update
    before update on ltc_m.p034_provenance_project_observations
    for each row execute function ltc_m.p034_provenance_reject_update();
create trigger trg_p034_project_no_delete
    before delete on ltc_m.p034_provenance_project_observations
    for each row execute function ltc_m.p034_provenance_reject_delete();
create trigger trg_p034_item_no_update
    before update on ltc_m.p034_provenance_item_observations
    for each row execute function ltc_m.p034_provenance_reject_update();
create trigger trg_p034_item_no_delete
    before delete on ltc_m.p034_provenance_item_observations
    for each row execute function ltc_m.p034_provenance_reject_delete();
create trigger trg_p034_reference_no_update
    before update on ltc_m.p034_provenance_source_references
    for each row execute function ltc_m.p034_provenance_reject_update();
create trigger trg_p034_reference_no_delete
    before delete on ltc_m.p034_provenance_source_references
    for each row execute function ltc_m.p034_provenance_reject_delete();

create policy p034_snapshots_runtime_select
    on ltc_m.p034_provenance_snapshots
    for select to ltc_m_runtime
    using (
        exists (
            select 1
            from ltc_m.authorization_context() as ac
            where ac.app_role = 'admin'
               or (
                    ltc_m.p034_provenance_snapshots.status = 'success'
                    and exists (
                        select 1
                        from ltc_m.projects as p
                        join ltc_m.clients as c on c.id = p.client_id
                        where p.id = ltc_m.p034_provenance_snapshots.project_id
                          and p.status = 'active'
                          and p.deleted_at is null
                    )
               )
        )
    );
create policy p034_snapshots_writer_select
    on ltc_m.p034_provenance_snapshots
    for select to ltc_m_provenance_writer
    using (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role in ('editor', 'admin')
        )
        and exists (
            select 1
            from ltc_m.projects as p
            where p.id = ltc_m.p034_provenance_snapshots.project_id
              and (
                    exists (
                        select 1 from ltc_m.authorization_context() as ac
                        where ac.app_role = 'admin'
                    )
                    or (p.status = 'active' and p.deleted_at is null)
              )
        )
    );
create policy p034_snapshots_writer_insert
    on ltc_m.p034_provenance_snapshots
    for insert to ltc_m_provenance_writer
    with check (
        captured_by_user_id = ltc_m.current_actor_id(true)
        and capture_source = current_setting('ltc_m.source', true)
        and capture_source = 'api'
        and request_id is not distinct from nullif(current_setting('ltc_m.request_id', true), '')
        and exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role in ('editor', 'admin')
        )
        and exists (
            select 1
            from ltc_m.projects as p
            where p.id = ltc_m.p034_provenance_snapshots.project_id
              and (
                    exists (
                        select 1 from ltc_m.authorization_context() as ac
                        where ac.app_role = 'admin'
                    )
                    or (p.status = 'active' and p.deleted_at is null)
              )
        )
    );

create policy p034_project_observations_runtime_select
    on ltc_m.p034_provenance_project_observations
    for select to ltc_m_runtime
    using (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role = 'admin'
               or exists (
                    select 1
                    from ltc_m.projects as p
                    join ltc_m.clients as c on c.id = p.client_id
                    where p.id = ltc_m.p034_provenance_project_observations.project_id
                      and p.status = 'active'
                      and p.deleted_at is null
               )
        )
    );
create policy p034_item_observations_runtime_select
    on ltc_m.p034_provenance_item_observations
    for select to ltc_m_runtime
    using (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role = 'admin'
               or exists (
                    select 1
                    from ltc_m.projects as p
                    join ltc_m.clients as c on c.id = p.client_id
                    where p.id = ltc_m.p034_provenance_item_observations.project_id
                      and p.status = 'active'
                      and p.deleted_at is null
               )
        )
    );
create policy p034_source_references_runtime_select
    on ltc_m.p034_provenance_source_references
    for select to ltc_m_runtime
    using (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role = 'admin'
               or exists (
                    select 1
                    from ltc_m.projects as p
                    join ltc_m.clients as c on c.id = p.client_id
                    where p.id = ltc_m.p034_provenance_source_references.project_id
                      and p.status = 'active'
                      and p.deleted_at is null
               )
        )
    );

create policy p034_project_observations_writer_select
    on ltc_m.p034_provenance_project_observations
    for select to ltc_m_provenance_writer
    using (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role in ('editor', 'admin')
        )
        and exists (
            select 1
            from ltc_m.projects as p
            where p.id = ltc_m.p034_provenance_project_observations.project_id
              and (
                    exists (
                        select 1 from ltc_m.authorization_context() as ac
                        where ac.app_role = 'admin'
                    )
                    or (p.status = 'active' and p.deleted_at is null)
              )
        )
    );
create policy p034_item_observations_writer_select
    on ltc_m.p034_provenance_item_observations
    for select to ltc_m_provenance_writer
    using (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role in ('editor', 'admin')
        )
        and exists (
            select 1
            from ltc_m.projects as p
            where p.id = ltc_m.p034_provenance_item_observations.project_id
              and (
                    exists (
                        select 1 from ltc_m.authorization_context() as ac
                        where ac.app_role = 'admin'
                    )
                    or (p.status = 'active' and p.deleted_at is null)
              )
        )
    );
create policy p034_source_references_writer_select
    on ltc_m.p034_provenance_source_references
    for select to ltc_m_provenance_writer
    using (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role in ('editor', 'admin')
        )
        and exists (
            select 1
            from ltc_m.projects as p
            where p.id = ltc_m.p034_provenance_source_references.project_id
              and (
                    exists (
                        select 1 from ltc_m.authorization_context() as ac
                        where ac.app_role = 'admin'
                    )
                    or (p.status = 'active' and p.deleted_at is null)
              )
        )
    );

create policy p034_project_observations_writer_insert
    on ltc_m.p034_provenance_project_observations
    for insert to ltc_m_provenance_writer
    with check (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role in ('editor', 'admin')
        )
        and exists (
            select 1
            from ltc_m.p034_provenance_snapshots as s
            where s.id = ltc_m.p034_provenance_project_observations.snapshot_id
              and s.project_id = ltc_m.p034_provenance_project_observations.project_id
        )
        and exists (
            select 1
            from ltc_m.projects as p
            where p.id = ltc_m.p034_provenance_project_observations.project_id
              and (
                    exists (
                        select 1 from ltc_m.authorization_context() as ac
                        where ac.app_role = 'admin'
                    )
                    or (p.status = 'active' and p.deleted_at is null)
              )
        )
    );
create policy p034_item_observations_writer_insert
    on ltc_m.p034_provenance_item_observations
    for insert to ltc_m_provenance_writer
    with check (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role in ('editor', 'admin')
        )
        and exists (
            select 1
            from ltc_m.p034_provenance_snapshots as s
            where s.id = ltc_m.p034_provenance_item_observations.snapshot_id
              and s.project_id = ltc_m.p034_provenance_item_observations.project_id
        )
        and exists (
            select 1
            from ltc_m.projects as p
            where p.id = ltc_m.p034_provenance_item_observations.project_id
              and (
                    exists (
                        select 1 from ltc_m.authorization_context() as ac
                        where ac.app_role = 'admin'
                    )
                    or (p.status = 'active' and p.deleted_at is null)
              )
        )
    );
create policy p034_source_references_writer_insert
    on ltc_m.p034_provenance_source_references
    for insert to ltc_m_provenance_writer
    with check (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role in ('editor', 'admin')
        )
        and exists (
            select 1
            from ltc_m.projects as p
            where p.id = ltc_m.p034_provenance_source_references.project_id
              and (
                    exists (
                        select 1 from ltc_m.authorization_context() as ac
                        where ac.app_role = 'admin'
                    )
                    or (p.status = 'active' and p.deleted_at is null)
              )
        )
    );

create policy p034_writer_projects_select
    on ltc_m.projects
    for select to ltc_m_provenance_writer
    using (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role = 'admin'
               or (
                    projects.status = 'active'
                    and projects.deleted_at is null
               )
        )
    );
create policy p034_writer_batches_select
    on ltc_m.import_batches
    for select to ltc_m_provenance_writer
    using (
        exists (
            select 1 from ltc_m.authorization_context() as ac
            where ac.app_role in ('editor', 'admin')
        )
    );

revoke all privileges on ltc_m.p034_provenance_snapshots from public;
revoke all privileges on ltc_m.p034_provenance_project_observations from public;
revoke all privileges on ltc_m.p034_provenance_item_observations from public;
revoke all privileges on ltc_m.p034_provenance_source_references from public;
revoke all privileges on function ltc_m.p034_provenance_reject_update() from public;
revoke all privileges on function ltc_m.p034_provenance_reject_delete() from public;
revoke all privileges on function ltc_m.p034_provenance_source_hash_matches_batch() from public;
revoke all privileges on function ltc_m.p034_provenance_context_guard() from public;
revoke all privileges on function ltc_m.p034_project_observation_reference_guard() from public;
revoke all privileges on function ltc_m.p034_item_observation_reference_guard() from public;
grant usage on schema ltc_m to ltc_m_runtime, ltc_m_provenance_writer;
grant select on
    ltc_m.p034_provenance_snapshots,
    ltc_m.p034_provenance_project_observations,
    ltc_m.p034_provenance_item_observations,
    ltc_m.p034_provenance_source_references
    to ltc_m_runtime;
grant select, insert on
    ltc_m.p034_provenance_snapshots,
    ltc_m.p034_provenance_project_observations,
    ltc_m.p034_provenance_item_observations,
    ltc_m.p034_provenance_source_references
    to ltc_m_provenance_writer;
grant select on ltc_m.projects, ltc_m.import_batches to ltc_m_provenance_writer;
grant execute on function ltc_m.set_actor_context(uuid, text, text, text, text, boolean)
    to ltc_m_provenance_writer;
grant execute on function ltc_m.authorization_context()
    to ltc_m_provenance_writer;
grant execute on function ltc_m.current_actor_id(boolean)
    to ltc_m_provenance_writer;

commit;
