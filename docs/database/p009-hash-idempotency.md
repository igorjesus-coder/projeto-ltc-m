# P009 — hashes e idempotÃªncia

- arquivo: SHA-256 dos bytes exatos, hexadecimal minÃºsculo com 64 caracteres;
- aba: hash opcional da serializaÃ§Ã£o canÃ´nica das linhas;
- linha: SHA-256 UTF-8 do JSON canÃ´nico, com chaves estÃ¡veis e cÃ©lulas ordenadas;
- nÃ£o entram no hash de linha: batch ID, timestamps ou caminho local;
- entram: chave/nome da aba, nÃºmero da linha, valores, fÃ³rmulas e distinÃ§Ã£o entre `null` e vazio.

O cÃ¡lculo Ã© responsabilidade do P010. PostgreSQL valida somente o formato, sem extensÃ£o nova.
Hash de arquivo nÃ£o Ã© UNIQUE; `idempotency_key` parcial Ã© UNIQUE quando informada.
