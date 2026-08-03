# Scripts

Automações compartilhadas devem ficar neste diretório e ser expostas por comandos no
`package.json` raiz.

Scripts precisam:

- falhar com código diferente de zero;
- aceitar configuração por argumentos ou ambiente;
- evitar dependência de caminhos absolutos;
- não imprimir segredos;
- oferecer modo de simulação antes de operações destrutivas.

Validadores de banco disponíveis:

- `npm run migrations:check`: valida migrations de schema;
- `npm run seeds:check`: valida o seed de valores controlados;
- `npm run integrity:check`: valida o teste SQL transacional da P006;
- `npm run p007:check`: valida escopo, cenários e rollback do teste SQL da P007;
- `npm run p008:check`: valida escopo, cenários por perfil e rollback do teste SQL da P008;
- `npm run p008:runtime:dry-run`: valida e descreve o harness D26/D27 sem consultar ou alterar o
  banco remoto;
- `npm run p008:runtime:validate`: executa a validação dinâmica autorizada, com prova revertida,
  grant temporário, conexões isoladas e revogação seletiva obrigatória em `finally`; a autorização
  D30 já foi consumida;
- `npm run d28:check`: valida a migration ACL forward do P008 e a assinatura completa de
  `ltc_m.current_actor_id(boolean)`;
- `npm run p009:check`: valida a migration e a suíte transacional sintética de staging, sem XLSX ou
  dados reais, incluindo fixtures de perfil com estado ativo explícito e validação dos aliases
  renderizados;
- `npm run p009:render:gate`: renderiza localmente todo o SQL enviado pelo harness com dois run IDs,
  valida lexer, identificadores, INSERTs, fixtures e invariância e atualiza o manifesto D33;
- `npm run test:p009:gate`: executa os casos positivos e negativos do lexer e do gate renderizado;
- `npm run p009:runtime:validate`: launcher D33 com captura integral de stdout/stderr até `close`,
  hashes SHA-256 e envelope terminal único `P009_RESULT_V1`; a única autorização foi consumida
  com sucesso por `r20260803173036-ddabb07d` e o comando não pode ser reexecutado sem nova decisão;
- `npm run pw902:check`: valida a única migration forward fail-closed, preserva os hashes das
  migrations aplicadas e exige os cenários de regressão PW902;
- `npm run d21:check`: valida a única migration forward D21, impede acesso direto a campos
  heterogêneos por trigger genérico e exige os cenários de `app_users` e dos demais triggers de
  inativação;
- `scripts/collect-db-inventory.mjs`: gera inventário sanitizado e fingerprints separados.
