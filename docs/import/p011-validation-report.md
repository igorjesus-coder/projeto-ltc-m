# P011-PRE — relatório final sanitizado

Status: **concluída localmente e pronta para revisão Git**. A aplicação remota continua bloqueada
pela D34. A autorização D35 foi consumida pela única execução de `npm audit --omit=dev` e não é
reutilizável.

Este relatório não contém nomes completos de clientes, caminho absoluto, credencial, payload
empresarial integral ou inventário alegado do banco remoto.

## Git e escopo

- branch: `main`;
- base anterior às alterações P011: `0b872249be40c0ae1c566991b3798752a598301f`;
- mudanças locais: integração mínima em `README.md`, `package.json` e `package-lock.json`, três
  documentos P011 e o workspace `tools/ltcm-normalizer`;
- nenhum arquivo staged, XLSX, artefato de `.artifacts/`, segredo, caminho absoluto de usuário ou
  migration nova/alterada;
- `git diff --check`: código 0.

## Schema local versionado

O destino documentado é o schema `ltc_m`, sem consulta remota:

- `ltc_m.clients`: PK `id`; `legal_name` e `display_name` obrigatórios; `tax_id` opcional é a única
  chave natural candidata e tem unicidade parcial quando não nulo e `deleted_at is null`; nomes
  não são chave natural. `active`, `created_at`, `updated_at` e `row_version` também são `not null`;
- `ltc_m.projects`: PK `id`; chave natural ativa única por `upper(project_code)` quando
  `deleted_at is null`; FK obrigatória `client_id -> clients.id`; FK obrigatória
  `base_currency -> currencies.code`; `project_code`, `project_name`, `classification`, `status`,
  `contract_value`, `data_reference_date`, `version`, `created_at` e `updated_at` são obrigatórios;
- constraints relevantes: nomes/códigos não vazios, código de projeto já trimado, valores não
  negativos, `end_date >= start_date`, `version > 0`, `row_version > 0` e unicidade
  `(projects.id, projects.base_currency)` para manter uma moeda por projeto nas FKs compostas;
- moeda: `currencies.code` é PK ISO maiúscula de três letras; o dry-run usa somente o `BRL`
  explícito da fonte, sem conversão;
- soft delete: `clients.deleted_at` e `projects.deleted_at`; cliente também possui `active`;
- campos protegidos: `created_at`, `updated_at`, `created_by_user_id`, `updated_by_user_id`,
  `row_version`/`version` são mantidos pelos triggers; ciclo de vida exige admin ativo e
  justificativa; delete físico é bloqueado;
- estados de projeto: `draft`, `active`, `on_hold`, `completed`, `cancelled`; classificações:
  `full_contract`, `demand`, `opening_balance`; workflow de plano: `draft`, `pending_approval`,
  `approved`, `locked`, `archived`;
- triggers em clientes/projetos: `trg_10_*_metadata`, `trg_05_*_inactivation`,
  `trg_00_*_no_delete` e `trg_90_*_audit`;
- RLS: habilitada e forçada. Viewer lê ativos; editor lê e grava somente ativos; admin alcança
  todos conforme policies separadas de SELECT/INSERT/UPDATE. Não existe policy DELETE;
- grants: `ltc_m_runtime` tem `USAGE` no schema e SELECT/INSERT/UPDATE nas duas tabelas, sempre
  sujeito a RLS; PUBLIC não tem privilégio; runtime não tem acesso direto a `audit_log`;
- funções permitidas ao runtime: `set_actor_context`, `authorization_context`, funções de
  workflow de planos, `read_audit_log` e `current_actor_id(boolean)`. Não existe RPC de upsert de
  cliente ou projeto.

Não foi encontrada divergência entre as migrations e a documentação P011.

## Contrato de entrada

- contrato: `ltcm.p010.extraction-manifest.v1`, payload P009/P010 schema v1;
- normalizador: `1.0.0`;
- diretórios: `.artifacts/p010-real-run-a` e `.artifacts/p010-real-run-b`;
- manifesto P010:
  `1cfc6b56b6aebc7502d0b26e17c2843cf061a1b606ee0820be1cd87b232376f2`;
- workbook:
  `f805ea07155ec647eab8d7c0cb9e88bad578ceaa8674d48c5c219129023f9abf`;
- input canônico P011:
  `6b9a9204bc9f99498634d5bb7c07e776e9f7ba9a79d3db20f3169ce92a79bcd9`;
- linhas: 10 `project_values`, 52 `monthly_revenue`, 16 `curve_s`;
- fonte: zero erro estrutural e um warning aprovado,
  `RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE`.

Arquivos efetivamente consumidos:

| Arquivo                        |   Bytes | SHA-256                                                            |
| ------------------------------ | ------: | ------------------------------------------------------------------ |
| `manifest.json`                |   2.494 | `1cfc6b56b6aebc7502d0b26e17c2843cf061a1b606ee0820be1cd87b232376f2` |
| `profile-report.json`          |  14.830 | `260eb8ff420f45fb99fea14f4eb9b72c731c1157c33044864d79057cce41d128` |
| `validation-report.json`       |     787 | `4fb3c20b04ad36a21008555574d4d9aa40e0f6b728023275f28ee2e625249b1d` |
| `sheets/project_values.jsonl`  |  34.997 | `e765c563d45c1f62fec99c10d1146dc2ff22493e673c90ca034dc077c4f26a6f` |
| `sheets/monthly_revenue.jsonl` | 297.989 | `ab402d1bda308daa7500d01512f28497a40e89b66f021fb9024d1e9f712bb108` |
| `sheets/curve_s.jsonl`         |  53.824 | `ac225a0298010c0248a56591710e7c26ac683adbc074fada1abc7b3026d6869b` |

P011 não abriu nem leu diretamente o XLSX; seu workspace não possui dependência XLSX, de rede ou
de banco.

## Arquitetura e CLI

- `types.ts`: contratos tipados e constantes;
- `canonical-json.ts`: JSON canônico e SHA-256;
- `source-reader.ts`: validação P009/P010, hashes, arquivos regulares, symlinks, traversal e limites;
- `normalizer.ts`: candidatos, regras D02–D06/D08, diagnósticos e plano;
- `artifact-writer.ts`: artefatos determinísticos e troca atômica de diretório gerenciado;
- `persistence.ts`: porta abstrata serializável, sem driver/SQL;
- `cli.ts`: orquestração local;
- `normalizer.test.ts`: cobertura sintética.

CLI: `npm run ltcm:normalize-projects --`, com `--input-dir`, `--output-dir`, `--strict`,
`--existing-snapshot`, `--generated-at`, `--help` e `--apply`. O timestamp padrão determinístico é
`1970-01-01T00:00:00.000Z`.

Entrada JSON/JSONL é não confiável: limite de 5 MiB por arquivo, 100.000 linhas JSONL,
profundidade 32 e texto 32.767 caracteres; arquivos não regulares, symlinks e traversal são
rejeitados. Saída deve ser subdiretório de `.artifacts`, não pode ficar dentro da entrada e só
substitui diretório marcado `.ltcm-p011-artifacts`. A escrita usa temporário, backup e `rename`.

O snapshot `ltcm.p011.existing-snapshot.v1` é opcional e sintético. A execução real omitiu o
snapshot e, portanto, simulou destino vazio com catálogo BRL controlado. A porta
`LtcmPersistencePort` exige transação serializável, clientes antes de projetos, resultado por
registro, zero delete e zero bypass RLS; não está conectada a banco.

`--apply` existe exclusivamente como bloqueio: o parser lança exatamente
`REMOTE_APPLY_NOT_AUTHORIZED`, comportamento coberto por teste aprovado.

## Candidatos e divergências

- clientes candidatos/únicos por chave estrita: 7;
- clientes válidos: 2, ambos `insert` simulado contra destino vazio;
- clientes ambíguos: 5, todos `conflict`/revisão;
- clientes rejeitados: 0;
- projetos candidatos e códigos únicos: 9;
- projetos: 0 insert, 0 no-op, 6 rejected e 3 pending decision;
- plano: 16 operações, sendo 2 planejadas, 8 `requires_review` e 6 bloqueadas;
- warnings: 23; errors de candidato: 6; divergências totais: 29.

Distribuição: 5 `CLIENT_MATCH_AMBIGUOUS`, 9 `PROJECT_CLASSIFICATION_PENDING`, 8
`PROJECT_VALUE_SEMANTICS_PENDING`, 1 `RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE` e 6
`PROJECT_CLIENT_UNRESOLVED`.

As ações são simulações contra destino vazio; inserts/no-ops/conflicts reais permanecem
desconhecidos sem snapshot do banco real.

## Nove projetos

Todos foram encontrados; o código canônico recebeu somente trim e nenhum código foi alterado.

| Código          | Ação simulada    | Status    | Diagnósticos                                                                                                                                                                          | Decisão pendente                     | Hash sanitizado                                                    |
| --------------- | ---------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| `2024-10-12524` | pending_decision | pendente  | `PROJECT_CLASSIFICATION_PENDING`, `PROJECT_DATA_REFERENCE_DATE_MISSING`, `PROJECT_VALUE_SEMANTICS_PENDING`                                                                            | classificação, data e valor          | `20fe89b6c0b9654e3c3eb0d47761eeeedc7979b22461e9cfaac1d8ccba92ec6b` |
| `2025-07-14416` | pending_decision | pendente  | `PROJECT_CLASSIFICATION_PENDING`, `PROJECT_DATA_REFERENCE_DATE_MISSING`, `PROJECT_VALUE_SEMANTICS_PENDING`                                                                            | classificação, data e valor          | `d701bf94473f4c30e2ac5e1de7e3ee1bfd971e1fb616809c4564cf5568f40916` |
| `2024-02-10990` | rejected         | completed | `PROJECT_CLASSIFICATION_PENDING`, `PROJECT_CLIENT_UNRESOLVED`, `PROJECT_DATA_REFERENCE_DATE_MISSING`, `PROJECT_VALUE_SEMANTICS_PENDING`, `RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE` | cliente, classificação, data e valor | `13204895683b1e4c6c881e16a57ef5185965178352b944ee1b766a61521ee6c9` |
| `2026-01-15797` | rejected         | pendente  | `PROJECT_CLASSIFICATION_PENDING`, `PROJECT_CLIENT_UNRESOLVED`, `PROJECT_DATA_REFERENCE_DATE_MISSING`, `PROJECT_VALUE_SEMANTICS_PENDING`                                               | cliente, classificação, data e valor | `dddc60dc66786153456778efe5d751d3ef6333a0315332a29188eba85b23e5fc` |
| `2025-12-15568` | rejected         | pendente  | `PROJECT_CLASSIFICATION_PENDING`, `PROJECT_CLIENT_UNRESOLVED`, `PROJECT_DATA_REFERENCE_DATE_MISSING`, `PROJECT_VALUE_SEMANTICS_PENDING`                                               | cliente, classificação, data e valor | `c8305cded2c61b468f04aca343e82216f2d92052469a9e15a8d49a6ae4c88681` |
| `2024-06-11837` | rejected         | pendente  | `PROJECT_CLASSIFICATION_PENDING`, `PROJECT_CLIENT_UNRESOLVED`, `PROJECT_DATA_REFERENCE_DATE_MISSING`, `PROJECT_VALUE_SEMANTICS_PENDING`                                               | cliente, classificação, data e valor | `1ec09439451c51c23a08f7edfdc38630deec97e4d6dc11940ea6ea107df28a7a` |
| `2025-08-14656` | pending_decision | pendente  | `PROJECT_CLASSIFICATION_PENDING`, `PROJECT_DATA_REFERENCE_DATE_MISSING`, `PROJECT_VALUE_SEMANTICS_PENDING`                                                                            | classificação, data e valor          | `0d0e6b54e2072ac88b051aec191c63c7b37fcf64047a060ff233ab99f6138e7e` |
| `2026-03-16231` | rejected         | pendente  | `PROJECT_CLASSIFICATION_PENDING`, `PROJECT_CLIENT_UNRESOLVED`, `PROJECT_DATA_REFERENCE_DATE_MISSING`, `PROJECT_VALUE_SEMANTICS_PENDING`                                               | cliente, classificação, data e valor | `2fdb22e2a3bc36cb34236575789dd217724688e861b67a5135aeedce7cc77146` |
| `2026-04-16531` | rejected         | pendente  | `PROJECT_CLASSIFICATION_PENDING`, `PROJECT_CLIENT_UNRESOLVED`, `PROJECT_DATA_REFERENCE_DATE_MISSING`                                                                                  | cliente, classificação e data        | `82ee38aaf8cc73aa769b658e42d28578e79a17ab1a6b83ae98d3d897aa9c949c` |

Há zero duplicidade no plano. O raw de `2024-06-11837` preserva o espaço inicial. D03 mantém
`2024-10-12524` e `2025-07-14416` distintos.

## Decisões funcionais

- D02: `2026-04-16531 = 164000`; valor aceito sem diagnóstico. O teste negativo gera
  `PROJECT_VALUE_CONFLICT` para `168000`;
- D03: os dois projetos permanecem distintos; não há diagnóstico porque a regra passou;
- D04: `2024-02-10990` está `completed`; `369749.1735` aparece somente como evidência de previsão
  de recebimento, com `RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE`, nunca como contrato;
- D05: valor de venda não inferido; `PROJECT_VALUE_SEMANTICS_PENDING` em oito projetos;
- D06: contrato/demanda/saldo não inferidos; `PROJECT_CLASSIFICATION_PENDING` nos nove projetos;
- D08: uma moeda explícita por projeto, sem conversão; fonte real válida não gerou diagnóstico.
  Casos inválidos usam `PROJECT_CURRENCY_MISSING` ou `PROJECT_CURRENCY_AMBIGUOUS`.

## Fronteira P011/P012

Os candidatos e o plano contêm zero item, `source_line_key`, quantidade, unidade, preço unitário,
competência, linha de Curva S, evento financeiro, planejamento, faturamento realizado ou
recebimento importado. As 48 linhas de itens P010 permanecem destinadas à P012.

## Artefatos A/B

Cada execução produziu os mesmos 11 arquivos:

| Artefato                    |   Bytes | Registros | SHA-256                                                            | Função                           |
| --------------------------- | ------: | --------: | ------------------------------------------------------------------ | -------------------------------- |
| `.ltcm-p011-artifacts`      |      23 |         1 | `8c2bd75fefd3c9b70ec4f9a88af34245def4b213b47f24afc8a51cf3bd4a8c6c` | marcador de diretório gerenciado |
| `clients-candidates.jsonl`  |  18.044 |         7 | `297a8eb848d5b112c7349d677455b3565ec938ea3f6afc793e5ec5f13b086d8e` | candidatos de clientes           |
| `projects-candidates.jsonl` |  57.562 |         9 | `2414d86661e03b1498e805793fa4d1722d7dddce0f43013c04357398e4d56edc` | candidatos de projetos           |
| `mapping-evidence.jsonl`    | 120.651 |       166 | `4dfd68dbd919cebd98cca35b28399f43c88e036d137987d5e46e0f6d23db83bb` | evidências de mapeamento         |
| `divergences.jsonl`         |  17.675 |        29 | `10bd4e76ab6c95149e510f0645bd4549437541a2727b9907c31de687e0b51811` | diagnósticos/divergências        |
| `import-plan.json`          |  21.950 |        16 | `24100f355cd4eb6b896bd66d386bb9542cd127f39a498338d5176ffdef155b44` | plano e dependências             |
| `source-validation.json`    |     701 |         1 | `09b8c76e4271448e2d3def968b321152bd53ad319e7a6ff2db277ef74c2ba43f` | validação da fonte               |
| `validation-summary.json`   |     620 |         1 | `d520e5e282be1fec2968473e46126a3b4d96c320c2e16c20a2555629b15b454e` | resumo de contagens              |
| `hashes.json`               |     848 |         1 | `d8f7a5e920ddf3982aa6af5efb58ea48d02244234b816489e244d055d0b4dee6` | catálogo SHA-256                 |
| `manifest.json`             |   2.803 |         1 | `330bbfba21dfed0466e6a98a6486a7de503b19902bbcbbda98cd2d44144e747d` | envelope do dry-run              |
| `report.md`                 |   1.074 |         1 | `3559b365dff1076a81ed46c2d6eaa844dea334e68edf6662060910b1297be745` | relatório sanitizado             |

Execução A:

```powershell
npm run ltcm:normalize-projects -- --input-dir ".artifacts\p010-real-run-a" --output-dir ".artifacts\p011-real-run-a" --strict
```

Execução B:

```powershell
npm run ltcm:normalize-projects -- --input-dir ".artifacts\p010-real-run-b" --output-dir ".artifacts\p011-real-run-b" --strict
```

Ambas retornaram código 0, 7 clientes, 9 projetos, 23 warnings e 6 errors de candidato. Manifesto:
`330bbfba21dfed0466e6a98a6486a7de503b19902bbcbbda98cd2d44144e747d`; plano:
`24100f355cd4eb6b896bd66d386bb9542cd127f39a498338d5176ffdef155b44`.

O hash consolidado das 11 linhas ordenadas `<nome>:<tamanho>:<sha256>\n` é
`aeaebed4579a7946eb3fc97121694892bde909f6bb3bbf099c4e4ab6e17df61c` em A e B. Nomes,
tamanhos, hashes, bytes, candidatos, divergências, ações e classificações são equivalentes;
determinismo comprovado.

## Testes e gates

Um arquivo de teste possui 10 testes de topo e 4 subtestes, total 14, todos aprovados:

| Requisito             | Teste resumido                                                                         | Resultado            |
| --------------------- | -------------------------------------------------------------------------------------- | -------------------- |
| nomes/clientes        | NFC, trim, whitespace, caixa, acento, pontuação, sufixos e chave estrita               | passou               |
| fonte e decisões      | nove projetos, D02/D03/D04, D05/D06, moeda e fronteira P012                            | passou               |
| determinismo          | objetos/hashes repetidos                                                               | passou               |
| rejeições dependentes | 168000, moeda ausente e cliente ausente                                                | passou               |
| snapshot/conflitos    | cliente existente, projeto idêntico, conflito e registro protegido                     | passou               |
| contrato              | hash, P009/P010 v1, JSONL corrompido e abas                                            | 4 subtestes passaram |
| CLI                   | `--apply` bloqueado, ajuda e timestamp                                                 | passou               |
| caminhos              | traversal e saída fora de `.artifacts`                                                 | passou               |
| persistência          | serializable, cliente antes de projeto, resultado por registro, zero delete/RLS bypass | passou               |
| writer                | A/B byte a byte e diretório não gerenciado                                             | passou               |

Gates finais já executados, sem repetição do audit: `format`, `format:check`, `lint`, `typecheck`,
`test`, `build`, `env:check`, `migrations:check`, `seeds:check`, `integrity:check`,
`test:integrity` e `check`, todos aprovados. Os scanners P007/P008/P009 passaram; P010 não possui
script `p010:check`, e sua suíte `test:p010` passou com 11 testes. P011 passou com 14 testes.

O único `npm audit --omit=dev`, após registry confirmado como `https://registry.npmjs.org/`,
retornou código 0 e `found 0 vulnerabilities`. O estado Git posterior permaneceu idêntico ao
anterior: zero mutation causada pelo audit e zero migration. A D35 foi consumida e não deve ser
reutilizada.

## Preparação futura da D34

- alvo pretendido, ainda não acessado: desenvolvimento temporário compartilhado `Funcionarios`,
  região `us-east-1`, exclusivamente schema `ltc_m`;
- papel previsto: `ltc_m_runtime`, com contexto transacional P007/P008; não há RPC de upsert de
  cliente/projeto, portanto qualquer adaptador futuro deverá usar DML tipado sujeito a RLS;
- plano local: 16 registros, mas somente 2 inserts simulados de clientes estão planejáveis; 5
  clientes têm conflito, 6 projetos estão rejected e 3 pending decision. Nenhum projeto está
  pronto para aplicação;
- dependência: cliente resolvido e persistido antes de cada projeto;
- atomicidade: uma transação serializável, abortando integralmente em conflito; sem delete e sem
  bypass RLS;
- rollback lógico: abortar transação antes de commit e reconciliar por hashes/IDs; qualquer plano
  de compensação posterior exigirá decisão própria;
- auditoria: `set_actor_context` e triggers `trg_90_*_audit`, preservando request ID;
- reconciliação: snapshot prévio do destino, IDs resolvidos, resultado por registro e comparação
  pós-operação;
- risco crítico: sem backup recuperável, a aplicação não deve ocorrer; eventual exceção precisa
  ser formal, explícita e específica.

Sem snapshot do banco real, inserts, no-ops e conflicts reais não podem ser conhecidos. Nenhum
Supabase, rede, SQL, DDL, migration, `db push`, harness, importação, commit, merge ou push foi
executado nesta consolidação.
