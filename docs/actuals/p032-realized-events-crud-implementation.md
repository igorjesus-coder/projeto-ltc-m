# P032 — Implementação do CRUD de lançamentos realizados

Este registro acompanha o contrato canônico em [`p032-realized-events-crud.md`](p032-realized-events-crud.md)
e não altera suas decisões D01–D16.

## Entrega

- A API NestJS/Express expõe `GET` e `POST` em
  `/projects/:projectId/realized-events`, `PATCH` no registro e as ações explícitas
  `POST .../:eventId/publish` e `POST .../:eventId/cancel`.
- A criação fixa `metric_type` em `billing_actual` e omite `status` para usar o default
  `draft`. `receipt_actual`, `receita` e `custo` não são expostos.
- Correções e transições exigem `row_version`; o cancelamento passa sua justificativa ao
  contexto P007, preservando a auditoria existente. Não há endpoint de DELETE.
- A tela React fica disponível em `/projects/:projectId/realized-events`, mostra o histórico
  completo (inclusive cancelados) e só oferece editar/publicar/cancelar para os estados
  autorizados pelo perfil vigente.

## Limites preservados

Nenhuma migration, DDL, enum, tipo gerado, view, grant, policy, seed ou acesso remoto foi
alterado. A unicidade existente de `(project_id, source_key)` continua impedindo a reutilização
silenciosa da identidade de um lançamento cancelado. O browser acessa somente a API.

## Verificação

Os testes P032 cobrem parser fechado, `billing_actual`, estados, justificativa, auditoria via
contexto, concorrência por versão, ausência de DELETE e preservação do histórico cancelado.
