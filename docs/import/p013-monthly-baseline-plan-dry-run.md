# Plano canônico e dry-run do baseline mensal P013

## Escopo D03

A D03 lê localmente o XLSX aprovado, materializa as 432 posições K:S, resolve cada identidade
P012 para um `project_items.id` persistido e constrói um plano determinístico em memória. A
implementação não possui writer, `apply`, migration nova, acesso remoto nem saída com dados reais.
O dry-run abre uma transação PostgreSQL `REPEATABLE READ READ ONLY`, executa um único `SELECT` de
snapshot e encerra com `ROLLBACK`.

O contrato do plano é `ltcm.p013.monthly-baseline-plan.v1`. O snapshot usa
`ltcm.p013.monthly-baseline-snapshot.v1`; o recibo sanitizado em memória usa
`ltcm.p013.monthly-baseline-dry-run-receipt.v1`.

## Fonte certificada e autoridade runtime

`loadP013CertifiedMonthlySource` reutiliza integralmente o extractor P010 e o gate semântico D02.
Ele verifica o arquivo antes e depois da leitura, compara tamanho e SHA com o manifesto extraído,
inspeciona os valores decimais exatos do OOXML e exige o fingerprint D01A aprovado. A identidade
pública é imutável; os 432 fatos certificados ficam associados por `WeakMap` no processo.

Objetos obtidos por spread, `Object.assign`, JSON, `structuredClone`, cast ou recomputação de hash
não possuem autoridade. Não existe função pública que registre uma fonte, snapshot ou plano
arbitrário como certificado. O hash prova integridade do conteúdo correspondente, mas não concede
autoridade factual.

## Célula, decimal e reconciliação

Cada célula canônica registra projeto, UUID do item, `source_line_key`, item/linha de origem, aba,
coordenada, competência, estado `blank|explicit_zero|value`, proveniência de fórmula/cache, texto
decimal OOXML, valor canônico, hash da linha, hash do valor e fingerprint da célula. `blank` não
gera linha financeira; zero explícito e valor geram candidatos materiais distintos.

O arredondamento continua sendo decimal por célula, half-away-from-zero, com duas casas e sem
conversão por `Number`. O workbook D01A produz 330 blanks, um zero explícito, 101 valores não zero,
102 linhas materiais, total canônico `2800460.18`, agregado bruto arredondado `2800460.15` e
residual `0.03`. O plano reconcilia nove competências por item, 48 itens e o agregado global.
Cada reconciliação de item também registra o agregado bruto arredondado, o residual exato entre
rounding por célula e rounding agregado e o total J como diagnóstico não autoritativo.

## Snapshot e resolução P012

O leitor recebe `unknown`, valida chaves exatas, UUIDs, hashes, datas, valores, duplicidades,
ordenação e fingerprint, e devolve uma visão imutável vinculada ao escopo lido. O plano exige uma
versão baseline em `draft`, escopo `billing_planned/item` por projeto e exatamente um projeto
ativo/não excluído e um item ativo/não excluído para `project_code + source_line_key +
line_number`.

Uma identidade não resolvida, inclusive NB01, produz `pending_decision`, diagnóstico explícito e
nenhum plano certificado/apply-ready. Baseline ou linhas preexistentes divergentes produzem
`conflict`. Conteúdo idêntico já persistido produz `no_op_candidate`; SHA diferente com a mesma
semântica mantém a mesma identidade de baseline e as mesmas chaves materiais.

## Determinismo, stale snapshot e ameaça

O fingerprint do snapshot integra todos os fatos e o escopo do `SELECT`. O plano inclui esse
fingerprint e é associado à autoridade do snapshot no processo. Qualquer mudança posterior,
snapshot futuro/antigo, reordenação não canônica ou objeto copiado falha fechado. O plano não usa
timestamp, UUID aleatório ou estado ambiente em sua identidade; a mesma fonte, versão e snapshot
produzem o mesmo fingerprint semântico, chave idempotente e `plan_hash`.

O recibo é apenas resumo observável e nunca autoridade. Ele registra contagens, reconciliação,
status, fingerprints, hash do plano, um `SELECT` e zero statements de escrita.

## Validação local

```powershell
npm run p013:check
npm run test:p013:static
npm run test:p013:d03
$env:LTCM_P013_D03_INTEGRATION = '1'
npm run test:p013:d03:postgres
```

O teste PostgreSQL aceita somente `LTCM_P012_TEST_DATABASE_URL` guardada para loopback, porta
5432, banco `ltcm_test`, PostgreSQL 17 e bootstrap `postgres`. Ele recria o schema local, instala
fixtures exclusivamente sintéticas para nove projetos e 48 itens, executa duas vezes o dry-run
real, compara todas as contagens antes/depois e limpa o schema no `finally`.

O timeout histórico P009 no Windows permanece condição conhecida, não bloqueante para a D03 e
fora do escopo de reinvestigação. A próxima decisão recomendada é D04, revisão adversarial e de
integração somente leitura; ela não autoriza apply.

## Hardening D04A

A D04A preserva o escopo sem writer e fecha os boundaries de authority, comparação integral e
sanitização. O accessor da fonte nunca devolve a entrada privada do `WeakMap`: wrapper, array e
células são cópias defensivas congeladas. Spread, JSON, clone, proxy e recomputação de hash não
adquirem authority. O schema aceita exatamente `blank`, `explicit_zero` e `value` e falha fechado
para qualquer outro estado ou combinação estado/decimal incoerente.

O dry-run não aceita mais queryable, `Pool`, `PoolClient`, callback ou resposta SELECT arbitrária.
Um adapter opaco controla internamente um cliente dedicado e aceita somente loopback literal,
porta 5432 e banco `ltcm_test`. A sessão deve ser PostgreSQL 17, não-superuser, non-BYPASSRLS e
capaz apenas de assumir `ltc_m_runtime`. Dentro de `REPEATABLE READ READ ONLY`, o fluxo atesta o
runtime, define o ator, verifica editor/admin, confirma `transaction_read_only = on`, produz o
snapshot e encerra com `ROLLBACK`.

WeakMaps privados vinculam por identidade process-local `source -> adapter -> snapshot -> plan`.
Fingerprint e hash continuam sendo apenas integridade. Um plano somente é aceito com exatamente a
fonte e o snapshot que lhe deram origem; serialização, rehash, cross-source e cross-snapshot não
restauram authority. O helper de derivação pura existe apenas no módulo testado e o pacote
normalizer continua com `exports: {}`.

`no_op_candidate` exige igualdade integral de baseline, versão, fingerprint, cardinalidades,
células, proveniência, estados, valores, linhas financeiras, moeda, competência, item e cadeia
execução/artefato. Ausência, extra, duplicidade ou identidade cruzada resulta em conflito ou falha
estrutural fechada. O recibo deriva as contagens de statements das instruções realmente concluídas
na sessão fechada; não é authority independente. Erros públicos usam códigos P013 estáveis e não
propagam path, DSN, senha, usuário ou erro cru do driver.

A integração D04A recria as 13 migrations atuais em PostgreSQL 17 local, confirma RLS/FORCE RLS nas quatro
tabelas P013 e usa um login temporário não-superuser/non-BYPASSRLS para o fluxo de negócio. Ela
prova ator admin, viewer bloqueado, READ ONLY real, INSERT rejeitado com SQLSTATE `25006`, zero
writes antes/depois, no-op íntegro, linha divergente em conflito, baseline cruzado rejeitado e
cleanup de conexões e locks. D04A não adiciona apply ou persistence mensal; a próxima decisão
possível é exclusivamente a confirmação read-only D04B.

## Continuação D05

A capability local/test de persistência aprovada depois da confirmação D04B está documentada em
[`p013-monthly-baseline-local-apply.md`](p013-monthly-baseline-local-apply.md). Ela preserva o
dry-run como read-only e não publica apply no package ou na CLI.
