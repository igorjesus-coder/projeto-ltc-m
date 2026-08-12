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
normalizador, manifesto P010, input canônico, hash do snapshot v2 completo e pares ordenados
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

`--existing-snapshot` usa `ltcm.p011.existing-snapshot.v2`. O parser converte explicitamente v1
válido em v2, atribuindo linhagem nula somente quando a data existe; v1 com data nula é rejeitado.
Ele permite simular
cliente existente, projeto idêntico, conflito e registro protegido sem afirmar estado do banco
real. Destino omitido significa fixture vazia com catálogo BRL conhecido; suas contagens são
simulações, não inventário remoto.

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
`PROJECT_CLIENT_UNRESOLVED`, `PROJECT_CURRENCY_MISSING`, `PROJECT_CURRENCY_AMBIGUOUS`,
`PROJECT_VALUE_CONFLICT`, `PROJECT_CLASSIFICATION_CONFLICT`,
`PROJECT_DATA_REFERENCE_DATE_MISSING`, `PROTECTED_RECORD_CONFLICT`,
`RECEIPT_FORECAST_PRESENT_IN_MONTHLY_SOURCE`, `REMOTE_APPLY_NOT_AUTHORIZED`,
`P010_INPUT_HASH_MISMATCH` e `P009_CONTRACT_MISMATCH`. Mensagens nunca são o identificador único.
