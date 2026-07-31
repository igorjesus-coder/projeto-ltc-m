# P008 / 1.08 — relatório pós-aplicação D28

## Resultado

**Status: Concluída.** A única migration corretiva D28 foi aplicada no projeto `Funcionarios`,
região `us-east-1`, após preflight e dry-run aprovados. O harness D27 integral foi executado em
`r20260731-d28-final` e terminou com `rollback_clean=true`.

Migration: [`20260731120000_fix_ltcm_runtime_function_acl.sql`](../../supabase/migrations/20260731120000_fix_ltcm_runtime_function_acl.sql)

SHA-256: `E2CF2E94DCC14713840472684D90369E76A889E30E0C45198B533D8A92F729A8`

## Gates remotos

| Gate                 | Resultado                                                                         |
| -------------------- | --------------------------------------------------------------------------------- |
| preflight read-only  | aprovado: PostgreSQL 17.4, oito migrations P008 alinhadas antes de D28, D26 exato |
| dry-run              | listou exclusivamente a migration D28; sem seed/roles                             |
| push                 | um único `supabase db push --linked`, concluído                                   |
| migrations finais    | nove locais/remotas alinhadas                                                     |
| delta                | somente `REVOKE/GRANT EXECUTE` de `ltc_m.current_actor_id(boolean)`               |
| policies/tabelas/RLS | 35 policies; 13 tabelas RLS+FORCE, sem alteração                                  |
| roles/memberships    | runtime inalterado; somente D26, sem grantor `postgres` permanente                |

## ACL e catálogo final

- runtime `NOLOGIN`, `NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`;
- ownership do runtime: `0`;
- funções executáveis pelo runtime: `9` (allowlist documentada);
- `PUBLIC EXECUTE`: `0`;
- `current_actor_id(boolean)`: runtime `false → true`, PUBLIC permanece `false`;
- grants diretos externos: `0`; acesso direto a `audit_log`: `false`;
- `BRL=1`, `US=1`, `US = Unidade e Serviço`;
- tabelas operacionais, `app_users` e `audit_log`: `0`.

O erro `42501` foi causado pelo trigger P007 `maintain_row_metadata()` (`SECURITY INVOKER`), que
chama `current_actor_id(boolean)` sem `EXECUTE` para o runtime. Nenhuma policy, corpo de função,
tabela, role ou membership foi alterada para corrigi-lo.

## Harness D27 pós-D28

Todas as etapas passaram: contexto inválido, Viewer, Editor workflow/DML, Admin, D24, D23
sequencial e concorrente, regressão P007, suíte abrangente P008, limpeza `finally` e pós-check.
A concorrência usou duas conexões administrativas independentes com `SET ROLE`; duração de
`70.072 ms` e diferença observada de `15.816 ms` comprovaram a contenção do advisory lock.

Membership final D26: `ltc_m_runtime → postgres`, grantor `supabase_admin`, `admin=true`,
`inherit=false`, `set=false`. Dados sintéticos e locks residuais não permaneceram.

## Fingerprints

| Escopo     | Pré-D28                                                            | Pós-D28                                                            |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| externo    | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` |
| `ltc_m`    | `EB3431F03FEFAEED558F8F5AB4A70F1EDA7ADC6A445AF47D1A9A200AAE064D34` | `F4A1681530F50790B97250F1BDF4C3577AE808376821B8A00E74A90A70019154` |
| migrations | `0C71EF52C4F1107560A0D2E093A3E6C20A31FF4C0A8F1CD9489F52C876188281` | `A4DD8FF011E5AD3AB56247437D61EBC5C87BE7930830F213F3B821BD430BBFC3` |

Inventários: [`p008-d28-inventory-pre.json`](p008-d28-inventory-pre.json),
[`p008-d28-inventory-post.json`](p008-d28-inventory-post.json) e
[`p008-d28-acl-inventory.json`](p008-d28-acl-inventory.json).

Não foram executados SQL Editor, DDL manual, `repair`, `reset`, `pull`, migration down, segundo
push, commit, merge ou push Git. O aviso de cache da CLI ocorreu após a aplicação, por ausência
de Docker local, e não alterou o banco remoto.
