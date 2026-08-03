# P009 — lifecycle, idempotÃªncia e rejeiÃ§Ã£o parcial

1. O backend cria um lote com hash dos bytes exatos, contrato e `idempotency_key` opcional.
2. O P010 registra as abas operacionais encontradas; aba ausente nÃ£o invalida o registro do lote.
3. Cada linha fÃ­sica Ã© inserida uma vez por `(import_batch_sheet_id, source_row_number)`.
4. A validaÃ§Ã£o evolui a linha sem substituir origem, payload ou hash.
5. Cada falha gera um erro independente; dois erros na mesma linha sÃ£o vÃ¡lidos.
6. O lote pode terminar carregado com rejeiÃ§Ãµes, mantendo todas as linhas rastreÃ¡veis.

O mesmo `source_hash` em lotes diferentes Ã© permitido. A mesma `idempotency_key` nÃ£o pode ser
reutilizada. DivergÃªncia de hash na mesma coordenada deve ser reportada pelo P010, nunca sobrescrita
silenciosamente.
