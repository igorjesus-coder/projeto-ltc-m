-- P003 / 1.03 - desenho revisado do schema LTC-M.
--
-- ESTE ARQUIVO NAO E UMA MIGRATION E NAO DEVE SER APLICADO DIRETAMENTE.
-- Ele registra o estado proposto do modelo para revisao e futura decomposicao
-- em migrations incrementais, acompanhadas de backup, preflight e testes SQL.
--
-- Premissas:
--   * todos os objetos de dominio pertencem exclusivamente a ltc_m;
--   * o backend NestJS e a fronteira operacional do banco;
--   * Auth0 autentica e app_users associa o claim sub ao usuario interno;
--   * nenhuma extensao, role, grant, policy ou objeto externo e alterado aqui;
--   * identificadores e nomes de objetos sao sempre qualificados por schema.

set search_path to pg_catalog;

-- A futura primeira migration deve executar esta criacao de forma explicita.
-- A ausencia de IF NOT EXISTS e intencional: um schema preexistente inesperado
-- deve interromper a migration para investigacao.
create schema ltc_m;

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
    id uuid primary key default pg_catalog.gen_random_uuid(),
    auth_subject text not null,
    email text,
    full_name text not null,
    role ltc_m.app_role not null default 'viewer',
    active boolean not null default true,
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
    constraint uq_app_users_auth_subject unique (auth_subject),
    constraint ck_app_users_auth_subject_not_blank
        check (auth_subject = pg_catalog.btrim(auth_subject) and auth_subject <> ''),
    constraint ck_app_users_email_not_blank
        check (email is null or pg_catalog.btrim(email) <> ''),
    constraint ck_app_users_full_name_not_blank
        check (pg_catalog.btrim(full_name) <> '')
);

create table ltc_m.currencies (
    code text primary key,
    name text not null,
    decimal_places smallint not null default 2,
    active boolean not null default true,
    constraint ck_currencies_code
        check (code = pg_catalog.upper(code) and code ~ '^[A-Z]{3}$'),
    constraint ck_currencies_name_not_blank
        check (pg_catalog.btrim(name) <> ''),
    constraint ck_currencies_decimal_places
        check (decimal_places between 0 and 6)
);

create table ltc_m.units (
    code text primary key,
    name text not null,
    category text,
    active boolean not null default true,
    constraint ck_units_code
        check (
            code = pg_catalog.upper(pg_catalog.btrim(code))
            and code <> ''
        ),
    constraint ck_units_name_not_blank
        check (pg_catalog.btrim(name) <> ''),
    constraint ck_units_category_not_blank
        check (category is null or pg_catalog.btrim(category) <> '')
);

create table ltc_m.clients (
    id uuid primary key default pg_catalog.gen_random_uuid(),
    legal_name text not null,
    display_name text not null,
    tax_id text,
    active boolean not null default true,
    created_by_user_id uuid references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
    deleted_at timestamptz,
    constraint ck_clients_legal_name_not_blank
        check (pg_catalog.btrim(legal_name) <> ''),
    constraint ck_clients_display_name_not_blank
        check (pg_catalog.btrim(display_name) <> ''),
    constraint ck_clients_tax_id_not_blank
        check (tax_id is null or pg_catalog.btrim(tax_id) <> '')
);

create unique index uq_clients_tax_id_active
    on ltc_m.clients (tax_id)
    where tax_id is not null and deleted_at is null;

create table ltc_m.projects (
    id uuid primary key default pg_catalog.gen_random_uuid(),
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
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
    deleted_at timestamptz,
    constraint uq_projects_id_currency unique (id, base_currency),
    constraint ck_projects_code_normalized
        check (
            project_code = pg_catalog.btrim(project_code)
            and project_code <> ''
        ),
    constraint ck_projects_name_not_blank
        check (pg_catalog.btrim(project_name) <> ''),
    constraint ck_projects_reporting_group_not_blank
        check (
            reporting_group is null
            or pg_catalog.btrim(reporting_group) <> ''
        ),
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

create unique index uq_projects_code_active
    on ltc_m.projects (pg_catalog.upper(project_code))
    where deleted_at is null;

create index ix_projects_client
    on ltc_m.projects (client_id)
    where deleted_at is null;

create table ltc_m.project_items (
    id uuid primary key default pg_catalog.gen_random_uuid(),
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
        generated always as (
            pg_catalog.round(quantity * unit_price, 2)
        ) stored,
    active boolean not null default true,
    notes text,
    created_by_user_id uuid references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
    deleted_at timestamptz,
    constraint uq_project_items_id_project unique (id, project_id),
    constraint fk_project_items_project_currency
        foreign key (project_id, currency_code)
        references ltc_m.projects (id, base_currency),
    constraint ck_project_items_source_key
        check (
            source_line_key = pg_catalog.btrim(source_line_key)
            and source_line_key <> ''
        ),
    constraint ck_project_items_line_number
        check (line_number > 0),
    constraint ck_project_items_item_code
        check (
            item_code is null
            or (
                item_code = pg_catalog.btrim(item_code)
                and item_code <> ''
            )
        ),
    constraint ck_project_items_description
        check (
            description is null
            or pg_catalog.btrim(description) <> ''
        ),
    constraint ck_project_items_quantity
        check (quantity > 0),
    constraint ck_project_items_unit_price
        check (unit_price >= 0)
);

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
    id uuid primary key default pg_catalog.gen_random_uuid(),
    name text not null,
    reference_date date not null,
    status ltc_m.plan_status not null default 'draft',
    is_baseline boolean not null default false,
    notes text,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    approved_by_user_id uuid references ltc_m.app_users (id),
    approved_at timestamptz,
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
    constraint uq_plan_versions_name unique (name),
    constraint ck_plan_versions_name_not_blank
        check (pg_catalog.btrim(name) <> ''),
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

create unique index uq_plan_versions_single_active_baseline
    on ltc_m.plan_versions (is_baseline)
    where is_baseline = true and status <> 'archived';

-- Um escopo fixa um unico grao por versao, projeto e metrica. Assim, linhas
-- agregadas de projeto nao coexistem com linhas de item para a mesma serie.
create table ltc_m.financial_plan_scopes (
    id uuid primary key default pg_catalog.gen_random_uuid(),
    plan_version_id uuid not null references ltc_m.plan_versions (id),
    project_id uuid not null,
    metric_type ltc_m.planned_financial_metric not null,
    planning_level ltc_m.planning_level not null,
    currency_code text not null,
    created_by_user_id uuid not null references ltc_m.app_users (id),
    updated_by_user_id uuid references ltc_m.app_users (id),
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
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

create table ltc_m.financial_plan_lines (
    id uuid primary key default pg_catalog.gen_random_uuid(),
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
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
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
            = pg_catalog.date_trunc('month', competence_month)::date
        ),
    constraint ck_financial_plan_lines_amount
        check (amount >= 0)
);

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
    id uuid primary key default pg_catalog.gen_random_uuid(),
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
    created_at timestamptz not null default pg_catalog.now(),
    updated_at timestamptz not null default pg_catalog.now(),
    constraint fk_financial_actual_project_currency
        foreign key (project_id, currency_code)
        references ltc_m.projects (id, base_currency),
    constraint fk_financial_actual_item
        foreign key (project_item_id, project_id)
        references ltc_m.project_items (id, project_id),
    constraint uq_financial_actual_source
        unique (project_id, source_key),
    constraint ck_financial_actual_source_key
        check (
            source_key = pg_catalog.btrim(source_key)
            and source_key <> ''
        ),
    constraint ck_financial_actual_document_number
        check (
            document_number is null
            or pg_catalog.btrim(document_number) <> ''
        ),
    constraint ck_financial_actual_installment_key
        check (
            installment_key is null
            or pg_catalog.btrim(installment_key) <> ''
        ),
    constraint ck_financial_actual_amount
        check (amount >= 0)
);

create index ix_financial_actual_project_date
    on ltc_m.financial_actual_events (project_id, competence_date);

create table ltc_m.import_batches (
    id uuid primary key default pg_catalog.gen_random_uuid(),
    source_name text not null,
    source_hash text,
    reference_date date,
    status ltc_m.import_status not null default 'received',
    received_rows integer not null default 0,
    accepted_rows integer not null default 0,
    rejected_rows integer not null default 0,
    submitted_by_user_id uuid not null references ltc_m.app_users (id),
    created_at timestamptz not null default pg_catalog.now(),
    completed_at timestamptz,
    constraint ck_import_batches_source_name
        check (pg_catalog.btrim(source_name) <> ''),
    constraint ck_import_batches_source_hash
        check (source_hash is null or pg_catalog.btrim(source_hash) <> ''),
    constraint ck_import_batches_row_counts
        check (
            received_rows >= 0
            and accepted_rows >= 0
            and rejected_rows >= 0
            and accepted_rows + rejected_rows <= received_rows
        ),
    constraint ck_import_batches_completed_at
        check (
            completed_at is null
            or completed_at >= created_at
        )
);

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
    created_at timestamptz not null default pg_catalog.now(),
    constraint ck_import_row_errors_source_row
        check (source_row is null or source_row > 0),
    constraint ck_import_row_errors_error_code
        check (pg_catalog.btrim(error_code) <> ''),
    constraint ck_import_row_errors_error_message
        check (pg_catalog.btrim(error_message) <> '')
);

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
    changed_at timestamptz not null default pg_catalog.now(),
    constraint ck_audit_log_table_name
        check (table_name like 'ltc_m.%'),
    constraint ck_audit_log_record_id
        check (pg_catalog.btrim(record_id) <> ''),
    constraint ck_audit_log_request_id
        check (request_id is null or pg_catalog.btrim(request_id) <> '')
);

create index ix_audit_log_record
    on ltc_m.audit_log (table_name, record_id, changed_at);

create index ix_audit_log_changed_by
    on ltc_m.audit_log (changed_by_user_id, changed_at);

create function ltc_m.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
    new.updated_at := pg_catalog.now();
    return new;
end;
$function$;

create function ltc_m.set_project_updated_at_and_version()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
    new.updated_at := pg_catalog.now();
    new.version := old.version + 1;
    return new;
end;
$function$;

create trigger trg_app_users_updated_at
before update on ltc_m.app_users
for each row execute function ltc_m.set_updated_at();

create trigger trg_clients_updated_at
before update on ltc_m.clients
for each row execute function ltc_m.set_updated_at();

create trigger trg_projects_updated_at_version
before update on ltc_m.projects
for each row execute function ltc_m.set_project_updated_at_and_version();

create trigger trg_project_items_updated_at
before update on ltc_m.project_items
for each row execute function ltc_m.set_updated_at();

create trigger trg_plan_versions_updated_at
before update on ltc_m.plan_versions
for each row execute function ltc_m.set_updated_at();

create trigger trg_financial_plan_scopes_updated_at
before update on ltc_m.financial_plan_scopes
for each row execute function ltc_m.set_updated_at();

create trigger trg_financial_plan_lines_updated_at
before update on ltc_m.financial_plan_lines
for each row execute function ltc_m.set_updated_at();

create trigger trg_financial_actual_events_updated_at
before update on ltc_m.financial_actual_events
for each row execute function ltc_m.set_updated_at();

create view ltc_m.v_current_plan_version as
select
    plan_versions.id,
    plan_versions.name,
    plan_versions.reference_date,
    plan_versions.status,
    plan_versions.is_baseline,
    plan_versions.approved_by_user_id,
    plan_versions.approved_at,
    plan_versions.created_at,
    plan_versions.updated_at
from ltc_m.plan_versions
where plan_versions.status in ('approved', 'locked')
order by
    plan_versions.reference_date desc,
    plan_versions.approved_at desc,
    plan_versions.created_at desc
limit 1;

create view ltc_m.v_tableau_project_items as
select
    project_items.id as project_item_id,
    project_items.project_id,
    projects.project_code,
    project_items.source_line_key,
    project_items.line_number,
    project_items.item_code,
    project_items.description,
    project_items.quantity,
    project_items.unit_code,
    project_items.currency_code,
    project_items.unit_price,
    project_items.total_amount,
    project_items.active,
    project_items.updated_at
from ltc_m.project_items
join ltc_m.projects
    on projects.id = project_items.project_id
where
    project_items.deleted_at is null
    and projects.deleted_at is null;

create view ltc_m.v_tableau_plan_versions as
select
    plan_versions.id as plan_version_id,
    plan_versions.name,
    plan_versions.reference_date,
    plan_versions.status,
    plan_versions.is_baseline,
    plan_versions.approved_at,
    plan_versions.created_at,
    plan_versions.updated_at
from ltc_m.plan_versions;

create view ltc_m.v_tableau_financial_monthly as
select
    financial_plan_lines.plan_version_id,
    financial_plan_lines.project_id,
    financial_plan_lines.project_item_id,
    financial_plan_lines.currency_code,
    financial_plan_lines.competence_month,
    financial_plan_lines.metric_type::text as metric_type,
    financial_plan_lines.planning_level::text as planning_level,
    'planned'::text as series_kind,
    financial_plan_lines.amount
from ltc_m.financial_plan_lines
union all
select
    null::uuid as plan_version_id,
    financial_actual_events.project_id,
    financial_actual_events.project_item_id,
    financial_actual_events.currency_code,
    pg_catalog.date_trunc(
        'month',
        financial_actual_events.competence_date
    )::date as competence_month,
    financial_actual_events.metric_type::text as metric_type,
    case
        when financial_actual_events.project_item_id is null then 'project'
        else 'item'
    end as planning_level,
    'actual'::text as series_kind,
    financial_actual_events.amount
from ltc_m.financial_actual_events
where financial_actual_events.status = 'posted';

create view ltc_m.v_tableau_project_overview as
with item_totals as (
    select
        project_items.project_id,
        pg_catalog.sum(project_items.total_amount) as active_item_value
    from ltc_m.project_items
    where
        project_items.deleted_at is null
        and project_items.active = true
    group by project_items.project_id
),
current_plan as (
    select
        financial_plan_lines.project_id,
        pg_catalog.sum(financial_plan_lines.amount)
            filter (
                where financial_plan_lines.metric_type = 'billing_planned'
            ) as billing_planned,
        pg_catalog.sum(financial_plan_lines.amount)
            filter (
                where financial_plan_lines.metric_type = 'receipt_forecast'
            ) as receipt_forecast
    from ltc_m.financial_plan_lines
    join ltc_m.v_current_plan_version
        on v_current_plan_version.id
        = financial_plan_lines.plan_version_id
    group by financial_plan_lines.project_id
),
actuals as (
    select
        financial_actual_events.project_id,
        pg_catalog.sum(financial_actual_events.amount)
            filter (
                where
                    financial_actual_events.metric_type = 'billing_actual'
                    and financial_actual_events.status = 'posted'
            ) as billing_actual,
        pg_catalog.sum(financial_actual_events.amount)
            filter (
                where
                    financial_actual_events.metric_type = 'receipt_actual'
                    and financial_actual_events.status = 'posted'
            ) as receipt_actual
    from ltc_m.financial_actual_events
    group by financial_actual_events.project_id
)
select
    projects.id as project_id,
    projects.project_code,
    projects.project_name,
    clients.display_name as client_name,
    projects.reporting_group,
    projects.classification,
    projects.status,
    projects.base_currency,
    projects.contract_value,
    projects.opening_balance,
    projects.budget_cost,
    pg_catalog.coalesce(item_totals.active_item_value, 0::numeric)
        as active_item_value,
    pg_catalog.coalesce(current_plan.billing_planned, 0::numeric)
        as billing_planned,
    pg_catalog.coalesce(current_plan.receipt_forecast, 0::numeric)
        as receipt_forecast,
    pg_catalog.coalesce(actuals.billing_actual, 0::numeric)
        as billing_actual,
    pg_catalog.coalesce(actuals.receipt_actual, 0::numeric)
        as receipt_actual,
    pg_catalog.greatest(
        projects.contract_value
        - pg_catalog.coalesce(actuals.billing_actual, 0::numeric),
        0::numeric
    ) as to_bill,
    pg_catalog.greatest(
        projects.contract_value
        - pg_catalog.coalesce(actuals.billing_actual, 0::numeric)
        - pg_catalog.coalesce(current_plan.billing_planned, 0::numeric),
        0::numeric
    ) as unallocated_billing,
    case
        when projects.contract_value > 0 then
            pg_catalog.coalesce(actuals.billing_actual, 0::numeric)
            / projects.contract_value
        else 0::numeric
    end as contract_financial_progress,
    projects.data_reference_date,
    projects.updated_at
from ltc_m.projects
join ltc_m.clients
    on clients.id = projects.client_id
left join item_totals
    on item_totals.project_id = projects.id
left join current_plan
    on current_plan.project_id = projects.id
left join actuals
    on actuals.project_id = projects.id
where projects.deleted_at is null;

create view ltc_m.v_tableau_s_curve_portfolio as
with current_version as (
    select v_current_plan_version.id
    from ltc_m.v_current_plan_version
),
plan_month as (
    select
        financial_plan_lines.currency_code,
        financial_plan_lines.competence_month,
        pg_catalog.sum(financial_plan_lines.amount) as planned_monthly
    from ltc_m.financial_plan_lines
    join current_version
        on current_version.id = financial_plan_lines.plan_version_id
    where financial_plan_lines.metric_type = 'billing_planned'
    group by
        financial_plan_lines.currency_code,
        financial_plan_lines.competence_month
),
actual_month as (
    select
        financial_actual_events.currency_code,
        pg_catalog.date_trunc(
            'month',
            financial_actual_events.competence_date
        )::date as competence_month,
        pg_catalog.sum(financial_actual_events.amount) as actual_monthly
    from ltc_m.financial_actual_events
    where
        financial_actual_events.metric_type = 'billing_actual'
        and financial_actual_events.status = 'posted'
    group by
        financial_actual_events.currency_code,
        pg_catalog.date_trunc(
            'month',
            financial_actual_events.competence_date
        )::date
),
months as (
    select plan_month.currency_code, plan_month.competence_month
    from plan_month
    union
    select actual_month.currency_code, actual_month.competence_month
    from actual_month
),
monthly as (
    select
        months.currency_code,
        months.competence_month,
        pg_catalog.coalesce(plan_month.planned_monthly, 0::numeric)
            as planned_monthly,
        pg_catalog.coalesce(actual_month.actual_monthly, 0::numeric)
            as actual_monthly
    from months
    left join plan_month
        on plan_month.currency_code = months.currency_code
        and plan_month.competence_month = months.competence_month
    left join actual_month
        on actual_month.currency_code = months.currency_code
        and actual_month.competence_month = months.competence_month
),
cumulative as (
    select
        monthly.*,
        pg_catalog.sum(monthly.planned_monthly) over (
            partition by monthly.currency_code
            order by monthly.competence_month
        ) as planned_cumulative,
        pg_catalog.sum(monthly.actual_monthly) over (
            partition by monthly.currency_code
            order by monthly.competence_month
        ) as actual_cumulative,
        pg_catalog.sum(monthly.planned_monthly) over (
            partition by monthly.currency_code
        ) as total_planned
    from monthly
)
select
    cumulative.*,
    case
        when cumulative.total_planned > 0 then
            cumulative.planned_cumulative / cumulative.total_planned
        else 0::numeric
    end as planned_cumulative_pct,
    case
        when cumulative.total_planned > 0 then
            cumulative.actual_cumulative / cumulative.total_planned
        else 0::numeric
    end as actual_cumulative_pct,
    cumulative.actual_cumulative - cumulative.planned_cumulative
        as cumulative_variance,
    case
        when cumulative.planned_cumulative > 0 then
            cumulative.actual_cumulative / cumulative.planned_cumulative
        else null
    end as plan_adherence
from cumulative;

create view ltc_m.v_tableau_s_curve_project as
with current_version as (
    select v_current_plan_version.id
    from ltc_m.v_current_plan_version
),
plan_month as (
    select
        financial_plan_lines.project_id,
        financial_plan_lines.currency_code,
        financial_plan_lines.competence_month,
        pg_catalog.sum(financial_plan_lines.amount) as planned_monthly
    from ltc_m.financial_plan_lines
    join current_version
        on current_version.id = financial_plan_lines.plan_version_id
    where financial_plan_lines.metric_type = 'billing_planned'
    group by
        financial_plan_lines.project_id,
        financial_plan_lines.currency_code,
        financial_plan_lines.competence_month
),
actual_month as (
    select
        financial_actual_events.project_id,
        financial_actual_events.currency_code,
        pg_catalog.date_trunc(
            'month',
            financial_actual_events.competence_date
        )::date as competence_month,
        pg_catalog.sum(financial_actual_events.amount) as actual_monthly
    from ltc_m.financial_actual_events
    where
        financial_actual_events.metric_type = 'billing_actual'
        and financial_actual_events.status = 'posted'
    group by
        financial_actual_events.project_id,
        financial_actual_events.currency_code,
        pg_catalog.date_trunc(
            'month',
            financial_actual_events.competence_date
        )::date
),
months as (
    select
        plan_month.project_id,
        plan_month.currency_code,
        plan_month.competence_month
    from plan_month
    union
    select
        actual_month.project_id,
        actual_month.currency_code,
        actual_month.competence_month
    from actual_month
),
monthly as (
    select
        months.project_id,
        months.currency_code,
        months.competence_month,
        pg_catalog.coalesce(plan_month.planned_monthly, 0::numeric)
            as planned_monthly,
        pg_catalog.coalesce(actual_month.actual_monthly, 0::numeric)
            as actual_monthly
    from months
    left join plan_month
        on plan_month.project_id = months.project_id
        and plan_month.currency_code = months.currency_code
        and plan_month.competence_month = months.competence_month
    left join actual_month
        on actual_month.project_id = months.project_id
        and actual_month.currency_code = months.currency_code
        and actual_month.competence_month = months.competence_month
),
cumulative as (
    select
        monthly.*,
        pg_catalog.sum(monthly.planned_monthly) over (
            partition by monthly.project_id, monthly.currency_code
            order by monthly.competence_month
        ) as planned_cumulative,
        pg_catalog.sum(monthly.actual_monthly) over (
            partition by monthly.project_id, monthly.currency_code
            order by monthly.competence_month
        ) as actual_cumulative,
        pg_catalog.sum(monthly.planned_monthly) over (
            partition by monthly.project_id, monthly.currency_code
        ) as total_planned
    from monthly
)
select
    cumulative.*,
    case
        when cumulative.total_planned > 0 then
            cumulative.planned_cumulative / cumulative.total_planned
        else 0::numeric
    end as planned_cumulative_pct,
    case
        when cumulative.total_planned > 0 then
            cumulative.actual_cumulative / cumulative.total_planned
        else 0::numeric
    end as actual_cumulative_pct,
    cumulative.actual_cumulative - cumulative.planned_cumulative
        as cumulative_variance,
    case
        when cumulative.planned_cumulative > 0 then
            cumulative.actual_cumulative / cumulative.planned_cumulative
        else null
    end as plan_adherence
from cumulative;

create view ltc_m.v_tableau_data_quality as
select
    project_overview.project_id,
    project_overview.project_code,
    project_overview.client_name,
    project_overview.base_currency,
    project_overview.contract_value,
    project_overview.active_item_value,
    project_overview.billing_planned,
    project_overview.billing_actual,
    project_overview.unallocated_billing,
    pg_catalog.abs(
        project_overview.contract_value
        - project_overview.active_item_value
    ) > 0.01 as contract_item_mismatch,
    project_overview.unallocated_billing > 0.01
        as has_unallocated_billing,
    exists (
        select 1
        from ltc_m.project_items
        where
            project_items.project_id = project_overview.project_id
            and project_items.deleted_at is null
            and (
                project_items.item_code is null
                or project_items.description is null
            )
    ) as has_incomplete_items,
    project_overview.data_reference_date,
    project_overview.updated_at
from ltc_m.v_tableau_project_overview as project_overview;

-- Fora deste desenho, por depender de decisoes e revisoes proprias:
--   * dados de referencia e seeds;
--   * roles PostgreSQL e grants do backend/Tableau;
--   * policies RLS e propagacao de contexto Auth0;
--   * automacao de auditoria;
--   * funcoes transacionais do backend;
--   * staging fisico e rotina de importacao;
--   * metricas de custo/receita ainda nao aprovadas para a primeira entrega.
