# P009 — relatório pós-aplicação

Aplicação: 31/07/2026  
Continuação: 03/08/2026  
Projeto: `Funcionarios` (`us-east-1`)  
Decisão: D29 `Decidida`, sem backup recuperável, uma única tentativa autorizada.
Continuação funcional: D30 `Decidida` em 03/08/2026, aprovada pelo responsável do projeto, com
uma única reexecução remota do harness corrigido autorizada.
Continuação D31: gate integral aprovado e uma única validação remota em duas fases consumida em
03/08/2026.

**Status: Concluída — validação final D33 aprovada, estado remoto limpo**

## Aplicação

- Migration: `20260731130000_add_ltcm_import_staging.sql`
- SHA-256: `C0CDBC2F020A9D727D0E353A31EA7E91DF715E5B96BEB343E79407DECD940A22`
- Preflight: conforme; zero objetos P009, 13 tabelas RLS/FORCE, 35 policies, D26 exata e fingerprint externo `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`.
- Dry-run: listou exclusivamente a migration P009, sem seeds ou roles.
- Push: concluído uma vez; nenhum segundo push, repair, reset, pull, down ou DDL manual.
- A migration remota foi a primeira execução real porque Docker e `psql` estavam indisponíveis
  localmente. O stdout/stderr sanitizado integral do push não foi preservado como artefato; a
  aplicação é comprovada pelo histórico remoto, pelos objetos e pelos inventários pré/pós.

## Pós-check e testes

- 15 tabelas com RLS/FORCE RLS e 41 policies; nenhuma policy `DELETE`/`FOR ALL`.
- Runtime sem login/bypass, zero grants externos, zero execução pública e D26 preservada.
- BRL/US preservados; tabelas de domínio e staging vazias após os testes.
- A suíte P009 original foi registrada como aprovada em 31/07/2026, com `rollback_clean: true`,
  mas sua cobertura versionada não exercitava toda a matriz dinâmica exigida. Ela foi ampliada
  localmente em 03/08/2026 sem alterar a migration.
- A revalidação `r20260803124900-7372310e` executou D26/D27, contexto inválido, Viewer, Editor,
  Admin, P007, P008 e concorrência D23. A etapa P009 falhou antes dos cenários com SQLSTATE `42601`:
  o renderizador substituiu `p009` no alias
  `p009_rejection_partial_integrity`, produzindo um hífen inválido.
- O renderizador e o teste unitário foram corrigidos somente no repositório. Conforme D29, não
  houve nova execução remota naquele ciclo. A D30 autorizou exatamente uma reexecução do harness
  corrigido, condicionada ao preflight integral e sem repetição automática.
- O preflight D30 confirmou 10 migrations alinhadas, P009 aplicada uma vez, hash aprovado, D26
  exata, todas as contagens zeradas, zero locks e fingerprints sem drift.
- A única execução D30, `r20260803132652-ada2b257`, ocorreu de
  `2026-08-03T13:26:52.151Z` a `2026-08-03T13:30:46.597Z` por
  `npm run p008:runtime:validate` e retornou código `1`.
- A correção do alias passou, mas `p009_full_validation` parou com SQLSTATE `42601`: o INSERT das
  fixtures `app_users` declarava quatro colunas, enquanto a linha inativa possuía cinco valores.
  Assim, batches, abas, staging, erros, rejeição parcial, imutabilidade, auditoria e RLS P009 por
  perfil não foram alcançados.
- Após a execução, a suíte local passou a declarar a coluna `active` e valores explícitos
  `true/false`; o scanner ganhou teste negativo para ausência desse estado. Essa correção local
  não foi executada remotamente, pois D30 proíbe repetição automática.
- Contexto inválido isolado, Viewer/Editor/Admin P008, P007 integral, P008 integral e concorrência
  D23 passaram. O cleanup em `finally`, o estado final e os fingerprints também passaram, com
  `rollback_clean=true`.
- Cleanup em `finally`: aprovado. D26 foi restaurada exatamente, não restou grantor `postgres`,
  lock ou fixture sintética; P007/P008 e os fingerprints passaram.
- Fingerprint externo pós: `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` (inalterado).
- O gate D31 aprovou os dois SQLs renderizados, com 1.038 statements, 76 INSERTs e 105 tuplas.
- A única invocação D31 `r20260803141344-e3356875` aprovou a Fase A transacional com
  `phase_a_passed=true`. Na Fase B, batches, abas, staging, erros, rejeição parcial e imutabilidade
  avançaram até a assertion de auditoria.
- O primeiro erro D31 foi SQLSTATE `P0001`: a assertion esperava `p009-request-4`, campo da aba,
  enquanto `audit_row_change()` registrou o request do contexto, `p009-request-setup`. A matriz
  RLS P009 posterior não foi alcançada. Não houve correção ou reexecução.
- P007, P008, contexto inválido, perfis isolados P008 e D23 passaram. Cleanup, estado final e
  fingerprints passaram com `rollback_clean=true`.

## Continuação D32

- D32 foi decidida e aprovada em 03/08/2026; o trigger e o schema permaneceram inalterados.
- O gate local aprovou 1.171 statements, 76 INSERTs, 105 tuplas, 58 aliases, 13 contextos, 13
  assertions pós-DML e oito cenários auditados por renderização. Manifesto:
  `024368A868714955D3182CFF9C19F220D4C434C9FF0F5179C8FC071C5C9377B2`.
- A única invocação `r20260803151221-2d4f91ba`, pelo comando
  `npm run p009:runtime:validate`, ocorreu de `2026-08-03T15:12:21.173Z` a
  `2026-08-03T15:16:26.506Z` e retornou código 1.
- Fase A, contexto inválido, perfis P008, P007/P008 integrais e D23 passaram. O subprocesso SQL
  P009 também retornou sucesso depois de executar assertions de batches, abas, staging, erros,
  rejeição parcial, imutabilidade, auditoria e RLS.
- O orquestrador não encontrou no stdout o result set intermediário
  `p009_rejection_partial_integrity` e não capturou a matriz estruturada; por isso o resultado é
  `Parcialmente concluída — validação final P009 falhou, estado remoto limpo`.
- Não houve retry. Cleanup D27, estado final, pós-check e fingerprints passaram com
  `phase_a_passed=true` e `rollback_clean=true`.
- Os inventários D32
  [`p009-inventory-remote-d32-pre.json`](p009-inventory-remote-d32-pre.json) e
  [`p009-inventory-remote-d32-post.json`](p009-inventory-remote-d32-post.json) possuem os mesmos
  1.625 objetos.

## Continuação D33

- D33 foi decidida e aprovada pelo responsável do projeto em 03/08/2026 para corrigir somente o
  launcher, a captura e o protocolo de evidência.
- Testes locais aprovaram saída grande, envelope dividido em chunks, CRLF/LF, stderr intercalado,
  atraso, códigos 0/1, ausência/duplicidade/truncamento/corrupção, parser após `close` e
  encerramento da árvore sintética no Windows.
- O manifesto D33 `BB338E54535CA4F61E57481768C1905C1C3AC7B8646A11312C3F494E983EEC42`
  aprovou 1.172 statements, 76 INSERTs, 105 tuplas, 59 aliases, 20 fixtures, 13 contextos, 13
  assertions pós-DML e oito cenários auditados.
- A única invocação `r20260803173036-ddabb07d`, de `2026-08-03T17:30:36.232Z` a
  `2026-08-03T17:34:47.994Z`, terminou com código 0, sem timeout, depois do `close` real.
- Um único envelope `P009_RESULT_V1` íntegro foi o último registro. Seu SHA-256 é
  `BA032ADB806A41C4C46B0D12A9E180F9163D0253D8878B420332BB830AC0A659`.
- Fases A/B, toda a matriz P009, oito requests configurado→auditado, P007/P008, D23 e D24 passaram;
  `first_error=null`.
- Cleanup em `finally`, D26 exata, contagens e locks zerados e fingerprints preservados passaram
  com `rollback_clean=true`.
- Os inventários temporários pré/pós tiveram o mesmo SHA-256
  `01ED54D839F0BFEAC40CB31624C61CD3CB82E2AF3DB553589AE67B2A7AD76A9F`.
- A autorização D33 foi consumida; não houve retry ou segunda invocação.

## Estado final somente leitura

- dez migrations alinhadas; P009 aparece uma vez;
- PostgreSQL 17.4; 15 tabelas LTC-M, todas com RLS e FORCE RLS;
- 41 policies, zero `DELETE`/`FOR ALL`; nove funções executáveis pelo runtime e
  `PUBLIC EXECUTE=0`;
- 32 constraints P009, 14 índices P009 e seis triggers nas tabelas novas;
- runtime `NOLOGIN`/`NOBYPASSRLS`, sem ownership, grants externos ou privilégios destrutivos;
- BRL=1, US=1 e `US = Unidade e Serviço`;
- `app_users`, `audit_log` e todas as tabelas operacionais/importação com contagem zero;
- fingerprint LTC-M `0A39EEDACAC670E25EC46589F8774A13088C136453672C41A38A2EA948A891CB`;
- fingerprint de migrations `8D0A1AB4BE73312A653EA1F6E677044E6FB609A37BC752CA588F5AA4025789EA`.

Inventários completos: [`p009-inventory-remote-pre-final.json`](p009-inventory-remote-pre-final.json),
[`p009-inventory-remote-post.json`](p009-inventory-remote-post.json) e
[`p009-inventory-remote-final.json`](p009-inventory-remote-final.json). Os inventários D30 são
[`p009-inventory-remote-d30-pre.json`](p009-inventory-remote-d30-pre.json) e
[`p009-inventory-remote-d30-final.json`](p009-inventory-remote-d30-final.json). Resultado estruturado
da continuação: [`p009-runtime-validation-result.json`](p009-runtime-validation-result.json), e o
relatório funcional está em
[`p009-runtime-validation-report.md`](p009-runtime-validation-report.md).

Os inventários D31 são [`p009-inventory-remote-d31-pre.json`](p009-inventory-remote-d31-pre.json) e
[`p009-inventory-remote-d31-post.json`](p009-inventory-remote-d31-post.json); seus 1.625 objetos são
idênticos.

O risco de transporte observado na D32 foi encerrado pela D33. O envelope e seus hashes estão em
[`p009-runtime-validation-result.json`](p009-runtime-validation-result.json) e
[`p009-runtime-terminal-evidence.json`](p009-runtime-terminal-evidence.json). Nova execução remota
exige outra decisão explícita.
