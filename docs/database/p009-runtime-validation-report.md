# P009 — relatório final de validação D33

**Status: Concluída**

- Decisão: D33, `Decidida` e aprovada pelo responsável do projeto em 03/08/2026.
- Run ID: `r20260803173036-ddabb07d`.
- Única invocação remota: `npm run p009:runtime:validate`.
- Início: `2026-08-03T17:30:36.232Z`.
- Fim: `2026-08-03T17:34:47.994Z`.
- Duração do harness: 251.762 ms; duração observada do comando: 252,7 s.
- Código de saída: `0`; timeout: não; segunda invocação/retry: não realizada.

## Protocolo e captura

O worker emitiu exatamente um envelope `P009_RESULT_V1` como último registro, depois do cleanup,
pós-check e inventário final. O launcher aguardou o evento `close`, validou o JSON compacto,
Base64url sem padding, SHA-256, schema, código de saída e hashes dos artefatos antes de republicar
a mesma linha terminal.

- SHA-256 do JSON terminal: `BA032ADB806A41C4C46B0D12A9E180F9163D0253D8878B420332BB830AC0A659`;
- stdout do worker: 9.085 bytes, SHA-256
  `5ACE41FEE6172B97FF62EC3D61709729DA6A3783AAD0A6B1474DE43F9F056A3A`;
- stderr do worker: zero bytes, SHA-256
  `E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855`;
- stdout integral dos subprocessos: `2E5D956AB073E8EEB03D441C7D4C5790CA65629EBBEF080B02C2F799DD5C0F26`;
- stderr integral dos subprocessos: `786708E309E2C4B7C7E46FE2A4BC55F333751799D943A086A444EF8668E39B44`;
- inventários pré/pós: ambos
  `01ED54D839F0BFEAC40CB31624C61CD3CB82E2AF3DB553589AE67B2A7AD76A9F`;
- manifesto D33: `BB338E54535CA4F61E57481768C1905C1C3AC7B8646A11312C3F494E983EEC42`.

Os arquivos brutos permaneceram temporários e foram removidos somente depois da validação dos
hashes. A evidência consolidada está em
[`p009-runtime-validation-result.json`](p009-runtime-validation-result.json) e
[`p009-runtime-terminal-evidence.json`](p009-runtime-terminal-evidence.json).

## Resultado funcional

Fase A passou e foi revertida; Fase B iniciou e passou. Batches, abas, staging, erros,
rejeição parcial, imutabilidade, auditoria sanitizada, RLS Viewer/Editor/Admin e contexto inválido
estão todos `true`. As oito comparações de request configurado→auditado foram capturadas e são
idênticas. P007, P008, D23 concorrente e D24 também passaram.

Todos os 20 estágios registrados terminaram com `ok=true`. O estágio P009 integral levou
10.257 ms e o D23 concorrente 70.144 ms. `first_error=null`.

## Limpeza e estado final

O cleanup D27 em `finally` passou. `rollback_clean=true`; D26 terminou exata; zero associação com
grantor `postgres` e zero lock relevante. BRL=1, US=1, `app_users=0`, `audit_log=0` e as quatro
tabelas de importação ficaram vazias.

Os fingerprints pré/pós permaneceram:

- externo: `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95`;
- `ltc_m`: `0A39EEDACAC670E25EC46589F8774A13088C136453672C41A38A2EA948A891CB`;
- migrations: `8D0A1AB4BE73312A653EA1F6E677044E6FB609A37BC752CA588F5AA4025789EA`.

Dez migrations permaneceram alinhadas e a P009 continuou aplicada exatamente uma vez, com hash
`C0CDBC2F020A9D727D0E353A31EA7E91DF715E5B96BEB343E79407DECD940A22`.

Não houve migration, `db push`, DDL, SQL Editor, `repair`, `reset`, `pull`, migration down,
alteração de schema/ACL/policy/role/membership permanente, seed, dado permanente, commit, merge ou
push Git. A autorização de única invocação D33 foi consumida e não permite repetição.
