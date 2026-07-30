# Relatório pós-correção D21 — P007 / 1.07

## Estado

**Concluída.**

A única migration forward D21 foi aplicada com sucesso, o erro PostgreSQL `42703` não voltou a
ocorrer e a suíte P007 integral terminou com `rollback_clean = true`. Nenhum objeto externo,
dado residual, RLS, policy ou privilégio explícito foi criado.

## Autorização formal D21

O responsável autorizou explicitamente uma segunda e única migration forward corretiva no projeto
`Funcionarios`, região `us-east-1`, exclusivamente em `ltc_m`, mesmo sem backup recuperável.

A execução respeitou os limites: nenhuma migration aplicada foi editada; não houve segundo push,
rollback manual, `repair`, reset, pull, migration down, SQL Editor, DDL manual, seed, roles,
grants, revokes, policies, RLS, extensões, objeto externo ou início da P008.

## Causa e correção

A causa confirmada foi o acesso direto a `OLD.deleted_at` e `NEW.deleted_at` pela função genérica
`enforce_admin_inactivation()` no trigger de `app_users`, tabela que possui `active` e não possui
`deleted_at`.

A migration
[`20260730163419_fix_ltcm_admin_inactivation_columns.sql`](../../supabase/migrations/20260730163419_fix_ltcm_admin_inactivation_columns.sql),
SHA-256
`04DBB1184E86394B4301766749A9CD16F79C84B7ABBC0531CFBB6B038E70A90F`, substituiu somente essa
função. Os quatro triggers não foram alterados. A função passou a usar JSONB de ponta a ponta e a
proteger também mudança real de `role` em `app_users`.

Matriz e auditoria das funções genéricas:
[`p007-d21-root-cause.md`](p007-d21-root-cause.md).

## Preflight e dry-run

Antes da escrita:

- projeto `Funcionarios`, região `us-east-1`, saudável e vinculado;
- cinco migrations remotas alinhadas e exatamente uma D21 local pendente;
- hashes das cinco migrations aplicadas intactos;
- `BRL=1`, `US=1`, tabelas operacionais vazias e `audit_log=0`;
- zero RLS, policies e ACLs explícitas em objetos `ltc_m`;
- todas as validações locais e 51 testes Node/web aprovados;
- fingerprint externo:
  `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`.

O dry-run ocorreu entre `2026-07-30T16:44:55.0586146-03:00` e
`2026-07-30T16:45:06.5555643-03:00`, código 0, e listou exclusivamente:

```text
20260730163419_fix_ltcm_admin_inactivation_columns.sql
```

Seeds e roles: nenhum.

Evidências:

- [`p007-d21-pre-correction-report.md`](p007-d21-pre-correction-report.md);
- [`p007-d21-inventory-pre.json`](p007-d21-inventory-pre.json).

## Aplicação

Comando executado uma única vez:

```text
supabase db push --linked
```

- início: `2026-07-30T16:45:47.0805039-03:00`;
- término: `2026-07-30T16:46:00.2569520-03:00`;
- código: 0;
- migration aplicada:
  `20260730163419_fix_ltcm_admin_inactivation_columns.sql`;
- seed e roles: nenhum;
- retry: nenhum.

A CLI emitiu somente o aviso não fatal de que não podia atualizar o cache local do catálogo sem
Docker. O push remoto concluiu normalmente.

## Histórico, função e triggers

O histórico local/remoto terminou alinhado:

1. `20260729163000`;
2. `20260730103002`;
3. `20260730144303`;
4. `20260730144304`;
5. `20260730155749`;
6. `20260730163419`.

A definição remota de `enforce_admin_inactivation()` coincide com a D21 e não contém acesso direto
a campos de `OLD/NEW`. Permaneceram vinculados, sem recriação:

- `trg_05_app_users_inactivation`;
- `trg_05_clients_inactivation`;
- `trg_05_projects_inactivation`;
- `trg_05_project_items_inactivation`.

## Inventário e fingerprints

O inventário
[`p007-d21-inventory-post.json`](p007-d21-inventory-post.json), coletado em
`2026-07-30T19:47:00.754Z`, confirmou:

- 1.444 metadados totais;
- 412 objetos `ltc_m`, sem criação ou remoção estrutural;
- somente a definição de `enforce_admin_inactivation()` alterada em `ltc_m`;
- somente a versão `20260730163419` adicionada ao histórico;
- zero RLS, policies e ACLs explícitas;
- migrations anteriores intactas.

| Escopo     | Pré                                                                | Pós                                                                | Resultado              |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------- |
| Externo    | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | idêntico               |
| `ltc_m`    | `9F3C882FDB8B94BAB69A7B6D98BB18481E3474BEAB863E2FB8C590117A6C2BF7` | `1AB309C0C6F24D82BF465041D5D45A1035D0F0FDD2E919058E224B174D185864` | uma função substituída |
| Migrations | `8A3A7929231B391D4F216321C2B93D881A295171B2AA545F33D664B6F70704A1` | `0900B5B127AEEC5F6357CA7450D6B929B7A849EEC20AB16591E0FC0BF457219E` | uma versão adicionada  |

Uma comparação read-only posterior à suíte encontrou zero diferenças em relação ao inventário
pós-D21.

## Suíte PostgreSQL integral

Comando:

```text
supabase db query --linked --file database/audit/ltcm-p007-tests.sql --output-format json
```

- início: `2026-07-30T16:47:29.7296972-03:00`;
- término: `2026-07-30T16:47:39.2319350-03:00`;
- código: 0;
- resultado: `rollback_clean = true`;
- erro `42703`: ausente.

A suíte comprovou:

- update comum e campo permitido de `app_users`;
- mudança de `role` por admin e auditoria;
- mudança de `role` por editor rejeitada;
- inativação por admin e auditoria;
- inativação por editor e viewer rejeitada;
- ausência de ator rejeitada;
- reativação por admin e auditoria;
- DELETE físico de `app_users` rejeitado;
- triggers de `clients`, `projects` e `project_items` operacionais e auditados;
- timestamps, no-op, concorrência otimista, sanitização e append-only;
- PW902 e todas as transições diretas rejeitadas;
- workflow oficial e imutabilidade;
- autoaprovação com dois admins rejeitada;
- autoaprovação com um admin sem justificativa rejeitada;
- autoaprovação excepcional com um admin, justificativa e auditoria aprovada;
- reabertura por clonagem, linhagem, cópia de scopes/lines e origem preservada;
- histórico financeiro e proibição de DELETE físico.

## Dados finais

A consulta read-only posterior confirmou:

- `BRL=1`, definição aprovada;
- `US=1`, nome `Unidade e Serviço`, definição aprovada;
- `app_users`, `clients`, `projects`, `project_items`, `plan_versions`,
  `financial_plan_scopes`, `financial_plan_lines`, `financial_actual_events`,
  `import_batches`, `import_row_errors` e `audit_log`: zero linhas;
- nenhum dado sintético residual.

## Integridade e restrições

- rollback manual não executado; apenas o `ROLLBACK` transacional previsto na suíte;
- nenhuma dependência adicionada e `package-lock.json` inalterado;
- nenhum segredo adicionado;
- nenhum commit, merge ou push Git;
- nenhuma alteração manual remota;
- nenhum segundo `db push`;
- P008 não iniciada.

Riscos remanescentes: ausência de backup recuperável aceita apenas pela D21; ambiente remoto
compartilhado; grants/RLS e papel de menor privilégio ainda pertencem à P008; regra do último admin
ativo permanece pendente de decisão de negócio.
