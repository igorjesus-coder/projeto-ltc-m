begin;

alter type ltc_m.plan_status
    add value 'pending_approval' after 'draft';

alter type ltc_m.audit_operation
    add value 'SUBMIT' after 'UPDATE';

alter type ltc_m.audit_operation
    add value 'RETURN' after 'SUBMIT';

commit;
