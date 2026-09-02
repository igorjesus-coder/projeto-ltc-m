# P026 — gestão de cadastros mestres

Contrato: `ltcm.p026.master-data-management.v1`

P026 administra explicitamente clientes, as moedas fechadas BRL/USD e unidades de referência ou
medida usadas por `ltc_m.project_items.unit_code`. Não existe catálogo genérico, EAV, unidade
organizacional ou grupo de reporte neste contrato.

## Autorização e API

Todos os endpoints estão sob `AuthorizationGuard` e `catalog:manage`. A capability pertence ao
papel `admin`; a RLS/FORCE RLS do PostgreSQL é a segunda linha de defesa. Não há DELETE físico.

| Método     | Rota                                                  | Operação                                  |
| ---------- | ----------------------------------------------------- | ----------------------------------------- |
| GET        | `/admin/clients?search=&status=all\|active\|inactive` | lista administrativa                      |
| POST       | `/admin/clients`                                      | cria cliente                              |
| PATCH      | `/admin/clients/:clientId`                            | edita `legalName`, `displayName`, `taxId` |
| PATCH      | `/admin/clients/:clientId/status`                     | ativa/desativa                            |
| GET        | `/admin/currencies?status=...`                        | lista somente BRL/USD                     |
| PATCH      | `/admin/currencies/:code/status`                      | altera disponibilidade BRL/USD            |
| GET        | `/admin/units?status=...`                             | lista unidades                            |
| POST/PATCH | `/admin/units` e `/admin/units/:code`                 | cria/edita unidade com código explícito   |
| PATCH      | `/admin/units/:code/status`                           | ativa/desativa unidade                    |

As mutações exigem `expectedVersion`. Alterações de status exigem também `justification`; o
contexto de ator é atribuído pelo backend e auditado na mesma transação. Campos de versão,
timestamps, ator, `active` e `deletedAt` não são aceitos por mass assignment.

## Regras de domínio

Clientes exigem `legalName` e `displayName` não vazios após trim; `taxId` é opcional/nulo. O PATCH
comum não altera status nem soft-delete. Desativar mantém o registro e não preenche `deleted_at`.
Clientes inativos não aparecem em `/projects/options` e não podem ser destino de novo vínculo ou
troca. Um projeto existente pode continuar mostrando seu cliente inativo; uma edição não
relacionada não falha apenas por essa inativação.

O domínio monetário é fechado: somente `BRL` e `USD`, sem criação de moeda, texto livre, EUR,
outra moeda, FX ou conversão cambial. O seletor operacional usa apenas moedas ativas e referências
existentes continuam armazenadas e visíveis quando uma moeda é inativada. P024 permite trocar
BRL ↔ USD quando ambas estiverem ativas; a troca preserva exatamente os valores numéricos.

`ltc_m.units` é o catálogo de unidade de referência/medida dos itens de projeto. Códigos existentes
são preservados, incluindo o histórico `US`; P026 não decide o significado normativo pendente de
D07. Novos códigos são explícitos, normalizados para maiúsculas e únicos. Não há exclusão; itens
novos usam somente unidades ativas e referências antigas preservam unidade inativada.

## Segurança e auditoria

`clients_insert` e `clients_update` foram corrigidas para admin, preservando `clients_select`,
RLS/FORCE RLS e a proibição de DELETE. Moedas e unidades mantêm leitura operacional de ativos e
mutação administrativa. O padrão `actor context → validação → DML → metadata → audit → commit`
é atômico; falhas fazem rollback.

O hardening mínimo adiciona `updated_at`, `row_version`, triggers de metadata e auditoria a
`currencies` e `units`, além da guarda administrativa para mudança de status. Não há catálogo
genérico, unidade organizacional ou tabela de FX. A decisão P026-D00-B01 é posterior e prevalece
sobre a redação BRL-fixed do baseline P024 quando houver conflito; B02 mantém somente admin como
gestor e B03 mantém o significado de unidades restrito a itens de projeto.
Na auditoria, `audit_log.record_id` permanece `text NOT NULL`: o trigger genérico usa `id` por omissão,
enquanto os triggers de `currencies` e `units` passam explicitamente `code`. Identidade configurada
ausente, nula ou vazia interrompe o DML; nenhum UUID sintético ou coluna `id` é criado nos catálogos.
