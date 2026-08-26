const foundations = [
  {
    title: 'Aplicação web',
    detail: 'React, TypeScript e Vite em módulos explícitos.',
  },
  {
    title: 'Qualidade',
    detail: 'Lint, testes, acessibilidade e build executáveis sem serviços locais.',
  },
  {
    title: 'Integrações',
    detail: 'API, autenticação e dados permanecem fora do scaffold P018.',
  },
];

export function HomePage() {
  return (
    <>
      <section className="page-heading" aria-labelledby="home-title">
        <p className="eyebrow">Fundação da aplicação</p>
        <h1 id="home-title">Estrutura pronta para evoluir</h1>
        <p>
          O shell estabelece os limites técnicos do frontend sem antecipar funcionalidades de
          cadastro ou integrações de dados.
        </p>
      </section>

      <section className="foundation-panel" aria-labelledby="foundation-title">
        <div className="section-heading">
          <div>
            <h2 id="foundation-title">Baseline do frontend</h2>
            <p>Responsabilidades disponíveis no scaffold atual</p>
          </div>
          <span className="status-indicator">
            <span aria-hidden="true" />
            Pronto para desenvolvimento
          </span>
        </div>

        <ul className="foundation-list">
          {foundations.map((foundation) => (
            <li key={foundation.title}>
              <strong>{foundation.title}</strong>
              <span>{foundation.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
