# P011-VAL — matriz de cobertura sintética

As fixtures são JSON/JSONL sintéticos criados em diretórios temporários. Nenhum workbook ou nome
empresarial real integra a suíte.

| Área         | Cobertura                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Contrato     | P009/P010 v1 válido, hash do workbook, hash inválido, contrato inválido, JSONL corrompido, aba ausente/documental |
| Clientes     | NFC, trim, whitespace, caixa, acento, pontuação, sufixo, chave determinística, exato, ambíguo, ausente e snapshot |
| Projetos     | nove códigos, espaço inicial, duplicidade física idêntica, D03, D02=164000, rejeição de 168000, D04=369749.1735   |
| Referências  | moeda explícita/ausente, cliente resolvido/ausente, projeto idêntico, conflito e registro protegido               |
| Fronteiras   | zero item/competência/Curva S/P012, `--apply` bloqueado, saída segura, diretório não gerenciado                   |
| Persistência | transação serializável, clientes antes de projetos, resultado por registro, zero delete/bypass RLS                |
| Determinismo | objetos/hashes idênticos e artefatos A/B byte a byte                                                              |

Resultado local D40: 16 testes/casos Node, incluindo D02–D06, D38/D39, P012 bloqueado e bytes
canônicos, todos aprovados antes dos gates integrais.
