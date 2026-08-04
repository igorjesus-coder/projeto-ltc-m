# Plano de testes local P011/D40/D41

O harness [`ltcm-d40-tests.sql`](../../database/audit/ltcm-d40-tests.sql) usa apenas UUIDs e nomes
sintéticos. Ele abre uma transação, cobre 22 cenários D40 e 25 cenários D41 e executa `ROLLBACK`; uma assertion
posterior confirma ausência das fixtures. Nenhum comando conecta a banco ou schema externo.

`npm run d40:check` fixa migration, harness, escopo `ltc_m`, rollback e matriz de cenários.
`npm run test:d40` prova que remoções da matriz e DDL/rede/credenciais são recusadas. A execução
dinâmica usa exclusivamente PostgreSQL local disponível; sua ausência é reportada sem substituição
remota.

As regressões P007–P009 continuam nos gates existentes. Viewer/Editor/Admin, RLS e D24 não são
reimplementados. D40/D41 verificam preservação estrutural, os três estados de origem, referências
históricas, correção parcial/integral e auditoria com ator, request, justificativa e before/after.
