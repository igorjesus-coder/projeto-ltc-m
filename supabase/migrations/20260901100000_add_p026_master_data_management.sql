alter table ltc_m.currencies
    add column updated_at timestamptz not null default now(),
    add column row_version bigint not null default 1,
    add constraint ck_currencies_row_version check (row_version > 0);

alter table ltc_m.units
    add column updated_at timestamptz not null default now(),
    add column row_version bigint not null default 1,
    add constraint ck_units_row_version check (row_version > 0);

create trigger trg_05_currencies_inactivation
    before update on ltc_m.currencies
    for each row execute function ltc_m.enforce_admin_inactivation();

create trigger trg_10_currencies_metadata
    before insert or update on ltc_m.currencies
    for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_90_currencies_audit
    after insert or update on ltc_m.currencies
    for each row execute function ltc_m.audit_row_change();

create trigger trg_05_units_inactivation
    before update on ltc_m.units
    for each row execute function ltc_m.enforce_admin_inactivation();

create trigger trg_10_units_metadata
    before insert or update on ltc_m.units
    for each row execute function ltc_m.maintain_row_metadata('row_version');

create trigger trg_90_units_audit
    after insert or update on ltc_m.units
    for each row execute function ltc_m.audit_row_change();

drop policy clients_insert on ltc_m.clients;
drop policy clients_update on ltc_m.clients;

create policy clients_insert
    on ltc_m.clients
    for insert
    to ltc_m_runtime
    with check (
        exists (
            select 1
            from ltc_m.authorization_context()
            where authorization_context.app_role = 'admin'::ltc_m.app_role
        )
    );

create policy clients_update
    on ltc_m.clients
    for update
    to ltc_m_runtime
    using (
        exists (
            select 1
            from ltc_m.authorization_context()
            where authorization_context.app_role = 'admin'::ltc_m.app_role
        )
    )
    with check (
        exists (
            select 1
            from ltc_m.authorization_context()
            where authorization_context.app_role = 'admin'::ltc_m.app_role
        )
    );
