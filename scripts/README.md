# Scripts

Automações compartilhadas devem ficar neste diretório e ser expostas por comandos no
`package.json` raiz.

Scripts precisam:

- falhar com código diferente de zero;
- aceitar configuração por argumentos ou ambiente;
- evitar dependência de caminhos absolutos;
- não imprimir segredos;
- oferecer modo de simulação antes de operações destrutivas.
