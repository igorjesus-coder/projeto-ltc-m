# P034 — Design formal de DDL para provenance

**Design ID:** `ltcm.p034.provenance-ddl-design.v1`<br>
**Contrato:** `ltcm.p034.data-quality-center.v3`<br>
**Fingerprint do contrato:** `3e1fc135c61634e759210e718ce04785de38e6be3b2c409468288df1d7a73117`<br>
**Status:** revisão formal aprovada; pronto para merge documental; não é migration executável<br>
**Base:** `main == origin/main == 98749d8fa3ca038b67a40487e884a0d5088b0b3a`

## 1. Escopo e resultado

Este documento congela o desenho técnico necessário para uma futura implementação de
provenance do P034. A implementação não faz parte deste trabalho. Não há migration, DDL
executável, tabela criada, grant aplicado, código de writer/reader alterado, tipo gerado,
seed, backfill, deploy ou operação em banco remoto.

A escolha é a **Opção P — tabelas dedicadas de provenance**. O modelo captura fatos de origem
tipados, mínimos e imutáveis, separados do staging P009. O P034 deriva somente os dois achados
de identidade que o contrato autoriza:

1. `DUPLICATE_PROJECT_SOURCE_IDENTITY`;
2. `DUPLICATE_ITEM_SOURCE_IDENTITY`.

`IMPORT_DUPLICATION` permanece exclusivamente no P015. Não existe, neste desenho, coluna,
tabela, índice, relação, regra, fingerprint ou chave de idempotência para materializar
identidade de importação no P034.

O desenho preserva as decisões D01–D26 e, em particular, `PERSIST_SOURCE_FACTS_NOT_FINDINGS`,
`LATEST_SUCCESSFUL_AUTHORITATIVE_SNAPSHOT`, `SOURCE_OCCURRENCE_CARDINALITY_MUST_BE_PRESERVED`,
`NO_AUTOMATIC_PROVENANCE_PURGE`, `PROVENANCE_RETENTION_POLICY_DEFERRED`,
`NO_P034_HISTORY_UI`, `P015_UNCHANGED` e `IMPORT_DUPLICATION_NOT_P034_MVP_ELIGIBLE`.

As decisões de capability aprovadas para esta revisão estão congeladas como `P034-D27` a
`P034-D31`, todas com autoridade `HUMAN_OWNER_DECISION`. Elas definem um pool server-side
dedicado, um login por ambiente, a capability PostgreSQL `NOLOGIN` e a assunção explícita por
`SET LOCAL ROLE`; não alteram P019, não criam capability P021 e não autorizam implementação nesta
PR.

Marcadores desta revisão:

- `P034_DESIGN_CONTRACT_ID_CORRECTED`;
- `P034_P015_REFERENCE_ORDER_PARITY_CORRECTED`;
- `P015_STABLE_TIE_ORDER_PRESERVED`;
- `P015_SOURCE_REFERENCE_CARDINALITY_ENFORCED`;
- `P034_REFERENCE_PARITY_WITHOUT_TRANSFORMATION`;
- `P034_AUTHORITY_REVISION_LOCK_LEAST_PRIVILEGE_CORRECTED`;
- `P034_PROVENANCE_CAPABILITY_DECISION_RESOLVED`;
- `AUTOMATED_DESIGN_REVIEW_APPROVED`;
- `P034_PROVENANCE_DDL_DESIGN_REVIEW_APPROVED_READY_FOR_MERGE`;
- `REFERENCE_PSEUDODDL_ONLY`;
- `RETRY_IDEMPOTENCY_DOES_NOT_DEDUP_SOURCE_OCCURRENCES`;
- `IMPORT_DUPLICATION_REMAINS_P015_ONLY`;
- `NO_TRUSTWORTHY_BACKFILL`.

`P034_PROVENANCE_CAPABILITY_DECISION_REQUIRED` e
`P034_PROVENANCE_DDL_DESIGN_REVIEW_CHANGES_REQUIRED` permanecem somente como marcadores
históricos da revisão do HEAD anterior `01993cec7c8b445b3b21233c14c44e6f2d11b643`; não são
gates ativos deste HEAD.

## 2. Evidência normativa e limites

### 2.1 Base e contrato

Antes da redação, a referência foi recalculada contra `docs/quality/p034-data-quality-center.md`.
O conteúdo corresponde ao fingerprint informado acima. O contrato não foi alterado. Qualquer
divergência futura deve interromper a preparação da migration com
`P034_V3_CONTRACT_FINGERPRINT_MISMATCH`.

O PR #31 já está incorporado na base autorizada. O PR #29 continua aberto/não incorporado.
As quatro correções locais da branch funcional foram preservadas e não são objeto desta
branch documental:

- `apps/api/src/quality/quality.service.ts`;
- `apps/api/test/quality.test.ts`;
- `apps/web/src/quality/quality.ts`;
- `apps/web/src/quality/quality.test.ts`.

`P034_LOCAL_CORRECTIONS_PRESERVED`.

### 2.2 O que este desenho não autoriza

Não ficam autorizados por este documento:

- criar ou editar `supabase/migrations`;
- fazer `db push`, SQL Editor, DDL remoto ou migration repair;
- alterar P015, P033, P009, o contrato v3, a API, o frontend ou a tabela `QualityFinding`;
- criar histórico, tela de histórico, Master Control ou P035;
- copiar `raw_payload`, staging rows, dados reais, caminhos locais, URLs sensíveis ou segredos;
- aplicar grants, roles, policies, triggers ou extensões agora;
- fazer backfill, seed, deploy, merge ou push de branch antes da revisão aprovar este design.

O futuro domínio continuará no schema `ltc_m`; `public` é proibido. A ausência de backup
recuperável continuaria sendo bloqueador para qualquer operação remota futura.

## 3. Comparação e decisão arquitetural

### 3.1 Opções consideradas

**Opção S — estender staging P009.** Reutilizaria `import_staging_rows` e seus vínculos ao
batch/sheet, acrescentando colunas ou tabelas filhas. Tem menor quantidade inicial de DDL,
mas mistura fatos autoritativos com lifecycle mutável (`pending`, `valid`, `rejected`,
`processed`), `raw_payload`, validação operacional e políticas editoriais do importador.
O staging atual não garante que a cardinalidade recebida para os grupos P015 permaneça
disponível após validação/normalização, e a autorização ampla de editor/admin aumentaria o
raio de alteração de provenance.

**Opção P — provenance dedicado.** Usa tabelas tipadas, sem payload bruto, com escopo explícito,
ocorrências físicas e referências sanitizadas. Permite RLS por projeto, fatos append-only,
publicação atômica e evolução independente do P009. Exige mais DDL e um writer dedicado.

### 3.2 Critérios ordenados

| ordem | critério               | S: staging estendido                 | P: provenance dedicado                      |
| ----: | ---------------------- | ------------------------------------ | ------------------------------------------- |
|     1 | paridade P015          | risco de depender do lifecycle       | fatos mínimos reproduzem as duas derivações |
|     2 | cardinalidade          | rows podem ser descartadas/agrupadas | ocorrência física explícita                 |
|     3 | autorização de projeto | policies de importação mais amplas   | cada fato tem projeto factual e RLS própria |
|     4 | imutabilidade          | proteção colide com processamento    | append-only desde a origem                  |
|     5 | snapshot               | batch/sheet não é autoridade         | envelope e revisão autoritativos            |
|     6 | separação P009/P034    | forte acoplamento operacional        | contratos separados                         |
|     7 | ataque                 | raw payload/lifecycle expostos       | sem payload, grants mínimos                 |
|     8 | DDL                    | menor no primeiro momento            | maior, porém explícito                      |
|     9 | performance            | reaproveita staging                  | índices específicos para latest/derivação   |
|    10 | manutenção             | mudanças P009 afetam P034            | evolução isolada                            |

### 3.3 Decisão

Escolhe-se **P**. Cardinalidade e paridade P015 são critérios dominantes; o custo de quatro
tabelas e policies dedicadas é aceitável para remover o acoplamento de lifecycle e payload.
Não haverá tabela genérica de findings: findings continuam derivados em memória pelo reader.

## 4. Modelo conceitual

O mínimo tipado é composto por: (1) envelope de snapshot por projeto; (2) observações de
projeto de origem; (3) observações de item de origem; e (4) referências de origem normalizadas,
somente porque o fingerprint do finding P015 as usa.

O snapshot é deliberadamente **single-project**. Um import batch com vários projetos produz
vários envelopes separados, um por projeto. Cada envelope tem sua própria transação de captura;
não há transação batch all-or-nothing presumida. Não existe `scope_key` opaco, snapshot
misto ou escopo inferido de string. O escopo exato é:

`scope_type = 'project'` + `project_id` factual + `import_batch_id` + `source_artifact_hash`.

`project_code` de origem fica nas observações e não substitui a relação factual. Não há
`UNIQUE(snapshot_id, project_code)`: codes repetidos são precisamente o fato que P034 conserva.

### 4.1 Estado e publicação

Escolhe-se o **Modelo C**, em forma mínima: fatos imutáveis e uma linha imutável de
publicação/autoridade no envelope do snapshot. Não existe estado `pending` visível, update de
publicação nem tabela mutável de head.

Todos os inserts do envelope, ocorrências e referências ocorrem na mesma transação. O snapshot
com `status = 'success'` — representação DB lowercase equivalente semanticamente a
`SUCCESS` do contrato — só se torna visível após o commit; transação abortada não deixa
snapshot parcialmente autoritativo. `authority_revision` determina o latest, não timestamps.

## 5. Especificação relacional congelada

Todos os objetos futuros são qualificados com `ltc_m.`. Tipos monetários permanecem `numeric`;
nenhum `float`, `real` ou `double precision` é permitido. IDs relacionais existentes usam
`uuid`; o `item_id` de origem é `text` nullable porque o contrato P015 o define como
`string | null` e a ocorrência pode existir antes de um `project_items.id`.

### 5.1 `ltc_m.p034_provenance_snapshots`

| coluna                        | tipo          | nulidade/default                | regra e finalidade                               |
| ----------------------------- | ------------- | ------------------------------- | ------------------------------------------------ |
| `id`                          | `uuid`        | NOT NULL, gen_random_uuid()     | PK técnica                                       |
| `import_batch_id`             | `uuid`        | NOT NULL                        | FK `import_batches(id)`, RESTRICT                |
| `project_id`                  | `uuid`        | NOT NULL                        | FK `projects(id)`, RESTRICT; escopo factual      |
| `scope_type`                  | `text`        | NOT NULL, `project`             | CHECK exatamente `project`                       |
| `schema_version`              | `smallint`    | NOT NULL, `1`                   | CHECK exatamente `1`                             |
| `source_artifact_hash`        | `text`        | NOT NULL                        | SHA-256 lowercase, 64 hex; de P009 `source_hash` |
| `snapshot_fingerprint`        | `text`        | NOT NULL                        | SHA-256 lowercase, 64 hex; UNIQUE                |
| `fingerprint_algorithm`       | `text`        | NOT NULL, `sha256-canonical-v1` | CHECK valor fixo                                 |
| `source_observation_contract` | `text`        | NOT NULL, P015 v1               | CHECK `ltcm.p015.reconciliation.v1`              |
| `status`                      | `text`        | NOT NULL, `success`             | CHECK exatamente `success`                       |
| `authority_revision`          | `bigint`      | NOT NULL                        | CHECK `> 0`, monotônico por projeto              |
| `captured_by_user_id`         | `uuid`        | NOT NULL                        | FK `app_users(id)`, RESTRICT; igual ao ator      |
| `request_id`                  | `text`        | nullable                        | trim não vazio, no máximo 200                    |
| `capture_source`              | `text`        | NOT NULL                        | exatamente `api`, ligado ao contexto             |
| `captured_at`                 | `timestamptz` | NOT NULL, `now()`               | observabilidade, não ordenação                   |
| `completed_at`                | `timestamptz` | NOT NULL                        | CHECK `>= captured_at`                           |

Constraints e índices:

- PK em `id`;
- `UNIQUE (import_batch_id, project_id)`;
- `UNIQUE (project_id, authority_revision)`;
- `UNIQUE (snapshot_fingerprint)`;
- `UNIQUE (id, project_id)` para FKs compostas dos filhos;
- índice `(project_id, authority_revision DESC, snapshot_fingerprint ASC)`;
- índice `(import_batch_id, project_id)`;
- CHECKs de trim, hash, versão, estado, algoritmo, fonte e datas;
- nenhuma coluna `project_code`, `raw_payload`, `import_identity` ou `finding_id`.

`source_artifact_hash` e `snapshot_fingerprint` são distintos: o primeiro identifica o artefato
P009; o segundo identifica o conjunto canônico de fatos P034. Ambos são distintos dos
fingerprints de input/relatório/finding P015.

### 5.2 `ltc_m.p034_provenance_project_observations`

| coluna                   | tipo      | nulidade/default            | regra e finalidade                        |
| ------------------------ | --------- | --------------------------- | ----------------------------------------- |
| `id`                     | `uuid`    | NOT NULL, gen_random_uuid() | PK física                                 |
| `snapshot_id`            | `uuid`    | NOT NULL                    | FK composta ao snapshot, RESTRICT         |
| `project_id`             | `uuid`    | NOT NULL                    | FK `projects`, RESTRICT; autorização      |
| `project_code`           | `text`    | NOT NULL                    | regex P015 `^[A-Z0-9][A-Z0-9._/-]{0,63}$` |
| `occurrence_ordinal`     | `integer` | NOT NULL                    | `> 0`, posição determinística             |
| `occurrence_fingerprint` | `text`    | NOT NULL                    | SHA-256 lowercase, 64 hex                 |

Constraints: `UNIQUE (snapshot_id, occurrence_ordinal)`, `UNIQUE (id, project_id)`, FK
`(snapshot_id, project_id)` para o envelope e índice
`(snapshot_id, project_code, occurrence_ordinal)`. Não há unique por code ou projeto.

O conjunto é o mínimo necessário para `DUPLICATE_PROJECT_SOURCE_IDENTITY`: código, vínculo
factual, multiplicidade e referências. Nome, cliente, moeda, contrato, saldo e valores não
participantes da regra não são copiados; o input P015 permanece completo fora desta persistência.

### 5.3 `ltc_m.p034_provenance_item_observations`

| coluna                   | tipo      | nulidade/default            | regra e finalidade                       |
| ------------------------ | --------- | --------------------------- | ---------------------------------------- |
| `id`                     | `uuid`    | NOT NULL, gen_random_uuid() | PK física                                |
| `snapshot_id`            | `uuid`    | NOT NULL                    | FK composta ao snapshot, RESTRICT        |
| `project_id`             | `uuid`    | NOT NULL                    | FK `projects`, RESTRICT; autorização     |
| `project_code`           | `text`    | NOT NULL                    | código P015 normalizado                  |
| `source_line_key`        | `text`    | NOT NULL                    | regex P015 `^p012-line-v1:[0-9a-f]{64}$` |
| `item_id`                | `text`    | nullable                    | valor P015 sem conversão silenciosa      |
| `occurrence_ordinal`     | `integer` | NOT NULL                    | `> 0`, posição determinística            |
| `occurrence_fingerprint` | `text`    | NOT NULL                    | SHA-256 lowercase, 64 hex                |

Constraints: `UNIQUE (snapshot_id, occurrence_ordinal)`, `UNIQUE (id, project_id)`, FK
`(snapshot_id, project_id)` e índice
`(snapshot_id, project_code, source_line_key, occurrence_ordinal)`, além de
`(project_id, project_code, source_line_key)`. Não há unique em
`(snapshot_id, project_code, source_line_key)`.

O conjunto preserva exatamente a identidade de item P015: `project_code + source_line_key`.
`item_code`, descrição, quantidade, unidade, moeda e totais não participam da regra e não são
persistidos. Não há FK obrigatório a `project_items`, pois uma ocorrência pode ser rejeitada ou
ainda não persistida; um vínculo opcional futuro não poderá substituir o `item_id` textual.

### 5.4 `ltc_m.p034_provenance_source_references`

| coluna                   | tipo      | nulidade/default            | regra e finalidade                      |
| ------------------------ | --------- | --------------------------- | --------------------------------------- |
| `id`                     | `uuid`    | NOT NULL, gen_random_uuid() | PK física                               |
| `project_id`             | `uuid`    | NOT NULL                    | FK `projects`, RESTRICT; RLS direta     |
| `project_observation_id` | `uuid`    | nullable                    | FK composta opcional                    |
| `item_observation_id`    | `uuid`    | nullable                    | FK composta opcional                    |
| `reference_ordinal`      | `integer` | NOT NULL                    | `> 0`, ordem canônica                   |
| `kind`                   | `text`    | NOT NULL                    | CHECK exatamente `source` ou `database` |
| `locator`                | `text`    | NOT NULL                    | trim, limite e allowlist segura         |
| `fingerprint`            | `text`    | NOT NULL                    | SHA-256 lowercase, 64 hex               |

Constraints: XOR entre os dois pais (exatamente um não nulo), `kind IN ('source', 'database')`, FKs compostas
`(project_observation_id, project_id)` e `(item_observation_id, project_id)`, ambas RESTRICT;
unique parcial por pai+ordinal e índices por `(project_id, parent, reference_ordinal)`. Não há
`source_references` de P015 aceita ambos os kinds (`source` e `database`); portanto, o P034
preserva o kind factual nessa relação, mesmo que o finding de duplicidade seja alimentado pela
propriedade `source_references`. A propriedade P015 `database_references` continua fora deste
modelo mínimo, pois não é usada por esses dois findings.

Referências idênticas mantêm ocorrências distintas por ordinal. A ordenação P015 é somente
`kind + "\\0" + locator`; em empate, a ordenação estável preserva a ordem factual de entrada.
`fingerprint` não é desempate semântico. O ordinal é atribuído depois dessa sequência, sem
colapsar o multiset.

### 5.5 Mapa explícito P015 → provenance

O adapter futuro parte do `P015ProjectObservation` e do `P015ItemObservation` completos, mas
persiste apenas os campos que participam das duas regras P034 e do `P015Finding` resultante:

| objeto/campo P015                 | destino P034                       | decisão                               |
| --------------------------------- | ---------------------------------- | ------------------------------------- |
| project `project_code`            | project observation `project_code` | persistir, identidade exata           |
| project `project_id`              | project observation `project_id`   | persistir, vínculo factual            |
| project `project_name`            | nenhum                             | não persistir; não participa da regra |
| project `client_id`               | nenhum                             | não persistir; auth vem do domínio    |
| project `currency_code`           | nenhum                             | não persistir; não participa da regra |
| project `contract_value`          | nenhum                             | não persistir; minimização financeira |
| project `database_contract_value` | nenhum                             | não persistir; não participa da regra |
| project `source_references`       | source references                  | persistir exatamente, ordem/multiset  |
| project `database_references`     | nenhum                             | não é usado pelo finding P034         |
| item `project_code`               | item observation `project_code`    | persistir, parte da identidade        |
| item `source_line_key`            | item observation `source_line_key` | persistir, parte da identidade        |
| item `item_id`                    | item observation `item_id`         | persistir como `text nullable`, exato |
| item `item_code`                  | nenhum                             | não participa da regra                |
| item `description`                | nenhum                             | não participa da regra                |
| item `quantity`                   | nenhum                             | não participa da regra                |
| item `unit_code`                  | nenhum                             | não participa da regra                |
| item `currency_code`              | nenhum                             | não participa da regra                |
| item `total_amount`               | nenhum                             | minimização financeira                |
| item `database_total_amount`      | nenhum                             | não participa da regra                |
| item `source_references`          | source references                  | persistir exatamente, ordem/multiset  |
| item `database_references`        | nenhum                             | não é usado pelo finding P034         |

O identity map é, portanto, exatamente `project_code` para projetos e
`project_code + source_line_key` para itens. A derivação deve preservar a semântica P015 de
`groupBy`, usar a primeira ocorrência da ordenação canônica como base do finding e agregar as
referências de todas as ocorrências. Não se cria unique relacional para substituir esse
agrupamento.

### 5.6 Checks formais a congelar na migration futura

Além de PK/FK/UNIQUE/índices já listados, a futura migration deverá expressar como CHECK (ou
validação equivalente antes do insert, quando envolver outro pai):

- hashes: `lower(value) = value AND value ~ '^[0-9a-f]{64}$'`;
- `scope_type = 'project'`, `schema_version = 1`, `status = 'success'` e
  `fingerprint_algorithm = 'sha256-canonical-v1'`;
- `source_observation_contract = 'ltcm.p015.reconciliation.v1'`;
- `capture_source = 'api'`;
- `request_id IS NULL OR (btrim(request_id) <> '' AND char_length(request_id) <= 200)`;
- `project_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,63}$'`;
- `source_line_key ~ '^p012-line-v1:[0-9a-f]{64}$'`;
- `item_id IS NULL OR (btrim(item_id) <> '' AND item_id = btrim(item_id))`;
- `occurrence_ordinal > 0` e `reference_ordinal > 0`;
- `completed_at >= captured_at`;
- `locator` com trim não vazio, `char_length(locator) <= 1024`, sem drive path,
  `/home`, `/Users`, URL HTTP(S), URL PostgreSQL ou tokens/segredos reconhecíveis;
- referência com exatamente um parent ID e `kind IN ('source', 'database')`.

O validador de locator deve ser compartilhado semanticamente com a rejeição P015. Um CHECK
adicional mais restritivo nunca pode transformar uma referência P015-safe em outro valor e gerar
um finding ID diferente; nesses casos o snapshot é inelegível.

O padrão P015 real é:

`/(?:[A-Z]:\\|(?:^|\\s)\/(?:home|Users)\/|postgres(?:ql)?:\/\/|https?:\/\/|\b(?:password|token|private_key|client_secret)\s*=)/iu`.

O writer aplica esse teste antes do insert e persiste o `locator` byte a byte, já validado pelo
normalizer P015; não há sanitização transformadora, truncamento ou remoção de partes.

### 5.7 FKs, deleção e ownership

Todas as FKs usam `ON DELETE RESTRICT`; fatos não são apagados por deleção de batch, projeto,
usuário ou pai. Não há `ON DELETE CASCADE`. As tabelas pertencem a owner de migration não usado
pelo runtime e sem `BYPASSRLS`. Não há `TRUNCATE` para runtime/writer. Update e delete não
recebem grants e também são bloqueados por triggers defensivas. Nenhum trigger copia fatos para
`audit_log`; audit log não é provenance.

## 6. Captura, snapshot e fingerprints

### 6.1 Fonte e elegibilidade

O writer recebe observações já normalizadas pelo mesmo vocabulário P015. Valida referências
com o mesmo contrato de segurança e exige `import_batches.source_hash` não nulo e válido.
Não lê nem persiste `raw_payload`.

Para capturar um projeto, todos os grupos `project_code` candidatos devem resolver a um único
`project_id` factual; o projeto deve existir e estar autorizado; cada item deve preservar
`project_code + source_line_key`; a cardinalidade física, inclusive ocorrências iguais, deve
chegar ao insert; cada project/item observation deve ter ao menos uma `source_reference`; e
nenhuma referência P015 válida pode ser alterada silenciosamente.

Observação sem vínculo factual não é fabricada, atribuída a projeto arbitrário nem inserida
como P034. O snapshot daquele escopo falha fechado antes da transação; P015 pode reportar seu
resultado fora desta fundação. Não existe projeto pseudo ou fallback por code.

### 6.2 Ordenação e autoridade

O latest é selecionado por `ORDER BY authority_revision DESC` por `project_id`; a unique
`(project_id, authority_revision)` torna empate impossível. A revisão é alocada depois do lock
advisory transacional definido na seção 7.4, com projetos bloqueados em ordem ascendente de UUID
textual. Só depois do lock o writer calcula `COALESCE(MAX(authority_revision), 0) + 1`; a unique
é defesa adicional. Nunca se usa `MAX + 1` sem lock/constraint.

### 6.2.1 Paridade exata e empates estáveis

O adapter deve primeiro construir as observações P015 normalizadas e aplicar exatamente os
comparadores existentes:

- projects: `project_code + "\\0" + (project_id ?? "")`;
- items: `project_code + "\\0" + source_line_key + "\\0" + (item_id ?? "")`;
- references: `kind + "\\0" + locator`.

Não entram no comparator references, occurrence fingerprint, UUID técnico ou ordem de INSERT.
O ambiente JavaScript suportado tem `Array.sort` estável; quando a chave empata, a ordem
relativa da sequência factual/source recebida pelo adapter é preservada. Isso é obrigatório:
P015 usa `group[0]` como base e `group.flatMap(source_references)` na ordem do grupo, e essa
ordem participa do finding ID.

`occurrence_ordinal` representa a posição depois da canonicalização P015 estável, não uma nova
ordenação inventada pelo P034. A ordem física dos INSERTs SQL pode variar; a ordem semântica
armazenada nos ordinais não pode variar. Se a origem não fornecer uma sequência factual
reprodutível antes da persistência, o snapshot é inelegível, pois não há como preservar a
identidade P015.

Para referências com mesmo `kind + "\\0" + locator` e fingerprints diferentes, o adapter
preserva a ordem de entrada estável; o fingerprint não vira desempate.

Ordenação do snapshot fingerprint usa exatamente essas três sequências P015 e seus ordinais;
não usa referências, occurrence fingerprint ou UUID técnico como novos critérios.

### 6.3 Material do snapshot

Usa-se exclusivamente `sha256Canonical` já existente, com material:

```json
{
  "contract": "ltcm.p034.provenance-snapshot.v1",
  "scope_type": "project",
  "schema_version": 1,
  "import_batch_id": "<uuid>",
  "project_id": "<uuid>",
  "source_artifact_hash": "<sha256>",
  "project_observations": [
    {
      "ordinal": 1,
      "project_code": "<normalized>",
      "project_id": "<uuid>",
      "source_references": [
        { "kind": "source", "locator": "Valores Projetos LTC-M!C4", "fingerprint": "<sha256>" }
      ]
    }
  ],
  "item_observations": [
    {
      "ordinal": 1,
      "project_code": "<normalized>",
      "source_line_key": "<normalized>",
      "item_id": null,
      "source_references": [
        { "kind": "source", "locator": "Prev. Receita Mensal!A4:J4", "fingerprint": "<sha256>" }
      ]
    }
  ]
}
```

Arrays preservam as sequências P015 canônicas estáveis, incluem multiplicidade e referências
P015-safe sem transformação. Timestamps, UUIDs técnicos das linhas, `authority_revision` e
ordem de insert ficam fora. O occurrence fingerprint
usa `ltcm.p034.provenance-occurrence.v1` e não substitui o ordinal. Artifact hash, provenance
snapshot fp, P015 input/report/finding fps são conceitos distintos.

### 6.4 Cardinalidade de referências

`references(...)` do P015 exige array e `length > 0` para `project.source_references` e
`item.source_references`. O writer valida isso antes da transação e o banco futuro reforça com
dois constraint triggers deferrable, `trg_p034_project_reference_cardinality` em
`ltc_m.p034_provenance_project_observations` e `trg_p034_item_reference_cardinality` em
`ltc_m.p034_provenance_item_observations`, ambos `AFTER INSERT ... DEFERRABLE INITIALLY
DEFERRED`. No commit, a função do trigger conta `p034_provenance_source_references` pelo
parent ID e rejeita com erro qualificado se count for zero. As FKs e o CHECK XOR garantem que
cada referência seja de exatamente um parent correto; unique parcial garante ordinal único;
referências repetidas permanecem linhas distintas. Como a checagem é deferred, inserir pai e
filhos na mesma transação é válido, mas `SUCCESS` sem referência é impossível.

### 6.5 Idempotência e replay

Retry exato de `import_batch_id + project_id + snapshot_fingerprint` encontra o snapshot e
retorna sucesso sem novo envelope/fatos. Mesmo batch/projeto com fingerprint diferente falha
como conflito antes de mutar. Novo artefato usa novo batch.

`RETRY_IDEMPOTENCY_DOES_NOT_DEDUP_SOURCE_OCCURRENCES`.

Ocorrência física legítima repetida recebe linha e ordinal próprios, mesmo com occurrence fp
igual. Retry não cria nova linha. Em concorrência, a unique classifica replay exato ou conflito;
não há dependência da ordem de chegada.

`UNIQUE(import_batch_id, project_id)` significa uma captura lógica por projeto dentro de um
batch P009 aceito. O writer não permite uma segunda captura corrigida no mesmo batch: como
`source_hash` é a identidade imutável do artefato e o retry distinto seria ambíguo, a correção
deve gerar novo `import_batch_id`. Assim, a unique não impede reprocessamento legítimo; impede
mutação/reinterpretação do batch original. `UNIQUE(snapshot_fingerprint)` é globalmente correto
porque o material inclui `import_batch_id` e `project_id`: mesmo conjunto lógico em novo batch
é um novo artefato/captura, enquanto retry do mesmo batch é o mesmo fingerprint.

### 6.6 Fluxo transacional

`source validated → normalized observations → capture material → fingerprint → actor/import/scope →
acquire P034_PROVENANCE_DATABASE_POOL → BEGIN → SET LOCAL ROLE ltc_m_provenance_writer →
identity/actor checks → advisory lock → replay/idempotency → snapshot → project occurrences →
item occurrences → refs → invariants → publish authority SUCCESS → COMMIT → release`.

O writer usa exclusivamente o pool server-side dedicado `P034_PROVENANCE_DATABASE_POOL` e a
capability `ltc_m_provenance_writer`; nunca usa `DATABASE_URL` como fallback. Antes do role change,
`session_user` é `<p034_provenance_login>` e, depois de `SET LOCAL ROLE`, `current_user` é
`ltc_m_provenance_writer`. O serviço valida Auth0/ator, chama `set_actor_context` conforme P008 e
grava pelo writer. Todos os inserts ocorrem em uma transação.

`SET LOCAL ROLE` é permitido pela membership de ambiente com `INHERIT FALSE, SET TRUE` e só
existe durante a transação. `COMMIT` ou `ROLLBACK` remove o role local e os settings
transaction-local (`actor_id`, `request_id` e `source`) antes de a conexão ser devolvida ao pool.
O pool deve testar explicitamente que a conexão reutilizada começa sem actor anterior e sem role
writer residual. A captura ausente ou inválida falha fechado com
`P034_PROVENANCE_WRITER_UNAVAILABLE`; não há captura parcial nem downgrade para leitura/runtime.

Deadlock ou serialization failure retenta a transação inteira, com novo replay check. Queda
antes do commit deixa rollback; queda depois do commit é resolvida relendo o fingerprint.
Nenhuma parte é autoridade antes do commit.

### 6.6 Matriz de falhas

| situação                | comportamento                  | parcial autoritativo? |
| ----------------------- | ------------------------------ | --------------------: |
| validação falha         | rejeitar antes da transação    |                   não |
| falha antes do envelope | rollback                       |                   não |
| falha após envelope     | rollback de tudo               |                   não |
| FK/projeto inválido     | erro e rollback                |                   não |
| retry idêntico          | no-op/replay                   |         não cria novo |
| mesmo batch/fp novo     | conflito/rollback              |                   não |
| queda antes do commit   | rollback e retry completo      |                   não |
| queda após commit       | replay confirma commit inteiro |         sim, completo |
| deadlock/serialization  | retry limitado completo        |                   não |
| mesma scope concorrente | lock + unique, replay/conflito |                   não |
| scopes distintos        | prosseguem sem misturar        |                   não |
| novo fp                 | nova revisão após lock         |           não parcial |
| publicação falha        | rollback completo              |                   não |

### 6.7 Boundary transacional P009/P034

P034 não altera a semântica business do P009. O importador primeiro conclui e commita sua
transação de negócio autorizada; somente depois do commit, com as observações normalizadas e o
`project_id` factual disponível, o orquestrador inicia uma transação independente de captura
P034. Falha, timeout, deadlock ou indisponibilidade de provenance não faz rollback, não muda
status, não reabre batch e não corrige silenciosamente `import_batches`/staging. O erro fica
retryable e observável, e o batch P009 permanece com o resultado que já tinha.

Para batch multi-project, o orquestrador chama uma captura independente por projeto. Um projeto
que falha não desfaz os demais; isso é partial provenance por projeto, não partial snapshot:
cada envelope individual é completo ou inexistente. Retry usa o par batch/projeto e seu
fingerprint; latest é independente em cada projeto. Se a exigência futura mudar para
atomicidade batch-level, parar com `P034_P009_TRANSACTION_SEMANTICS_DECISION_REQUIRED`.

`P034_PROVENANCE_FAILURE_DOES_NOT_MUTATE_P009_BUSINESS_SEMANTICS`.

## 7. Imutabilidade, RLS e grants

As quatro tabelas terão `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`. O runtime
somente lê; o writer somente insere. Não há grants de `UPDATE`, `DELETE`, `TRUNCATE` ou
`REFERENCES` para papéis de aplicação.

Triggers `SECURITY INVOKER`, com `search_path = ''` e referências totalmente qualificadas,
rejeitam `UPDATE` em qualquer coluna factual e `DELETE` em qualquer linha. A proteção não
depende só do cliente e não abre uma função `SECURITY DEFINER`. Os triggers não permitem
alteração de batch, projeto, observações, referências, fingerprint, ordinais ou timestamps.

### 7.1 RLS escolhida

Escolhe-se o modelo híbrido **parent + `project_id` direto**: cada tabela filha carrega o
`project_id` factual e possui FK composta para o pai. Isso evita joins de policy em cada leitura,
permite prova direta de autorização e impede que uma referência de projeto seja ligada a pai de
outro.

Para `SELECT`, `INSERT` e `WITH CHECK`, a expressão de visibilidade deve reproduzir a policy
P008 existente, sem inventar uma nova definição:

- `authorization_context()` deve devolver ator ativo;
- `admin` passa pela ramificação P008 de admin;
- qualquer papel não-admin passa somente quando `projects.status = 'active'`,
  `projects.deleted_at IS NULL` e existe linha em `ltc_m.clients` com
  `clients.id = projects.client_id`; P008 não exige `clients.active` nessa policy;
- para INSERT, além da mesma visibilidade factual, o ator deve ser `editor` ou `admin`,
  `current_setting('ltc_m.source', true) = 'api'` e a linha deve ter
  `captured_by_user_id = ltc_m.current_actor_id()`;
- snapshot, observações e referências testam o `project_id` factual da própria linha.

Como o snapshot é single-project, não há risco de envelope revelar existência ou count de
projeto não autorizado dentro de snapshot misto. O reader calcula `totalItems` somente depois
da seleção do latest e da derivação autorizada; nunca usa count global, staging ou import
duplicates para paginação.

### 7.2 Grants congelados

Antes de conceder privilégios, a futura migration deverá revogar todos os privilégios de
`PUBLIC` nas quatro tabelas, sequências relevantes e funções novas.

| objeto                            | PUBLIC           | `ltc_m_runtime` | `ltc_m_provenance_writer` | owner de migration   |
| --------------------------------- | ---------------- | --------------- | ------------------------- | -------------------- |
| schema `ltc_m`                    | nenhum           | USAGE           | USAGE                     | controle estrutural  |
| snapshots                         | nenhum           | SELECT          | SELECT, INSERT            | ALL necessário à DDL |
| project observations              | nenhum           | SELECT          | SELECT, INSERT            | ALL necessário à DDL |
| item observations                 | nenhum           | SELECT          | SELECT, INSERT            | ALL necessário à DDL |
| source references                 | nenhum           | SELECT          | SELECT, INSERT            | ALL necessário à DDL |
| funções de proteção               | EXECUTE revogado | nenhum          | nenhum                    | owner                |
| UPDATE/DELETE/TRUNCATE/REFERENCES | revogado         | revogado        | revogado                  | somente owner        |

`ltc_m_runtime` não recebe INSERT; o reader/API não pode fabricar provenance. A função de
contexto existente P008 continua autoridade de ator. Não se adiciona função de ingestão
`SECURITY DEFINER`. O login de ambiente não recebe grants funcionais diretos: somente a
capability recebe os grants de domínio. O SELECT do writer nas quatro tabelas P034 é mínimo,
mas necessário para replay do snapshot e para os predicados de integridade/pais das inserções;
as policies continuam limitando as linhas ao ator/projeto autorizado. Não há SELECT genérico
adicional em outros domínios.

Matriz operacional completa (aplica-se a cada uma das quatro tabelas; `—` significa privilégio
revogado/não aplicável):

| objeto                       | papel                     |   SELECT |        INSERT |        UPDATE |        DELETE | REFERENCES | TRUNCATE |        EXECUTE |
| ---------------------------- | ------------------------- | -------: | ------------: | ------------: | ------------: | ---------: | -------: | -------------: |
| cada tabela P034             | PUBLIC                    |        — |             — |             — |             — |          — |        — |              — |
| cada tabela P034             | `ltc_m_runtime`           |      sim |             — |             — |             — |          — |        — |              — |
| cada tabela P034             | `ltc_m_provenance_writer` |      sim |           sim |             — |             — |          — |        — |              — |
| cada tabela P034             | owner migration           |      sim |           sim |           sim |           sim |        sim |      sim |              — |
| `projects`, `import_batches` | `ltc_m_runtime`           |      sim | conforme P008 | conforme P008 | conforme P008 |          — |        — | P008 allowlist |
| `projects`, `import_batches` | `ltc_m_provenance_writer` | sim, RLS |             — |             — |             — |          — |        — |              — |
| funções de proteção          | PUBLIC                    |        — |             — |             — |             — |          — |        — |              — |
| funções de proteção          | runtime                   |        — |             — |             — |             — |          — |        — |              — |
| funções de proteção          | writer                    |        — |             — |             — |             — |          — |        — |              — |
| funções de proteção          | owner migration           |        — |             — |             — |             — |          — |        — |            sim |

Os privilégios P008 existentes de `projects` e `import_batches` não são ampliados nesta revisão:
a linha do writer é um requisito futuro explícito, com policy própria equivalente à visibilidade
P008 e somente para validação de projeto, source hash e replay. Nenhum grant é aplicado nesta PR.
`ltc_m_runtime` mantém exatamente sua ACL já aplicada; a coluna “conforme P008” não autoriza
qualquer mudança nesta PR.

O owner estrutural é a única exceção operacional e não deve ser usado pela aplicação. A tabela
de grants final também deverá revogar privilégios de sequences e de qualquer função auxiliar
não explicitamente necessária.

### 7.3 Context binding e capacidade de writer

`captured_by_user_id` passa a ser `NOT NULL` no MVP e deve ser igual a
`ltc_m.current_actor_id()` no `WITH CHECK`/writer validation. `request_id`, quando informado,
deve ser igual a `current_setting('ltc_m.request_id', true)`; `capture_source` é exatamente
`current_setting('ltc_m.source', true)` e, nesta captura autenticada, esse valor é `api`.
O caller não escolhe outro ator, request ou source no INSERT. A função P008 continua validando
`app_user_id`, `auth_subject`, usuário ativo, formato de source e request; provenance apenas
amarra os valores já validados ao fato.

As decisões humanas congelam a seguinte fronteira, sem alterar P019 existente:

`P034-D27 = HUMAN_DECISION_APPROVED`<br>
`P034-D28 = HUMAN_DECISION_APPROVED`<br>
`P034-D29 = HUMAN_DECISION_APPROVED`<br>
`P034-D30 = HUMAN_DECISION_APPROVED`<br>
`P034-D31 = HUMAN_DECISION_APPROVED`

Autoridade: `HUMAN_OWNER_DECISION`.

| decisão    | estado congelado                                                                | autoridade             |
| ---------- | ------------------------------------------------------------------------------- | ---------------------- |
| `P034-D27` | `DEDICATED_PROVENANCE_WRITER_POOL` server-side, separado do pool/runtime normal | `HUMAN_OWNER_DECISION` |
| `P034-D28` | `NO_RUNTIME_WRITER_MEMBERSHIP`                                                  | `HUMAN_OWNER_DECISION` |
| `P034-D29` | `PROVENANCE_WRITER_NOLOGIN_CAPABILITY_ROLE`                                     | `HUMAN_OWNER_DECISION` |
| `P034-D30` | `DEDICATED_PROVENANCE_LOGIN_WITH_EXPLICIT_ROLE_ASSUMPTION`                      | `HUMAN_OWNER_DECISION` |
| `P034-D31` | `DEDICATED_PROVENANCE_DATABASE_CREDENTIAL`                                      | `HUMAN_OWNER_DECISION` |

`DATABASE_URL` continua sendo exclusivamente o pool/runtime normal. O reader P034 usa esse
pool; o writer P034 usa exclusivamente `P034_PROVENANCE_DATABASE_POOL`, configurado por
`P034_PROVENANCE_DATABASE_URL`, server-side e secreto. A URL de provenance é obrigatória quando
o writer estiver habilitado, deve ser PostgreSQL válida, segura com TLS em produção e distinta de
`DATABASE_URL`; igualdade, ausência ou invalidez falha fechado (`PROVENANCE_CREDENTIAL_MUST_BE_DISTINCT`)
e nenhuma tentativa de fallback é permitida (`NO_PROVENANCE_DATABASE_URL_FALLBACK`). O writer
indisponível sem configuração válida produz `P034_PROVENANCE_WRITER_UNAVAILABLE`; o reader pode
continuar servindo leitura quando o writer ainda não estiver habilitado.

O pool dedicado tem lifecycle/close explícito, timeout de conexão, idle e statement limitados,
`application_name = 'ltcm-api-p034-provenance'`, limite de conexões bounded e nenhuma exposição
ao browser. Reutiliza primitives do pool P019 quando possível, mas mantém lifecycle, credencial e
instância separados. Não introduz ORM, Supabase client ou endpoint público novo. O writer depende
explicitamente de `P034_PROVENANCE_DATABASE_POOL`; injetar `DATABASE_POOL` normal é erro de
arquitetura/teste.

`ltc_m_provenance_writer` é uma capability técnica PostgreSQL `NOLOGIN`, `NOINHERIT`,
`NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, `NOBYPASSRLS`, sem ownership de
tabelas/funções privilegiadas, sem memberships desnecessários e sem grants de domínio ao login.
Ela recebe somente os privilégios mínimos explicitados na seção 7.2. O LOGIN simbólico
`<p034_provenance_login>` não é owner, superuser, `BYPASSRLS`, `CREATEDB`, `CREATEROLE` ou
`REPLICATION`, e é membro exclusivamente dessa capability, além do mínimo de conexão exigido
pela infraestrutura. `ltc_m_runtime` e o login usado por `DATABASE_URL` não recebem membership,
INSERT ou capacidade de assumir essa role. Não existe helper genérico que transforme o runtime em
writer. Este invariant será testado por `RUNTIME_CANNOT_ASSUME_PROVENANCE_WRITER`.

O membership é provisionado fora do repositório pela infraestrutura/DB do ambiente
(`ENVIRONMENT_PROVISIONING_OWNS_LOGIN_AND_MEMBERSHIP`), sem nome real de login, password,
connection string ou secret versionado. A forma PostgreSQL 17 conceitualmente compatível é:

```sql
GRANT ltc_m_provenance_writer
TO <p034_provenance_login>
WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
```

O login não recebe grants funcionais diretos; `CONNECT`, se necessário, é privilégio de
infraestrutura, não de domínio. A migration futura pode criar a capability e seus ACLs, mas não
cria login, password, secret ou membership dependente de nome de ambiente. Nenhuma migration 19
é criada por esta revisão.

Na transação do writer, a sequência é obrigatoriamente `acquire → BEGIN → SET LOCAL ROLE
ltc_m_provenance_writer → confirmar session_user/current_user quando apropriado →
ltc_m.set_actor_context(...) → validações → lock → replay/idempotência → inserts → checks →
COMMIT → release`. Antes do role change, `session_user` permanece
`<p034_provenance_login>`; após ele, `current_user` é `ltc_m_provenance_writer`. `session_user`
não é autoridade de negócio: `authorization_context()` e `set_actor_context(...)` continuam
determinando autorização humana. Em retry, a conexão é readquirida e toda a sequência é repetida;
nenhum role persistente é usado. COMMIT e ROLLBACK limpam `SET LOCAL ROLE` e o actor/request/source
transaction-local antes da reutilização da conexão (`PROVENANCE_POOL_SESSION_STATE_ISOLATED`).

O desenho não cria capability Auth0/P021 (`NO_NEW_P021_CAPABILITY_REQUIRED`), não cria endpoint
público (`P034_PROVENANCE_PUBLIC_ENDPOINT_DECISION_REQUIRED` não é necessário nesta etapa) e
preserva `captured_by_user_id = ltc_m.current_actor_id(true)`, o `request_id` do contexto e
`capture_source = 'api'`. A capability foi resolvida:

`P034_PROVENANCE_CAPABILITY_DECISION_RESOLVED`

### 7.4 Source hash e privilégios mínimos de leitura do writer

`source_artifact_hash` é redundante por decisão de rastreabilidade, mas nunca é aceito do caller
como valor independente. O writer lê `ltc_m.import_batches.source_hash` pelo `import_batch_id`,
exige hash não nulo/válido e verifica igualdade antes do insert. Um trigger futuro invoker
`p034_provenance_source_hash_matches_batch` repetirá a verificação no banco; se o batch não for
visível, o insert falha fechado. O batch P009 deve permanecer imutável, portanto não há janela
para alterar o hash depois da verificação.

Além das quatro tabelas P034, o writer requer somente `SELECT` em `ltc_m.projects` e
`ltc_m.import_batches`, sujeito a policies de leitura que reproduzam P008; requer EXECUTE nos
helpers P008 estritamente necessários. Esses privilégios não são implícitos pelo owner. O
writer não recebe INSERT/UPDATE/DELETE em projects, import_batches ou qualquer outro domínio.

Para autoridade, substitui-se o `FOR UPDATE` planejado por lock advisory transacional sem
privilégio DML:

`pg_advisory_xact_lock(hashtextextended('ltcm.p034.authority_revision/' || project_id::text, 0))`

O namespace inclui o nome da capability e o UUID textual do projeto. Uma colisão de hash
somente serializa projetos adicionais; não autoriza leitura cruzada nem altera o `project_id`
usado em FKs/RLS. Projetos são ordenados por UUID textual antes dos locks; o deadlock/serialization
retry repete a transação inteira. Só depois de todos os locks o writer calcula
`COALESCE(MAX(authority_revision), 0) + 1`, protegido por `UNIQUE(project_id,
authority_revision)`. `ltc_m.projects` não recebe UPDATE do writer.

## 8. Reader e derivação P034

O reader futuro valida no backend NestJS/Express o token Auth0 e as capabilities P021
(`active` + `data:read` + `financial:read` quando a resposta contiver dados financeiros). Em
transação de leitura, ele:

1. fixa o ator no contexto P008;
2. aplica autorização de projeto;
3. seleciona o latest SUCCESS por `authority_revision`;
4. lê somente fatos do snapshot autorizado;
5. reconstrói observações P015 mínimas e deriva os dois códigos P034;
6. normaliza achados com contrato v3;
7. combina-os com outras fontes autorizadas de `QualityFinding` sem persistir achados;
8. filtra, ordena e pagina;
9. retorna o contrato v3.

Sem snapshot autoritativo, a leitura falha fechado com indisponibilidade explícita; não retorna
zero findings como se qualidade estivesse limpa. Não há fallback para staging, snapshot antigo
não autorizado ou `IMPORT_DUPLICATION`.

### 8.1 Paridade de projeto

| caso                           | facts armazenados                | derivação                              |
| ------------------------------ | -------------------------------- | -------------------------------------- |
| um code, uma ocorrência        | uma linha                        | nenhum duplicate project               |
| mesmo code, duas distintas     | duas linhas                      | um `DUPLICATE_PROJECT_SOURCE_IDENTITY` |
| mesmo code, duas idênticas     | duas linhas, mesmo occurrence fp | um duplicate, cardinalidade preservada |
| codes distintos                | uma linha por code               | nenhum duplicate project               |
| code sem vínculo factual       | snapshot inelegível              | P034 não fabrica finding               |
| referências em ordem diferente | refs canônicas                   | mesmo finding ID P015                  |
| referência sensível            | captura rejeitada                | sem sanitização que mude ID            |

### 8.2 Paridade de item

| caso                                                | facts armazenados                | derivação                           |
| --------------------------------------------------- | -------------------------------- | ----------------------------------- |
| uma ocorrência por `project_code + source_line_key` | uma linha                        | nenhum duplicate item               |
| duas com mesma chave                                | duas linhas                      | um `DUPLICATE_ITEM_SOURCE_IDENTITY` |
| duas idênticas                                      | duas linhas, mesmo occurrence fp | um duplicate, sem colapso           |
| mesma linha em codes diferentes                     | linhas distintas                 | não duplica entre codes             |
| item sem projeto factual                            | não entra no snapshot            | sem atribuição arbitrária           |
| `item_id` nulo                                      | nulo preservado                  | paridade P015                       |
| refs repetidas                                      | ordinais distintos               | multiset preservado                 |

O shared primitive futuro só será refatorado se preservar semanticamente P015. Não se altera
`generateP015ReconciliationReport` nem se promete payload parcial onde o tipo exige
`P015ReconciliationInput`. A construção continua:

`p015-finding-v1:${sha256Canonical(material)}`.

As referências participam do material do finding; as referências armazenadas devem ser as mesmas
P015-safe, na mesma semântica canônica. Se limite técnico tornar isso impossível, a captura é
inelegível e não se cria silenciosamente ID novo.

### 8.3 Material exato dos dois findings

O código real cria `finding()` com o objeto completo sem `finding_id`, adiciona o contrato
`ltcm.p015.finding.v1`, copia os dois arrays de referências e calcula
`p015-finding-v1:${sha256Canonical(material)}`. Para os dois findings P034, a reconstrução
determinística é:

```json
{
  "contract": "ltcm.p015.finding.v1",
  "finding_code": "DUPLICATE_PROJECT_SOURCE_IDENTITY ou DUPLICATE_ITEM_SOURCE_IDENTITY",
  "severity": "ERROR",
  "domain": "duplicate_identity",
  "project_id": "project.project_id",
  "project_code": "project.project_code ou item.project_code",
  "item_id": "item.item_id ou null",
  "source_line_key": "item.source_line_key ou null",
  "competence_date": null,
  "metric": null,
  "currency_code": null,
  "expected_value": null,
  "observed_value": null,
  "delta": null,
  "source_references": "group.flatMap(source_references)",
  "database_references": [],
  "decision_reference": null,
  "blocking": false,
  "explanation": "texto literal P015 do código para a regra",
  "remediation_class": "investigate_duplicate"
}
```

Para projeto, `project = group[0]`, o agrupamento é `project_code`, a mensagem literal é
`Multiple source project identities resolve to ${code}.`; para item, o agrupamento é
`project_code + "\\0" + source_line_key`, o lookup é a primeira project observation daquele
code, `item = group[0]` e a mensagem é `Repeated project plus source_line_key identity.`.
O adapter deve gerar exatamente esses campos, incluindo arrays vazios, nulls, boolean e texto;
não pode usar dados mínimos ausentes para preencher defaults diferentes. Com a mesma sequência
P015 de observações/referências e o mesmo projeto base, o material e o finding ID são byte a
byte semanticamente equivalentes. Caso contrário, `P034_P015_FINDING_IDENTITY_DECISION_REQUIRED`.

`IMPORT_DUPLICATION_REMAINS_P015_ONLY`.

### 8.4 Binding ambíguo de project code

P015 aceita duas observações válidas com o mesmo `project_code` e `project_id` diferentes:
`projectCode()` valida o código, `nullableText()` aceita ambos os IDs e nenhum invariant de
P015 os proíbe. O pipeline P011/P012 pode produzir a ocorrência source antes de uma decisão de
binding, e o código P015 usa determinísticamente o primeiro elemento do grupo para o
`project_id` do finding; isso não torna o segundo vínculo falso.

Este design escolhe a alternativa **B**: o caso é possível em P015, mas é inelegível para um
envelope P034 single-project quando não há um único vínculo factual por `project_code`. A razão
já aprovada é o v3/D21: provenance deve ter isolamento factual por projeto e o envelope
`QualityFinding` exige projeto; D22 não autoriza atribuir o segundo fato ao primeiro. O writer
rejeita o snapshot inteiro desse escopo antes do insert, não escolhe `group[0]` para storage,
não fabrica projeto e não expõe finding P034. P015 continua podendo emitir seu finding original.

Projeto existente captura normalmente; projeto novo aguarda o commit que crie seu `project_id`;
não há FK para ID inexistente. Duplicidade source de projeto com um binding único captura todas
as ocorrências. Item rejeitado pelo domínio ainda pode ser capturado como observation textual,
pois não exige FK a `project_items`; sem projeto factual, aguarda ou rejeita o snapshot.

`P034_DUPLICATE_PROJECT_BINDING_DECISION_REQUIRED` não é emitido: a decisão B é suportada por
D21/D22 e é um boundary de elegibilidade, não uma nova decisão humana.

### 8.3 Paginação

Escolhe-se a alternativa **A: derive-then-page**. Primeiro se seleciona somente o latest
autorizado por projeto, deriva e deduplica semanticamente os findings conforme P015, e só então
aplica filtro, ordenação estável `(severity, code, project_id, item_id, source_line_key,
finding_id)` e `limit/offset` bounded. `totalItems` é o total desse conjunto autorizado e
derivado; não conta facts brutos, snapshots antigos, import duplicates ou projetos sem acesso.
Não se usa cursor que exponha existência de linha invisível.

Consulta conceitual set-based para todos os projetos autorizados, sem N+1:

```sql
SELECT DISTINCT ON (s.project_id)
       s.id, s.project_id, s.import_batch_id, s.snapshot_fingerprint,
       s.authority_revision, s.source_artifact_hash
  FROM ltc_m.p034_provenance_snapshots AS s
  JOIN ltc_m.projects AS p ON p.id = s.project_id
 WHERE s.status = 'success'
   AND EXISTS (
       SELECT 1 FROM ltc_m.authorization_context() AS ac
       WHERE ac.app_role = 'admin'
          OR (p.status = 'active' AND p.deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM ltc_m.clients AS c WHERE c.id = p.client_id))
   )
 ORDER BY s.project_id, s.authority_revision DESC;
```

Essa é a expressão P008 completa, sem helper novo nem permissão implícita. A seleção é
seguida por joins/CTEs dos quatro objetos P034 autorizados e pela derivação server-side.

Este bloco é consulta conceitual e não o pseudoddl de criação; o placeholder não autoriza SQL
executável nesta PR.

## 9. Referências e minimização

`locator` rejeita drive paths, `/home`, `/Users`, URLs HTTP(S), URLs PostgreSQL, senhas, tokens,
chaves privadas, `client_secret` e padrões já rejeitados por P015. A futura implementação ainda
aplica allowlist de referência estável, limite documentado e trim determinístico. Não registra
caminho local, query string sensível, header, credencial ou payload. Fingerprint só é calculado
sobre referência já sanitizada.

| tabela               | coluna                        | propósito              | P015 dependency           | authorization need   | sensitivity |
| -------------------- | ----------------------------- | ---------------------- | ------------------------- | -------------------- | ----------- |
| snapshots            | `id`                          | identidade do envelope | parent técnico            | RLS do projeto       | baixa       |
| snapshots            | `import_batch_id`             | rastrear artefato      | batch P009                | FK/RLS indireta      | média       |
| snapshots            | `project_id`                  | escopo factual/RLS     | project id P015           | autorização direta   | média       |
| snapshots            | `scope_type`                  | congelar escopo        | snapshot contract         | CHECK                | baixa       |
| snapshots            | `schema_version`              | evolução               | versão de observação      | leitura compatível   | baixa       |
| snapshots            | `source_artifact_hash`        | identidade do artefato | source_hash P009          | não expõe payload    | baixa       |
| snapshots            | `snapshot_fingerprint`        | replay/auditoria       | canonicalização P015      | resposta autorizada  | baixa       |
| snapshots            | `fingerprint_algorithm`       | interpretação hash     | sha256Canonical           | baixa                | baixa       |
| snapshots            | `source_observation_contract` | contrato entrada       | P015 v1                   | baixa                | baixa       |
| snapshots            | `status`                      | publicação SUCCESS     | latest authoritative      | RLS                  | baixa       |
| snapshots            | `authority_revision`          | seleção latest         | decisão P034              | RLS                  | baixa       |
| snapshots            | `captured_by_user_id`         | ator                   | P008 app user             | auditoria autorizada | média       |
| snapshots            | `request_id`                  | correlação             | P008 context              | suporte sem segredo  | média       |
| snapshots            | `capture_source`              | origem técnica         | P008 source               | controle writer      | baixa       |
| snapshots            | `captured_at`/`completed_at`  | tempos                 | não entram no ID          | observabilidade      | baixa       |
| project observations | `id`                          | ocorrência física      | nenhum finding persistido | RLS                  | baixa       |
| project observations | `snapshot_id`                 | parent                 | snapshot P034             | RLS                  | baixa       |
| project observations | `project_id`                  | vínculo factual        | project id P015           | autorização          | média       |
| project observations | `project_code`                | identidade origem      | project code P015         | dentro do projeto    | média       |
| project observations | `occurrence_ordinal`          | multiplicidade         | grupo P015                | baixa                | baixa       |
| project observations | `occurrence_fingerprint`      | prova ocorrência       | facts canônicos           | baixa                | baixa       |
| item observations    | `id`                          | ocorrência física      | nenhum finding persistido | RLS                  | baixa       |
| item observations    | `snapshot_id`                 | parent                 | snapshot P034             | RLS                  | baixa       |
| item observations    | `project_id`                  | vínculo factual        | project id P015           | autorização          | média       |
| item observations    | `project_code`                | parte identidade       | item key P015             | dentro do projeto    | média       |
| item observations    | `source_line_key`             | parte identidade       | item key P015             | dentro do projeto    | média       |
| item observations    | `item_id`                     | item opcional          | item id P015              | não autoriza         | média       |
| item observations    | `occurrence_ordinal`          | multiplicidade         | grupo P015                | baixa                | baixa       |
| item observations    | `occurrence_fingerprint`      | prova ocorrência       | facts canônicos           | baixa                | baixa       |
| source references    | `id`                          | referência física      | P015 reference            | RLS                  | baixa       |
| source references    | `project_id`                  | RLS/FK composta        | projeto factual           | autorização          | média       |
| source references    | parent IDs                    | associação             | source_references P015    | parent autorizado    | média       |
| source references    | `reference_ordinal`           | multiset canônico      | ordem P015                | baixa                | baixa       |
| source references    | `kind`                        | tipo                   | P015 source/database      | baixa                | baixa       |
| source references    | `locator`                     | localização segura     | P015 reference            | nunca segredo        | média       |
| source references    | `fingerprint`                 | integridade            | P015 reference            | baixa                | baixa       |

Não há cópia de `raw_payload`, `source_range`, nome de planilha, caminho, URLs integrais,
valores financeiros desnecessários, `database_references`, finding, explanation ou remediation.

`receipt_actual` fica explicitamente fora do universo funcional e estrutural: não há coluna,
FK, referência, índice, policy de leitura ou adapter P034 para seus IDs, status ou valores.

Também não existe qualquer armazenamento de `quality_findings`, `alerts`, `inconsistencies`,
`finding_status`, `acknowledgement`, `resolution`, `dismiss`, `owner` ou lifecycle. Findings
continuam derivados em memória e desaparecem quando o snapshot atual deixa de satisfazer a
regra.

## 10. Auditoria, observabilidade e retenção

`audit_log` permanece auditoria de ações, não armazenamento dos fatos. Não se duplica cada
ocorrência no audit log. Uma captura futura pode registrar evento mínimo — snapshot fingerprint,
projeto autorizado, batch, request, resultado e contagens — sem payload, referência sensível,
segredo, valor financeiro ou caminho.

Métricas: sucesso/falha, duração, quantidade de snapshots/ocorrências, replay conflicts,
rejeições e deadlock retries. Logs usam IDs, hashes e códigos redigidos.

Não existe purge automático, TTL, job ou cascade. A política de retenção permanece deferida.
O crescimento é append-only por import/projeto; particionamento/arquivamento futuro exigirá
revisão própria e não apagará fatos por conveniência.

## 11. Backfill, rollout e rollback

O diagnóstico é `NO_TRUSTWORTHY_BACKFILL`. O staging P009 contém lifecycle e payload bruto, mas
não garante observações P015-ready, refs seguras, vínculos factuais e duplicatas físicas.
Nenhum backfill histórico deve ser inferido ou marcado SUCCESS. A autoridade começa somente
após ativação explícita do writer.

Rollout futuro, sem execução nesta tarefa:

1. aprovar este design e o fingerprint do contrato;
2. preparar migration incremental 19, após confirmar que existem 18 migrations;
3. criar tipos/grants/policies/testes PostgreSQL;
4. implementar writer isolado e testes de atomicidade/concurrency/replay;
5. implementar shared primitive somente com paridade P015;
6. implementar reader e paginação autorizada;
7. integrar as quatro correções do PR #29 em revisão funcional própria;
8. revisão funcional final, merge/deploy e atualização autorizada do Master Control.

Nome sugerido para migration futura, não criado:
`2026..._add_p034_provenance_foundation.sql`.

Rollback futuro é não destrutivo: interrompe writer, preserva facts e faz o reader declarar
indisponibilidade. Não há `down` que remova fatos ou reverta para staging.

## 12. Pseudoddl de referência

O bloco seguinte é deliberadamente **não executável**. É SQL de referência nomeado e
sintaticamente plausível para uma future migration, com a capability já decidida; não deve ser
copiado para migrations sem revisão. O login e seu membership continuam sendo provisionamento
por ambiente, fora desta migration. Marcador:

`REFERENCE_PSEUDODDL_ONLY`

```sql
-- REFERENCE_PSEUDODDL_ONLY
-- NÃO EXECUTAR. NÃO É migration. A role é versionável futuramente; o
-- login/membership abaixo é ENVIRONMENT_PROVISIONING_ONLY.

CREATE TABLE ltc_m.p034_provenance_snapshots (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    import_batch_id uuid NOT NULL,
    project_id uuid NOT NULL,
    scope_type text NOT NULL DEFAULT 'project',
    schema_version smallint NOT NULL DEFAULT 1,
    source_artifact_hash text NOT NULL,
    snapshot_fingerprint text NOT NULL,
    fingerprint_algorithm text NOT NULL DEFAULT 'sha256-canonical-v1',
    source_observation_contract text NOT NULL DEFAULT 'ltcm.p015.reconciliation.v1',
    status text NOT NULL DEFAULT 'success',
    authority_revision bigint NOT NULL,
    captured_by_user_id uuid NOT NULL,
    request_id text,
    capture_source text NOT NULL DEFAULT 'api',
    captured_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz NOT NULL,
    CONSTRAINT pk_p034_provenance_snapshots PRIMARY KEY (id),
    CONSTRAINT uq_p034_snapshot_batch_project UNIQUE (import_batch_id, project_id),
    CONSTRAINT uq_p034_snapshot_project_revision UNIQUE (project_id, authority_revision),
    CONSTRAINT uq_p034_snapshot_fingerprint UNIQUE (snapshot_fingerprint),
    CONSTRAINT uq_p034_snapshot_id_project UNIQUE (id, project_id),
    CONSTRAINT fk_p034_snapshot_batch FOREIGN KEY (import_batch_id)
        REFERENCES ltc_m.import_batches(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p034_snapshot_project FOREIGN KEY (project_id)
        REFERENCES ltc_m.projects(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p034_snapshot_actor FOREIGN KEY (captured_by_user_id)
        REFERENCES ltc_m.app_users(id) ON DELETE RESTRICT,
    CONSTRAINT ck_p034_snapshot_scope CHECK (scope_type = 'project'),
    CONSTRAINT ck_p034_snapshot_schema CHECK (schema_version = 1),
    CONSTRAINT ck_p034_snapshot_artifact_hash CHECK (lower(source_artifact_hash) = source_artifact_hash AND source_artifact_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_p034_snapshot_fingerprint CHECK (lower(snapshot_fingerprint) = snapshot_fingerprint AND snapshot_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_p034_snapshot_algorithm CHECK (fingerprint_algorithm = 'sha256-canonical-v1'),
    CONSTRAINT ck_p034_snapshot_contract CHECK (source_observation_contract = 'ltcm.p015.reconciliation.v1'),
    CONSTRAINT ck_p034_snapshot_status CHECK (status = 'success'),
    CONSTRAINT ck_p034_snapshot_revision CHECK (authority_revision > 0),
    CONSTRAINT ck_p034_snapshot_request CHECK (request_id IS NULL OR (btrim(request_id) <> '' AND char_length(request_id) <= 200)),
    CONSTRAINT ck_p034_snapshot_source CHECK (capture_source = 'api'),
    CONSTRAINT ck_p034_snapshot_completed CHECK (completed_at >= captured_at)
);

CREATE INDEX ix_p034_snapshot_project_latest
    ON ltc_m.p034_provenance_snapshots (project_id, authority_revision DESC);
CREATE INDEX ix_p034_snapshot_batch_project
    ON ltc_m.p034_provenance_snapshots (import_batch_id, project_id);

CREATE TABLE ltc_m.p034_provenance_project_observations (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    snapshot_id uuid NOT NULL,
    project_id uuid NOT NULL,
    project_code text NOT NULL,
    occurrence_ordinal integer NOT NULL,
    occurrence_fingerprint text NOT NULL,
    CONSTRAINT pk_p034_project_observations PRIMARY KEY (id),
    CONSTRAINT uq_p034_project_observation_id_project UNIQUE (id, project_id),
    CONSTRAINT uq_p034_project_observation_ordinal UNIQUE (snapshot_id, occurrence_ordinal),
    CONSTRAINT fk_p034_project_observation_snapshot FOREIGN KEY (snapshot_id, project_id)
        REFERENCES ltc_m.p034_provenance_snapshots(id, project_id) ON DELETE RESTRICT,
    CONSTRAINT fk_p034_project_observation_project FOREIGN KEY (project_id)
        REFERENCES ltc_m.projects(id) ON DELETE RESTRICT,
    CONSTRAINT ck_p034_project_observation_code CHECK (project_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,63}$'),
    CONSTRAINT ck_p034_project_observation_ordinal CHECK (occurrence_ordinal > 0),
    CONSTRAINT ck_p034_project_observation_fingerprint CHECK (lower(occurrence_fingerprint) = occurrence_fingerprint AND occurrence_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX ix_p034_project_observation_identity
    ON ltc_m.p034_provenance_project_observations (snapshot_id, project_code, occurrence_ordinal);

CREATE TABLE ltc_m.p034_provenance_item_observations (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    snapshot_id uuid NOT NULL,
    project_id uuid NOT NULL,
    project_code text NOT NULL,
    source_line_key text NOT NULL,
    item_id text,
    occurrence_ordinal integer NOT NULL,
    occurrence_fingerprint text NOT NULL,
    CONSTRAINT pk_p034_item_observations PRIMARY KEY (id),
    CONSTRAINT uq_p034_item_observation_id_project UNIQUE (id, project_id),
    CONSTRAINT uq_p034_item_observation_ordinal UNIQUE (snapshot_id, occurrence_ordinal),
    CONSTRAINT fk_p034_item_observation_snapshot FOREIGN KEY (snapshot_id, project_id)
        REFERENCES ltc_m.p034_provenance_snapshots(id, project_id) ON DELETE RESTRICT,
    CONSTRAINT fk_p034_item_observation_project FOREIGN KEY (project_id)
        REFERENCES ltc_m.projects(id) ON DELETE RESTRICT,
    CONSTRAINT ck_p034_item_observation_code CHECK (project_code ~ '^[A-Z0-9][A-Z0-9._/-]{0,63}$'),
    CONSTRAINT ck_p034_item_observation_line CHECK (source_line_key ~ '^p012-line-v1:[0-9a-f]{64}$'),
    CONSTRAINT ck_p034_item_observation_id CHECK (item_id IS NULL OR (btrim(item_id) <> '' AND item_id = btrim(item_id))),
    CONSTRAINT ck_p034_item_observation_ordinal CHECK (occurrence_ordinal > 0),
    CONSTRAINT ck_p034_item_observation_fingerprint CHECK (lower(occurrence_fingerprint) = occurrence_fingerprint AND occurrence_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX ix_p034_item_observation_identity
    ON ltc_m.p034_provenance_item_observations (snapshot_id, project_code, source_line_key, occurrence_ordinal);
CREATE INDEX ix_p034_item_observation_project_identity
    ON ltc_m.p034_provenance_item_observations (project_id, project_code, source_line_key);

CREATE TABLE ltc_m.p034_provenance_source_references (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    project_observation_id uuid,
    item_observation_id uuid,
    reference_ordinal integer NOT NULL,
    kind text NOT NULL,
    locator text NOT NULL,
    fingerprint text NOT NULL,
    CONSTRAINT pk_p034_source_references PRIMARY KEY (id),
    CONSTRAINT fk_p034_source_reference_project FOREIGN KEY (project_id)
        REFERENCES ltc_m.projects(id) ON DELETE RESTRICT,
    CONSTRAINT fk_p034_source_reference_project_observation FOREIGN KEY (project_observation_id, project_id)
        REFERENCES ltc_m.p034_provenance_project_observations(id, project_id) ON DELETE RESTRICT,
    CONSTRAINT fk_p034_source_reference_item_observation FOREIGN KEY (item_observation_id, project_id)
        REFERENCES ltc_m.p034_provenance_item_observations(id, project_id) ON DELETE RESTRICT,
    CONSTRAINT ck_p034_source_reference_one_parent CHECK ((project_observation_id IS NOT NULL)::integer + (item_observation_id IS NOT NULL)::integer = 1),
    CONSTRAINT ck_p034_source_reference_kind CHECK (kind IN ('source', 'database')),
    CONSTRAINT ck_p034_source_reference_locator CHECK (btrim(locator) <> '' AND char_length(locator) <= 1024 AND locator !~* '(?:[A-Z]:\\\\|(?:^|\\s)/(?:home|Users)/|postgres(?:ql)?://|https?://|\\b(?:password|token|private_key|client_secret)\\s*=)'),
    CONSTRAINT ck_p034_source_reference_fingerprint CHECK (lower(fingerprint) = fingerprint AND fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_p034_source_reference_ordinal CHECK (reference_ordinal > 0)
);

CREATE UNIQUE INDEX uq_p034_source_reference_project_ordinal
    ON ltc_m.p034_provenance_source_references (project_observation_id, reference_ordinal)
    WHERE project_observation_id IS NOT NULL;
CREATE UNIQUE INDEX uq_p034_source_reference_item_ordinal
    ON ltc_m.p034_provenance_source_references (item_observation_id, reference_ordinal)
    WHERE item_observation_id IS NOT NULL;
CREATE INDEX ix_p034_source_reference_project
    ON ltc_m.p034_provenance_source_references (project_id, project_observation_id, reference_ordinal);
CREATE INDEX ix_p034_source_reference_item
    ON ltc_m.p034_provenance_source_references (project_id, item_observation_id, reference_ordinal);

CREATE ROLE ltc_m_provenance_writer
    NOLOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS
    NOINHERIT;
-- ENVIRONMENT_PROVISIONING_ONLY; não versionar nome real, password ou secret.
-- GRANT ltc_m_provenance_writer TO <p034_provenance_login>
--     WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
-- Nenhum membership é concedido ao ltc_m_runtime ou ao login de DATABASE_URL.

ALTER TABLE ltc_m.p034_provenance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_project_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_project_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_item_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_item_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_source_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_source_references FORCE ROW LEVEL SECURITY;

CREATE FUNCTION ltc_m.p034_provenance_reject_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
    RAISE EXCEPTION 'P034 provenance facts are immutable' USING ERRCODE = '55000';
END;
$function$;

CREATE FUNCTION ltc_m.p034_provenance_reject_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
    RAISE EXCEPTION 'P034 provenance facts cannot be deleted' USING ERRCODE = '55000';
END;
$function$;

CREATE FUNCTION ltc_m.p034_provenance_source_hash_matches_batch()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM ltc_m.import_batches AS b
        WHERE b.id = NEW.import_batch_id
          AND b.source_hash = NEW.source_artifact_hash
    ) THEN
        RAISE EXCEPTION 'P034 source artifact hash does not match import batch' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE FUNCTION ltc_m.p034_provenance_context_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
    IF NEW.captured_by_user_id IS DISTINCT FROM ltc_m.current_actor_id(true)
       OR NEW.request_id IS DISTINCT FROM NULLIF(current_setting('ltc_m.request_id', true), '')
       OR NEW.capture_source IS DISTINCT FROM current_setting('ltc_m.source', true)
       OR NEW.capture_source <> 'api' THEN
        RAISE EXCEPTION 'P034 provenance actor context mismatch' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE FUNCTION ltc_m.p034_project_observation_reference_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM ltc_m.p034_provenance_source_references AS r
        WHERE r.project_observation_id = NEW.id AND r.project_id = NEW.project_id
    ) THEN
        RAISE EXCEPTION 'P034 project observation requires source reference' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE FUNCTION ltc_m.p034_item_observation_reference_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM ltc_m.p034_provenance_source_references AS r
        WHERE r.item_observation_id = NEW.id AND r.project_id = NEW.project_id
    ) THEN
        RAISE EXCEPTION 'P034 item observation requires source reference' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_p034_snapshot_hash
    BEFORE INSERT ON ltc_m.p034_provenance_snapshots
    FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_source_hash_matches_batch();
CREATE TRIGGER trg_p034_snapshot_context
    BEFORE INSERT ON ltc_m.p034_provenance_snapshots
    FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_context_guard();

CREATE CONSTRAINT TRIGGER trg_p034_project_reference_cardinality
    AFTER INSERT ON ltc_m.p034_provenance_project_observations
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION ltc_m.p034_project_observation_reference_guard();
CREATE CONSTRAINT TRIGGER trg_p034_item_reference_cardinality
    AFTER INSERT ON ltc_m.p034_provenance_item_observations
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
    EXECUTE FUNCTION ltc_m.p034_item_observation_reference_guard();

CREATE TRIGGER trg_p034_snapshot_no_update BEFORE UPDATE ON ltc_m.p034_provenance_snapshots FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_reject_update();
CREATE TRIGGER trg_p034_snapshot_no_delete BEFORE DELETE ON ltc_m.p034_provenance_snapshots FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_reject_delete();
CREATE TRIGGER trg_p034_project_no_update BEFORE UPDATE ON ltc_m.p034_provenance_project_observations FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_reject_update();
CREATE TRIGGER trg_p034_project_no_delete BEFORE DELETE ON ltc_m.p034_provenance_project_observations FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_reject_delete();
CREATE TRIGGER trg_p034_item_no_update BEFORE UPDATE ON ltc_m.p034_provenance_item_observations FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_reject_update();
CREATE TRIGGER trg_p034_item_no_delete BEFORE DELETE ON ltc_m.p034_provenance_item_observations FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_reject_delete();
CREATE TRIGGER trg_p034_reference_no_update BEFORE UPDATE ON ltc_m.p034_provenance_source_references FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_reject_update();
CREATE TRIGGER trg_p034_reference_no_delete BEFORE DELETE ON ltc_m.p034_provenance_source_references FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_reject_delete();

CREATE POLICY p034_snapshots_runtime_select ON ltc_m.p034_provenance_snapshots
    FOR SELECT TO ltc_m_runtime USING (
        EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac
                WHERE ac.app_role = 'admin'
                   OR (ltc_m.p034_provenance_snapshots.status = 'success' AND EXISTS (
                       SELECT 1 FROM ltc_m.projects AS p
                       JOIN ltc_m.clients AS c ON c.id = p.client_id
                       WHERE p.id = ltc_m.p034_provenance_snapshots.project_id AND p.status = 'active' AND p.deleted_at IS NULL
                   )))
    );
CREATE POLICY p034_snapshots_writer_select ON ltc_m.p034_provenance_snapshots
    FOR SELECT TO ltc_m_provenance_writer USING (
        EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac
                WHERE ac.app_role IN ('editor', 'admin'))
        AND EXISTS (SELECT 1 FROM ltc_m.projects AS p
                    JOIN ltc_m.clients AS c ON c.id = p.client_id
                    WHERE p.id = ltc_m.p034_provenance_snapshots.project_id
                      AND (EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role = 'admin')
                           OR (p.status = 'active' AND p.deleted_at IS NULL)))
    );
CREATE POLICY p034_snapshots_writer_insert ON ltc_m.p034_provenance_snapshots
    FOR INSERT TO ltc_m_provenance_writer WITH CHECK (
        captured_by_user_id = ltc_m.current_actor_id(true)
        AND capture_source = current_setting('ltc_m.source', true)
        AND capture_source = 'api'
        AND request_id IS NOT DISTINCT FROM NULLIF(current_setting('ltc_m.request_id', true), '')
        AND EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac
                    WHERE ac.app_role IN ('editor', 'admin'))
    );

-- As três policies de observação e as duas de referência usam a mesma expressão direta:
-- authorization_context ativo, project_id factual, e o projeto P008 (admin ou
-- status active + deleted_at null + client existente). As policies INSERT acrescentam
-- current_actor_id(true), source api e consistência do snapshot/pai. Não há UPDATE/DELETE.
CREATE POLICY p034_project_observations_runtime_select ON ltc_m.p034_provenance_project_observations
    FOR SELECT TO ltc_m_runtime USING (EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role = 'admin' OR (EXISTS (SELECT 1 FROM ltc_m.projects AS p JOIN ltc_m.clients AS c ON c.id = p.client_id WHERE p.id = ltc_m.p034_provenance_project_observations.project_id AND p.status = 'active' AND p.deleted_at IS NULL))));
CREATE POLICY p034_item_observations_runtime_select ON ltc_m.p034_provenance_item_observations
    FOR SELECT TO ltc_m_runtime USING (EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role = 'admin' OR (EXISTS (SELECT 1 FROM ltc_m.projects AS p JOIN ltc_m.clients AS c ON c.id = p.client_id WHERE p.id = ltc_m.p034_provenance_item_observations.project_id AND p.status = 'active' AND p.deleted_at IS NULL))));
CREATE POLICY p034_source_references_runtime_select ON ltc_m.p034_provenance_source_references
    FOR SELECT TO ltc_m_runtime USING (EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role = 'admin' OR (EXISTS (SELECT 1 FROM ltc_m.projects AS p JOIN ltc_m.clients AS c ON c.id = p.client_id WHERE p.id = ltc_m.p034_provenance_source_references.project_id AND p.status = 'active' AND p.deleted_at IS NULL))));
CREATE POLICY p034_project_observations_writer_select ON ltc_m.p034_provenance_project_observations
    FOR SELECT TO ltc_m_provenance_writer USING (EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role IN ('editor', 'admin')));
CREATE POLICY p034_item_observations_writer_select ON ltc_m.p034_provenance_item_observations
    FOR SELECT TO ltc_m_provenance_writer USING (EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role IN ('editor', 'admin')));
CREATE POLICY p034_source_references_writer_select ON ltc_m.p034_provenance_source_references
    FOR SELECT TO ltc_m_provenance_writer USING (EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role IN ('editor', 'admin')));
CREATE POLICY p034_project_observations_writer_insert ON ltc_m.p034_provenance_project_observations
    FOR INSERT TO ltc_m_provenance_writer WITH CHECK (
        EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role IN ('editor', 'admin'))
        AND EXISTS (SELECT 1 FROM ltc_m.p034_provenance_snapshots AS s WHERE s.id = ltc_m.p034_provenance_project_observations.snapshot_id AND s.project_id = ltc_m.p034_provenance_project_observations.project_id)
        AND EXISTS (SELECT 1 FROM ltc_m.projects AS p JOIN ltc_m.clients AS c ON c.id = p.client_id WHERE p.id = ltc_m.p034_provenance_project_observations.project_id AND (EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role = 'admin') OR (p.status = 'active' AND p.deleted_at IS NULL)))
    );
CREATE POLICY p034_item_observations_writer_insert ON ltc_m.p034_provenance_item_observations
    FOR INSERT TO ltc_m_provenance_writer WITH CHECK (
        EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role IN ('editor', 'admin'))
        AND EXISTS (SELECT 1 FROM ltc_m.p034_provenance_snapshots AS s WHERE s.id = ltc_m.p034_provenance_item_observations.snapshot_id AND s.project_id = ltc_m.p034_provenance_item_observations.project_id)
        AND EXISTS (SELECT 1 FROM ltc_m.projects AS p JOIN ltc_m.clients AS c ON c.id = p.client_id WHERE p.id = ltc_m.p034_provenance_item_observations.project_id AND (EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role = 'admin') OR (p.status = 'active' AND p.deleted_at IS NULL)))
    );
CREATE POLICY p034_source_references_writer_insert ON ltc_m.p034_provenance_source_references
    FOR INSERT TO ltc_m_provenance_writer WITH CHECK (
        EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role IN ('editor', 'admin'))
        AND EXISTS (SELECT 1 FROM ltc_m.projects AS p JOIN ltc_m.clients AS c ON c.id = p.client_id WHERE p.id = ltc_m.p034_provenance_source_references.project_id AND (EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac WHERE ac.app_role = 'admin') OR (p.status = 'active' AND p.deleted_at IS NULL)))
        AND EXISTS (SELECT 1 FROM ltc_m.p034_provenance_snapshots AS s WHERE s.project_id = ltc_m.p034_provenance_source_references.project_id AND (s.id = (SELECT po.snapshot_id FROM ltc_m.p034_provenance_project_observations AS po WHERE po.id = ltc_m.p034_provenance_source_references.project_observation_id AND po.project_id = ltc_m.p034_provenance_source_references.project_id) OR s.id = (SELECT io.snapshot_id FROM ltc_m.p034_provenance_item_observations AS io WHERE io.id = ltc_m.p034_provenance_source_references.item_observation_id AND io.project_id = ltc_m.p034_provenance_source_references.project_id)))
    );

CREATE POLICY p034_writer_projects_select ON ltc_m.projects
    FOR SELECT TO ltc_m_provenance_writer USING (
        EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac
                WHERE ac.app_role = 'admin'
                   OR (projects.status = 'active' AND projects.deleted_at IS NULL
                       AND EXISTS (SELECT 1 FROM ltc_m.clients AS c WHERE c.id = projects.client_id)))
    );
CREATE POLICY p034_writer_batches_select ON ltc_m.import_batches
    FOR SELECT TO ltc_m_provenance_writer USING (
        EXISTS (SELECT 1 FROM ltc_m.authorization_context() AS ac
                WHERE ac.app_role IN ('editor', 'admin'))
    );

REVOKE ALL PRIVILEGES ON ltc_m.p034_provenance_snapshots FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ltc_m.p034_provenance_project_observations FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ltc_m.p034_provenance_item_observations FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ltc_m.p034_provenance_source_references FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION ltc_m.p034_provenance_reject_update() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION ltc_m.p034_provenance_reject_delete() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION ltc_m.p034_provenance_source_hash_matches_batch() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION ltc_m.p034_provenance_context_guard() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION ltc_m.p034_project_observation_reference_guard() FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION ltc_m.p034_item_observation_reference_guard() FROM PUBLIC;
GRANT USAGE ON SCHEMA ltc_m TO ltc_m_runtime, ltc_m_provenance_writer;
GRANT SELECT ON ltc_m.p034_provenance_snapshots, ltc_m.p034_provenance_project_observations, ltc_m.p034_provenance_item_observations, ltc_m.p034_provenance_source_references TO ltc_m_runtime;
GRANT SELECT, INSERT ON ltc_m.p034_provenance_snapshots, ltc_m.p034_provenance_project_observations, ltc_m.p034_provenance_item_observations, ltc_m.p034_provenance_source_references TO ltc_m_provenance_writer;
GRANT SELECT ON ltc_m.projects, ltc_m.import_batches TO ltc_m_provenance_writer;
GRANT EXECUTE ON FUNCTION ltc_m.set_actor_context(uuid, text, text, text, text, boolean) TO ltc_m_provenance_writer;
GRANT EXECUTE ON FUNCTION ltc_m.authorization_context() TO ltc_m_provenance_writer;
GRANT EXECUTE ON FUNCTION ltc_m.current_actor_id(boolean) TO ltc_m_provenance_writer;
-- Nunca conceder UPDATE, DELETE, TRUNCATE, REFERENCES ou EXECUTE dos triggers à aplicação.
-- Não usar ALTER DEFAULT PRIVILEGES amplo; ACLs P034 devem ser explícitos e revisados.
```

O pseudoddl não introduz uma função de captura `SECURITY DEFINER`. Se uma revisão futura
preferir função controlada, deverá especificar owner não-bypass, `search_path = ''`, schema
qualificado, validação de ator/capability, `REVOKE EXECUTE FROM PUBLIC` e proteção contra
SQL injection antes de substituir o writer invoker.

## 13. Threat model e controles

| ameaça                               | consequência               | controle                                                       |
| ------------------------------------ | -------------------------- | -------------------------------------------------------------- |
| reader fabrica fato                  | finding falso              | runtime sem INSERT; writer separado                            |
| writer usa projeto de outro cliente  | vazamento/contaminação     | actor context + RLS + FK factual                               |
| update de ocorrência                 | perda de evidência         | sem grant + FORCE RLS + trigger                                |
| delete/truncate                      | apagamento histórico       | grants revogados, owner separado, RESTRICT                     |
| staging raw payload copiado          | segredo/caminho exposto    | modelo mínimo dedicado                                         |
| unique pelo code/linha               | duplicate legítimo perdido | ordinal físico, sem unique semântico                           |
| retry duplica fatos                  | contagem inflada           | snapshot fp/replay + unique batch/projeto                      |
| retry remove duplicate legítimo      | perda de cardinalidade     | idempotência não deduplica ocorrências                         |
| scope misto                          | existence/count leakage    | single-project e RLS direta                                    |
| latest por timestamp                 | resultado instável         | revision sob lock + tie-break fp                               |
| MAX+1 concorrente                    | conflito de autoridade     | lock ordenado + unique                                         |
| referência sensível                  | vazamento de segredo       | validação P015 + allowlist                                     |
| import duplicate no P034             | regra fora do contrato     | nenhum import identity                                         |
| sem snapshot tratado como zero       | falso saudável             | fail closed                                                    |
| função definer abusável              | bypass RLS                 | writer invoker, sem definer nova                               |
| DDL fora de ltc_m                    | dano a outro sistema       | scanner/schema qualification                                   |
| backfill especulativo                | achado não comprovável     | `NO_TRUSTWORTHY_BACKFILL`                                      |
| runtime comprometido                 | forjar facts               | runtime sem INSERT; FORCE RLS                                  |
| writer comprometido                  | alterar domínio            | role sem UPDATE/DELETE; RLS factual                            |
| SET ROLE inseguro                    | escalation                 | nenhum SET no runtime; pool separado gated                     |
| membership indevido                  | assumir writer             | login dedicado, membership exclusivo, SET TRUE e NOINHERIT     |
| credential do pool normal vazada     | insert indevido em P034    | sem membership writer para runtime                             |
| credential do pool provenance vazada | insert indevido            | credential dedicada + role NOLOGIN + RLS/FORCE + actor context |
| SQL injection no caminho normal      | assumir writer             | `DATABASE_URL` nunca tem SET writer                            |
| SQL injection no caminho provenance  | ampliar mutação            | grants mínimos + RLS/FORCE + sem DML domínio                   |
| role/contexto persistente            | vazamento entre operações  | `SET LOCAL ROLE`, settings transaction-local e reset testado   |
| mesma credential nos dois pools      | bypass de isolamento       | validação rejeita URLs iguais                                  |
| pool errado injetado                 | writer usa runtime         | dependência explícita `P034_PROVENANCE_DATABASE_POOL`          |
| actor forjado                        | autoria falsa              | set_actor_context + current_actor_id                           |
| source hash forjado                  | replay/artefato falso      | trigger compara batch/source_hash                              |
| captured_by forjado                  | auditoria falsa            | NOT NULL + equality ao actor context                           |
| reference ausente                    | finding P015 inválido      | writer + deferred constraint trigger                           |
| drift de ordem canônica              | finding ID diferente       | comparators P015 + stable tie ordinal                          |
| coupling indevido P009               | rollback de import         | transações independentes por projeto                           |

O login nunca é owner e nunca recebe ACL funcional direta. `application_name` (`ltcm-api-p034-
provenance`) é somente observabilidade, não autorização. `NOBYPASSRLS`, `FORCE RLS`, role
`NOLOGIN/NOINHERIT` e ausência de membership do runtime compõem a barreira contra escalation.

## 14. Plano de testes PostgreSQL futuro

Nenhum teste remoto é executado por esta tarefa. A migration futura só poderá avançar após
testes locais versionados cobrirem:

1. schema e existência exclusiva em `ltc_m`;
2. tipos, NOT NULL, defaults e CHECKs de hash/escopo/estado/ordinal;
3. FKs compostas e `ON DELETE RESTRICT` para batch, projeto, usuário e pais;
4. unique batch/projeto, revision por projeto, snapshot fingerprint e ordinais;
5. ausência de unique que colapse projeto/item repetido;
6. referência com exatamente um pai e ordem por pai;
7. `ENABLE RLS` e `FORCE RLS` nas quatro tabelas;
8. viewer/editor autorizado lendo somente projeto visível;
9. admin lendo somente projetos permitidos pela regra;
10. projeto não autorizado não revela row, existência, count ou totalItems;
11. runtime não insere, atualiza, remove ou trunca;
12. writer exige ator válido, role, source correto e projeto autorizado;
13. writer falha em update/delete direto;
14. duplicate project com cardinalidade 2 deriva um finding;
15. duplicate item pela chave composta deriva um finding;
16. duplicate idêntico mantém duas linhas;
17. `IMPORT_DUPLICATION` não aparece em tabela/query P034;
18. retry idêntico é no-op e fingerprint diferente é conflito;
19. ordem de insert diferente produz mesmo snapshot/finding ID;
20. referências sensíveis são rejeitadas sem persistência;
21. cada falha deixa zero facts parciais;
22. connection drop/deadlock/serialization retenta a transação inteira;
23. concorrência no mesmo projeto produz revisions distintas e latest determinístico;
24. concorrência em projetos diferentes não mistura escopo;
25. sem snapshot autoritativo retorna indisponibilidade, nunca lista vazia saudável;
26. totalItems conta somente findings autorizados do latest;
27. logs/métricas não contêm payload, segredo, locator proibido ou valor desnecessário;
28. scanner rejeita DDL fora de `ltc_m` e grants públicos indevidos.

Casos específicos exigidos por esta revisão:

1. comparator P015 exato de project (`project_code + "\\0" + project_id` nullable);
2. comparator P015 exato de item (`project_code + "\\0" + source_line_key + "\\0" + item_id`);
3. references com locator igual e fingerprint diferente preservam ordem de entrada;
4. empate de comparator preserva stable tie order e `group[0]`;
5. finding ID de cada duplicidade é byte a byte igual ao P015;
6. project/item sem source reference são rejeitados no commit;
7. `project_code` usa regex P015 exata;
8. `source_line_key` usa regex P015 exata;
9. `item_id` nulo, string válida, vazia e não trimmed;
10. writer só pode assumir a role pelo mecanismo explicitamente aprovado;
11. runtime não pode assumir writer nem via membership implícito;
12. writer não pode UPDATE em `projects`;
13. advisory lock serializa sem privilégio UPDATE;
14. `captured_by_user_id` forjado é rejeitado;
15. source hash divergente do batch é rejeitado;
16. falha P034 não altera silenciosamente o resultado business P009;
17. predicados RLS reproduzem exatamente admin/status/deleted/client de P008;
18. batch multi-project mantém envelopes e retries independentes;
19. mesmo batch/projeto com mesmo fingerprint é replay no-op;
20. mesmo batch/projeto com fingerprint divergente é conflito sem mutação.

Casos obrigatórios da fronteira de capability e pool:

1. `<p034_provenance_login>` conecta pelo credential dedicado, mas não pelo
   `DATABASE_URL` normal;
2. antes de `SET LOCAL ROLE`, o login não insere provenance;
3. `SET LOCAL ROLE ltc_m_provenance_writer` funciona somente pela membership com
   `INHERIT FALSE, SET TRUE`;
4. `session_user` permanece o login dedicado e `current_user` passa a ser a capability;
5. `COMMIT` e `ROLLBACK` removem o role local;
6. o login normal/runtime não possui membership, INSERT ou capacidade de assumir a capability;
7. o writer não tem `BYPASSRLS`, não é owner e não atualiza/remove provenance ou domínio;
8. membership não concede `ADMIN` ao login e não permite membership transitiva inesperada;
9. URL ausente, malformada, sem password/username ou insegura em produção falha fechado;
10. `P034_PROVENANCE_DATABASE_URL === DATABASE_URL` é rejeitada;
11. a URL/credential do writer nunca aparece em browser env, logs ou repositório;
12. erro de configuração não derruba leitura quando o writer não está habilitado, mas bloqueia
    toda tentativa de captura sem fallback;
13. writer recebe explicitamente `P034_PROVENANCE_DATABASE_POOL`; injeção do pool normal falha;
14. connection/idle/statement timeouts são bounded, `application_name` é distinto e `close`
    encerra o lifecycle;
15. conexão reutilizada após sucesso/falha começa sem actor, request, source ou writer role
    residual;
16. retry readquire o pool e repete BEGIN/SET LOCAL ROLE/context/lock/replay integralmente;
17. `ltc_m_runtime` nunca pode assumir writer, mesmo com SQL injection no caminho normal;
18. provisioning do login/membership é externo à migration, sem password, secret ou nome real
    versionado;
19. `PUBLIC` não possui EXECUTE nas funções novas nem ACL funcional nas tabelas;
20. policies `TO ltc_m_provenance_writer` continuam aplicáveis depois do `SET LOCAL ROLE`;
21. `FORCE RLS` não é contornado pelo writer e o actor humano, não o login técnico, governa a
    autorização;
22. login provenance não recebe privilégios diretos que não estejam na capability.

## 15. Ledger de decisões técnicas

Estas são decisões técnicas do design, não substituem nem reabrem D16–D26.

| ID           | pergunta              | decisão                            | alternativas rejeitadas | autoridade      | razão                        | reversibilidade          | impacto              |
| ------------ | --------------------- | ---------------------------------- | ----------------------- | --------------- | ---------------------------- | ------------------------ | -------------------- |
| P034-DDL-D01 | onde guardar facts?   | Option P dedicada                  | staging S               | contrato + D01  | separação/imutabilidade      | alta antes migration     | quatro tabelas       |
| P034-DDL-D02 | qual escopo?          | single-project tipado              | mixed, `scope_key`      | D05/D17         | RLS/vínculo factual          | média                    | envelope por projeto |
| P034-DDL-D03 | publicar como?        | Model C, SUCCESS atômico           | pending/head mutável    | D08/D09         | commit é visibilidade        | média                    | sem pending          |
| P034-DDL-D04 | ordenar latest?       | revision + advisory xact lock      | timestamp/max sem lock  | PostgreSQL/P008 | least privilege/determinismo | média                    | lock hash namespace  |
| P034-DDL-D05 | granularidade?        | occurrence física + ordinal        | unique identidade       | D03/D11         | cardinalidade P015           | baixa                    | mais linhas          |
| P034-DDL-D06 | guardar P015 inteiro? | typed minimum                      | raw/full payload        | D01/D02         | minimização                  | alta                     | adapter futuro       |
| P034-DDL-D07 | item_id type?         | text nullable                      | UUID obrigatório        | contrato P015   | string/null exato            | alta                     | sem FK item          |
| P034-DDL-D08 | guardar refs?         | relação normalizada, kinds P015    | typed/JSON              | finding ID P015 | canonicalização/RLS          | média                    | quarta tabela        |
| P034-DDL-D09 | child RLS?            | project_id + FK composta           | parent-only join        | P008            | menor leakage                | média                    | coluna redundante    |
| P034-DDL-D10 | quem escreve?         | writer dedicado invoker, gated     | runtime/definer         | P008/D26        | menor attack surface         | bloqueada por capability | decisão necessária   |
| P034-DDL-D11 | dedupe?               | replay por snapshot fp             | unique occurrence       | D03/D11         | retry sem perder duplicate   | alta                     | conflict handling    |
| P034-DDL-D12 | histórico/backfill?   | append-only, sem purge/no backfill | purge/guess             | D04/D06         | evidência                    | baixa                    | crescimento          |
| P034-DDL-D13 | sem snapshot?         | fail closed                        | zero/fallback staging   | D05             | sem falso saudável           | alta                     | indisponibilidade    |
| P034-DDL-D14 | shared primitive?     | só refactor equivalente            | payload parcial/novo ID | P015 unchanged  | contrato preservado          | alta                     | paridade             |
| P034-DDL-D15 | refs mínimas?         | writer + constraint triggers       | somente check app       | P015 `length>0` | SUCCESS não inválido         | alta                     | trigger deferred     |
| P034-DDL-D16 | actor binding?        | captured actor/request/source      | caller-authored values  | P008 context    | autoria não forjável         | alta                     | actor NOT NULL       |
| P034-DDL-D17 | P009 boundary?        | transações independentes           | rollback P009 junto     | D16/D17         | não muda business import     | alta                     | retry P034 separado  |

As decisões abaixo são adições ao ledger, sem sobrescrever entradas existentes. Elas resolvem o
gate de capability que aparece historicamente em D10; D10 não é blocker ativo deste documento.

| ID           | questão                      | decisão congelada                                                                       | autoridade                          |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------- |
| P034-DDL-D18 | conexão do writer            | pool server-side dedicado `P034_PROVENANCE_DATABASE_POOL`, separado do reader           | `P034-D27` / `HUMAN_OWNER_DECISION` |
| P034-DDL-D19 | runtime pode assumir writer? | não; `ltc_m_runtime` e o login normal não têm membership, INSERT ou SET writer          | `P034-D28` / `HUMAN_OWNER_DECISION` |
| P034-DDL-D20 | natureza da role             | capability `NOLOGIN`, `NOINHERIT`, least-privilege, sem ownership/bypass/DML de domínio | `P034-D29` / `HUMAN_OWNER_DECISION` |
| P034-DDL-D21 | como assumir writer?         | login dedicado por ambiente, membership exclusiva e `SET LOCAL ROLE` transaction-local  | `P034-D30` / `HUMAN_OWNER_DECISION` |
| P034-DDL-D22 | credencial/provisioning      | `P034_PROVENANCE_DATABASE_URL` distinta, fail closed e login/membership fora do repo    | `P034-D31` / `HUMAN_OWNER_DECISION` |

## 16. Gate de revisão adversarial automatizada

Antes da migration, a revisão automatizada deve verificar fingerprint/caminho do contrato,
ausência de `IMPORT_DUPLICATION` e finding table, ausência de raw payload/segredo/path/URL,
cardinalidade e uniques, escopo/FKs/RLS/FORCE, grants, imutabilidade, locks, replay,
atomicidade, paridade P015, finding ID, pseudoddl não executável e ausência de alteração
funcional. Nesta revisão final, deve também verificar D27–D31, pool/credential distintos,
membership sem `INHERIT` e com `SET`, `SET LOCAL ROLE`, `session_user/current_user`, limpeza de
estado de sessão, ausência de membership/grants diretos ao runtime/login, fail-closed e
provisionamento externo.

Se passar, registrar:

`AUTOMATED_DESIGN_REVIEW_APPROVED`

Se falhar, registrar `AUTOMATED_DESIGN_REVIEW_CHANGES_REQUIRED`, corrigir a documentação e
repetir a revisão completa — não somente o teste que falhou.

## 17. Checklist de readiness

- [x] base main/origin main validada no merge SHA autorizado;
- [x] contrato v3 validado e não alterado;
- [x] P015/P009/P008 consultados para tipos, RLS, referências e lifecycle;
- [x] Opção S comparada à P nos dez critérios ordenados;
- [x] escopo single-project exato, sem `scope_key` opaco;
- [x] snapshot, project observations, item observations e references definidos;
- [x] cardinalidade física e identidade lógica separadas;
- [x] publicação atômica, latest, revision e lock definidos;
- [x] retry, replay, conflito, deadlock e failure matrix definidos;
- [x] vínculo factual e unresolved definidos;
- [x] P015 finding ID e referências preservados;
- [x] `IMPORT_DUPLICATION` fora do P034;
- [x] RLS/FORCE RLS, grants e imutabilidade congelados;
- [x] capability D27–D31 resolvida e completamente congelada;
- [x] pool/credential/login do writer separados do runtime reader;
- [x] runtime sem membership/INSERT e login sem grants funcionais diretos;
- [x] `SET LOCAL ROLE`, actor context e higiene de sessão documentados;
- [x] pseudoddl marcado não executável;
- [x] threat model, testes, backfill, rollout e rollback documentados;
- [x] no finding table e no import identity gate;
- [x] Master Control permanece `Não iniciada / 0%`;
- [x] nenhuma migration, DDL, DB remoto, deploy ou alteração funcional executada.

`P034_PROVENANCE_CAPABILITY_DECISION_RESOLVED`.

O resultado desta revisão final é:

`AUTOMATED_DESIGN_REVIEW_APPROVED`

`P034_PROVENANCE_DDL_DESIGN_REVIEW_APPROVED_READY_FOR_MERGE`.

O merge permanece deliberadamente não executado. O marker de readiness do HEAD anterior e os
gates `P034_PROVENANCE_CAPABILITY_DECISION_REQUIRED` e
`P034_PROVENANCE_DDL_DESIGN_REVIEW_CHANGES_REQUIRED` são somente histórico; o comentário formal
anterior continua válido para o HEAD anterior e não é apagado.
