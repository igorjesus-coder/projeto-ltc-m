# P024 — cadastro e edição de projetos

Contrato: `ltcm.p024.project-create-edit.v1`

## Escopo

P024 implementa o cadastro e a edição operacional de `ltc_m.projects`. O navegador acessa somente
a API NestJS/Express; a API usa transação com contexto do ator; PostgreSQL, RLS/FORCE RLS e os
triggers existentes continuam sendo a autoridade final.

Não fazem parte do contrato: exclusão, restauração, CRUD de clientes, itens, realizados,
planejamento financeiro, workflow novo de projetos, `manager_user_id` ou a exceção legada D40.

## Permissões e endpoints

| Método | Rota                        | Capability          | Resultado                             |
| ------ | --------------------------- | ------------------- | ------------------------------------- |
| GET    | `/projects/options`         | `data:read`         | clientes ativos e `baseCurrency: BRL` |
| GET    | `/projects/:projectId/edit` | `data:read`         | dados factuais para edição            |
| POST   | `/projects`                 | `record:create`     | projeto criado, HTTP 201              |
| PATCH  | `/projects/:projectId`      | `record:edit_draft` | projeto atualizado, HTTP 200          |

Viewer e approver não escrevem. Editor cria e edita somente projetos `active`. Admin segue os
estados reais e as policies existentes, sem bypass. Auth0 fornece identidade; o perfil interno é
resolvido pelo backend; nenhum ator, role ou capability vem do payload.

## Payloads

O POST aceita somente:

`projectCode`, `projectName`, `clientId`, `reportingGroup`, `classification`, `status`,
`contractValue`, `openingBalance`, `budgetCost`, `startDate`, `endDate`, `dataReferenceDate` e
`notes`.

`baseCurrency` é fixada server-side em `BRL`. `id`, `managerUserId`, `version` atribuível,
metadados de auditoria, `deletedAt`, `legacyImportBatchId`, saldo derivado, alertas e campos
desconhecidos são rejeitados.

O PATCH é parcial, exige `expectedVersion` e aceita os campos manuais acima, exceto
`projectCode` e `baseCurrency`, que são imutáveis no baseline P024.

Strings são trimadas. Datas usam `YYYY-MM-DD`. Valores são strings decimais não negativas com até
18 dígitos inteiros e 2 casas. `contractValue` e `dataReferenceDate` são obrigatórios no POST;
`openingBalance`, `budgetCost`, datas de início/fim, grupo e notas são opcionais. O PATCH não pode
limpar `dataReferenceDate`, pois D40 permanece fora do fluxo manual.

## Domínios e regras

- `classification`: `full_contract` (Contrato), `demand` (Demanda) e `opening_balance` (Saldo),
  sempre escolhida explicitamente.
- Editor usa status efetivo `active`; o formulário não oferece transição de status.
- Admin pode selecionar `draft`, `active`, `on_hold`, `completed` ou `cancelled`, conforme RLS.
- Cliente deve estar `active = true` e `deleted_at IS NULL`. Opções inativas/deletadas não são
  exibidas nem vinculadas no fluxo comum.
- Moeda é `BRL`, somente leitura, sem FX ou conversão.
- `contract_value`, `opening_balance` e `budget_cost` permanecem medidas distintas.
- `end_date` não pode anteceder `start_date`.
- Saldo sem programação e alertas são derivados/read-only e não pertencem aos payloads.

## Concorrência e auditoria

PATCH executa update condicional por `id` e `version`. O trigger `trg_10_projects_metadata`
incrementa a versão e atualiza `updated_at`; o backend não altera esses campos diretamente.
`trg_90_projects_audit` registra before/after sanitizado, ator, subject, request ID, origem e
versões na mesma transação. Falha da auditoria causa rollback.

## Erros

Erros são sanitizados: `P024_INVALID_PAYLOAD`, `P024_UNKNOWN_FIELD`, `P024_IMMUTABLE_FIELD`,
`P024_DOMAIN_INVALID`, `P024_CLIENT_UNAVAILABLE`, `P024_REFERENCE_DATE_REQUIRED`,
`P024_PROJECT_NOT_FOUND`, `P024_PROJECT_CODE_CONFLICT`, `P024_VERSION_CONFLICT` e
`P024_PROJECT_STATUS_NOT_EDITABLE`, além dos contratos 401/403 de P020/P021.

## Frontend

As rotas `/projects/new` e `/projects/:projectId/edit` usam o roteador manual e os componentes
P022. `returnTo` aceita somente caminhos internos. Submit pendente é desabilitado, o formulário
mantém estado dirty com proteção nativa de saída, erros são associados aos campos e o layout
funciona a partir de 320px.

## Decisões P024-D00

As decisões B01–B05 são implementadas como aprovadas: código informado e imutável, editor apenas
ativo, BRL fixa, classificação independente do saldo de abertura e clientes ativos/não deletados.

## Banco e dependências

P024 usa as 14 migrations existentes, não cria migration e não adiciona dependência npm. Nenhuma
policy, grant, role, segredo ou configuração remota é alterada.
