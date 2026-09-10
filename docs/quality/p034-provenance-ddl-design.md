# P034 — Design formal de DDL para provenance

**Design ID:** `ltcm.p034.provenance-ddl-design.v1`<br>
**Contrato:** `ltcm.p034.quality.v3`<br>
**Fingerprint do contrato:** `3e1fc135c61634e759210e718ce04785de38e6be3b2c409468288df1d7a73117`<br>
**Status:** documentação para revisão formal; não é migration executável<br>
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

Marcadores desta entrega:

- `P034_PROVENANCE_DDL_DESIGN_READY_FOR_REVIEW`;
- `REFERENCE_PSEUDODDL_ONLY`;
- `RETRY_IDEMPOTENCY_DOES_NOT_DEDUP_SOURCE_OCCURRENCES`;
- `IMPORT_DUPLICATION_REMAINS_P015_ONLY`;
- `NO_TRUSTWORTHY_BACKFILL`.

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
vários envelopes no mesmo transaction, um por projeto. Não existe `scope_key` opaco, snapshot
misto ou escopo inferido de string. O escopo exato é:

`scope_type = 'project'` + `project_id` factual + `import_batch_id` + `source_artifact_hash`.

`project_code` de origem fica nas observações e não substitui a relação factual. Não há
`UNIQUE(snapshot_id, project_code)`: codes repetidos são precisamente o fato que P034 conserva.

### 4.1 Estado e publicação

Escolhe-se o **Modelo C**, em forma mínima: fatos imutáveis e uma linha imutável de
publicação/autoridade no envelope do snapshot. Não existe estado `pending` visível, update de
publicação nem tabela mutável de head.

Todos os inserts do envelope, ocorrências e referências ocorrem na mesma transação. O snapshot
com `status = 'success'` só se torna visível após o commit; transação abortada não deixa
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
| `captured_by_user_id`         | `uuid`        | nullable                        | FK `app_users(id)`, RESTRICT                     |
| `request_id`                  | `text`        | nullable                        | trim não vazio, no máximo 200                    |
| `capture_source`              | `text`        | NOT NULL                        | token curto em allowlist                         |
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

| coluna                   | tipo      | nulidade/default            | regra e finalidade                   |
| ------------------------ | --------- | --------------------------- | ------------------------------------ |
| `id`                     | `uuid`    | NOT NULL, gen_random_uuid() | PK física                            |
| `snapshot_id`            | `uuid`    | NOT NULL                    | FK composta ao snapshot, RESTRICT    |
| `project_id`             | `uuid`    | NOT NULL                    | FK `projects`, RESTRICT; autorização |
| `project_code`           | `text`    | NOT NULL                    | trim não vazio; identidade de origem |
| `occurrence_ordinal`     | `integer` | NOT NULL                    | `> 0`, posição determinística        |
| `occurrence_fingerprint` | `text`    | NOT NULL                    | SHA-256 lowercase, 64 hex            |

Constraints: `UNIQUE (snapshot_id, occurrence_ordinal)`, `UNIQUE (id, project_id)`, FK
`(snapshot_id, project_id)` para o envelope e índice
`(snapshot_id, project_code, occurrence_ordinal)`. Não há unique por code ou projeto.

O conjunto é o mínimo necessário para `DUPLICATE_PROJECT_SOURCE_IDENTITY`: código, vínculo
factual, multiplicidade e referências. Nome, cliente, moeda, contrato, saldo e valores não
participantes da regra não são copiados; o input P015 permanece completo fora desta persistência.

### 5.3 `ltc_m.p034_provenance_item_observations`

| coluna                   | tipo      | nulidade/default            | regra e finalidade                   |
| ------------------------ | --------- | --------------------------- | ------------------------------------ |
| `id`                     | `uuid`    | NOT NULL, gen_random_uuid() | PK física                            |
| `snapshot_id`            | `uuid`    | NOT NULL                    | FK composta ao snapshot, RESTRICT    |
| `project_id`             | `uuid`    | NOT NULL                    | FK `projects`, RESTRICT; autorização |
| `project_code`           | `text`    | NOT NULL                    | código P015 normalizado              |
| `source_line_key`        | `text`    | NOT NULL                    | identidade de linha, trim não vazio  |
| `item_id`                | `text`    | nullable                    | valor P015 sem conversão silenciosa  |
| `occurrence_ordinal`     | `integer` | NOT NULL                    | `> 0`, posição determinística        |
| `occurrence_fingerprint` | `text`    | NOT NULL                    | SHA-256 lowercase, 64 hex            |

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

| coluna                   | tipo      | nulidade/default            | regra e finalidade                  |
| ------------------------ | --------- | --------------------------- | ----------------------------------- |
| `id`                     | `uuid`    | NOT NULL, gen_random_uuid() | PK física                           |
| `project_id`             | `uuid`    | NOT NULL                    | FK `projects`, RESTRICT; RLS direta |
| `project_observation_id` | `uuid`    | nullable                    | FK composta opcional                |
| `item_observation_id`    | `uuid`    | nullable                    | FK composta opcional                |
| `reference_ordinal`      | `integer` | NOT NULL                    | `> 0`, ordem canônica               |
| `kind`                   | `text`    | NOT NULL, `source`          | CHECK exatamente `source`           |
| `locator`                | `text`    | NOT NULL                    | trim, limite e allowlist segura     |
| `fingerprint`            | `text`    | NOT NULL                    | SHA-256 lowercase, 64 hex           |

Constraints: XOR entre os dois pais (exatamente um não nulo), `kind = source`, FKs compostas
`(project_observation_id, project_id)` e `(item_observation_id, project_id)`, ambas RESTRICT;
unique parcial por pai+ordinal e índices por `(project_id, parent, reference_ordinal)`. Não há
referência `database`, pois o finding P034 usa somente `source_references`.

Referências idênticas mantêm ocorrências distintas por ordinal. A ordenação é `kind`,
`locator`, `fingerprint`, com o ordinal atribuído depois; nenhum unique colapsa o multiset.

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
| project `source_references`       | source references                  | persistir sanitizado, ordem/multiset  |
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
| item `source_references`          | source references                  | persistir sanitizado, ordem/multiset  |
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
- `capture_source ~ '^[a-z0-9][a-z0-9._:-]{0,63}$'`;
- `request_id IS NULL OR (btrim(request_id) <> '' AND char_length(request_id) <= 200)`;
- `project_code` e `source_line_key` com `btrim(value) <> ''`;
- `occurrence_ordinal > 0` e `reference_ordinal > 0`;
- `completed_at >= captured_at`;
- `locator` com trim não vazio, `char_length(locator) <= 1024`, sem drive path,
  `/home`, `/Users`, URL HTTP(S), URL PostgreSQL ou tokens/segredos reconhecíveis;
- referência com exatamente um parent ID e `kind = 'source'`.

O validador de locator deve ser compartilhado semanticamente com a rejeição P015. Um CHECK
adicional mais restritivo nunca pode transformar uma referência P015-safe em outro valor e gerar
um finding ID diferente; nesses casos o snapshot é inelegível.

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
chegar ao insert; e nenhuma referência P015 válida pode ser alterada silenciosamente.

Observação sem vínculo factual não é fabricada, atribuída a projeto arbitrário nem inserida
como P034. O snapshot daquele escopo falha fechado antes da transação; P015 pode reportar seu
resultado fora desta fundação. Não existe projeto pseudo ou fallback por code.

### 6.2 Ordenação e autoridade

O latest é selecionado por `ORDER BY authority_revision DESC, snapshot_fingerprint ASC` por
`project_id`. A revisão é alocada sob `SELECT ... FROM ltc_m.projects ... FOR UPDATE`, com
projetos bloqueados em ordem ascendente de UUID textual. Só depois do lock o writer calcula
`COALESCE(MAX(authority_revision), 0) + 1`; a unique `(project_id, authority_revision)` é
defesa adicional. Nunca se usa `MAX + 1` sem lock/constraint.

Ordenação canônica: projeto por `project_code`, `project_id`, referências; item por
`project_code`, `source_line_key`, `item_id` (null primeiro), referências; referência por
`kind`, `locator`, `fingerprint`. O ordinal é atribuído nesta ordenação e faz parte do material,
logo a ordem de insert não muda fingerprint nem perde duplicatas.

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
      "source_references": []
    }
  ],
  "item_observations": [
    {
      "ordinal": 1,
      "project_code": "<normalized>",
      "source_line_key": "<normalized>",
      "item_id": null,
      "source_references": []
    }
  ]
}
```

Arrays são canônicos, incluem multiplicidade e referências sanitizadas. Timestamps, UUIDs
técnicos das linhas, `authority_revision` e ordem de insert ficam fora. O occurrence fingerprint
usa `ltcm.p034.provenance-occurrence.v1` e não substitui o ordinal. Artifact hash, provenance
snapshot fp, P015 input/report/finding fps são conceitos distintos.

### 6.4 Idempotência e replay

Retry exato de `import_batch_id + project_id + snapshot_fingerprint` encontra o snapshot e
retorna sucesso sem novo envelope/fatos. Mesmo batch/projeto com fingerprint diferente falha
como conflito antes de mutar. Novo artefato usa novo batch.

`RETRY_IDEMPOTENCY_DOES_NOT_DEDUP_SOURCE_OCCURRENCES`.

Ocorrência física legítima repetida recebe linha e ordinal próprios, mesmo com occurrence fp
igual. Retry não cria nova linha. Em concorrência, a unique classifica replay exato ou conflito;
não há dependência da ordem de chegada.

### 6.5 Fluxo transacional

`source validated → normalized observations → capture material → fingerprint → actor/import/scope → transaction → concurrency guard → replay/idempotency → snapshot → project occurrences → item occurrences → refs → invariants → publish authority SUCCESS → commit`.

O writer usa papel dedicado `ltc_m_provenance_writer`, sem login persistente criado por esta
entrega, sem `BYPASSRLS`, e não o `ltc_m_runtime` reader. O serviço valida Auth0/ator, chama
`set_actor_context` conforme P008 e grava pelo writer. Todos os inserts ocorrem em uma transação.

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

Para `SELECT`, `INSERT` e `WITH CHECK`:

- `authorization_context()` deve devolver ator ativo;
- `admin` pode acessar projeto não apagado e seus dados;
- `viewer`/`editor` somente acessam projeto ativo, não apagado, cujo cliente está visível,
  conforme P008;
- writer exige `current_setting('ltc_m.source', true) = 'p034-provenance'` e ator
  `editor`/`admin`;
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
`SECURITY DEFINER`. Se o writer dedicado não puder ser isolado, parar com
`P034_PROVENANCE_CAPABILITY_DECISION_REQUIRED`, sem improvisar grants ao runtime.

Matriz operacional completa (aplica-se a cada uma das quatro tabelas; `—` significa privilégio
revogado/não aplicável):

| objeto              | papel                     | SELECT | INSERT | UPDATE | DELETE | REFERENCES | TRUNCATE | EXECUTE |
| ------------------- | ------------------------- | -----: | -----: | -----: | -----: | ---------: | -------: | ------: |
| cada tabela P034    | PUBLIC                    |      — |      — |      — |      — |          — |        — |       — |
| cada tabela P034    | `ltc_m_runtime`           |    sim |      — |      — |      — |          — |        — |       — |
| cada tabela P034    | `ltc_m_provenance_writer` |    sim |    sim |      — |      — |          — |        — |       — |
| cada tabela P034    | owner migration           |    sim |    sim |    sim |    sim |        sim |      sim |       — |
| funções de proteção | PUBLIC                    |      — |      — |      — |      — |          — |        — |       — |
| funções de proteção | runtime                   |      — |      — |      — |      — |          — |        — |       — |
| funções de proteção | writer                    |      — |      — |      — |      — |          — |        — |       — |
| funções de proteção | owner migration           |      — |      — |      — |      — |          — |        — |     sim |

O owner estrutural é a única exceção operacional e não deve ser usado pela aplicação. A tabela
de grants final também deverá revogar privilégios de sequences e de qualquer função auxiliar
não explicitamente necessária.

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

`IMPORT_DUPLICATION_REMAINS_P015_ONLY`.

### 8.3 Paginação

Escolhe-se a alternativa **A: derive-then-page**. Primeiro se seleciona somente o latest
autorizado por projeto, deriva e deduplica semanticamente os findings conforme P015, e só então
aplica filtro, ordenação estável `(severity, code, project_id, item_id, source_line_key,
finding_id)` e `limit/offset` bounded. `totalItems` é o total desse conjunto autorizado e
derivado; não conta facts brutos, snapshots antigos, import duplicates ou projetos sem acesso.
Não se usa cursor que exponha existência de linha invisível.

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
| source references    | `kind`                        | tipo                   | source P015               | baixa                | baixa       |
| source references    | `locator`                     | localização segura     | P015 reference            | nunca segredo        | média       |
| source references    | `fingerprint`                 | integridade            | P015 reference            | baixa                | baixa       |

Não há cópia de `raw_payload`, `source_range`, nome de planilha, caminho, URLs integrais,
valores financeiros desnecessários, `database_references`, finding, explanation ou remediation.

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

O bloco seguinte é deliberadamente **não executável**. É um contrato de intenção para uma
future migration; contém placeholders e comentários e não deve ser copiado para migrations sem
revisão. Marcador:

`REFERENCE_PSEUDODDL_ONLY`

```sql
-- REFERENCE_PSEUDODDL_ONLY
-- NÃO EXECUTAR. NÃO É migration. Nomes e detalhes exigem revisão final.

CREATE TABLE ltc_m.p034_provenance_snapshots (...);
ALTER TABLE ltc_m.p034_provenance_snapshots
  ADD CONSTRAINT ... FOREIGN KEY (import_batch_id)
  REFERENCES ltc_m.import_batches(id) ON DELETE RESTRICT;
ALTER TABLE ltc_m.p034_provenance_snapshots
  ADD CONSTRAINT ... FOREIGN KEY (project_id)
  REFERENCES ltc_m.projects(id) ON DELETE RESTRICT;
ALTER TABLE ltc_m.p034_provenance_snapshots
  ADD CONSTRAINT ... UNIQUE (import_batch_id, project_id);
ALTER TABLE ltc_m.p034_provenance_snapshots
  ADD CONSTRAINT ... UNIQUE (project_id, authority_revision);
CREATE UNIQUE INDEX ... ON ltc_m.p034_provenance_snapshots (snapshot_fingerprint);
CREATE INDEX ... ON ltc_m.p034_provenance_snapshots
  (project_id, authority_revision DESC, snapshot_fingerprint ASC);

CREATE TABLE ltc_m.p034_provenance_project_observations (...);
ALTER TABLE ltc_m.p034_provenance_project_observations
  ADD CONSTRAINT ... FOREIGN KEY (snapshot_id, project_id)
  REFERENCES ltc_m.p034_provenance_snapshots(id, project_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ... ON ltc_m.p034_provenance_project_observations
  (snapshot_id, occurrence_ordinal);
CREATE INDEX ... ON ltc_m.p034_provenance_project_observations
  (snapshot_id, project_code, occurrence_ordinal);

CREATE TABLE ltc_m.p034_provenance_item_observations (...);
ALTER TABLE ltc_m.p034_provenance_item_observations
  ADD CONSTRAINT ... FOREIGN KEY (snapshot_id, project_id)
  REFERENCES ltc_m.p034_provenance_snapshots(id, project_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ... ON ltc_m.p034_provenance_item_observations
  (snapshot_id, occurrence_ordinal);
CREATE INDEX ... ON ltc_m.p034_provenance_item_observations
  (snapshot_id, project_code, source_line_key, occurrence_ordinal);

CREATE TABLE ltc_m.p034_provenance_source_references (...);
ALTER TABLE ltc_m.p034_provenance_source_references
  ADD CONSTRAINT ... CHECK ((project_observation_id IS NOT NULL)::integer +
                             (item_observation_id IS NOT NULL)::integer = 1);
ALTER TABLE ltc_m.p034_provenance_source_references
  ADD CONSTRAINT ... FOREIGN KEY (project_observation_id, project_id)
  REFERENCES ltc_m.p034_provenance_project_observations(id, project_id) ON DELETE RESTRICT;
ALTER TABLE ltc_m.p034_provenance_source_references
  ADD CONSTRAINT ... FOREIGN KEY (item_observation_id, project_id)
  REFERENCES ltc_m.p034_provenance_item_observations(id, project_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX ... ON ltc_m.p034_provenance_source_references
  (project_observation_id, reference_ordinal) WHERE project_observation_id IS NOT NULL;
CREATE UNIQUE INDEX ... ON ltc_m.p034_provenance_source_references
  (item_observation_id, reference_ordinal) WHERE item_observation_id IS NOT NULL;

-- Todas as tabelas:
ALTER TABLE ltc_m.p034_provenance_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_project_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_project_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_item_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_item_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_source_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE ltc_m.p034_provenance_source_references FORCE ROW LEVEL SECURITY;

CREATE FUNCTION ltc_m.p034_provenance_reject_update() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ ... $$;
CREATE FUNCTION ltc_m.p034_provenance_reject_delete() RETURNS trigger
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ ... $$;
CREATE TRIGGER ... BEFORE UPDATE ON ltc_m.p034_provenance_snapshots
  FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_reject_update();
CREATE TRIGGER ... BEFORE DELETE ON ltc_m.p034_provenance_snapshots
  FOR EACH ROW EXECUTE FUNCTION ltc_m.p034_provenance_reject_delete();
-- Repetir proteção para os três filhos.

-- Policies devem usar authorization_context(), factual project_id e, para INSERT,
-- current_setting('ltc_m.source', true) = 'p034-provenance'.
CREATE POLICY ... ON ltc_m.p034_provenance_snapshots FOR SELECT TO ltc_m_runtime
  USING (/* projeto autorizado */);
CREATE POLICY ... ON ltc_m.p034_provenance_snapshots FOR INSERT TO ltc_m_provenance_writer
  WITH CHECK (/* ator editor/admin + source + projeto autorizado */);
-- Repetir SELECT/INSERT para observações e referências; não criar UPDATE/DELETE policies.

REVOKE ALL ON ltc_m.p034_provenance_snapshots FROM PUBLIC;
REVOKE ALL ON ltc_m.p034_provenance_project_observations FROM PUBLIC;
REVOKE ALL ON ltc_m.p034_provenance_item_observations FROM PUBLIC;
REVOKE ALL ON ltc_m.p034_provenance_source_references FROM PUBLIC;
REVOKE ALL ON FUNCTION ltc_m.p034_provenance_reject_update() FROM PUBLIC;
REVOKE ALL ON FUNCTION ltc_m.p034_provenance_reject_delete() FROM PUBLIC;
GRANT USAGE ON SCHEMA ltc_m TO ltc_m_runtime, ltc_m_provenance_writer;
GRANT SELECT ON ALL FOUR TABLES TO ltc_m_runtime;
GRANT SELECT, INSERT ON ALL FOUR TABLES TO ltc_m_provenance_writer;
-- Nunca conceder UPDATE, DELETE, TRUNCATE, REFERENCES ou EXECUTE à aplicação.
```

O pseudoddl não introduz uma função de captura `SECURITY DEFINER`. Se uma revisão futura
preferir função controlada, deverá especificar owner não-bypass, `search_path = ''`, schema
qualificado, validação de ator/capability, `REVOKE EXECUTE FROM PUBLIC` e proteção contra
SQL injection antes de substituir o writer invoker.

## 13. Threat model e controles

| ameaça                              | consequência               | controle                                   |
| ----------------------------------- | -------------------------- | ------------------------------------------ |
| reader fabrica fato                 | finding falso              | runtime sem INSERT; writer separado        |
| writer usa projeto de outro cliente | vazamento/contaminação     | actor context + RLS + FK factual           |
| update de ocorrência                | perda de evidência         | sem grant + FORCE RLS + trigger            |
| delete/truncate                     | apagamento histórico       | grants revogados, owner separado, RESTRICT |
| staging raw payload copiado         | segredo/caminho exposto    | modelo mínimo dedicado                     |
| unique pelo code/linha              | duplicate legítimo perdido | ordinal físico, sem unique semântico       |
| retry duplica fatos                 | contagem inflada           | snapshot fp/replay + unique batch/projeto  |
| retry remove duplicate legítimo     | perda de cardinalidade     | idempotência não deduplica ocorrências     |
| scope misto                         | existence/count leakage    | single-project e RLS direta                |
| latest por timestamp                | resultado instável         | revision sob lock + tie-break fp           |
| MAX+1 concorrente                   | conflito de autoridade     | lock ordenado + unique                     |
| referência sensível                 | vazamento de segredo       | validação P015 + allowlist                 |
| import duplicate no P034            | regra fora do contrato     | nenhum import identity                     |
| sem snapshot tratado como zero      | falso saudável             | fail closed                                |
| função definer abusável             | bypass RLS                 | writer invoker, sem definer nova           |
| DDL fora de ltc_m                   | dano a outro sistema       | scanner/schema qualification               |
| backfill especulativo               | achado não comprovável     | `NO_TRUSTWORTHY_BACKFILL`                  |

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

## 15. Ledger de decisões técnicas

Estas são decisões técnicas do design, não substituem nem reabrem D16–D26.

| ID           | pergunta              | decisão                            | alternativas rejeitadas | autoridade      | razão                      | reversibilidade      | impacto                |
| ------------ | --------------------- | ---------------------------------- | ----------------------- | --------------- | -------------------------- | -------------------- | ---------------------- |
| P034-DDL-D01 | onde guardar facts?   | Option P dedicada                  | staging S               | contrato + D01  | separação/imutabilidade    | alta antes migration | quatro tabelas         |
| P034-DDL-D02 | qual escopo?          | single-project tipado              | mixed, `scope_key`      | D05/D17         | RLS/vínculo factual        | média                | envelope por projeto   |
| P034-DDL-D03 | publicar como?        | Model C, SUCCESS atômico           | pending/head mutável    | D08/D09         | commit é visibilidade      | média                | sem pending            |
| P034-DDL-D04 | ordenar latest?       | revision lock + fp                 | timestamp/max sem lock  | PostgreSQL/P008 | determinismo               | média                | lock project           |
| P034-DDL-D05 | granularidade?        | occurrence física + ordinal        | unique identidade       | D03/D11         | cardinalidade P015         | baixa                | mais linhas            |
| P034-DDL-D06 | guardar P015 inteiro? | typed minimum                      | raw/full payload        | D01/D02         | minimização                | alta                 | adapter futuro         |
| P034-DDL-D07 | item_id type?         | text nullable                      | UUID obrigatório        | contrato P015   | string/null exato          | alta                 | sem FK item            |
| P034-DDL-D08 | guardar refs?         | relação normalizada source         | typed/JSON              | finding ID P015 | canonicalização/RLS        | média                | quarta tabela          |
| P034-DDL-D09 | child RLS?            | project_id + FK composta           | parent-only join        | P008            | menor leakage              | média                | coluna redundante      |
| P034-DDL-D10 | quem escreve?         | writer dedicado invoker            | runtime/definer         | P008/D26        | menor attack surface       | média                | provisionamento futuro |
| P034-DDL-D11 | dedupe?               | replay por snapshot fp             | unique occurrence       | D03/D11         | retry sem perder duplicate | alta                 | conflict handling      |
| P034-DDL-D12 | histórico/backfill?   | append-only, sem purge/no backfill | purge/guess             | D04/D06         | evidência                  | baixa                | crescimento            |
| P034-DDL-D13 | sem snapshot?         | fail closed                        | zero/fallback staging   | D05             | sem falso saudável         | alta                 | indisponibilidade      |
| P034-DDL-D14 | shared primitive?     | só refactor equivalente            | payload parcial/novo ID | P015 unchanged  | contrato preservado        | alta                 | paridade               |

## 16. Gate de revisão adversarial automatizada

Antes da migration, a revisão automatizada deve verificar fingerprint/caminho do contrato,
ausência de `IMPORT_DUPLICATION` e finding table, ausência de raw payload/segredo/path/URL,
cardinalidade e uniques, escopo/FKs/RLS/FORCE, grants, imutabilidade, locks, replay,
atomicidade, paridade P015, finding ID, pseudoddl não executável e ausência de alteração
funcional.

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
- [x] writer separado do runtime reader;
- [x] pseudoddl marcado não executável;
- [x] threat model, testes, backfill, rollout e rollback documentados;
- [x] no finding table e no import identity gate;
- [x] Master Control permanece `Não iniciada / 0%`;
- [x] nenhuma migration, DDL, DB remoto, deploy ou alteração funcional executada.

`P034_PROVENANCE_DDL_DESIGN_READY_FOR_REVIEW`
