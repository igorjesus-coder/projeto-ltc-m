# P011-VAL — matriz de cobertura sintética

As fixtures são JSON/JSONL sintéticos criados em diretórios temporários. Nenhum workbook ou nome
empresarial real integra a suíte.

| Área         | Cobertura                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Contrato     | P009/P010 v1 válido, hash do workbook, hash inválido, contrato inválido, JSONL corrompido, aba ausente/documental |
| Clientes     | NFC, trim, whitespace, caixa, acento, pontuação, sufixo, chave determinística, exato, ambíguo, ausente e snapshot |
| Projetos     | nove códigos, espaço inicial, duplicidade física idêntica, D03, D02=164000, rejeição de 168000, D04=369749.1735   |
| Referências  | moeda explícita/ausente, cliente resolvido/ausente, projeto idêntico, conflito e registro protegido               |
| Fronteiras   | zero item/competência/Curva S/P012, `--apply` bloqueado, saída segura, diretório não gerenciado                   |
| Persistência | transação serializável, clientes antes de projetos, resultado por registro, zero delete/bypass RLS                |
| Determinismo | objetos/hashes idênticos e artefatos A/B byte a byte                                                              |
| D69 binding  | contrato v1, manifesto/input/candidate set, candidato/hash, replay, duplicidade e campos não autorizados          |
| D69 decisões | identidade de cliente, nome/status de projeto, parcial/completa, erro normativo e preservação D02–D06/D38–D41     |
| D69 entrada  | JSON local, ausente/inválido, limite, URL/UNC/device recusados, links estáticos, `--apply` bloqueado, zero rede   |

Resultado local D40: 16 testes/casos Node, incluindo D02–D06, D38/D39, P012 bloqueado e bytes
canônicos, todos aprovados antes dos gates integrais.

A D69/D71 amplia a mesma suíte para 36 testes/casos Node com fixtures exclusivamente sintéticas
para o contrato `ltcm.p011.reviewed-resolutions.v1`. A D71 cobre snapshot canônico no binding,
`use_existing` comprovado/ausente/incompatível, reconciliação pós-resolução, preflight atômico,
HTTP/HTTPS, `file://`, UNC/device paths, arquivo acima de 5 MiB e symlinks/junctions
finais/ancestrais presentes no momento da validação. Essa cobertura comprova somente as proteções
estáticas implementadas; não afirma eliminação da janela TOCTOU contra substituição concorrente.
O documento real futuro permanece fora do Git.

A D92 eleva a suíte para 50 testes/casos Node. A regressão invoca `applyExistingSnapshot`
diretamente e comprova a mesma validação integral, rejeição de hash antigo, candidatos parciais,
extras, tipos/lineage inválidos e IDs duplicados em todas as combinações, preservando input,
candidate set e comportamento válido.
Nenhuma evidência v2 com dados reais, conexão, adapter ou operação de banco foi criada.

A D80 eleva a suíte para 43 testes/casos Node e acrescenta regressões sintéticas para a prova planned → persisted por
`idempotency_key`/`source_hash`, `no_op` D38, lote divergente/ausente/arbitrário/ambíguo,
invalidação do `snapshot_hash`, replay, clientes duplicados/inativos/excluídos e rejeição de
controles Unicode `Cc`/`Cf`, preservando nomes Unicode legítimos.

A D84 eleva a suíte para 44 testes/casos Node. A regressão adicional invoca diretamente, sem CLI
ou arquivo, as APIs programáticas de hash, binding, aplicação e equivalência e comprova que todas
executam o mesmo preflight runtime antes de aceitar snapshot ou produzir resultado.

A D86 eleva a suíte para 46 testes/casos Node. As regressões adicionais comprovam que a aplicação
direta rejeita binding de outro snapshot e conjunto de candidatos antes de mutação ou summary, e
que moedas, clientes e projetos malformados são recusados em runtime por todas as APIs públicas.

A D88 eleva a suíte para 48 testes/casos Node. As regressões fecham os bypasses de project/target
arbitrários e planned incompleto no matcher público, exigem target pertencente ao snapshot
canônico e ancoram binding/documento no contrato nominal e em `NORMALIZER_VERSION`, inclusive
contra contract `invalid.binding.v9` e versão autocoerente `9.9.9`, antes de mutação ou summary.

A D90 eleva a suíte para 49 testes/casos Node. A regressão reproduz diretamente o bypass D89 e
comprova, em `createReviewBinding` e `applyReviewedResolutions`, validação runtime integral de
clientes/projetos, recomputação do hash sem o campo `hash`, rejeição de divergência semântica com
hash antigo, candidatos parciais/extras/malformados e IDs duplicados, sem mutação ou summary.

A D94 eleva a suíte para 51 testes/casos Node. A regressão reproduz o bypass D93 com hashes
corretamente recalculados e comprova que nome/chave vazios ou não canônicos, combinações
status/action/identidade impossíveis e valores monetários não canônicos falham antes de binding,
reconciliação ou summary. A mesma regra monetária rejeita snapshots v1/v2/v3 inválidos antes de
`createSnapshotHash`, preserva valores válidos e não modifica as entradas. Um `valid/no_op` somente
passa com correspondência única, ativa, não excluída e compatível no snapshot.

A D96 eleva a suíte para 52 testes/casos Node. A regressão comprova que identidades internas
compostas somente por `Cc`/`Cf`, inclusive U+200B/U+200C/U+200D/U+2060 e controles bidi, falham nas
três APIs antes de binding ou summary, enquanto português, grego, CJK e conteúdo visível legítimo
permanecem válidos. Projeto `insert` incompleto com hash correto falha antes do candidate set;
projeto elegível passa. IDs de candidatos duplicados exatos, cross-type ou variantes de caixa são
rejeitados, assim como UUIDs duplicados exatos/case-variant de clientes e projetos do snapshot,
sem deduplicação ou reparo silencioso.

A D98 eleva a suíte para 53 testes/casos Node e fecha os quatro achados da D97. IDs de candidato
aceitam somente `client-`/`project-` mais 24 hexadecimais minúsculos e continuam únicos no namespace
conjunto. A matriz cobre `insert`, `no_op`, `conflict`, `pending_decision` e `rejected`: `no_op`
exige equivalência comprovada no snapshot, `insert` rejeita diagnostics pendentes/desconhecidos e
preserva apenas warnings explicitamente informativos. Snapshots v1/v2/v3 rejeitam `currencies.code`
duplicado antes de `snapshot_hash`, binding ou summary. As regressões também cobrem snapshot vazio,
target/valor/lineage divergentes, payload `active` divergente, atomicidade e imutabilidade.

A D100 eleva a suíte para 54 testes/casos Node e fecha as três transições forjadas da D99.
Ambiguidade exige a família real de ClientCandidates e `possible_matches` exato, único e não vazio;
`create_new`/`use_existing` revalidam o conjunto resultante. Conflitos protegidos e duplicados são
provados contra o snapshot, rejeições validam a causa factual e diagnostics desconhecidos não
certificam actions. As regressões confirmam que `conflict`/`rejected` autodeclarados não produzem
binding ou summary, conflito/rejeição reais permanecem bloqueados, resolução parcial não promove e
somente a resolução integral das causas permite `insert`.

A D102 eleva a suíte para 55 testes/casos Node e cobre a derivação obrigatória independente da
declaração do caller. A matriz prova zero/um/múltiplos matches de snapshot, matches inativos ou
excluídos, reconciliação `insert → no_op`, colisão lexical omitida, `create_new` contradito pelo
snapshot e `use_existing` comprovado. Também reproduz D02=`168000`, D06 `demanda+saldo`, origem ou
evidência ausente e manifesto desacoplado com IDs/hashes recalculados; parser, binding,
`applyExistingSnapshot` e `applyReviewedResolutions` falham antes de summary. Casos positivos de
insert, D02=`164000`, classificação D06 coerente, no-op e determinismo permanecem cobertos junto às
regressões D79–D101.

A D104 eleva a suíte para 56 testes/casos Node e fecha a trust boundary apontada pela D103. A prova
rejeita candidates comuns, spread, `Object.assign`, JSON round-trip, capability manual, provenance
arbitrária e D06 favorável mesmo com todos os hashes recalculados. O fluxo real
`loadP010Source → normalizeP011` continua emitindo binding; chamadas
diretas de `createReviewBinding`/`applyReviewedResolutions` sem a capability runtime não emitem
binding ou summary. A moeda não unívoca deriva `PROJECT_CURRENCY_UNRESOLVED`, e os antigos subtipos
caller-controlled são rejeitados.

A D106 eleva a suíte para 57 testes/casos Node e elimina a divergência entre a view fingerprintada
por `entries` e a view anteriormente consumida por `get`. A regressão carrega uma fixture P010
válida e, depois do loader, substitui `get`, `entries`, o Map `rows`, rows/cells nested, manifesto,
workbook hash e input hashes da representação pública. `normalizeP011` ignora todas essas views
caller-owned e produz exatamente os mesmos candidates, binding e artefatos derivados da
materialização canônica privada original; facts B não geram binding ou summary. Spread,
`Object.assign`, JSON round-trip e até uma view descartável obtida da materialização continuam
rejeitados por ausência da identidade runtime.
