# P012 — domínio local de itens e chave estável

## Estado e fronteira D05

P012-D05 mantém somente o núcleo local de itens migráveis: leitura factual da materialização
privada P010, vínculo runtime aos projetos finais P011, normalização de A–J, identidade estável,
snapshot sintético e reconciliação pura. Não existe CLI P012, writer, adapter, SQL, migration,
seed, banco, rede ou `--apply` nesta etapa.

Competências e séries K:T, planejamento, versões, baseline e Curva S pertencem ao P013. Actuals,
medições, realizado e eventos financeiros pertencem ao P014. Esses campos não participam dos
fatos, da equivalência de negócio nem da identidade P012.

O destino auditado continua sendo `ltc_m.project_items`. D03 respeita `numeric(20,4)` para
`quantity`/`unit_price`, `numeric(20,2)` gerado para `total_amount`, chaves ativas por projeto,
soft delete, `row_version`, auditoria e RLS, mas não altera o schema nem inventa o UUID persistente.

## Cadeia de autoridade P010 → P011 → P012

`loadP010Source` registra uma materialização canônica privada no `WeakMap` já existente. P012 chama
`createValidatedSourceView` e recebe uma cópia descartável dessa materialização; o `Map`, `get`,
`entries`, manifesto e objetos nested públicos nunca voltam a ser autoridade factual.

Ao terminar `normalizeP011`, o objeto final de artefatos recebe uma capability opaca em um
`WeakMap` privado do mesmo módulo que produz o resultado. A função emissora é privada e não integra
nenhum export; o módulo de provenance expõe somente a validação que devolve uma view descartável,
nunca um registrar, token ou proof reconstruível. A emissão liga por identidade runtime:

- o `LoadedSource` autorizado;
- manifesto e input P010;
- hash canônico do snapshot P011 efetivamente reconciliado, conferido contra o review binding;
- review binding e resoluções aplicadas, quando presentes;
- candidate-set referido pelo binding e fingerprints integrais dos projetos e artefatos entregues.

P012 exige simultaneamente a identidade original da fonte e a identidade original dos artefatos.
Spread, `Object.assign`, JSON, plain object, cast, hashes recalculados ou `{}` não copiam a
capability e não existe entry point público capaz de reemiti-la. Replay com outra source, snapshot
P011 ou review binding falha fechado. A view de projetos entregue ao consumidor é uma cópia e não
pode certificar outro objeto.

O conjunto P012 final recebe uma terceira capability runtime somente depois da derivação factual,
reconciliação e validação global. Antes de devolver uma view, o pipeline confere o snapshot privado,
rederiva integralmente os candidates a partir da source P010, projetos P011 e snapshot P012
originais, compara a declaração contextual sem os hashes e somente então confere candidate hashes,
candidate-set hash e fingerprint da capability. Hash demonstra integridade do objeto; não demonstra
provenance, causalidade nem readiness.

## Linhas e identidade

No perfil `monthly_revenue` v1, a linha 3 é o cabeçalho e a última linha materializada é o total. As
linhas intermediárias são tentativas de item. A cardinalidade é derivada da fonte; `48` existe
somente na fixture inicial e não é constante do núcleo.

A coluna A é `source_item_number`: inteiro decimal positivo, canônico, sem expoente, fração, sinal,
zero ou overflow de `integer` PostgreSQL. Duplicidade dentro do mesmo projeto aborta atomicamente o
conjunto.

O contrato da chave é `ltcm.p012.source-line-key.v1`. O preimage canônico é:

```json
{
  "contract": "ltcm.p012.source-line-key.v1",
  "payload_schema_version": 1,
  "project_code": "<project code canônico P011>",
  "sheet_key": "monthly_revenue",
  "source_item_number": 1
}
```

O SHA-256 UTF-8 do JSON canônico produz `p012-item-v1:<64 hex minúsculos>`, com 77 caracteres.
`item_code`, descrição, quantidade, unidade, moeda, preço, total, linha física e campos P013/P014
não participam da identidade. Mudar projeto ou número do item é reidentificação, nunca update ou
remoção automática.

O ID local é `item-<24 hex minúsculos>`, os primeiros 24 dígitos do SHA-256 canônico de somente
`{project_candidate_id, source_line_key}`. Ele não é UUID persistente. IDs divergentes, não
canônicos, duplicados ou colidentes são rejeitados.

## Contrato factual A–J

- B: projeto normalizado exatamente pelo P011 e presente uma única vez nos projetos finais;
- D: `item_code` opcional; vazio vira `null`; repetição é legítima;
- E: descrição opcional; vazio vira `null`;
- F: quantidade obrigatória;
- G: unidade obrigatória;
- H: moeda obrigatória e idêntica à moeda final do projeto;
- I: preço unitário obrigatório;
- J: evidência para conferir o total derivado, nunca autoridade independente.

Textos opcionais usam NFC e permitem trim somente de espaço ASCII U+0020 periférico. A verificação
de controles ocorre no texto NFC antes do trim: `Cc` — inclusive TAB, LF, CR e NUL — e `Cf` —
inclusive zero-width, word joiner e controles bidi — falham mesmo nas bordas. NFD legítimo pode ser
normalizado para NFC; não há remoção de acento nem reparo silencioso de controles.

A lineage registra manifesto, input, workbook, aba, linha física, source range, row hash P010,
coordenadas A–J, evidência bruta necessária, projeto final, chave e hash do candidate. K:T não são
copiados como fatos P012. Uma alteração P013 mantém a chave e todos os campos de negócio P012; o
hash de linha P010 pode naturalmente mudar como evidência de provenance do payload integral.

## Decimal exato e total

Quantidade e preço são lidos da representação decimal `round_trip_text`, validados como texto e
convertidos em inteiros escalados `BigInt`. Nenhuma aritmética monetária usa `Number`, `Math.round`,
`parseFloat` ou `toFixed`.

- `quantity`: até 16 inteiros e quatro decimais, maior que zero, serialização fixa em quatro casas;
- `unit_price`: mesmo limite, maior ou igual a zero, serialização fixa em quatro casas;
- `total_amount`: produto exato arredondado para duas casas, empate afastando-se de zero, até 18
  inteiros e duas decimais.

Expoente, vírgula, `NaN`, infinitos, sinal, escala excedente, truncamento, underflow representacional
e overflow falham fechados. Quando J é evidência total aplicável, divergência rejeita o item. A
evidência D04 de `2024-02-10990` permanece receipt forecast e não é reinterpretada como total,
contrato, faturamento ou actual.

## Unidade e moeda

Aliases normativos, comparados com NFC, trim exclusivo de U+0020 e case-insensitive:

| Entrada                   | Saída  |
| ------------------------- | ------ |
| `UN`, `Unidade`           | `UN`   |
| `SERV`, `Serviço`         | `SERV` |
| `US`, `Unidade e Serviço` | `US`   |

Não existem outros aliases e acentos não são removidos. Validade normativa e disponibilidade de
catálogo são verificações separadas: unidade válida ausente/inativa bloqueia readiness sem alterar
seed.

Moeda aceita somente `[A-Z]{3}`, deve coincidir exatamente com o projeto P011 e estar ativa no
catálogo sintético P012. Não há conversão cambial nem escolha por diagnostic do caller.

## ItemCandidate fechado

`ltcm.p012.item-candidate.v1` contém versão, ID, chave, line number, referência e hash do projeto,
campos factuais canônicos, action/status, target opcional, diagnostics, origins A–J, evidência,
lineage e `candidate_hash`. O parser estrutural é privado e não concede authority ou readiness. Ele
rejeita campos desconhecidos ou ausentes no topo e em estruturas nested, tipos divergentes,
IDs/UUIDs/hashes não canônicos, diagnostics fora da allowlist e combinações declaradas
internamente incoerentes antes de confiar no hash.

A ordem normativa é: validação do valor raw, normalização expressamente permitida, derivação factual
contextual, comparação exata declared-versus-derived, hashes e certificação runtime.

A taxonomia fechada contém somente erros textuais/decimais/unidade/moeda/total, indisponibilidade
dos catálogos, inelegibilidade/target do projeto e conflito do item atualmente emitidos pelo
runtime. `action`, `status` e diagnostics são resultados de `deriveP012ItemState`, não escolhas do
caller. Coerência estrutural isolada ainda não prova causa factual: a view certificada reexecuta a
derivação contextual completa e exige igualdade integral com o candidate-set original autorizado.

Erros factuais com identidade preservada produzem `rejected`. Erro estrutural — provenance,
schema, identidade duplicada, hash, snapshot ou target ambíguo — aborta o conjunto e não emite
candidate set certificado.

O `candidate_set_hash` usa a lista canônica ordenada de pares `candidate_id`/`candidate_hash`,
depois da validação global. Ordem incidental não altera o resultado e duplicidade é detectada antes
do hash.

## Snapshot e reconciliação

`ltcm.p012.existing-items-snapshot.v1` é local, sintético e fechado. Ele contém catálogos de moedas
e unidades, vínculo dos projetos P011 a UUIDs persistentes e a projeção relevante de itens:
identidades, campos canônicos, `active`, `deleted_at` e `row_version`.

O preflight valida UUID lowercase canônico, unicidade global de targets, unicidade de projeto,
catálogos, chave e line number por projeto, moeda projeto/item, decimal e total derivado. Arrays são
ordenados canonicamente antes do hash. Duplicata, case variant, campo desconhecido, referência
ausente ou combinação key/line ambígua invalida o snapshot inteiro.

A reconciliação é pura:

- sem match e dependências elegíveis: `insert`;
- mesmo target por chave/linha e equivalência completa: `no_op`;
- mesma identidade com qualquer divergência factual, inatividade ou soft delete: `conflict`;
- erro factual: `rejected`;
- catálogo indisponível ou projeto pendente: `pending_decision`;
- projeto P011 `conflict`/`rejected`: estado bloqueante propagado.

Equivalência inclui projeto, line number, código, descrição, quantidade, unidade, moeda, preço,
total, active e deleted. `row_version` e timestamps não são conteúdo de negócio. P012 não gera
`update`, delete, undelete ou soft delete e não interpreta o desaparecimento de uma linha como
remoção.

## Segurança operacional

Diagnostics usam uma allowlist fechada de códigos sanitizados `P012_*` e não replicam payload,
snapshot, path ou conteúdo empresarial. Inputs caller-owned são apenas lidos; parser e
normalizadores devolvem cópias. Não existe parser público que certifique `ItemCandidate`, e a view
contextual não aceita hashes recalculados como substituto de authority ou causalidade. Freeze não é
usado como substituto de provenance.

O core permanece programático e independente de PostgreSQL. A D12 acrescentou um port mínimo e um
adapter PostgreSQL local/test; essa capability não autoriza aplicação remota.

## Plano de persistência D12

`ltcm.p012.persistence-plan.v1` é produzido somente de um candidate set certificado e do mesmo
snapshot que participou da derivação. O plano contém ambiente lógico, lote P009/P011, hashes P010,
P011 e P012, snapshot, targets dos projetos, operações ordenadas e contagens. Não contém DSN,
segredo, timestamp incidental, workbook ou evidence bruta.

O `plan_hash` é o SHA-256 do JSON canônico do plano sem o próprio hash. Ele cobre batch, source,
snapshot, candidate set, targets, operações, IDs e `row_version` esperados. Reordenação já
normalizada pelo contrato não muda o hash; qualquer mudança semântica muda. Hash continua sendo
prova de integridade, não substitui provenance runtime: antes de aplicar, o core revalida a source
P010, os artefatos P011 e o candidate set P012.

Somente candidates `insert` e `no_op` geram operações. `rejected` e `pending_decision` permanecem
nas contagens e não geram SQL. A presença de `conflict` impede o apply inteiro. UPDATE factual,
DELETE, soft delete, undelete e upsert não existem no port P012.

## Reader e port PostgreSQL

O port separa leitura e transação. O reader consulta em lote os projetos envolvidos, moedas,
unidades P012 e todos os itens desses projetos, inclusive inativos e soft-deleted. Valores
`numeric` permanecem strings, `bigint` só é convertido depois da prova de safe integer e timestamps
são serializados em ISO UTC. O objeto montado pelo adapter continua `unknown` até atravessar
`parseP012ExistingItemsSnapshot`; o formato do driver nunca é confiado diretamente pelo core.

O primeiro reader/apply real exige ator sintético ou operacional `Admin`: a RLS vigente oculta
inativos/deletados de `Editor`, enquanto a reconciliação precisa enxergá-los para falhar fechado. A
transação chama `ltc_m.set_actor_context` e confirma `authorization_context()` antes de ler ou
escrever.

O writer PostgreSQL de integração usa `pg`, SQL qualificado com `ltc_m.` e parâmetros posicionais
para todos os valores. Ele fica confinado ao suporte de testes, fora do grafo e dos exports do
módulo de produção. O core não recebe `Pool`, `PoolClient` ou SQL, e nenhum helper, capability,
adapter ou callback de writer test-only é importável pela superfície normal do package.

## Transação, locks e idempotência

Todos os itens P012 write-eligible de um workbook/lote são aplicados em uma transação
`SERIALIZABLE`. Os UUIDs dos projetos são ordenados canonicamente e cada projeto recebe um lock
transacional derivado por:

```text
pg_advisory_xact_lock(
  hashtextextended('ltc_m.p012.project:' || project_uuid, 0)
)
```

Depois dos locks, o adapter lê novo snapshot e o core rederiva candidates e plano. Divergência do
hash revisado retorna `P012_PERSISTENCE_SNAPSHOT_CHANGED` antes dos inserts. Os índices únicos
parciais de `(project_id, source_line_key)` e `(project_id, line_number)` continuam a barreira final
contra writers que não cooperam com o advisory lock.

INSERT omite `id`, `total_amount`, timestamps e `row_version`. O banco gera esses valores; o
`RETURNING` é novamente convertido pelo contrato P012 e o total gerado é comparado textualmente ao
total exato derivado. No-op exige equivalência integral e faz zero INSERT/UPDATE/DELETE em
`project_items`.

`23505` nunca vira sucesso silencioso: a transação reverte e retorna conflito de identidade. Erros
`40001` e `40P01` aceitam no máximo duas tentativas totais; cada tentativa abre nova transação e
rederiva o plano. Se o plano mudar, o apply para e exige novo dry-run/confirmação.

Falha em qualquer item reverte todos os itens e vínculos do lote. Crash antes do commit reverte;
resposta perdida depois do commit é recuperada por novo dry-run, que encontra os mesmos targets e
produz no-ops sem alterar `row_version`.

## Batch e provenance P009

O lote deve existir e coincidir exatamente em UUID, `idempotency_key` e `source_hash`. A aba
`monthly_revenue` e cada staging row write-eligible devem existir com o mesmo physical row e
`row_hash` P010. O adapter liga a linha a `target_table = 'project_items'` e ao UUID gerado pelo
banco. O vínculo é idempotente; target preexistente divergente aborta o lote. Raw payload e evidence
não são copiados para `project_items`.

## Dry-run, ambientes e testes

Dry-run é o default: lê snapshot, normaliza, produz plano/hash/summary e abre zero transação de
escrita. O writer existe somente no harness compilado de testes; seu pool e sua authority opaca são
criados juntos depois da validação estrita da URL e não podem ser fornecidos por caller de produto.
Plano, operação e hashes recalculados continuam sendo dados, nunca authority. A CLI continua
recusando `--apply` com `REMOTE_APPLY_NOT_AUTHORIZED`; não existe flag ou variável de produto para
habilitar escrita.

O guard test-only aceita apenas hostname literal `127.0.0.1`, `localhost` ou `::1`, porta PostgreSQL
padrão, banco sintético allowlisted e URL sem query ou fragment. Depois da conexão, atesta o peer
efetivo do socket TCP como IPv4 ou IPv6 loopback e consulta o servidor para confirmar o database.
RFC1918, ULA, socket, hostname parecido, DNS de `localhost` resolvido para endereço não loopback e
qualquer host remoto falham fechado. Essa separação preserva o port mapping local do Docker, cujo
endereço interno do servidor pertence à rede privada do container sem transformar essa rede em
authority.

Os testes unitários cobrem as 48 tentativas sintéticas, plano/hash, tampering, snapshot antigo,
retry, `23505`, rerun, fechamento dos exports e a matriz adversarial de URL. O gate PostgreSQL efêmero
aplica as 12 migrations reais e executa rollback tardio no item 47, 48 inserts, dois writers
concorrentes, ordem inversa de locks de dois projetos, rerun com 48 no-ops, totals gerados, SQL
parametrizado, staging e repetição legítima de `item_code`. A
suíte não depende de internet nem de Supabase remoto. Quando não existe PostgreSQL local, o teste
de integração permanece explicitamente skipped; o job efêmero o ativa com
`LTCM_P012_INTEGRATION=1`.

Para a validação D12A em PostgreSQL 17 local, o harness consome exclusivamente
`process.env.LTCM_P012_TEST_DATABASE_URL`. Antes de aplicar qualquer migration ou fixture, ele
exige host literal e efetivo `127.0.0.1`, `localhost` ou `::1`, database `ltcm_test`, URL sem query
ou fragment, usuário `postgres` e `SUPERUSER`/`BYPASSRLS`. A connection string nunca integra código, evidência
ou logs. O caminho local não configura TLS permissivo e não reconhece Render, Supabase ou banco
remoto.

Nesse fluxo, banco limpo recebe exatamente as 12 migrations versionadas; banco já migrado passa
pela atestação integral de tabelas, RLS/FORCE RLS, funções, total gerado, constraints, índices e
triggers. A cobertura PostgreSQL também comprova actor context, leitura tipada do snapshot,
`SERIALIZABLE`, advisory locks em commit/rollback, `40001`, `40P01`, `23505`, FKs, limites
numéricos, rollback tardio, dry-run sem mutação, concorrência idêntica/divergente, 48 inserts,
staging e rerun com UUID/`row_version` estáveis. Fixtures, memberships transitórias, conexões e
locks são limpos no `finally`; o schema migrado pode permanecer.
