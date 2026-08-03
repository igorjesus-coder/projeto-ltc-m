# Testes transversais

Use este diretório para testes de contrato ou integração que envolvam mais de um workspace.
Testes unitários permanecem próximos ao código em `apps/`.

Os testes PostgreSQL versionados ficam em `database/audit`. A P008 usa
`ltcm-p008-rls-tests.sql`; sua execução exige uma sessão capaz de assumir `ltc_m_runtime` e deve
terminar em rollback integral.

A P009 usa `ltcm-p009-staging-tests.sql` com fixtures sintéticas para estrutura, hashes,
idempotência, rejeição parcial, imutabilidade e RLS. O teste não lê XLSX e termina em rollback.
A execução D30 não alcançou esses cenários por aridade divergente no INSERT inicial; a fixture e o
scanner foram corrigidos localmente. A D31 acrescenta um gate sobre todo o SQL renderizado e uma
Fase A de bootstrap revertido antes de permitir a matriz funcional da Fase B.
A execução D31 aprovou a Fase A e avançou na Fase B até a assertion de request da auditoria; a
matriz RLS P009 posterior não foi alcançada. Cleanup, P007/P008 e fingerprints passaram.
A D33 adiciona testes locais do protocolo para saída grande, chunks, CRLF/LF, stderr intercalado,
atraso, códigos 0/1, envelope ausente/duplicado/truncado/corrompido, aceitação somente após
`close` e encerramento da árvore sintética no Windows. A única execução D33 passou integralmente.
