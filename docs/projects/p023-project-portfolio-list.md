# P023 — lista de portfólio de projetos

Contrato: `ltcm.p023.project-portfolio-list.v1`

## Limites

O navegador acessa somente a API NestJS/Express. A API consulta PostgreSQL em uma transação com
contexto do ator; RLS/FORCE RLS continua sendo a barreira definitiva. A P023 não cria formulário,
escrita, migration, view nova ou dependência.

## API

`GET /projects` exige autenticação Auth0, perfil LTC-M ativo e as capabilities `data:read` e
`financial:read`. O retorno é:

```json
{
  "contract": "ltcm.p023.project-portfolio-list.v1",
  "items": [],
  "page": 1,
  "pageSize": 25,
  "totalItems": 0,
  "totalPages": 0
}
```

Cada item contém `projectId`, `code`, `clientName`, `status`, `currencyCode`, `contractValue`,
`unscheduledBalance`, `unscheduledBalanceStatus`, `updatedAt`, `alertCount` e, quando existente,
`alertsSummary`. Valores monetários e timestamps são strings exatas.

Parâmetros aceitos: `search`, `status`, `sort`, `order`, `page` e `pageSize`. A busca é parcial,
case-insensitive e cobre código e cliente. `%`, `_` e `\` são escapados antes do `ILIKE`. Status
usa o enum persistido. Ordenação usa allowlist (`code`, `client`, `status`, `contractValue`,
`unscheduledBalance`, `updatedAt`) e sempre termina em `project_id ASC`. `page` começa em 1 e
`pageSize` varia de 1 a 100, com default 25. A contagem é feita por `count(*) over()` depois dos
filtros, sem paginação no browser.

## Saldo e fatos

`contractValue` é `ltc_m.projects.contract_value`, sem recomputação por itens e sem somar recortes
mensais de recebimento. O saldo segue P023-D00-DEC-01:

```text
max(contract_value - billing_actual_posted - billing_planned, 0)
```

`billing_actual_posted` soma somente `financial_actual_events` com métrica `billing_actual` e
status `posted`. Draft/cancelled e qualquer estado não concretizado ficam fora; `receipt_forecast`
não é promovido a realizado.

`billing_planned` é agregado somente de linhas `billing_planned` no grão `item`, da única versão
associada ao projeto com status `approved` ou `locked`. Nenhuma versão é escolhida por data ou
arbitrariamente. Sem versão oficial, o saldo é `null` com status `no_official_plan`; com múltiplas
versões oficiais, é `null` com status `ambiguous_official_plan`. Contrato ausente, inconsistência
de moeda ou outra indisponibilidade também falham fechado. O saldo nunca transforma desconhecido
em zero. Se realizados mais planejados excederem o contrato, o saldo mantém piso zero e os
achados de qualidade permanecem expostos.

Itens, planejamentos, realizados e alertas são pré-agregados antes do join com projetos, mantendo
uma linha por projeto. `opening_balance` permanece separado. A fonte primária é `projects` +
`clients`; alertas são somente os achados P016 materializados `PROJECT_VALUE_MISMATCH` e
`ACTUAL_STATUS_UNRESOLVED`, sem antecipar P034 ou criar alerta por SLA.

`projects.updated_at` é exibido como “Última atualização”, em ISO 8601 na API e formato amigável
na UI. D12 não cria periodicidade, SLA, cor de atraso ou alerta temporal. D04, D05, D06, D08, D09,
D11, D12 e P023-D00-DEC-01 são preservadas sem inferência adicional.

## Frontend

`/projects` é protegido e mantém busca, filtro, ordenação, página e tamanho na query string.
Alterações e `popstate`/back/forward reidratam a listagem. A tabela usa semântica HTML, `aria-sort`,
controles de teclado, estados de carregamento, sucesso, vazio, nenhum resultado, erro, 401 e 403,
overflow horizontal controlado a partir de 320px e os componentes P022.

`/projects/:projectId` é um detalhe mínimo somente leitura. O link carrega `returnTo` validado como
path interno; “Voltar para projetos” restaura exatamente o contexto da lista. Cadastro e edição
permanecem fora da P023.
