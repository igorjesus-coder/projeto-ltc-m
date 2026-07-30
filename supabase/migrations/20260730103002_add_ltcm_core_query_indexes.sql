begin;

create index ix_financial_plan_scopes_project_version
    on ltc_m.financial_plan_scopes (project_id, plan_version_id);

create index ix_financial_plan_lines_version_month
    on ltc_m.financial_plan_lines (plan_version_id, competence_month);

create index ix_financial_plan_lines_item_month
    on ltc_m.financial_plan_lines (project_item_id, competence_month)
    where project_item_id is not null;

create index ix_financial_actual_events_item_date
    on ltc_m.financial_actual_events (project_item_id, competence_date)
    where project_item_id is not null;

commit;
