# D28 — relatório pré-aplicação

Data: 31/07/2026. Alvo: `Funcionarios`, `us-east-1`, PostgreSQL 17.4.

O preflight read-only confirmou oito migrations P008 alinhadas, runtime
`NOLOGIN`/`NOBYPASSRLS`, sem ownership, 13 tabelas RLS+FORCE, 35 policies, zero dados
operacionais, BRL/US íntegros e membership D26 exato (`supabase_admin`, admin=true,
inherit=false, set=false). `PUBLIC EXECUTE` era zero; a allowlist tinha oito funções e
`ltc_m.current_actor_id(boolean)` tinha `EXECUTE=false` para o runtime.

Fingerprints pré-D28:

- externo: `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`;
- `ltc_m`: `EB3431F03FEFAEED558F8F5AB4A70F1EDA7ADC6A445AF47D1A9A200AAE064D34`;
- migrations: `0C71EF52C4F1107560A0D2E093A3E6C20A31FF4C0A8F1CD9489F52C876188281`.

O dry-run listou somente `20260731120000_fix_ltcm_runtime_function_acl.sql`. A migration foi
aprovada pela D28 para executar apenas um `REVOKE` em PUBLIC, um `GRANT` ao runtime e um
comentário técnico; não havia alteração prevista em policies, tabelas, roles, memberships,
dados ou objetos externos.

Inventário: [`p008-d28-inventory-pre.json`](p008-d28-inventory-pre.json). Matriz do grafo:
[`p008-d28-function-audit.md`](p008-d28-function-audit.md).
