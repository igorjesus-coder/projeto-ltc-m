-- NÃO EXECUTAR AUTOMATICAMENTE.
--
-- Rollback manual da P006 / 1.06.
-- Remove somente os quatro índices adicionados pela migration P006 em ltc_m.
-- Exige autorização explícita, janela controlada e nova auditoria de fingerprint.

begin;

drop index ltc_m.ix_financial_actual_events_item_date;
drop index ltc_m.ix_financial_plan_lines_item_month;
drop index ltc_m.ix_financial_plan_lines_version_month;
drop index ltc_m.ix_financial_plan_scopes_project_version;

commit;
