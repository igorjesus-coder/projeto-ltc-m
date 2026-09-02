# P028 — chaves estáveis e ciclo de vida lógico de itens

## Contrato

`ltcm.p028.project-items-lifecycle.v1`

Esta entrega absorve o contrato de identidade de P012/P013 na grade P027 e completa o ciclo
`Browser → API NestJS/Express → PostgreSQL` com restauração administrativa de itens inativos.

## Identidade estável

- `ltc_m.project_items.id` é o identificador físico estável da ocorrência.
- `project_id + source_line_key` é a identidade de origem; `project_id + line_number` é a
  identidade operacional visível. `item_code` nunca é chave e pode se repetir.
- Criações manuais recebem `manual:<UUID>` no servidor. O cliente não pode informar ou alterar
  `source_line_key` nem `line_number`.
- P012 define a chave importada como `p012-item-v1:<64 hex>` derivada do JSON canônico
  `{project_code, sheet_key, source_item_number}`. Os valores comerciais, a linha física e os
  campos de planejamento não reidentificam a linha.
- Duplicação cria novo UUID, novo `manual:<UUID>` e novo `line_number`; nunca copia a identidade
  da origem.
- Os índices únicos por projeto para `source_line_key` e `line_number`, combinados com o lock da
  linha do projeto usado pela criação/duplicação, impedem colisões inclusive entre writers que não
  cooperem com o lock.

## Importação e rerun

O repositório atual não possui writer de itens P012: P011 termina em projetos e P013 somente
resolve itens existentes. Portanto não há rerun de ingestão de `project_items` a executar nesta
entrega. Quando o adapter P012 for conectado, a identidade determinística e o vínculo
`project_id + source_line_key` já documentados, a transação serializável e os índices únicos são
as barreiras contra duplicação; `23505` deve continuar sendo conflito, nunca sucesso silencioso.

## Ciclo de vida

Inativar faz somente `UPDATE active = false`, exige `expectedVersion`, justificativa e capability
`soft_delete:execute`. Restaurar faz somente `UPDATE active = true`, exige os mesmos controles e
capability `soft_delete:restore`, hoje concedida exclusivamente a `admin` por P021. Ambas as
operações mantêm UUID, chaves, número, valores, referências de catálogo e `deleted_at`; o trigger
P007 registra auditoria e incrementa `row_version`.

A restauração não revalida unidade ou moeda como cadastro ativo: ela não cria nem troca referência.
O item continua exibindo a referência histórica mesmo se o catálogo estiver inativo. O estado do
projeto segue a regra já existente de mutação P027: editor somente em projeto ativo; admin em
projeto não excluído.

Não existe endpoint HTTP `DELETE`, não há exclusão física e nenhuma migration P028 foi criada.
RLS e FORCE RLS permanecem os controles do banco; a política de update P008 permite restauração ao
admin e o trigger exige contexto de ator e justificativa.

## Evidência local

Os testes P028 cobrem parser fechado, chave manual controlada pelo servidor, não mutabilidade das
chaves, duplicação com identidade nova, numeração, inativação, restauração, concorrência otimista,
auditoria por justificativa e ausência de `DELETE`. O gate estático confirma o contrato, a rota,
capability, limites de schema e ausência de migration.
