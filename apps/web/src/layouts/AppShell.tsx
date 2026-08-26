import type { ReactNode } from 'react';

import { APP_METADATA } from '../app/app-config';
import { publicEnvironment } from '../app/environment';
import type { AppRoute } from '../app/routes';

interface AppShellProps {
  readonly children: ReactNode;
  readonly currentRoute: AppRoute;
}

export function AppShell({ children, currentRoute }: AppShellProps) {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Pular para o conteúdo
      </a>

      <header className="topbar">
        <a className="brand" href="/" aria-label={`${APP_METADATA.name} — página inicial`}>
          <span className="brand-mark" aria-hidden="true">
            LT
          </span>
          <span className="brand-copy">
            <strong>{APP_METADATA.name}</strong>
            <span>Gestão de portfólio</span>
          </span>
        </a>

        <nav aria-label="Navegação principal">
          <a href="/" aria-current={currentRoute === 'home' ? 'page' : undefined}>
            Início
          </a>
        </nav>

        <span className="environment">Ambiente {publicEnvironment.appEnvironment}</span>
      </header>

      <main id="main-content" tabIndex={-1}>
        {children}
      </main>

      <footer className="app-footer">
        <span>{APP_METADATA.name}</span>
        <span>Fundação da aplicação CRUD</span>
      </footer>
    </div>
  );
}
