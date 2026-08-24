begin;

alter table ltc_m.import_batches
    add constraint uq_import_batches_id_source_hash_p013
        unique (id, source_hash);

alter table ltc_m.import_batch_sheets
    add constraint uq_import_batch_sheets_id_batch_p013
        unique (id, import_batch_id);

alter table ltc_m.import_staging_rows
    add constraint uq_import_staging_rows_id_sheet_p013
        unique (id, import_batch_sheet_id);

alter table ltc_m.financial_plan_lines
    add constraint uq_financial_plan_lines_reference_p013
        unique (
            id,
            plan_version_id,
            project_id,
            project_item_id,
            metric_type,
            planning_level,
            competence_month,
            amount
        );

create table ltc_m.monthly_source_artifacts (
    id uuid primary key default gen_random_uuid(),
    source_sha256 text not null,
    source_size_bytes bigint not null,
    source_mime_type text not null,
    source_name text not null,
    source_contract_version text not null,
    worksheet_key text not null,
    worksheet_name text not null,
    structural_range text not null,
    source_semantic_fingerprint text not null,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    constraint uq_monthly_source_artifacts_sha_p013
        unique (source_sha256),
    constraint uq_monthly_source_artifacts_reference_p013
        unique (id, source_sha256),
    constraint ck_monthly_source_artifacts_hashes_p013
        check (
            source_sha256 ~ '^[0-9a-f]{64}$'
            and source_semantic_fingerprint ~ '^[0-9a-f]{64}$'
        ),
    constraint ck_monthly_source_artifacts_size_p013
        check (source_size_bytes > 0),
    constraint ck_monthly_source_artifacts_mime_p013
        check (
            source_mime_type
            = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ),
    constraint ck_monthly_source_artifacts_name_p013
        check (
            source_name = btrim(source_name)
            and source_name <> ''
            and source_name !~ '[\\/]'
        ),
    constraint ck_monthly_source_artifacts_contract_p013
        check (
            source_contract_version = 'ltcm.p013.source-artifact.v1'
            and worksheet_key = 'monthly_revenue'
            and worksheet_name = 'Prev. Receita Mensal'
            and structural_range = 'A1:T52'
        )
);

comment on table ltc_m.monthly_source_artifacts is
    'Identidade imutável do XLSX e do conteúdo mensal aprovado pelo gate semântico P013.';

create table ltc_m.monthly_plan_baselines (
    id uuid primary key default gen_random_uuid(),
    plan_version_id uuid not null references ltc_m.plan_versions (id),
    metric_type ltc_m.planned_financial_metric not null,
    planning_level ltc_m.planning_level not null,
    semantic_contract_version text not null,
    semantic_fingerprint text not null,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    constraint uq_monthly_plan_baselines_business_p013
        unique (plan_version_id, metric_type),
    constraint uq_monthly_plan_baselines_reference_p013
        unique (
            id,
            semantic_fingerprint,
            plan_version_id,
            metric_type,
            planning_level
        ),
    constraint ck_monthly_plan_baselines_contract_p013
        check (
            metric_type = 'billing_planned'
            and planning_level = 'item'
            and semantic_contract_version
                = 'ltcm.p013.monthly-baseline-semantic.v1'
            and semantic_fingerprint ~ '^[0-9a-f]{64}$'
        )
);

comment on table ltc_m.monthly_plan_baselines is
    'Identidade idempotente do baseline mensal canônico por versão de plano e métrica.';

create table ltc_m.monthly_plan_import_executions (
    id uuid primary key default gen_random_uuid(),
    import_batch_id uuid not null,
    source_artifact_id uuid not null,
    source_sha256 text not null,
    baseline_id uuid not null,
    baseline_semantic_fingerprint text not null,
    plan_version_id uuid not null,
    metric_type ltc_m.planned_financial_metric not null,
    planning_level ltc_m.planning_level not null,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    constraint fk_monthly_executions_batch_hash_p013
        foreign key (import_batch_id, source_sha256)
        references ltc_m.import_batches (id, source_hash),
    constraint fk_monthly_executions_artifact_p013
        foreign key (source_artifact_id, source_sha256)
        references ltc_m.monthly_source_artifacts (id, source_sha256),
    constraint fk_monthly_executions_baseline_p013
        foreign key (
            baseline_id,
            baseline_semantic_fingerprint,
            plan_version_id,
            metric_type,
            planning_level
        )
        references ltc_m.monthly_plan_baselines (
            id,
            semantic_fingerprint,
            plan_version_id,
            metric_type,
            planning_level
        ),
    constraint uq_monthly_executions_batch_p013
        unique (import_batch_id),
    constraint uq_monthly_executions_baseline_reference_p013
        unique (
            import_batch_id,
            baseline_id,
            baseline_semantic_fingerprint,
            plan_version_id,
            metric_type,
            planning_level
        ),
    constraint ck_monthly_executions_contract_p013
        check (
            source_sha256 ~ '^[0-9a-f]{64}$'
            and baseline_semantic_fingerprint ~ '^[0-9a-f]{64}$'
            and metric_type = 'billing_planned'
            and planning_level = 'item'
        )
);

comment on table ltc_m.monthly_plan_import_executions is
    'Vínculo imutável entre recibo P009, artefato P013 e baseline mensal aplicado.';

create table ltc_m.monthly_plan_cells (
    id uuid primary key default gen_random_uuid(),
    import_batch_id uuid not null,
    import_batch_sheet_id uuid not null,
    import_staging_row_id uuid not null,
    baseline_id uuid not null,
    baseline_semantic_fingerprint text not null,
    plan_version_id uuid not null,
    project_id uuid not null,
    project_item_id uuid not null,
    metric_type ltc_m.planned_financial_metric not null,
    planning_level ltc_m.planning_level not null,
    competence_month date not null,
    source_line_key text not null,
    source_item_number text not null,
    source_row_number integer not null,
    source_column text not null,
    source_cell_reference text not null,
    declaration_state text not null,
    source_numeric_text text,
    source_value_hash text,
    canonical_amount numeric(20, 2),
    financial_plan_line_id uuid,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    constraint fk_monthly_plan_cells_execution_p013
        foreign key (
            import_batch_id,
            baseline_id,
            baseline_semantic_fingerprint,
            plan_version_id,
            metric_type,
            planning_level
        )
        references ltc_m.monthly_plan_import_executions (
            import_batch_id,
            baseline_id,
            baseline_semantic_fingerprint,
            plan_version_id,
            metric_type,
            planning_level
        ),
    constraint fk_monthly_plan_cells_sheet_p013
        foreign key (import_batch_sheet_id, import_batch_id)
        references ltc_m.import_batch_sheets (id, import_batch_id),
    constraint fk_monthly_plan_cells_staging_row_p013
        foreign key (import_staging_row_id, import_batch_sheet_id)
        references ltc_m.import_staging_rows (id, import_batch_sheet_id),
    constraint fk_monthly_plan_cells_project_item_p013
        foreign key (project_item_id, project_id)
        references ltc_m.project_items (id, project_id),
    constraint fk_monthly_plan_cells_plan_line_p013
        foreign key (
            financial_plan_line_id,
            plan_version_id,
            project_id,
            project_item_id,
            metric_type,
            planning_level,
            competence_month,
            canonical_amount
        )
        references ltc_m.financial_plan_lines (
            id,
            plan_version_id,
            project_id,
            project_item_id,
            metric_type,
            planning_level,
            competence_month,
            amount
        ),
    constraint uq_monthly_plan_cells_business_p013
        unique (baseline_id, project_item_id, competence_month),
    constraint uq_monthly_plan_cells_source_cell_p013
        unique (import_batch_sheet_id, source_cell_reference),
    constraint uq_monthly_plan_cells_plan_line_p013
        unique (financial_plan_line_id),
    constraint ck_monthly_plan_cells_contract_p013
        check (
            metric_type = 'billing_planned'
            and planning_level = 'item'
            and baseline_semantic_fingerprint ~ '^[0-9a-f]{64}$'
            and competence_month = date_trunc('month', competence_month)::date
            and source_line_key ~ '^p012-item-v1:[0-9a-f]{64}$'
            and source_item_number = btrim(source_item_number)
            and source_item_number <> ''
            and source_row_number between 4 and 51
            and source_column in ('K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S')
            and source_cell_reference = source_column || source_row_number::text
            and declaration_state in ('blank', 'explicit_zero', 'value')
            and (source_value_hash is null or source_value_hash ~ '^[0-9a-f]{64}$')
            and (
                source_numeric_text is null
                or source_numeric_text ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,14})?$'
            )
            and (
                (
                    declaration_state = 'blank'
                    and source_numeric_text is null
                    and source_value_hash is null
                    and canonical_amount is null
                    and financial_plan_line_id is null
                )
                or (
                    declaration_state = 'explicit_zero'
                    and source_numeric_text is not null
                    and source_value_hash is not null
                    and source_numeric_text::numeric = 0
                    and canonical_amount = 0
                    and financial_plan_line_id is not null
                )
                or (
                    declaration_state = 'value'
                    and source_numeric_text is not null
                    and source_value_hash is not null
                    and source_numeric_text::numeric > 0
                    and canonical_amount = round(source_numeric_text::numeric, 2)
                    and financial_plan_line_id is not null
                )
            )
        )
);

comment on table ltc_m.monthly_plan_cells is
    'Proveniência célula a célula, preservando blank, zero explícito e valor canônico arredondado.';

create index ix_monthly_source_artifacts_semantic_p013
    on ltc_m.monthly_source_artifacts (source_semantic_fingerprint);

create index ix_monthly_plan_baselines_semantic_p013
    on ltc_m.monthly_plan_baselines (semantic_fingerprint);

create index ix_monthly_executions_artifact_p013
    on ltc_m.monthly_plan_import_executions (source_artifact_id);

create index ix_monthly_plan_cells_item_month_p013
    on ltc_m.monthly_plan_cells (project_item_id, competence_month);

create index ix_monthly_plan_cells_staging_p013
    on ltc_m.monthly_plan_cells (import_staging_row_id);

create trigger trg_00_monthly_source_artifacts_no_delete
before delete on ltc_m.monthly_source_artifacts
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_monthly_source_artifacts_append_only
before update on ltc_m.monthly_source_artifacts
for each row execute function ltc_m.prevent_append_only_change();

create trigger trg_00_monthly_plan_baselines_no_delete
before delete on ltc_m.monthly_plan_baselines
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_monthly_plan_baselines_append_only
before update on ltc_m.monthly_plan_baselines
for each row execute function ltc_m.prevent_append_only_change();

create trigger trg_00_monthly_executions_no_delete
before delete on ltc_m.monthly_plan_import_executions
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_monthly_executions_append_only
before update on ltc_m.monthly_plan_import_executions
for each row execute function ltc_m.prevent_append_only_change();

create trigger trg_00_monthly_plan_cells_no_delete
before delete on ltc_m.monthly_plan_cells
for each row execute function ltc_m.prevent_physical_delete();

create trigger trg_00_monthly_plan_cells_append_only
before update on ltc_m.monthly_plan_cells
for each row execute function ltc_m.prevent_append_only_change();

create trigger trg_90_monthly_source_artifacts_audit
after insert on ltc_m.monthly_source_artifacts
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_monthly_plan_baselines_audit
after insert on ltc_m.monthly_plan_baselines
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_monthly_executions_audit
after insert on ltc_m.monthly_plan_import_executions
for each row execute function ltc_m.audit_row_change();

create trigger trg_90_monthly_plan_cells_audit
after insert on ltc_m.monthly_plan_cells
for each row execute function ltc_m.audit_row_change();

alter table ltc_m.monthly_source_artifacts enable row level security;
alter table ltc_m.monthly_source_artifacts force row level security;
alter table ltc_m.monthly_plan_baselines enable row level security;
alter table ltc_m.monthly_plan_baselines force row level security;
alter table ltc_m.monthly_plan_import_executions enable row level security;
alter table ltc_m.monthly_plan_import_executions force row level security;
alter table ltc_m.monthly_plan_cells enable row level security;
alter table ltc_m.monthly_plan_cells force row level security;

create policy monthly_source_artifacts_select_p013
on ltc_m.monthly_source_artifacts
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy monthly_source_artifacts_insert_p013
on ltc_m.monthly_source_artifacts
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role in ('editor', 'admin')
            and authorization_context.app_user_id = created_by_user_id
    )
);

create policy monthly_plan_baselines_select_p013
on ltc_m.monthly_plan_baselines
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role in ('editor', 'admin')
            or (
                authorization_context.app_role = 'viewer'
                and exists (
                    select 1
                    from ltc_m.plan_versions
                    where
                        plan_versions.id = plan_version_id
                        and plan_versions.status in ('approved', 'locked')
                )
            )
    )
);

create policy monthly_plan_baselines_insert_p013
on ltc_m.monthly_plan_baselines
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role in ('editor', 'admin')
            and authorization_context.app_user_id = created_by_user_id
    )
    and exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = plan_version_id
            and plan_versions.status = 'draft'
            and plan_versions.is_baseline
    )
);

create policy monthly_executions_select_p013
on ltc_m.monthly_plan_import_executions
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where authorization_context.app_role in ('editor', 'admin')
    )
);

create policy monthly_executions_insert_p013
on ltc_m.monthly_plan_import_executions
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role in ('editor', 'admin')
            and authorization_context.app_user_id = created_by_user_id
    )
    and exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = plan_version_id
            and plan_versions.status = 'draft'
            and plan_versions.is_baseline
    )
);

create policy monthly_plan_cells_select_p013
on ltc_m.monthly_plan_cells
for select
to ltc_m_runtime
using (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role in ('editor', 'admin')
            or (
                authorization_context.app_role = 'viewer'
                and exists (
                    select 1
                    from ltc_m.plan_versions
                    where
                        plan_versions.id = plan_version_id
                        and plan_versions.status in ('approved', 'locked')
                )
            )
    )
);

create policy monthly_plan_cells_insert_p013
on ltc_m.monthly_plan_cells
for insert
to ltc_m_runtime
with check (
    exists (
        select 1
        from ltc_m.authorization_context()
        where
            authorization_context.app_role in ('editor', 'admin')
            and authorization_context.app_user_id = created_by_user_id
    )
    and exists (
        select 1
        from ltc_m.plan_versions
        where
            plan_versions.id = plan_version_id
            and plan_versions.status = 'draft'
            and plan_versions.is_baseline
    )
);

revoke all privileges on table
    ltc_m.monthly_source_artifacts,
    ltc_m.monthly_plan_baselines,
    ltc_m.monthly_plan_import_executions,
    ltc_m.monthly_plan_cells
from public;

grant select, insert on table
    ltc_m.monthly_source_artifacts,
    ltc_m.monthly_plan_baselines,
    ltc_m.monthly_plan_import_executions,
    ltc_m.monthly_plan_cells
to ltc_m_runtime;

commit;
