# P009 / D32 — matriz de contexto e `request_id`

## Contrato aprovado

`audit_log.request_id` deve ser exatamente o `request_id` do contexto transacional ativo no
momento do DML auditado. O valor gravado em uma coluna `request_id` da entidade não substitui o
contexto. `set_actor_context()` usa configuração local à transação; rollback ou encerramento da
conexão elimina o contexto.

## Diagnóstico anterior à correção

Toda a suíte P009 roda em `connection-10`, dentro de uma única transação. Antes de `SET ROLE`, o
contexto de Editor era configurado uma vez como `p009-request-setup` e reutilizado implicitamente
por batch, aba, staging, erro, rejeição parcial e imutabilidade. A assertion D31 comparava a
auditoria da aba ao campo `request_id='p009-request-4'` da linha, embora o contexto ativo fosse
`p009-request-setup`. O trigger registrou corretamente o contexto.

| Cenário                         | Conexão/transação               | Usuário/perfil | Subject                 | Request D32 pretendido            | Configuração exata                         | DML/evento esperado                            | Assertion e encerramento                                        |
| ------------------------------- | ------------------------------- | -------------- | ----------------------- | --------------------------------- | ------------------------------------------ | ---------------------------------------------- | --------------------------------------------------------------- |
| setup de usuários               | `connection-10`, transação P009 | sistema        | nulo                    | `<run-id>:p009:setup:users`       | antes do INSERT `app_users`                | INSERT auditado de quatro usuários             | contexto confirmado; rollback final                             |
| batch create                    | mesma                           | Editor         | `p009-<run-id>\|editor` | `<run-id>:p009:batch:create`      | imediatamente antes dos lotes              | INSERT `import_batches`                        | ator/request/evento exatos; troca explícita no próximo cenário  |
| batch update                    | mesma                           | Editor         | idem                    | `<run-id>:p009:batch:update`      | imediatamente antes do UPDATE              | UPDATE `import_batches`                        | request configurado = auditado                                  |
| sheet create                    | mesma                           | Editor         | idem                    | `<run-id>:p009:sheet:create`      | antes das quatro abas                      | INSERT `import_batch_sheets`                   | request configurado = auditado                                  |
| sheet update                    | mesma                           | Editor         | idem                    | `<run-id>:p009:sheet:update`      | antes do lifecycle da aba                  | UPDATE `import_batch_sheets`                   | request configurado = auditado                                  |
| staging create                  | mesma                           | Editor         | idem                    | `<run-id>:p009:staging:create`    | antes das linhas                           | INSERT `import_staging_rows`                   | tabela não tem audit trigger; contexto e coluna da linha exatos |
| staging update/rejeição parcial | mesma                           | Editor         | idem                    | `<run-id>:p009:partial-rejection` | antes do UPDATE da linha                   | UPDATE de lifecycle, sem evento auditado       | contexto e `row_version` exatos                                 |
| erro append-only                | mesma                           | Editor         | idem                    | `<run-id>:p009:error:append`      | antes dos erros                            | INSERT `import_row_errors` auditado            | ator/request/evento exatos                                      |
| imutabilidade                   | mesma                           | Editor         | idem                    | `<run-id>:p009:immutability`      | antes das tentativas                       | DMLs negados; nenhum evento da operação negada | ausência de efeito; contexto trocado depois                     |
| Viewer                          | mesma, após `SET LOCAL ROLE`    | Viewer         | `p009-<run-id>\|viewer` | `<run-id>:p009:rls:viewer`        | antes do bloco Viewer                      | DML negado, sem evento                         | nega quatro tabelas/auditoria; nova configuração para Editor    |
| Editor                          | mesma                           | Editor         | `p009-<run-id>\|editor` | `<run-id>:p009:rls:editor`        | antes do bloco Editor                      | INSERT/UPDATE auditados de batch/aba/erro      | todos os eventos usam o request do perfil                       |
| Admin                           | mesma                           | Admin          | `p009-<run-id>\|admin`  | `<run-id>:p009:rls:admin`         | antes do bloco Admin                       | INSERT/UPDATE auditados de batch/aba           | todos os eventos usam o request do perfil; `RESET ROLE`         |
| contexto inválido               | mesma, runtime                  | Viewer/inativo | divergente/inativo      | valores negativos próprios        | dentro de subtransações antes da tentativa | `set_actor_context` negado; nenhum DML         | falha esperada, sem herança entre conexões                      |

Antes da lista abaixo, a linha `staging update/rejeição parcial` da matriz deve ser lida como dois
cenários independentes: `<run-id>:p009:staging:update` atualiza o lifecycle da linha processada e
`<run-id>:p009:partial-rejection` atualiza tentativa e resumo da linha rejeitada. Cada um possui
configuração e assertion pós-DML próprias, sem evento de `audit_log`, pois staging não usa o
trigger genérico.

## Dependências implícitas encontradas

- batch create e todos os testes de constraints de batch;
- todas as criações e regras de abas;
- erro de lote incompleto;
- criação e evolução de staging;
- dois erros da linha rejeitada;
- rejeição parcial e imutabilidade.

Esses grupos herdavam `p009-request-setup`. Viewer, Editor e Admin já trocavam o contexto, mas
usavam identificadores genéricos, não vinculados ao run ID nem validados contra cada evento.

## Mecanismo D32

Os 13 cenários possuem assertion central antes e depois do bloco de DML. Os oito cenários com
trigger também comprovam a igualdade exata entre o request configurado e o auditado.

O renderizador expande marcadores declarativos `@p009-context` por uma única função central. Ela
deriva request IDs determinísticos do run ID, configura ator/subject/request/source e emite uma
assertion imediata do contexto ativo. Marcadores `@p009-dml` e `@p009-audit` permitem ao gate
provar a ordem contexto → DML → auditoria e rejeitar expectativa divergente, contexto ausente ou
reutilização acidental.

## Resultado remoto D32

A única invocação `r20260803151221-2d4f91ba` executou os 13 contextos e chegou ao ROLLBACK final
sem exception SQL. As oito comparações configurado=auditado passaram dentro da transação. O
orquestrador, entretanto, não capturou o result set intermediário que materializava a tabela e
encerrou com código 1; não houve retry. O inventário final permaneceu idêntico ao preflight e
`rollback_clean=true`.
