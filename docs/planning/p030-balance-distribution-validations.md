# P030 — distribuição de saldo e validações financeiras

Contrato: `ltcm.p030.balance-distribution-validations.v1`

## Decisões P030-D01

As decisões abaixo foram aprovadas explicitamente para fechar os gaps encontrados no discovery
P030-D00. Elas não alteram retroativamente P023 ou P013.

- **P030-D01-DEC-01 — saldo do draft:** `raw_balance = contract_value - billing_actual_posted - billing_planned_draft`; `distributable_balance = max(raw_balance, 0)`. O piso zero serve somente para distribuir; excesso usa o saldo bruto negativo.
- **P030-D01-DEC-02 — percentual:** a ação Distribuir saldo usa o saldo distribuível calculado imediatamente antes da operação. Os pesos das células selecionadas devem totalizar exatamente 100%; edição manual continua sendo edição direta P029.
- **P030-D01-DEC-03 — centavos:** parcelas são calculadas em centavos inteiros. O residual é entregue pela ordem `competence ASC`, depois `item UUID ASC`. Assim, `100.00 / 3` produz `33.34`, `33.33`, `33.33`.
- **P030-D01-DEC-04 — saldo remanescente:** saldo bruto positivo pode ser salvo em draft e gera warning textual com valor exato.
- **P030-D01-DEC-05 — excesso:** excesso exige `forecast:override_balance` e justificativa. A capability pertence somente ao perfil `admin`; reduzir excesso existente até ficar dentro do contrato continua permitido ao editor.

## Autoridade financeira

O backend recalcula `contract_value`, realizado postado, planejamento do draft, saldo bruto,
saldo distribuível e excesso dentro da mesma transação que bloqueia a versão e valida
`content_revision`. O cliente envia somente a intenção e os valores das células. A fonte de
`billing_actual_posted` é `financial_actual_events` com `metric_type = billing_actual` e
`status = posted`; nenhum realizado é fabricado ou alterado.

O read model do editor expõe `financial` com:

- `contractValue`, `actualPosted`, `plannedDraft`;
- `rawBalance`, `distributableBalance`, `unplannedBalance`;
- `hasExcess`, `currency` e `canOverrideBalance`.

O draft considera somente linhas `billing_planned` no grão `item` da versão em edição. Versões
`approved`, `locked` e `archived` não participam do cálculo P030.

## Distribuição percentual

Percentuais usam escala determinística de quatro casas decimais de ponto percentual, sem
`Number`, por exemplo `33.3333%`. Pesos negativos, vazios, malformados, `NaN`, `Infinity`, zero
ambíguo, duplicidade de destino e soma diferente de 100% são rejeitados.

O algoritmo puro ordena destinos por competência e UUID do item, calcula o piso em centavos e
entrega cada centavo residual na ordem canônica. A distribuição é apenas preview local; valores
existentes são incrementados e o save continua sendo o único PUT P029. Clicar sem saldo não altera
`content_revision`.

## Segurança e limites

Auth0, RLS/FORCE RLS, auditoria, baseline P013, realized e moeda BRL/USD permanecem inalterados.
Não há FX, acesso browser ao banco ou `DELETE` físico. A capability P030 é estática no modelo P021;
por isso não foi criada migration e o inventário continua com 17 migrations.

InconsistÃªncia de moeda falha fechado com `P030_CURRENCY_MISMATCH`; nÃ£o hÃ¡ FX.

Os limites P029 permanecem: 5.000 entradas por batch, 240 meses, `numeric(20,2)` e justificativa
trimada de até 2.000 caracteres. A resposta server-side após save é o estado financeiro canônico.

O discovery P030-D00 não encontrou artefato versionado correspondente à dependência 0.03. As
decisões P030-D01 são a autoridade específica desta entrega.
