# P016 — views analíticas para Tableau

O contrato `ltcm.p016.analytics.v1` define uma camada derivada e somente leitura sobre os fatos
persistidos em `ltc_m`. As nove views usam `security_invoker=true`, preservam RLS/FORCE RLS das
tabelas-base e concedem apenas `SELECT` a `ltc_m_runtime`. Elas não persistem resultados, não
executam funções com efeito colateral e não transformam findings em fatos de negócio.

As views não possuem ordem implícita. Consultas e Tableau devem ordenar pelas chaves e competências
declaradas. A moeda permanece uma dimensão obrigatória; valores de moedas diferentes nunca devem ser
somados sem uma política de conversão aprovada.

## Catálogo e contrato de grão

| View                                 | Finalidade                                      | Grão da linha                                                   | Chave analítica                                            | Fontes principais                                                  |
| ------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `ltc_m.v_tableau_portfolio_overview` | KPIs de portfólio sem versão                    | moeda no snapshot visível                                       | `currency_code`                                            | projects, project_items, financial_actual_events                   |
| `ltc_m.v_tableau_project_overview`   | KPIs e reconciliação do projeto                 | projeto                                                         | `project_id`                                               | projects, clients e agregados independentes de itens/realizados    |
| `ltc_m.v_tableau_project_items`      | detalhe de itens sem colapsar códigos repetidos | item persistido                                                 | `project_item_id`; negócio: `project_id + source_line_key` | project_items, projects                                            |
| `ltc_m.v_tableau_financial_monthly`  | fatos financeiros mensais discriminados         | fato persistido planned/actual                                  | `fact_kind + financial_fact_id`                            | financial_plan_lines, monthly_plan_cells, financial_actual_events  |
| `ltc_m.v_tableau_s_curve_portfolio`  | Curva S no portfólio                            | série + versão/status + competência + métrica + moeda           | todas as dimensões do grão                                 | linhas planejadas ou eventos realizados, nunca ambos no mesmo fato |
| `ltc_m.v_tableau_s_curve_project`    | Curva S por projeto                             | projeto + série + versão/status + competência + métrica + moeda | todas as dimensões do grão                                 | linhas planejadas ou eventos realizados persistidos                |
| `ltc_m.v_tableau_data_quality`       | subconjunto SQL verificável dos findings P015   | finding                                                         | `finding_id`                                               | projects, project_items, financial_actual_events                   |
| `ltc_m.v_tableau_plan_versions`      | versão, escopo e baseline                       | versão + escopo (`NO_SCOPE` quando ausente)                     | `analytical_version_key`                                   | plan_versions, scopes, baseline e contagens de origem              |
| `ltc_m.v_tableau_source_provenance`  | proveniência celular P009/P013                  | célula mensal                                                   | `monthly_plan_cell_id`                                     | monthly_plan_cells e cadeia de origem                              |

`item_code` é rótulo, não chave. `source_line_key` continua sendo usado em conjunto com o projeto. O
uso de `fact_kind` na view mensal e `series_kind` nas Curvas S é o discriminador explícito exigido
para não misturar grãos planejados e realizados.

## Métricas e aditividade

- `amount` e `monthly_amount` são aditivos somente dentro de versão/status, métrica, moeda e demais
  dimensões compatíveis;
- `cumulative_amount` é não aditivo sobre competência e deve ser usado no último mês do filtro;
- `contract_value`, totais dos itens e valores por projeto são não aditivos depois de relacionados a
  linhas filhas;
- contagem de findings é aditiva apenas no grão único de `finding_id`;
- percentuais, margem, resultado, saldo a faturar e uma versão “atual” não são calculados porque suas
  fórmulas ou regras permanecem pendentes.

Todos os valores financeiros permanecem `numeric`. Competências mensais permanecem `date`. NULL
significa fato ausente ou semântica indisponível; zero explícito continua `0.00`. Em especial, a
view de proveniência mantém separadamente `blank`, `explicit_zero` e `value` e não aplica
`COALESCE` ao valor da célula.

## Prevenção de dupla contagem

Os overviews agregam itens e eventos em CTEs independentes antes de juntá-los a projetos. Portanto,
múltiplos itens e múltiplos eventos não formam produto cartesiano. As Curvas S agregam diretamente
cada tabela de fatos e particionam a janela pela identidade completa da versão ou do status. A view
de versões pré-agrega as contagens de execuções e artefatos por baseline, enquanto a proveniência
celular fica em uma view separada e nunca participa de somas financeiras.

Não relacione duas views de fatos por projeto apenas. No Tableau, prefira relationships e preserve
as cardinalidades abaixo:

- project overview → items: `1:N` por `project_id`;
- project overview → monthly: `1:N` por `project_id`;
- plan versions → monthly: `1:N` por `plan_version_id`, exigindo filtro de versão;
- monthly → provenance: `1:0..1` por `financial_fact_id = financial_plan_line_id`, apenas quando
  `fact_kind='planned'`;
- quality → project overview: `N:1` por `project_id`;
- Curvas S devem ser fontes de fatos independentes, não juntadas a itens.

## Planejado, versão e Curva S

`billing_planned` reutiliza os valores persistidos por P013 sem novo arredondamento. Toda linha
planejada expõe `plan_version_id`, status e `is_baseline`; nenhuma regra de “versão atual” é
inferida. A view de versões retorna `current_version_supported=false` e
`CURRENT_VERSION_RULE_UNDEFINED` até existir decisão normativa.

Os acumulados usam `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. No portfólio, a partição
planejada é versão + métrica + moeda. No projeto, também inclui `project_id`. Tableau deve filtrar
uma versão e uma moeda antes de usar acumulados.

## Realizado e limitação P014

Eventos já persistidos em `ltc_m.financial_actual_events` possuem projeto e data próprios e podem
ser expostos sem inferência. O status permanece dimensão obrigatória porque a regra canônica de
status de realizado ainda não foi decidida; as views não escolhem nem somam silenciosamente draft,
posted e cancelled.

A evidência real P014 não está nessa tabela: nove totais por projeto não têm competência e um total
mensal de portfólio não tem projeto. P016 não os distribui, não cria project-month e não converte
ausência em zero. Assim, para o estado P014 atual, não existe linha artificial de realizado nas
Curvas S. `project_month_actual_available` só se torna verdadeiro diante de evento persistido com
esse grão por fonte independente.

## Qualidade e P015

P015 é um relatório computado e não persistido. `v_tableau_data_quality` não cria tabela de
findings: ela projeta somente verificações reproduzíveis no SQL atual, usando códigos P015 estáveis
para divergência contrato/itens e decisão de status de eventos persistidos. O campo
`finding_origin='database_projection'` distingue essa projeção.

Findings provenientes da fonte P014 ou de snapshots externos ao banco continuam no relatório
`ltcm.p015.reconciliation-report.v1`. Um processo futuro de Extract pode relacionar esse relatório
ao dashboard de qualidade, mas não deve gravá-lo nas tabelas de negócio nem apresentá-lo como
persistido pela P016.

## Segurança e consumo

Todas as views são `security_invoker` e `security_barrier`. O chamador precisa de `SELECT` na view e
continua sujeito aos grants e policies das tabelas-base. Um viewer enxerga apenas projetos ativos e
versões aprovadas/bloqueadas conforme P008/P013; fontes e execuções restritas podem aparecer NULL em
left joins sem ocultar a célula que o viewer está autorizado a ler.

O usuário técnico futuro do Tableau deve ser somente leitura e ter acesso exclusivamente às views,
mas sua role, credencial, Extract e agenda de atualização não são criados nesta tarefa. Nenhum acesso
remoto ou configuração de Tableau integra P016.

## Reconciliação e testes

O gate PostgreSQL 17 aplica as 13 migrations desde zero e usa fixtures sintéticas para provar:

- unicidade das chaves declaradas;
- total planejado certificado de regressão `2800460.18` BRL na versão fixture;
- último acumulado da Curva S igual ao total mensal;
- separação de versão e moeda;
- repeated `item_code` preservado;
- múltiplos itens, meses, eventos e linhas de proveniência sem multiplicação;
- blank diferente de zero explícito;
- nenhum project-month actual criado a partir da ausência P014;
- projeção de qualidade compatível com código P015;
- RLS/security-invoker e bloqueio de projeto não autorizado;
- consultas válidas em transação `READ ONLY`, sem writes, sessões ou advisory locks residuais.

Execução:

```powershell
npm run p016:check
npm run test:p016:static
$env:LTCM_P016_INTEGRATION = '1'
$env:LTCM_P016_ISOLATED_CLUSTER = '1'
$env:LTCM_P012_TEST_DATABASE_URL = 'postgresql://postgres:<senha-local>@127.0.0.1:<porta>/ltcm_test'
npm run test:p016:postgres
```

O teste aceita apenas PostgreSQL 17 em loopback, banco `ltcm_test` e superusuário local `postgres`.
