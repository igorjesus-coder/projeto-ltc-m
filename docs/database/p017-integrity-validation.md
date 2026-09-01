# P017 — validação global de integridade e idempotência

Contrato do schema: `ltcm.p017.schema-integrity.v1`
Contrato do fingerprint: `ltcm.p017.schema-fingerprint.v1`
Fingerprint nominal: `485a3a4b0eb6821dca7978d593c69ae0c2bedec836ff716938b76315484b0aa8`

## Inventário nominal

| Medida | Quantidade |
| --- | ---: |
| `migrationCount` | 15 |
| `relationCount` | 28 |
| `tableCount` | 19 |
| `viewCount` | 9 |
| `materializedViewCount` | 0 |
| `columnCount` | 486 |
| `functionCount` | 23 |
| `triggerCount` | 66 |
| `indexCount` | 79 |
| `primaryKeyCount` | 19 |
| `uniqueConstraintCount` | 20 |
| `foreignKeyCount` | 54 |
| `checkConstraintCount` | 100 |
| `protectedRlsTableCount` | 19 |
| `forceRlsTableCount` | 19 |
| `policyCount` | 49 |
| `grantCount` | 66 |
| `typeCount` | 10 |

O inventário exclui OIDs, timestamps de criação, owners e identificadores físicos incidentais.
A ordenação é canônica e o hash usa SHA-256. O teste PostgreSQL compara semanticamente o modelo
capturado from-zero com `docs/database/p017-schema-model.json`.

## Matriz de idempotência

| Fluxo | Contrato proprietário | Comportamento de rerun | Evidência P017 |
| --- | --- | --- | --- |
| Projeto | P011 | mesma identidade `project_code`; sem crescimento lógico | suíte P011/P012 + acceptance PostgreSQL |
| Item | P012 | `project_id + source_line_key`; `item_code` repetido é permitido | suíte P012 + duplicate scan |
| Baseline mensal | P013 | versão + métrica e fingerprint semântico estáveis | suíte P013 + duplicate scan |
| Batch/artefato/execução | P009/P013 | idempotency key, hash e recibo não duplicam execução lógica | constraints + rerun fixture |
| Linhas financeiras | P013 | identidade material preservada; zero explícito distinto de blank | suíte P013 + totals/fingerprint |
| Eventos realizados | Core/P014 | source key única; P014 não fabrica eventos | unique scan + regressão P014 |
| Reconciliação | P015 | read-only e determinística | suíte P015 |
| Views analíticas | P016 | SELECT read-only; mesma chave/fingerprint | 9 views + RLS smoke |

A aplicação das migrations é one-shot e ordenada. “Pipeline duas vezes” significa recriar o
schema from-zero e repetir fluxos de bootstrap/importação aplicáveis, não executar DDL histórico
duas vezes sobre o mesmo schema.

## Bootstrap e seeds

- `supabase/seed.sql`: `IDEMPOTENT`, restrito a BRL e US.
- bootstrap de roles do CI: `ONE_SHOT_BUT_GUARDED`, com preflight e cleanup.
- fixtures PostgreSQL P012–P017: `TEST_ONLY` e sintéticas.
- dados de produção ou `.local-source`: `NOT_APPLICABLE` para P017.

## Papéis e fronteira de segurança

- `ltc_m_runtime`: papel `NOLOGIN`, `NOSUPERUSER` e `NOBYPASSRLS` criado defensivamente pela P008.
- `postgres`: operador sintético do cluster isolado; a associação temporária usada pelo teste é revogada em `finally`.
- `PUBLIC`: não recebe acesso às nove views P016; grants contratuais são capturados no fingerprint.
- A matriz dinâmica cobre admin, viewer, contexto ausente e ator inválido sem depender de superuser no caminho de negócio.

## Precisão, reconciliação e decisões pendentes

P017 reutiliza o decimal exato P013/P014: escala, half-away-from-zero, signed zero, carry,
overflow e negativos são cobertos pelas suítes proprietárias sem `Number` autoritativo.
Findings P015 aprovados e decisões de negócio pendentes não são falhas técnicas. P014 permanece
controlled impossibility: zero alocações e zero eventos realizados fabricados.

## Drift e documentação

- `npm run docs:schema:generate`: regenera ERD/dicionário a partir do snapshot canônico.
- `npm run docs:schema:check`: falha se os documentos não correspondem ao snapshot.
- `npm run p017:check`: valida contratos, inventários P008/P016, CI e artefatos.
- `npm run test:p017:postgres`: compara PostgreSQL 17 from-zero ao snapshot e exercita integridade, RLS e rerun.

Nenhuma credencial Tableau, Extract ou agenda de refresh é criada pela P017.
