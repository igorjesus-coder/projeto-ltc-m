begin;

lock table ltc_m.currencies in share row exclusive mode;
lock table ltc_m.units in share row exclusive mode;

do $seed$
begin
    if exists (
        select 1
        from ltc_m.currencies
        where
            code = 'BRL'
            and (
                name is distinct from 'Real brasileiro'
                or decimal_places is distinct from 2
                or active is distinct from true
            )
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'Seed LTC-M bloqueado: BRL existente diverge de Real brasileiro, 2 casas decimais e ativo=true.';
    end if;

    if exists (
        select 1
        from ltc_m.currencies
        where
            code = 'USD'
            and (
                name is distinct from 'Dólar americano'
                or decimal_places is distinct from 2
                or active is distinct from true
            )
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'Seed LTC-M bloqueado: USD existente diverge de Dólar americano, 2 casas decimais e ativo=true.';
    end if;

    if exists (
        select 1
        from ltc_m.units
        where
            code = 'US'
            and (
                name is distinct from 'Unidade e Serviço'
                or category is not null
                or active is distinct from true
            )
    ) then
        raise exception using
            errcode = 'P0001',
            message = 'Seed LTC-M bloqueado: US existente diverge de Unidade e Serviço, sem categoria e ativo=true.';
    end if;
end;
$seed$;

insert into ltc_m.currencies (code, name, decimal_places, active)
select 'BRL', 'Real brasileiro', 2, true
where not exists (
    select 1
    from ltc_m.currencies
    where code = 'BRL'
);

insert into ltc_m.currencies (code, name, decimal_places, active)
select 'USD', 'Dólar americano', 2, true
where not exists (
    select 1
    from ltc_m.currencies
    where code = 'USD'
);

insert into ltc_m.units (code, name, active)
select 'US', 'Unidade e Serviço', true
where not exists (
    select 1
    from ltc_m.units
    where code = 'US'
);

commit;
