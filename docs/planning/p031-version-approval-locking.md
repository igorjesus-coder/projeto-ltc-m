# P031 — versionamento, aprovação, bloqueio e arquivamento

## Estado da decisão

Esta implementação registra as decisões aprovadas no P031-D01, sem alterar os documentos
históricos de origem:

- `0.06`: artefato funcional específico não estava disponível no repositório; a ausência foi
  registrada como evidência de descoberta, sem inventar regra de negócio.
- `1.07`: fonte canônica de workflow e auditoria: [`versioning-audit-workflow-p007.md`](../database/versioning-audit-workflow-p007.md).
- `1.08`: fonte canônica de autorização, RLS e ACL: [`authorization-rls-p008.md`](../database/authorization-rls-p008.md).
- `P031-D01-DEC-01`: `raw_balance` positivo é aviso e não impede envio ou aprovação. O controle de
  excesso permanece o P030 existente; não há bypass de saldo.
- `P031-D01-DEC-02`: arquivamento é terminal e lógico. Somente `approved` ou `locked` podem ir para
  `archived`, exclusivamente por admin, com capability `workflow:archive` e justificativa. O registro
  permanece consultável, somente leitura e sem reabertura no mesmo UUID ou exclusão física.
- `P031-D01-DEC-03`: `reopen_plan_version` cria a revisão canônica: UUID novo, estado `draft`, parent
  imediato em `source_plan_version_id` e a mesma referência explícita em
  `baseline_plan_version_id`. A fonte e o baseline não são alterados; a cadeia é
  `baseline → revisão A → revisão B`.

## Modelo e concorrência

`plan_versions.row_version` é o token de concorrência de metadados e workflow. O
`content_revision` continua sendo o token de conteúdo mensal P029/P030. Cada comando mutable envia
`expectedRowVersion`; o backend bloqueia a versão dentro da mesma transação, compara o token e chama
uma única função SQL. Conflitos são sanitizados como `P031_VERSION_CONFLICT`. Nenhum comando reutiliza
`content_revision` ou altera linhas financeiras.

O backend expõe comandos explícitos, sem `PATCH` genérico:

```text
POST /planning/projects/:projectId/versions/:versionId/submit
POST /planning/projects/:projectId/versions/:versionId/return
POST /planning/projects/:projectId/versions/:versionId/approve
POST /planning/projects/:projectId/versions/:versionId/lock
POST /planning/projects/:projectId/versions/:versionId/archive
POST /planning/projects/:projectId/versions/:versionId/reopen
```

O banco mantém a máquina de estados, os triggers de proteção, RLS/FORCE RLS e auditoria. A migration
P031 é aditiva: formaliza a referência de baseline, adiciona a função de arquivamento, a assinatura
de reabertura com `expected_row_version` e amplia a leitura de versões arquivadas. A assinatura P007
legada de reabertura perde o grant do runtime para impedir que o caminho canônico seja contornado.

## Autorização e interface

Viewer e editor não recebem ações de aprovação. Approver pode devolver e aprovar; admin pode enviar,
devolver, aprovar, bloquear, arquivar e criar revisão. O arquivamento não concede delete físico nem
unlock direto. A tela P029/P030 continua sendo a única tela: exibe histórico, status, parent e
baseline, disponibiliza ações conforme status e capability e torna versões não draft somente leitura.

O aviso de saldo positivo continua visível, mas envio e aprovação não exigem saldo zero. Realizado,
baseline, moeda, regras de distribuição P030 e proteção de conteúdo permanecem inalterados.

## Validação local

O checker `scripts/check-p031-tests.mjs` protege a presença dos contratos, endpoints, testes e
evidência PostgreSQL. O harness `scripts/p031-postgres.integration.test.mjs` é opt-in, usa somente
fixtures sintéticas em cluster PostgreSQL 17 loopback e verifica estados, ACL/RLS, auditoria,
linhagem, baseline herdado, conflito de `row_version`, rollback e invariância de
`content_revision`. A etapa é registrada para CI futuro; nesta execução local pode ser pulada se não
houver banco disponível.
