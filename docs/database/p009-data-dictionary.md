# P009 — dicionÃ¡rio de dados

## `import_batches`

`source_name`, `source_hash` (SHA-256 minÃºsculo opcional), `source_size_bytes`, `source_mime_type`,
`payload_schema_version=1`, `idempotency_key`, `request_id`, `submitted_by_user_id`, `started_at`,
`completed_at`, `status`, contadores nÃ£o negativos, `technical_message`, `metadata` objeto JSON,
timestamps e `row_version`.

## `import_batch_sheets`

`import_batch_id`, `sheet_key` (`project_values`, `monthly_revenue`, `curve_s`), `sheet_name`,
`sheet_index`, `detected_range`, limites de linha, contadores, `content_hash`, `status`, metadata,
timestamps, versÃ£o, ator e request.

## `import_staging_rows`

`import_batch_sheet_id`, `source_row_number`, `source_range`, `row_kind`, `payload_schema_version`,
`raw_payload`, `row_hash`, `status`, `validation_attempt`, destino opcional, datas de validaÃ§Ã£o/
processamento, Ãºltimo erro, timestamps, versÃ£o, ator e request.

## `import_row_errors`

O contrato existente Ã© preservado e recebe vÃ­nculos `import_batch_sheet_id`/
`import_staging_row_id`, `severity`, `field_path`, `raw_value`, `technical_detail`, `error_key` e
`request_id` e `created_by_user_id`. `raw_payload` legado nÃ£o deve duplicar o payload completo; valores para exibiÃ§Ã£o usam
`raw_value` sanitizado.
