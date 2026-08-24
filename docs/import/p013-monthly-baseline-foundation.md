# Fundação do baseline mensal P013

## Escopo D02

A D02 implementa somente a fundação versionada para uma futura importação do baseline mensal
`billing_planned`. Ela não implementa leitura/canonicalização completa, resolução P012 para UUID,
dry-run ou aplicação mensal. Não existe writer genérico, CLI de apply, acesso remoto ou integração
com Render/Supabase. P014, Curva S, realizados e reforecast permanecem fora do escopo.

O contrato congelado D01A usa a aba `Prev. Receita Mensal`, intervalo semântico `A1:T52`, 48 itens,
competências de julho de 2026 a março de 2027 e 432 posições K:S. O censo aprovado contém 330
blanks, um zero explícito e 101 valores não zero. O SHA do artefato identifica bytes; ele não é a
autorização semântica da fonte.

## Fonte e gate semântico

O gate `ltcm.p013.monthly-source-semantic.v1` substitui a suposição P010 de exatamente 24
definições independentes de fórmula na aba mensal. A contagem OOXML é topologia incidental: a
fonte D01A candidata possui 19 definições e a referência anterior, 24. Ambas produzem o mesmo
fingerprint semântico aprovado
`a02215599f1a4762e8dcfc747c13537bce76b3c3909f43fb92efe54e8ab3ffa0`.

O payload do fingerprint contém somente contrato/versionamento, natureza financeira, worksheet e
células ordenadas por código de projeto, número do item-fonte e competência. Cada célula contém o
estado `blank`, `explicit_zero` ou `value` e o valor monetário canônico quando material. A
serialização canônica usa JSON com chaves lexicograficamente ordenadas, UTF-8 e SHA-256. SHA do ZIP,
timestamps, formatação, texto da fórmula, relationship IDs, calcChain e contagem de definições não
integram essa identidade.

O gate continua fail-closed para aba/headers/linhas/competências incorretos, material fora do
limite, identidade duplicada ou inválida, valor/estado alterado, erro de fórmula, cache obrigatório
ausente e fingerprint diferente. Os caches K52:S52 precisam existir e T52 precisa reconciliar com
o agregado bruto arredondado. Diferenças binárias incidentais nos caches intermediários de soma não
mudam a identidade financeira.

## Decimal, blank e zero

Valores financeiros são analisados como texto decimal, nunca por `Number`. O formato aceita apenas
inteiros não negativos sem sinal/expoente e até 14 casas. Cada célula é arredondada para duas casas
pela regra decimal half-away-from-zero aplicável a valores não negativos, antes da persistência em
`numeric(20,2)`. O limite é de 18 dígitos inteiros após o arredondamento.

`blank` significa ausência de declaração e não referencia `financial_plan_lines`. Zero numérico é
uma declaração explícita, tem valor `0.00` e referencia uma linha financeira. No workbook D01A, a
soma dos valores canônicos por célula é `2800460.18`; o agregado bruto arredondado/T52 é
`2800460.15`; o residual determinístico é `0.03`.

## Persistência e proveniência

A migration `20260820120000_add_p013_monthly_baseline_foundation.sql` acrescenta quatro tabelas:

- `monthly_source_artifacts`: identidade binária, metadados XLSX, worksheet e fingerprint da fonte;
- `monthly_plan_baselines`: uma identidade semântica por `plan_version` e `billing_planned`;
- `monthly_plan_import_executions`: vínculo imutável entre o recibo/lifecycle de `import_batches`,
  artefato e baseline;
- `monthly_plan_cells`: proveniência até batch, sheet, staging row, célula, competência,
  `project_item`, linha financeira e valor canônico.

`import_batches` continua sendo o estado durável (`received`, `validating`, `rejected`, `loaded`) e
o ponto de recuperação de receipt por `idempotency_key`; não há lifecycle duplicado. A identidade
P012 é obrigatória por FK composta `(project_item_id, project_id)`. `item_code`, descrição e número
de linha isolados não são chaves, e códigos repetidos continuam permitidos.

A chave financeira existente de item impede duas linhas do mesmo plano/projeto/item/métrica/mês.
A nova unicidade impede dois baselines da mesma versão/métrica, duas células do mesmo
baseline/item/mês, duas proveniências para a mesma linha financeira, dois artefatos com o mesmo SHA
e duas execuções para o mesmo batch. FKs compostas garantem que hash, artefato, batch, sheet,
staging row, baseline, plano, item, valor e linha financeira pertençam à mesma cadeia. Assim,
concorrência e retries não dependem de `check then insert` na aplicação.

Um novo SHA pode registrar outro artefato com o mesmo fingerprint e reutilizar o baseline sem
duplicar linhas. Um fingerprint divergente para a mesma versão/métrica colide com a identidade de
negócio e falha fechado; D02 não atualiza silenciosamente baseline ou linha existente.

## Segurança e validação local

As quatro tabelas são append-only, auditadas, têm `ENABLE/FORCE ROW LEVEL SECURITY`, revogação de
`PUBLIC` e somente `SELECT, INSERT` para `ltc_m_runtime`. Editor/admin ativo pode inserir; baseline,
execução e célula exigem versão baseline em `draft`. Viewer só lê baseline/células após aprovação ou
bloqueio, e não lê artefato/execução. A D02 não cria nem altera função `SECURITY DEFINER`.

Os checks locais são:

```powershell
npm run p013:check
npm run test:p013:static
$env:LTCM_P013_INTEGRATION = '1'
npm run test:p013:postgres
```

O teste PostgreSQL reutiliza `LTCM_P012_TEST_DATABASE_URL`, mas aceita somente endpoint literal
loopback, porta 5432, banco `ltcm_test`, PostgreSQL 17 e bootstrap `postgres` superuser. Ele aplica
as migrations desde zero, usa somente fixtures sintéticas, prova RLS/FORCE RLS, grants, FKs,
unicidade, retry concorrente, recuperação de receipt e limpa fixtures, conexões e locks no
`finally`. A variável e sua credencial nunca são impressas.

A continuação D03 implementa exclusivamente o plano canônico e o dry-run somente leitura,
documentados em
[`p013-monthly-baseline-plan-dry-run.md`](p013-monthly-baseline-plan-dry-run.md). Ela não altera a
migration desta fundação e não adiciona caminho de persistência.
