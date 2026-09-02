# P027 — Grade CRUD de itens do projeto

## Contrato

`ltcm.p027.project-items-crud.v1`

Esta entrega implementa a grade de itens no detalhe do projeto. O fluxo permanece
`Browser → API NestJS/Express → PostgreSQL`; o navegador não consulta o banco diretamente.

## Grão e semântica

Cada linha representa uma ocorrência de item em `ltc_m.project_items`. A identidade é o UUID da
linha, e não `item_code`: códigos podem ser repetidos no mesmo projeto. Criações manuais recebem
uma `source_line_key` técnica única e o próximo `line_number` sob lock da linha do projeto.

O banco continua sendo a fonte de verdade para:

- quantidade `numeric(20,4)`, estritamente maior que zero;
- preço unitário `numeric(20,4)`, maior ou igual a zero;
- total gerado `round(quantity * unit_price, 2)`, em `numeric(20,2)`;
- moeda do item igual à moeda base do projeto, somente BRL ou USD;
- unidade ativa na criação e na troca de unidade;
- constraints, auditoria, `row_version`, RLS e FORCE RLS.

Não há conversão cambial. A grade exibe o total retornado pelo PostgreSQL e não o recalcula para
persistência no frontend.

## API

Todos os endpoints usam Auth0 no guard de autenticação, resolução de perfil P021 e contexto do
ator na transação.

| Método | Rota                                            | Capacidade                    | Resultado                                      |
| ------ | ----------------------------------------------- | ----------------------------- | ---------------------------------------------- |
| GET    | `/projects/:projectId/items`                    | `data:read`, `financial:read` | projeto, itens visíveis e catálogo de unidades |
| POST   | `/projects/:projectId/items`                    | `record:create`               | cria item ativo                                |
| PATCH  | `/projects/:projectId/items/:itemId`            | `record:edit_draft`           | edita campos permitidos com `expectedVersion`  |
| POST   | `/projects/:projectId/items/:itemId/duplicate`  | `record:create`               | cria nova ocorrência com nova identidade       |
| POST   | `/projects/:projectId/items/:itemId/inactivate` | `soft_delete:execute`         | torna `active=false` com justificativa         |

Não existe endpoint HTTP DELETE. A inativação é reversível apenas por uma decisão/fluxo posterior
explicitamente autorizado; não há exclusão física.

Editores só podem alterar itens de projetos ativos. Administradores seguem a autorização de banco
para a operação administrativa de inativação. O backend valida novamente o projeto, moeda e
catálogo; a UI apenas melhora a experiência e oculta ações sem capacidade.

## Concorrência, auditoria e segurança

Atualizações, duplicações e inativações exigem a versão atual da linha. Uma versão divergente
retorna conflito e não sobrescreve a alteração concorrente. Criação e duplicação serializam a
numeração da linha pelo lock do projeto.

O `DatabaseService.actorTransaction` configura o ator e o request ID para que os triggers P007
registrem a operação. O PostgreSQL rejeita DML fora das políticas P008, mantém FORCE RLS e não
concede DELETE ao runtime. `deleted_at` permanece nulo para a inativação funcional da grade.

## Erros de contrato

Payloads desconhecidos ou números fora da precisão contratada falham fechado no parser da API.
Conflitos de versão retornam `P027_ITEM_VERSION_CONFLICT`; referências indisponíveis retornam
`P027_REFERENCE_UNAVAILABLE`, `P027_UNIT_UNAVAILABLE` ou
`P027_PROJECT_CURRENCY_UNAVAILABLE`, conforme o caso. O frontend não expõe detalhes internos do
banco.

## Migrações

Nenhuma migration foi criada: o schema P007/P008 já contém as colunas, constraints, triggers,
índices, grants e políticas necessários ao P027. A entrega é somente de aplicação, contrato e
testes locais.
