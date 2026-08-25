# Apply local do baseline mensal P013

## Escopo D05

A D05 implementa a primeira persistência do baseline mensal exclusivamente para a suíte local de
testes em PostgreSQL 17. Após os hardenings D06A/D06C, implementação, pools e emissor de authority
ficam no escopo léxico do módulo da suíte em `tools/ltcm-normalizer/test/support`. O módulo fonte,
o artefato compilado e os entrypoints `.test` são import-inert: não exportam valores e um mero
carregamento não registra testes, não cria pool e não alcança a factory privada. Os scripts D05
executam explicitamente o próprio support como entrypoint de um worker do `node --test`; somente
depois desse ato o registro da suíte é delegado ao test runner. A flag
`LTCM_P013_D05_INTEGRATION=1` seleciona o teste PostgreSQL já registrado, mas isoladamente — mesmo
com URL, credenciais e ator locais válidos — não transforma import em authority. Nenhum desses
arquivos é importado por `src`, scripts, apps ou frontend. Não existe CLI de apply, writer
genérico, callback SQL, caminho Render/Supabase, banco remoto ou autorização de produção.

O harness cria e possui internamente o adapter de dry-run e o pool de apply. Ele não aceita
`Pool`, `PoolClient`, queryable ou executor fornecido pelo caller. Somente o objeto original
produzido por `dryRun` no mesmo harness recebe, via `WeakMap`, a capability não serializável de
apply. Fonte, adapter, snapshot, plano e harness permanecem ligados por identidade process-local;
hashes, cópias, clones, proxies, rehash e objetos de shape equivalente não concedem authority.

O boundary D06A lê configuração e ator em cópias simples validadas antes de alcançar o fluxo
interno. Getters, proxies, coerções, `cause` e erros com shape PostgreSQL fornecidos pelo caller
resultam somente em códigos P013 estáveis; mensagens, DSN, senha, paths ou detalhes arbitrários do
caller não atravessam a superfície test-facing.

## Transação e persistência

Cada tentativa usa cliente dedicado, peer TCP loopback atestado, banco `ltcm_test`, PostgreSQL 17,
login não-superuser/non-BYPASSRLS e `SET LOCAL ROLE ltc_m_runtime`. O ator ativo editor/admin, a
isolation `SERIALIZABLE` e `ENABLE/FORCE RLS` das quatro tabelas P013 são conferidos dentro da
transação.

O apply adquire primeiro o lock da versão e depois locks de projetos em ordem UUID canônica com
`pg_advisory_xact_lock(hashtextextended(namespace || identidade, 0))`. Somente depois dos locks ele
relê o snapshot do banco e rederiva o plano integral. Stale plan, item inativo/excluído, baseline
divergente, célula/linha ausente ou extra e mudança material falham fechados.

O primeiro apply persiste atomicamente:

- `monthly_source_artifacts`;
- o lifecycle/receipt existente em `import_batches`, sua sheet e 48 staging rows;
- `monthly_plan_baselines` e `monthly_plan_import_executions`;
- 102 `financial_plan_lines` materiais;
- as 432 `monthly_plan_cells`, incluindo 330 blanks, um zero explícito e 101 valores não zero.

Blank mantém amount e linha financeira nulos. Zero explícito é material, persiste `0.00` e aponta
para uma linha financeira. Valores são os decimais canônicos já arredondados por célula; o total
persistido da fonte certificada é `2800460.18`. A cadeia artifact → batch/sheet/staging → source
cell/linha → identidade P012 → item UUID → competência → baseline → linha financeira permanece
consultável.

## Idempotência, concorrência e falhas

Rerun byte-idêntico autentica todo o estado e retorna no-op com baseline, batch, execution e IDs
estáveis. Um novo SHA com o mesmo fingerprint registra apenas o novo artefato físico e reutiliza o
baseline financeiro e o receipt sem duplicar células ou linhas. Um fingerprint/baseline divergente
é conflito; não há update, upsert substitutivo, delete ou last-write-wins.

`40001` e `40P01` permitem no máximo duas tentativas totais, sempre com nova transação, locks e
releitura. `23505` nunca vira sucesso diretamente: a segunda tentativa fica limitada à autenticação
de um no-op completo; se o estado continuar pronto para insert, retorna conflito de identidade.
Falha tardia antes do commit reverte artifact, batch, sheet, staging, baseline, execution, células
e linhas. Resposta perdida após commit é recuperada por novo dry-run/apply e no-op autenticado.

## Validação local

```powershell
npm run test:p013:d05
$env:LTCM_P013_D05_INTEGRATION = '1'
npm run test:p013:d05:postgres
```

O teste PostgreSQL recria as 13 migrations atuais, usa a XLSX certificada somente para leitura, instala
fixtures e login exclusivamente sintéticos e restaura o schema migrado limpo no `finally`.
As regressões D06C importam support e entrypoints compilados em processos novos, por ESM,
CommonJS, caminho relativo, file URL e query de cache busting; elas inspecionam namespace,
descriptors, símbolos e efeitos em PostgreSQL. Produção, Supabase remoto e generic apply continuam
não autorizados.
