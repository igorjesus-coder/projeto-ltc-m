# P010-VAL — relatório sanitizado de validação real

Status: **Concluída** em 03/08/2026. Este documento não contém caminho absoluto, workbook,
payload empresarial completo ou valores financeiros além das amostras mínimas aprovadas.

## Origem e execuções

- caminho sanitizado: `<external>/Previsão_de_Receita_-_LTC-M_com_Curva_S_atualizada.xlsx`;
- tamanho: 24.522 bytes;
- SHA-256 dos bytes: `f805ea07155ec647eab8d7c0cb9e88bad578ceaa8674d48c5c219129023f9abf`;
- sistema de datas: `1900`;
- execuções A/B: código 0, `passed_with_warnings`, 1 warning aprovado e 0 erros;
- saídas locais: `.artifacts/p010-real-run-a` e `.artifacts/p010-real-run-b`, ignoradas pelo Git.

## Abas, faixas e fórmulas

Ordem física: `Valores Projetos LTC-M`, `Prev. Receita Mensal`, `Curva S`,
`Decisões Aprovadas`.

| Chave/classificação | Faixa serializada | Faixa física OOXML | Linhas | Fórmulas serializadas | Definições independentes |
| ------------------- | ----------------- | ------------------ | -----: | --------------------: | -----------------------: |
| `project_values`    | `A1:K10`          | `A1:K17`           |     10 |                    16 |                       10 |
| `monthly_revenue`   | `A1:T52`          | `A1:T61`           |     52 |                   158 |                       24 |
| `curve_s`           | `A1:L16`          | `B2:L16`           |     16 |                    52 |                       30 |
| `documentary`       | nenhuma           | `A1:F11`           |      0 |                     0 |                        0 |

As diferenças entre faixa física e serializada decorrem de células formatadas/stubs no OOXML e
de vazios iniciais. Elas são registradas, não alteradas. Fórmulas compartilhadas são preservadas
por célula; a contagem 10/24/30 representa definições independentes no pacote OOXML. `B3`, `J52`,
`T52`, `L8` e `L9` preservaram fórmula e cache.

A aba documental foi classificada com razão `not_imported_by_p010`: zero
`import_batch_sheet`, zero staging e nenhum conteúdo em payload.

## Perfil validado

Projetos detectados (9):

- `2024-10-12524`;
- `2025-07-14416`;
- `2024-02-10990`;
- `2026-01-15797`;
- `2025-12-15568`;
- `2024-06-11837`;
- `2025-08-14656`;
- `2026-03-16231`;
- `2026-04-16531`.

O texto bruto com espaço inicial de `2024-06-11837` foi preservado. Foram mantidos 48 itens nas
linhas 4–51, nove grupos de códigos repetidos e a linha 48 com código/descrição vazios.

Competências detectadas, em ordem e sem duplicidade: `2026-07-01`, `2026-08-01`, `2026-09-01`,
`2026-10-01`, `2026-11-01`, `2026-12-01`, `2027-01-01`, `2027-02-01`, `2027-03-01`. Os seriais
Excel 46204, 46235, 46266, 46296, 46327, 46357, 46388, 46419 e 46447 permanecem nos payloads.

## Precisão, estados e warning

Evidências mínimas:

- `monthly_revenue!J45`: `369749.1735`, round-trip `369749.1735`, fórmula e cache presentes;
- `monthly_revenue!J51`: `164000`, round-trip `164000`, fórmula e cache presentes;
- `monthly_revenue!O12`: `866.5999999999999`, sem arredondamento do valor bruto;
- `monthly_revenue!R52`: zero numérico, distinto de nulo;
- `monthly_revenue!K3`: serial 46204, ISO civil `2026-07-01` e formato `mmm-yy`;
- `project_values!D2`: texto com espaço inicial preservado;
- `curve_s!A1`: célula ausente, valor `null`;
- stubs reais: 48 em `project_values`, 350 em `monthly_revenue`, 36 em `curve_s`;
- células mescladas: 14 em `monthly_revenue` e 20 em `curve_s`;
- string vazia explícita: coberta pela fixture sintética; não observada no workbook real.

Warning único:

- código: `RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE`;
- severidade: `warning`;
- origem: `Prev. Receita Mensal!A45:T45` (`J45`);
- projeto: `2024-02-10990`;
- tratamento futuro: P011/P012;
- efeito: nenhum valor, total ou Curva S foi alterado; strict permaneceu com código 0.

## Consistências de cache

Todas usam tolerância zero e representação JSON canônica.

| Comparação                              | Status | SHA-256 canônico A/B                                               |
| --------------------------------------- | ------ | ------------------------------------------------------------------ |
| `K3:S3` mensal × `C7:K7` Curva S        | pass   | `ede4fafe35718f4d9e6b5efb7d3912bb7bbf6a3240d137364183757c65ff46e8` |
| `K52:S52` mensal × `C8:K8` Curva S      | pass   | `445c3b318f96db8bfd39a597bd5f6c060d8b3b62adb654490707458f5e27397b` |
| `T52` mensal × `L8` Curva S             | pass   | `952eb980c1f651f532830a9eacb528fb1b178a71818bd99d9f019f71897ef7ee` |
| `K9` acumulado × `L8` previsto          | pass   | `952eb980c1f651f532830a9eacb528fb1b178a71818bd99d9f019f71897ef7ee` |
| projeto `2026-04-16531` resumo × mensal | pass   | `b382fb10414bee85bd438faa0e51a2d2465000e1d8325ab93f71174a7f96ce6a` |
| conjuntos de projetos resumo × mensal   | pass   | `273f2b5692f31a931e2b06f71a4126b8feedc6ffe11b17c0221e3d0ae15dc895` |

## Determinismo

As execuções A e B produziram os mesmos oito arquivos, com tamanhos, SHA-256 e bytes idênticos.

| Artefato                       |   Bytes | SHA-256                                                            |
| ------------------------------ | ------: | ------------------------------------------------------------------ |
| `.ltcm-p010-artifacts`         |      23 | `d49c449360ada1d8d05442bb4004f15e6bb6c6ae47c58ae4b15bca1b4dc533f0` |
| `errors.json`                  |     587 | `ab00a875e5a4d0f52bbcd6c1b6b9c54e66f17b59c1e942412eed1d0fa797dff1` |
| `manifest.json`                |   2.494 | `1cfc6b56b6aebc7502d0b26e17c2843cf061a1b606ee0820be1cd87b232376f2` |
| `profile-report.json`          |  14.830 | `260eb8ff420f45fb99fea14f4eb9b72c731c1157c33044864d79057cce41d128` |
| `sheets/curve_s.jsonl`         |  53.824 | `ac225a0298010c0248a56591710e7c26ac683adbc074fada1abc7b3026d6869b` |
| `sheets/monthly_revenue.jsonl` | 297.989 | `ab402d1bda308daa7500d01512f28497a40e89b66f021fb9024d1e9f712bb108` |
| `sheets/project_values.jsonl`  |  34.997 | `e765c563d45c1f62fec99c10d1146dc2ff22493e673c90ca034dc077c4f26a6f` |
| `validation-report.json`       |     787 | `4fb3c20b04ad36a21008555574d4d9aa40e0f6b728023275f28ee2e625249b1d` |

Hashes de conteúdo das abas: `project_values`
`a3dce5cb203bc2c792550426b5cb991f32ad901c01e6666123e63f759b4defcc`,
`monthly_revenue` `cc426e918aa3dc7837b19b656a72e3c99e8f5e61dbee505549612c566d45b4b8` e
`curve_s` `b86919e710271840e35185bcad1f2df1746b2356665c8ede1a5bde3d1fa76c09`.

## Gates e segurança

Passaram: `format`, `format:check`, `lint`, `typecheck`, `npm test`, `build`, `env:check`,
`migrations:check`, `seeds:check`, `integrity:check`, `test:integrity`, scanners P007/P008/P009,
11 testes P010 e `npm run check`. `npm audit --omit=dev` retornou zero vulnerabilidades.

Não houve execução de harness remoto, Supabase, SQL, DDL, migration, carga, commit, merge ou push.
O único acesso de rede foi a consulta ao registro npm exigida por `npm audit`; o extrator não
possui chamada de rede. O hash da migration P009 permaneceu
`C0CDBC2F020A9D727D0E353A31EA7E91DF715E5B96BEB343E79407DECD940A22`.

## Fronteira e riscos remanescentes

P010 somente extrai, valida e serializa. Normalização, deduplicação semântica, chave definitiva,
regras financeiras e carga pertencem a P011/P012. O relatório de perfil depende da estrutura OOXML
e da versão SheetJS fixada; mudança real de layout deve falhar/avisar e exigir revisão, nunca ser
corrigida silenciosamente. Os payloads completos permanecem apenas em `.artifacts/` local.
