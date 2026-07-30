# Relatório pré-correção PW902 — P007 / 1.07

## Estado

Preflight D20 em andamento. Nenhuma escrita remota da correção foi executada.

## Autorização formal D20

O responsável autorizou uma única migration forward corretiva do PW902 no projeto
`Funcionarios`, região `us-east-1`, exclusivamente no schema `ltc_m`, mesmo sem backup
recuperável.

A autorização:

- não permite editar as quatro migrations já aplicadas;
- exige preflight, inventário, fingerprint e dry-run antes de um único `db push --linked`;
- não permite seed, roles, grants, revokes, RLS, policies, extensões ou objetos externos;
- não permite `repair`, reset, pull, migration down, SQL Editor, DDL manual ou rollback
  automático;
- não permite iniciar a P008;
- exige a suíte PostgreSQL P007 integral e `rollback_clean = true`.

## Estado inicial local

O Git continha apenas a implementação P007 ainda não consolidada e sua documentação. Não havia
mudança alheia à tarefa. `git diff --check` passou.

Hashes SHA-256 preservados das migrations aplicadas:

| Migration        | SHA-256                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `20260729163000` | `FEBE19BC524A467263415415300EA72FABDB42411F240E1F776D785ECA73CABF` |
| `20260730103002` | `DC7E651D290C443F5C34F4C7D61071B1BE38CDD88E67EAC0B8EBB10E09D59339` |
| `20260730144303` | `6E8588D4538B1D32CAEBDC425C2CEC505011309C1B7D5AA0F46A4801FE021B7E` |
| `20260730144304` | `7891D5FFBC35A9C8D55B0824E2C692F47C261ECFBC02BCF8BA6C58DAEE017361` |

`supabase/seed.sql` permaneceu inalterado, com SHA-256
`A2D5993AFCDE66FADB952371EE9152F63AA99DE567D4A67F3C22A1DC8DED7F3E`.

## Alvo e estado remoto inicial

- projeto vinculado: `Funcionarios`;
- região: `us-east-1`;
- estado: ativo e saudável;
- migrations local/remoto alinhadas em `20260729163000`, `20260730103002`,
  `20260730144303` e `20260730144304`;
- hashes remotos de `workflow_guard_active`, `protect_plan_version`, `audit_row_change` e
  `approve_plan_version` coincidentes com o inventário pós-P007;
- `BRL=1`, `US=1` e definições controladas aprovadas;
- todas as tabelas operacionais e `audit_log`: zero linhas.

## Correção preparada

Única migration forward:

[`20260730155749_fix_ltcm_workflow_guard_fail_closed.sql`](../../supabase/migrations/20260730155749_fix_ltcm_workflow_guard_fail_closed.sql).

Ela substitui somente quatro funções e não altera estruturas, triggers, dados ou privilégios. A
causa e a matriz completa estão em
[`p007-pw902-root-cause.md`](p007-pw902-root-cause.md).

## Gates pendentes antes do push

O inventário
[`p007-pw902-inventory-pre.json`](p007-pw902-inventory-pre.json), coletado em
`2026-07-30T19:09:18.192Z`, confirmou:

- 1.442 metadados totais;
- 412 objetos `ltc_m`;
- fingerprint externo
  `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`;
- fingerprint `ltc_m`
  `8AD65407513D674FCC28290B3FC204BEFD1E2EFDFECA960C6C073A4C37533D05`;
- fingerprint do histórico
  `939D8E343999E715FEFBF6B79CD920D5479A80E2300C5306D410B99E047242C4`.

A suíte local completa passou:

- ambiente, cinco migrations, seed e teste de integridade válidos;
- formatação, lint e typecheck aprovados;
- 46 testes Node/web aprovados;
- build concluído;
- scanners P007 e PW902 aprovados;
- migrations aplicadas e `package-lock.json` intactos;
- `git diff --check` aprovado.

SHA-256 da única migration nova:
`C7CB68A7C93734F5D667089DBC6EBE10C866889AC762E8A26638B2D66EA07FE3`.

O coletor de inventário recebeu uma correção local de portabilidade: passou a fornecer à CLI
caminhos relativos ao `cwd`, pois caminhos absolutos contendo espaço falhavam no Windows. A
consulta e o conteúdo do inventário não mudaram.

## Dry-run

O `supabase db push --linked --dry-run`, entre `2026-07-30T19:11:36.6210254Z` e
`2026-07-30T19:11:47.3032051Z`, retornou código 0 e listou exclusivamente:

```text
20260730155749_fix_ltcm_workflow_guard_fail_closed.sql
```

Seeds e roles: nenhum. A migration não contém grants, policies, RLS, extensões, DML top-level,
triggers, estruturas ou objetos externos.

Todos os gates D20 anteriores à escrita foram aprovados.
