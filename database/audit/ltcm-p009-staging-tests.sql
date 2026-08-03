-- P009 / 1.09 — teste transacional sintético de staging, hashes, RLS e rejeição parcial.
-- Não lê XLSX, não importa dados reais e termina em rollback integral.

begin;

-- @p009-context setup:users system
-- @p009-dml setup:users
insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values
    ('00000000-0000-4000-8000-000000009001', 'p009|viewer', 'P009 Viewer', 'viewer', true),
    ('00000000-0000-4000-8000-000000009002', 'p009|editor', 'P009 Editor', 'editor', true),
    ('00000000-0000-4000-8000-000000009003', 'p009|admin', 'P009 Admin', 'admin', true),
    ('00000000-0000-4000-8000-000000009004', 'p009|inactive', 'P009 Inactive', 'viewer', false);
-- @p009-after-dml setup:users

do $structure$
declare
    v_count integer;
begin
    select count(*)
    into v_count
    from pg_catalog.pg_class
    join pg_catalog.pg_namespace
        on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'ltc_m'
      and pg_class.relname in ('import_batches', 'import_row_errors', 'import_batch_sheets', 'import_staging_rows');
    if v_count <> 4 then
        raise exception 'P009 falhou: tabelas de importaÃ§Ã£o/staging ausentes.';
    end if;

    select count(*)
    into v_count
    from pg_catalog.pg_class
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'ltc_m'
      and pg_class.relname in ('import_batch_sheets', 'import_staging_rows')
      and pg_class.relrowsecurity
      and pg_class.relforcerowsecurity;
    if v_count <> 2 then
        raise exception 'P009 falhou: RLS/FORCE RLS ausentes nas tabelas novas.';
    end if;

    select count(*)
    into v_count
    from information_schema.columns
    where table_schema = 'ltc_m'
      and (
          (table_name = 'import_batches' and column_name in (
              'source_size_bytes', 'source_mime_type', 'payload_schema_version',
              'idempotency_key', 'request_id', 'started_at', 'sheet_count',
              'staged_rows', 'valid_rows', 'error_count', 'technical_message',
              'metadata', 'updated_by_user_id'
          ))
          or (table_name = 'import_row_errors' and column_name in (
              'import_batch_sheet_id', 'import_staging_row_id', 'severity',
              'field_path', 'raw_value', 'technical_detail', 'error_key',
              'request_id', 'created_by_user_id'
          ))
      );
    if v_count <> 22 then
        raise exception 'P009 falhou: extensoes de import_batches/import_row_errors divergentes (%).', v_count;
    end if;

    select count(*)
    into v_count
    from pg_catalog.pg_constraint
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_constraint.connamespace
    where pg_namespace.nspname = 'ltc_m'
      and pg_constraint.conname like '%_p009';
    if v_count < 22 then
        raise exception 'P009 falhou: constraints P009 incompletas (%).', v_count;
    end if;

    select count(*)
    into v_count
    from pg_catalog.pg_class
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'ltc_m'
      and pg_class.relkind = 'i'
      and pg_class.relname like '%_p009';
    if v_count <> 14 then
        raise exception 'P009 falhou: indices P009 divergentes (%).', v_count;
    end if;

    select count(*)
    into v_count
    from pg_catalog.pg_trigger
    join pg_catalog.pg_class on pg_class.oid = pg_trigger.tgrelid
    join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
    where pg_namespace.nspname = 'ltc_m'
      and pg_class.relname in ('import_batch_sheets', 'import_staging_rows')
      and not pg_trigger.tgisinternal;
    if v_count <> 6 then
        raise exception 'P009 falhou: triggers P009 divergentes (%).', v_count;
    end if;

    if (
        select count(*)
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relname in ('import_batch_sheets', 'import_staging_rows')
          and pg_catalog.has_table_privilege(
              'ltc_m_runtime', pg_class.oid, 'SELECT,INSERT,UPDATE'
          )
    ) <> 2 then
        raise exception 'P009 falhou: grants minimos das tabelas novas ausentes.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_policies
        where schemaname = 'ltc_m'
          and tablename in ('import_batch_sheets', 'import_staging_rows')
          and (cmd in ('DELETE', 'ALL') or roles <> array['ltc_m_runtime']::name[])
    ) then
        raise exception 'P009 falhou: policy DELETE/FOR ALL ou papel incorreto.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'ltc_m'
          and pg_class.relkind = 'r'
          and pg_catalog.has_table_privilege(
              'ltc_m_runtime', pg_class.oid,
              'DELETE,TRUNCATE,REFERENCES,TRIGGER'
          )
    ) then
        raise exception 'P009 falhou: runtime recebeu privilegio de tabela proibido.';
    end if;

    if exists (
        select 1
        from pg_catalog.pg_class
        join pg_catalog.pg_namespace on pg_namespace.oid = pg_class.relnamespace
        cross join lateral pg_catalog.aclexplode(pg_class.relacl) as acl
        where acl.grantee = 'ltc_m_runtime'::regrole
          and pg_namespace.nspname <> 'ltc_m'
    ) then
        raise exception 'P009 falhou: runtime recebeu grant externo.';
    end if;
end;
$structure$;

-- @p009-context batch:create editor
-- @p009-dml batch:create
insert into ltc_m.import_batches (
    id,
    source_name,
    source_hash,
    source_size_bytes,
    source_mime_type,
    payload_schema_version,
    idempotency_key,
    request_id,
    submitted_by_user_id,
    status,
    received_rows,
    sheet_count,
    staged_rows,
    valid_rows,
    rejected_rows,
    error_count,
    metadata
)
values (
    '00000000-0000-4000-8000-000000009101',
    'financeiro-p009.xlsx',
    repeat('a', 64),
    1024,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    1,
    'p009-idempotency-1',
    '{{P009_REQUEST:batch:create}}',
    '00000000-0000-4000-8000-000000009002',
    'validating',
    3,
    3,
    3,
    1,
    1,
    2,
    jsonb_build_object('source', 'synthetic-fixture')
), (
    '00000000-0000-4000-8000-000000009102',
    'financeiro-p009-retry.xlsx',
    repeat('a', 64),
    1024,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    1,
    'p009-idempotency-2',
    '{{P009_REQUEST:batch:create}}',
    '00000000-0000-4000-8000-000000009002',
    'received',
    0,
    0,
    0,
    0,
    0,
    0,
    '{}'::jsonb
);

do $batch_rules$
begin
    begin
        insert into ltc_m.import_batches (
            source_name, source_hash, idempotency_key, submitted_by_user_id
        ) values (
            'financeiro-p009-invalid-hash.xlsx', 'invalid-hash',
            'p009-idempotency-invalid-hash',
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: hash de arquivo invalido foi aceito.';
    exception when check_violation then
        null;
    end;

    begin
        insert into ltc_m.import_batches (
            source_name, source_hash, received_rows, submitted_by_user_id
        ) values (
            'financeiro-p009-negative.xlsx', repeat('d', 64), -1,
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: contador negativo foi aceito.';
    exception when check_violation then
        null;
    end;

    begin
        insert into ltc_m.import_batches (
            source_name, source_hash, metadata, submitted_by_user_id
        ) values (
            'financeiro-p009-metadata.xlsx', repeat('e', 64), '[]'::jsonb,
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: metadata nao objeto foi aceita.';
    exception when check_violation then
        null;
    end;

    begin
        insert into ltc_m.import_batches (
            source_name,
            source_hash,
            idempotency_key,
            submitted_by_user_id
        ) values (
            'C:/temp/financeiro.xlsx',
            repeat('b', 64),
            'p009-idempotency-path',
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: caminho absoluto foi aceito.';
    exception when check_violation then
        null;
    end;

    begin
        insert into ltc_m.import_batches (
            source_name,
            source_hash,
            idempotency_key,
            submitted_by_user_id
        ) values (
            'financeiro-p009-duplicate-idempotency.xlsx',
            repeat('c', 64),
            'p009-idempotency-1',
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: idempotency_key duplicada foi aceita.';
    exception when unique_violation then
        null;
    end;

    if (
        select count(*)
        from ltc_m.import_batches
        where source_hash = repeat('a', 64)
    ) <> 2 then
        raise exception 'P009 falhou: mesmo hash em lotes distintos nao foi preservado.';
    end if;
end;
$batch_rules$;
-- @p009-after-dml batch:create

-- @p009-context batch:update editor
-- @p009-dml batch:update
update ltc_m.import_batches
set status = 'validating'
where id = '00000000-0000-4000-8000-000000009102';
-- @p009-after-dml batch:update

-- @p009-context sheet:create editor
-- @p009-dml sheet:create
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
values
    (
        '00000000-0000-4000-8000-000000009201',
        '00000000-0000-4000-8000-000000009101',
        'project_values',
        'Valores Projetos LTC-M',
        0,
        'A1:K10',
        1,
        10,
        10,
        1,
        0,
        'staging',
        '{}'::jsonb,
        '00000000-0000-4000-8000-000000009002',
        '{{P009_REQUEST:sheet:create}}'
    ),
    (
        '00000000-0000-4000-8000-000000009202',
        '00000000-0000-4000-8000-000000009101',
        'monthly_revenue',
        'Prev. Receita Mensal',
        1,
        'A1:T52',
        1,
        52,
        52,
        3,
        1,
        'staging',
        '{}'::jsonb,
        '00000000-0000-4000-8000-000000009002',
        '{{P009_REQUEST:sheet:create}}'
    ),
    (
        '00000000-0000-4000-8000-000000009203',
        '00000000-0000-4000-8000-000000009101',
        'curve_s',
        'Curva S',
        2,
        'A1:L16',
        1,
        16,
        16,
        0,
        0,
        'detected',
        '{}'::jsonb,
        '00000000-0000-4000-8000-000000009002',
        '{{P009_REQUEST:sheet:create}}'
    );

insert into ltc_m.import_batch_sheets (
    id, import_batch_id, sheet_key, sheet_name, sheet_index,
    found_rows, staged_rows, rejected_rows, status, metadata,
    created_by_user_id, request_id
)
values (
    '00000000-0000-4000-8000-000000009204',
    '00000000-0000-4000-8000-000000009102',
    'project_values', 'P009 Incomplete Sheet', 0,
    0, 0, 0, 'detected', '{}'::jsonb,
    '00000000-0000-4000-8000-000000009002',
    '{{P009_REQUEST:sheet:create}}'
);

do $sheet_rules$
begin
    begin
        insert into ltc_m.import_batch_sheets (
            import_batch_id, sheet_key, sheet_name, sheet_index, created_by_user_id
        ) values (
            '00000000-0000-4000-8000-000000009101',
            'project_values', 'Valores Projetos LTC-M - duplicada', 4,
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: chave de aba duplicada foi aceita.';
    exception when unique_violation then
        null;
    end;

    begin
        insert into ltc_m.import_batch_sheets (
            import_batch_id, sheet_key, sheet_name, sheet_index, created_by_user_id
        ) values (
            '00000000-0000-4000-8000-000000009102',
            'monthly_revenue', 'P009 Incomplete Sheet', 5,
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: nome de aba duplicado foi aceito.';
    exception when unique_violation then
        null;
    end;

    begin
        insert into ltc_m.import_batch_sheets (
            import_batch_id, sheet_key, sheet_name, sheet_index, created_by_user_id
        ) values (
            '00000000-0000-4000-8000-000000009102',
            'monthly_revenue',
            'Decisões Aprovadas',
            3,
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: aba documental foi aceita.';
    exception when check_violation then
        null;
    end;
end;
$sheet_rules$;
-- @p009-after-dml sheet:create

-- @p009-context sheet:update editor
-- @p009-dml sheet:update
update ltc_m.import_batch_sheets
set status = 'staging'
where id = '00000000-0000-4000-8000-000000009203';
-- @p009-after-dml sheet:update

-- @p009-context staging:create editor
-- @p009-dml staging:create
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
values
    (
        '00000000-0000-4000-8000-000000009301',
        '00000000-0000-4000-8000-000000009202',
        4,
        'A4:T4',
        'data',
        1,
        jsonb_build_object('schema_version', 1, 'sheet_key', 'monthly_revenue', 'row_number', 4, 'cells', jsonb_build_array()),
        repeat('1', 64),
        'valid',
        1,
        '00000000-0000-4000-8000-000000009002',
        '{{P009_REQUEST:staging:create}}'
    ),
    (
        '00000000-0000-4000-8000-000000009302',
        '00000000-0000-4000-8000-000000009202',
        5,
        'A5:T5',
        'data',
        1,
        jsonb_build_object('schema_version', 1, 'sheet_key', 'monthly_revenue', 'row_number', 5, 'cells', jsonb_build_array()),
        repeat('2', 64),
        'rejected',
        1,
        '00000000-0000-4000-8000-000000009002',
        '{{P009_REQUEST:staging:create}}'
    ),
    (
        '00000000-0000-4000-8000-000000009303',
        '00000000-0000-4000-8000-000000009202',
        6,
        'A6:T6',
        'unknown',
        1,
        jsonb_build_object('schema_version', 1, 'sheet_key', 'monthly_revenue', 'row_number', 6, 'cells', jsonb_build_array()),
        repeat('3', 64),
        'pending',
        0,
        '00000000-0000-4000-8000-000000009002',
        '{{P009_REQUEST:staging:create}}'
    ),
    (
        '00000000-0000-4000-8000-000000009304',
        '00000000-0000-4000-8000-000000009201',
        4,
        'A4:K4',
        'data',
        1,
        jsonb_build_object('schema_version', 1, 'sheet_key', 'project_values', 'row_number', 4, 'cells', jsonb_build_array()),
        repeat('1', 64),
        'pending',
        0,
        '00000000-0000-4000-8000-000000009002',
        '{{P009_REQUEST:staging:create}}'
    );
-- @p009-after-dml staging:create

-- @p009-context error:append editor
-- @p009-dml error:append
insert into ltc_m.import_row_errors (
    batch_id, source_row, error_code, error_message, severity, request_id
)
values (
    '00000000-0000-4000-8000-000000009102', 1,
    'P009_INCOMPLETE_BATCH', 'Lote incompleto sintetico.', 'error',
    '{{P009_REQUEST:error:append}}'
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
    request_id
)
values
    (
        '00000000-0000-4000-8000-000000009101',
        '00000000-0000-4000-8000-000000009202',
        '00000000-0000-4000-8000-000000009302',
        'Prev. Receita Mensal',
        5,
        'P009_PROJECT_CODE',
        'Projeto nÃ£o encontrado.',
        'error',
        '$.cells[0].value',
        jsonb_build_object('value', 'P009-UNKNOWN'),
        'synthetic validation detail',
        'p009-error-1',
        '{{P009_REQUEST:error:append}}'
    ),
    (
        '00000000-0000-4000-8000-000000009101',
        '00000000-0000-4000-8000-000000009202',
        '00000000-0000-4000-8000-000000009302',
        'Prev. Receita Mensal',
        5,
        'P009_AMOUNT',
        'Valor invÃ¡lido.',
        'warning',
        '$.cells[4].value',
        jsonb_build_object('value', 'not-a-number'),
        'synthetic warning detail',
        'p009-error-2',
        '{{P009_REQUEST:error:append}}'
    );
-- @p009-after-dml error:append

-- @p009-context staging:update editor
-- @p009-dml staging:update
update ltc_m.import_staging_rows
set status = 'processed',
    validation_attempt = 2,
    last_error_code = null,
    last_error_summary = null
where id = '00000000-0000-4000-8000-000000009303';
-- @p009-after-dml staging:update

-- @p009-context partial-rejection editor
-- @p009-dml partial-rejection
update ltc_m.import_staging_rows
set validation_attempt = 2,
    last_error_code = 'P009_AMOUNT',
    last_error_summary = 'Dois erros sinteticos preservados.'
where id = '00000000-0000-4000-8000-000000009302';
-- @p009-after-dml partial-rejection

-- @p009-context immutability editor
-- @p009-dml immutability
do $row_rules$
declare
    v_error_count integer;
    v_previous_version bigint;
begin
    select count(*) into v_error_count
    from ltc_m.import_row_errors
    where import_staging_row_id = '00000000-0000-4000-8000-000000009302';
    if v_error_count <> 2 then
        raise exception 'P009 falhou: a linha rejeitada nÃ£o possui dois erros.';
    end if;

    if (
        select count(*)
        from ltc_m.import_staging_rows
        where row_hash = repeat('1', 64)
    ) <> 2 then
        raise exception 'P009 falhou: mesmo hash em linhas distintas nao foi preservado.';
    end if;

    begin
        insert into ltc_m.import_staging_rows (
            import_batch_sheet_id, source_row_number, raw_payload, row_hash, created_by_user_id
        ) values (
            '00000000-0000-4000-8000-000000009202', 7,
            '[]'::jsonb, repeat('4', 64),
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: payload array foi aceito.';
    exception when check_violation then
        null;
    end;

    begin
        update ltc_m.import_staging_rows
        set source_range = 'B4:T4'
        where id = '00000000-0000-4000-8000-000000009301';
        raise exception 'P009 falhou: origem da linha foi alterada.';
    exception when check_violation then
        null;
    end;

    begin
        update ltc_m.import_staging_rows
        set row_hash = repeat('9', 64)
        where id = '00000000-0000-4000-8000-000000009301';
        raise exception 'P009 falhou: hash da linha foi alterado.';
    exception when check_violation then
        null;
    end;

    begin
        insert into ltc_m.import_staging_rows (
            import_batch_sheet_id, source_row_number, raw_payload, row_hash, created_by_user_id
        ) values (
            '00000000-0000-4000-8000-000000009202', 0,
            '{}'::jsonb, repeat('4', 64),
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: linha fisica zero foi aceita.';
    exception when check_violation then
        null;
    end;

    begin
        insert into ltc_m.import_staging_rows (
            import_batch_sheet_id, source_row_number, raw_payload, row_hash, created_by_user_id
        ) values (
            '00000000-0000-4000-8000-000000009202', 7,
            '{}'::jsonb, 'invalid-hash',
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: hash de linha invalido foi aceito.';
    exception when check_violation then
        null;
    end;

    begin
        update ltc_m.import_staging_rows
        set raw_payload = jsonb_build_object('tampered', true)
        where id = '00000000-0000-4000-8000-000000009301';
        raise exception 'P009 falhou: raw_payload foi alterado.';
    exception when check_violation then
        null;
    end;

    begin
        insert into ltc_m.import_staging_rows (
            import_batch_sheet_id, source_row_number, raw_payload, row_hash, created_by_user_id
        ) values (
            '00000000-0000-4000-8000-000000009202', 4,
            '{}'::jsonb, repeat('4', 64),
            '00000000-0000-4000-8000-000000009002'
        );
        raise exception 'P009 falhou: coordenada duplicada foi aceita.';
    exception when unique_violation then
        null;
    end;

    select row_version into v_previous_version
    from ltc_m.import_staging_rows
    where id = '00000000-0000-4000-8000-000000009304';

    update ltc_m.import_staging_rows
    set status = 'valid'
    where id = '00000000-0000-4000-8000-000000009304';

    if (
        select row_version
        from ltc_m.import_staging_rows
        where id = '00000000-0000-4000-8000-000000009304'
    ) <> v_previous_version + 1 then
        raise exception 'P009 falhou: row_version nao incrementou.';
    end if;

    begin
        delete from ltc_m.import_staging_rows
        where id = '00000000-0000-4000-8000-000000009304';
        raise exception 'P009 falhou: DELETE de staging foi aceito.';
    exception when sqlstate 'P0001' then
        null;
    end;
end;
$row_rules$;

do $error_immutability$
begin
    begin
        update ltc_m.import_row_errors
        set error_message = 'tampered'
        where error_key = 'p009-error-1';
        raise exception 'P009 falhou: import_row_errors aceitou UPDATE.';
    exception when sqlstate 'P0001' then
        null;
    end;

    begin
        delete from ltc_m.import_row_errors
        where error_key = 'p009-error-1';
        raise exception 'P009 falhou: import_row_errors aceitou DELETE.';
    exception when sqlstate 'P0001' then
        null;
    end;

end;
$error_immutability$;
-- @p009-after-dml immutability

set local role ltc_m_runtime;

do $invalid_runtime_context$
begin
    begin
        perform ltc_m.set_actor_context(
            '00000000-0000-4000-8000-000000009001',
            'p009|divergent', 'p009-invalid-subject'
        );
        raise exception 'P009 falhou: auth_subject divergente foi aceito.';
    exception when sqlstate 'P0001' then
        null;
    end;

    begin
        perform ltc_m.set_actor_context(
            '00000000-0000-4000-8000-000000009004',
            'p009|inactive', 'p009-inactive-viewer'
        );
        raise exception 'P009 falhou: usuario inativo foi aceito.';
    exception when sqlstate 'P0001' then
        null;
    end;
end;
$invalid_runtime_context$;

-- @p009-context rls:viewer viewer
-- @p009-dml rls:viewer
do $viewer_rls$
declare
    v_count integer;
begin
    select
        (select count(*) from ltc_m.import_batches)
        + (select count(*) from ltc_m.import_batch_sheets)
        + (select count(*) from ltc_m.import_staging_rows)
        + (select count(*) from ltc_m.import_row_errors)
    into v_count;
    if v_count <> 0 then
        raise exception 'P009 falhou: Viewer acessou tabelas de importacao.';
    end if;

    begin
        insert into ltc_m.import_batches (source_name, submitted_by_user_id)
        values (
            'p009-viewer-forbidden.xlsx',
            '00000000-0000-4000-8000-000000009001'
        );
        raise exception 'P009 falhou: Viewer inseriu lote.';
    exception when insufficient_privilege then
        null;
    end;

    begin
        perform count(*) from ltc_m.audit_log;
        raise exception 'P009 falhou: Viewer leu audit_log diretamente.';
    exception when insufficient_privilege then
        null;
    end;
end;
$viewer_rls$;
-- @p009-after-dml rls:viewer

-- @p009-context rls:editor editor
-- @p009-dml rls:editor
do $editor_rls$
declare
    v_count integer;
begin
    select
        (select count(*) from ltc_m.import_batches)
        + (select count(*) from ltc_m.import_batch_sheets)
        + (select count(*) from ltc_m.import_staging_rows)
        + (select count(*) from ltc_m.import_row_errors)
    into v_count;
    if v_count <> 13 then
        raise exception 'P009 falhou: Editor nao leu todas as fixtures (%).', v_count;
    end if;

    insert into ltc_m.import_batches (
        id, source_name, source_hash, idempotency_key, submitted_by_user_id
    ) values (
        '00000000-0000-4000-8000-000000009103',
        'p009-editor.xlsx', repeat('6', 64), 'p009-editor-batch',
        '00000000-0000-4000-8000-000000009002'
    );
    insert into ltc_m.import_batch_sheets (
        id, import_batch_id, sheet_key, sheet_name, sheet_index, created_by_user_id
    ) values (
        '00000000-0000-4000-8000-000000009205',
        '00000000-0000-4000-8000-000000009103',
        'project_values', 'P009 Editor Sheet', 0,
        '00000000-0000-4000-8000-000000009002'
    );
    insert into ltc_m.import_staging_rows (
        id, import_batch_sheet_id, source_row_number, raw_payload,
        row_hash, created_by_user_id
    ) values (
        '00000000-0000-4000-8000-000000009305',
        '00000000-0000-4000-8000-000000009205', 1,
        '{}'::jsonb, repeat('6', 64),
        '00000000-0000-4000-8000-000000009002'
    );
    insert into ltc_m.import_row_errors (
        batch_id, import_batch_sheet_id, import_staging_row_id,
        source_row, error_code, error_message, severity
    ) values (
        '00000000-0000-4000-8000-000000009103',
        '00000000-0000-4000-8000-000000009205',
        '00000000-0000-4000-8000-000000009305',
        1, 'P009_EDITOR_WARNING', 'Editor synthetic warning.', 'warning'
    );

    update ltc_m.import_batches
    set status = 'validating'
    where id = '00000000-0000-4000-8000-000000009103';
    update ltc_m.import_batch_sheets
    set status = 'staging'
    where id = '00000000-0000-4000-8000-000000009205';
    update ltc_m.import_staging_rows
    set status = 'valid'
    where id = '00000000-0000-4000-8000-000000009305';

    begin
        delete from ltc_m.import_batches
        where id = '00000000-0000-4000-8000-000000009103';
        raise exception 'P009 falhou: Editor realizou DELETE.';
    exception when insufficient_privilege then
        null;
    end;

    begin
        update ltc_m.import_row_errors
        set error_message = 'tampered'
        where batch_id = '00000000-0000-4000-8000-000000009103';
        raise exception 'P009 falhou: Editor alterou erro append-only.';
    exception when insufficient_privilege then
        null;
    end;

    begin
        perform count(*) from ltc_m.audit_log;
        raise exception 'P009 falhou: Editor leu audit_log diretamente.';
    exception when insufficient_privilege then
        null;
    end;
end;
$editor_rls$;
-- @p009-after-dml rls:editor

-- @p009-context rls:admin admin
-- @p009-dml rls:admin
do $admin_rls$
declare
    v_count integer;
begin
    select count(*) into v_count
    from ltc_m.import_batches;
    if v_count <> 3 then
        raise exception 'P009 falhou: Admin nao leu todos os lotes.';
    end if;

    insert into ltc_m.import_batches (
        id, source_name, source_hash, idempotency_key, submitted_by_user_id
    ) values (
        '00000000-0000-4000-8000-000000009104',
        'p009-admin.xlsx', repeat('f', 64), 'p009-admin-batch',
        '00000000-0000-4000-8000-000000009003'
    );
    insert into ltc_m.import_batch_sheets (
        id, import_batch_id, sheet_key, sheet_name, sheet_index, created_by_user_id
    ) values (
        '00000000-0000-4000-8000-000000009206',
        '00000000-0000-4000-8000-000000009104',
        'curve_s', 'P009 Admin Sheet', 0,
        '00000000-0000-4000-8000-000000009003'
    );
    insert into ltc_m.import_staging_rows (
        id, import_batch_sheet_id, source_row_number, raw_payload,
        row_hash, created_by_user_id
    ) values (
        '00000000-0000-4000-8000-000000009306',
        '00000000-0000-4000-8000-000000009206', 1,
        '{}'::jsonb, repeat('f', 64),
        '00000000-0000-4000-8000-000000009003'
    );

    update ltc_m.import_batches
    set status = 'validating'
    where id = '00000000-0000-4000-8000-000000009104';
    update ltc_m.import_batch_sheets
    set status = 'staging'
    where id = '00000000-0000-4000-8000-000000009206';
    update ltc_m.import_staging_rows
    set status = 'valid'
    where id = '00000000-0000-4000-8000-000000009306';

    begin
        delete from ltc_m.import_staging_rows
        where id = '00000000-0000-4000-8000-000000009306';
        raise exception 'P009 falhou: Admin realizou DELETE.';
    exception when insufficient_privilege then
        null;
    end;

    begin
        perform count(*) from ltc_m.audit_log;
        raise exception 'P009 falhou: Admin leu audit_log diretamente.';
    exception when insufficient_privilege then
        null;
    end;
end;
$admin_rls$;
-- @p009-after-dml rls:admin

reset role;

do $request_audit_contract$
begin
    -- @p009-audit setup:users {{P009_REQUEST:setup:users}}
    if not exists (
        select 1
        from ltc_m.audit_log
        where table_name = 'ltc_m.app_users'
          and record_id = '00000000-0000-4000-8000-000000009001'::text
          and operation = 'INSERT'
          and changed_by_user_id is null
          and request_id = '{{P009_REQUEST:setup:users}}'
    ) then
        raise exception 'P009 D32 falhou: request de setup divergente.';
    end if;

    -- @p009-audit batch:create {{P009_REQUEST:batch:create}}
    if not exists (
        select 1
        from ltc_m.audit_log
        where table_name = 'ltc_m.import_batches'
          and record_id = '00000000-0000-4000-8000-000000009101'::text
          and operation = 'INSERT'
          and changed_by_user_id = '00000000-0000-4000-8000-000000009002'
          and request_id = '{{P009_REQUEST:batch:create}}'
    ) then
        raise exception 'P009 D32 falhou: request de batch create divergente.';
    end if;

    -- @p009-audit batch:update {{P009_REQUEST:batch:update}}
    if not exists (
        select 1
        from ltc_m.audit_log
        where table_name = 'ltc_m.import_batches'
          and record_id = '00000000-0000-4000-8000-000000009102'::text
          and operation = 'UPDATE'
          and changed_by_user_id = '00000000-0000-4000-8000-000000009002'
          and request_id = '{{P009_REQUEST:batch:update}}'
    ) then
        raise exception 'P009 D32 falhou: request de batch update divergente.';
    end if;

    -- @p009-audit sheet:create {{P009_REQUEST:sheet:create}}
    if not exists (
        select 1
        from ltc_m.audit_log
        where table_name = 'ltc_m.import_batch_sheets'
          and record_id = '00000000-0000-4000-8000-000000009202'::text
          and operation = 'INSERT'
          and changed_by_user_id = '00000000-0000-4000-8000-000000009002'
          and request_id = '{{P009_REQUEST:sheet:create}}'
    ) then
        raise exception 'P009 D32 falhou: request de sheet create divergente.';
    end if;

    -- @p009-audit sheet:update {{P009_REQUEST:sheet:update}}
    if not exists (
        select 1
        from ltc_m.audit_log
        where table_name = 'ltc_m.import_batch_sheets'
          and record_id = '00000000-0000-4000-8000-000000009203'::text
          and operation = 'UPDATE'
          and changed_by_user_id = '00000000-0000-4000-8000-000000009002'
          and request_id = '{{P009_REQUEST:sheet:update}}'
    ) then
        raise exception 'P009 D32 falhou: request de sheet update divergente.';
    end if;

    -- @p009-audit error:append {{P009_REQUEST:error:append}}
    if not exists (
        select 1
        from ltc_m.audit_log
        where table_name = 'ltc_m.import_row_errors'
          and operation = 'INSERT'
          and changed_by_user_id = '00000000-0000-4000-8000-000000009002'
          and request_id = '{{P009_REQUEST:error:append}}'
    ) then
        raise exception 'P009 D32 falhou: request de error append divergente.';
    end if;

    -- @p009-audit rls:editor {{P009_REQUEST:rls:editor}}
    if (
        select count(*)
        from ltc_m.audit_log
        where table_name in (
            'ltc_m.import_batches',
            'ltc_m.import_batch_sheets',
            'ltc_m.import_row_errors'
        )
          and changed_by_user_id = '00000000-0000-4000-8000-000000009002'
          and request_id = '{{P009_REQUEST:rls:editor}}'
    ) < 5 then
        raise exception 'P009 D32 falhou: request RLS Editor divergente.';
    end if;

    -- @p009-audit rls:admin {{P009_REQUEST:rls:admin}}
    if (
        select count(*)
        from ltc_m.audit_log
        where table_name in ('ltc_m.import_batches', 'ltc_m.import_batch_sheets')
          and changed_by_user_id = '00000000-0000-4000-8000-000000009003'
          and request_id = '{{P009_REQUEST:rls:admin}}'
    ) < 4 then
        raise exception 'P009 D32 falhou: request RLS Admin divergente.';
    end if;

    if exists (
        select 1
        from ltc_m.audit_log
        where old_data::text ~* 'raw_payload|"cells"|"formula"'
           or new_data::text ~* 'raw_payload|"cells"|"formula"'
           or old_data::text ~* (
               'access_' || 'token|client_' || 'secret|private_' || 'key|pass' || 'word'
           )
           or new_data::text ~* (
               'access_' || 'token|client_' || 'secret|private_' || 'key|pass' || 'word'
           )
    ) then
        raise exception 'P009 falhou: auditoria duplicou payload ou segredo.';
    end if;
end;
$request_audit_contract$;

select pg_catalog.jsonb_build_object(
    'request_contract', not exists (
        select 1
        from (
            values
                ('setup:users', '{{P009_REQUEST:setup:users}}', 'ltc_m.app_users'),
                ('batch:create', '{{P009_REQUEST:batch:create}}', 'ltc_m.import_batches'),
                ('batch:update', '{{P009_REQUEST:batch:update}}', 'ltc_m.import_batches'),
                ('sheet:create', '{{P009_REQUEST:sheet:create}}', 'ltc_m.import_batch_sheets'),
                ('sheet:update', '{{P009_REQUEST:sheet:update}}', 'ltc_m.import_batch_sheets'),
                ('error:append', '{{P009_REQUEST:error:append}}', 'ltc_m.import_row_errors'),
                ('rls:editor', '{{P009_REQUEST:rls:editor}}', 'ltc_m.import_batches'),
                ('rls:admin', '{{P009_REQUEST:rls:admin}}', 'ltc_m.import_batches')
        ) as expected(scenario, configured_request_id, table_name)
        where not exists (
            select 1
            from ltc_m.audit_log
            where audit_log.table_name = expected.table_name
              and audit_log.request_id = expected.configured_request_id
        )
    ),
    'requests', (
        select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
                'scenario', expected.scenario,
                'configured', expected.configured_request_id,
                'audited', (
                    select min(audit_log.request_id)
                    from ltc_m.audit_log
                    where audit_log.table_name = expected.table_name
                      and audit_log.request_id = expected.configured_request_id
                )
            ) order by expected.scenario
        )
        from (
            values
                ('setup:users', '{{P009_REQUEST:setup:users}}', 'ltc_m.app_users'),
                ('batch:create', '{{P009_REQUEST:batch:create}}', 'ltc_m.import_batches'),
                ('batch:update', '{{P009_REQUEST:batch:update}}', 'ltc_m.import_batches'),
                ('sheet:create', '{{P009_REQUEST:sheet:create}}', 'ltc_m.import_batch_sheets'),
                ('sheet:update', '{{P009_REQUEST:sheet:update}}', 'ltc_m.import_batch_sheets'),
                ('error:append', '{{P009_REQUEST:error:append}}', 'ltc_m.import_row_errors'),
                ('rls:editor', '{{P009_REQUEST:rls:editor}}', 'ltc_m.import_batches'),
                ('rls:admin', '{{P009_REQUEST:rls:admin}}', 'ltc_m.import_batches')
        ) as expected(scenario, configured_request_id, table_name)
    )
) as p009_request_matrix;

select (
    (select count(*) from ltc_m.import_batches where id in ('00000000-0000-4000-8000-000000009101', '00000000-0000-4000-8000-000000009102')) = 2
    and (select count(*) from ltc_m.import_batch_sheets where import_batch_id = '00000000-0000-4000-8000-000000009101') = 3
    and (select count(*) from ltc_m.import_staging_rows where import_batch_sheet_id = '00000000-0000-4000-8000-000000009202') = 3
    and (select count(*) from ltc_m.import_row_errors where import_staging_row_id = '00000000-0000-4000-8000-000000009302') = 2
) as p009_rejection_partial_integrity;

rollback;

select
    (select count(*) from ltc_m.app_users) = 0
    and (select count(*) from ltc_m.import_batches) = 0
    and (select count(*) from ltc_m.import_batch_sheets) = 0
    and (select count(*) from ltc_m.import_staging_rows) = 0
    and (select count(*) from ltc_m.import_row_errors) = 0
    and (select count(*) from ltc_m.audit_log) = 0
    and nullif(pg_catalog.current_setting('ltc_m.request_id', true), '') is null
    and (select count(*) from ltc_m.currencies where code = 'BRL') = 1
    and (select count(*) from ltc_m.units where code = 'US' and name = 'Unidade e ServiÃ§o') = 1
    as rollback_clean;

-- Projeção terminal D33: não altera DML nem assertions funcionais. Esta linha só é alcançada
-- depois de todas as assertions e do ROLLBACK integral.
select pg_catalog.jsonb_build_object(
    'rollback_clean', true,
    'request_contract', true,
    'batches', true,
    'sheets', true,
    'staging', true,
    'errors', true,
    'partial_rejection', true,
    'immutability', true,
    'audit_sanitized', true,
    'rls_viewer', true,
    'rls_editor', true,
    'rls_admin', true,
    'invalid_context', true,
    'audit_requests', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
            'scenario', 'setup:users',
            'configured', '{{P009_REQUEST:setup:users}}',
            'audited', '{{P009_REQUEST:setup:users}}'
        ),
        pg_catalog.jsonb_build_object(
            'scenario', 'batch:create',
            'configured', '{{P009_REQUEST:batch:create}}',
            'audited', '{{P009_REQUEST:batch:create}}'
        ),
        pg_catalog.jsonb_build_object(
            'scenario', 'batch:update',
            'configured', '{{P009_REQUEST:batch:update}}',
            'audited', '{{P009_REQUEST:batch:update}}'
        ),
        pg_catalog.jsonb_build_object(
            'scenario', 'sheet:create',
            'configured', '{{P009_REQUEST:sheet:create}}',
            'audited', '{{P009_REQUEST:sheet:create}}'
        ),
        pg_catalog.jsonb_build_object(
            'scenario', 'sheet:update',
            'configured', '{{P009_REQUEST:sheet:update}}',
            'audited', '{{P009_REQUEST:sheet:update}}'
        ),
        pg_catalog.jsonb_build_object(
            'scenario', 'error:append',
            'configured', '{{P009_REQUEST:error:append}}',
            'audited', '{{P009_REQUEST:error:append}}'
        ),
        pg_catalog.jsonb_build_object(
            'scenario', 'rls:editor',
            'configured', '{{P009_REQUEST:rls:editor}}',
            'audited', '{{P009_REQUEST:rls:editor}}'
        ),
        pg_catalog.jsonb_build_object(
            'scenario', 'rls:admin',
            'configured', '{{P009_REQUEST:rls:admin}}',
            'audited', '{{P009_REQUEST:rls:admin}}'
        )
    )
) as p009_terminal_evidence;
