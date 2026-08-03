# P009 — threat model

Estado atual: D29 foi decidida em 31/07/2026 e a migration foi aplicada uma única vez. A menção
pendente ao fim é histórica; nova execução remota da suíte após a falha documentada depende de
nova decisão. A autorização D30 foi consumida por `r20260803132652-ada2b257`; a suíte P009 não
alcançou as fixtures por erro local de aridade, mas cleanup, D26 e fingerprints foram preservados.
A D31 foi consumida por `r20260803141344-e3356875`: a Fase A passou, a Fase B falhou na
assertion que comparava o request do contexto com o campo request da aba, e a matriz RLS P009 não
foi alcançada. O estado remoto foi limpo e os fingerprints permaneceram idênticos.

D32 foi decidida e aprovada pelo responsável do projeto em 03/08/2026 para corrigir somente o
fluxo local de contexto: requests distintos por cenário, assertions antes/depois do DML e
comparação exata com a auditoria. Trigger, função, schema e migration não foram alterados. O gate
impede reutilização do request de setup e expectativas inventadas pelo teste. D32 autoriza uma
única validação remota final, sem repetição automática.

A invocação D32 `r20260803151221-2d4f91ba` foi consumida. As assertions SQL de contexto,
auditoria e RLS concluíram, mas o orquestrador não capturou o result set intermediário esperado e
retornou código 1. Cleanup, D26, contagens, locks e fingerprints passaram com
`rollback_clean=true`; qualquer nova invocação exige nova decisão.

D33 foi decidida e aprovada em 03/08/2026 para fechar esse risco de observabilidade sem alterar o
comportamento funcional. O launcher captura bytes integrais em arquivos temporários, aguarda
`close`, valida um único envelope Base64url com SHA-256 e rejeita ausência, duplicidade,
truncamento, corrupção ou log posterior. Em timeout, encerra a árvore no Windows com
`taskkill /PID <pid> /T /F` e classifica falha. Os testes locais cobrem saída grande, chunks,
CRLF/LF, stderr intercalado, atraso, códigos 0/1 e processo descendente.

A única invocação D33 `r20260803173036-ddabb07d` terminou com código 0, sem timeout, com stdout do
worker integral e stderr vazio. O envelope comprovou P009, regressões e cleanup; inventários
pré/pós e fingerprints foram idênticos. O risco de transporte observado na D32 está encerrado, e
D33 não autoriza repetição.

| Risco                                     | Controle                                                             |
| ----------------------------------------- | -------------------------------------------------------------------- |
| arquivo ou caminho local exposto          | somente nome, hash, tamanho e MIME; barras sÃ£o rejeitadas           |
| payload financeiro duplicado na auditoria | staging nÃ£o usa auditoria genÃ©rica; erros guardam valor sanitizado |
| substituiÃ§Ã£o silenciosa de origem       | trigger imutÃ¡vel para coordenada, payload, hash, ator e versÃ£o     |
| reprocessamento da mesma requisiÃ§Ã£o     | `idempotency_key` parcial UNIQUE                                     |
| linha ruim interrompe lote                | erros append-only por linha e estados independentes                  |
| Viewer acessa importaÃ§Ã£o                | RLS fail-closed e grants somente ao runtime                          |
| privilÃ©gio fora do schema                | scanner, grants qualificados e PUBLIC revogado                       |
| segredo em metadata/erros                 | contrato sanitizado e proibiÃ§Ã£o documental de credenciais          |
| alteraÃ§Ã£o fÃ­sica                       | triggers `prevent_physical_delete` nas tabelas novas                 |

Retenção e purge permanecem decisões futuras. D29–D33 estão decididas e já consumidas; nenhuma
correção local autoriza nova execução remota sem nova decisão.
