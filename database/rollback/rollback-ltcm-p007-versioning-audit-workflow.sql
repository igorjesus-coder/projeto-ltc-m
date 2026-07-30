-- NÃO EXECUTAR AUTOMATICAMENTE.
--
-- Rollback manual e destrutivo da P007 / 1.07.
-- Remove somente triggers, funções, índice, constraints e colunas criados pela P007.
-- Exige autorização explícita, backup recuperável e confirmação de ausência de dados
-- que dependam de source_plan_version_id, row_version ou dos metadados de auditoria.
--
-- PostgreSQL não permite remover valores individuais de enum com segurança. Por isso,
-- pending_approval, SUBMIT e RETURN permanecem nos tipos, mas pending_approval volta a
-- ser rejeitado pela constraint original. Remover esses rótulos exigiria recriar tipos e
-- não integra este rollback.

begin;

drop trigger trg_00_audit_log_append_only on ltc_m.audit_log;
drop trigger trg_00_import_row_errors_append_only on ltc_m.import_row_errors;

drop trigger trg_90_import_row_errors_audit on ltc_m.import_row_errors;
drop trigger trg_90_import_batches_audit on ltc_m.import_batches;
drop trigger trg_90_financial_actual_events_audit on ltc_m.financial_actual_events;
drop trigger trg_90_financial_plan_lines_audit on ltc_m.financial_plan_lines;
drop trigger trg_90_financial_plan_scopes_audit on ltc_m.financial_plan_scopes;
drop trigger trg_90_plan_versions_audit on ltc_m.plan_versions;
drop trigger trg_90_project_items_audit on ltc_m.project_items;
drop trigger trg_90_projects_audit on ltc_m.projects;
drop trigger trg_90_clients_audit on ltc_m.clients;
drop trigger trg_90_app_users_audit on ltc_m.app_users;

drop trigger trg_00_import_row_errors_no_delete on ltc_m.import_row_errors;
drop trigger trg_00_import_batches_no_delete on ltc_m.import_batches;
drop trigger trg_00_financial_actual_events_no_delete on ltc_m.financial_actual_events;
drop trigger trg_00_financial_plan_lines_no_delete on ltc_m.financial_plan_lines;
drop trigger trg_00_financial_plan_scopes_no_delete on ltc_m.financial_plan_scopes;
drop trigger trg_00_plan_versions_no_delete on ltc_m.plan_versions;
drop trigger trg_00_project_items_no_delete on ltc_m.project_items;
drop trigger trg_00_projects_no_delete on ltc_m.projects;
drop trigger trg_00_clients_no_delete on ltc_m.clients;
drop trigger trg_00_units_no_delete on ltc_m.units;
drop trigger trg_00_currencies_no_delete on ltc_m.currencies;
drop trigger trg_00_app_users_no_delete on ltc_m.app_users;

drop trigger trg_05_project_items_inactivation on ltc_m.project_items;
drop trigger trg_05_projects_inactivation on ltc_m.projects;
drop trigger trg_05_clients_inactivation on ltc_m.clients;
drop trigger trg_05_app_users_inactivation on ltc_m.app_users;

drop trigger trg_10_import_batches_metadata on ltc_m.import_batches;
drop trigger trg_10_financial_actual_events_metadata on ltc_m.financial_actual_events;
drop trigger trg_20_financial_plan_lines_metadata on ltc_m.financial_plan_lines;
drop trigger trg_10_financial_plan_lines_protect on ltc_m.financial_plan_lines;
drop trigger trg_20_financial_plan_scopes_metadata on ltc_m.financial_plan_scopes;
drop trigger trg_10_financial_plan_scopes_protect on ltc_m.financial_plan_scopes;
drop trigger trg_20_plan_versions_metadata on ltc_m.plan_versions;
drop trigger trg_10_plan_versions_protect on ltc_m.plan_versions;
drop trigger trg_10_project_items_metadata on ltc_m.project_items;
drop trigger trg_10_projects_metadata on ltc_m.projects;
drop trigger trg_10_clients_metadata on ltc_m.clients;
drop trigger trg_10_app_users_metadata on ltc_m.app_users;

drop function ltc_m.reopen_plan_version(uuid, text);
drop function ltc_m.lock_plan_version(uuid);
drop function ltc_m.approve_plan_version(uuid);
drop function ltc_m.return_plan_version_to_draft(uuid);
drop function ltc_m.submit_plan_version(uuid);
drop function ltc_m.prevent_audit_log_change();
drop function ltc_m.prevent_append_only_change();
drop function ltc_m.audit_row_change();
drop function ltc_m.protect_plan_content();
drop function ltc_m.protect_plan_version();
drop function ltc_m.prevent_physical_delete();
drop function ltc_m.enforce_admin_inactivation();
drop function ltc_m.maintain_row_metadata();
drop function ltc_m.sanitize_audit_payload(text, jsonb);
drop function ltc_m.workflow_guard_active(text);
drop function ltc_m.current_justification(boolean);
drop function ltc_m.current_actor_id(boolean);
drop function ltc_m.set_actor_context(uuid, text, text, text, text, boolean);

drop index ltc_m.ix_plan_versions_source;

alter table ltc_m.plan_versions
    drop constraint ck_plan_versions_approval,
    add constraint ck_plan_versions_approval
        check (
            (
                status::text = 'draft'
                and approved_by_user_id is null
                and approved_at is null
            )
            or (
                status::text in ('approved', 'locked')
                and approved_by_user_id is not null
                and approved_at is not null
            )
            or status::text = 'archived'
        ),
    drop constraint ck_plan_versions_row_version,
    drop column source_plan_version_id,
    drop column updated_by_user_id,
    drop column row_version;

alter table ltc_m.audit_log
    drop constraint ck_audit_log_metadata_object,
    drop constraint ck_audit_log_row_versions,
    drop constraint ck_audit_log_justification,
    drop constraint ck_audit_log_source,
    drop constraint ck_audit_log_actor_auth_subject,
    drop column metadata,
    drop column new_row_version,
    drop column previous_row_version,
    drop column justification,
    drop column source,
    drop column actor_auth_subject;

alter table ltc_m.import_batches
    drop constraint ck_import_batches_row_version,
    drop column row_version,
    drop column updated_at;

alter table ltc_m.financial_actual_events
    drop constraint ck_financial_actual_events_row_version,
    drop column row_version;

alter table ltc_m.financial_plan_lines
    drop constraint ck_financial_plan_lines_row_version,
    drop column row_version;

alter table ltc_m.financial_plan_scopes
    drop constraint ck_financial_plan_scopes_row_version,
    drop column row_version;

alter table ltc_m.project_items
    drop constraint ck_project_items_row_version,
    drop column row_version;

alter table ltc_m.clients
    drop constraint ck_clients_row_version,
    drop column row_version;

alter table ltc_m.app_users
    drop constraint ck_app_users_row_version,
    drop column row_version;

commit;
