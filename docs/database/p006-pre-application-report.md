# Relatório de pré-aplicação — P006 / 1.06

## Alvo

| Campo                    | Resultado                                        |
| ------------------------ | ------------------------------------------------ |
| Projeto vinculado        | `Funcionarios`                                   |
| Região                   | `us-east-1`                                      |
| Migration remota         | somente `20260729163000`                         |
| Migration local pendente | `20260730103002_add_ltcm_core_query_indexes.sql` |
| Tabelas operacionais     | vazias                                           |
| `BRL`                    | exatamente 1, conteúdo aprovado                  |
| `US`                     | exatamente 1, `Unidade e Serviço`                |

O projeto e a região foram revalidados pela CLI sem registrar project ref.

## Inventário e fingerprints

| Partição                       | SHA-256 pré-aplicação                                              |
| ------------------------------ | ------------------------------------------------------------------ |
| Objetos externos               | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` |
| Objetos `ltc_m`                | `9CF1E698D48DF9FED4AB428857704E2F66EAACB49B506827115F7869302F4216` |
| Schema/histórico de migrations | `E2C0B0DCB560834DC1E8B55161BE40ACCAAA043A8405384563FB2BFF7E5AA3A7` |

O fingerprint externo coincide com a referência P004/P005. O inventário sanitizado está em
[`p006-inventory-pre.json`](p006-inventory-pre.json).

## Auditoria e testes

- 13 tabelas e 13 PKs;
- 28 FKs, incluindo as compostas de item/projeto e projeto/moeda;
- 7 UNIQUE constraints;
- 45 CHECK constraints;
- 20 índices implícitos de PK/UNIQUE;
- 16 índices explícitos;
- 2 sequences identity em `ltc_m` e nenhuma sequence LTC-M em `public`;
- scanner de migrations: aprovado, duas migrations válidas;
- scanner de seeds: aprovado;
- scanner do teste transacional: aprovado;
- testes Node/Vitest: aprovados;
- teste real no desenvolvimento remoto: nove violações esperadas rejeitadas e
  `rollback_clean = true`;
- auditoria posterior ao teste: nenhuma linha sintética permaneceu.

Docker, Podman, `psql` e `pg_dump` não estão disponíveis. Não houve PostgreSQL descartável, dump
ou `EXPLAIN ANALYZE`.

## Dry-run

`supabase db push --linked --dry-run` listou somente:

```text
20260730103002_add_ltcm_core_query_indexes.sql
```

Nenhum seed, role ou outra migration integra a aplicação.

## Decisão

O preflight autoriza uma única execução de `supabase db push --linked`. A migration é
transacional, aditiva, restrita a quatro `CREATE INDEX` em `ltc_m` e não contém DML, seed,
constraint nova, função, trigger, role, grant, RLS, extensão ou referência externa.
