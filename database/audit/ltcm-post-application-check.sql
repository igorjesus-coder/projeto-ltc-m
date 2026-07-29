-- Verificação pós-aplicação exclusivamente read-only.
-- Retorna apenas contagens das tabelas recém-criadas, nunca o conteúdo.
select 'app_users'::text as table_name, count(*)::bigint as row_count
from ltc_m.app_users
union all
select 'currencies', count(*)::bigint from ltc_m.currencies
union all
select 'units', count(*)::bigint from ltc_m.units
union all
select 'clients', count(*)::bigint from ltc_m.clients
union all
select 'projects', count(*)::bigint from ltc_m.projects
union all
select 'project_items', count(*)::bigint from ltc_m.project_items
union all
select 'plan_versions', count(*)::bigint from ltc_m.plan_versions
union all
select 'financial_plan_scopes', count(*)::bigint from ltc_m.financial_plan_scopes
union all
select 'financial_plan_lines', count(*)::bigint from ltc_m.financial_plan_lines
union all
select 'financial_actual_events', count(*)::bigint from ltc_m.financial_actual_events
union all
select 'import_batches', count(*)::bigint from ltc_m.import_batches
union all
select 'import_row_errors', count(*)::bigint from ltc_m.import_row_errors
union all
select 'audit_log', count(*)::bigint from ltc_m.audit_log
order by table_name;
