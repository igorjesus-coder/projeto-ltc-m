begin;

alter table ltc_m.plan_versions
    add column content_revision bigint not null default 1,
    add constraint ck_plan_versions_content_revision check (content_revision > 0);

comment on column ltc_m.plan_versions.content_revision is
    'Revisão monotônica do conteúdo mensal editável; usada para concorrência de batches P029.';

commit;
