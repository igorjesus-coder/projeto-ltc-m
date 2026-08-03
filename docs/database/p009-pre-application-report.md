# P009 / 1.09 — relatório pré-aplicação local

## Atualização após D29

D29 foi registrada como `Decidida` em 31/07/2026. O preflight final de
`2026-07-31T19:32:11.472Z` preservou o fingerprint externo aprovado, e o dry-run listou somente
`20260731130000_add_ltcm_import_staging.sql`. O único `supabase db push --linked` foi concluído;
as afirmações `Pendente` e “nenhum push” abaixo preservam a fotografia histórica produzida antes
da decisão, não autorizam nova aplicação.

O ambiente remoto foi a primeira execução real da migration por indisponibilidade local de
Docker/`psql`. Na continuação de 03/08/2026, a revalidação funcional P009 abortou antes dos
cenários por erro do renderizador, com cleanup, D26, P007/P008 e fingerprints conformes. Nova
execução remota exige decisão explícita.

## Pré-condições

P008 está commitado em `5fd26420748d6d2566fb98a0e6187d6a77347a62`, enviado ao `origin/main`, com
`HEAD` alinhado e worktree inicialmente limpo. As nove migrations aplicadas permanecem imutáveis;
P008 está documentado como concluído e D22–D28 estão `Decidida`.

## Auditoria do estado existente

`import_batches` já possuía UUID, nome/hash de origem, status, contadores básicos, ator, datas e
`row_version`; o índice `uq_import_batches_hash` era globalmente único e incompatível com novas
tentativas do mesmo arquivo. `import_row_errors` possuía vínculo ao lote, aba/linha textuais,
mensagem e `raw_payload`, mas não possuía vínculo FK à aba/linha, severidade ou caminho de campo.

P009 preserva essas tabelas e seus contratos, remove apenas a unicidade global do hash, adiciona
metadados/contadores necessários e cria FKs estruturadas para o staging.

## Delta local

Migration única: `20260731130000_add_ltcm_import_staging.sql`. Ela cria somente
`ltc_m.import_batch_sheets` e `ltc_m.import_staging_rows`, estende as duas tabelas existentes,
cria constraints/índices/triggers/RLS/policies/grants em `ltc_m` e não insere dados.

SHA-256 local: `C0CDBC2F020A9D727D0E353A31EA7E91DF715E5B96BEB343E79407DECD940A22`.

O contrato JSON v1, lifecycle, hashes, rejeição parcial, matriz de grants e threat model estão em
[`p009-staging-contract.md`](p009-staging-contract.md) e documentos vinculados.

## Limites e D29

Nenhum XLSX foi lido, interpretado ou adicionado ao repositório. Não há extrator, endpoint, tela,
Tableau, baseline, retenção ou purge. Na fotografia pré-aplicação, D29 ainda estava `Pendente` e
o fluxo parava antes do push; a atualização no início deste relatório registra a decisão e a
aplicação posteriores.

## Preflight remoto e dry-run

O preflight read-only confirmou `Funcionarios`, `us-east-1`, PostgreSQL 17.4, zero objetos P009,
13 tabelas RLS/FORCE, 35 policies, nove funções na allowlist, `PUBLIC EXECUTE=0`, BRL=1, US=1,
contagens operacionais zeradas, runtime seguro e membership D26 exato. O fingerprint externo foi
`7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`.

As nove migrations aplicadas ficaram alinhadas; a lista local/remota mostrou somente
`20260731130000_add_ltcm_import_staging.sql` como pendente local. O dry-run remoto listou
exclusivamente essa migration, sem seeds, roles ou segundo arquivo. Nenhum `db push` foi executado.

Inventário remoto: [`p009-inventory-remote-pre.json`](p009-inventory-remote-pre.json).

Os testes PostgreSQL P009 foram versionados e validados pelo scanner. O ambiente local não possui
Docker/`psql`, portanto a execução SQL local fica pendente da disponibilidade do Supabase local;
nenhuma execução remota de DDL ou do teste P009 foi feita.
