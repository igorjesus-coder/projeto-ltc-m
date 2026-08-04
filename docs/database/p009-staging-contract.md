# P009 / 1.09 — contrato de staging de importaÃ§Ã£o

P009 prepara somente o banco e o contrato consumido pelo P010. O P009 nÃ£o abre, interpreta ou
importa o XLSX real; o arquivo nÃ£o Ã© versionado e nenhum dado real Ã© inserido.

D32 foi decidida e aprovada pelo responsável do projeto em 03/08/2026. O contrato do harness é
`audit_log.request_id = request_id` do contexto transacional ativo no instante do DML. Requests
de entidade não substituem o contexto; cada cenário usa um identificador determinístico derivado
do run ID. O trigger, o schema e a migration permanecem inalterados.

A invocação D32 `r20260803151221-2d4f91ba` foi consumida. As assertions SQL P009 concluíram sem
exception, inclusive request, auditoria e RLS, mas o orquestrador não recebeu o result set
intermediário que esperava e terminou com código 1. O estado remoto ficou limpo e sem delta;
nenhuma repetição está autorizada.

## Estado de aplicação

D29 foi decidida em 31/07/2026 e a migration foi aplicada remotamente uma única vez. A menção
`Pendente` preservada no limite histórico ao fim descreve o estado pré-aplicação. A revalidação
funcional P009 de 03/08/2026 ficou incompleta por falha do renderizador do harness, com limpeza,
D26 e fingerprints confirmados. A D30, decidida e aprovada pelo responsável do projeto em
03/08/2026, autoriza exatamente uma reexecução remota do harness corrigido, sem repetição
automática.

A execução única D30 `r20260803132652-ada2b257` confirmou o preflight, P007/P008 e a limpeza, mas
a suíte P009 parou antes dos cenários por aridade divergente no INSERT de usuários sintéticos.
Essa fixture agora declara `active` explicitamente. A D31, decidida em 03/08/2026, condiciona uma
única validação adicional ao gate integral do SQL renderizado e a uma Fase A totalmente revertida.
D31 não autoriza repetição automática nem segunda invocação.
A invocação D31 aprovou o bootstrap da Fase A e falhou na assertion que comparava o request do
contexto de auditoria com o campo request da aba. A matriz RLS específica P009 não foi alcançada;
cleanup, D26, P007/P008 e fingerprints passaram com `rollback_clean=true`.

## Fontes operacionais

| `sheet_key`       | Nome original            | Faixa observada (fixture) |
| ----------------- | ------------------------ | ------------------------- |
| `project_values`  | `Valores Projetos LTC-M` | `A1:K10`                  |
| `monthly_revenue` | `Prev. Receita Mensal`   | `A1:T52`                  |
| `curve_s`         | `Curva S`                | `A1:L16`                  |

`DecisÃµes Aprovadas` Ã© documental e Ã© rejeitada por constraint quando usada como aba
operacional. Quantidade de linhas/colunas e competÃªncias nÃ£o sÃ£o limites fÃ­sicos.

## Estrutura

- `import_batches`: uma tentativa por arquivo, com hash, tamanho, MIME, contrato, idempotÃªncia,
  request, ator, lifecycle, contadores e metadata sanitizada;
- `import_batch_sheets`: abas detectadas, uma chave e um nome por lote;
- `import_staging_rows`: linhas fÃ­sicas genÃ©ricas, preservando coordenada, faixa, payload e hash;
- `import_row_errors`: erros append-only, com vÃ­nculo opcional Ã  aba e Ã  linha e mÃºltiplos erros.

`source_hash` deixou de ser globalmente Ãºnico: a mesma origem pode gerar novas tentativas. A
`idempotency_key`, quando presente, Ã© Ãºnica.

## Payload JSON v1

O P010 produzirÃ¡ `payload_schema_version = 1`:

```json
{
  "schema_version": 1,
  "sheet_key": "monthly_revenue",
  "sheet_name": "Prev. Receita Mensal",
  "row_number": 4,
  "source_range": "A4:T4",
  "cells": [
    {
      "column_index": 1,
      "column_letter": "A",
      "address": "A4",
      "value": 1,
      "formula": null,
      "data_type": "number",
      "number_format": "0"
    }
  ]
}
```

As cÃ©lulas sÃ£o ordenadas por coluna; `null` e string vazia sÃ£o distintos; valor e fÃ³rmula sÃ£o
preservados separadamente; datas Excel nÃ£o sÃ£o convertidas silenciosamente; a linha inteira,
inclusive vazios dentro da faixa, Ã© representada. O banco valida apenas objeto JSON e versÃ£o.

## Estados e rejeiÃ§Ã£o parcial

Lote: `received → validating → loaded` ou `rejected`. Aba: `detected → staging → completed` ou
`rejected`. Linha: `pending → valid|rejected → processed`. Uma linha rejeitada pode ter qualquer
quantidade de registros em `import_row_errors` (`warning` ou `error`) sem impedir outras linhas.
Payload, hash, origem e coordenada staged sÃ£o imutÃ¡veis; lifecycle, tentativa, destino e resumo
do Ãºltimo erro podem evoluir.

## Limites

NÃ£o hÃ¡ extrator, endpoint, tela, Tableau, baseline, despivotamento, retenÃ§Ã£o ou purge automÃ¡tico.
A D29 foi decidida e a migration foi aplicada uma única vez. A única reexecução autorizada pela
D30 não permite nova migration, `db push`, DDL, SQL Editor ou dados permanentes.

## Integração local P011/D40/D41

D40 referencia a PK de `import_batches` por `projects.legacy_import_batch_id`. Para permitir lote
e projetos na mesma transação, vínculos são aceitos em `received`, `validating` e `loaded`;
`rejected` é recusado. O CHECK não consulta lifecycle: essa regra fica na guarda D40. A referência
permanece depois do enriquecimento da data.

D41 fecha o lifecycle inverso: `trg_07_import_batches_rejection_guard` impede a transição para
`rejected` enquanto qualquer projeto — inclusive histórico ou soft-deleted — preservar o vínculo.
O vínculo toma `FOR SHARE` no lote, serializando a criação/correção do projeto com a rejeição.
Para liberar o lote antigo, Admin com contexto completo deve corrigir todos os projetos para outro
lote permitido; a linhagem nunca pode ser limpa.
