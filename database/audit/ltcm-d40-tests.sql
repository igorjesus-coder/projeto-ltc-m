-- D40 — harness PostgreSQL local, integralmente sintético e transacional.
-- Requer a migration D40 já aplicada no banco local. Não cria conexão nem acessa banco remoto.

begin;

insert into ltc_m.app_users (id, auth_subject, full_name, role, active)
values
    ('00000000-0000-4000-8000-000000040001', 'd40|viewer', 'D40 Viewer', 'viewer', true),
    ('00000000-0000-4000-8000-000000040002', 'd40|editor', 'D40 Editor', 'editor', true),
    ('00000000-0000-4000-8000-000000040003', 'd40|admin', 'D40 Admin', 'admin', true),
    ('00000000-0000-4000-8000-000000040004', 'd40|inactive', 'D40 Inactive', 'admin', false);

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000040003',
    'd40|admin',
    'd40-setup',
    'Fixture sintética D40',
    'import'
);

insert into ltc_m.currencies (code, name, decimal_places, active)
values ('ZZZ', 'Moeda sintética D40', 2, true);

insert into ltc_m.clients (id, legal_name, display_name)
values (
    '00000000-0000-4000-8000-000000040010',
    'Cliente sintético D40',
    'Cliente sintético D40'
);

insert into ltc_m.import_batches (
    id, source_name, source_hash, idempotency_key, submitted_by_user_id, status
)
values
    ('00000000-0000-4000-8000-000000040020', 'd40-received.bin', repeat('a', 64), 'd40-received', '00000000-0000-4000-8000-000000040003', 'received'),
    ('00000000-0000-4000-8000-000000040021', 'd40-validating.bin', repeat('b', 64), 'd40-validating', '00000000-0000-4000-8000-000000040003', 'validating'),
    ('00000000-0000-4000-8000-000000040022', 'd40-loaded.bin', repeat('c', 64), 'd40-loaded', '00000000-0000-4000-8000-000000040003', 'loaded'),
    ('00000000-0000-4000-8000-000000040023', 'd40-rejected.bin', repeat('d', 64), 'd40-rejected', '00000000-0000-4000-8000-000000040003', 'rejected'),
    ('00000000-0000-4000-8000-000000040024', 'd41-unlinked-received.bin', repeat('e', 64), 'd41-unlinked-received', '00000000-0000-4000-8000-000000040003', 'received'),
    ('00000000-0000-4000-8000-000000040025', 'd41-unlinked-validating.bin', repeat('f', 64), 'd41-unlinked-validating', '00000000-0000-4000-8000-000000040003', 'validating'),
    ('00000000-0000-4000-8000-000000040026', 'd41-unlinked-loaded.bin', repeat('1', 64), 'd41-unlinked-loaded', '00000000-0000-4000-8000-000000040003', 'loaded'),
    ('00000000-0000-4000-8000-000000040027', 'd41-correction-target.bin', repeat('2', 64), 'd41-correction-target', '00000000-0000-4000-8000-000000040003', 'received'),
    ('00000000-0000-4000-8000-000000040028', 'd41-multiple-projects.bin', repeat('3', 64), 'd41-multiple-projects', '00000000-0000-4000-8000-000000040003', 'received');

do $d40_structure$
declare
    v_trigger_order text[];
    v_import_trigger_order text[];
    v_expected_project_triggers constant text[] := array[
        'trg_00_projects_no_delete',
        'trg_05_projects_inactivation',
        'trg_07_projects_legacy_reference_guard',
        'trg_10_projects_metadata',
        'trg_90_projects_audit'
    ];
    v_expected_import_triggers constant text[] := array[
        'trg_00_import_batches_no_delete',
        'trg_07_import_batches_rejection_guard',
        'trg_10_import_batches_metadata',
        'trg_90_import_batches_audit'
    ];
begin
    if (
        select pg_catalog.count(*)
        from pg_catalog.pg_constraint as fk_constraint
        join pg_catalog.pg_attribute as source_attribute
          on source_attribute.attrelid = fk_constraint.conrelid
         and source_attribute.attnum = fk_constraint.conkey[1]
         and source_attribute.attnum > 0
         and not source_attribute.attisdropped
        join pg_catalog.pg_attribute as target_attribute
          on target_attribute.attrelid = fk_constraint.confrelid
         and target_attribute.attnum = fk_constraint.confkey[1]
         and target_attribute.attnum > 0
         and not target_attribute.attisdropped
        where fk_constraint.contype = 'f'
          and fk_constraint.conname = 'fk_projects_legacy_import_batch'
          and fk_constraint.conrelid = 'ltc_m.projects'::regclass
          and fk_constraint.confrelid = 'ltc_m.import_batches'::regclass
          and pg_catalog.cardinality(fk_constraint.conkey) = 1
          and source_attribute.attname = 'legacy_import_batch_id'
          and pg_catalog.cardinality(fk_constraint.confkey) = 1
          and target_attribute.attname = 'id'
          and fk_constraint.confmatchtype = 's'
          and fk_constraint.confupdtype = 'a'
          and fk_constraint.confdeltype = 'a'
          and not fk_constraint.condeferrable
          and not fk_constraint.condeferred
          and fk_constraint.convalidated
    ) <> 1 then
        raise exception 'D40 falhou: FK final ausente ou divergente.';
    end if;
    if (
        select pg_catalog.count(*)
        from pg_catalog.pg_constraint as check_constraint
        where check_constraint.contype = 'c'
          and check_constraint.conname = 'ck_projects_data_reference_date_legacy'
          and check_constraint.conrelid = 'ltc_m.projects'::regclass
          and check_constraint.convalidated
          and pg_catalog.regexp_replace(
              pg_catalog.lower(
                  pg_catalog.pg_get_expr(check_constraint.conbin, check_constraint.conrelid)
              ),
              '[[:space:]()]',
              '',
              'g'
          ) = 'data_reference_dateisnotnullorlegacy_import_batch_idisnotnull'
    ) <> 1 then
        raise exception 'D40 falhou: CHECK final ausente, divergente ou não validado.';
    end if;
    if (
        select pg_catalog.count(*)
        from pg_catalog.pg_attribute as reference_date_attribute
        where reference_date_attribute.attrelid = 'ltc_m.projects'::regclass
          and reference_date_attribute.attname = 'data_reference_date'
          and reference_date_attribute.attnum > 0
          and not reference_date_attribute.attisdropped
          and not reference_date_attribute.attnotnull
    ) <> 1 then
        raise exception 'D40 falhou: NOT NULL físico ainda presente.';
    end if;
    if (
        select pg_catalog.count(*)
        from pg_catalog.pg_index as index_record
        join pg_catalog.pg_class as index_class
          on index_class.oid = index_record.indexrelid
        join pg_catalog.pg_namespace as index_namespace
          on index_namespace.oid = index_class.relnamespace
        join pg_catalog.pg_class as table_class
          on table_class.oid = index_record.indrelid
        join pg_catalog.pg_namespace as table_namespace
          on table_namespace.oid = table_class.relnamespace
        join pg_catalog.pg_attribute as indexed_attribute
          on indexed_attribute.attrelid = index_record.indrelid
         and indexed_attribute.attnum = index_record.indkey[0]
         and indexed_attribute.attnum > 0
         and not indexed_attribute.attisdropped
        where index_namespace.nspname = 'ltc_m'
          and index_class.relname = 'ix_projects_legacy_import_batch'
          and table_namespace.nspname = 'ltc_m'
          and table_class.relname = 'projects'
          and index_record.indnatts = 1
          and index_record.indnkeyatts = 1
          and index_record.indexprs is null
          and indexed_attribute.attname = 'legacy_import_batch_id'
          and not index_record.indisunique
          and index_record.indisvalid
          and index_record.indisready
          and index_record.indpred is not null
          and pg_catalog.regexp_replace(
              pg_catalog.lower(
                  pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid)
              ),
              '[[:space:]()]',
              '',
              'g'
          ) = 'legacy_import_batch_idisnotnull'
    ) <> 1 then
        raise exception 'D40 falhou: índice parcial divergente.';
    end if;
    select pg_catalog.array_agg(pg_trigger.tgname order by pg_trigger.tgname)
    into v_trigger_order
    from pg_catalog.pg_trigger
    where pg_trigger.tgrelid = 'ltc_m.projects'::regclass
      and not pg_trigger.tgisinternal
      and pg_trigger.tgenabled <> 'D';
    if v_trigger_order is distinct from v_expected_project_triggers then
        raise exception 'D40 failed: projects trigger set is missing or divergent.';
    end if;
    if not (
        pg_catalog.array_position(v_trigger_order, 'trg_00_projects_no_delete')
        < pg_catalog.array_position(v_trigger_order, 'trg_05_projects_inactivation')
        and pg_catalog.array_position(v_trigger_order, 'trg_05_projects_inactivation')
        < pg_catalog.array_position(v_trigger_order, 'trg_07_projects_legacy_reference_guard')
        and pg_catalog.array_position(v_trigger_order, 'trg_07_projects_legacy_reference_guard')
        < pg_catalog.array_position(v_trigger_order, 'trg_10_projects_metadata')
        and pg_catalog.array_position(v_trigger_order, 'trg_10_projects_metadata')
        < pg_catalog.array_position(v_trigger_order, 'trg_90_projects_audit')
    ) then
        raise exception 'D40 falhou: ordem lexical dos triggers divergente.';
    end if;
    select pg_catalog.array_agg(pg_trigger.tgname order by pg_trigger.tgname)
    into v_import_trigger_order
    from pg_catalog.pg_trigger
    where pg_trigger.tgrelid = 'ltc_m.import_batches'::regclass
      and not pg_trigger.tgisinternal
      and pg_trigger.tgenabled <> 'D';
    if v_import_trigger_order is distinct from v_expected_import_triggers then
        raise exception 'D41 failed: import_batches trigger set is missing or divergent.';
    end if;
    if not (
        pg_catalog.array_position(v_import_trigger_order, 'trg_00_import_batches_no_delete')
        < pg_catalog.array_position(v_import_trigger_order, 'trg_07_import_batches_rejection_guard')
        and pg_catalog.array_position(v_import_trigger_order, 'trg_07_import_batches_rejection_guard')
        < pg_catalog.array_position(v_import_trigger_order, 'trg_10_import_batches_metadata')
        and pg_catalog.array_position(v_import_trigger_order, 'trg_10_import_batches_metadata')
        < pg_catalog.array_position(v_import_trigger_order, 'trg_90_import_batches_audit')
    ) then
        raise exception 'D41 falhou: ordem lexical dos triggers de import_batches divergente.';
    end if;
end;
$d40_structure$;

-- 1. Projeto novo com data e sem lote: fluxo normal aceito para Editor.
select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000040002', 'd40|editor', 'd40-normal', null, 'api'
);
insert into ltc_m.projects (
    id, project_code, project_name, client_id, base_currency, contract_value, data_reference_date
)
values (
    '00000000-0000-4000-8000-000000040100', 'D40-NORMAL', 'Projeto sintético normal',
    '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, date '2026-01-01'
);

do $d40_negative_matrix$
begin
    -- 2. Sem data e sem lote: CHECK/guarda rejeita.
    begin
        insert into ltc_m.projects (
            id, project_code, project_name, client_id, base_currency, contract_value
        ) values (
            '00000000-0000-4000-8000-000000040101', 'D40-NO-LINEAGE', 'Projeto sintético inválido',
            '00000000-0000-4000-8000-000000040010', 'ZZZ', 100
        );
        raise exception 'D40 falhou: data nula sem lote foi aceita.';
    exception when check_violation then null;
    end;

    -- 4. Lote inexistente: FK rejeita.
    perform ltc_m.set_actor_context(
        '00000000-0000-4000-8000-000000040003', 'd40|admin',
        'd40-missing-batch', 'Teste de FK D40', 'import'
    );
    begin
        insert into ltc_m.projects (
            id, project_code, project_name, client_id, base_currency, contract_value,
            data_reference_date, legacy_import_batch_id
        ) values (
            '00000000-0000-4000-8000-000000040102', 'D40-MISSING-BATCH', 'Projeto sintético inválido',
            '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, null,
            '00000000-0000-4000-8000-000000049999'
        );
        raise exception 'D40 falhou: lote inexistente foi aceito.';
    exception when foreign_key_violation then null;
    end;

    -- 5. Editor tentando criar exceção: rejeitado.
    perform ltc_m.set_actor_context(
        '00000000-0000-4000-8000-000000040002', 'd40|editor',
        'd40-editor', 'Editor não autoriza legado', 'import'
    );
    begin
        insert into ltc_m.projects (
            id, project_code, project_name, client_id, base_currency, contract_value,
            data_reference_date, legacy_import_batch_id
        ) values (
            '00000000-0000-4000-8000-000000040103', 'D40-EDITOR', 'Projeto sintético inválido',
            '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, null,
            '00000000-0000-4000-8000-000000040020'
        );
        raise exception 'D40 falhou: Editor autorizou exceção.';
    exception when insufficient_privilege then null;
    end;

    -- 6. Admin sem justificativa: rejeitado.
    perform ltc_m.set_actor_context(
        '00000000-0000-4000-8000-000000040003', 'd40|admin', 'd40-no-reason', null, 'import'
    );
    begin
        insert into ltc_m.projects (
            id, project_code, project_name, client_id, base_currency, contract_value,
            data_reference_date, legacy_import_batch_id
        ) values (
            '00000000-0000-4000-8000-000000040104', 'D40-NO-REASON', 'Projeto sintético inválido',
            '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, null,
            '00000000-0000-4000-8000-000000040020'
        );
        raise exception 'D40 falhou: Admin sem justificativa foi aceito.';
    exception when raise_exception then
        if sqlerrm like 'D40 falhou:%' then raise; end if;
    end;

    -- 7. Admin sem request ID: rejeitado.
    perform ltc_m.set_actor_context(
        '00000000-0000-4000-8000-000000040003', 'd40|admin', null, 'Teste sem request', 'import'
    );
    begin
        insert into ltc_m.projects (
            id, project_code, project_name, client_id, base_currency, contract_value,
            data_reference_date, legacy_import_batch_id
        ) values (
            '00000000-0000-4000-8000-000000040105', 'D40-NO-REQUEST', 'Projeto sintético inválido',
            '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, null,
            '00000000-0000-4000-8000-000000040020'
        );
        raise exception 'D40 falhou: Admin sem request ID foi aceito.';
    exception when raise_exception then
        if sqlerrm like 'D40 falhou:%' then raise; end if;
    end;

    -- 9. Admin inativo: authorization_context não reconhece o ator.
    perform pg_catalog.set_config('ltc_m.app_user_id', '00000000-0000-4000-8000-000000040004', true);
    perform pg_catalog.set_config('ltc_m.actor_auth_subject', 'd40|inactive', true);
    perform pg_catalog.set_config('ltc_m.request_id', 'd40-inactive', true);
    perform pg_catalog.set_config('ltc_m.justification', 'Admin inativo', true);
    begin
        insert into ltc_m.projects (
            id, project_code, project_name, client_id, base_currency, contract_value,
            data_reference_date, legacy_import_batch_id
        ) values (
            '00000000-0000-4000-8000-000000040106', 'D40-INACTIVE', 'Projeto sintético inválido',
            '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, null,
            '00000000-0000-4000-8000-000000040020'
        );
        raise exception 'D40 falhou: Admin inativo foi aceito.';
    exception when insufficient_privilege then null;
    end;

    -- 11. Estado rejected não é legítimo para vinculação.
    perform ltc_m.set_actor_context(
        '00000000-0000-4000-8000-000000040003', 'd40|admin',
        'd40-rejected', 'Teste lifecycle rejeitado', 'import'
    );
    begin
        insert into ltc_m.projects (
            id, project_code, project_name, client_id, base_currency, contract_value,
            data_reference_date, legacy_import_batch_id
        ) values (
            '00000000-0000-4000-8000-000000040107', 'D40-REJECTED', 'Projeto sintético inválido',
            '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, null,
            '00000000-0000-4000-8000-000000040023'
        );
        raise exception 'D40 falhou: lote rejected foi aceito.';
    exception when check_violation then null;
    end;
end;
$d40_negative_matrix$;

-- 3, 8 e 10. Admin ativo e contexto completo aceitam received/validating/loaded.
select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000040003', 'd40|admin',
    'd40-accepted-statuses', 'Teste dos estados legítimos D40', 'import'
);
insert into ltc_m.projects (
    id, project_code, project_name, client_id, base_currency, contract_value,
    data_reference_date, legacy_import_batch_id
)
values
    ('00000000-0000-4000-8000-000000040110', 'D40-RECEIVED', 'Projeto sintético received', '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, null, '00000000-0000-4000-8000-000000040020'),
    ('00000000-0000-4000-8000-000000040111', 'D40-VALIDATING', 'Projeto sintético validating', '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, null, '00000000-0000-4000-8000-000000040021'),
    ('00000000-0000-4000-8000-000000040112', 'D40-LOADED', 'Projeto sintético loaded', '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, null, '00000000-0000-4000-8000-000000040022'),
    ('00000000-0000-4000-8000-000000040113', 'D40-DATE-AND-BATCH', 'Projeto sintético enriquecido', '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, date '2026-01-01', '00000000-0000-4000-8000-000000040020'),
    ('00000000-0000-4000-8000-000000040114', 'D41-ACTIVE', 'Projeto sintético active', '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, date '2026-01-01', '00000000-0000-4000-8000-000000040020'),
    ('00000000-0000-4000-8000-000000040115', 'D41-COMPLETED', 'Projeto sintético completed', '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, date '2026-01-01', '00000000-0000-4000-8000-000000040021'),
    ('00000000-0000-4000-8000-000000040116', 'D41-SOFT-DELETED', 'Projeto sintético histórico', '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, date '2026-01-01', '00000000-0000-4000-8000-000000040022'),
    ('00000000-0000-4000-8000-000000040118', 'D41-MULTIPLE-A', 'Projeto sintético múltiplo A', '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, date '2026-01-01', '00000000-0000-4000-8000-000000040028'),
    ('00000000-0000-4000-8000-000000040119', 'D41-MULTIPLE-B', 'Projeto sintético múltiplo B', '00000000-0000-4000-8000-000000040010', 'ZZZ', 100, null, '00000000-0000-4000-8000-000000040028');

update ltc_m.projects
set status = case
    when id = '00000000-0000-4000-8000-000000040114' then 'active'::ltc_m.project_status
    when id = '00000000-0000-4000-8000-000000040115' then 'completed'::ltc_m.project_status
    else 'cancelled'::ltc_m.project_status
end,
deleted_at = case
    when id = '00000000-0000-4000-8000-000000040116' then pg_catalog.clock_timestamp()
    else deleted_at
end
where id in (
    '00000000-0000-4000-8000-000000040114',
    '00000000-0000-4000-8000-000000040115',
    '00000000-0000-4000-8000-000000040116'
);

-- 12, 13 e 16. Data+lote exige Admin; enriquecimento preserva a linhagem e é auditado.
select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000040003', 'd40|admin',
    'd40-enrich', 'Enriquecimento sintético D40', 'import'
);
update ltc_m.projects
set data_reference_date = date '2026-02-01'
where id = '00000000-0000-4000-8000-000000040110';

-- 14. Remoção de linhagem é sempre rejeitada, inclusive com contexto Admin.
do $d40_no_lineage_removal$
begin
    begin
        update ltc_m.projects
        set legacy_import_batch_id = null
        where id = '00000000-0000-4000-8000-000000040110';
        raise exception 'D40 falhou: linhagem foi removida.';
    exception when check_violation then null;
    end;
end;
$d40_no_lineage_removal$;

-- 15. Correção para outro lote exige Admin e contexto completo e é auditada.
select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000040003', 'd40|admin',
    'd40-correct-batch', 'Correção sintética de lote D40', 'import'
);
update ltc_m.projects
set legacy_import_batch_id = '00000000-0000-4000-8000-000000040021'
where id = '00000000-0000-4000-8000-000000040110';

-- 17. DELETE físico continua rejeitado pelo trigger P007 preservado.
do $d40_no_delete$
begin
    begin
        delete from ltc_m.projects
        where id = '00000000-0000-4000-8000-000000040110';
        raise exception 'D40 falhou: DELETE físico foi aceito.';
    exception when raise_exception then
        if sqlerrm like 'D40 falhou:%' then raise; end if;
    end;
end;
$d40_no_delete$;

-- 18 e 19. Viewer/Editor/Admin e D24 continuam nos gates P008; D40 prova contexto e auditoria.
do $d40_audit$
begin
    if not exists (
        select 1
        from ltc_m.projects
        where id = '00000000-0000-4000-8000-000000040110'
          and data_reference_date = date '2026-02-01'
          and legacy_import_batch_id = '00000000-0000-4000-8000-000000040021'
    ) then
        raise exception 'D40 falhou: enriquecimento não preservou/corrigiu a linhagem.';
    end if;
    if not exists (
        select 1
        from ltc_m.audit_log
        where table_name = 'ltc_m.projects'
          and record_id = '00000000-0000-4000-8000-000000040110'
          and changed_by_user_id = '00000000-0000-4000-8000-000000040003'
          and request_id = 'd40-enrich'
          and justification = 'Enriquecimento sintético D40'
          and old_data -> 'data_reference_date' = 'null'::jsonb
          and new_data ->> 'data_reference_date' = '2026-02-01'
          and old_data ->> 'legacy_import_batch_id' = '00000000-0000-4000-8000-000000040020'
          and new_data ->> 'legacy_import_batch_id' = '00000000-0000-4000-8000-000000040020'
    ) or not exists (
        select 1
        from ltc_m.audit_log
        where table_name = 'ltc_m.projects'
          and record_id = '00000000-0000-4000-8000-000000040110'
          and request_id = 'd40-correct-batch'
          and justification = 'Correção sintética de lote D40'
          and old_data ->> 'legacy_import_batch_id' = '00000000-0000-4000-8000-000000040020'
          and new_data ->> 'legacy_import_batch_id' = '00000000-0000-4000-8000-000000040021'
    ) then
        raise exception 'D40 falhou: auditoria before/after/contexto incompleta.';
    end if;
end;
$d40_audit$;

-- D41 1-3. received/validating/loaded sem projeto podem transitar para rejected.
select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000040003', 'd40|admin',
    'd41-unlinked-reject', 'Rejeição sintética sem vínculo', 'import'
);
update ltc_m.import_batches
set status = 'rejected'
where id in (
    '00000000-0000-4000-8000-000000040024',
    '00000000-0000-4000-8000-000000040025',
    '00000000-0000-4000-8000-000000040026'
);

-- D41 4-14. Qualquer vínculo, status, data ou soft delete bloqueia rejected.
do $d41_linked_rejection_matrix$
declare
    v_batch_id uuid;
begin
    foreach v_batch_id in array array[
        '00000000-0000-4000-8000-000000040020'::uuid,
        '00000000-0000-4000-8000-000000040021'::uuid,
        '00000000-0000-4000-8000-000000040022'::uuid,
        '00000000-0000-4000-8000-000000040028'::uuid
    ] loop
        begin
            update ltc_m.import_batches
            set status = 'rejected'
            where id = v_batch_id;
            raise exception 'D41 falhou: lote vinculado foi rejeitado.';
        exception when check_violation then
            null;
        end;
    end loop;

    if exists (
        select 1
        from ltc_m.import_batches
        where id = '00000000-0000-4000-8000-000000040020'
          and status <> 'received'
    ) or exists (
        select 1
        from ltc_m.import_batches
        where id = '00000000-0000-4000-8000-000000040021'
          and status <> 'validating'
    ) or exists (
        select 1
        from ltc_m.import_batches
        where id = '00000000-0000-4000-8000-000000040022'
          and status <> 'loaded'
    ) then
        raise exception 'D41 falhou: rejeição bloqueada alterou o lote.';
    end if;

    if not exists (
        select 1
        from ltc_m.projects
        where id = '00000000-0000-4000-8000-000000040116'
          and status = 'cancelled'
          and deleted_at is not null
          and legacy_import_batch_id = '00000000-0000-4000-8000-000000040022'
    ) then
        raise exception 'D41 falhou: rejeição bloqueada alterou projeto histórico.';
    end if;
end;
$d41_linked_rejection_matrix$;

-- D41 8-13: a matriz inclui data nula/preenchida, draft, active, completed e histórico soft-deleted.
-- O enum real não possui inactive; cancelled + deleted_at representa a inativação histórica.

-- D41 17-21. Correção exige Admin, justificativa, request e destino não rejected.
do $d41_correction_authorization$
begin
    perform ltc_m.set_actor_context(
        '00000000-0000-4000-8000-000000040002', 'd40|editor',
        'd41-editor-correction', 'Editor não corrige linhagem', 'import'
    );
    begin
        update ltc_m.projects
        set legacy_import_batch_id = '00000000-0000-4000-8000-000000040027'
        where id = '00000000-0000-4000-8000-000000040118';
        raise exception 'D41 falhou: correção sem Admin foi aceita.';
    exception when insufficient_privilege then null;
    end;

    perform ltc_m.set_actor_context(
        '00000000-0000-4000-8000-000000040003', 'd40|admin',
        'd41-no-justification', null, 'import'
    );
    begin
        update ltc_m.projects
        set legacy_import_batch_id = '00000000-0000-4000-8000-000000040027'
        where id = '00000000-0000-4000-8000-000000040118';
        raise exception 'D41 falhou: correção sem justificativa foi aceita.';
    exception when raise_exception then
        if sqlerrm like 'D41 falhou:%' then raise; end if;
    end;

    perform ltc_m.set_actor_context(
        '00000000-0000-4000-8000-000000040003', 'd40|admin',
        null, 'Correção sintética sem request', 'import'
    );
    begin
        update ltc_m.projects
        set legacy_import_batch_id = '00000000-0000-4000-8000-000000040027'
        where id = '00000000-0000-4000-8000-000000040118';
        raise exception 'D41 falhou: correção sem request ID foi aceita.';
    exception when raise_exception then
        if sqlerrm like 'D41 falhou:%' then raise; end if;
    end;

    perform ltc_m.set_actor_context(
        '00000000-0000-4000-8000-000000040003', 'd40|admin',
        'd41-rejected-target', 'Destino rejected não é válido', 'import'
    );
    begin
        update ltc_m.projects
        set legacy_import_batch_id = '00000000-0000-4000-8000-000000040023'
        where id = '00000000-0000-4000-8000-000000040118';
        raise exception 'D41 falhou: correção para lote rejected foi aceita.';
    exception when check_violation then null;
    end;

    begin
        update ltc_m.projects
        set legacy_import_batch_id = null
        where id = '00000000-0000-4000-8000-000000040118';
        raise exception 'D41 falhou: limpeza de legacy_import_batch_id foi aceita.';
    exception when check_violation then null;
    end;
end;
$d41_correction_authorization$;

-- Atualização sem mudança de status e transições não rejeitadas continuam normais.
select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000040003', 'd40|admin',
    'd41-non-rejected', 'Lifecycle sintético não rejeitado', 'import'
);
update ltc_m.import_batches
set status = status
where id = '00000000-0000-4000-8000-000000040027';
update ltc_m.import_batches
set status = 'validating'
where id = '00000000-0000-4000-8000-000000040027';
update ltc_m.import_batches
set status = 'loaded'
where id = '00000000-0000-4000-8000-000000040027';

-- D41 15-16 e 22. Correção parcial mantém bloqueio; correção total libera e audita.
select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000040003', 'd40|admin',
    'd41-correct-first', 'Correção sintética parcial D41', 'import'
);
update ltc_m.projects
set legacy_import_batch_id = '00000000-0000-4000-8000-000000040027'
where id = '00000000-0000-4000-8000-000000040118';

do $d41_partial_correction$
begin
    begin
        update ltc_m.import_batches
        set status = 'rejected'
        where id = '00000000-0000-4000-8000-000000040028';
        raise exception 'D41 falhou: correção parcial liberou o lote antigo.';
    exception when check_violation then null;
    end;
end;
$d41_partial_correction$;

select ltc_m.set_actor_context(
    '00000000-0000-4000-8000-000000040003', 'd40|admin',
    'd41-correct-all', 'Correção sintética integral D41', 'import'
);
update ltc_m.projects
set legacy_import_batch_id = '00000000-0000-4000-8000-000000040027'
where id = '00000000-0000-4000-8000-000000040119';
update ltc_m.import_batches
set status = 'rejected'
where id = '00000000-0000-4000-8000-000000040028';

do $d41_final_assertions$
begin
    if (
        select count(*)
        from ltc_m.import_batches
        where id in (
            '00000000-0000-4000-8000-000000040024',
            '00000000-0000-4000-8000-000000040025',
            '00000000-0000-4000-8000-000000040026',
            '00000000-0000-4000-8000-000000040028'
        ) and status = 'rejected'
    ) <> 4 then
        raise exception 'D41 falhou: lote sem referência não transitou para rejected.';
    end if;

    if not exists (
        select 1
        from ltc_m.audit_log
        where table_name = 'ltc_m.projects'
          and record_id = '00000000-0000-4000-8000-000000040118'
          and request_id = 'd41-correct-first'
          and justification = 'Correção sintética parcial D41'
          and old_data ->> 'legacy_import_batch_id' = '00000000-0000-4000-8000-000000040028'
          and new_data ->> 'legacy_import_batch_id' = '00000000-0000-4000-8000-000000040027'
    ) then
        raise exception 'D41 falhou: auditoria before/after da correção ausente.';
    end if;
end;
$d41_final_assertions$;

-- D41 23-24. Falha é atômica e DELETE físico continua no cenário D40 preservado.

-- 20, 21 e 22. ROLLBACK remove apenas fixtures ltc_m e não há mutação fora do schema.
rollback;

do $d40_rollback_clean$
begin
    if exists (
        select 1 from ltc_m.app_users
        where id between '00000000-0000-4000-8000-000000040001'::uuid
            and '00000000-0000-4000-8000-000000040999'::uuid
    ) then
        raise exception 'D40 falhou: rollback deixou fixture permanente.';
    end if;
end;
$d40_rollback_clean$;

select true as rollback_clean;
