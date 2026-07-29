# Migrations do LTC-M

## Baseline P004 / 1.04

A migration
[`20260729163000_create_ltcm_relational_core.sql`](../../supabase/migrations/20260729163000_create_ltcm_relational_core.sql)
transforma o desenho aprovado no núcleo relacional versionado do LTC-M.

Ela é exclusivamente aditiva e executa dentro de uma transação explícita. Todos os comandos
usados são transacionais no PostgreSQL; não existem `CREATE INDEX CONCURRENTLY`, extensões,
roles, grants, RLS, funções, triggers, views, seeds ou DML. Se qualquer statement falhar antes do
`commit`, o PostgreSQL deve reverter toda a baseline.

O schema é criado sem `if not exists`. Isso é intencional: se `ltc_m` aparecer antes da aplicação,
a migration deve falhar em vez de aceitar um estado remoto ambíguo.

## Matriz de objetos

| Categoria          | Objetos criados                                                                                                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema             | `ltc_m`                                                                                                                                                                                             |
| Tipos              | `app_role`, `project_status`, `project_classification`, `plan_status`, `planning_level`, `planned_financial_metric`, `actual_financial_metric`, `actual_status`, `import_status`, `audit_operation` |
| Identidade         | `app_users`                                                                                                                                                                                         |
| Referências        | `currencies`, `units`                                                                                                                                                                               |
| Cadastros          | `clients`, `projects`, `project_items`                                                                                                                                                              |
| Planejamento       | `plan_versions`, `financial_plan_scopes`, `financial_plan_lines`                                                                                                                                    |
| Realizado          | `financial_actual_events`                                                                                                                                                                           |
| Importação         | `import_batches`, `import_row_errors`                                                                                                                                                               |
| Auditoria          | `audit_log`                                                                                                                                                                                         |
| Sequences identity | sequences automáticas de `import_row_errors.id` e `audit_log.id`, ambas em `ltc_m`                                                                                                                  |
| Índices explícitos | 16 índices sobre tabelas em `ltc_m`                                                                                                                                                                 |
| Constraints        | PKs, uniques, checks e FKs exclusivamente entre tabelas em `ltc_m`                                                                                                                                  |
| Comentários        | schema e 13 tabelas de `ltc_m`                                                                                                                                                                      |

Além desses objetos, a aplicação pela Supabase CLI registra a versão em
`supabase_migrations.schema_migrations`. Essa é a única alteração técnica esperada fora de
`ltc_m`.

## Regras preservadas

- Auth0 é representado apenas por `app_users.auth_subject`; não existe referência a Supabase Auth.
- `viewer`, `editor` e `admin` são os únicos papéis de domínio.
- contrato, saldo de abertura, custo orçado, itens, planejado e realizado são medidas distintas.
- `billing_planned`, `billing_actual`, `receipt_forecast` e `receipt_actual` não são misturados.
- um escopo fixa o planejamento no nível de projeto ou item.
- FKs compostas impedem associar item, moeda ou linha financeira ao projeto errado.
- valores monetários usam `numeric`.
- a competência planejada deve ser o primeiro dia do mês.
- códigos repetidos de item coexistem por `source_line_key`.
- projetos consolidados por cliente continuam registros separados.

## Scanner estático

Execute:

```bash
npm run migrations:check
```

O scanner analisa todos os arquivos SQL em `supabase/migrations`, valida nomes timestampados,
ordem e unicidade e rejeita migrations vazias, DML, comandos destrutivos, objetos não
qualificados, schemas externos, Supabase Auth, tipos monetários imprecisos, seeds, extensões,
roles, grants, triggers, funções e SQL dinâmico.

Os testes ficam em:

- `scripts/check-migrations.test.mjs`;
- `scripts/collect-db-inventory.test.mjs`.

## Inventário e fingerprint

A consulta read-only
[`remote-metadata-inventory.sql`](../../database/audit/remote-metadata-inventory.sql) coleta apenas
metadados técnicos. Definições de funções, views, constraints, índices, triggers e policies são
representadas por hash, sem retornar seus textos.

O coletor `scripts/collect-db-inventory.mjs` normaliza e ordena os registros. O fingerprint
SHA-256 exclui `ltc_m` e `supabase_migrations`, permitindo comparar os objetos preexistentes sem
considerar a baseline ou o registro técnico da CLI.

## Rollback manual

O arquivo
[`rollback-ltc-m-baseline.sql`](../../database/rollback/rollback-ltc-m-baseline.sql) fica fora de
`supabase/migrations` e está marcado como **NÃO EXECUTAR AUTOMATICAMENTE**.

Ele remove somente `ltc_m`, mas apagará todos os dados futuros do LTC-M. Não altera
`supabase_migrations`. Se um rollback for autorizado:

1. manter o registro da baseline no histórico;
2. registrar a autorização e o incidente;
3. executar o rollback somente com backup e janela controlada;
4. reconstruir o schema por uma nova migration forward com novo timestamp;
5. não usar `migration repair` e não apagar registros do histórico manualmente.

O rollback não foi executado na P004.
