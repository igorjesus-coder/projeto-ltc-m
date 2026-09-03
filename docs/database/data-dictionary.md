# Dicionário de dados do schema `ltc_m`

Contrato: `ltcm.p017.schema-integrity.v1`
Fingerprint: `63866804fe6f5247d9193bad2448253641bee6a45daccacec3c7986d22090b8e`

Inventário: 28 relações (19 tabelas, 9 views), 487 colunas, 54 FKs e 49 policies.

O conteúdo é gerado do modelo canônico PostgreSQL 17. Descrições ausentes são declaradas como
ausentes, sem inferência de negócio. Valores financeiros `numeric` permanecem exatos; sua
aditividade depende do grão documentado.

## `ltc_m.app_users`

- Tipo: `table`.
- Contrato proprietário: P007/P008.
- Propósito versionado: Usuários internos e autorização do LTC-M; auth_subject corresponde ao claim sub do Auth0..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_app_users_auth_subject`: UNIQUE (auth_subject); `uq_app_users_auth_subject`: CREATE UNIQUE INDEX uq_app_users_auth_subject ON ltc_m.app_users USING btree (auth_subject).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `auth_subject` | `text` | não | — | — | — |
| `email` | `text` | sim | — | — | — |
| `full_name` | `text` | não | — | — | — |
| `role` | `ltc_m.app_role` | não | 'viewer'::ltc_m.app_role | — | — |
| `active` | `boolean` | não | true | — | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `row_version` | `bigint` | não | 1 | — | — |

## `ltc_m.audit_log`

- Tipo: `table`.
- Contrato proprietário: P007/P008.
- Propósito versionado: Metadados de auditoria; a automação por trigger não integra esta baseline..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Segurança: RLS=true; FORCE RLS=true; 0 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `bigint` | não | — | — | — |
| `actor_auth_subject` | `text` | sim | — | — | — |
| `source` | `text` | não | 'system'::text | — | — |
| `justification` | `text` | sim | — | — | — |
| `previous_row_version` | `bigint` | sim | — | — | — |
| `new_row_version` | `bigint` | sim | — | — | — |
| `metadata` | `jsonb` | não | '{}'::jsonb | — | — |
| `table_name` | `text` | não | — | — | — |
| `record_id` | `text` | não | — | — | — |
| `operation` | `ltc_m.audit_operation` | não | — | — | — |
| `old_data` | `jsonb` | sim | — | — | — |
| `new_data` | `jsonb` | sim | — | — | — |
| `changed_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `request_id` | `text` | sim | — | — | — |
| `changed_at` | `timestamp with time zone` | não | now() | — | — |

## `ltc_m.clients`

- Tipo: `table`.
- Contrato proprietário: P011.
- Propósito versionado: Cadastro normalizado de clientes do LTC-M..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_clients_tax_id_active`: CREATE UNIQUE INDEX uq_clients_tax_id_active ON ltc_m.clients USING btree (tax_id) WHERE ((tax_id IS NOT NULL) AND (deleted_at IS NULL)).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `deleted_at` | `timestamp with time zone` | sim | — | — | — |
| `row_version` | `bigint` | não | 1 | — | — |
| `legal_name` | `text` | não | — | — | — |
| `display_name` | `text` | não | — | — | — |
| `tax_id` | `text` | sim | — | — | — |
| `active` | `boolean` | não | true | — | — |
| `created_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `updated_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |

## `ltc_m.currencies`

- Tipo: `table`.
- Contrato proprietário: P004/P005.
- Propósito versionado: Moedas aceitas pelo domínio; cada projeto possui exatamente uma moeda-base..
- Grão: uma linha por code.
- Chave primária/lógica: code.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `code` | `text` | não | — | — | — |
| `name` | `text` | não | — | — | — |
| `decimal_places` | `smallint` | não | 2 | — | — |
| `active` | `boolean` | não | true | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `row_version` | `bigint` | não | 1 | — | — |

## `ltc_m.financial_actual_events`

- Tipo: `table`.
- Contrato proprietário: Core/P014.
- Propósito versionado: Eventos de billing_actual e receipt_actual, com chave de origem idempotente por projeto..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_financial_actual_source`: UNIQUE (project_id, source_key); `uq_financial_actual_source`: CREATE UNIQUE INDEX uq_financial_actual_source ON ltc_m.financial_actual_events USING btree (project_id, source_key).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `currency_code` | `text` | não | — | ltc_m.projects.base_currency | — |
| `status` | `ltc_m.actual_status` | não | 'draft'::ltc_m.actual_status | — | — |
| `notes` | `text` | sim | — | — | — |
| `created_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |
| `updated_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `row_version` | `bigint` | não | 1 | — | — |
| `project_id` | `uuid` | não | — | ltc_m.projects.id | — |
| `project_item_id` | `uuid` | sim | — | ltc_m.project_items.id | — |
| `metric_type` | `ltc_m.actual_financial_metric` | não | — | — | — |
| `competence_date` | `date` | não | — | — | — |
| `source_key` | `text` | não | — | — | — |
| `document_number` | `text` | sim | — | — | — |
| `installment_key` | `text` | sim | — | — | — |
| `amount` | `numeric(20,2)` | não | — | — | Precisão financeira PostgreSQL; sem conversão para float. |

## `ltc_m.financial_plan_lines`

- Tipo: `table`.
- Contrato proprietário: Core/P013.
- Propósito versionado: Linhas mensais para billing_planned ou receipt_forecast, sem mistura de grãos..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_financial_plan_lines_reference_p013`: UNIQUE (id, plan_version_id, project_id, project_item_id, metric_type, planning_level, competence_month, amount); `uq_financial_plan_lines_item_grain`: CREATE UNIQUE INDEX uq_financial_plan_lines_item_grain ON ltc_m.financial_plan_lines USING btree (plan_version_id, project_id, project_item_id, metric_type, competence_month) WHERE (planning_level = 'item'::ltc_m.planning_level); `uq_financial_plan_lines_project_grain`: CREATE UNIQUE INDEX uq_financial_plan_lines_project_grain ON ltc_m.financial_plan_lines USING btree (plan_version_id, project_id, metric_type, competence_month) WHERE (planning_level = 'project'::ltc_m.planning_level); `uq_financial_plan_lines_reference_p013`: CREATE UNIQUE INDEX uq_financial_plan_lines_reference_p013 ON ltc_m.financial_plan_lines USING btree (id, plan_version_id, project_id, project_item_id, metric_type, planning_level, competence_month, amount).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `notes` | `text` | sim | — | — | — |
| `created_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |
| `updated_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `row_version` | `bigint` | não | 1 | — | — |
| `plan_version_id` | `uuid` | não | — | ltc_m.financial_plan_scopes.plan_version_id | — |
| `project_id` | `uuid` | não | — | ltc_m.financial_plan_scopes.project_id | — |
| `project_item_id` | `uuid` | sim | — | ltc_m.project_items.id | — |
| `metric_type` | `ltc_m.planned_financial_metric` | não | — | ltc_m.financial_plan_scopes.metric_type | — |
| `planning_level` | `ltc_m.planning_level` | não | — | ltc_m.financial_plan_scopes.planning_level | — |
| `competence_month` | `date` | não | — | — | — |
| `amount` | `numeric(20,2)` | não | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `currency_code` | `text` | não | — | ltc_m.financial_plan_scopes.currency_code | — |

## `ltc_m.financial_plan_scopes`

- Tipo: `table`.
- Contrato proprietário: Core/P013.
- Propósito versionado: Fixa um único grão de planejamento por versão, projeto e métrica..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_financial_plan_scopes_business`: UNIQUE (plan_version_id, project_id, metric_type); `uq_financial_plan_scopes_reference`: UNIQUE (plan_version_id, project_id, metric_type, planning_level, currency_code); `uq_financial_plan_scopes_business`: CREATE UNIQUE INDEX uq_financial_plan_scopes_business ON ltc_m.financial_plan_scopes USING btree (plan_version_id, project_id, metric_type); `uq_financial_plan_scopes_reference`: CREATE UNIQUE INDEX uq_financial_plan_scopes_reference ON ltc_m.financial_plan_scopes USING btree (plan_version_id, project_id, metric_type, planning_level, currency_code).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `row_version` | `bigint` | não | 1 | — | — |
| `plan_version_id` | `uuid` | não | — | ltc_m.plan_versions.id | — |
| `project_id` | `uuid` | não | — | ltc_m.projects.id | — |
| `metric_type` | `ltc_m.planned_financial_metric` | não | — | — | — |
| `planning_level` | `ltc_m.planning_level` | não | — | — | — |
| `currency_code` | `text` | não | — | ltc_m.projects.base_currency | — |
| `created_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |
| `updated_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |

## `ltc_m.import_batch_sheets`

- Tipo: `table`.
- Contrato proprietário: P009.
- Propósito versionado: Abas operacionais detectadas por lote; Decisões Aprovadas permanece documental..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_import_batch_sheets_id_batch_p013`: UNIQUE (id, import_batch_id); `uq_import_batch_sheets_batch_key_p009`: CREATE UNIQUE INDEX uq_import_batch_sheets_batch_key_p009 ON ltc_m.import_batch_sheets USING btree (import_batch_id, sheet_key); `uq_import_batch_sheets_batch_name_p009`: CREATE UNIQUE INDEX uq_import_batch_sheets_batch_name_p009 ON ltc_m.import_batch_sheets USING btree (import_batch_id, sheet_name); `uq_import_batch_sheets_id_batch_p013`: CREATE UNIQUE INDEX uq_import_batch_sheets_id_batch_p013 ON ltc_m.import_batch_sheets USING btree (id, import_batch_id).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `staged_rows` | `integer` | não | 0 | — | — |
| `rejected_rows` | `integer` | não | 0 | — | — |
| `content_hash` | `text` | sim | — | — | — |
| `status` | `text` | não | 'detected'::text | — | — |
| `technical_message` | `text` | sim | — | — | — |
| `metadata` | `jsonb` | não | '{}'::jsonb | — | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `row_version` | `bigint` | não | 1 | — | — |
| `created_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |
| `import_batch_id` | `uuid` | não | — | ltc_m.import_batches.id | — |
| `updated_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `request_id` | `text` | sim | — | — | — |
| `sheet_key` | `text` | não | — | — | — |
| `sheet_name` | `text` | não | — | — | — |
| `sheet_index` | `integer` | não | — | — | — |
| `detected_range` | `text` | sim | — | — | — |
| `first_row` | `integer` | sim | — | — | — |
| `last_row` | `integer` | sim | — | — | — |
| `found_rows` | `integer` | não | 0 | — | — |

## `ltc_m.import_batches`

- Tipo: `table`.
- Contrato proprietário: Core/P009.
- Propósito versionado: Metadados de lotes de importação; esta migration não insere nem processa dados..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_import_batches_id_source_hash_p013`: UNIQUE (id, source_hash); `uq_import_batches_id_source_hash_p013`: CREATE UNIQUE INDEX uq_import_batches_id_source_hash_p013 ON ltc_m.import_batches USING btree (id, source_hash); `uq_import_batches_idempotency_key_p009`: CREATE UNIQUE INDEX uq_import_batches_idempotency_key_p009 ON ltc_m.import_batches USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `completed_at` | `timestamp with time zone` | sim | — | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `row_version` | `bigint` | não | 1 | — | — |
| `source_size_bytes` | `bigint` | sim | — | — | — |
| `source_mime_type` | `text` | sim | — | — | — |
| `payload_schema_version` | `integer` | não | 1 | — | — |
| `idempotency_key` | `text` | sim | — | — | — |
| `request_id` | `text` | sim | — | — | — |
| `started_at` | `timestamp with time zone` | sim | — | — | — |
| `source_name` | `text` | não | — | — | — |
| `sheet_count` | `integer` | não | 0 | — | — |
| `staged_rows` | `integer` | não | 0 | — | — |
| `valid_rows` | `integer` | não | 0 | — | — |
| `error_count` | `integer` | não | 0 | — | — |
| `technical_message` | `text` | sim | — | — | — |
| `metadata` | `jsonb` | não | '{}'::jsonb | — | — |
| `updated_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `source_hash` | `text` | sim | — | — | — |
| `reference_date` | `date` | sim | — | — | — |
| `status` | `ltc_m.import_status` | não | 'received'::ltc_m.import_status | — | — |
| `received_rows` | `integer` | não | 0 | — | — |
| `accepted_rows` | `integer` | não | 0 | — | — |
| `rejected_rows` | `integer` | não | 0 | — | — |
| `submitted_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |

## `ltc_m.import_row_errors`

- Tipo: `table`.
- Contrato proprietário: Core/P009.
- Propósito versionado: Metadados e erros de importação; retenção e sanitização de raw_payload permanecem pendentes..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Segurança: RLS=true; FORCE RLS=true; 2 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `bigint` | não | — | — | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `import_batch_sheet_id` | `uuid` | sim | — | ltc_m.import_batch_sheets.id | — |
| `import_staging_row_id` | `uuid` | sim | — | ltc_m.import_staging_rows.id | — |
| `severity` | `text` | não | 'error'::text | — | — |
| `field_path` | `text` | sim | — | — | — |
| `raw_value` | `jsonb` | sim | — | — | — |
| `technical_detail` | `text` | sim | — | — | — |
| `error_key` | `text` | sim | — | — | — |
| `request_id` | `text` | sim | — | — | — |
| `created_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `batch_id` | `uuid` | não | — | ltc_m.import_batches.id | — |
| `sheet_name` | `text` | sim | — | — | — |
| `source_row` | `integer` | sim | — | — | — |
| `entity_type` | `text` | sim | — | — | — |
| `natural_key` | `text` | sim | — | — | — |
| `error_code` | `text` | não | — | — | — |
| `error_message` | `text` | não | — | — | — |
| `raw_payload` | `jsonb` | sim | — | — | — |

## `ltc_m.import_staging_rows`

- Tipo: `table`.
- Contrato proprietário: P009.
- Propósito versionado: Linhas fÃ­sicas brutas do workbook; o payload Ã© produzido pelo P010 e nÃ£o Ã© interpretado no P009..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_import_staging_rows_id_sheet_p013`: UNIQUE (id, import_batch_sheet_id); `uq_import_staging_rows_id_sheet_p013`: CREATE UNIQUE INDEX uq_import_staging_rows_id_sheet_p013 ON ltc_m.import_staging_rows USING btree (id, import_batch_sheet_id); `uq_import_staging_rows_sheet_row_p009`: CREATE UNIQUE INDEX uq_import_staging_rows_sheet_row_p009 ON ltc_m.import_staging_rows USING btree (import_batch_sheet_id, source_row_number).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `validation_attempt` | `integer` | não | 0 | — | — |
| `target_table` | `text` | sim | — | — | — |
| `target_record_id` | `uuid` | sim | — | — | — |
| `validated_at` | `timestamp with time zone` | sim | — | — | — |
| `processed_at` | `timestamp with time zone` | sim | — | — | — |
| `last_error_code` | `text` | sim | — | — | — |
| `last_error_summary` | `text` | sim | — | — | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `row_version` | `bigint` | não | 1 | — | — |
| `import_batch_sheet_id` | `uuid` | não | — | ltc_m.import_batch_sheets.id | — |
| `created_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |
| `updated_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `request_id` | `text` | sim | — | — | — |
| `source_row_number` | `integer` | não | — | — | — |
| `source_range` | `text` | sim | — | — | — |
| `row_kind` | `text` | sim | — | — | — |
| `payload_schema_version` | `integer` | não | 1 | — | — |
| `raw_payload` | `jsonb` | não | — | — | — |
| `row_hash` | `text` | não | — | — | — |
| `status` | `text` | não | 'pending'::text | — | — |

## `ltc_m.monthly_plan_baselines`

- Tipo: `table`.
- Contrato proprietário: P013.
- Propósito versionado: Identidade idempotente do baseline mensal canônico por versão de plano e métrica..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_monthly_plan_baselines_business_p013`: UNIQUE (plan_version_id, metric_type); `uq_monthly_plan_baselines_reference_p013`: UNIQUE (id, semantic_fingerprint, plan_version_id, metric_type, planning_level); `uq_monthly_plan_baselines_business_p013`: CREATE UNIQUE INDEX uq_monthly_plan_baselines_business_p013 ON ltc_m.monthly_plan_baselines USING btree (plan_version_id, metric_type); `uq_monthly_plan_baselines_reference_p013`: CREATE UNIQUE INDEX uq_monthly_plan_baselines_reference_p013 ON ltc_m.monthly_plan_baselines USING btree (id, semantic_fingerprint, plan_version_id, metric_type, planning_level).
- Segurança: RLS=true; FORCE RLS=true; 2 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `plan_version_id` | `uuid` | não | — | ltc_m.plan_versions.id | — |
| `metric_type` | `ltc_m.planned_financial_metric` | não | — | — | — |
| `planning_level` | `ltc_m.planning_level` | não | — | — | — |
| `semantic_contract_version` | `text` | não | — | — | — |
| `semantic_fingerprint` | `text` | não | — | — | — |
| `created_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |

## `ltc_m.monthly_plan_cells`

- Tipo: `table`.
- Contrato proprietário: P013.
- Propósito versionado: Proveniência célula a célula, preservando blank, zero explícito e valor canônico arredondado..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_monthly_plan_cells_business_p013`: UNIQUE (baseline_id, project_item_id, competence_month); `uq_monthly_plan_cells_plan_line_p013`: UNIQUE (financial_plan_line_id); `uq_monthly_plan_cells_source_cell_p013`: UNIQUE (import_batch_sheet_id, source_cell_reference); `uq_monthly_plan_cells_business_p013`: CREATE UNIQUE INDEX uq_monthly_plan_cells_business_p013 ON ltc_m.monthly_plan_cells USING btree (baseline_id, project_item_id, competence_month); `uq_monthly_plan_cells_plan_line_p013`: CREATE UNIQUE INDEX uq_monthly_plan_cells_plan_line_p013 ON ltc_m.monthly_plan_cells USING btree (financial_plan_line_id); `uq_monthly_plan_cells_source_cell_p013`: CREATE UNIQUE INDEX uq_monthly_plan_cells_source_cell_p013 ON ltc_m.monthly_plan_cells USING btree (import_batch_sheet_id, source_cell_reference).
- Segurança: RLS=true; FORCE RLS=true; 2 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `metric_type` | `ltc_m.planned_financial_metric` | não | — | ltc_m.financial_plan_lines.metric_type | — |
| `planning_level` | `ltc_m.planning_level` | não | — | ltc_m.financial_plan_lines.planning_level | — |
| `competence_month` | `date` | não | — | ltc_m.financial_plan_lines.competence_month | — |
| `source_line_key` | `text` | não | — | — | — |
| `source_item_number` | `text` | não | — | — | — |
| `source_row_number` | `integer` | não | — | — | — |
| `source_column` | `text` | não | — | — | — |
| `source_cell_reference` | `text` | não | — | — | — |
| `declaration_state` | `text` | não | — | — | — |
| `source_numeric_text` | `text` | sim | — | — | — |
| `import_batch_id` | `uuid` | não | — | ltc_m.import_batch_sheets.import_batch_id | — |
| `source_value_hash` | `text` | sim | — | — | — |
| `canonical_amount` | `numeric(20,2)` | sim | — | ltc_m.financial_plan_lines.amount | Precisão financeira PostgreSQL; sem conversão para float. |
| `financial_plan_line_id` | `uuid` | sim | — | ltc_m.financial_plan_lines.id | — |
| `created_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `import_batch_sheet_id` | `uuid` | não | — | ltc_m.import_staging_rows.import_batch_sheet_id | — |
| `import_staging_row_id` | `uuid` | não | — | ltc_m.import_staging_rows.id | — |
| `baseline_id` | `uuid` | não | — | ltc_m.monthly_plan_import_executions.baseline_id | — |
| `baseline_semantic_fingerprint` | `text` | não | — | ltc_m.monthly_plan_import_executions.baseline_semantic_fingerprint | — |
| `plan_version_id` | `uuid` | não | — | ltc_m.financial_plan_lines.plan_version_id | — |
| `project_id` | `uuid` | não | — | ltc_m.project_items.project_id | — |
| `project_item_id` | `uuid` | não | — | ltc_m.project_items.id | — |

## `ltc_m.monthly_plan_import_executions`

- Tipo: `table`.
- Contrato proprietário: P013.
- Propósito versionado: Vínculo imutável entre recibo P009, artefato P013 e baseline mensal aplicado..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_monthly_executions_baseline_reference_p013`: UNIQUE (import_batch_id, baseline_id, baseline_semantic_fingerprint, plan_version_id, metric_type, planning_level); `uq_monthly_executions_batch_p013`: UNIQUE (import_batch_id); `uq_monthly_executions_baseline_reference_p013`: CREATE UNIQUE INDEX uq_monthly_executions_baseline_reference_p013 ON ltc_m.monthly_plan_import_executions USING btree (import_batch_id, baseline_id, baseline_semantic_fingerprint, plan_version_id, metric_type, planning_level); `uq_monthly_executions_batch_p013`: CREATE UNIQUE INDEX uq_monthly_executions_batch_p013 ON ltc_m.monthly_plan_import_executions USING btree (import_batch_id).
- Segurança: RLS=true; FORCE RLS=true; 2 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `created_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `import_batch_id` | `uuid` | não | — | ltc_m.import_batches.id | — |
| `source_artifact_id` | `uuid` | não | — | ltc_m.monthly_source_artifacts.id | — |
| `source_sha256` | `text` | não | — | ltc_m.import_batches.source_hash | — |
| `baseline_id` | `uuid` | não | — | ltc_m.monthly_plan_baselines.id | — |
| `baseline_semantic_fingerprint` | `text` | não | — | ltc_m.monthly_plan_baselines.semantic_fingerprint | — |
| `plan_version_id` | `uuid` | não | — | ltc_m.monthly_plan_baselines.plan_version_id | — |
| `metric_type` | `ltc_m.planned_financial_metric` | não | — | ltc_m.monthly_plan_baselines.metric_type | — |
| `planning_level` | `ltc_m.planning_level` | não | — | ltc_m.monthly_plan_baselines.planning_level | — |

## `ltc_m.monthly_source_artifacts`

- Tipo: `table`.
- Contrato proprietário: P013.
- Propósito versionado: Identidade imutável do XLSX e do conteúdo mensal aprovado pelo gate semântico P013..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_monthly_source_artifacts_reference_p013`: UNIQUE (id, source_sha256); `uq_monthly_source_artifacts_sha_p013`: UNIQUE (source_sha256); `uq_monthly_source_artifacts_reference_p013`: CREATE UNIQUE INDEX uq_monthly_source_artifacts_reference_p013 ON ltc_m.monthly_source_artifacts USING btree (id, source_sha256); `uq_monthly_source_artifacts_sha_p013`: CREATE UNIQUE INDEX uq_monthly_source_artifacts_sha_p013 ON ltc_m.monthly_source_artifacts USING btree (source_sha256).
- Segurança: RLS=true; FORCE RLS=true; 2 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `source_semantic_fingerprint` | `text` | não | — | — | — |
| `created_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `source_sha256` | `text` | não | — | — | — |
| `source_size_bytes` | `bigint` | não | — | — | — |
| `source_mime_type` | `text` | não | — | — | — |
| `source_name` | `text` | não | — | — | — |
| `source_contract_version` | `text` | não | — | — | — |
| `worksheet_key` | `text` | não | — | — | — |
| `worksheet_name` | `text` | não | — | — | — |
| `structural_range` | `text` | não | — | — | — |

## `ltc_m.plan_versions`

- Tipo: `table`.
- Contrato proprietário: Core/P013.
- Propósito versionado: Versões imutáveis de planejamento após aprovação ou bloqueio..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_plan_versions_name`: UNIQUE (name); `uq_plan_versions_name`: CREATE UNIQUE INDEX uq_plan_versions_name ON ltc_m.plan_versions USING btree (name); `uq_plan_versions_single_active_baseline`: CREATE UNIQUE INDEX uq_plan_versions_single_active_baseline ON ltc_m.plan_versions USING btree (is_baseline) WHERE ((is_baseline = true) AND (status <> 'archived'::ltc_m.plan_status)).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `row_version` | `bigint` | não | 1 | — | — |
| `updated_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `source_plan_version_id` | `uuid` | sim | — | ltc_m.plan_versions.id | Linhagem imutável da reabertura por clonagem; a origem permanece preservada. |
| `content_revision` | `bigint` | não | 1 | — | Revisão monotônica do conteúdo mensal editável; usada para concorrência de batches P029. |
| `name` | `text` | não | — | — | — |
| `reference_date` | `date` | não | — | — | — |
| `status` | `ltc_m.plan_status` | não | 'draft'::ltc_m.plan_status | — | — |
| `is_baseline` | `boolean` | não | false | — | — |
| `notes` | `text` | sim | — | — | — |
| `created_by_user_id` | `uuid` | não | — | ltc_m.app_users.id | — |
| `approved_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `approved_at` | `timestamp with time zone` | sim | — | — | — |

## `ltc_m.project_items`

- Tipo: `table`.
- Contrato proprietário: P012.
- Propósito versionado: Itens de projeto; item_code pode repetir e não integra sozinho uma chave de negócio..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_project_items_id_project`: UNIQUE (id, project_id); `uq_project_items_id_project`: CREATE UNIQUE INDEX uq_project_items_id_project ON ltc_m.project_items USING btree (id, project_id); `uq_project_items_line_number_active`: CREATE UNIQUE INDEX uq_project_items_line_number_active ON ltc_m.project_items USING btree (project_id, line_number) WHERE (deleted_at IS NULL); `uq_project_items_source_key_active`: CREATE UNIQUE INDEX uq_project_items_source_key_active ON ltc_m.project_items USING btree (project_id, source_line_key) WHERE (deleted_at IS NULL).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `unit_price` | `numeric(20,4)` | não | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `total_amount` | `numeric(20,2)` | sim | generated=s; round(quantity * unit_price, 2) | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `active` | `boolean` | não | true | — | — |
| `notes` | `text` | sim | — | — | — |
| `created_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `updated_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `deleted_at` | `timestamp with time zone` | sim | — | — | — |
| `row_version` | `bigint` | não | 1 | — | — |
| `project_id` | `uuid` | não | — | ltc_m.projects.id | — |
| `source_line_key` | `text` | não | — | — | — |
| `line_number` | `integer` | não | — | — | — |
| `item_code` | `text` | sim | — | — | — |
| `description` | `text` | sim | — | — | — |
| `quantity` | `numeric(20,4)` | não | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `unit_code` | `text` | não | — | ltc_m.units.code | — |
| `currency_code` | `text` | não | — | ltc_m.projects.base_currency | — |

## `ltc_m.projects`

- Tipo: `table`.
- Contrato proprietário: P011.
- Propósito versionado: Projetos LTC-M; contrato, saldo de abertura e custo orçado permanecem medidas distintas..
- Grão: uma linha por id.
- Chave primária/lógica: id.
- Identidades exclusivas adicionais: `uq_projects_id_currency`: UNIQUE (id, base_currency); `uq_projects_code_active`: CREATE UNIQUE INDEX uq_projects_code_active ON ltc_m.projects USING btree (upper(project_code)) WHERE (deleted_at IS NULL); `uq_projects_id_currency`: CREATE UNIQUE INDEX uq_projects_id_currency ON ltc_m.projects USING btree (id, base_currency).
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `id` | `uuid` | não | gen_random_uuid() | — | — |
| `opening_balance` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `budget_cost` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `start_date` | `date` | sim | — | — | — |
| `end_date` | `date` | sim | — | — | — |
| `manager_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `data_reference_date` | `date` | sim | — | — | — |
| `notes` | `text` | sim | — | — | — |
| `version` | `integer` | não | 1 | — | Versão otimista; o backend atualiza com WHERE id = ... AND version = expected_version. |
| `created_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `updated_by_user_id` | `uuid` | sim | — | ltc_m.app_users.id | — |
| `project_code` | `text` | não | — | — | — |
| `created_at` | `timestamp with time zone` | não | now() | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `deleted_at` | `timestamp with time zone` | sim | — | — | — |
| `legacy_import_batch_id` | `uuid` | sim | — | ltc_m.import_batches.id | Lote P009 que autoriza e preserva a linhagem da exceção legada de data de referência. |
| `project_name` | `text` | não | — | — | — |
| `client_id` | `uuid` | não | — | ltc_m.clients.id | — |
| `reporting_group` | `text` | sim | — | — | — |
| `classification` | `ltc_m.project_classification` | não | 'full_contract'::ltc_m.project_classification | — | — |
| `status` | `ltc_m.project_status` | não | 'draft'::ltc_m.project_status | — | — |
| `base_currency` | `text` | não | — | ltc_m.currencies.code | — |
| `contract_value` | `numeric(20,2)` | não | 0 | — | Precisão financeira PostgreSQL; sem conversão para float. |

## `ltc_m.units`

- Tipo: `table`.
- Contrato proprietário: P004/P005.
- Propósito versionado: Unidades de referência; nenhum significado pendente é inserido por esta migration..
- Grão: uma linha por code.
- Chave primária/lógica: code.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Segurança: RLS=true; FORCE RLS=true; 3 policies.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `code` | `text` | não | — | — | — |
| `name` | `text` | não | — | — | — |
| `category` | `text` | sim | — | — | — |
| `active` | `boolean` | não | true | — | — |
| `updated_at` | `timestamp with time zone` | não | now() | — | — |
| `row_version` | `bigint` | não | 1 | — | — |

## `ltc_m.v_tableau_data_quality`

- Tipo: `view`.
- Contrato proprietário: P016.
- Propósito versionado: P016/ltcm.p016.analytics.v1: uma linha por finding SQL verificável, com códigos P015 estáveis. É projeção read-only parcial; findings P014/P015 computados fora do banco não são persistidos nem fabricados por esta view..
- Grão: finding.
- Chave primária/lógica: finding_id.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Semântica analítica: moeda e versão/status explícitos; métricas somente aditivas dentro do grão; realizado ausente permanece NULL e a evidência P014 não é alocada.
- Segurança: options=security_barrier=true, security_invoker=true; SELECT respeita grants e RLS das tabelas-base.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `analytics_contract` | `text` | sim | — | — | — |
| `source_line_key` | `text` | sim | — | — | — |
| `competence_month` | `date` | sim | — | — | — |
| `currency_code` | `text` | sim | — | — | — |
| `expected_value` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `observed_value` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `delta` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `remediation_class` | `text` | sim | — | — | — |
| `decision_reference` | `text` | sim | — | — | — |
| `source_reference` | `text` | sim | — | — | — |
| `database_reference` | `text` | sim | — | — | — |
| `reconciliation_contract` | `text` | sim | — | — | — |
| `finding_origin` | `text` | sim | — | — | — |
| `finding_id` | `text` | sim | — | — | — |
| `finding_code` | `text` | sim | — | — | — |
| `severity` | `text` | sim | — | — | — |
| `domain` | `text` | sim | — | — | — |
| `project_id` | `uuid` | sim | — | — | — |
| `project_code` | `text` | sim | — | — | — |
| `project_item_id` | `uuid` | sim | — | — | — |

## `ltc_m.v_tableau_financial_monthly`

- Tipo: `view`.
- Contrato proprietário: P016.
- Propósito versionado: P016/ltcm.p016.analytics.v1: uma linha por fato persistido, identificada por fact_kind + financial_fact_id. Planned mantém versão e baseline; actual mantém status e data próprios. A união discriminada não converte evidência P014 incompatível em eventos..
- Grão: fato persistido planned/actual.
- Chave primária/lógica: analytical_fact_key.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Semântica analítica: moeda e versão/status explícitos; métricas somente aditivas dentro do grão; realizado ausente permanece NULL e a evidência P014 não é alocada.
- Segurança: options=security_barrier=true, security_invoker=true; SELECT respeita grants e RLS das tabelas-base.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `analytics_contract` | `text` | sim | — | — | — |
| `plan_version_name` | `text` | sim | — | — | — |
| `plan_status` | `text` | sim | — | — | — |
| `is_baseline` | `boolean` | sim | — | — | — |
| `competence_month` | `date` | sim | — | — | — |
| `competence_date` | `date` | sim | — | — | — |
| `metric_type` | `text` | sim | — | — | — |
| `financial_grain` | `text` | sim | — | — | — |
| `actual_status` | `text` | sim | — | — | — |
| `currency_code` | `text` | sim | — | — | — |
| `amount` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `fact_kind` | `text` | sim | — | — | — |
| `baseline_id` | `uuid` | sim | — | — | — |
| `baseline_semantic_fingerprint` | `text` | sim | — | — | — |
| `declaration_state` | `text` | sim | — | — | — |
| `source_cell_reference` | `text` | sim | — | — | — |
| `source_value_hash` | `text` | sim | — | — | — |
| `database_reference` | `text` | sim | — | — | — |
| `p014_derived` | `boolean` | sim | — | — | — |
| `analytical_fact_key` | `text` | sim | — | — | — |
| `financial_fact_id` | `uuid` | sim | — | — | — |
| `project_id` | `uuid` | sim | — | — | — |
| `project_code` | `text` | sim | — | — | — |
| `project_item_id` | `uuid` | sim | — | — | — |
| `source_line_key` | `text` | sim | — | — | — |
| `plan_version_id` | `uuid` | sim | — | — | — |

## `ltc_m.v_tableau_plan_versions`

- Tipo: `view`.
- Contrato proprietário: P016.
- Propósito versionado: P016/ltcm.p016.analytics.v1: uma linha por plan_version_id + financial_plan_scope_id (NO_SCOPE quando ausente). Baseline e contagens de fonte são pré-agregados para preservar o grão; nenhuma versão atual/ativa é inferida..
- Grão: versão + escopo (NO_SCOPE quando ausente).
- Chave primária/lógica: analytical_version_key.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Semântica analítica: moeda e versão/status explícitos; métricas somente aditivas dentro do grão; realizado ausente permanece NULL e a evidência P014 não é alocada.
- Segurança: options=security_barrier=true, security_invoker=true; SELECT respeita grants e RLS das tabelas-base.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `analytics_contract` | `text` | sim | — | — | — |
| `updated_at` | `timestamp with time zone` | sim | — | — | — |
| `approved_at` | `timestamp with time zone` | sim | — | — | — |
| `row_version` | `bigint` | sim | — | — | — |
| `financial_plan_scope_id` | `uuid` | sim | — | — | — |
| `project_id` | `uuid` | sim | — | — | — |
| `project_code` | `text` | sim | — | — | — |
| `metric_type` | `text` | sim | — | — | — |
| `planning_level` | `text` | sim | — | — | — |
| `currency_code` | `text` | sim | — | — | — |
| `baseline_id` | `uuid` | sim | — | — | — |
| `analytical_version_key` | `text` | sim | — | — | — |
| `baseline_contract` | `text` | sim | — | — | — |
| `baseline_semantic_fingerprint` | `text` | sim | — | — | — |
| `source_execution_count` | `bigint` | sim | — | — | — |
| `source_artifact_count` | `bigint` | sim | — | — | — |
| `current_version_supported` | `boolean` | sim | — | — | — |
| `current_version_status` | `text` | sim | — | — | — |
| `plan_version_id` | `uuid` | sim | — | — | — |
| `plan_version_name` | `text` | sim | — | — | — |
| `reference_date` | `date` | sim | — | — | — |
| `plan_status` | `text` | sim | — | — | — |
| `is_baseline` | `boolean` | sim | — | — | — |
| `source_plan_version_id` | `uuid` | sim | — | — | — |
| `created_at` | `timestamp with time zone` | sim | — | — | — |

## `ltc_m.v_tableau_portfolio_overview`

- Tipo: `view`.
- Contrato proprietário: P016.
- Propósito versionado: P016/ltcm.p016.analytics.v1: uma linha por moeda no snapshot visível; agregados de projetos, itens e realizados são pré-agregados separadamente para impedir fan-out. Valores canônicos de realizado e a faturar permanecem NULL enquanto as decisões correspondentes estiverem pendentes..
- Grão: moeda no snapshot visível.
- Chave primária/lógica: currency_code.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Semântica analítica: moeda e versão/status explícitos; métricas somente aditivas dentro do grão; realizado ausente permanece NULL e a evidência P014 não é alocada.
- Segurança: options=security_barrier=true, security_invoker=true; SELECT respeita grants e RLS das tabelas-base.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `analytics_contract` | `text` | sim | — | — | — |
| `billing_actual_draft_amount` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `billing_actual_posted_amount` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `billing_actual_cancelled_amount` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `billing_actual_canonical_amount` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `billing_actual_canonical_status` | `text` | sim | — | — | — |
| `billing_remaining_amount` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `billing_remaining_status` | `text` | sim | — | — | — |
| `currency_code` | `text` | sim | — | — | — |
| `project_count` | `bigint` | sim | — | — | — |
| `active_project_count` | `bigint` | sim | — | — | — |
| `contract_value_total` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `active_item_total` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `projects_without_items_count` | `bigint` | sim | — | — | — |
| `contract_item_delta_total` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `actual_event_count` | `bigint` | sim | — | — | — |

## `ltc_m.v_tableau_project_items`

- Tipo: `view`.
- Contrato proprietário: P016.
- Propósito versionado: P016/ltcm.p016.analytics.v1: uma linha por project_item_id; chave de negócio analítica project_id + source_line_key. item_code pode repetir e nunca é usado isoladamente para deduplicação..
- Grão: item persistido.
- Chave primária/lógica: project_item_id; negócio: project_id + source_line_key.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Semântica analítica: moeda e versão/status explícitos; métricas somente aditivas dentro do grão; realizado ausente permanece NULL e a evidência P014 não é alocada.
- Segurança: options=security_barrier=true, security_invoker=true; SELECT respeita grants e RLS das tabelas-base.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `analytics_contract` | `text` | sim | — | — | — |
| `quantity` | `numeric(20,4)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `unit_code` | `text` | sim | — | — | — |
| `currency_code` | `text` | sim | — | — | — |
| `unit_price` | `numeric(20,4)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `total_amount` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `active` | `boolean` | sim | — | — | — |
| `created_at` | `timestamp with time zone` | sim | — | — | — |
| `updated_at` | `timestamp with time zone` | sim | — | — | — |
| `row_version` | `bigint` | sim | — | — | — |
| `database_reference` | `text` | sim | — | — | — |
| `project_item_id` | `uuid` | sim | — | — | — |
| `project_id` | `uuid` | sim | — | — | — |
| `project_code` | `text` | sim | — | — | — |
| `client_id` | `uuid` | sim | — | — | — |
| `source_line_key` | `text` | sim | — | — | — |
| `line_number` | `integer` | sim | — | — | — |
| `item_code` | `text` | sim | — | — | — |
| `description` | `text` | sim | — | — | — |

## `ltc_m.v_tableau_project_overview`

- Tipo: `view`.
- Contrato proprietário: P016.
- Propósito versionado: P016/ltcm.p016.analytics.v1: uma linha por project_id visível. Totais de itens e eventos são pré-agregados em ramos independentes; ausência financeira permanece NULL e status de realizado não é escolhido implicitamente..
- Grão: projeto.
- Chave primária/lógica: project_id.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Semântica analítica: moeda e versão/status explícitos; métricas somente aditivas dentro do grão; realizado ausente permanece NULL e a evidência P014 não é alocada.
- Segurança: options=security_barrier=true, security_invoker=true; SELECT respeita grants e RLS das tabelas-base.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `analytics_contract` | `text` | sim | — | — | — |
| `currency_code` | `text` | sim | — | — | — |
| `contract_value` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `opening_balance` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `budget_cost` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `data_reference_date` | `date` | sim | — | — | — |
| `legacy_import_batch_id` | `uuid` | sim | — | — | — |
| `active_item_count` | `bigint` | sim | — | — | — |
| `active_item_total` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `contract_item_delta` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `project_reconciliation_status` | `text` | sim | — | — | — |
| `project_id` | `uuid` | sim | — | — | — |
| `actual_event_count` | `bigint` | sim | — | — | — |
| `actual_competence_count` | `bigint` | sim | — | — | — |
| `project_month_actual_available` | `boolean` | sim | — | — | — |
| `billing_actual_draft_amount` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `billing_actual_posted_amount` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `billing_actual_cancelled_amount` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `billing_actual_canonical_amount` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `billing_actual_canonical_status` | `text` | sim | — | — | — |
| `billing_remaining_amount` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `billing_remaining_status` | `text` | sim | — | — | — |
| `project_code` | `text` | sim | — | — | — |
| `project_name` | `text` | sim | — | — | — |
| `client_id` | `uuid` | sim | — | — | — |
| `client_display_name` | `text` | sim | — | — | — |
| `reporting_group` | `text` | sim | — | — | — |
| `project_classification` | `text` | sim | — | — | — |
| `project_status` | `text` | sim | — | — | — |

## `ltc_m.v_tableau_s_curve_portfolio`

- Tipo: `view`.
- Contrato proprietário: P016.
- Propósito versionado: P016/ltcm.p016.analytics.v1: uma linha por series_kind + versão/status + competência + métrica + moeda. Acumulados usam ROWS e partições compatíveis; valores de moedas, versões ou status diferentes nunca são somados..
- Grão: série + versão/status + competência + métrica + moeda.
- Chave primária/lógica: todas as dimensões do grão.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Semântica analítica: moeda e versão/status explícitos; métricas somente aditivas dentro do grão; realizado ausente permanece NULL e a evidência P014 não é alocada.
- Segurança: options=security_barrier=true, security_invoker=true; SELECT respeita grants e RLS das tabelas-base.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `analytics_contract` | `text` | sim | — | — | — |
| `currency_code` | `text` | sim | — | — | — |
| `monthly_amount` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `cumulative_amount` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `source_grain` | `text` | sim | — | — | — |
| `availability_status` | `text` | sim | — | — | — |
| `series_kind` | `text` | sim | — | — | — |
| `plan_version_id` | `uuid` | sim | — | — | — |
| `plan_version_name` | `text` | sim | — | — | — |
| `plan_status` | `text` | sim | — | — | — |
| `is_baseline` | `boolean` | sim | — | — | — |
| `actual_status` | `text` | sim | — | — | — |
| `competence_month` | `date` | sim | — | — | — |
| `metric_type` | `text` | sim | — | — | — |

## `ltc_m.v_tableau_s_curve_project`

- Tipo: `view`.
- Contrato proprietário: P016.
- Propósito versionado: P016/ltcm.p016.analytics.v1: uma linha por project + series_kind + versão/status + competência + métrica + moeda. Realizado por projeto/mês existe somente quando há financial_actual_events persistido; a evidência P014 não é distribuída nem convertida em zero..
- Grão: projeto + série + versão/status + competência + métrica + moeda.
- Chave primária/lógica: todas as dimensões do grão.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Semântica analítica: moeda e versão/status explícitos; métricas somente aditivas dentro do grão; realizado ausente permanece NULL e a evidência P014 não é alocada.
- Segurança: options=security_barrier=true, security_invoker=true; SELECT respeita grants e RLS das tabelas-base.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `analytics_contract` | `text` | sim | — | — | — |
| `competence_month` | `date` | sim | — | — | — |
| `metric_type` | `text` | sim | — | — | — |
| `currency_code` | `text` | sim | — | — | — |
| `monthly_amount` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `cumulative_amount` | `numeric` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `source_grain` | `text` | sim | — | — | — |
| `availability_status` | `text` | sim | — | — | — |
| `series_kind` | `text` | sim | — | — | — |
| `project_id` | `uuid` | sim | — | — | — |
| `project_code` | `text` | sim | — | — | — |
| `plan_version_id` | `uuid` | sim | — | — | — |
| `plan_version_name` | `text` | sim | — | — | — |
| `plan_status` | `text` | sim | — | — | — |
| `is_baseline` | `boolean` | sim | — | — | — |
| `actual_status` | `text` | sim | — | — | — |

## `ltc_m.v_tableau_source_provenance`

- Tipo: `view`.
- Contrato proprietário: P016.
- Propósito versionado: P016/ltcm.p016.analytics.v1: uma linha por monthly_plan_cell_id. Preserva blank, explicit_zero e value sem COALESCE; joins de proveniência são 1:1 por constraints P009/P013 e nunca entram em agregados financeiros..
- Grão: célula mensal.
- Chave primária/lógica: monthly_plan_cell_id.
- Identidades exclusivas adicionais: nenhuma além da chave primária.
- Semântica analítica: moeda e versão/status explícitos; métricas somente aditivas dentro do grão; realizado ausente permanece NULL e a evidência P014 não é alocada.
- Segurança: options=security_barrier=true, security_invoker=true; SELECT respeita grants e RLS das tabelas-base.

| Coluna | Tipo SQL | Nullable | Default/gerada | FK | Nota versionada |
| --- | --- | --- | --- | --- | --- |
| `analytics_contract` | `text` | sim | — | — | — |
| `metric_type` | `text` | sim | — | — | — |
| `planning_level` | `text` | sim | — | — | — |
| `competence_month` | `date` | sim | — | — | — |
| `declaration_state` | `text` | sim | — | — | — |
| `canonical_amount` | `numeric(20,2)` | sim | — | — | Precisão financeira PostgreSQL; sem conversão para float. |
| `financial_plan_line_id` | `uuid` | sim | — | — | — |
| `source_row_number` | `integer` | sim | — | — | — |
| `source_column` | `text` | sim | — | — | — |
| `source_cell_reference` | `text` | sim | — | — | — |
| `source_numeric_text` | `text` | sim | — | — | — |
| `monthly_plan_cell_id` | `uuid` | sim | — | — | — |
| `source_value_hash` | `text` | sim | — | — | — |
| `import_batch_id` | `uuid` | sim | — | — | — |
| `import_batch_sheet_id` | `uuid` | sim | — | — | — |
| `import_staging_row_id` | `uuid` | sim | — | — | — |
| `sheet_key` | `text` | sim | — | — | — |
| `sheet_name` | `text` | sim | — | — | — |
| `source_range` | `text` | sim | — | — | — |
| `baseline_contract` | `text` | sim | — | — | — |
| `source_artifact_id` | `uuid` | sim | — | — | — |
| `source_name` | `text` | sim | — | — | — |
| `baseline_id` | `uuid` | sim | — | — | — |
| `source_sha256` | `text` | sim | — | — | — |
| `source_semantic_fingerprint` | `text` | sim | — | — | — |
| `import_idempotency_key` | `text` | sim | — | — | — |
| `baseline_semantic_fingerprint` | `text` | sim | — | — | — |
| `plan_version_id` | `uuid` | sim | — | — | — |
| `project_id` | `uuid` | sim | — | — | — |
| `project_code` | `text` | sim | — | — | — |
| `project_item_id` | `uuid` | sim | — | — | — |
| `source_line_key` | `text` | sim | — | — | — |
