# P032 — CRUD de lançamentos realizados

## Contrato e estado

Contrato: `ltcm.p032.realized-events-crud.v1`

Este documento é a fonte autoritativa das decisões funcionais e dos limites de primeira
entrega do P032. A formalização foi autorizada sem iniciar a implementação: o P032 permanece
**Não iniciada**, em `0%`.

O P032 implementará somente o CRUD de `billing_actual`. O contrato não autoriza backend,
frontend, endpoints, migration, alteração de schema, enum, RLS, views ou tipos gerados nesta
etapa.

## Fontes e escopo decidido

Não há artefato versionado identificável como Master Control no repositório para registrar este
contrato. A convenção observada em P023–P031 usa um documento específico da tarefa como fonte
operacional, com referências às fontes canônicas transversais. Por isso, este documento é a
autoridade específica do P032 e preserva as seguintes dependências:

- P007: `row_version`, contexto transacional, auditoria e imutabilidade;
- P008: autorização, RLS/FORCE RLS, grants e ausência de DELETE;
- P014: realizado e seus limites de proveniência/grão;
- P016: contrato das views analíticas, que não é alterado por esta formalização;
- P021: perfis e capabilities da aplicação.

O schema atual `ltc_m.financial_actual_events` continua sendo o modelo persistente. `billing_actual`
é o único tipo operacional entregue pelo P032. `receipt_actual` permanece reservado para evolução
futura e não será disponibilizado funcionalmente nesta entrega. Os termos funcionais `receita` e
`custo` não criam tipos persistidos, membros de enum ou tabelas; não serão convertidos em
`revenue_actual`, `cost_actual` ou equivalentes.

## Decisões P032-D01

As decisões abaixo formalizam D1–D16 autorizadas para o P032.

- **P032-D01-DEC-01 — tipo da primeira entrega:** somente `billing_actual` será operacionalizado.
  `receipt_actual` fica fora da entrega e reservado. Não haverá novos tipos persistidos nem
  valores no enum de tipos; `receita` e `custo` permanecem termos funcionais, não tipos.
- **P032-D01-DEC-02 — estados canônicos:** somente `draft`, `posted` e `cancelled` serão usados.
  Nenhum estado novo será criado.
- **P032-D01-DEC-03 — criação:** todo novo lançamento começa em `draft`. O cliente não escolhe o
  estado inicial nem cria diretamente em `posted` ou `cancelled`.
- **P032-D01-DEC-04 — edição de draft:** `draft` pode ser editado enquanto permanecer `draft`,
  com validação server-side, autorização, RLS/FORCE RLS, auditoria e `row_version`.
- **P032-D01-DEC-05 — publicação:** `draft -> posted` é permitida por operação explícita e
  validada pela API, depois da validação integral dos campos obrigatórios e invariantes.
- **P032-D01-DEC-06 — correção de posted:** `posted` pode receber correção de dados e permanece
  `posted`, desde que a operação seja autorizada, validada, auditada e protegida por
  `row_version`/concorrência. Um lançamento cancelado não pode ser corrigido.
- **P032-D01-DEC-07 — sem retorno:** `posted -> draft` é proibida. Não haverá reabertura por
  retorno a `draft`.
- **P032-D01-DEC-08 — cancelamento:** `draft -> cancelled` e `posted -> cancelled` são
  permitidas. O cancelamento preserva a linha, usa o status existente, registra auditoria,
  respeita `row_version` e nunca faz DELETE físico.
- **P032-D01-DEC-09 — justificativa:** toda operação funcional de cancelamento exige justificativa
  não vazia no contrato API/UI. A implementação deve reutilizar o contexto P007 e o campo
  `audit_log.justification` já existentes, com auditoria `CANCEL`; não deve criar coluna nova.
  Se a persistência adequada não puder ser satisfeita pelo modelo existente, a implementação
  deve parar e reportar a necessidade antes de qualquer alteração estrutural.
- **P032-D01-DEC-10 — terminalidade:** `cancelled` é terminal. O registro pode ser consultado e
  auditado, mas não pode ser editado, publicado, reaberto, revertido, voltar a outro estado ou
  ser fisicamente removido. Um substituto é um novo lançamento; o original permanece preservado.
- **P032-D01-DEC-11 — identidade após cancelamento:** a identidade lógica do cancelado não pode
  ser reutilizada silenciosamente. A regra vigente `project_id + source_key` permanece integral;
  a linha cancelada continua ocupando essa identidade. Não se alteram constraints nesta entrega.
  Se um substituto exigir mudança de constraint ou nova regra para `source_key`, a implementação
  deve reportar a necessidade antes de alterar schema.
- **P032-D01-DEC-12 — permissões:** não haverá capability nova específica de cancelamento. As
  operações de escrita usam o modelo vigente de perfis/capabilities, com `editor` e `admin`
  conforme os contratos atuais; toda autorização é server-side. RLS e FORCE RLS continuam
  obrigatórios e nenhuma permissão de banco nova é criada pelo P032.
- **P032-D01-DEC-13 — DELETE:** DELETE físico de lançamentos realizados é proibido para qualquer
  estado. A retirada funcional, quando autorizada pelo lifecycle, é cancelamento.
- **P032-D01-DEC-14 — semântica analítica:** somente `posted` representa realizado efetivo. `draft`
  não publicado e `cancelled` preservado para histórico/auditoria não contribuem para totais,
  indicadores ou consumos que signifiquem realizado efetivo. Views podem expor o status como
  dimensão quando esse for o contrato. A implementação deve verificar o contrato P016 antes de
  alterar qualquer view; esta formalização não altera views.
- **P032-D01-DEC-15 — concorrência:** não será introduzido `content_revision`. O token aplicável
  ao agregado é `row_version`, usado nas correções e transições com controle de concorrência
  otimista.
- **P032-D01-DEC-16 — migration:** a expectativa contratual é nenhuma migration. O modelo atual
  já possui tabela, tipo `billing_actual`, estados, RLS/FORCE RLS, no-DELETE, auditoria e
  `row_version`. Essa expectativa não autoriza ignorar evidência contrária: se requisito
  obrigatório exigir alteração estrutural, a implementação deve parar e apresentar a necessidade
  antes de criar migration.

## Lifecycle autorizado

| Estado atual    | Operação                    | Estado resultante | Permitido |
| --------------- | --------------------------- | ----------------- | --------- |
| inexistente     | criar                       | `draft`           | sim       |
| `draft`         | editar                      | `draft`           | sim       |
| `draft`         | publicar                    | `posted`          | sim       |
| `draft`         | cancelar, com justificativa | `cancelled`       | sim       |
| `posted`        | corrigir                    | `posted`          | sim       |
| `posted`        | cancelar, com justificativa | `cancelled`       | sim       |
| `posted`        | voltar para draft           | —                 | não       |
| `cancelled`     | editar                      | —                 | não       |
| `cancelled`     | publicar                    | —                 | não       |
| `cancelled`     | reabrir/reverter            | —                 | não       |
| qualquer estado | DELETE físico               | —                 | não       |

## Regras de implementação futura

O futuro fluxo deverá manter a fronteira `Browser → API NestJS/Express → PostgreSQL`; o browser
não acessa PostgreSQL/Supabase diretamente. A API valida entrada, autenticação, autorização,
status, invariantes, justificativa e `row_version` antes das escritas. O banco permanece
responsável por integridade, transação, RLS/FORCE RLS, auditoria e bloqueio de DELETE.

Valores monetários continuam usando `numeric`; códigos recebidos devem ser normalizados conforme
os contratos existentes; `project_item_id`, quando informado, deve pertencer ao `project_id`.
`source_key` continua obrigatório, não vazio e único por projeto. O P032 não fabrica fatos a
partir de forecast, não aloca evidência P014 e não transforma `receipt_actual`, receita ou custo
em `billing_actual`.

## Migration, estado e validação da formalização

Nenhuma migration, seed, alteração de enum, RLS, view, tipo gerado, endpoint, service, controller,
use-case, deploy ou acesso a banco remoto faz parte desta formalização. O estado do P032 não é
marcado como concluído nem iniciado; a alteração é exclusivamente documental.

As validações aplicáveis após o registro são a releitura deste contrato, a inspeção das fontes
referenciadas e os gates documentais/repositório disponíveis. A implementação futura deverá
adicionar testes no pacote afetado e executar os gates completos exigidos pelo repositório.

## Checklist de ambiguidades resolvidas

| Questão                    | Resposta autoritativa                                                     |
| -------------------------- | ------------------------------------------------------------------------- |
| Tipo implementado primeiro | somente `billing_actual`                                                  |
| `receipt_actual`           | fora do P032; reservado                                                   |
| `receita`/`custo`          | termos funcionais; não são tipos persistidos                              |
| Estado inicial             | sempre `draft`                                                            |
| Edição de draft            | permitida, permanecendo `draft`                                           |
| Publicação                 | `draft -> posted`, operação explícita validada                            |
| Correção de posted         | permitida, permanecendo `posted`                                          |
| Cancelamento               | `draft -> cancelled` ou `posted -> cancelled`, com justificativa          |
| Edição de cancelado        | proibida                                                                  |
| Reabertura/reversão        | proibida                                                                  |
| DELETE                     | físico sempre proibido                                                    |
| Permissões                 | modelo vigente; escrita por `editor`/`admin`, server-side e RLS/FORCE RLS |
| Semântica analítica        | realizado efetivo soma somente `posted`                                   |
| Concorrência               | `row_version`; sem `content_revision`                                     |
| Migration                  | nenhuma esperada; evidência contrária exige parada e decisão              |

## Resultado da decisão

As ambiguidades materiais D1–D16 e o lifecycle do P032 estão formalmente resolvidos neste
contrato. A implementação do CRUD continua sendo uma etapa posterior e ainda não iniciada.

`P032_CONTRACT_AUTHORIZED`
