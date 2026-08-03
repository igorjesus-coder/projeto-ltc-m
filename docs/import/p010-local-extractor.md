# P010 — extrator local determinístico da planilha LTC-M

## Escopo

O P010 recebe um arquivo `.xlsx`, valida o perfil estrutural e serializa somente:

| `sheet_key`       | nome exato da aba        |
| ----------------- | ------------------------ |
| `project_values`  | `Valores Projetos LTC-M` |
| `monthly_revenue` | `Prev. Receita Mensal`   |
| `curve_s`         | `Curva S`                |

`Decisões Aprovadas` é documental. Seu nome aparece entre as abas ignoradas, mas suas células não
são lidas nem emitidas. Outras abas também são ignoradas e geram aviso, ou erro no modo estrito.

O extrator não contém conexão de banco, credencial, SQL, DDL, migration, seed ou chamada de rede.
Também não normaliza texto ou códigos, não deduplica, não calcula chave definitiva, não converte
datas, não arredonda valores e não corrige o arquivo de origem.

## Comando e códigos de saída

```powershell
npm run ltcm:extract -- --input "C:\caminho\arquivo.xlsx" --output-dir ".artifacts\p010" --strict
```

`--input=<caminho>` e `--output-dir=<diretório>` são formas equivalentes e evitam a reinterpretação
de aspas do `npm.cmd` em caminhos Windows com espaços. O parser também recompõe os fragmentos que
algumas versões do `cmd.exe` entregam separadamente.

- `0`: validação aprovada, com ou sem avisos;
- `1`: artefatos e relatório gerados, mas há erro estrutural/de validação;
- `2`: argumento, leitura, parsing ou escrita inviabilizou a execução.

Sem `--strict`, aba ausente, aba oculta, aba inesperada, fórmula sem resultado em cache e fórmula
com referência externa são avisos. Com `--strict`, são erros. Em ambos os casos, as abas presentes
continuam sendo extraídas. Essa combinação preserva o lifecycle e a rejeição parcial do P009: um
lote pode registrar falhas sem perder as linhas cuja origem foi preservada.

## Artefatos

O diretório de saída é substituído de forma atômica e contém:

```text
.ltcm-p010-artifacts
manifest.json
validation-report.json
profile-report.json
errors.json
sheets/
  project_values.jsonl
  monthly_revenue.jsonl
  curve_s.jsonl
```

Um JSONL só existe quando a aba correspondente foi encontrada e lida. `manifest.json` registra o
SHA-256 dos bytes exatos do XLSX, tamanho, nome base, sistema de datas, ordem das abas, contagens,
hashes das abas e resultado da validação. Caminho absoluto, timestamp, PID e identificadores
aleatórios não entram em nenhum artefato. `errors.json` não replica valores das células.

O diretório pode conter dados financeiros brutos e está coberto por `.gitignore`. Para não apagar
conteúdo alheio, o extrator recusa um destino existente sem o marcador exato
`.ltcm-p010-artifacts`.

`profile-report.json` é sanitizado e determinístico. Quando os marcadores estruturais LTC-M são
detectados, ele valida as faixas operacionais, projetos, itens, competências, definições de
fórmulas compartilhadas, caches e consistências entre abas. A aba documental é inspecionada
somente no nível de metadados OOXML (nome, ordem e coordenadas), classificada como `documentary`
com razão `not_imported_by_p010` e nunca recebe JSONL ou linha de staging.

## Contrato JSON v1

Cada linha do JSONL é um candidato direto a `import_staging_rows`:

```json
{
  "payload_schema_version": 1,
  "raw_payload": {
    "schema_version": 1,
    "sheet_key": "monthly_revenue",
    "sheet_name": "Prev. Receita Mensal",
    "row_number": 4,
    "source_range": "A4:T4",
    "cells": []
  },
  "row_hash": "<sha256>",
  "row_kind": "unknown",
  "source_range": "A4:T4",
  "source_row_number": 4,
  "status": "pending",
  "validation_attempt": 0
}
```

`raw_payload` segue o contrato canônico versionado em
[`p009-staging-contract.md`](../database/p009-staging-contract.md). As propriedades obrigatórias de
cada célula são `column_index`, `column_letter`, `address`, `value`, `formula`, `data_type` e
`number_format`. Extensões compatíveis distinguem:

- célula ausente, célula em branco, string vazia, valor, fórmula e célula subordinada a mesclagem;
- presença do resultado em cache da fórmula, sem recalcular o workbook;
- faixa e indicador de fórmula matricial/dinâmica quando presentes;
- origem da mesclagem e texto exibido de erro quando presentes.

Para valores numéricos, as extensões `round_trip_text` e `formatted_text` preservam,
respectivamente, a representação decimal reversível do `number` e o texto exibido pelo formato.
`record_present`, `value_present` e `stub` tornam explícita a distinção entre ausência, registro
OOXML em branco e valor nulo. Datas mantêm o serial em `value` e acrescentam `date_iso` somente
como visão civil de validação, sem substituir a origem.

Datas permanecem como o número serial armazenado no XLSX, acompanhadas do formato numérico e do
sistema `1900` ou `1904` no manifesto. A faixa `!ref` detectada define as colunas e linhas
serializadas; todas as células dentro dela aparecem, inclusive ausentes e linhas inteiramente em
branco. O P010 usa apenas `unknown` e `blank` em `row_kind`, pois classificação de negócio é etapa
posterior.

## Determinismo e hashes

- arquivo: SHA-256 dos bytes exatos;
- linha: SHA-256 UTF-8 do JSON canônico de `raw_payload`;
- aba: SHA-256 UTF-8 do array canônico, ordenado por linha, de `raw_payload`;
- objetos JSON: chaves em ordem lexicográfica recursiva, sem espaços; arrays preservam a ordem;
- células: ordem crescente de coluna; linhas: ordem física crescente.

Reexecutar a mesma entrada, com as mesmas opções, produz os mesmos bytes. O nome base do arquivo é
mantido como origem humana, mas caminho local, horário e identificador de lote ficam fora dos
hashes e dos artefatos.

## Limites estruturais e segurança

O workbook pode ter no máximo 100 MiB e cada aba pode abranger no máximo 2.000.000 de células na
faixa detectada. Texto de célula acima do limite XLSX de 32.767 caracteres é rejeitado sem
truncamento. As limitações impedem uma
expansão acidental ou abusiva de memória sem truncar silenciosamente: excedê-la é erro. Valores não
representáveis em JSON também são erros de célula e ficam diagnosticados.

A leitura usa SheetJS CE 0.20.3 obtido do tarball oficial e fixa a resolução no lockfile. As opções
mantêm fórmulas, formatos, estilos necessários, stubs e resultados em cache e desativam a
conversão automática de datas. A auditoria de dependências de runtime (`npm audit --omit=dev`)
estava sem vulnerabilidades conhecidas na implementação; o aviso de desenvolvimento existente é
transitivo do toolchain e não faz parte da execução do extrator.

O resultado do workbook real, hashes A/B e consistências está em
[`p010-validation-report.md`](p010-validation-report.md). A matriz requisito→teste está em
[`p010-test-coverage.md`](p010-test-coverage.md).
