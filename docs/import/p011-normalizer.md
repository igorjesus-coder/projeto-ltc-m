# P011 / 1.11 — normalização local de clientes e projetos

## Estado e fronteira

O P011 lê somente os artefatos determinísticos P010, normaliza candidatos e produz um dry-run.
Ele não abre XLSX, não acessa rede ou banco, não executa SQL e não possui aplicação remota. A CLI
aceita `--apply` apenas para recusá-lo com `REMOTE_APPLY_NOT_AUTHORIZED`.

P011 termina em clientes/projetos. Itens, `source_line_key`, quantidades, preços, planejamento,
competências, Curva S, realizados, recebimentos, versões, Tableau e P012 não integram o plano.

## Contratos de entrada

São exigidos:

- `ltcm.p010.extraction-manifest.v1` e payload P009/P010 v1;
- workbook SHA-256
  `f805ea07155ec647eab8d7c0cb9e88bad578ceaa8674d48c5c219129023f9abf`;
- exatamente `project_values`, `monthly_revenue` e `curve_s` no staging;
- aba `Decisões Aprovadas` explicitamente ignorada;
- hashes de conteúdo, hashes de linha, contagens e zero erro estrutural válidos;
- warning `RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE` presente.

JSON/JSONL é tratado como não confiável. O leitor limita arquivo, linhas, texto e profundidade,
rejeita symlinks/arquivos não regulares, valida paths e nunca executa conteúdo da origem.

## Schema auditado

O destino permanece o schema `ltc_m` existente:

- `clients`: PK `id`; `legal_name` e `display_name` obrigatórios; unicidade parcial somente por
  `tax_id` ativo; `row_version`, soft delete, auditoria, RLS forçada e delete físico bloqueado;
- `projects`: PK `id`; FK `client_id`; chave natural ativa por `upper(project_code)`; moeda por FK
  `base_currency`; `classification`, `status`, `contract_value` e `data_reference_date`
  obrigatórios; `version`, soft delete, auditoria, RLS forçada e delete físico bloqueado;
- `currencies`: código ISO de três letras e `BRL` controlado/ativo;
- runtime: DML direto sujeito a RLS; não há RPC de upsert de cliente/projeto.

Nomes não são chave natural de cliente no banco. Por isso o P011 nunca faz upsert automático por
nome. Uma aplicação futura deverá receber correspondências/IDs revisados, operar em transação
serializável e abortar conflito; criar unicidade baseada em nome exigiria decisão e migration
próprias.

## Regras de clientes

A chave estrita aplica, nesta ordem: Unicode NFC, trim, colapso de whitespace e comparação
case-insensitive. Acentos, pontuação, símbolos, sufixos, palavras e números não são removidos.

O campo explícito `Cliente` é a única fonte automática. Sufixos terminais exatos `(demanda)`,
`(saldo)` ou `(contrato)` são separados como evidência de classificação, nunca como classificação
canônica. Possíveis variantes que compartilham a mesma família lexical geram somente sugestão
`ambiguous`; não ocorre fuzzy merge. Nome vazio é rejeitado. O relatório versionado expõe apenas
`client_ref` por hash, não nomes reais.

## Regras de projetos, moeda e valores

`project_code` recebe somente trim e deve obedecer `AAAA-NN-NNNNN`. O bruto e todas as
coordenadas permanecem na evidência; o espaço inicial de `2024-06-11837` é preservado. D03 mantém
`2024-10-12524` e `2025-07-14416` distintos.

Moeda vem exclusivamente da coluna `Moeda`, sem inferência por símbolo ou conversão. Ausência ou
mais de uma moeda rejeita somente o projeto dependente.

Valores preservam número bruto, round-trip decimal, texto formatado, formato, coordenada e hash.
Não há `toFixed`, arredondamento, soma de itens ou uso da Curva S. D02 mapeia exclusivamente
`164000` para `2026-04-16531` e rejeita `168000`. D04 preserva `369749.1735` somente como previsão
de recebimento/warning e marca `2024-02-10990` como `completed`; nunca o usa como contrato ou
faturamento. D05 mantém os demais valores de venda pendentes. D06 mantém contrato/demanda/saldo
como evidência sem preencher `project_classification`.

O rótulo do resumo mistura código, cliente/unidade e descrição. Ele gera proposta rastreável de
`project_name`, mas fica `pending_decision`. A data de referência também permanece pendente. Um
cliente ambíguo torna apenas seus projetos `rejected`; candidatos inequívocos permanecem
`pending_decision` até os campos obrigatórios serem aprovados.

## Snapshot, plano e persistência

`--existing-snapshot` aceita `ltcm.p011.existing-snapshot.v1` sintético. Ele permite simular
cliente existente, projeto idêntico, conflito e registro protegido sem afirmar estado do banco
real. Destino omitido significa fixture vazia com catálogo BRL conhecido; suas contagens são
simulações, não inventário remoto.

A fronteira `LtcmPersistencePort` exige transação serializável, clientes antes de projetos,
resultado por registro e valores tipados conforme o schema. O preparador recusa projeto não
resolvido; não contém delete, bypass de RLS, credencial, driver, ORM, query builder ou SQL
concatenado. A CLI não conecta essa fronteira a qualquer banco.

## Artefatos e determinismo

O diretório gerenciado P011 contém manifesto, validação da fonte, candidatos JSONL, evidências,
divergências, plano, resumo, hashes e relatório sanitizado. Escrita é atômica e só substitui um
diretório com marcador P011 válido. A saída deve ser subdiretório de `.artifacts`.

Mesma entrada, snapshot, versão e `--generated-at` produzem os mesmos bytes. O padrão temporal é
`1970-01-01T00:00:00.000Z`; temporários de escrita não entram nos artefatos/hashes.

```powershell
npm run ltcm:normalize-projects -- `
  --input-dir ".artifacts\p010-real-run-a" `
  --output-dir ".artifacts\p011-dry-run" `
  --strict
```

Uma futura aplicação no projeto compartilhado depende de autorização específica, snapshot do
destino, resolução humana, papel/contexto P007/P008, transação, rollback lógico, execução única,
reconciliação e garantia de zero alteração fora de `ltc_m`.

## Diagnósticos estruturados

O catálogo inclui `CLIENT_NAME_MISSING`, `CLIENT_MATCH_AMBIGUOUS`,
`CLIENT_SOURCE_FIELD_AMBIGUOUS`, `PROJECT_CODE_INVALID`, `PROJECT_DUPLICATE_CONFLICT`,
`PROJECT_CLIENT_UNRESOLVED`, `PROJECT_CURRENCY_MISSING`, `PROJECT_CURRENCY_AMBIGUOUS`,
`PROJECT_VALUE_CONFLICT`, `PROJECT_VALUE_SEMANTICS_PENDING`,
`PROJECT_CLASSIFICATION_PENDING`, `PROTECTED_RECORD_CONFLICT`,
`RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE`, `REMOTE_APPLY_NOT_AUTHORIZED`,
`P010_INPUT_HASH_MISMATCH` e `P009_CONTRACT_MISMATCH`. Mensagens nunca são o identificador único.
