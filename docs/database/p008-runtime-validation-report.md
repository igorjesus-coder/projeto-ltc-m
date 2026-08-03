# Relatório de validação dinâmica P008 / 1.08

> Continuação P009 (03/08/2026): a execução `r20260803124900-7372310e` manteve P008 aprovada. As
> regressões P007/P008, D23, cleanup D27, D26 e fingerprints passaram com dez migrations, 15
> tabelas RLS/FORCE e 41 policies. Somente a etapa P009 ficou incompleta por erro sintático do
> renderizador local; consulte o relatório P009 e o resultado estruturado atual.

> D30 (03/08/2026): a única reexecução `r20260803132652-ada2b257` confirmou novamente P008,
> P007, D23, cleanup D27, D26 e fingerprints. A etapa P009 ainda ficou incompleta por um segundo
> erro local, agora na aridade do INSERT de fixtures. `rollback_clean=true`; nenhuma regressão
> P008 foi observada.

> D33 (03/08/2026): a única validação final `r20260803173036-ddabb07d` confirmou P008, P007, D23,
> D24, cleanup D27, D26 e fingerprints no envelope terminal íntegro. Código 0,
> `rollback_clean=true` e nenhuma regressão P008.

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

O resultado estruturado atual, incluindo a continuação P009, e o histórico das tentativas
anteriores estão em
[`p008-runtime-validation-result.json`](p008-runtime-validation-result.json). A matriz completa do
grafo está em [`p008-d28-function-audit.md`](p008-d28-function-audit.md).
