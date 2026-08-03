# P009 — RLS, policies e grants

Estado de validação: estrutura, grants e policies foram confirmados em modo read-only. A
revalidação dinâmica ampliada de 03/08/2026 não chegou aos cenários P009 por erro do renderizador;
cleanup, D26 e as regressões P007/P008 passaram. A matriz abaixo exige nova execução remota
explicitamente aprovada para evidência funcional completa.

A única reexecução D30 `r20260803132652-ada2b257` também não alcançou a matriz P009: o alias já
estava válido, mas um INSERT de fixture possuía aridade divergente. O defeito foi corrigido
somente localmente. Os resultados Viewer/Editor/Admin aprovados nessa execução pertencem às
regressões P008 isoladas, não constituem evidência dinâmica da matriz P009 abaixo.

Viewer nÃ£o possui acesso a `import_batches`, `import_batch_sheets`, `import_staging_rows` ou
`import_row_errors`. Editor e Admin possuem SELECT/INSERT/UPDATE nas duas tabelas novas e SELECT/
INSERT nos erros; `import_row_errors` continua sem UPDATE/DELETE. Todas as policies exigem
`authorization_context()` com usuÃ¡rio ativo e role `editor` ou `admin`.

As tabelas novas usam RLS e FORCE RLS, policies separadas para SELECT/INSERT/UPDATE e zero DELETE ou
FOR ALL. O runtime recebe somente SELECT/INSERT/UPDATE em `ltc_m`; nÃ£o recebe DELETE, TRUNCATE,
REFERENCES, TRIGGER, CREATE ou acesso externo. A allowlist de nove funÃ§Ãµes P008 permanece inalterada;
`protect_import_staging_row()` Ã© trigger-only e PUBLIC EXECUTE Ã© revogado.
