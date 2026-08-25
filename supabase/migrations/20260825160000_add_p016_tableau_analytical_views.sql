begin;

create view ltc_m.v_tableau_portfolio_overview
with (security_invoker = true, security_barrier = true)
as
with visible_projects as (
    select
        projects.id,
        projects.base_currency,
        projects.contract_value,
        projects.status
    from ltc_m.projects
    where projects.deleted_at is null
),
item_totals as (
    select
        project_items.project_id,
        project_items.currency_code,
        count(*)::bigint as active_item_count,
        sum(project_items.total_amount) as active_item_total
    from ltc_m.project_items
    where
        project_items.active
        and project_items.deleted_at is null
    group by project_items.project_id, project_items.currency_code
),
actual_totals as (
    select
        financial_actual_events.project_id,
        financial_actual_events.currency_code,
        count(*)::bigint as actual_event_count,
        sum(financial_actual_events.amount)
            filter (where financial_actual_events.status = 'draft') as billing_actual_draft_amount,
        sum(financial_actual_events.amount)
            filter (where financial_actual_events.status = 'posted') as billing_actual_posted_amount,
        sum(financial_actual_events.amount)
            filter (where financial_actual_events.status = 'cancelled') as billing_actual_cancelled_amount
    from ltc_m.financial_actual_events
    where financial_actual_events.metric_type = 'billing_actual'
    group by financial_actual_events.project_id, financial_actual_events.currency_code
)
select
    'ltcm.p016.analytics.v1'::text as analytics_contract,
    projects.base_currency as currency_code,
    count(*)::bigint as project_count,
    count(*) filter (where projects.status = 'active')::bigint as active_project_count,
    sum(projects.contract_value) as contract_value_total,
    sum(items.active_item_total) filter (where items.active_item_count > 0) as active_item_total,
    count(*) filter (where items.active_item_count is null)::bigint as projects_without_items_count,
    sum(projects.contract_value - items.active_item_total)
        filter (where items.active_item_count > 0) as contract_item_delta_total,
    coalesce(sum(actuals.actual_event_count), 0)::bigint as actual_event_count,
    sum(actuals.billing_actual_draft_amount) as billing_actual_draft_amount,
    sum(actuals.billing_actual_posted_amount) as billing_actual_posted_amount,
    sum(actuals.billing_actual_cancelled_amount) as billing_actual_cancelled_amount,
    null::numeric(20, 2) as billing_actual_canonical_amount,
    'ACTUAL_STATUS_UNRESOLVED'::text as billing_actual_canonical_status,
    null::numeric(20, 2) as billing_remaining_amount,
    'UNSUPPORTED_COMPARISON'::text as billing_remaining_status
from visible_projects as projects
left join item_totals as items
    on items.project_id = projects.id
    and items.currency_code = projects.base_currency
left join actual_totals as actuals
    on actuals.project_id = projects.id
    and actuals.currency_code = projects.base_currency
group by projects.base_currency;

comment on view ltc_m.v_tableau_portfolio_overview is
    'P016/ltcm.p016.analytics.v1: uma linha por moeda no snapshot visível; agregados de projetos, itens e realizados são pré-agregados separadamente para impedir fan-out. Valores canônicos de realizado e a faturar permanecem NULL enquanto as decisões correspondentes estiverem pendentes.';

create view ltc_m.v_tableau_project_overview
with (security_invoker = true, security_barrier = true)
as
with item_totals as (
    select
        project_items.project_id,
        project_items.currency_code,
        count(*)::bigint as active_item_count,
        sum(project_items.total_amount) as active_item_total
    from ltc_m.project_items
    where
        project_items.active
        and project_items.deleted_at is null
    group by project_items.project_id, project_items.currency_code
),
actual_totals as (
    select
        financial_actual_events.project_id,
        financial_actual_events.currency_code,
        count(*)::bigint as actual_event_count,
        count(distinct date_trunc('month', financial_actual_events.competence_date))::bigint
            as actual_competence_count,
        sum(financial_actual_events.amount)
            filter (where financial_actual_events.status = 'draft') as billing_actual_draft_amount,
        sum(financial_actual_events.amount)
            filter (where financial_actual_events.status = 'posted') as billing_actual_posted_amount,
        sum(financial_actual_events.amount)
            filter (where financial_actual_events.status = 'cancelled') as billing_actual_cancelled_amount
    from ltc_m.financial_actual_events
    where financial_actual_events.metric_type = 'billing_actual'
    group by financial_actual_events.project_id, financial_actual_events.currency_code
)
select
    'ltcm.p016.analytics.v1'::text as analytics_contract,
    projects.id as project_id,
    projects.project_code,
    projects.project_name,
    projects.client_id,
    clients.display_name as client_display_name,
    projects.reporting_group,
    projects.classification::text as project_classification,
    projects.status::text as project_status,
    projects.base_currency as currency_code,
    projects.contract_value,
    projects.opening_balance,
    projects.budget_cost,
    projects.data_reference_date,
    projects.legacy_import_batch_id,
    items.active_item_count,
    items.active_item_total,
    case
        when items.active_item_count is null then null
        else items.active_item_total - projects.contract_value
    end as contract_item_delta,
    case
        when items.active_item_count is null then 'ERROR'
        when items.active_item_total is distinct from projects.contract_value then 'ERROR'
        else 'PASS'
    end::text as project_reconciliation_status,
    coalesce(actuals.actual_event_count, 0)::bigint as actual_event_count,
    coalesce(actuals.actual_competence_count, 0)::bigint as actual_competence_count,
    coalesce(actuals.actual_event_count, 0) > 0 as project_month_actual_available,
    actuals.billing_actual_draft_amount,
    actuals.billing_actual_posted_amount,
    actuals.billing_actual_cancelled_amount,
    null::numeric(20, 2) as billing_actual_canonical_amount,
    'ACTUAL_STATUS_UNRESOLVED'::text as billing_actual_canonical_status,
    null::numeric(20, 2) as billing_remaining_amount,
    'UNSUPPORTED_COMPARISON'::text as billing_remaining_status
from ltc_m.projects
join ltc_m.clients
    on clients.id = projects.client_id
left join item_totals as items
    on items.project_id = projects.id
    and items.currency_code = projects.base_currency
left join actual_totals as actuals
    on actuals.project_id = projects.id
    and actuals.currency_code = projects.base_currency
where projects.deleted_at is null;

comment on view ltc_m.v_tableau_project_overview is
    'P016/ltcm.p016.analytics.v1: uma linha por project_id visível. Totais de itens e eventos são pré-agregados em ramos independentes; ausência financeira permanece NULL e status de realizado não é escolhido implicitamente.';

create view ltc_m.v_tableau_project_items
with (security_invoker = true, security_barrier = true)
as
select
    'ltcm.p016.analytics.v1'::text as analytics_contract,
    project_items.id as project_item_id,
    project_items.project_id,
    projects.project_code,
    projects.client_id,
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
    project_items.created_at,
    project_items.updated_at,
    project_items.row_version,
    concat('ltc_m.project_items:', project_items.id::text) as database_reference
from ltc_m.project_items
join ltc_m.projects
    on projects.id = project_items.project_id
where
    projects.deleted_at is null
    and project_items.deleted_at is null;

comment on view ltc_m.v_tableau_project_items is
    'P016/ltcm.p016.analytics.v1: uma linha por project_item_id; chave de negócio analítica project_id + source_line_key. item_code pode repetir e nunca é usado isoladamente para deduplicação.';

create view ltc_m.v_tableau_financial_monthly
with (security_invoker = true, security_barrier = true)
as
select
    'ltcm.p016.analytics.v1'::text as analytics_contract,
    'planned'::text as fact_kind,
    concat('planned:', lines.id::text) as analytical_fact_key,
    lines.id as financial_fact_id,
    lines.project_id,
    projects.project_code,
    lines.project_item_id,
    items.source_line_key,
    lines.plan_version_id,
    versions.name as plan_version_name,
    versions.status::text as plan_status,
    versions.is_baseline,
    lines.competence_month,
    lines.competence_month as competence_date,
    lines.metric_type::text as metric_type,
    lines.planning_level::text as financial_grain,
    null::text as actual_status,
    lines.currency_code,
    lines.amount,
    cells.baseline_id,
    cells.baseline_semantic_fingerprint,
    cells.declaration_state,
    cells.source_cell_reference,
    cells.source_value_hash,
    concat('ltc_m.financial_plan_lines:', lines.id::text) as database_reference,
    false as p014_derived
from ltc_m.financial_plan_lines as lines
join ltc_m.plan_versions as versions
    on versions.id = lines.plan_version_id
join ltc_m.projects
    on projects.id = lines.project_id
left join ltc_m.project_items as items
    on items.id = lines.project_item_id
    and items.project_id = lines.project_id
left join ltc_m.monthly_plan_cells as cells
    on cells.financial_plan_line_id = lines.id
where projects.deleted_at is null
union all
select
    'ltcm.p016.analytics.v1'::text as analytics_contract,
    'actual'::text as fact_kind,
    concat('actual:', actuals.id::text) as analytical_fact_key,
    actuals.id as financial_fact_id,
    actuals.project_id,
    projects.project_code,
    actuals.project_item_id,
    items.source_line_key,
    null::uuid as plan_version_id,
    null::text as plan_version_name,
    null::text as plan_status,
    null::boolean as is_baseline,
    date_trunc('month', actuals.competence_date)::date as competence_month,
    actuals.competence_date,
    actuals.metric_type::text as metric_type,
    case when actuals.project_item_id is null then 'project' else 'item' end::text
        as financial_grain,
    actuals.status::text as actual_status,
    actuals.currency_code,
    actuals.amount,
    null::uuid as baseline_id,
    null::text as baseline_semantic_fingerprint,
    null::text as declaration_state,
    null::text as source_cell_reference,
    null::text as source_value_hash,
    concat('ltc_m.financial_actual_events:', actuals.id::text) as database_reference,
    false as p014_derived
from ltc_m.financial_actual_events as actuals
join ltc_m.projects
    on projects.id = actuals.project_id
left join ltc_m.project_items as items
    on items.id = actuals.project_item_id
    and items.project_id = actuals.project_id
where projects.deleted_at is null;

comment on view ltc_m.v_tableau_financial_monthly is
    'P016/ltcm.p016.analytics.v1: uma linha por fato persistido, identificada por fact_kind + financial_fact_id. Planned mantém versão e baseline; actual mantém status e data próprios. A união discriminada não converte evidência P014 incompatível em eventos.';

create view ltc_m.v_tableau_s_curve_portfolio
with (security_invoker = true, security_barrier = true)
as
with planned_monthly as (
    select
        lines.plan_version_id,
        versions.name as plan_version_name,
        versions.status::text as plan_status,
        versions.is_baseline,
        lines.competence_month,
        lines.metric_type::text as metric_type,
        lines.currency_code,
        sum(lines.amount) as monthly_amount
    from ltc_m.financial_plan_lines as lines
    join ltc_m.plan_versions as versions
        on versions.id = lines.plan_version_id
    join ltc_m.projects
        on projects.id = lines.project_id
    where
        lines.metric_type = 'billing_planned'
        and projects.deleted_at is null
    group by
        lines.plan_version_id,
        versions.name,
        versions.status,
        versions.is_baseline,
        lines.competence_month,
        lines.metric_type,
        lines.currency_code
),
planned_curve as (
    select
        'planned'::text as series_kind,
        planned_monthly.plan_version_id,
        planned_monthly.plan_version_name,
        planned_monthly.plan_status,
        planned_monthly.is_baseline,
        null::text as actual_status,
        planned_monthly.competence_month,
        planned_monthly.metric_type,
        planned_monthly.currency_code,
        planned_monthly.monthly_amount,
        sum(planned_monthly.monthly_amount) over (
            partition by
                planned_monthly.plan_version_id,
                planned_monthly.metric_type,
                planned_monthly.currency_code
            order by planned_monthly.competence_month
            rows between unbounded preceding and current row
        ) as cumulative_amount,
        'plan_version + competence + metric + currency'::text as source_grain,
        'AVAILABLE'::text as availability_status
    from planned_monthly
),
actual_monthly as (
    select
        financial_actual_events.status::text as actual_status,
        date_trunc('month', financial_actual_events.competence_date)::date as competence_month,
        financial_actual_events.metric_type::text as metric_type,
        financial_actual_events.currency_code,
        sum(financial_actual_events.amount) as monthly_amount
    from ltc_m.financial_actual_events
    join ltc_m.projects
        on projects.id = financial_actual_events.project_id
    where
        financial_actual_events.metric_type = 'billing_actual'
        and projects.deleted_at is null
    group by
        financial_actual_events.status,
        date_trunc('month', financial_actual_events.competence_date)::date,
        financial_actual_events.metric_type,
        financial_actual_events.currency_code
),
actual_curve as (
    select
        'actual'::text as series_kind,
        null::uuid as plan_version_id,
        null::text as plan_version_name,
        null::text as plan_status,
        null::boolean as is_baseline,
        actual_monthly.actual_status,
        actual_monthly.competence_month,
        actual_monthly.metric_type,
        actual_monthly.currency_code,
        actual_monthly.monthly_amount,
        sum(actual_monthly.monthly_amount) over (
            partition by
                actual_monthly.actual_status,
                actual_monthly.metric_type,
                actual_monthly.currency_code
            order by actual_monthly.competence_month
            rows between unbounded preceding and current row
        ) as cumulative_amount,
        'portfolio + competence + metric + status + currency'::text as source_grain,
        'AVAILABLE_FROM_PERSISTED_EVENTS_ONLY'::text as availability_status
    from actual_monthly
)
select 'ltcm.p016.analytics.v1'::text as analytics_contract, planned_curve.*
from planned_curve
union all
select 'ltcm.p016.analytics.v1'::text as analytics_contract, actual_curve.*
from actual_curve;

comment on view ltc_m.v_tableau_s_curve_portfolio is
    'P016/ltcm.p016.analytics.v1: uma linha por series_kind + versão/status + competência + métrica + moeda. Acumulados usam ROWS e partições compatíveis; valores de moedas, versões ou status diferentes nunca são somados.';

create view ltc_m.v_tableau_s_curve_project
with (security_invoker = true, security_barrier = true)
as
with planned_monthly as (
    select
        lines.project_id,
        projects.project_code,
        lines.plan_version_id,
        versions.name as plan_version_name,
        versions.status::text as plan_status,
        versions.is_baseline,
        lines.competence_month,
        lines.metric_type::text as metric_type,
        lines.currency_code,
        sum(lines.amount) as monthly_amount
    from ltc_m.financial_plan_lines as lines
    join ltc_m.plan_versions as versions
        on versions.id = lines.plan_version_id
    join ltc_m.projects
        on projects.id = lines.project_id
    where
        lines.metric_type = 'billing_planned'
        and projects.deleted_at is null
    group by
        lines.project_id,
        projects.project_code,
        lines.plan_version_id,
        versions.name,
        versions.status,
        versions.is_baseline,
        lines.competence_month,
        lines.metric_type,
        lines.currency_code
),
planned_curve as (
    select
        'planned'::text as series_kind,
        planned_monthly.project_id,
        planned_monthly.project_code,
        planned_monthly.plan_version_id,
        planned_monthly.plan_version_name,
        planned_monthly.plan_status,
        planned_monthly.is_baseline,
        null::text as actual_status,
        planned_monthly.competence_month,
        planned_monthly.metric_type,
        planned_monthly.currency_code,
        planned_monthly.monthly_amount,
        sum(planned_monthly.monthly_amount) over (
            partition by
                planned_monthly.project_id,
                planned_monthly.plan_version_id,
                planned_monthly.metric_type,
                planned_monthly.currency_code
            order by planned_monthly.competence_month
            rows between unbounded preceding and current row
        ) as cumulative_amount,
        'project + plan_version + competence + metric + currency'::text as source_grain,
        'AVAILABLE'::text as availability_status
    from planned_monthly
),
actual_monthly as (
    select
        financial_actual_events.project_id,
        projects.project_code,
        financial_actual_events.status::text as actual_status,
        date_trunc('month', financial_actual_events.competence_date)::date as competence_month,
        financial_actual_events.metric_type::text as metric_type,
        financial_actual_events.currency_code,
        sum(financial_actual_events.amount) as monthly_amount
    from ltc_m.financial_actual_events
    join ltc_m.projects
        on projects.id = financial_actual_events.project_id
    where
        financial_actual_events.metric_type = 'billing_actual'
        and projects.deleted_at is null
    group by
        financial_actual_events.project_id,
        projects.project_code,
        financial_actual_events.status,
        date_trunc('month', financial_actual_events.competence_date)::date,
        financial_actual_events.metric_type,
        financial_actual_events.currency_code
),
actual_curve as (
    select
        'actual'::text as series_kind,
        actual_monthly.project_id,
        actual_monthly.project_code,
        null::uuid as plan_version_id,
        null::text as plan_version_name,
        null::text as plan_status,
        null::boolean as is_baseline,
        actual_monthly.actual_status,
        actual_monthly.competence_month,
        actual_monthly.metric_type,
        actual_monthly.currency_code,
        actual_monthly.monthly_amount,
        sum(actual_monthly.monthly_amount) over (
            partition by
                actual_monthly.project_id,
                actual_monthly.actual_status,
                actual_monthly.metric_type,
                actual_monthly.currency_code
            order by actual_monthly.competence_month
            rows between unbounded preceding and current row
        ) as cumulative_amount,
        'project + competence + metric + status + currency'::text as source_grain,
        'AVAILABLE_FROM_PERSISTED_EVENTS_ONLY'::text as availability_status
    from actual_monthly
)
select 'ltcm.p016.analytics.v1'::text as analytics_contract, planned_curve.*
from planned_curve
union all
select 'ltcm.p016.analytics.v1'::text as analytics_contract, actual_curve.*
from actual_curve;

comment on view ltc_m.v_tableau_s_curve_project is
    'P016/ltcm.p016.analytics.v1: uma linha por project + series_kind + versão/status + competência + métrica + moeda. Realizado por projeto/mês existe somente quando há financial_actual_events persistido; a evidência P014 não é distribuída nem convertida em zero.';

create view ltc_m.v_tableau_data_quality
with (security_invoker = true, security_barrier = true)
as
with item_totals as (
    select
        project_items.project_id,
        project_items.currency_code,
        count(*)::bigint as item_count,
        sum(project_items.total_amount) as item_total
    from ltc_m.project_items
    where
        project_items.active
        and project_items.deleted_at is null
    group by project_items.project_id, project_items.currency_code
),
actual_projects as (
    select
        financial_actual_events.project_id,
        count(*)::bigint as event_count
    from ltc_m.financial_actual_events
    group by financial_actual_events.project_id
)
select
    'ltcm.p016.analytics.v1'::text as analytics_contract,
    'ltcm.p015.reconciliation-report.v1'::text as reconciliation_contract,
    concat('PROJECT_VALUE_MISMATCH:', projects.id::text) as finding_id,
    'PROJECT_VALUE_MISMATCH'::text as finding_code,
    'ERROR'::text as severity,
    'project_contract'::text as domain,
    projects.id as project_id,
    projects.project_code,
    null::uuid as project_item_id,
    null::text as source_line_key,
    null::date as competence_month,
    projects.base_currency as currency_code,
    projects.contract_value as expected_value,
    items.item_total as observed_value,
    case when items.item_count is null then null else items.item_total - projects.contract_value end
        as delta,
    'REVIEW_SOURCE_OR_DATABASE'::text as remediation_class,
    null::text as decision_reference,
    concat('ltc_m.projects:', projects.id::text) as source_reference,
    concat('ltc_m.project_items:project=', projects.id::text) as database_reference,
    'database_projection'::text as finding_origin
from ltc_m.projects
left join item_totals as items
    on items.project_id = projects.id
    and items.currency_code = projects.base_currency
where
    projects.deleted_at is null
    and items.item_total is distinct from projects.contract_value
union all
select
    'ltcm.p016.analytics.v1'::text as analytics_contract,
    'ltcm.p015.reconciliation-report.v1'::text as reconciliation_contract,
    concat('ACTUAL_STATUS_UNRESOLVED:', projects.id::text) as finding_id,
    'ACTUAL_STATUS_UNRESOLVED'::text as finding_code,
    'BLOCKING'::text as severity,
    'billing_actual'::text as domain,
    projects.id as project_id,
    projects.project_code,
    null::uuid as project_item_id,
    null::text as source_line_key,
    null::date as competence_month,
    projects.base_currency as currency_code,
    null::numeric(20, 2) as expected_value,
    null::numeric(20, 2) as observed_value,
    null::numeric(20, 2) as delta,
    'BUSINESS_DECISION_REQUIRED'::text as remediation_class,
    'P014-ACTUAL-STATUS'::text as decision_reference,
    concat('ltc_m.financial_actual_events:project=', projects.id::text) as source_reference,
    null::text as database_reference,
    'database_projection'::text as finding_origin
from ltc_m.projects
join actual_projects
    on actual_projects.project_id = projects.id
where
    projects.deleted_at is null
    and actual_projects.event_count > 0;

comment on view ltc_m.v_tableau_data_quality is
    'P016/ltcm.p016.analytics.v1: uma linha por finding SQL verificável, com códigos P015 estáveis. É projeção read-only parcial; findings P014/P015 computados fora do banco não são persistidos nem fabricados por esta view.';

create view ltc_m.v_tableau_plan_versions
with (security_invoker = true, security_barrier = true)
as
with baseline_sources as (
    select
        monthly_plan_import_executions.baseline_id,
        count(*)::bigint as source_execution_count,
        count(distinct monthly_plan_import_executions.source_artifact_id)::bigint
            as source_artifact_count
    from ltc_m.monthly_plan_import_executions
    group by monthly_plan_import_executions.baseline_id
)
select
    'ltcm.p016.analytics.v1'::text as analytics_contract,
    concat(
        versions.id::text,
        ':',
        coalesce(scopes.id::text, 'NO_SCOPE')
    ) as analytical_version_key,
    versions.id as plan_version_id,
    versions.name as plan_version_name,
    versions.reference_date,
    versions.status::text as plan_status,
    versions.is_baseline,
    versions.source_plan_version_id,
    versions.created_at,
    versions.updated_at,
    versions.approved_at,
    versions.row_version,
    scopes.id as financial_plan_scope_id,
    scopes.project_id,
    projects.project_code,
    scopes.metric_type::text as metric_type,
    scopes.planning_level::text as planning_level,
    scopes.currency_code,
    baselines.id as baseline_id,
    baselines.semantic_contract_version as baseline_contract,
    baselines.semantic_fingerprint as baseline_semantic_fingerprint,
    coalesce(baseline_sources.source_execution_count, 0)::bigint as source_execution_count,
    coalesce(baseline_sources.source_artifact_count, 0)::bigint as source_artifact_count,
    false as current_version_supported,
    'CURRENT_VERSION_RULE_UNDEFINED'::text as current_version_status
from ltc_m.plan_versions as versions
left join ltc_m.financial_plan_scopes as scopes
    on scopes.plan_version_id = versions.id
left join ltc_m.projects
    on projects.id = scopes.project_id
left join ltc_m.monthly_plan_baselines as baselines
    on baselines.plan_version_id = versions.id
    and baselines.metric_type = scopes.metric_type
left join baseline_sources
    on baseline_sources.baseline_id = baselines.id;

comment on view ltc_m.v_tableau_plan_versions is
    'P016/ltcm.p016.analytics.v1: uma linha por plan_version_id + financial_plan_scope_id (NO_SCOPE quando ausente). Baseline e contagens de fonte são pré-agregados para preservar o grão; nenhuma versão atual/ativa é inferida.';

create view ltc_m.v_tableau_source_provenance
with (security_invoker = true, security_barrier = true)
as
select
    'ltcm.p016.analytics.v1'::text as analytics_contract,
    cells.id as monthly_plan_cell_id,
    cells.baseline_id,
    cells.baseline_semantic_fingerprint,
    cells.plan_version_id,
    cells.project_id,
    projects.project_code,
    cells.project_item_id,
    cells.source_line_key,
    cells.metric_type::text as metric_type,
    cells.planning_level::text as planning_level,
    cells.competence_month,
    cells.declaration_state,
    cells.canonical_amount,
    cells.financial_plan_line_id,
    cells.source_row_number,
    cells.source_column,
    cells.source_cell_reference,
    cells.source_numeric_text,
    cells.source_value_hash,
    cells.import_batch_id,
    cells.import_batch_sheet_id,
    cells.import_staging_row_id,
    sheets.sheet_key,
    sheets.sheet_name,
    staging.source_range,
    baselines.semantic_contract_version as baseline_contract,
    executions.source_artifact_id,
    artifacts.source_name,
    artifacts.source_sha256,
    artifacts.source_semantic_fingerprint,
    batches.idempotency_key as import_idempotency_key
from ltc_m.monthly_plan_cells as cells
join ltc_m.monthly_plan_baselines as baselines
    on baselines.id = cells.baseline_id
join ltc_m.projects
    on projects.id = cells.project_id
left join ltc_m.monthly_plan_import_executions as executions
    on executions.import_batch_id = cells.import_batch_id
left join ltc_m.monthly_source_artifacts as artifacts
    on artifacts.id = executions.source_artifact_id
left join ltc_m.import_batches as batches
    on batches.id = cells.import_batch_id
left join ltc_m.import_batch_sheets as sheets
    on sheets.id = cells.import_batch_sheet_id
left join ltc_m.import_staging_rows as staging
    on staging.id = cells.import_staging_row_id;

comment on view ltc_m.v_tableau_source_provenance is
    'P016/ltcm.p016.analytics.v1: uma linha por monthly_plan_cell_id. Preserva blank, explicit_zero e value sem COALESCE; joins de proveniência são 1:1 por constraints P009/P013 e nunca entram em agregados financeiros.';

revoke all privileges on table
    ltc_m.v_tableau_portfolio_overview,
    ltc_m.v_tableau_project_overview,
    ltc_m.v_tableau_project_items,
    ltc_m.v_tableau_financial_monthly,
    ltc_m.v_tableau_s_curve_portfolio,
    ltc_m.v_tableau_s_curve_project,
    ltc_m.v_tableau_data_quality,
    ltc_m.v_tableau_plan_versions,
    ltc_m.v_tableau_source_provenance
from public;

grant select on table
    ltc_m.v_tableau_portfolio_overview,
    ltc_m.v_tableau_project_overview,
    ltc_m.v_tableau_project_items,
    ltc_m.v_tableau_financial_monthly,
    ltc_m.v_tableau_s_curve_portfolio,
    ltc_m.v_tableau_s_curve_project,
    ltc_m.v_tableau_data_quality,
    ltc_m.v_tableau_plan_versions,
    ltc_m.v_tableau_source_provenance
to ltc_m_runtime;

commit;
