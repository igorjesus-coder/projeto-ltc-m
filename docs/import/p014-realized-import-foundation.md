# P014 D01 — descoberta e impossibilidade controlada de realizados

## Decisão normativa

Nesta slice, `Realizado` significa o que efetivamente aconteceu ou foi concretizado, em contraste
com o previsto. A própria fonte reforça a definição em `Decisões Aprovadas!B5:F5`:

- tema: `Curva S — Realizado Mensal`;
- regra: `Valor efetivamente faturado no mês.`;
- impacto: `A linha Realizado Mensal deve representar faturamento efetivo.`;
- métrica: `billing_actual`;
- status da decisão: `Aprovada`.

`Faturado`, nesta fonte, pode portanto ser classificado como realizado de faturamento. Isso não
transforma `Previsto Mensal`, `Previsão de Recebimento`, `receipt_forecast`, custo ou resultado em
realizado. Nenhum valor planejado foi usado para gerar ou distribuir realizado.

## Fonte e evidência

O artefato examinado foi
`.local-source/Previsão_de_Receita_-_LTC-M_com_Curva_S_atualizada.xlsx`, somente leitura,
ignorado e não rastreado pelo Git:

- SHA-256: `a52a31c08db01e7d04a29245c58496b86be09a5df9107c74e7c59db16cb5e8e5`;
- tamanho: 33.873 bytes;
- abas inspecionadas: `Valores Projetos LTC-M`, `Prev. Receita Mensal`, `Curva S` e
  `Decisões Aprovadas`.

O P010 materializou somente as três abas operacionais e passou em modo strict com um warning já
conhecido de `receipt_forecast`. A aba documental foi lida apenas em memória pelo gate P014. O XLSX
não é salvo, normalizado ou reescrito.

### Grão 1 — realizado agregado por projeto

`Valores Projetos LTC-M!C2:K2` identifica nove projetos. `A4` traz o rótulo `Faturado` e
`C4:K4` traz uma declaração numérica para cada projeto. `B4=SUM(C4:K4)` reconcilia o total.
`B10` registra `obs.: Dados em atualização (21/07)`, mas não informa ano, mês de competência,
data de documento ou corte autoritativo por evento.

| Projeto         | Célula | Estado                       | Valor canônico (BRL) |
| --------------- | ------ | ---------------------------- | -------------------: |
| `2024-02-10990` | `C4`   | fórmula `C3`, cache presente |         `2260099.66` |
| `2024-06-11837` | `D4`   | valor                        |          `232825.00` |
| `2024-10-12524` | `E4`   | valor                        |          `205446.00` |
| `2025-07-14416` | `F4`   | zero explícito               |               `0.00` |
| `2026-01-15797` | `G4`   | zero explícito               |               `0.00` |
| `2025-12-15568` | `H4`   | zero explícito               |               `0.00` |
| `2025-08-14656` | `I4`   | zero explícito               |               `0.00` |
| `2026-03-16231` | `J4`   | zero explícito               |               `0.00` |
| `2026-04-16531` | `K4`   | zero explícito               |               `0.00` |

Total canônico: `2698370.66`. A D01 classifica esse grão como
`PROJECT_AGGREGATE_REALIZED`. Os projetos são identificáveis por `project_code`; item e
competência não estão presentes. Todos os nove fatos recebem
`NON_MIGRATABLE_MISSING_COMPETENCE`.

`Decisões Aprovadas!B9:E9` confirma que `2024-02-10990` está integralmente faturado e que seus
valores programados são previsão de recebimento. Essa evidência valida o significado de `C4`, mas
não fornece a competência ausente.

### Grão 2 — realizado mensal agregado de portfólio

`Curva S!B12` traz `Realizado Mensal (R$)`. `C7:K7` define as competências de julho de 2026 a
março de 2027. `C12` é um valor manual sem fórmula; `D12:K12` são blanks; `L12` apenas soma a
linha. A legenda em `B16` confirma o preenchimento manual da linha de realizado.

- fato material: `Curva S!C12`, competência `2026-07-01`, decimal OOXML
  `551516.65500000003`, canônico `551516.66` BRL;
- blanks: `D12:K12`; eles não são eventos zero;
- total: `551516.66` BRL;
- projeto e item: ausentes.

O cabeçalho `Prev. Receita Mensal!C1` diz `ITEM FATURADO`, mas não liga um item, valor e
competência de realizado de forma verificável. Ele é preservado como hint não autoritativo e não
gera fatos.

Esse grão é classificado como `OTHER_EVIDENCE_BASED_GRAIN:PORTFOLIO_MONTH_REALIZED`. O único
fato material recebe `NON_MIGRATABLE_INSUFFICIENT_GRAIN`, pois a fonte não prova o projeto.

## Contratos e gate

O loader `ltcm.p014.certified-realized-source.v1` reutiliza o extrator P010, verifica arquivo antes
e depois da leitura, usa o decimal textual exato do OOXML e exige o fingerprint semântico
`1af436b98a170dfd540c1f712455cd82b37f61441bd328f9f6fd853ce491a19e`.

O payload `ltcm.p014.realized-source-semantic.v1` congela decisão normativa, rótulos, grãos,
identidades, competências, estados blank/zero/valor, decimais, fórmula/cache e reconciliações. O
hash da linha P010 e os hashes de valor/posição permanecem na proveniência, mas o fingerprint
semântico não depende de formatação incidental. Objetos reconstruídos, clones e rehashes não
adquirem a authority runtime guardada em `WeakMap`.

Cada fato material recebe uma chave
`p014-realized-v1:<sha256(ltcm.p014.realized-source-key.v1 + métrica + grão + projeto + competência)>`.
A chave não inclui SHA do arquivo, timestamp, valor ou ordem de iteração: rerun byte-idêntico e
rehash semanticamente equivalente mantêm a identidade; mudança de valor na mesma identidade muda
o fingerprint do fato e deve ser conflito em qualquer persistência futura.

Valores financeiros seguem a canonicalização decimal P013: texto estrito, até 14 casas,
arredondamento half-away-from-zero para duas casas e no máximo 18 dígitos inteiros. `Number` não
é usado para canonicalizar o decimal autoritativo.

## Dry-run e impossibilidade controlada

O contrato `ltcm.p014.realized-import.v1` produz um relatório determinístico com:

- 18 posições, 10 fatos, 8 blanks, 6 zeros explícitos e 4 valores não zero;
- 0 migráveis, 10 não migráveis, 0 pendências genéricas e 0 conflitos na fonte congelada;
- resolução de projeto/item/competência por fato;
- decimal bruto e canônico, célula, linha, aba, hashes e `source_key`;
- `target_actual_status=null`, porque a fonte não autoriza escolher `draft`, `posted` ou
  `cancelled`;
- `database_access=none`, zero SELECTs e zero writes;
- `arbitrary_allocation_performed=false`;
- `planned_values_used_to_manufacture_realized=false`.

Execute localmente:

```powershell
npm run ltcm:analyze-realized -- `
  "--input=.local-source\Previsão_de_Receita_-_LTC-M_com_Curva_S_atualizada.xlsx"
```

O JSON canônico é emitido em stdout. Erros públicos usam somente códigos P014 e não propagam
path, DSN, senha ou erro cru.

## Schema e persistência

O schema é `SCHEMA_INCOMPATIBLE` com os grãos autoritativos encontrados.
`ltc_m.financial_actual_events` já representa `billing_actual`, aceita item nulo e possui unicidade
DB `(project_id, source_key)`, mas exige simultaneamente `project_id` e `competence_date`.

- o agregado por projeto não possui competência;
- o agregado mensal de portfólio não possui projeto.

Não foi criada migration, tabela, coluna, grant, policy, role ou associação. Não houve batch,
staging ou evento persistido. `monthly_source_artifacts` P013 não foi reutilizada porque seu
contrato é específico de `billing_planned` e de uma única worksheet; `import_batches` continua
genérica, mas criar um batch para uma análise sem writes duplicaria estado sem necessidade.

RLS/FORCE RLS, grants e exposição PUBLIC permanecem inalterados. As garantias existentes da
tabela de eventos serão reutilizáveis somente quando houver fatos migráveis.

## Dados/decisão necessários para desbloquear

1. Quebra autoritativa de `Valores Projetos LTC-M!C4:K4` por competência/data de
   `billing_actual`, preservando a identidade de origem de cada evento.
2. Quebra autoritativa de `Curva S!C12` por projeto, sem rateio por forecast, percentuais ou itens
   planejados.
3. Evidência ou regra aprovada para o `actual_status` do evento antes de qualquer persistência.

Uma futura fonte que contenha projeto + competência + valor poderá usar o modelo existente com
`project_item_id=null`. Item só poderá ser preenchido se a nova evidência provar identidade P012.

## Validação

```powershell
npm run test:p014
```

Os testes cobrem fonte real quando disponível, rótulos/worksheet, projeto ausente/duplicado,
competência deslocada, métrica divergente, fórmula/cache, blank/zero, amount, item/competência
fabricados, source key, rehash, rerun, authority por identidade e sanitização da CLI. Como a
decisão correta é zero persistência, first import, lost receipt e concorrência DB não se aplicam:
todos produzem o mesmo relatório puro e nenhum evento lógico.
