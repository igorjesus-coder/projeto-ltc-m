# Relatório pós-aplicação — P005 / 1.05

## Status

**Concluída**.

O seed de valores controlados foi aplicado duas vezes no desenvolvimento remoto temporário
`Funcionarios`, em `us-east-1`. A primeira execução inseriu os dois registros aprovados. A segunda
execução concluiu sem inserir, atualizar ou excluir registros.

## Mecanismo e escopo

- fonte única: [`supabase/seed.sql`](../../supabase/seed.sql);
- execução: `supabase db query --linked --file supabase/seed.sql`;
- moeda: `BRL = Real brasileiro`, `decimal_places = 2`, `active = true`;
- unidade: `US = Unidade e Serviço`, `category = null`, `active = true`;
- tabelas: somente `ltc_m.currencies` e `ltc_m.units`;
- nenhuma migration foi criada ou alterada.

O seed usa uma transação explícita, locks `SHARE ROW EXCLUSIVE`, validação de ambos os códigos
antes das inserções e `INSERT ... SELECT ... WHERE NOT EXISTS`. Registros idênticos são
preservados. Conteúdo divergente gera exceção e rollback integral. Não existe `UPDATE`, `DELETE`,
`TRUNCATE` ou `ON CONFLICT DO UPDATE`.

## Primeira execução

Estado anterior:

| Verificação                 | Contagem |
| --------------------------- | -------: |
| `BRL`                       |        0 |
| `US`                        |        0 |
| Demais tabelas operacionais |        0 |

Estado imediatamente posterior:

| Verificação                 | Contagem |
| --------------------------- | -------: |
| `BRL`                       |        1 |
| `BRL` com conteúdo aprovado |        1 |
| `US`                        |        1 |
| `US` com conteúdo aprovado  |        1 |
| Moedas totais               |        1 |
| Unidades totais             |        1 |
| Demais tabelas operacionais |        0 |

O inventário
[`seed-inventory-after-first.json`](seed-inventory-after-first.json) confirmou metadados idênticos
ao preflight.

## Segunda execução e idempotência

A mesma instrução foi executada novamente. A auditoria posterior continuou mostrando exatamente:

- uma moeda total, `BRL`, com todo o conteúdo aprovado;
- uma unidade total, `US`, com todo o conteúdo aprovado;
- zero linhas nas tabelas operacionais e de auditoria.

Como o SQL não contém comando de atualização ou exclusão, as contagens permaneceram iguais e os
payloads aprovados continuaram idênticos, a segunda execução produziu zero inserts, zero updates
e zero deletes.

## Fingerprints

| Partição                         | Pré                                                                | Pós                                                                | Resultado |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------- |
| Objetos externos                 | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | idêntico  |
| Objetos do schema `ltc_m`        | `9CF1E698D48DF9FED4AB428857704E2F66EAACB49B506827115F7869302F4216` | `9CF1E698D48DF9FED4AB428857704E2F66EAACB49B506827115F7869302F4216` | idêntico  |
| Schema e histórico de migrations | `E2C0B0DCB560834DC1E8B55161BE40ACCAAA043A8405384563FB2BFF7E5AA3A7` | `E2C0B0DCB560834DC1E8B55161BE40ACCAAA043A8405384563FB2BFF7E5AA3A7` | idêntico  |

Além dos hashes, a comparação canônica dos 1.344 registros de metadados pré, após a primeira
execução e pós retornou igualdade exata. Nenhum objeto externo, objeto `ltc_m` ou registro do
histórico de migrations mudou.

Inventários:

- [`seed-inventory-pre.json`](seed-inventory-pre.json);
- [`seed-inventory-after-first.json`](seed-inventory-after-first.json);
- [`seed-inventory-post.json`](seed-inventory-post.json).

## Tabelas operacionais

Permaneceram vazias:

- `app_users`;
- `clients`;
- `projects`;
- `project_items`;
- `plan_versions`;
- `financial_plan_scopes`;
- `financial_plan_lines`;
- `financial_actual_events`;
- `import_batches`;
- `import_row_errors`;
- `audit_log`.

Não foram consultadas nem exibidas linhas de outros sistemas.

## Testes e limitações

Passaram antes da aplicação:

- formatter e verificação de formato;
- lint e typecheck;
- testes de ambiente, migrations, inventário, seed e frontend;
- build;
- scanners de ambiente, migrations e seed;
- `git diff --check`.

Os testes do seed cobrem primeira execução modelada, repetição idempotente, divergência de `BRL`,
divergência de `US`, ausência de aplicação parcial, proibição de atualização silenciosa, escopo,
dados adicionais, comandos destrutivos, credenciais, Auth e atomicidade.

Não havia Docker, Podman, `psql` ou `pg_dump`; por isso não houve teste local real em PostgreSQL
descartável nem dump local. A execução real foi feita somente no desenvolvimento remoto
temporário após todas as inspeções read-only.

Nenhum commit, merge, push, `db reset`, `db pull`, `migration repair` ou SQL Editor manual foi
usado.
