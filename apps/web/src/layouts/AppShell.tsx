import { useEffect, useRef, useState, type ReactNode } from 'react';

import { APP_METADATA } from '../app/app-config';
import { publicEnvironment } from '../app/environment';
import { APP_NAVIGATION, type AppRoute } from '../app/routes';
import { Button } from '../components/design-system';

interface AppShellProps {
  readonly children: ReactNode;
  readonly currentRoute: AppRoute;
}

export function AppShell({ children, currentRoute }: AppShellProps) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mobileNavigationOpen) return undefined;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setMobileNavigationOpen(false);
      menuButtonRef.current?.focus();
    }

    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [mobileNavigationOpen]);

  const navigation = (
    <ul>
      {APP_NAVIGATION.map((item) => (
        <li key={item.route}>
          <a
            href={item.href}
            aria-current={currentRoute === item.route ? 'page' : undefined}
            onClick={() => setMobileNavigationOpen(false)}
          >
            {item.label}
          </a>
        </li>
      ))}
    </ul>
  );

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

        <span className="environment">Ambiente {publicEnvironment.appEnvironment}</span>

        <Button
          ref={menuButtonRef}
          className="mobile-menu-button"
          variant="ghost"
          aria-expanded={mobileNavigationOpen}
          aria-controls="mobile-primary-navigation"
          aria-label={mobileNavigationOpen ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setMobileNavigationOpen((open) => !open)}
        >
          <span aria-hidden="true">☰</span>
          <span>{mobileNavigationOpen ? 'Fechar' : 'Menu'}</span>
        </Button>
      </header>

      <div className="app-body">
        <aside className="desktop-navigation">
          <nav aria-label="Navegação principal">{navigation}</nav>
        </aside>

        <div className="content-column">
          <div
            className="mobile-navigation"
            id="mobile-primary-navigation"
            hidden={!mobileNavigationOpen}
          >
            <nav aria-label="Navegação móvel">{navigation}</nav>
          </div>
          <main id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>

      <footer className="app-footer">
        <span>{APP_METADATA.name}</span>
        <span>Fundação da aplicação CRUD</span>
      </footer>
    </div>
  );
}
