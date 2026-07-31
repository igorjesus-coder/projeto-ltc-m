# Relatório de validação dinâmica P008 / 1.08

**Status: Concluída**  
**Execução final:** `r20260731-d28-final`  
**Ambiente:** projeto Supabase `Funcionarios`, `us-east-1`, PostgreSQL 17.4

## D28 e causa do 42501

A auditoria do grafo confirmou que `ltc_m.maintain_row_metadata()` é `SECURITY INVOKER` e chama
`ltc_m.current_actor_id(boolean)` em INSERT/UPDATE. O helper estava sem `EXECUTE` para
`ltc_m_runtime`; por isso o Editor recebia `42501`. A migration D28 concedeu somente essa função,
com assinatura completa, e manteve `PUBLIC EXECUTE` revogado.

## Resultado da execução

As 18 etapas do harness passaram: preflight D26, reversibilidade, concessão temporária D27,
contexto inválido, Viewer, Editor workflow e DML, Admin/D24, D23 sequencial e concorrente,
regressão P007, suíte abrangente P008, cleanup `finally`, estado final, pós-check estrutural e
fingerprint pós. O Editor DML passou sem `42501`.

D23 concorrente usou duas conexões administrativas independentes, confirmou `session_user=postgres`
e `current_user=ltc_m_runtime` após `SET ROLE`, e comprovou contenção do advisory lock (`70.072 ms`).
D24 comprovou consulta somente por função, sanitização, evento `AUDIT_READ` e ausência de SELECT
direto em `audit_log`.

`rollback_clean=true`: concessão temporária removida, somente D26 permaneceu, dados sintéticos e
locks residuais foram eliminados.

## Estado observado

- migrations alinhadas: `9`;
- runtime functions: `9`; `PUBLIC EXECUTE`: `0`;
- policies: `35`; tabelas RLS+FORCE: `13`;
- BRL/US: `1/1`; tabelas operacionais, `app_users` e `audit_log`: vazias;
- fingerprint externo preservado: `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`.

O resultado estruturado e o histórico das tentativas anteriores estão em
[`p008-runtime-validation-result.json`](p008-runtime-validation-result.json). A matriz completa do
grafo está em [`p008-d28-function-audit.md`](p008-d28-function-audit.md).
