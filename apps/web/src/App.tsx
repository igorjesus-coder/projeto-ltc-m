import './styles.css';

const foundations = [
  { label: 'Aplicação web', detail: 'React + TypeScript', state: 'Configurada' },
  { label: 'Banco local', detail: 'Supabase/PostgreSQL', state: 'Disponível via CLI' },
  { label: 'Camada analítica', detail: 'Views para Tableau', state: 'Próxima etapa' },
];

export function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          LT
        </div>
        <div>
          <strong>LTC-M</strong>
          <span>Gestão de portfólio</span>
        </div>
        <span className="environment">Ambiente local</span>
      </header>

      <main>
        <section className="page-heading">
          <p className="eyebrow">Workspace</p>
          <h1>Base local pronta</h1>
          <p>
            Fundação técnica para o CRUD, o banco relacional e as fontes analíticas do portfólio.
          </p>
        </section>

        <section className="status-panel" aria-labelledby="foundation-title">
          <div className="section-heading">
            <div>
              <h2 id="foundation-title">Componentes</h2>
              <p>Estado da estrutura inicial do projeto</p>
            </div>
            <span className="status-indicator">
              <span aria-hidden="true" />
              Em desenvolvimento
            </span>
          </div>

          <div className="status-table">
            {foundations.map((foundation) => (
              <div className="status-row" key={foundation.label}>
                <div>
                  <strong>{foundation.label}</strong>
                  <span>{foundation.detail}</span>
                </div>
                <span>{foundation.state}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
