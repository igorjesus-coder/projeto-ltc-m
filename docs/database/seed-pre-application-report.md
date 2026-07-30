# Relatório de pré-aplicação — P005 / 1.05

## Alvo e mecanismo

| Campo                 | Resultado                           |
| --------------------- | ----------------------------------- |
| Projeto               | `Funcionarios`                      |
| Região                | `us-east-1`                         |
| Mecanismo             | `supabase/seed.sql`                 |
| Aplicação             | `supabase db query --linked --file` |
| Tabela de moedas      | `ltc_m.currencies`                  |
| Tabela de unidades    | `ltc_m.units`                       |
| Migration baseline    | `20260729163000`, alinhada          |
| Outras migrations     | nenhuma                             |
| Scanner de migrations | aprovado                            |
| Scanner de seeds      | aprovado: somente `BRL` e `US`      |

O vínculo da CLI foi comparado com a listagem de projetos sem registrar project ref. Há exatamente
um projeto acessível chamado `Funcionarios`, ele está em `us-east-1` e é o alvo vinculado.

## Inspeção read-only

| Verificação                           | Resultado |
| ------------------------------------- | --------: |
| `BRL` encontrado                      |         0 |
| `BRL` com conteúdo aprovado           |         0 |
| `US` encontrado                       |         0 |
| `US` com conteúdo aprovado            |         0 |
| Tabela de moedas pertence a `ltc_m`   |       sim |
| Tabela de unidades pertence a `ltc_m` |       sim |

As tabelas `app_users`, `clients`, `projects`, `project_items`, `plan_versions`,
`financial_plan_scopes`, `financial_plan_lines`, `financial_actual_events`, `import_batches`,
`import_row_errors` e `audit_log` retornaram contagem zero. Nenhuma linha de outro sistema foi
consultada ou exibida.

## Fingerprints pré-aplicação

| Partição                         | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| Objetos externos                 | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` |
| Objetos do schema `ltc_m`        | `9CF1E698D48DF9FED4AB428857704E2F66EAACB49B506827115F7869302F4216` |
| Schema e histórico de migrations | `E2C0B0DCB560834DC1E8B55161BE40ACCAAA043A8405384563FB2BFF7E5AA3A7` |

O fingerprint externo coincide com o pós-aplicação da P004. O histórico sanitizado contém somente
`20260729163000`.

O inventário completo e sanitizado está em
[`seed-inventory-pre.json`](seed-inventory-pre.json). Definições SQL são representadas por hash.

## Limitações e decisão de prosseguimento

Docker, Podman, `psql` e `pg_dump` não estão disponíveis. Portanto:

- não houve PostgreSQL descartável local;
- não houve dump local;
- não se declara teste real local em PostgreSQL.

Esta aplicação não cria nem modifica migration ou schema. O seed é transacional, adquire locks
somente nas duas tabelas `ltc_m`, valida ambos os registros antes de inserir e não contém
`UPDATE`, `DELETE`, `TRUNCATE` ou referência externa. A solicitação P005 autoriza a aplicação
remota desse seed após o preflight.
