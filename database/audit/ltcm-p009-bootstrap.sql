-- P009 / D31 — Fase A: bootstrap sintético completo, sempre revertido.
begin;

set local statement_timeout = '30s';
set local lock_timeout = '10s';

select ltc_m.set_actor_context(
    null,
    null,
    'p009-phase-a-system',
    'D31 bootstrap transacional sintético',
    'system',
    false
);

insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values
    ('00000000-0000-4000-8000-000000009501', 'p009|phase-a-viewer', 'P009 Phase A Viewer', 'viewer', true),
    ('00000000-0000-4000-8000-000000009502', 'p009|phase-a-editor', 'P009 Phase A Editor', 'editor', true),
    ('00000000-0000-4000-8000-000000009503', 'p009|phase-a-admin', 'P009 Phase A Admin', 'admin', true),
    ('00000000-0000-4000-8000-000000009504', 'p009|phase-a-inactive', 'P009 Phase A Inactive', 'viewer', false);

do $phase_a_users$
begin
    if (
        select count(*)
        from ltc_m.app_users
        where id in (
            '00000000-0000-4000-8000-000000009501',
            '00000000-0000-4000-8000-000000009502',
            '00000000-0000-4000-8000-000000009503'
        ) and active
    ) <> 3 then
        raise exception 'P009 D31 Fase A: fixtures ativas divergentes.';
    end if;

    if not exists (
        select 1
        from ltc_m.app_users
        where id = '00000000-0000-4000-8000-000000009504'
          and not active
    ) then
        raise exception 'P009 D31 Fase A: fixture inativa divergente.';
    end if;
end;
$phase_a_users$;

set local role ltc_m_runtime;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000009502',
    'p009|phase-a-editor',
    'p009-phase-a-editor',
    null,
    'api',
    false
);

insert into ltc_m.import_batches (
    id,
    source_name,
    source_hash,
    source_size_bytes,
    payload_schema_version,
    idempotency_key,
    request_id,
    submitted_by_user_id,
    status,
    metadata
)
values (
    '00000000-0000-4000-8000-000000009511',
    'p009-phase-a.xlsx',
    repeat('a', 64),
    1,
    1,
    'p009-phase-a-batch',
    'p009-phase-a-batch',
    '00000000-0000-4000-8000-000000009502',
    'received',
    jsonb_build_object('fixture', 'phase-a')
);

insert into ltc_m.import_batch_sheets (
    id,
    import_batch_id,
    sheet_key,
    sheet_name,
    sheet_index,
    detected_range,
    first_row,
    last_row,
    found_rows,
    staged_rows,
    rejected_rows,
    status,
    metadata,
    created_by_user_id,
    request_id
)
values (
    '00000000-0000-4000-8000-000000009521',
    '00000000-0000-4000-8000-000000009511',
    'project_values',
    'P009 Phase A Project Values',
    0,
    'A1:A1',
    1,
    1,
    1,
    1,
    0,
    'staging',
    jsonb_build_object('fixture', 'phase-a'),
    '00000000-0000-4000-8000-000000009502',
    'p009-phase-a-sheet'
);

insert into ltc_m.import_staging_rows (
    id,
    import_batch_sheet_id,
    source_row_number,
    source_range,
    row_kind,
    payload_schema_version,
    raw_payload,
    row_hash,
    status,
    validation_attempt,
    created_by_user_id,
    request_id
)
values (
    '00000000-0000-4000-8000-000000009531',
    '00000000-0000-4000-8000-000000009521',
    1,
    'A1:A1',
    'data',
    1,
    jsonb_build_object(
        'schema_version', 1,
        'sheet_key', 'project_values',
        'row_number', 1,
        'cells', jsonb_build_array()
    ),
    repeat('b', 64),
    'pending',
    0,
    '00000000-0000-4000-8000-000000009502',
    'p009-phase-a-row'
);

insert into ltc_m.import_row_errors (
    batch_id,
    import_batch_sheet_id,
    import_staging_row_id,
    sheet_name,
    source_row,
    error_code,
    error_message,
    severity,
    field_path,
    raw_value,
    technical_detail,
    error_key,
    request_id,
    created_by_user_id
)
values (
    '00000000-0000-4000-8000-000000009511',
    '00000000-0000-4000-8000-000000009521',
    '00000000-0000-4000-8000-000000009531',
    'P009 Phase A Project Values',
    1,
    'P009_PHASE_A_WARNING',
    'Aviso sintético de bootstrap.',
    'warning',
    '$.cells[0].value',
    jsonb_build_object('value', null),
    'synthetic phase-a detail',
    'p009-phase-a-warning',
    'p009-phase-a-error',
    '00000000-0000-4000-8000-000000009502'
);

do $phase_a_smoke$
begin
    if (select count(*) from ltc_m.import_batches) <> 1
        or (select count(*) from ltc_m.import_batch_sheets) <> 1
        or (select count(*) from ltc_m.import_staging_rows) <> 1
        or (select count(*) from ltc_m.import_row_errors) <> 1
    then
        raise exception 'P009 D31 Fase A: bootstrap relacional incompleto.';
    end if;

    if not exists (
        select 1
        from ltc_m.import_staging_rows
        join ltc_m.import_batch_sheets
          on import_batch_sheets.id = import_staging_rows.import_batch_sheet_id
        join ltc_m.import_batches
          on import_batches.id = import_batch_sheets.import_batch_id
        where import_staging_rows.id = '00000000-0000-4000-8000-000000009531'
          and import_batches.id = '00000000-0000-4000-8000-000000009511'
    ) then
        raise exception 'P009 D31 Fase A: FKs do bootstrap divergentes.';
    end if;

    begin
        insert into ltc_m.import_staging_rows (
            import_batch_sheet_id,
            source_row_number,
            raw_payload,
            row_hash,
            created_by_user_id
        ) values (
            '00000000-0000-4000-8000-000000009521',
            2,
            '[]'::jsonb,
            repeat('c', 64),
            '00000000-0000-4000-8000-000000009502'
        );
        raise exception 'P009 D31 Fase A: constraint de payload não atuou.';
    exception when check_violation then
        null;
    end;
end;
$phase_a_smoke$;

reset role;
rollback;

select pg_catalog.jsonb_build_object(
    'phase_a_passed', true,
    'rollback_clean',
        (select count(*) from ltc_m.app_users) = 0
        and (select count(*) from ltc_m.import_batches) = 0
        and (select count(*) from ltc_m.import_batch_sheets) = 0
        and (select count(*) from ltc_m.import_staging_rows) = 0
        and (select count(*) from ltc_m.import_row_errors) = 0
        and (select count(*) from ltc_m.audit_log) = 3
        and (
            select count(*)
            from ltc_m.audit_log
            where
                (
                    table_name = 'ltc_m.currencies'
                    and record_id in ('BRL', 'USD')
                    and operation = 'INSERT'::ltc_m.audit_operation
                    and source = 'system'
                )
                or (
                    table_name = 'ltc_m.units'
                    and record_id = 'US'
                    and operation = 'INSERT'::ltc_m.audit_operation
                    and source = 'system'
                )
        ) = 3,
    'operational_rows',
        (select count(*) from ltc_m.app_users)
        + (select count(*) from ltc_m.import_batches)
        + (select count(*) from ltc_m.import_batch_sheets)
        + (select count(*) from ltc_m.import_staging_rows)
        + (select count(*) from ltc_m.import_row_errors)
        + (select count(*) from ltc_m.audit_log) - 3,
    'relevant_advisory_locks', (
        select count(*)
        from pg_catalog.pg_locks
        cross join lateral (
            values
                (pg_catalog.hashtextextended('ltc_m.active_admin_guard', 0))
        ) as relevant_keys(lock_key)
        where pg_locks.locktype = 'advisory'
          and pg_locks.database = (
              select pg_database.oid
              from pg_catalog.pg_database
              where pg_database.datname = pg_catalog.current_database()
          )
          and pg_locks.classid = ((relevant_keys.lock_key >> 32) & 4294967295)::oid
          and pg_locks.objid = (relevant_keys.lock_key & 4294967295)::oid
          and pg_locks.objsubid = 1
    )
) as p009_phase_a_result;
