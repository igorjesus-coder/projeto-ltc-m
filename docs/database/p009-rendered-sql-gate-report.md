# P009 / D33 — relatório do gate integral do SQL renderizado

## Resultado local

- Status: aprovado.
- Decisão: D33, `Decidida` em 03/08/2026 e aprovada pelo responsável do projeto.
- Manifesto: [`p009-rendered-sql-gate-manifest.json`](p009-rendered-sql-gate-manifest.json).
- SHA-256 do manifesto lógico: `7F424201F25930F2B187D0B4539599A79E3EFC3259E371384DD0EA2BE5AC34E2`.
- SHA-256 da lista de fontes: `D775CA4BA224EA9EBB3F3B3BEFA4C6725B889A612D7A1E4F8C820C2F53AB91E3`.
- Os 19 caminhos relativos das fontes usam `/` no contrato, independentemente do sistema
  operacional; os hashes dos conteúdos SQL permanecem inalterados.
- SQL completo temporário: `.tmp/p009-rendered-sql-gate/`, ignorado pelo Git e sem credenciais.

| Run ID                    | SHA-256 do SQL renderizado                                         | Statements | INSERTs | Tuplas | Aliases | CTEs | Fixtures `app_users` | Contextos | Pós-DML | Auditados |
| ------------------------- | ------------------------------------------------------------------ | ---------: | ------: | -----: | ------: | ---: | -------------------: | --------: | ------: | --------: |
| `r20991231-gate-a1b2c3d4` | `9DE6E49F9EB1A38742C596C42C6AC170BBC9A7231FEFA9CA83BE7F99A91BF21C` |      1.172 |      76 |    105 |      59 |    2 |                   20 |        13 |      13 |         8 |
| `r20000101_gate_00000000` | `CF6F9FC1D91257B1E44A4C62F16C339D03C2CDB13E0C520B1EFBE0D3E03C51B2` |      1.172 |      76 |    105 |      59 |    2 |                   20 |        13 |      13 |         8 |

## Contrato preservado

O renderer continua derivando cada request de `<run-id>:p009:<cenário>`. Os 13 contextos, as 13
assertions pós-DML e as oito comparações configurado→auditado permanecem protegidos. D33 apenas
acrescenta a projeção `p009_terminal_evidence`, alcançável depois de todas as assertions e do
`ROLLBACK`; nenhum DML ou assertion funcional foi removido, relaxado ou alterado.

Todos os gates passaram: estrutura léxica, identificadores/aliases, paridade coluna/valor,
fixtures `app_users`, placeholders, statements proibidos, invariância por run ID e fluxo de
request. O único statement/alias adicional em relação ao manifesto D32 é a projeção de evidência
terminal autorizada por D33.

## Limites

O gate prova a forma e a invariância do SQL renderizado, não substitui sua semântica PostgreSQL.
A execução D33 deve ocorrer uma única vez pelo launcher versionado, com captura integral até
`close`, cleanup em `finally`, pós-check e inventário final antes do envelope `P009_RESULT_V1`.
Nenhuma migration, `db push`, DDL ou correção remota integra este fluxo.
