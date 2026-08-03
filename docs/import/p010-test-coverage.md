# P010-VAL — matriz de cobertura sintética

Todos os casos usam workbooks produzidos em memória e arquivos temporários. Nenhum dado ou
workbook real participa da suíte. Arquivo de teste:
`tools/ltcm-extractor/test/extractor.test.ts`.

| Requisito                       | Teste                                   | Fixture/cenário                                | Assertion principal                                          | Resultado |
| ------------------------------- | --------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ | --------- |
| Workbook válido                 | `serializa o contrato v1...`            | `operationalWorkbook`                          | código 0 e payload v1                                        | Pass      |
| Quatro abas e documental        | `valida o perfil LTC-M sintético...`    | `ltcmProfileWorkbook`                          | 3 operacionais; documental com staging 0                     | Pass      |
| Aba operacional ausente         | `modo estrito falha estruturalmente...` | `missingCurve`                                 | `P010_REQUIRED_SHEET_MISSING` e linhas restantes preservadas | Pass      |
| Aba extra não vazia             | `detecta competência duplicada...`      | `unexpected`                                   | erro `P010_UNEXPECTED_SHEET` em strict                       | Pass      |
| Aba extra vazia                 | `detecta competência duplicada...`      | `unexpectedEmpty`                              | warning `P010_UNEXPECTED_EMPTY_SHEET`                        | Pass      |
| Ordem de abas diferente         | `detecta competência duplicada...`      | `reverseOperationalOrder`                      | `P010_OPERATIONAL_SHEET_ORDER`                               | Pass      |
| Sistema 1900                    | `detecta competência duplicada...`      | `date1904=false`                               | manifesto registra `1900`                                    | Pass      |
| Sistema 1904                    | `serializa o contrato v1...`            | `date1904=true`                                | manifesto registra `1904`                                    | Pass      |
| Fórmula com cache               | `serializa o contrato v1...`            | `C1=A1+B1` com `v=3`                           | fórmula, valor e `cached_result_present=true`                | Pass      |
| Fórmula sem cache               | `preserva fórmula sem inventar...`      | `F1=A1*B1` sem `v`                             | valor `null`, warning/erro strict                            | Pass      |
| Inteiro                         | `serializa o contrato v1...`            | `A1=1`                                         | tipo `number`, valor exato                                   | Pass      |
| Decimal IEEE754                 | `serializa o contrato v1...`            | `866.5999999999999`                            | `round_trip_text` idêntico                                   | Pass      |
| Zero                            | `serializa o contrato v1...`            | `D3=0`                                         | zero não confundido com nulo                                 | Pass      |
| Célula ausente                  | `serializa o contrato v1...`            | célula sem registro                            | `state=missing`, `record_present=false`                      | Pass      |
| Stub                            | `serializa o contrato v1...`            | `F2`, stub formatado                           | `stub=true`, valor `null`                                    | Pass      |
| Valor nulo                      | `serializa o contrato v1...`            | ausência/stub                                  | `value=null` preservado e estado explícito                   | Pass      |
| String vazia                    | `serializa o contrato v1...`            | `E1=""`                                        | distinta de `null`, `state=empty_string`                     | Pass      |
| Texto com espaços               | `serializa o contrato v1...`            | texto com espaços nas extremidades             | igualdade exata sem trim                                     | Pass      |
| Booleano                        | `serializa o contrato v1...`            | `B3=true`                                      | valor e tipo preservados                                     | Pass      |
| Erro Excel                      | `serializa o contrato v1...`            | `E3=#DIV/0!`                                   | tipo e texto formatado preservados                           | Pass      |
| Data                            | `serializa o contrato v1...`            | serial + formato de data                       | serial, formato e ISO civil presentes                        | Pass      |
| Célula mesclada                 | `serializa o contrato v1...`            | `G1:H1`                                        | `state=merged`, `merged_from=G1`                             | Pass      |
| Arquivo corrompido              | `rejeita conteúdo que apenas usa...`    | texto renomeado para `.xlsx`                   | assinatura ZIP rejeitada                                     | Pass      |
| Extensão inválida               | `aplica limites...`                     | bytes XLSX em `.xls`                           | extensão rejeitada                                           | Pass      |
| Limite de arquivo               | `aplica limites...`                     | arquivo esparso >100 MiB                       | rejeição anterior à leitura                                  | Pass      |
| Limite de células               | `aplica limites...`                     | `A1:XFD1048576` na função pura                 | contagem excede 2.000.000                                    | Pass      |
| Limite de texto                 | `aplica limites...`                     | texto sintético com 32.768 caracteres          | rejeição sem truncamento                                     | Pass      |
| Path traversal/entrada na saída | `executa a CLI compilada...`            | input dentro do output                         | CLI retorna código 2                                         | Pass      |
| Saída não gerenciada            | `recusa substituir diretório...`        | destino sem marcador                           | escrita recusada                                             | Pass      |
| Raiz como saída                 | `aplica limites...`                     | raiz do volume                                 | escrita recusada                                             | Pass      |
| Competência duplicada           | `detecta competência duplicada...`      | dois seriais iguais                            | check `COMPETENCIES=error`                                   | Pass      |
| Competência fora de ordem       | `detecta competência duplicada...`      | dois primeiros seriais invertidos              | check `COMPETENCIES=error`                                   | Pass      |
| Código repetido                 | `valida o perfil LTC-M sintético...`    | cinco códigos sintéticos reutilizados          | grupos duplicados >0 e linhas preservadas                    | Pass      |
| Projeto com espaço inicial      | `valida o perfil LTC-M sintético...`    | cabeçalho ` 2024-06-11837...`                  | `leading_space_preserved=true`                               | Pass      |
| Linha código/descrição vazios   | `valida o perfil LTC-M sintético...`    | linha 48                                       | coordenada permanece em ambas as listas                      | Pass      |
| Strict com erro                 | `modo estrito falha estruturalmente...` | aba ausente/oculta/extra                       | código 1 e rejeição parcial                                  | Pass      |
| Strict com warning aprovado     | `valida o perfil LTC-M sintético...`    | `2024-02-10990` sintético                      | warning presente e código 0                                  | Pass      |
| Determinismo                    | `gera exatamente os mesmos bytes...`    | duas escritas da mesma entrada                 | lista e bytes idênticos                                      | Pass      |
| Mudança de uma célula           | `aplica limites...`                     | `A1: 1→2`                                      | hash do arquivo, linha e aba mudam; outra linha/aba não      | Pass      |
| Documental sem staging          | `valida o perfil LTC-M sintético...`    | `Decisões Aprovadas` sintética                 | zero JSONL/linha/chave documental                            | Pass      |
| CLI com espaços/escape cmd      | `valida argumentos...`                  | tokens separados, inline e carets do `npm.cmd` | caminho reconstruído exatamente                              | Pass      |
| CLI ponta a ponta               | `executa a CLI compilada...`            | processo Node real                             | resumo, código 0 e artefatos                                 | Pass      |

Resultado: 11 testes, 11 aprovados.
