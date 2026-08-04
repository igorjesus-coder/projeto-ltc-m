# ADR-0004 — exceção legada auditável e lifecycle do lote (D40/D41)

Status: decidida em 04/08/2026; implementação somente local.

## Decisão

Projeto legado pode manter `data_reference_date = NULL` somente com FK não nula em
`legacy_import_batch_id`. Não se usa `is_legacy` nem data artificial. O CHECK exige data ou lote;
uma guarda anterior a metadata/auditoria exige Admin ativo, justificativa e request ID para criar,
enriquecer ou corrigir a exceção e impede remover a linhagem.

Os estados reais são `received`, `validating`, `rejected` e `loaded`. A vinculação aceita os três
estados não rejeitados, viabilizando lote e projetos na mesma transação, e recusa `rejected`.
D41 também impede que um lote já referenciado transite para `rejected`, sem filtrar status,
`deleted_at` ou presença posterior da data.

A guarda do lote é `SECURITY DEFINER` por necessidade: a RLS de `projects_select` oculta registros
inativos/soft-deleted de Editor, mas a integridade precisa considerar toda referência persistente.
Ela é trigger-only, somente leitura, tem `PUBLIC` revogado e retorna erro sanitizado. O vínculo do
projeto bloqueia o lote com `FOR SHARE`, eliminando a corrida com a transição de status.

## Consequências e limites

Contratos P011 passam a v2. Referência existente usa UUID; referência futura usa chave planejada
determinística até um adapter autorizado resolver o UUID na mesma transação. Snapshot v1 válido
tem conversão explícita; v1 com data nula é inválido.

O rollback lógico da futura aplicação é abortar a transação. Reversão de schema, se autorizada e
sem referências, restaura `NOT NULL` e remove trigger, função, índice, CHECK, FK e coluna. Nenhum
rollback foi executado. O risco dinâmico restante é a ausência de execução PostgreSQL local nesta
máquina; D34/D36 e qualquer aplicação remota permanecem fora do escopo.
