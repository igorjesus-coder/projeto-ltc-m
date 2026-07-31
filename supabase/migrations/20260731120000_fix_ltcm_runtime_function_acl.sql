begin;

revoke execute on function ltc_m.current_actor_id(boolean) from public;
grant execute on function ltc_m.current_actor_id(boolean) to ltc_m_runtime;

comment on function ltc_m.current_actor_id(boolean) is
    'Runtime ACL D28: helper invoker de maintain_row_metadata valida o ator ativo sem conceder acesso adicional a tabelas.';

commit;
