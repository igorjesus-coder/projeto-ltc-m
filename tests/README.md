# Testes transversais

Use este diretório para testes de contrato ou integração que envolvam mais de um workspace.
Testes unitários permanecem próximos ao código em `apps/`.

Os testes PostgreSQL versionados ficam em `database/audit`. A P008 usa
`ltcm-p008-rls-tests.sql`; sua execução exige uma sessão capaz de assumir `ltc_m_runtime` e deve
terminar em rollback integral.
