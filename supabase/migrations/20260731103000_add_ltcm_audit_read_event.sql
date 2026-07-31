begin;

alter type ltc_m.audit_operation
    add value 'AUDIT_READ' after 'RETURN';

commit;
