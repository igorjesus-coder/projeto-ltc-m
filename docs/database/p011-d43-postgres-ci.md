# P011 / D43 — validação PostgreSQL efêmera

## Escopo

O workflow `LTC-M PostgreSQL validation` aplica todas as migrations em ordem lexical, carrega
somente o seed técnico BRL/US e executa P006, P007, P008, P009 e os 47 cenários D40/D41. O banco
`ltcm_ci` e as roles são sintéticos e existem somente durante o job.

O fluxo não usa Supabase CLI, projeto vinculado, banco persistente, secrets, XLSX, dados reais,
deploy ou aplicação remota. O scanner `npm run ci:env:check` falha antes do SQL se detectar host ou
variável remota, arquivo proibido ou comando de acesso remoto nos executores do CI.

## Imagem imutável

A imagem oficial foi consultada no Docker Hub `library/postgres` em
`2026-08-04T17:15:57-03:00`. A tag observada foi `17.10-bookworm` e o index/manifest digest foi
`sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394`.

Referência completa:

```text
postgres:17.10-bookworm@sha256:4f736ae292687621d4dbe0d499ffd024a36bd2ee7d8ca6f2ccd4c800f047b394
```

O job registra também a versão PostgreSQL realmente iniciada, encoding, locale e timezone.

## Bootstrap e ownership

O service inicia `ci_admin` como administrador descartável. O bootstrap cria `postgres` com os
atributos comprovados pelo harness P008, `supabase_admin` sem login e `ltc_m_runtime` sem login,
atributos elevados ou memberships. As migrations validam e reutilizam a runtime sintética e são
aplicadas como `postgres`; assim, as funções `SECURITY DEFINER` terminam com owner `postgres`.
Depois das migrations, o bootstrap reproduz D26 com grantor `supabase_admin`. D27 é concedida
apenas durante as regressões e revogada em `finally`.

O estado final comprova owner, `prosecdef`, `search_path=""`, ACL sem `PUBLIC`, ausência de
`EXECUTE` para `ltc_m_runtime`, restauração exata de D26 e zero fixture operacional.

## Ordem do gate

1. instalar exatamente o lockfile, sem cache na primeira execução;
2. rejeitar configuração remota;
3. executar `npm run check`;
4. criar as roles sintéticas;
5. aplicar migrations timestampadas com `psql -X --no-psqlrc --set=ON_ERROR_STOP=1`;
6. aplicar `supabase/seed.sql` no banco efêmero;
7. executar P006 e P007;
8. provar D26/D27 e conceder D27 temporariamente;
9. renderizar P008/P009 em diretório temporário fora do repositório;
10. executar P008, P009 Fase A, P009 integral e o pós-check;
11. executar os 47 cenários D40/D41;
12. executar duas ordens concorrentes em um segundo banco descartável preparado com as mesmas
    migrations;
13. revogar D27 em `finally`, comprovar o estado final e remover temporários;
14. exigir `git diff --exit-code`.

O teste concorrente mantém a primeira transação aberta e inicia a operação incompatível em outra
conexão. Ele cobre vínculo-primeiro e rejeição-primeiro, exige espera real, recusa deadlock ou
`lock_timeout` inesperado e destrói o banco isolado de fixtures ao terminar.

## Evidência

O runner grava somente `.tmp/ci-evidence/ltcm-postgres-validation.json`, ignorado pelo Git. O JSON
contém commit/branch, imagem/digest, versão do servidor, hashes e ordem das migrations, exit codes,
resultados P006–P009, `47/47`, concorrência, segurança D41, rollback, contagens finais e estado do
Git. Não contém SQL integral, senha, URL, dump ou payload de fixture. O artefato fica retido por no
máximo sete dias.

## Revisão e promoção

O evento autorizado é `pull_request`; `workflow_dispatch` só fica disponível depois de eventual
integração do workflow na branch default. O PR D43 permanece draft e não pode ser aprovado,
convertido ou integrado antes da decisão D44. D36 e D34 continuam pendentes.
