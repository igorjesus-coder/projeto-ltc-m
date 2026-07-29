begin;

create schema ltc_m;

comment on schema ltc_m is
    'Objetos de domínio do LTC-M; isolados do sistema preexistente no banco compartilhado.';

create type ltc_m.app_role as enum ('viewer', 'editor', 'admin');

create type ltc_m.project_status as enum (
    'draft',
    'active',
    'on_hold',
    'completed',
    'cancelled'
);

create type ltc_m.project_classification as enum (
    'full_contract',
    'demand',
    'opening_balance'
);

create type ltc_m.plan_status as enum (
    'draft',
    'approved',
    'locked',
    'archived'
);

create type ltc_m.planning_level as enum ('project', 'item');

create type ltc_m.planned_financial_metric as enum (
    'billing_planned',
    'receipt_forecast'
);

create type ltc_m.actual_financial_metric as enum (
    'billing_actual',
    'receipt_actual'
);

create type ltc_m.actual_status as enum ('draft', 'posted', 'cancelled');

create type ltc_m.import_status as enum (
    'received',
    'validating',
    'rejected',
    'loaded'
);

create type ltc_m.audit_operation as enum (
    'INSERT',
    'UPDATE',
    'SOFT_DELETE',
    'RESTORE',
    'APPROVE',
    'LOCK',
    'REOPEN',
    'CANCEL'
);

create table ltc_m.app_users (
    id uuid primary key default gen_random_uuid(),
    auth_subject text not null,
    email text,
    full_name text not null,
    role ltc_m.app_role not null default 'viewer',
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_app_users_auth_subject unique (auth_subject),
    constraint ck_app_users_auth_subject_not_blank
        check (auth_subject = btrim(auth_subject) and auth_subject <> ''),
    constraint ck_app_users_email_not_blank
        check (email is null or btrim(email) <> ''),
    constraint ck_app_users_full_name_not_blank
        check (btrim(full_name) <> '')
);

comment on table ltc_m.app_users is
    'Usuários internos e autorização do LTC-M; auth_subject corresponde ao claim sub do Auth0.';

create table ltc_m.currencies (
    code text primary key,
    name text not null,
    decimal_places smallint not null default 2,
    active boolean not null default true,
    constraint ck_currencies_code
        check (code = upper(code) and code ~ '^[A-Z]{3}$'),
    constraint ck_currencies_name_not_blank
        check (btrim(name) <> ''),
    constraint ck_currencies_decimal_places
        check (decimal_places between 0 and 6)
);

comment on table ltc_m.currencies is
    'Moedas aceitas pelo domínio; cada projeto possui exatamente uma moeda-base.';

create table ltc_m.units (
    code text primary key,
    name text not null,
    category text,
    active boolean not null default true,
    constraint ck_units_code
        check (code = upper(btrim(code)) and code <> ''),
    constraint ck_units_name_not_blank
        check (btrim(name) <> ''),
    constraint ck_units_category_not_blank
        check (category is null or btrim(category) <> '')
);

comment on table ltc_m.units is
    'Unidades de referência; nenhum significado pendente é inserido por esta migration.';

create table ltc_m.clients (
    id uuid primary key default gen_random_uuid(),
    legal_name text not null,
    display_name text not null,
    tax_id text,
    active boolean not null default true,
    created_by_user_id uuid references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    constraint ck_clients_legal_name_not_blank
        check (btrim(legal_name) <> ''),
    constraint ck_clients_display_name_not_blank
        check (btrim(display_name) <> ''),
    constraint ck_clients_tax_id_not_blank
        check (tax_id is null or btrim(tax_id) <> '')
);

comment on table ltc_m.clients is
    'Cadastro normalizado de clientes do LTC-M.';

create unique index uq_clients_tax_id_active
    on ltc_m.clients (tax_id)
    where tax_id is not null and deleted_at is null;

create table ltc_m.projects (
    id uuid primary key default gen_random_uuid(),
    project_code text not null,
    project_name text not null,
    client_id uuid not null references ltc_m.clients (id),
    reporting_group text,
    classification ltc_m.project_classification not null default 'full_contract',
    status ltc_m.project_status not null default 'draft',
    base_currency text not null references ltc_m.currencies (code),
    contract_value numeric(20, 2) not null default 0,
    opening_balance numeric(20, 2),
    budget_cost numeric(20, 2),
    start_date date,
    end_date date,
    manager_user_id uuid references ltc_m.app_users (id),
    data_reference_date date not null,
    notes text,
    version integer not null default 1,
    created_by_user_id uuid references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    constraint uq_projects_id_currency unique (id, base_currency),
    constraint ck_projects_code_normalized
        check (project_code = btrim(project_code) and project_code <> ''),
    constraint ck_projects_name_not_blank
        check (btrim(project_name) <> ''),
    constraint ck_projects_reporting_group_not_blank
        check (reporting_group is null or btrim(reporting_group) <> ''),
    constraint ck_projects_contract_value
        check (contract_value >= 0),
    constraint ck_projects_opening_balance
        check (opening_balance is null or opening_balance >= 0),
    constraint ck_projects_budget_cost
        check (budget_cost is null or budget_cost >= 0),
    constraint ck_projects_dates
        check (
            end_date is null
            or start_date is null
            or end_date >= start_date
        ),
    constraint ck_projects_version
        check (version > 0)
);

comment on table ltc_m.projects is
    'Projetos LTC-M; contrato, saldo de abertura e custo orçado permanecem medidas distintas.';

create unique index uq_projects_code_active
    on ltc_m.projects (upper(project_code))
    where deleted_at is null;

create index ix_projects_client
    on ltc_m.projects (client_id)
    where deleted_at is null;

create table ltc_m.project_items (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null,
    source_line_key text not null,
    line_number integer not null,
    item_code text,
    description text,
    quantity numeric(20, 4) not null,
    unit_code text not null references ltc_m.units (code),
    currency_code text not null,
    unit_price numeric(20, 4) not null,
    total_amount numeric(20, 2)
        generated always as (round(quantity * unit_price, 2)) stored,
    active boolean not null default true,
    notes text,
    created_by_user_id uuid references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz,
    constraint uq_project_items_id_project unique (id, project_id),
    constraint fk_project_items_project_currency
        foreign key (project_id, currency_code)
        references ltc_m.projects (id, base_currency),
    constraint ck_project_items_source_key
        check (
            source_line_key = btrim(source_line_key)
            and source_line_key <> ''
        ),
    constraint ck_project_items_line_number
        check (line_number > 0),
    constraint ck_project_items_item_code
        check (
            item_code is null
            or (item_code = btrim(item_code) and item_code <> '')
        ),
    constraint ck_project_items_description
        check (description is null or btrim(description) <> ''),
    constraint ck_project_items_quantity
        check (quantity > 0),
    constraint ck_project_items_unit_price
        check (unit_price >= 0)
);

comment on table ltc_m.project_items is
    'Itens de projeto; item_code pode repetir e não integra sozinho uma chave de negócio.';

create unique index uq_project_items_source_key_active
    on ltc_m.project_items (project_id, source_line_key)
    where deleted_at is null;

create unique index uq_project_items_line_number_active
    on ltc_m.project_items (project_id, line_number)
    where deleted_at is null;

create index ix_project_items_project
    on ltc_m.project_items (project_id)
    where deleted_at is null;

create index ix_project_items_code
    on ltc_m.project_items (item_code)
    where item_code is not null and deleted_at is null;

create table ltc_m.plan_versions (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    reference_date date not null,
    status ltc_m.plan_status not null default 'draft',
    is_baseline boolean not null default false,
    notes text,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    approved_by_user_id uuid references ltc_m.app_users (id),
    approved_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint uq_plan_versions_name unique (name),
    constraint ck_plan_versions_name_not_blank
        check (btrim(name) <> ''),
    constraint ck_plan_versions_approval
        check (
            (
                status = 'draft'
                and approved_by_user_id is null
                and approved_at is null
            )
            or (
                status in ('approved', 'locked')
                and approved_by_user_id is not null
                and approved_at is not null
            )
            or status = 'archived'
        )
);

comment on table ltc_m.plan_versions is
    'Versões imutáveis de planejamento após aprovação ou bloqueio.';

create unique index uq_plan_versions_single_active_baseline
    on ltc_m.plan_versions (is_baseline)
    where is_baseline = true and status <> 'archived';

create table ltc_m.financial_plan_scopes (
    id uuid primary key default gen_random_uuid(),
    plan_version_id uuid not null references ltc_m.plan_versions (id),
    project_id uuid not null,
    metric_type ltc_m.planned_financial_metric not null,
    planning_level ltc_m.planning_level not null,
    currency_code text not null,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fk_financial_plan_scopes_project_currency
        foreign key (project_id, currency_code)
        references ltc_m.projects (id, base_currency),
    constraint uq_financial_plan_scopes_business
        unique (plan_version_id, project_id, metric_type),
    constraint uq_financial_plan_scopes_reference
        unique (
            plan_version_id,
            project_id,
            metric_type,
            planning_level,
            currency_code
        )
);

comment on table ltc_m.financial_plan_scopes is
    'Fixa um único grão de planejamento por versão, projeto e métrica.';

create table ltc_m.financial_plan_lines (
    id uuid primary key default gen_random_uuid(),
    plan_version_id uuid not null,
    project_id uuid not null,
    project_item_id uuid,
    metric_type ltc_m.planned_financial_metric not null,
    planning_level ltc_m.planning_level not null,
    competence_month date not null,
    amount numeric(20, 2) not null,
    currency_code text not null,
    notes text,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fk_financial_plan_lines_scope
        foreign key (
            plan_version_id,
            project_id,
            metric_type,
            planning_level,
            currency_code
        )
        references ltc_m.financial_plan_scopes (
            plan_version_id,
            project_id,
            metric_type,
            planning_level,
            currency_code
        ),
    constraint fk_financial_plan_lines_item
        foreign key (project_item_id, project_id)
        references ltc_m.project_items (id, project_id),
    constraint ck_financial_plan_lines_grain
        check (
            (
                planning_level = 'project'
                and project_item_id is null
            )
            or (
                planning_level = 'item'
                and project_item_id is not null
            )
        ),
    constraint ck_financial_plan_lines_month_start
        check (
            competence_month
            = date_trunc('month', competence_month)::date
        ),
    constraint ck_financial_plan_lines_amount
        check (amount >= 0)
);

comment on table ltc_m.financial_plan_lines is
    'Linhas mensais para billing_planned ou receipt_forecast, sem mistura de grãos.';

create unique index uq_financial_plan_lines_project_grain
    on ltc_m.financial_plan_lines (
        plan_version_id,
        project_id,
        metric_type,
        competence_month
    )
    where planning_level = 'project';

create unique index uq_financial_plan_lines_item_grain
    on ltc_m.financial_plan_lines (
        plan_version_id,
        project_id,
        project_item_id,
        metric_type,
        competence_month
    )
    where planning_level = 'item';

create index ix_financial_plan_lines_project_month
    on ltc_m.financial_plan_lines (project_id, competence_month);

create table ltc_m.financial_actual_events (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null,
    project_item_id uuid,
    metric_type ltc_m.actual_financial_metric not null,
    competence_date date not null,
    source_key text not null,
    document_number text,
    installment_key text,
    amount numeric(20, 2) not null,
    currency_code text not null,
    status ltc_m.actual_status not null default 'draft',
    notes text,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint fk_financial_actual_project_currency
        foreign key (project_id, currency_code)
        references ltc_m.projects (id, base_currency),
    constraint fk_financial_actual_item
        foreign key (project_item_id, project_id)
        references ltc_m.project_items (id, project_id),
    constraint uq_financial_actual_source
        unique (project_id, source_key),
    constraint ck_financial_actual_source_key
        check (source_key = btrim(source_key) and source_key <> ''),
    constraint ck_financial_actual_document_number
        check (document_number is null or btrim(document_number) <> ''),
    constraint ck_financial_actual_installment_key
        check (installment_key is null or btrim(installment_key) <> ''),
    constraint ck_financial_actual_amount
        check (amount >= 0)
);

comment on table ltc_m.financial_actual_events is
    'Eventos de billing_actual e receipt_actual, com chave de origem idempotente por projeto.';

create index ix_financial_actual_project_date
    on ltc_m.financial_actual_events (project_id, competence_date);

create table ltc_m.import_batches (
    id uuid primary key default gen_random_uuid(),
    source_name text not null,
    source_hash text,
    reference_date date,
    status ltc_m.import_status not null default 'received',
    received_rows integer not null default 0,
    accepted_rows integer not null default 0,
    rejected_rows integer not null default 0,
    submitted_by_user_id uuid not null references ltc_m.app_users (id),
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    constraint ck_import_batches_source_name
        check (btrim(source_name) <> ''),
    constraint ck_import_batches_source_hash
        check (source_hash is null or btrim(source_hash) <> ''),
    constraint ck_import_batches_row_counts
        check (
            received_rows >= 0
            and accepted_rows >= 0
            and rejected_rows >= 0
            and accepted_rows + rejected_rows <= received_rows
        ),
    constraint ck_import_batches_completed_at
        check (completed_at is null or completed_at >= created_at)
);

comment on table ltc_m.import_batches is
    'Metadados de lotes de importação; esta migration não insere nem processa dados.';

create unique index uq_import_batches_hash
    on ltc_m.import_batches (source_hash)
    where source_hash is not null;

create table ltc_m.import_row_errors (
    id bigint generated always as identity primary key,
    batch_id uuid not null references ltc_m.import_batches (id),
    sheet_name text,
    source_row integer,
    entity_type text,
    natural_key text,
    error_code text not null,
    error_message text not null,
    raw_payload jsonb,
    created_at timestamptz not null default now(),
    constraint ck_import_row_errors_source_row
        check (source_row is null or source_row > 0),
    constraint ck_import_row_errors_error_code
        check (btrim(error_code) <> ''),
    constraint ck_import_row_errors_error_message
        check (btrim(error_message) <> '')
);

comment on table ltc_m.import_row_errors is
    'Metadados e erros de importação; retenção e sanitização de raw_payload permanecem pendentes.';

create index ix_import_row_errors_batch
    on ltc_m.import_row_errors (batch_id);

create table ltc_m.audit_log (
    id bigint generated always as identity primary key,
    table_name text not null,
    record_id text not null,
    operation ltc_m.audit_operation not null,
    old_data jsonb,
    new_data jsonb,
    changed_by_user_id uuid references ltc_m.app_users (id),
    request_id text,
    changed_at timestamptz not null default now(),
    constraint ck_audit_log_table_name
        check (table_name like 'ltc_m.%'),
    constraint ck_audit_log_record_id
        check (btrim(record_id) <> ''),
    constraint ck_audit_log_request_id
        check (request_id is null or btrim(request_id) <> '')
);

comment on table ltc_m.audit_log is
    'Metadados de auditoria; a automação por trigger não integra esta baseline.';

create index ix_audit_log_record
    on ltc_m.audit_log (table_name, record_id, changed_at);

create index ix_audit_log_changed_by
    on ltc_m.audit_log (changed_by_user_id, changed_at);

commit;
