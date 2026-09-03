# P029 — editor de programação mensal

Contrato: `ltcm.p029.monthly-planning-editor.v1`

## Discovery e decisão de implementação

O repositório não contém um artefato ou uma tarefa identificável como Master Control `1.16`; a
dependência concreta encontrada para o editor é a fundação mensal P013 (P013 D02/D03/D05), além do
workflow P007/P008, autorização P021 e itens P027/P028. O modelo existente suportou o editor, com
uma migration aditiva necessária apenas para avançar o token de concorrência do batch.

O modelo canônico é `ltc_m.plan_versions` (versão global), `ltc_m.financial_plan_scopes` (relação
versão/projeto/métrica e grão) e `ltc_m.financial_plan_lines` (uma linha por
versão/projeto/item/métrica/competência). O grão usado é `billing_planned` por item, com
`numeric(20,2)`, `amount >= 0` e competência no primeiro dia do mês. `project_items.id` e
`source_line_key` identificam o item; `item_code` pode repetir.

Versões podem estar em `draft`, `pending_approval`, `approved`, `locked` ou `archived`; somente
`draft` é editável. Itens inativos permanecem visíveis para histórico, mas rejeitam novas
alterações. P013 confirmou que `blank` não é linha financeira, enquanto zero explícito é `0.00`.
O editor não remove linhas fisicamente; para zerar uma declaração existente deve-se informar
`0.00`. Não há FX; a moeda exibida é a moeda-base do projeto.

## API e transação

- `GET /planning/projects`: projetos autorizados com código, nome, moeda e status.
- `GET /planning/projects/:projectId/versions`: versões com escopo mensal por item.
- `GET /planning/projects/:projectId/editor?versionId=...&from=YYYY-MM-01&to=YYYY-MM-01`: read model
  sem N+1, com projeto, versão, competências, itens, linhas e totais mensais. Sem intervalo, usa
  linhas existentes ou `projects.start_date/end_date`; quando ambos não existem, o intervalo é
  escolhido explicitamente pelo usuário.
- `PUT /planning/projects/:projectId/versions/:versionId/months`: recebe
  `{ expectedVersion, justification?, entries[] }` e persiste todos os itens/meses em uma única
  actor transaction. Duplicatas, competência deslocada, valor inválido, item de outro projeto,
  item inativo, versão incompatível ou versão stale falham fechado.

`forecast:edit_draft` é a capability usada para escrita; nenhuma nova capability foi criada.
`plan_versions.row_version` é bloqueado e comparado no batch; `content_revision` é incrementado
para produzir uma mudança de conteúdo que aciona o metadata trigger e avança o token. Repetição
com token obsoleto recebe `P029_VERSION_CONFLICT`; não há last-write-wins.
Triggers existentes geram auditoria com `justification`; não há `DELETE` no fluxo.

Baselines P013 com `monthly_plan_cells` permanecem imutáveis, pois a proveniência mantém uma FK
composta que inclui o valor original da linha. O endpoint rejeita esse caso antes de qualquer
upsert com `P029_BASELINE_IMMUTABLE`; uma versão sem essa cadeia pode ser editada normalmente.

Diferenças em tempo real são `valor editado - valor carregado`, com ausência tratada como zero
somente para apresentação e totais locais. Backend/PostgreSQL permanece a fonte de verdade.

## Frontend e qualidade

`/planning` integra a navegação P022 e oferece seletor de projeto/versão, range explícito, visão por
item editável e visão agregada por projeto somente leitura. O estado local separa original/editado,
calcula dirty/diferença/totais com `BigInt` em centavos e envia uma única requisição PUT. Após
sucesso, o readback da API substitui o estado local; trocas com alterações pendentes pedem
confirmação.

Foi criada a migration aditiva `20260903100000_add_p029_plan_content_revision.sql`: a revisão
provou que o trigger P007 ignora alterações isoladas de `updated_by_user_id`, portanto o
`row_version` não avançava para batches mensais. Migrations antes/depois: 16/17. O fingerprint
P017 após a migration é
`d5a2aa655bc2ea8694fd73c14474d561f90b053fc482c5789a539a5b11c7155e`. O checker
`scripts/check-p029-tests.mjs` verifica contrato, endpoints, guard, upsert, concorrência, precisão,
competência mensal, testes e documentação.
