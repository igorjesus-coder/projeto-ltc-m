# P011 / 1.11 — normalização local de clientes e projetos

## Estado e fronteira

O P011 lê somente os artefatos determinísticos P010, normaliza candidatos e produz um dry-run.
Ele não abre XLSX, não acessa rede ou banco, não executa SQL e não possui aplicação remota. A CLI
aceita `--apply` apenas para recusá-lo com `REMOTE_APPLY_NOT_AUTHORIZED`.

P011 termina em clientes/projetos. Itens, `source_line_key`, quantidades, preços, planejamento,
competências, Curva S, realizados, recebimentos, versões, Tableau e P012 não integram o plano.

## Contratos de entrada

São exigidos:

- `ltcm.p010.extraction-manifest.v1` e payload P009/P010 v1;
- workbook SHA-256
  `f805ea07155ec647eab8d7c0cb9e88bad578ceaa8674d48c5c219129023f9abf`;
- exatamente `project_values`, `monthly_revenue` e `curve_s` no staging;
- aba `Decisões Aprovadas` explicitamente ignorada;
- hashes de conteúdo, hashes de linha, contagens e zero erro estrutural válidos;
- warning `RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE` presente.

JSON/JSONL é tratado como não confiável. O leitor limita arquivo, linhas, texto e profundidade,
rejeita symlinks/arquivos não regulares, valida paths e nunca executa conteúdo da origem.

## Decisões revisadas D69

O input opcional `ltcm.p011.reviewed-resolutions.v1` é um JSON local estrito. Seus campos de topo
são `contract`, `normalizer_version`, `normalization_manifest_hash`, `p010_manifest_hash`,
`input_hash`, `snapshot_hash`, `candidate_set_hash` e `resolutions`. O binding
`ltcm.p011.review-binding.v1` é
calculado depois do snapshot opcional e antes de qualquer resolução, a partir da versão do
normalizador, manifesto P010, input canônico, hash do snapshot v3 completo e pares ordenados
`candidate_id`/`candidate_hash`. O snapshot é canonicalizado com objetos por chaves e cada array
ordenado pelo hash canônico de seus elementos; sua ordem incidental não altera o binding. Assim,
mudança semântica de origem, snapshot, versão ou candidato invalida a decisão antes de qualquer
mutação dos candidatos.

Cada resolução contém `type`, `candidate_id` e `candidate_hash`:

- `client_identity` aceita somente `identity.kind = create_new` ou `use_existing`; esta última
  exige UUID explícito de cliente e somente produz `no_op` quando o snapshot vinculado contém
  exatamente esse cliente, ativo, não excluído e com nome compatível com a chave do candidato.
  Snapshot vazio, UUID ausente ou registro incompatível falham fechados. A decisão só pode
  resolver candidato marcado exclusivamente como `CLIENT_MATCH_AMBIGUOUS`;
- `project` aceita somente `approved_name` e/ou `approved_status`. Nome deve estar em NFC, sem
  controles, trim ou whitespace divergente; status deve ser `draft`, `active`, `on_hold`,
  `completed` ou `cancelled`.

Campos desconhecidos, duplicidade, candidato/hash ausente, versão divergente, replay contra outro
binding e tentativa de alterar campo já decidido falham fechados. O contrato não possui campos de
moeda, valor, classificação, data ou lote. Portanto D02–D06, D38/D39, D40/D41, moeda, linhagem e
data não são sobrescrevíveis. Erro normativo existente continua bloqueando o candidato mesmo que
nome/status pendentes sejam aprovados.

Todas as resoluções são validadas antes de qualquer mutação; a aplicação ocorre em cópias e só
essas cópias seguem no pipeline após sucesso integral. Projetos resolvidos são reconciliados
novamente contra o mesmo snapshot vinculado antes da ação final. Resolução parcial mantém
`requires_review`; somente o preenchimento de todas as pendências permitidas torna o projeto
elegível. Quando fornecido, o dry-run inclui
`resolution-summary.json` sanitizado e hashes do documento/binding, nunca o conteúdo das decisões.
O `review_binding` passa a integrar o manifesto v2, por isso hashes de manifesto/artefatos gerados
após D69 mudam deterministicamente. Sem documento, ações e candidatos mantêm a semântica anterior.

```powershell
npm run ltcm:normalize-projects -- `
  --input-dir ".artifacts\p010-synthetic" `
  --output-dir ".artifacts\p011-synthetic" `
  --reviewed-resolutions "C:\caminho-local\reviewed-resolutions.json" `
  --strict
```

Documentos reais podem conter nomes e IDs empresariais: devem permanecer fora do Git, dos testes
e da documentação versionada. A D69 usa exclusivamente fixtures sintéticas e não produziu nova
evidência v2 com dados reais.

### Threat model da entrada local — D74/D75

O P011 permanece uma ferramenta local de dry-run: não acessa banco ou rede e recusa `--apply` com
`REMOTE_APPLY_NOT_AUTHORIZED`. O conteúdo de `reviewed-resolutions` é sempre não confiável. O
contrato, a versão, os limites, o binding, os hashes, os candidatos, os campos autorizados, a
leitura, o parse e as regras semânticas continuam validados de forma fail-closed.

A entrada é suportada somente em filesystem local, dentro de diretório privado e controlado pelo
operador. Nenhum diretório ancestral deve ser gravável por outro usuário não confiável. UNC/SMB,
mapped drive, network filesystem, cloud-sync e diretórios compartilhados não integram o ambiente
operacional suportado. O normalizador não deve ser executado elevado/como administrador, e o
operador deve evitar modificar o documento durante a execução.

O leitor rejeita URLs, UNC e device paths explicitamente informados, extensão divergente,
arquivo ausente ou não regular, entradas acima de 5 MiB e links finais/ancestrais presentes no
momento da validação. Essas proteções estáticas não garantem que o path permaneça local nem
impedem a substituição concorrente do arquivo ou de seus ancestrais depois da validação. Um
processo local com permissão de escrita na árvore pode explorar a janela TOCTOU entre a validação
baseada em path e a leitura. O risco foi identificado, classificado e aceito no threat model
parcial D74 sob as condições operacionais acima; não foi eliminado.

Administrador malicioso, malware com acesso ao processo/filesystem, host multiusuário hostil, CI
compartilhado e filesystems remotos estão fora da fronteira hostil obrigatória atual, não são
considerados seguros e exigem nova revisão antes de uso. O threat model também deve ser
obrigatoriamente reavaliado antes de CI/automação, host compartilhado, execução multiusuário,
suporte a network filesystem, integração com adapter, consulta ao destino, aplicação remota,
mutação de banco ou uso operacional com dados reais em ambiente não controlado. Validade
estrutural do documento, binding ao snapshot e existência futura no destino continuam conceitos
distintos.

## Schema auditado

O destino permanece o schema `ltc_m` existente:

- `clients`: PK `id`; `legal_name` e `display_name` obrigatórios; unicidade parcial somente por
  `tax_id` ativo; `row_version`, soft delete, auditoria, RLS forçada e delete físico bloqueado;
- `projects`: PK `id`; FK `client_id`; chave natural ativa por `upper(project_code)`; moeda por FK
  `base_currency`; `classification`, `status` e `contract_value` obrigatórios; D40 aceita
  `data_reference_date` nula somente com `legacy_import_batch_id` válido e preservado; `version`,
  soft delete, auditoria, RLS forçada e delete físico bloqueado;
- `currencies`: código ISO de três letras e `BRL` controlado/ativo;
- runtime: DML direto sujeito a RLS; não há RPC de upsert de cliente/projeto.

Nomes não são chave natural de cliente no banco. Por isso o P011 nunca faz upsert automático por
nome. Uma aplicação futura deverá receber correspondências/IDs revisados, operar em transação
serializável e abortar conflito; criar unicidade baseada em nome exigiria decisão e migration
próprias.

## Regras de clientes

A chave estrita aplica, nesta ordem: Unicode NFC, trim, colapso de whitespace e comparação
case-insensitive. Acentos, pontuação, símbolos, sufixos, palavras e números não são removidos.

O campo explícito `Cliente` é a única fonte automática. Sufixos terminais exatos `(demanda)`,
`(saldo)` ou `(contrato)` são separados como evidência de classificação, nunca como classificação
canônica. Possíveis variantes que compartilham a mesma família lexical geram somente sugestão
`ambiguous`; não ocorre fuzzy merge. Nome vazio é rejeitado. O relatório versionado expõe apenas
`client_ref` por hash, não nomes reais.

## Regras de projetos, moeda e valores

`project_code` recebe somente trim e deve obedecer `AAAA-NN-NNNNN`. O bruto e todas as
coordenadas permanecem na evidência; o espaço inicial de `2024-06-11837` é preservado. D03 mantém
`2024-10-12524` e `2025-07-14416` distintos.

Moeda vem exclusivamente da coluna `Moeda`, sem inferência por símbolo ou conversão. Ausência ou
mais de uma moeda rejeita somente o projeto dependente.

Valores preservam número bruto, round-trip decimal, texto formatado, formato, coordenada e hash.
Não há `toFixed`, arredondamento, soma de itens ou uso da Curva S. D02 mapeia exclusivamente
`164000` para `2026-04-16531` e rejeita `168000`. D04 preserva `369749.1735` somente como previsão
de recebimento/warning e marca `2024-02-10990` como `completed`; nunca o usa como contrato ou
faturamento. D05 mapeia valor de venda para `contract_total`. D06 mapeia ausência para
`full_contract`, demanda para `demand` e saldo para `opening_balance`, mantendo a evidência bruta.

O rótulo do resumo mistura código, cliente/unidade e descrição. Ele gera proposta rastreável de
`project_name`. D39 resolve o caso nominal decidido por código sem versionar nome empresarial no
relatório sanitizado. D38 mantém a data dos nove legados nula e associa todos ao mesmo lote
planejado determinístico. Um cliente ambíguo torna apenas seus projetos `rejected`.

## Snapshot, plano e persistência

`--existing-snapshot` usa `ltcm.p011.existing-snapshot.v3`. O parser converte explicitamente v1/v2
válidos em v3, com `import_batches` vazio; v1 com data nula continua rejeitado. A projeção local
v3 de cada lote contém somente `id`, `idempotency_key` e `source_hash`. Para reconciliar uma
referência `planned` com o UUID persistido de um projeto, deve existir exatamente um lote com o
UUID referenciado e exatamente uma correspondência conjunta da `idempotency_key` única e do
`source_hash` já presentes na referência planejada. A prova converte somente a cópia reconciliada
para referência `existing`; evidência ausente, divergente, arbitrária ou ambígua preserva conflito.
O objeto superior, moedas, clientes, projetos e cada lote são contratos runtime fechados e
reconstruídos somente com campos reconhecidos. `currencies.code`, já validado como três letras
ASCII maiúsculas, é único no snapshot; duplicatas são rejeitadas mesmo quando `active` diverge.
UUIDs de clientes e projetos são únicos por identidade UUID, sem distinguir caixa textual; UUIDs e
`idempotency_key` não nulos também são globalmente únicos em `import_batches`. Qualquer duplicidade
invalida o snapshot antes do hash ou da reconciliação, sem escolha, canonicalização ou deduplicação
silenciosa. A regra é aplicada igualmente ao snapshot v3 e às conversões válidas de v1/v2.
`parseExistingSnapshot` é o preflight normativo único e também é aplicado em runtime pelas APIs
programáticas exportadas antes de hash, binding, aplicação de resoluções ou equivalência de lineage.
Na aplicação programática direta, os hashes efetivos do snapshot e do conjunto de candidatos são
recalculados e comparados ao binding antes de cópias ou resoluções. `ClientCandidate` e
`ProjectCandidate` são contratos runtime fechados: cada objeto e suas estruturas aninhadas são
reconstruídos somente com campos reconhecidos. Depois do parse estrutural e antes de confiar no
hash, a barreira semântica deriva e exige as combinações de cliente `valid/insert`, `valid/no_op`,
`ambiguous/conflict` ou `rejected/rejected`. Clientes não rejeitados exigem `normalized_name` não
vazio em NFC, trim e whitespace canônicos e `match_key` derivada exatamente desse nome. Nome e
chave precisam conter ao menos uma letra ou um número Unicode; whitespace, controles `Cc`, formatos
`Cf`, marcas combinantes ou pontuação não constituem sozinhos uma identidade.
U+200B/U+200C/U+200D/U+2060 e controles bidi são, portanto, insuficientes. A
validação rejeita, sem remover ou reparar, a entrada composta somente por conteúdo invisível.
Conteúdo visível Unicode legítimo, inclusive português, grego e CJK, permanece válido. `no_op`
exige UUID que corresponda a exatamente um cliente ativo, não excluído e compatível no snapshot,
enquanto as demais combinações não aceitam `matched_client_id`. Estado `valid` não aceita
diagnóstico; os outros estados exigem ao menos um. Essa política interna de conteúdo utilizável não
é a política humana mais restritiva de `approved_name`, que continua rejeitando qualquer `Cc`/`Cf`
e mantém sua validação Unicode própria.

`ambiguous/conflict` não é aceito somente porque o caller declarou o estado — nem pode ser ocultado
declarando todos os membros como `valid/insert`. A família lexical e o estado esperado são derivados
para todos os ClientCandidates. O diagnóstico deve ser
exatamente `CLIENT_MATCH_AMBIGUOUS`, `possible_matches` deve ser uma lista não vazia, única e sem
autorreferência, e deve corresponder exatamente aos `client_ref` dos demais candidatos da mesma
família lexical calculada pelo normalizador. Como cada candidato lista os outros membros, uma
família legítima de dois clientes possui um match por candidato. `client_ref` também é único no
conjunto. `create_new` e `use_existing` operam somente depois dessa prova; a decisão limpa a lista
resolvida e o conjunto resultante inteiro é rederivado antes de elegibilidade ou summary.
`create_new` autoriza separar a identidade da família lexical, mas não ignora o snapshot: se já
existir match compatível, a decisão falha em vez de produzir outro insert. `use_existing` continua
exigindo o UUID único, ativo, não excluído e compatível.

O snapshot também determina a associação final de clientes sem decisão humana. Zero match permite
`valid/insert`; exatamente um match compatível ativo deriva `valid/no_op` e seu UUID; mais de um
match, ou match inativo/excluído, falha fechado com código sanitizado. Somente
`applyExistingSnapshot` pode reconstruir o estado pré-snapshot `insert` para `no_op` antes do
binding. Parser, binding e aplicação direta exigem que o estado recebido já coincida com essa
derivação.

Cada ação de projeto possui matriz semântica fail-closed antes do hash. `insert` exige nome mapeado,
associação ao candidato de cliente válido, moeda, classificação, status, valor e data ou lineage,
sem blocker normativo. `no_op` exige os mesmos campos finais e, nos entry points que recebem o
snapshot, correspondência única com projeto existente, cliente persistido e equivalência completa
de nome, associação, classificação, status, moeda, valor e lineage. O caller não pode declarar
`no_op` sem essa prova. `conflict` exige diagnóstico de conflito; `rejected` exige diagnóstico de
rejeição; `pending_decision` exige campo ainda pendente e não pode coexistir com condição de
rejeição ou conflito. Não há default permissivo.

Os diagnostics de projeto pertencem a uma taxonomia única (`conflict`, `rejection`, `pending` ou
`informational`) e códigos desconhecidos falham antes do hash. O conjunto obrigatório é derivado do
estado disponível — associação de cliente, moeda, classificação bruta, data, evidência financeira,
receipt e snapshot — e comparado canonicamente ao conjunto declarado. Ausência de diagnostic não
apaga uma causa. D02 deriva conflito sempre que `2026-04-16531` diverge de `164000`; D06 deriva a
classificação das classificações brutas e rejeita declaração incompatível ou combinação conflitante.
`PROJECT_DUPLICATE_CONFLICT` exige mais de um projeto ativo com o mesmo código no snapshot;
`PROTECTED_RECORD_CONFLICT` exige exatamente um projeto correspondente, candidate final completo e
divergência normativa real. Portanto, snapshot vazio não certifica `conflict`. Uma rejeição por
`PROJECT_CLIENT_UNRESOLVED` exige que a associação ao ClientCandidate esteja realmente ausente ou
inelegível; a mesma causa não pode ser declarada quando o cliente já está resolvido.
Como o Candidate não preserva evidence discriminante suficiente para provar se a moeda estava
ausente ou se havia mais de uma, ambos os fatos source-derived produzem o único diagnóstico
verdadeiro `PROJECT_CURRENCY_UNRESOLVED`. Os códigos anteriores `PROJECT_CURRENCY_MISSING` e
`PROJECT_CURRENCY_AMBIGUOUS` não pertencem mais à taxonomia certificável e não podem ser escolhidos
pelo caller.

A associação final aponta para o mesmo `candidate_id` e `match_key` do cliente e mantém `client_id`
coerente com `matched_client_id`. Para ações finais, todo diagnóstico é bloqueante salvo a allowlist
positiva: `RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE` é informativo, e
`PROJECT_DATA_REFERENCE_DATE_MISSING` só é não bloqueante quando existe lineage D38 válida. Assim,
diagnóstico desconhecido ou `PROJECT_CLASSIFICATION_PENDING` impede `insert`/`no_op`, enquanto uma
pendência permanece explicitamente `pending_decision`.

O valor de contrato, tanto em `ProjectCandidate` quanto em `ExistingSnapshot.projects`, usa um
único validador textual compatível com `numeric(20,2)`: decimal não negativo, sem sinal, expoente,
zeros iniciais ou lixo, com até 18 dígitos inteiros e uma ou duas casas quando houver fração. A
representação já canônica é preservada, sem `Number`, `parseFloat`, arredondamento ou reparo. Assim,
`0`, `0.00`, `1000.5` e `164000` são válidos; vazio, whitespace, `not-a-number`, `NaN`, `Infinity`,
`1e3`, `01`, `-1` e `1.230` falham antes do hash. A mesma regra alcança snapshots v1/v2 durante a
conversão explícita para v3. `createSnapshotHash` não certifica snapshot semanticamente inválido.

Somente depois dessas invariantes o `hash` declarado é tratado como não confiável e comparado ao
SHA-256 canônico efetivo de `{...candidate, hash: undefined}`. Portanto, recalcular corretamente o
hash não legitima conteúdo impossível. Candidato parcial, malformado, com campo extra ou alterado
mantendo o hash antigo falha fechado. IDs de candidato duplicados são rejeitados no namespace
conjunto de clientes e projetos, inclusive quando diferem somente por caixa. O gerador normativo
usa `client-` + 24 hexadecimais minúsculos derivados do SHA-256 canônico de
`{ entity: "client", match_key }`, ou `project-` + 24 hexadecimais minúsculos derivados de
`{ entity: "project", project_code }`. Cada tipo aceita somente seu prefixo e tamanho. Uppercase,
mixed-case, prefixo cruzado, tamanho ou alfabeto divergente são rejeitados, nunca convertidos com
`toLowerCase`; a comparação case-insensitive permanece como defesa adicional de unicidade.
Somente candidatos estrutural e semanticamente validados, em forma canônica, e seus hashes
recomputados formam o `candidate_set_hash`. O binding deve declarar
exatamente `ltcm.p011.review-binding.v1`, e binding e documento devem usar a constante runtime
`NORMALIZER_VERSION`; autocoerência entre valores fornecidos pelo caller não substitui essas fontes
nominais. `createReviewBinding` rejeita versão diferente da runtime. `matchProjectLineage` valida e
reconstrói integralmente o candidato, exige que o target seja exatamente um projeto do snapshot
canônico validado e somente então chama seu matcher interno não exportado. Esses campos integram
`snapshot_hash` e o binding anti-replay. O snapshot permite simular
cliente existente, projeto idêntico, conflito e registro protegido sem afirmar estado do banco
real. Destino omitido significa fixture vazia com catálogo BRL conhecido; suas contagens são
simulações, não inventário remoto.

Cada candidate final exige provenance mínima já produzida pelo pipeline: nomes/códigos brutos
compatíveis, ao menos uma origem, um único workbook por candidate e evidência `mapped` coerente com
o valor contratual. Lineage `planned` deve vincular `source_manifest_hash` ao candidate e
`source_hash` ao workbook das origens. Todos os candidates do conjunto usam o mesmo manifesto, e
`createReviewBinding`/`applyReviewedResolutions` o comparam ao `p010_manifest_hash` disponível.
Essa coerência estrutural, isoladamente, não prova a veracidade da origem. A fronteira factual usa
uma capability runtime guardada em `WeakMap`: depois de validar manifesto, relatórios, input hashes,
row hashes e linhas, `loadP010Source` cria uma única materialização canônica privada e frozen desses
fatos e a associa à identidade do `LoadedSource` retornado. O fingerprint é calculado sobre essa
materialização. `normalizeP011` obtém dela uma view de leitura nova e deriva dessa mesma autoridade
privada todos os candidates, origins, evidence, classificação, moeda, valores e diagnostics. O Map e
os objetos expostos publicamente continuam disponíveis para compatibilidade e inspeção, mas não são
mais autoridade certificadora: substituir `rows`, `get`, `entries` ou qualquer conteúdo nested depois
do loader não muda os fatos consumidos pelo pipeline. A view derivada não recebe a identidade
registrada e não pode ser reapresentada como `LoadedSource` source-proven.

Depois da reconciliação, o pipeline emite internamente uma segunda capability vinculada ao P010,
input, snapshot e fingerprint exato do candidate set. Essa capability não integra nenhum objeto
retornado e não pode ser reconstruída por propriedade, cast, spread, `Object.assign`, JSON ou
SHA-256 recalculado. Hash de candidate prova somente integridade do objeto correspondente, nunca a
autoridade factual da fonte. O risco TOCTOU de filesystem descrito abaixo permanece separado: a
materialização privada isola mutações runtime posteriores ao loader, não substitui as condições
operacionais aplicadas durante a leitura dos arquivos.

`applyExistingSnapshot`, `createReviewBinding` e `applyReviewedResolutions` reutilizam as mesmas
barreiras estrutural, canônica e de derived state antes de reconciliar, vincular ou aplicar decisões. Elas
rejeitam hash declarado divergente, hash corretamente recalculado sobre semântica inválida,
candidato parcial, campo extra, ID não canônico/duplicado, `no_op` sem prova e `insert` com blocker
antes de qualquer transição. O helper pré-reconciliação aceita somente a diferença snapshot-dependent
que `applyExistingSnapshot` está prestes a reconstruir e não pode gerar binding. Essa função
continua sendo somente reconciliação estrutural/snapshot-dependent: seu resultado não recebe
provenance por transitividade. Somente o pipeline contextual pode emitir a capability exigida por
binding e aplicação. Os candidatos
resultantes de reconciliação/resolução passam novamente pela derivação global antes de summary ou
plano. A reconciliação ocorre em cópias canônicas, cujos
hashes somente são atualizados depois de uma transição válida.

A remoção de um diagnostic não é prova autônoma de resolução. Depois de `create_new`,
`use_existing`, `approved_name` ou `approved_status`, associação, diagnostics, snapshot e action
são novamente derivados ou conferidos pela mesma barreira. Conflitos de snapshot são recalculados
contra o snapshot vinculado; blockers restantes preservam `rejected`/`pending_decision`; `insert`
somente surge quando todas as condições finais derivadas voltam a passar. A ordem é parse fechado,
derivação factual, comparação declared-versus-derived, hash do candidate, candidate-set hash e
binding. Após decisões, a mesma derivação ocorre sobre o conjunto resultante completo.

O pipeline completo deriva manifesto P010 e `input_hash` da fonte efetivamente lida. A API
`parseValidatedCandidateSet` continua útil para schema, semântica e coerência interna, mas seu nome
não implica source provenance e seu resultado não é bindable. `createReviewBinding` e
`applyReviewedResolutions` rejeitam chamadas programáticas sem a capability interna, mesmo quando
todos os campos e hashes são matematicamente corretos. Contrato nominal, versão runtime, snapshot e
candidate set permanecem verificados de forma independente antes dessa barreira. Hash de candidate
prova somente integridade do objeto; binding somente é emitido depois da prova factual contextual.

A fronteira `LtcmPersistencePort` v2 exige transação serializável e ordem lote → clientes →
projetos. A referência tipada `existing` carrega UUID validado; `planned` carrega chave,
idempotency key e hashes, sem fingir UUID final. Um adapter futuro deve resolver o lote antes dos
projetos, na mesma transação. O preparador recusa data nula sem linhagem, UUID inválido e chave
planejada vazia. Não há adapter, driver ou conexão.

D41 não adiciona lógica remota ao P011: ela é uma invariável do banco. O plano `existing`/`planned`
continua determinístico, mas documenta que um lote resolvido e referenciado não pode ser rejeitado
livremente. Correção troca a referência por outro lote permitido; nunca a remove.

## Artefatos e determinismo

O diretório gerenciado P011 contém manifesto, validação da fonte, candidatos JSONL, evidências,
divergências, plano, resumo, hashes e relatório sanitizado. Escrita é atômica e só substitui um
diretório com marcador P011 válido. A saída deve ser subdiretório de `.artifacts`.

Mesma entrada, snapshot, versão e `--generated-at` produzem os mesmos bytes. O padrão temporal é
`1970-01-01T00:00:00.000Z`; temporários de escrita não entram nos artefatos/hashes.

```powershell
npm run ltcm:normalize-projects -- `
  --input-dir ".artifacts\p010-real-run-a" `
  --output-dir ".artifacts\p011-dry-run" `
  --strict
```

Uma futura aplicação no projeto compartilhado depende de autorização específica, snapshot do
destino, resolução humana, papel/contexto P007/P008, transação, rollback lógico, execução única,
reconciliação e garantia de zero alteração fora de `ltc_m`.

## Diagnósticos estruturados

O catálogo inclui `CLIENT_NAME_MISSING`, `CLIENT_MATCH_AMBIGUOUS`,
`CLIENT_SOURCE_FIELD_AMBIGUOUS`, `PROJECT_CODE_INVALID`, `PROJECT_DUPLICATE_CONFLICT`,
`PROJECT_CLIENT_UNRESOLVED`, `PROJECT_CURRENCY_UNRESOLVED`,
`PROJECT_VALUE_CONFLICT`, `PROJECT_CLASSIFICATION_CONFLICT`,
`PROJECT_DATA_REFERENCE_DATE_MISSING`, `PROTECTED_RECORD_CONFLICT`,
`RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE`, `REMOTE_APPLY_NOT_AUTHORIZED`,
`P010_INPUT_HASH_MISMATCH` e `P009_CONTRACT_MISMATCH`. Mensagens nunca são o identificador único.
