# P015 — reconciliação determinística e relatório de inconsistências

P015 implementa uma consulta computada e read-only sobre snapshots explícitos dos contratos P011,
P012, P013 e P014. O schema atual foi classificado como `SCHEMA_COMPLETE`: findings não são fatos de
negócio e não precisam de tabela própria. A execução normal realiza zero writes, zero DDL e nenhum
acesso remoto; nenhuma migration foi adicionada.

## Contratos

- entrada: `ltcm.p015.reconciliation.v1`;
- relatório: `ltcm.p015.reconciliation-report.v1`;
- dinheiro: canonicalização decimal P013/P014, soma e delta com `BigInt` em centavos;
- ordem: severidade, domínio, projeto, item/source key, competência, código e ID do finding;
- identidade: fingerprints SHA-256 sobre JSON canônico, sem timestamp ou aleatoriedade.

O construtor valida os snapshots, ordena referências e fatos e emite uma autoridade opaca somente
de leitura. Clones, spread, relatórios forjados e objetos rehashados não adquirem essa autoridade.
O mesmo estado produz os mesmos findings, ordem, totais, IDs e fingerprint.

## Domínios e classificação do inventário

| Domínio               | Estado                                | Regra P015                                                             |
| --------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| projeto/contrato      | `AUTHORITATIVE` ou `PENDING_DECISION` | compara valor fonte, banco e soma compatível dos itens                 |
| itens                 | `AUTHORITATIVE`                       | identidade P012 = projeto + `source_line_key`; `item_code` não é chave |
| plano mensal/baseline | `AUTHORITATIVE`                       | compara células e linhas P013 no mesmo projeto/item/mês/métrica/moeda  |
| realizados P014       | `NON_MIGRATABLE`                      | reporta ausência de project + competence, sem alocar                   |
| custos                | `PARTIAL` ou `MISSING`                | compara somente quando a semântica declara valores comparáveis         |
| a faturar             | `PENDING_DECISION`                    | não cria fórmula; registra decisão/unsupported comparison              |
| staging/import batch  | `AUTHORITATIVE`                       | detecta identidade repetida e preserva proveniência                    |
| RLS/auditoria         | `AUTHORITATIVE`                       | não alterado; P015 não possui writer nem grant                         |

Os 17 códigos estáveis incluem divergências de projeto/item/baseline, campos obrigatórios,
duplicidades, inconsistência fonte-banco, decisão pendente, custo indisponível, incompatibilidade de
grão e duplicação de importação. Severidades são `INFO`, `WARNING`, `ERROR` e `BLOCKING`; elas não
representam estado de workflow.

## Compatibilidade de grão

Uma soma ou comparação monetária só ocorre quando projeto, item quando aplicável, competência,
métrica, moeda e versão/snapshot são compatíveis. Moedas divergentes ou dimensões insuficientes
produzem `GRAIN_MISMATCH`/finding específico, nunca um total artificial.

P014 é uma regressão normativa explícita:

- `REALIZED_PROJECT_MISSING_COMPETENCE` para agregado realizado por projeto sem competência;
- `REALIZED_MONTH_MISSING_PROJECT` para agregado mensal de portfólio sem projeto;
- dez fatos atuais permanecem dez evidências não migráveis;
- zero actual events, zero writes, zero alocação e nenhum uso de forecast para fabricar realizado.

## Proveniência e decisões

Cada finding contém referências canônicas de fonte e/ou banco, projeto, item/source key,
competência, métrica, valores esperado/observado, delta, código, explicação e classe de remediação.
Decisões pendentes mantêm seu identificador e aparecem em `unresolved_decisions`; P015 não as marca
como resolvidas.
Comparações sem fórmula ou semântica aprovada aparecem como `UNSUPPORTED_COMPARISON`, inclusive
`billing_remaining`; nenhuma fórmula financeira nova é inferida.

## Relatório

O relatório JSON inclui contagens por severidade/domínio, status por projeto (`PASS`, `WARNING`,
`ERROR`, `BLOCKED_BY_DECISION`), resumo do portfólio, deltas apenas de grãos compatíveis, decisões e
evidência P014 não migrável. `renderP015HumanSummary` produz linhas sanitizadas para leitura humana.

Reprodução local:

```powershell
npm run p015:check
npm run test:p015
```

Os testes usam fixtures exclusivamente sintéticas e não dependem da planilha real, de banco remoto,
de credenciais ou de caminhos absolutos.
