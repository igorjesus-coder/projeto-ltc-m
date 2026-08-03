# P009 — relacionamento de staging

```text
app_users
   │ submitted/created/updated_by_user_id
   ▼
import_batches ──< import_batch_sheets ──< import_staging_rows ──< import_row_errors
       │                    │                       │
       └── source_hash       └── sheet_key           └── row_hash
           idempotency_key       (3 fontes)              payload_schema_version=1
```

Cada lote representa uma tentativa. Cada aba pertence a um lote e cada linha pertence a uma aba;
erros podem apontar para a linha, para a aba ou apenas para o lote. NÃ£o existe tabela fÃ­sica por
aba e nÃ£o existe unicidade por hash de linha.
