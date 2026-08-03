-- NÃO EXECUTAR AUTOMATICAMENTE.
-- Rollback manual P009 somente após autorização explícita e janela controlada.
-- Não remove import_batches, import_row_errors, P007/P008, role, membership ou dados.

begin;

drop policy if exists import_staging_rows_update on ltc_m.import_staging_rows;
drop policy if exists import_staging_rows_insert on ltc_m.import_staging_rows;
drop policy if exists import_staging_rows_select on ltc_m.import_staging_rows;
drop policy if exists import_batch_sheets_update on ltc_m.import_batch_sheets;
drop policy if exists import_batch_sheets_insert on ltc_m.import_batch_sheets;
drop policy if exists import_batch_sheets_select on ltc_m.import_batch_sheets;

drop trigger if exists trg_90_import_batch_sheets_audit on ltc_m.import_batch_sheets;
drop trigger if exists trg_00_import_staging_rows_immutable on ltc_m.import_staging_rows;
drop trigger if exists trg_00_import_staging_rows_no_delete on ltc_m.import_staging_rows;
drop trigger if exists trg_00_import_batch_sheets_no_delete on ltc_m.import_batch_sheets;
drop trigger if exists trg_10_import_staging_rows_metadata on ltc_m.import_staging_rows;
drop trigger if exists trg_10_import_batch_sheets_metadata on ltc_m.import_batch_sheets;

drop function if exists ltc_m.protect_import_staging_row();

drop table if exists ltc_m.import_staging_rows;
drop table if exists ltc_m.import_batch_sheets;

alter table ltc_m.import_row_errors
    drop constraint if exists ck_import_row_errors_request_id_p009,
    drop constraint if exists ck_import_row_errors_severity_p009,
    drop column if exists request_id,
    drop column if exists created_by_user_id,
    drop column if exists error_key,
    drop column if exists technical_detail,
    drop column if exists raw_value,
    drop column if exists field_path,
    drop column if exists severity,
    drop column if exists import_staging_row_id,
    drop column if exists import_batch_sheet_id;

drop index if exists ltc_m.ix_import_row_errors_code_p009;
drop index if exists ltc_m.ix_import_row_errors_batch_severity_p009;
drop index if exists ltc_m.ix_import_row_errors_staging_row_p009;

alter table ltc_m.import_batches
    drop constraint if exists ck_import_batches_metadata_p009,
    drop constraint if exists ck_import_batches_extended_counts_p009,
    drop constraint if exists ck_import_batches_started_at_p009,
    drop constraint if exists ck_import_batches_request_id_p009,
    drop constraint if exists ck_import_batches_idempotency_key_p009,
    drop constraint if exists ck_import_batches_payload_schema_p009,
    drop constraint if exists ck_import_batches_source_size_p009,
    drop constraint if exists ck_import_batches_source_hash_p009,
    drop constraint if exists ck_import_batches_source_name_p009,
    drop column if exists updated_by_user_id,
    drop column if exists metadata,
    drop column if exists technical_message,
    drop column if exists error_count,
    drop column if exists valid_rows,
    drop column if exists staged_rows,
    drop column if exists sheet_count,
    drop column if exists started_at,
    drop column if exists request_id,
    drop column if exists idempotency_key,
    drop column if exists payload_schema_version,
    drop column if exists source_mime_type,
    drop column if exists source_size_bytes;

drop index if exists ltc_m.ix_import_batches_status_created_p009;
drop index if exists ltc_m.uq_import_batches_idempotency_key_p009;
drop index if exists ltc_m.ix_import_batches_source_hash_p009;

alter table ltc_m.import_batches
    add constraint ck_import_batches_source_hash
        check (source_hash is null or btrim(source_hash) <> '');

create unique index uq_import_batches_hash
    on ltc_m.import_batches (source_hash)
    where source_hash is not null;

rollback;
