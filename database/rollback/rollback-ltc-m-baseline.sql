-- NÃO EXECUTAR AUTOMATICAMENTE.
--
-- Rollback manual e destrutivo da baseline P004 / 1.04.
-- Este arquivo remove exclusivamente o schema ltc_m e todos os objetos nele.
-- A execução apagará permanentemente todos os dados futuros do LTC-M.
--
-- Pré-condições obrigatórias para uma execução futura:
--   * autorização explícita do responsável;
--   * backup recuperável e restauração testada;
--   * confirmação de que o alvo é o ambiente correto;
--   * interrupção de toda escrita da aplicação;
--   * revisão do impacto sobre integrações e Tableau.
--
-- Este rollback NÃO altera supabase_migrations.schema_migrations.
-- O registro original deve permanecer como evidência histórica. Para reconstruir
-- o schema depois de um rollback autorizado, crie uma nova migration forward com
-- novo timestamp. Não use migration repair e não apague o histórico manualmente.

begin;

drop schema ltc_m cascade;

commit;
