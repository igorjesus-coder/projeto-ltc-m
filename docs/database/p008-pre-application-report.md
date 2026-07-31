# P008 / 1.08 — relatório pré-aplicação

> Snapshot histórico anterior à aplicação e às decisões D26/D27; não representa o catálogo
> normativo final. Consulte o relatório de validação dinâmica para o estado vigente.

Data: 31/07/2026. Alvo: desenvolvimento remoto temporário `Funcionarios`, região `us-east-1`,
PostgreSQL 17.4. A exceção D25 aceita especificamente a ausência de backup recuperável para este
push, sem transformar o ambiente compartilhado em homologação ou produção.

## Gates Git e decisões

- `HEAD` inicial e `origin/main`: `cd9d5c224db824e9e2f754948e120eee64ffc05e`;
- P007 `41206d3de34395304a8e356966184f3be0164c51` é ancestral de `origin/main`;
- P008-PRE: `cd9d5c224db824e9e2f754948e120eee64ffc05e` em `origin/main`;
- worktree inicial limpo, sem mudanças não relacionadas;
- D22, D23, D24 e D25: `Decidida`, todas em 31/07/2026.

Nenhuma migration aplicada foi editada. A implementação usa duas migrations novas: uma exclusiva
para `AUDIT_READ` e outra para role, contexto, D23, D24, grants e RLS.

## Estado remoto anterior

As seis migrations P004–P007 estavam alinhadas. O inventário read-only confirmou:

- `ltc_m_runtime` inexistente;
- 13 tabelas de `ltc_m`, todas sem RLS e sem FORCE RLS;
- zero policies;
- owners de tabelas e funções: `postgres`;
- 18 funções `ltc_m` executáveis por `PUBLIC`;
- zero default privileges explícitos;
- grants de tabela somente do owner;
- BRL = 1 e US = 1 (`Unidade e Serviço`);
- tabelas operacionais e `audit_log` vazios.

O inventário completo está em [`p008-inventory-pre.json`](p008-inventory-pre.json). Fingerprints:

| Escopo             | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| metadados externos | `7AFCC9D9A3D590585A6E864E877DF28D4BBFA3C09A38847BB9FC704162552D95` |
| `ltc_m`            | `1AB309C0C6F24D82BF465041D5D45A1035D0F0FDD2E919058E224B174D185864` |
| migrations         | `0900B5B127AEEC5F6357CA7450D6B929B7A849EEC20AB16591E0FC0BF457219E` |

## Delta esperado e gates locais

O único delta global esperado é `ltc_m_runtime`, sem login, bypass, ownership ou associação. Os
demais deltas ficam em `ltc_m`: `AUDIT_READ`, dois helpers/controladores novos, três funções P007
endurecidas, 35 policies, RLS/FORCE RLS nas 13 tabelas e ACLs deny-by-default. Não há seed, DML de
dados reais, objeto externo, credencial ou login do backend.

A matriz detalhada, análise de recursão e threat model estão em
[`authorization-rls-p008.md`](authorization-rls-p008.md). O preflight executável read-only está em
[`ltcm-p008-preflight.sql`](../../database/audit/ltcm-p008-preflight.sql).

Antes do dry-run, todos os validadores locais, testes Node, lint, typecheck e build passaram. A
suíte PostgreSQL P008 está preparada para execução pós-push em transação com rollback integral.
