-- P006 / 1.06 — validação estrutural de planos, sem executar consultas.
-- As tabelas estão vazias; não usar estes planos como evidência de ganho real.

explain (format json, costs, verbose)
select app_users.id
from ltc_m.app_users
where app_users.auth_subject = 'p006|lookup';

explain (format json, costs, verbose)
select projects.id
from ltc_m.projects
where
    pg_catalog.upper(projects.project_code) = 'P006-PROJECT'
    and projects.deleted_at is null;

explain (format json, costs, verbose)
select projects.id, projects.project_code
from ltc_m.projects
where
    projects.client_id = '00000000-0000-4000-8000-000000000001'
    and projects.status = 'active'
    and projects.deleted_at is null;

explain (format json, costs, verbose)
select project_items.id
from ltc_m.project_items
where
    project_items.project_id = '00000000-0000-4000-8000-000000000001'
    and project_items.deleted_at is null;

explain (format json, costs, verbose)
select plan_versions.id, plan_versions.status
from ltc_m.financial_plan_scopes
join ltc_m.plan_versions
    on plan_versions.id = financial_plan_scopes.plan_version_id
where
    financial_plan_scopes.project_id
        = '00000000-0000-4000-8000-000000000001'
    and plan_versions.status = 'approved';

explain (format json, costs, verbose)
select financial_plan_lines.id
from ltc_m.financial_plan_lines
where
    financial_plan_lines.plan_version_id
        = '00000000-0000-4000-8000-000000000001'
    and financial_plan_lines.competence_month
        between date '2026-01-01' and date '2026-12-01';

explain (format json, costs, verbose)
select financial_plan_lines.id
from ltc_m.financial_plan_lines
where
    financial_plan_lines.project_item_id
        = '00000000-0000-4000-8000-000000000001'
    and financial_plan_lines.competence_month
        between date '2026-01-01' and date '2026-12-01';

explain (format json, costs, verbose)
select financial_actual_events.id
from ltc_m.financial_actual_events
where
    financial_actual_events.project_id
        = '00000000-0000-4000-8000-000000000001'
    and financial_actual_events.competence_date
        between date '2026-01-01' and date '2026-12-31';

explain (format json, costs, verbose)
select financial_actual_events.id
from ltc_m.financial_actual_events
where
    financial_actual_events.project_item_id
        = '00000000-0000-4000-8000-000000000001'
    and financial_actual_events.competence_date
        between date '2026-01-01' and date '2026-12-31';

explain (format json, costs, verbose)
select import_row_errors.id
from ltc_m.import_row_errors
where
    import_row_errors.batch_id
        = '00000000-0000-4000-8000-000000000001';

explain (format json, costs, verbose)
select
    projects.id,
    projects.base_currency,
    projects.status,
    clients.id as client_id
from ltc_m.projects
join ltc_m.clients
    on clients.id = projects.client_id
where
    projects.client_id = '00000000-0000-4000-8000-000000000001'
    and projects.base_currency = 'BRL'
    and projects.status = 'active'
    and projects.deleted_at is null;
