# Relatório pós-aplicação — P006 / 1.06

## Status

**Concluída**.

A migration `20260730103002_add_ltcm_core_query_indexes.sql` foi aplicada uma única vez no projeto
`Funcionarios`, em `us-east-1`, por:

```bash
supabase db push --linked
```

Não foram usados `--yes`, `--include-seed`, `--include-roles`, reset, pull, repair, migration down
ou SQL Editor manual.

A CLI concluiu a aplicação e depois advertiu que não conseguiu atualizar o cache local `pg-delta`
sem Docker. O remoto já estava aplicado; não houve segunda tentativa ou repair.

## Histórico

| Migration        | Local    | Remota   |
| ---------------- | -------- | -------- |
| `20260729163000` | presente | presente |
| `20260730103002` | presente | presente |

Não existe migration desconhecida.

## Constraints e índices

Nenhuma constraint foi adicionada ou removida. A baseline continuou com:

- 13 PKs;
- 28 FKs;
- 7 UNIQUE constraints;
- 45 CHECK constraints.

Estado dos índices:

| Item                    | Pré | Pós |
| ----------------------- | --: | --: |
| Índices totais          |  36 |  40 |
| Implícitos de PK/UNIQUE |  20 |  20 |
| Explícitos              |  16 |  20 |
| Nomes duplicados        |   0 |   0 |

Índices adicionados:

- `ltc_m.ix_financial_plan_scopes_project_version`;
- `ltc_m.ix_financial_plan_lines_version_month`;
- `ltc_m.ix_financial_plan_lines_item_month`;
- `ltc_m.ix_financial_actual_events_item_date`.

## Inventário e fingerprints

| Partição                       | Pré                                                                | Pós                                                                | Resultado                |
| ------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------ |
| Objetos externos               | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` | idêntico                 |
| Objetos `ltc_m`                | `9CF1E698D48DF9FED4AB428857704E2F66EAACB49B506827115F7869302F4216` | `9874EDFF315C52848BA4AD24700FBF8663A8A5083B325D5CC29B7C354045F9E6` | quatro índices esperados |
| Schema/histórico de migrations | `E2C0B0DCB560834DC1E8B55161BE40ACCAAA043A8405384563FB2BFF7E5AA3A7` | `C8C2FBE7A1406CD9D928416CA354027D7527FE26737C436FF6E64492A83D0951` | nova versão esperada     |

O inventário passou de 1.344 para 1.349 registros. A comparação canônica encontrou somente cinco
adições:

1. quatro índices em `ltc_m`;
2. a versão `20260730103002` em `supabase_migrations`.

Nenhum registro de metadado foi removido ou alterado.

Inventários:

- [`p006-inventory-pre.json`](p006-inventory-pre.json);
- [`p006-inventory-post.json`](p006-inventory-post.json).

## Testes transacionais

Os testes foram executados antes e depois da migration no desenvolvimento remoto compartilhado.
Em ambas as execuções:

- `auth_subject` duplicado foi rejeitado;
- código ativo de projeto duplicado foi rejeitado;
- item com moeda diferente do projeto foi rejeitado;
- planejamento de item sem item foi rejeitado;
- planejamento de projeto com item foi rejeitado;
- evento com item de outro projeto foi rejeitado;
- competência fora do primeiro dia do mês foi rejeitada;
- FK órfã foi rejeitada;
- data final anterior à inicial foi rejeitada;
- o resultado final foi `rollback_clean = true`.

Nenhum dado sintético permaneceu.

## EXPLAIN

Foram usados apenas `EXPLAIN (FORMAT JSON, COSTS, VERBOSE)`, sem `ANALYZE`.

| Consulta estrutural           | Plano observado  | Índice selecionado                         |
| ----------------------------- | ---------------- | ------------------------------------------ |
| escopos por projeto           | Bitmap Heap Scan | `ix_financial_plan_scopes_project_version` |
| linhas por versão/competência | Index Scan       | `ix_financial_plan_lines_version_month`    |
| linhas por item/competência   | Index Scan       | `ix_financial_plan_lines_item_month`       |
| realizados por item/data      | Index Scan       | `ix_financial_actual_events_item_date`     |

O plano de projetos por cliente/status continuou usando `ix_projects_client` com status e moeda
como filtros residuais. Isso sustenta a decisão de não criar agora um índice especulativo
cliente/status.

As tabelas estão vazias. Os planos demonstram elegibilidade estrutural dos índices, não ganho real
de desempenho. Volume, estatísticas e seletividade futuras podem mudar as escolhas do planner.

## Seeds e tabelas operacionais

Estado final:

- `BRL`: exatamente 1, com conteúdo aprovado;
- `US`: exatamente 1, com nome `Unidade e Serviço`;
- total de moedas: 1;
- total de unidades: 1;
- `app_users`, `clients`, `projects`, `project_items`, `plan_versions`,
  `financial_plan_scopes`, `financial_plan_lines`, `financial_actual_events`, `import_batches`,
  `import_row_errors` e `audit_log`: zero linhas.

## Rollback

O rollback manual está em
[`rollback-ltcm-p006-indexes.sql`](../../database/rollback/rollback-ltcm-p006-indexes.sql), fora de
`supabase/migrations`, marcado `NÃO EXECUTAR AUTOMATICAMENTE`.

Ele não foi executado.

## Limitações e riscos restantes

- Docker, Podman, `psql` e `pg_dump` continuam indisponíveis.
- Não houve PostgreSQL descartável, dump ou ponto de restauração.
- O projeto remoto continua compartilhado e não substitui homologação.
- Política de negativos, reutilização após exclusão lógica, índices analíticos futuros e demais
  decisões listadas na matriz permanecem pendentes.
