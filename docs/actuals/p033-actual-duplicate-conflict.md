# P033 — conflito de duplicidade e consulta de realizados

## Contrato e autoridade

Contrato: `ltcm.p033.actual-duplicate-conflict.v1`

Plano: `P033 — Bloquear duplicidade e tratar cancelamentos`

Master Control: `2.16`

Estado na autoria: `Não iniciada`, `0%`

Dependências: `1.06 / P006` e `2.15 / P032`

Este documento formaliza as decisões humanas P033-D01 a P033-D20. Ele é a
autoridade específica do P033 para o tratamento de conflitos de identidade e
não altera o contrato canônico do P032:
[`ltcm.p032.realized-events-crud.v1`](p032-realized-events-crud.md).

As fontes transversais preservadas são:

- P006: constraints, índices e integridade;
- P007: contexto transacional, `row_version`, auditoria e no-DELETE;
- P008: autorização, RLS/FORCE RLS e grants;
- P014: limites de proveniência dos realizados;
- P016: views analíticas e separação de métricas;
- P021: perfis e capabilities da aplicação.

O fluxo permanece `Browser → API NestJS/Express → PostgreSQL`. O PostgreSQL
continua sendo a autoridade final de integridade e concorrência; qualquer
pre-check da aplicação serve somente à experiência do usuário.

## Escopo funcional

O P033 cobre o conflito causado pela identidade estrutural existente em
`ltc_m.financial_actual_events`:

```text
UNIQUE (project_id, source_key)
```

A constraint é `uq_financial_actual_source`. `metric_type` não participa da
chave. Assim, `billing_actual` e `receipt_actual` compartilham o mesmo
namespace, embora o P032 exponha funcionalmente somente `billing_actual`.

O P033 não cria novo lifecycle, novo mecanismo de cancelamento, nova tabela,
novo endpoint obrigatório, nova capability ou nova regra de substituição.

## Decisões autorizadas

### P033-D01 — regra estrutural de unicidade

Manter integralmente `UNIQUE (project_id, source_key)`. Não alterar constraint,
índice, schema, enum, RLS ou grants. `metric_type` não será adicionado à chave.

### P033-D02 — cancelado ocupa a identidade

Um registro `cancelled` continua ocupando `project_id + source_key`. Nova
tentativa com a mesma combinação resulta em conflito. Não haverá reutilização
automática, liberação da chave, exclusão física ou substituição silenciosa.

### P033-D03 — banco como autoridade final

A proteção definitiva permanece na constraint do PostgreSQL. O cenário
`check → no row → create` é permitido como otimização de UX, mas não é controle
de integridade. Em duas criações concorrentes da mesma identidade, somente uma
pode inserir; a outra deve tratar a violação de unicidade com segurança.

### P033-D04 — código de domínio

Uma violação especificamente identificada da constraint
`uq_financial_actual_source` será convertida em:

```text
P033_SOURCE_KEY_CONFLICT
```

O backend não pode mapear indiscriminadamente todo `23505` para esse código.
Outras violações de unicidade devem manter seu tratamento próprio ou genérico.

### P033-D05 — status HTTP

O conflito de `project_id + source_key` responde com HTTP `409 Conflict`.

### P033-D06 — mensagem funcional

A mensagem canônica apresentada ao usuário é:

```text
Já existe um lançamento com esta chave neste projeto.
```

O frontend não recebe mensagem bruta do PostgreSQL, SQL, diagnóstico do driver
ou o nome interno da constraint como texto funcional.

### P033-D07 — payload mínimo

O erro pode conter detalhes opcionais, sem retornar o registro financeiro
completo:

```json
{
  "statusCode": 409,
  "message": "P033_SOURCE_KEY_CONFLICT",
  "details": {
    "existingEventId": "<uuid opcional>",
    "existingStatus": "draft|posted|cancelled",
    "canOpen": true
  }
}
```

`existingEventId` e `existingStatus` são omitidos quando não puderem ser
retornados com segurança. `canOpen` é booleano obrigatório no contrato P033,
com valor `false` quando não houver consulta contextual autorizada.

### P033-D08 — enriquecimento seguro

`existingEventId` e `existingStatus` somente podem ser retornados quando:

1. a colisão corresponde a um lançamento funcionalmente exposto pelo P032/P033;
2. o registro é `billing_actual`; e
3. o contexto atual pode consultá-lo segundo a autorização e leitura vigentes.

Não será criada ACL nova.

### P033-D09 — colisão com `receipt_actual`

Uma colisão com `receipt_actual` continua bloqueando a criação de
`billing_actual`, porque as métricas compartilham a constraint. Como
`receipt_actual` está fora do escopo funcional do P032/P033, a resposta será
`409` com `P033_SOURCE_KEY_CONFLICT`, a mesma mensagem e `canOpen: false`.

Nesse caso não serão retornados `existingEventId`, `existingStatus`,
`metric_type` ou qualquer indicação de que a colisão veio de
`receipt_actual`. A constraint não será alterada para resolver esse caso.

### P033-D10 — não vazar existência indevida

Quando o registro conflitante não puder ser consultado pelo contexto atual, a
API mantém o conflito com `canOpen: false` e sem ID, status ou dados adicionais.
O tratamento não pode criar canal lateral de enumeration.

### P033-D11 — consulta do existente

Não será criado endpoint novo somente por causa do P033 se a leitura P032 pelo
identificador já for suficiente. A implementação deve reutilizar a lista/rota
existente sempre que possível. Uma nova rota somente será considerada mediante
prova de insuficiência da leitura atual, sem ampliar autorização ou exposição.

### P033-D12 — frontend

Ao receber `P033_SOURCE_KEY_CONFLICT`, a interface mostra a mensagem funcional
canônica. Quando `canOpen` for `true` e houver `existingEventId`, oferece ação
contextual equivalente a:

```text
Abrir lançamento existente
```

O texto final pode seguir a convenção visual da aplicação.

### P033-D13 — ação contextual

A ação reutiliza a lista, estado, rota ou leitura já disponível, abre ou destaca
o lançamento e reflete seu status real: `draft`, `posted` ou `cancelled`.

Para `cancelled`, a ação é somente consulta. Não são oferecidas reabertura,
exclusão ou edição de cancelado.

### P033-D14 — `canOpen = false`

Quando `canOpen` for `false`, a UI informa somente o conflito. Não apresenta
link quebrado, não executa busca adicional e não revela tipo reservado ou dado
não autorizado.

### P033-D15 — criação e atualização

O tratamento deve ser consistente em toda operação P032/P033 que possa produzir
colisão de `project_id + source_key`, incluindo criação e atualização de
`source_key` quando permitida pelo contrato atual.

### P033-D16 — double submit

O frontend continua desabilitando novas submissões enquanto a operação estiver
pendente. Isso é somente proteção de UX; a constraint continua sendo a
garantia contra duplicidade.

### P033-D17 — estados conflitantes

Para colisão segura com `billing_actual`, o backend pode informar
`existingStatus` como `draft`, `posted` ou `cancelled`. Nenhum estado novo será
criado.

### P033-D18 — auditoria e DELETE

O P033 preserva integralmente o cancelamento do P032, a auditoria P007, a
terminalidade de `cancelled`, a linha física e a proibição de DELETE. Nenhum
mecanismo alternativo de cancelamento será criado.

### P033-D19 — migration

Resultado autorizado: `NO_MIGRATION_REQUIRED`.

O escopo futuro é aplicação, contrato, testes e documentação. Se surgir
necessidade material de migration, mudança de constraint, schema, enum, RLS,
grant ou política estrutural, a implementação deve parar e reportar:

```text
P033_STRUCTURAL_DECISION_REQUIRED
```

### P033-D20 — testes mínimos

#### Banco e API

- primeira criação funciona;
- segunda criação idêntica não cria nova linha;
- resposta é `409` com `P033_SOURCE_KEY_CONFLICT`;
- somente `uq_financial_actual_source` recebe esse mapeamento;
- outras violações `23505` mantêm tratamento distinto;
- projetos diferentes podem reutilizar `source_key`;
- colisões com `draft`, `posted` e `cancelled`;
- `cancelled` continua ocupando a chave;
- colisão autorizada com `billing_actual` retorna ID/status;
- colisão com `receipt_actual` não retorna ID/status/tipo;
- contexto sem leitura não recebe detalhes;
- atualização que colide recebe tratamento equivalente;
- corrida concorrente resulta em uma única linha;
- nenhuma exclusão física ocorre.

#### Frontend

- mensagem amigável;
- `canOpen=true` oferece ação contextual;
- `canOpen=false` não oferece ação;
- draft pode ser aberto;
- posted pode ser aberto;
- cancelled pode ser consultado;
- `receipt_actual` não é exposto;
- double submit permanece bloqueado;
- erro bruto do banco não aparece.

## Compatibilidade e limites

O P032 permanece inalterado. A tabela, a constraint, o índice de suporte, os
estados, as views, RLS/FORCE RLS, grants, auditoria e tipos gerados não recebem
mudança por este contrato.

O endpoint P032 existente continua sendo a primeira opção para consultar um
registro identificado. A aplicação deve verificar o projeto e a autorização
antes de enriquecer o erro. O retorno de um conflito nunca autoriza acesso a
outro projeto nem transforma `receipt_actual` em funcionalmente exposto.

## Critérios de aceite

1. Tentativas duplicadas não geram nova linha.
2. A constraint do banco continua sendo a proteção definitiva, inclusive sob
   concorrência.
3. O conflito específico responde `409` com `P033_SOURCE_KEY_CONFLICT` e
   mensagem funcional sanitizada.
4. Um `billing_actual` autorizado pode ser consultado pela ação contextual,
   inclusive quando seu status for `cancelled`.
5. Colisões não autorizadas ou com `receipt_actual` não revelam ID, status,
   métrica ou dados adicionais.
6. Cancelamento continua auditável, terminal e sem exclusão física.

## Referências de implementação

- [P006 — constraints e índices](../database/constraints-audit-p006.md);
- [P007 — versionamento, auditoria e workflow](../database/versioning-audit-workflow-p007.md);
- [P008 — autorização e RLS](../database/authorization-rls-p008.md);
- [P014 — fundação de realizados](../import/p014-realized-import-foundation.md);
- [P016 — views analíticas](../analytics/p016-tableau-views.md);
- [P021 — autorização da aplicação](../auth/p021-authorization-ui-permissions.md);
- [P032 — contrato de CRUD](p032-realized-events-crud.md);
- [P032 — implementação atual](p032-realized-events-crud-implementation.md).

## Estado da formalização

Contrato criado para revisão documental. Esta etapa não implementa API,
frontend, testes funcionais, migration, schema, RLS, grants, views ou deploy.

`P033_CONTRACT_AUTHORIZED_READY_FOR_REVIEW`
