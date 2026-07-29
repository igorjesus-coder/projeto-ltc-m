# Relatório pós-aplicação — P004 / 1.04

## Resultado

A migration `20260729163000_create_ltcm_relational_core.sql` foi aplicada uma única vez no projeto
`Funcionarios`, em `us-east-1`, por:

```bash
supabase db push --linked
```

Não foram usados `--yes`, `--include-all`, `--include-seed` ou `--include-roles`. A resposta
confirmou uma migration, zero seeds e zero roles.

A CLI emitiu uma advertência após a aplicação porque não conseguiu atualizar o cache local do
catálogo `pg-delta` sem Docker. A aplicação remota já havia concluído com sucesso; não houve nova
tentativa, repair ou correção direta.

## Histórico de migrations

O `migration list --linked` pós-aplicação retornou:

| Versão local     | Versão remota    | Estado   |
| ---------------- | ---------------- | -------- |
| `20260729163000` | `20260729163000` | alinhada |

Não existe outra migration local ou remota. A nova linha em
`supabase_migrations.schema_migrations` é a única alteração técnica esperada fora de `ltc_m`.

## Objetos em `ltc_m`

O inventário pós-aplicação está em
[`inventory-post.json`](inventory-post.json).

| Tipo de metadado          | Quantidade |
| ------------------------- | ---------: |
| Schema                    |          1 |
| Tabelas                   |         13 |
| Colunas                   |        147 |
| Tipos                     |         23 |
| Sequences                 |          2 |
| Configurações de sequence |          2 |
| Constraints               |         93 |
| Índices                   |         36 |
| Views                     |          0 |
| Funções                   |          0 |
| Triggers de usuário       |          0 |
| Policies                  |          0 |

Os 23 tipos catalogados incluem os 10 enums explícitos e os tipos compostos criados
automaticamente pelo PostgreSQL para as 13 tabelas.

As 13 tabelas esperadas estão presentes:

- `app_users`;
- `currencies`;
- `units`;
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

Não foi encontrada tabela extra em `ltc_m` nem objeto LTC-M esperado em `public`.

## Dados

A consulta read-only
[`ltcm-post-application-check.sql`](../../database/audit/ltcm-post-application-check.sql) confirmou
contagem zero nas 13 tabelas. A migration não contém DML ou seeds. Nenhuma linha de domínio foi
inserida.

A única escrita fora do schema foi o registro automático da versão em
`supabase_migrations.schema_migrations`.

## Comparação dos objetos preexistentes

Fingerprint externo pré-aplicação:

```text
7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95
```

Fingerprint externo pós-aplicação:

```text
7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95
```

Além da igualdade dos hashes, a comparação canônica dos registros retornou zero diferenças fora
de `ltc_m` e `supabase_migrations`.

Conclusões:

- nenhum schema preexistente mudou;
- nenhuma tabela, coluna, view, sequence, função, constraint, índice, trigger, policy ou tipo
  preexistente mudou;
- nenhum objeto do outro sistema foi alterado;
- nenhum objeto LTC-M foi criado em `public`;
- nenhuma alteração externa crítica foi detectada.

## Backup e limitações

**Nenhum ponto de restauração disponível para esta execução**.

O plano Free, a ausência de Docker e a ausência de `pg_dump`/`psql` impediram dump e validação em
PostgreSQL descartável. O sucesso transacional e a auditoria pós-aplicação reduzem, mas não
eliminam, o risco aceito.

## Rollback

O rollback manual está em
[`database/rollback/rollback-ltc-m-baseline.sql`](../../database/rollback/rollback-ltc-m-baseline.sql).
Ele não foi executado. Seu uso futuro exige autorização explícita e apagará todos os dados LTC-M.
O histórico deve ser preservado; uma reconstrução deve usar nova migration forward, nunca
`migration repair`.
