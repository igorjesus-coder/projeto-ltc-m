# P009 / D33 — diagnóstico do launcher e do protocolo de evidência

## Árvore de processos atual

No Windows, a invocação versionada forma esta cadeia:

1. `npm.cmd`/npm inicia o processo Node do harness;
2. o harness usa `child_process.spawn()` para iniciar `node_modules/supabase/dist/supabase.js`;
3. esse wrapper Node resolve o binário da plataforma e usa
   `execFileSync(supabase.exe, ..., { stdio: "inherit" })`;
4. `supabase.exe` executa a consulta remota.

O processo pai controlado por `runProcess()` é apenas o wrapper Node. O executável real é seu
descendente.

## Captura, eventos e timeout

- `spawn()` é chamado com `stdio: ['ignore', 'pipe', 'pipe']`, `windowsHide: true` e sem
  `detached` explícito;
- listeners de `stdout`, `stderr`, `error` e `close` são instalados imediatamente após o spawn e
  não são removidos manualmente;
- a conclusão normal aguarda `close`, não apenas `exit`;
- stdout e stderr são acumulados integralmente em strings UTF-8 na memória, sem `maxBuffer`;
- o timeout interno padrão é 120.000 ms; o teste D23 também usa 120.000 ms;
- no timeout, o código chama apenas `child.kill()` e espera `close`;
- no Windows, `child.kill()` não encerra recursivamente `supabase.exe`; como o wrapper usa stdio
  herdado, o descendente pode continuar com os pipes e a operação remota ativos;
- a execução D31 também sofreu um timeout externo curto do launcher que a acompanhava. A D32 não
  excedeu o timeout interno: a consulta P009 fechou em 9.666 ms.

Portanto há dois defeitos independentes: encerramento de árvore incompleto em timeout e protocolo
de evidência dependente de result set intermediário.

## Falha D32

`runSql()` procurava literalmente `"p009_rejection_partial_integrity": true` no stdout. Só depois
tentaria localizar `p009_request_matrix` via `parseQueryRows()`. A CLI concluiu o SQL com código
zero, mas não transportou esse result set intermediário no JSON final. A ausência do fragmento
gerou exception local, incrementou `functionalFailures` e fez o harness retornar código 1, embora
as assertions SQL e o rollback tivessem terminado.

## Correção D33 implementada

O protocolo deve:

- capturar bytes integrais de stdout/stderr em arquivos temporários desde o spawn até `close`;
- encerrar a árvore no Windows com `taskkill /PID <pid> /T /F` em timeout;
- não analisar resultado antes de `close`;
- emitir e aceitar exatamente um envelope terminal `P009_RESULT_V1`, íntegro, como último registro;
- validar Base64url, SHA-256, schema, código de saída e hashes dos artefatos;
- rejeitar ausência, duplicidade, truncamento, corrupção e qualquer log posterior.

Os testes D33 reproduzem a árvore wrapper→descendente, chunks, CRLF/LF, stderr intercalado, saída
grande e atraso superior ao timeout externo anterior.

No Windows, o runner chama o caminho explícito `%SystemRoot%\System32\taskkill.exe` com
`/PID <pid> /T /F`, captura o código/erro do encerramento e só resolve depois do `close`. O sandbox
local bloqueia `taskkill` com “Acesso negado”; por isso o teste sintético obrigatório foi executado
fora dessa restrição e confirmou que o descendente não sobrevive. A execução remota D33 não
acionou timeout.

A única invocação `r20260803173036-ddabb07d` encerrou com código 0 após 252,7 s. O worker publicou
um envelope, stderr vazio e 9.085 bytes de stdout; o launcher reconstituiu e validou os mesmos
bytes/hash antes de emitir a linha final.

## Portabilidade e segurança do encerramento D49

O encerrador preserva mecanismos distintos por plataforma. No Windows, ele inicia
`taskkill.exe /PID <pid> /T /F`; por isso `termination.code` contém o código numérico desse
subprocesso e zero representa encerramento bem-sucedido. No POSIX, o encerrador entrega
`SIGKILL` com `process.kill()` ao grupo e, quando necessário, ao processo direto. Como não existe
um subprocesso de encerramento nesse caminho, `termination.code` permanece `null` tanto no
sucesso quanto na falha.

`termination.ok=true` significa que pelo menos um sinal foi entregue ou que grupo e processo já
não existiam. `ESRCH` confirma alvo inexistente e não é falha operacional quando ambas as
tentativas aplicáveis confirmam essa condição. `EPERM` e qualquer outro erro real permanecem
falhas, com informação do erro preservada; todas as tentativas falharem nunca produz
`termination.ok=true`.

Timeout continua sendo falha de `runCapturedProcess`, ainda que o encerramento da árvore seja
bem-sucedido. Non-zero, sinal e erro de spawn também não são convertidos em sucesso. A Promise
principal continua resolvendo somente depois de `close`, e o encerrador Windows possui guarda
própria para que eventos `error` e `close` tardios não gerem efeitos conflitantes ou substituam o
primeiro resultado.

A D49 altera apenas o helper, seus testes locais e esta clarificação. Não modifica banco, SQL,
migrations, manifesto/evidências históricas D33, P009 funcional, P011 ou D40/D41.
