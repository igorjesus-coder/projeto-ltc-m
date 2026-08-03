begin;

alter table ltc_m.import_batches
    add column source_size_bytes bigint,
    add column source_mime_type text,
    add column payload_schema_version integer not null default 1,
    add column idempotency_key text,
    add column request_id text,
    add column started_at timestamptz,
    add column sheet_count integer not null default 0,
    add column staged_rows integer not null default 0,
    add column valid_rows integer not null default 0,
    add column error_count integer not null default 0,
    add column technical_message text,
    add column metadata jsonb not null default '{}'::jsonb,
    add column updated_by_user_id uuid references ltc_m.app_users (id),
    drop constraint ck_import_batches_source_hash;

alter table ltc_m.import_batches
    add constraint ck_import_batches_source_name_p009
        check (
            btrim(source_name) = source_name
            and source_name <> ''
            and source_name !~ '[\\/]'
        ),
    add constraint ck_import_batches_source_hash_p009
        check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
    add constraint ck_import_batches_source_size_p009
        check (source_size_bytes is null or source_size_bytes >= 0),
    add constraint ck_import_batches_payload_schema_p009
        check (payload_schema_version = 1),
    add constraint ck_import_batches_idempotency_key_p009
        check (
            idempotency_key is null
            or (
                idempotency_key = btrim(idempotency_key)
                and idempotency_key <> ''
                and length(idempotency_key) <= 255
            )
        ),
    add constraint ck_import_batches_request_id_p009
        check (request_id is null or (request_id = btrim(request_id) and request_id <> '')),
    add constraint ck_import_batches_started_at_p009
        check (started_at is null or started_at >= created_at),
    add constraint ck_import_batches_extended_counts_p009
        check (
            sheet_count >= 0
            and staged_rows >= 0
            and valid_rows >= 0
            and error_count >= 0
        ),
    add constraint ck_import_batches_metadata_p009
        check (jsonb_typeof(metadata) = 'object');

drop index ltc_m.uq_import_batches_hash;

create index ix_import_batches_source_hash_p009
    on ltc_m.import_batches (source_hash)
    where source_hash is not null;

create unique index uq_import_batches_idempotency_key_p009
    on ltc_m.import_batches (idempotency_key)
    where idempotency_key is not null;

create index ix_import_batches_status_created_p009
    on ltc_m.import_batches (status, created_at desc);

create table ltc_m.import_batch_sheets (
    id uuid primary key default gen_random_uuid(),
    import_batch_id uuid not null references ltc_m.import_batches (id),
    sheet_key text not null,
    sheet_name text not null,
    sheet_index integer not null,
    detected_range text,
    first_row integer,
    last_row integer,
    found_rows integer not null default 0,
    staged_rows integer not null default 0,
    rejected_rows integer not null default 0,
    content_hash text,
    status text not null default 'detected',
    technical_message text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    row_version bigint not null default 1,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    request_id text,
    constraint ck_import_batch_sheets_key_p009
        check (sheet_key in ('project_values', 'monthly_revenue', 'curve_s')),
    constraint ck_import_batch_sheets_name_p009
        check (btrim(sheet_name) = sheet_name and sheet_name <> ''),
    constraint ck_import_batch_sheets_documentary_p009
        check (sheet_name <> 'Decisões Aprovadas'),
    constraint ck_import_batch_sheets_index_p009
        check (sheet_index >= 0),
    constraint ck_import_batch_sheets_range_p009
        check (detected_range is null or btrim(detected_range) <> ''),
    constraint ck_import_batch_sheets_rows_p009
        check (
            (first_row is null or first_row > 0)
            and (last_row is null or last_row > 0)
            and (last_row is null or first_row is null or last_row >= first_row)
            and found_rows >= 0
            and staged_rows >= 0
            and rejected_rows >= 0
            and staged_rows <= found_rows
            and rejected_rows <= staged_rows
        ),
    constraint ck_import_batch_sheets_content_hash_p009
        check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
    constraint ck_import_batch_sheets_status_p009
        check (status in ('detected', 'staging', 'completed', 'rejected')),
    constraint ck_import_batch_sheets_metadata_p009
        check (jsonb_typeof(metadata) = 'object'),
    constraint ck_import_batch_sheets_row_version_p009
        check (row_version > 0),
    constraint ck_import_batch_sheets_request_id_p009
        check (request_id is null or (request_id = btrim(request_id) and request_id <> ''))
);

comment on table ltc_m.import_batch_sheets is
    'Abas operacionais detectadas por lote; Decisões Aprovadas permanece documental.';

create unique index uq_import_batch_sheets_batch_key_p009
    on ltc_m.import_batch_sheets (import_batch_id, sheet_key);

create unique index uq_import_batch_sheets_batch_name_p009
    on ltc_m.import_batch_sheets (import_batch_id, sheet_name);

create index ix_import_batch_sheets_batch_p009
    on ltc_m.import_batch_sheets (import_batch_id, sheet_index);

create index ix_import_batch_sheets_status_p009
    on ltc_m.import_batch_sheets (status, updated_at desc);

create table ltc_m.import_staging_rows (
    id uuid primary key default gen_random_uuid(),
    import_batch_sheet_id uuid not null references ltc_m.import_batch_sheets (id),
    source_row_number integer not null,
    source_range text,
    row_kind text,
    payload_schema_version integer not null default 1,
    raw_payload jsonb not null,
    row_hash text not null,
    status text not null default 'pending',
    validation_attempt integer not null default 0,
    target_table text,
    target_record_id uuid,
    validated_at timestamptz,
    processed_at timestamptz,
    last_error_code text,
    last_error_summary text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    row_version bigint not null default 1,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    request_id text,
    constraint ck_import_staging_rows_source_number_p009
        check (source_row_number > 0),
    constraint ck_import_staging_rows_source_range_p009
        check (source_range is null or btrim(source_range) <> ''),
    constraint ck_import_staging_rows_kind_p009
        check (row_kind is null or row_kind in ('unknown', 'header', 'data', 'total', 'note', 'blank')),
    constraint ck_import_staging_rows_payload_schema_p009
        check (payload_schema_version = 1),
    constraint ck_import_staging_rows_payload_p009
        check (jsonb_typeof(raw_payload) = 'object'),
    constraint ck_import_staging_rows_hash_p009
        check (row_hash ~ '^[0-9a-f]{64}$'),
    constraint ck_import_staging_rows_status_p009
        check (status in ('pending', 'valid', 'rejected', 'processed')),
    constraint ck_import_staging_rows_attempt_p009
        check (validation_attempt >= 0),
    constraint ck_import_staging_rows_row_version_p009
        check (row_version > 0),
    constraint ck_import_staging_rows_request_id_p009
        check (request_id is null or (request_id = btrim(request_id) and request_id <> ''))
);

comment on table ltc_m.import_staging_rows is
    'Linhas fÃ­sicas brutas do workbook; o payload Ã© produzido pelo P010 e nÃ£o Ã© interpretado no P009.';

create unique index uq_import_staging_rows_sheet_row_p009
    on ltc_m.import_staging_rows (import_batch_sheet_id, source_row_number);

create index ix_import_staging_rows_sheet_status_p009
    on ltc_m.import_staging_rows (import_batch_sheet_id, status);

create index ix_import_staging_rows_status_p009
    on ltc_m.import_staging_rows (status, updated_at desc);

create index ix_import_staging_rows_hash_p009
    on ltc_m.import_staging_rows (row_hash);

alter table ltc_m.import_row_errors
    add column import_batch_sheet_id uuid references ltc_m.import_batch_sheets (id),
    add column import_staging_row_id uuid references ltc_m.import_staging_rows (id),
    add column severity text not null default 'error',
    add column field_path text,
    add column raw_value jsonb,
    add column technical_detail text,
    add column error_key text,
    add column request_id text,
    add column created_by_user_id uuid references ltc_m.app_users (id),
    add constraint ck_import_row_errors_severity_p009
        check (severity in ('warning', 'error')),
    add constraint ck_import_row_errors_request_id_p009
        check (request_id is null or (request_id = btrim(request_id) and request_id <> ''));

create index ix_import_row_errors_staging_row_p009
    on ltc_m.import_row_errors (import_staging_row_id, created_at desc);

create index ix_import_row_errors_batch_severity_p009
    on ltc_m.import_row_errors (batch_id, severity, created_at desc);

create index ix_import_row_errors_code_p009
    on ltc_m.import_row_errors (error_code, created_at desc);

create function ltc_m.protect_import_staging_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
    if (
        new.import_batch_sheet_id is distinct from old.import_batch_sheet_id
        or new.source_row_number is distinct from old.source_row_number
        or new.source_range is distinct from old.source_range
        or new.payload_schema_version is distinct from old.payload_schema_version
        or new.raw_payload is distinct from old.raw_payload
        or new.row_hash is distinct from old.row_hash
        or new.created_at is distinct from old.created_at
        or new.created_by_user_id is distinct from old.created_by_user_id
        or new.request_id is distinct from old.request_id
    ) then
        raise exception using
            errcode = '23514',
            message = 'Origem, payload e hash de linha staged sÃ£o imutÃ¡veis.';
    end if;
    return new;
end;
$function$;

comment on function ltc_m.protect_import_staging_row() is
    'Protege a origem e o payload bruto da linha; apenas o lifecycle pode evoluir.';

create trigger trg_10_import_batch_sheets_metadata
before insert or update on ltc_m.import_batch_sheets
for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_10_import_staging_rows_metadata
before insert or update on ltc_m.import_staging_rows
for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_00_import_batch_sheets_no_delete
before delete on ltc_m.import_batch_sheets
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_import_staging_rows_no_delete
before delete on ltc_m.import_staging_rows
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_import_staging_rows_immutable
before update on ltc_m.import_staging_rows
for each row execute function ltc_m.protect_import_staging_row();

create trigger trg_90_import_batch_sheets_audit
after insert or update on ltc_m.import_batch_sheets
for each row execute function ltc_m.audit_row_change();

alter table ltc_m.import_batch_sheets enable row level security;
alter table ltc_m.import_batch_sheets force row level security;
alter table ltc_m.import_staging_rows enable row level security;
alter table ltc_m.import_staging_rows force row level security;

create policy import_batch_sheets_select
on ltc_m.import_batch_sheets
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy import_batch_sheets_insert
on ltc_m.import_batch_sheets
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy import_batch_sheets_update
on ltc_m.import_batch_sheets
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy import_staging_rows_select
on ltc_m.import_staging_rows
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy import_staging_rows_insert
on ltc_m.import_staging_rows
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy import_staging_rows_update
on ltc_m.import_staging_rows
for update
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
)
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

revoke all privileges on table
    ltc_m.import_batch_sheets,
    ltc_m.import_staging_rows
from public;

grant select, insert, update on table
    ltc_m.import_batch_sheets,
    ltc_m.import_staging_rows
to ltc_m_runtime;

grant select (
    id,
    batch_id,
    import_batch_sheet_id,
    import_staging_row_id,
    sheet_name,
    source_row,
    entity_type,
    severity,
    field_path,
    raw_value,
    error_code,
    error_message,
    technical_detail,
    error_key,
    request_id,
    created_by_user_id,
    created_at
) on table ltc_m.import_row_errors to ltc_m_runtime;

revoke execute on function ltc_m.protect_import_staging_row() from public;

commit;
