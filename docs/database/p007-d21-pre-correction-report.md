# Relatório pré-correção D21 — P007 / 1.07

## Estado

Preflight D21 em preparação. Nenhuma escrita remota D21 foi executada.

## Autorização formal D21

O responsável autorizou explicitamente a criação e a aplicação de uma segunda e única migration
forward corretiva para o erro PostgreSQL `42703` no projeto `Funcionarios`, região `us-east-1`,
exclusivamente no schema `ltc_m`, mesmo sem backup recuperável.

A autorização:

- permite somente a auditoria, uma migration D21, testes/scanners, preflight, dry-run, um único
  `supabase db push --linked`, suíte P007 integral e auditoria posterior;
- mantém imutáveis as cinco migrations já aplicadas;
- não permite segunda migration D21, segundo push, rollback automático, `repair`, reset, pull,
  migration down, SQL Editor ou DDL manual;
- não permite seed, RLS, policies, roles, grants, revokes, extensões ou objetos externos;
- não permite iniciar P008;
- exige interrupção se o fingerprint externo divergir.

## Estado inicial

- Git: somente a implementação/documentação P007 ainda não consolidada; nenhuma mudança alheia à
  tarefa; `git diff --check` aprovado antes da edição D21.
- Projeto vinculado: `Funcionarios`.
- Região e saúde: `us-east-1`, `ACTIVE_HEALTHY`.
- Migrations local/remoto alinhadas antes da D21:
  `20260729163000`, `20260730103002`, `20260730144303`, `20260730144304` e `20260730155749`.
- Tabelas operacionais e `audit_log`: zero linhas.
- `BRL=1`, nome `Real brasileiro`, duas casas decimais e ativo.
- `US=1`, nome `Unidade e Serviço`, categoria nula e ativo.
- Fingerprint externo corrente, confirmado por comparação read-only sem diferenças:
  `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`.

## Integridade das migrations aplicadas

| Migration        | SHA-256                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `20260729163000` | `FEBE19BC524A467263415415300EA72FABDB42411F240E1F776D785ECA73CABF` |
| `20260730103002` | `DC7E651D290C443F5C34F4C7D61071B1BE38CDD88E67EAC0B8EBB10E09D59339` |
| `20260730144303` | `6E8588D4538B1D32CAEBDC425C2CEC505011309C1B7D5AA0F46A4801FE021B7E` |
| `20260730144304` | `7891D5FFBC35A9C8D55B0824E2C692F47C261ECFBC02BCF8BA6C58DAEE017361` |
| `20260730155749` | `C7CB68A7C93734F5D667089DBC6EBE10C866889AC762E8A26638B2D66EA07FE3` |

O seed permanece com SHA-256
`A2D5993AFCDE66FADB952371EE9152F63AA99DE567D4A67F3C22A1DC8DED7F3E`.

## Correção preparada

Existe exatamente uma migration local D21:

[`20260730163419_fix_ltcm_admin_inactivation_columns.sql`](../../supabase/migrations/20260730163419_fix_ltcm_admin_inactivation_columns.sql).

Ela substitui somente `ltc_m.enforce_admin_inactivation()` e não altera triggers, tabelas,
colunas, enums, dados ou privilégios. A causa, a matriz das quatro tabelas/triggers e a auditoria
de funções genéricas estão em
[`p007-d21-root-cause.md`](p007-d21-root-cause.md).

## Gates antes da escrita

O inventário
[`p007-d21-inventory-pre.json`](p007-d21-inventory-pre.json), coletado em
`2026-07-30T19:40:18.390Z`, confirmou:

- 1.443 metadados totais;
- 412 objetos `ltc_m`;
- fingerprint externo:
  `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`;
- fingerprint `ltc_m`:
  `9F3C882FDB8B94BAB69A7B6D98BB18481E3474BEAB863E2FB8C590117A6C2BF7`;
- fingerprint do histórico:
  `8A3A7929231B391D4F216321C2B93D881A295171B2AA545F33D664B6F70704A1`.

SHA-256 da única migration D21:
`04DBB1184E86394B4301766749A9CD16F79C84B7ABBC0531CFBB6B038E70A90F`.

## Validações locais

A suíte local completa passou antes do dry-run:

- `npm run format`, `format:check`, lint, typecheck e build;
- ambiente, seis migrations, seed e teste de integridade válidos;
- scanners P007, PW902 e D21 aprovados;
- 51 testes Node/web aprovados, incluindo os cinco novos testes D21;
- migrations aplicadas, seed e `package-lock.json` inalterados;
- exatamente uma migration D21 local;
- `git diff --check` aprovado;
- nenhum arquivo alheio ao P007 foi acrescentado ao conjunto de trabalho existente.

## Dry-run

O comando `supabase db push --linked --dry-run` executou entre
`2026-07-30T16:44:55.0586146-03:00` e `2026-07-30T16:45:06.5555643-03:00`, com código 0.

Ele listou exclusivamente:

```text
20260730163419_fix_ltcm_admin_inactivation_columns.sql
```

Seeds e roles: nenhum. Migrations anteriores, RLS, policies, grants, revokes e qualquer segunda
migration D21 não foram listados. Todos os gates D21 anteriores à escrita remota foram aprovados.
