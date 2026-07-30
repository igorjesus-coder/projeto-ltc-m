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
- `scripts/collect-db-inventory.mjs`: gera inventário sanitizado e fingerprints separados.
